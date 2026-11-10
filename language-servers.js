/** Managed stdio navigation for gopls, Eclipse JDT LS and Pyright. */
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch } from 'chokidar';

const LANGUAGES = { '.go': 'go', '.java': 'java', '.py': 'python', '.pyi': 'python' };
const failure = (message, code = 'LANGUAGE_SERVER_FAILED', status = 502) => Object.assign(new Error(message), { code, status });
const serverError = error => typeof error?.code === 'string' && error.code.startsWith('LANGUAGE_SERVER_') ? error
  : Object.assign(failure(error instanceof Error ? error.message : String(error)), { cause: error });

/**
 * Identify a supported stdio language from its final file extension.
 * @param path - Workspace-relative source path.
 * @returns Server language id, or null for files handled elsewhere.
 */
export function serverLanguage(path) { return LANGUAGES[/\.[^./]+$/.exec(path)?.[0].toLowerCase()] ?? null; }

function abortable(promise, signal) {
  signal.throwIfAborted();
  let abort;
  return Promise.race([promise, new Promise((resolve, reject) => {
    abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
  })]).finally(() => signal.removeEventListener('abort', abort));
}

/** Validate definition messages received from an out-of-process server. */
function locationsOf(result) {
  if (result === null) return [];
  const items = Array.isArray(result) ? result : [result];
  return items.map(item => {
    const uri = item?.targetUri ?? item?.uri, range = item?.targetSelectionRange ?? item?.range;
    if (typeof uri !== 'string' || !range || ![range.start, range.end].every(position => Number.isSafeInteger(position?.line) && position.line >= 0 && Number.isSafeInteger(position?.character) && position.character >= 0)) throw failure('invalid definition location from language server', 'LANGUAGE_SERVER_PROTOCOL');
    new URL(uri);
    return { uri, range };
  });
}

/**
 * Own workspace-scoped servers, serialized document queries, and awaited cancellation/disposal.
 * @param ctx - Host context with managed subprocesses and the local filesystem seam.
 * @param specs - Resolved trusted command specifications.
 * @param config - Validated timeout and termination budgets.
 * @returns Read-only query and asynchronous disposal actions.
 */
export function createLanguageServers(ctx, specs, config) {
  const lifetime = new AbortController(), entries = new Map(), pending = new Set();
  let disposed = false;
  const track = promise => {
    pending.add(promise); promise.then(() => pending.delete(promise), () => pending.delete(promise)); return promise;
  };
  const hasRemovedTarget = async (locations, signal) => {
    for (const location of locations) {
      const uri = new URL(location.uri);
      if (uri.protocol !== 'file:') continue;
      const file = await ctx.fs.resolve(fileURLToPath(uri), { signal });
      if ((await ctx.fs.stat(file, signal))?.type !== 'file') return true;
    }
    return false;
  };

  const observe = (language, source) => {
    const root = ctx.fs.processPath(source.root);
    const ignored = new Set(config.navigationWatchExcludedDirectories);
    const relevant = path => {
      const name = basename(path), extension = extname(path).toLowerCase();
      return language === 'python' ? ['.py', '.pyi', '.pth'].includes(extension) || ['pyproject.toml', 'pyrightconfig.json'].includes(name)
        : language === 'go' ? extension === '.go' || ['go.mod', 'go.sum', 'go.work', 'go.work.sum'].includes(name)
          : ['.java', '.gradle', '.classpath', '.project'].includes(extension) || ['pom.xml', '.classpath', '.project'].includes(name);
    };
    const state = { revision: 0, error: null };
    const watcher = watch(root, { ignoreInitial: true, followSymlinks: false, atomic: false,
      ignored: path => relative(root, path).split(sep).some(part => ignored.has(part)),
    });
    const ready = new Promise((resolve, reject) => {
      watcher.once('ready', resolve);
      watcher.on('error', error => { state.error = failure('workspace file watching failed: ' + error.message, 'LANGUAGE_SERVER_WATCH_FAILED'); reject(state.error); });
    });
    ready.catch(() => {});
    watcher.on('all', (event, path) => { if (['add', 'change', 'unlink'].includes(event) && relevant(path)) state.revision++; });
    return { watcher, ready, state };
  };

  async function start(language, source, signal) {
    const spec = specs[language];
    let command;
    try { command = await ctx.subprocess.resolveExecutable(spec.command, undefined, signal); }
    catch (error) { signal.throwIfAborted(); throw failure(`${language} language server is unavailable; configure languageServers.${language}.command`, 'LANGUAGE_SERVER_MISSING', 503); }
    signal.throwIfAborted();
    const stateDirectory = language === 'java' ? await mkdtemp(join(tmpdir(), 'dsh-git-java-')) : null;
    let child, rpc, closeTask;
    let dead = false, ready;
    const javaReady = new Promise(resolve => { ready = resolve; });
    const close = () => {
      closeTask ??= (async () => {
        dead = true;
        try { rpc?.dispose(); }
        finally {
          try { child?.terminate(); await child?.waitForExit(); }
          finally { if (stateDirectory) await rm(stateDirectory, { recursive: true, force: true }); }
        }
      })();
      return closeTask;
    };
    try {
      signal.throwIfAborted();
      child = ctx.subprocess.spawn({ argv: [command, ...spec.args, ...(stateDirectory ? ['-data', stateDirectory] : [])],
        cwd: ctx.fs.processPath(source.root), env: spec.env, graceMs: config.serverKillGraceMs,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 65536 } } });
      if (!child.stdin || !child.stdout) throw failure('managed subprocess omitted language-server pipes');
      rpc = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
      const ended = child.done.then(() => { dead = true; throw failure(`${language} language server exited`); }, error => { dead = true; throw error; });
      ended.catch(() => {});
      let rejectTransport;
      const broken = new Promise((resolve, reject) => { rejectTransport = reject; });
      broken.catch(() => {});
      rpc.onError(([error]) => rejectTransport(error));
      rpc.onClose(() => { dead = true; rejectTransport(failure('language-server connection closed')); });
      rpc.onRequest('workspace/configuration', params => params.items.map(item => {
        if (!item.section) return spec.settings;
        return item.section.split('.').reduce((value, key) => value?.[key], spec.settings) ?? null;
      }));
      rpc.onRequest('window/workDoneProgress/create', () => null);
      rpc.onRequest('client/registerCapability', params => {
        // These acknowledgements carry no filesystem watchers or executable commands.
        if (params.registrations.some(item => item.method !== 'workspace/executeCommand')) throw failure('dynamic language-server capability is not supported', 'LANGUAGE_SERVER_PROTOCOL');
        return null;
      });
      rpc.onRequest('client/unregisterCapability', () => null);
      rpc.onRequest('workspace/applyEdit', () => ({ applied: false, failureReason: 'read-only navigation' }));
      rpc.onNotification('language/status', message => { if (message.type === 'ServiceReady') ready(); });
      rpc.listen();
      const request = (method, params, querySignal) => abortable(Promise.race([rpc.sendRequest(method, params), ended, broken]), querySignal);
      const notify = (method, params, querySignal) => abortable(Promise.race([rpc.sendNotification(method, params), ended, broken]), querySignal);
      const uri = ctx.fs.fileUrl(source.root);
      const initialize = await request('initialize', {
        processId: null, rootUri: uri, workspaceFolders: [{ uri, name: 'workspace' }],
        capabilities: { general: { positionEncodings: ['utf-16'] }, textDocument: { definition: { linkSupport: true }, typeDefinition: { linkSupport: true }, synchronization: { dynamicRegistration: false } },
          workspace: { configuration: true, workspaceFolders: true, didChangeWatchedFiles: { dynamicRegistration: false }, applyEdit: false }, window: { workDoneProgress: true } },
        initializationOptions: { ...spec.initializationOptions, ...(language === 'java' ? { workspaceFolders: [uri], settings: spec.settings } : {}) },
      }, signal);
      const capabilities = initialize?.capabilities;
      if (!capabilities?.definitionProvider || (capabilities.positionEncoding !== undefined && capabilities.positionEncoding !== 'utf-16')) throw failure('server must support definitions with UTF-16 positions', 'LANGUAGE_SERVER_PROTOCOL');
      const sync = capabilities.textDocumentSync;
      if (!(typeof sync === 'number' ? sync !== 0 : sync?.openClose === true)) throw failure('server does not support opening source documents', 'LANGUAGE_SERVER_PROTOCOL');
      await notify('initialized', {}, signal);
      await notify('workspace/didChangeConfiguration', { settings: spec.settings }, signal);
      if (spec.waitForJavaReady) await abortable(Promise.race([javaReady, ended, broken]), signal);
      return { get dead() { return dead; }, close,
        async definition(source, position, signal, typeDefinition) {
          if (typeDefinition && !capabilities.typeDefinitionProvider) return [];
          const uri = ctx.fs.fileUrl(source.file);
          try {
            await notify('textDocument/didOpen', { textDocument: { uri, languageId: language, version: 1, text: source.text } }, signal);
            const result = await request(typeDefinition ? 'textDocument/typeDefinition' : 'textDocument/definition', { textDocument: { uri }, position }, signal);
            await notify('textDocument/didClose', { textDocument: { uri } }, signal);
            return locationsOf(result);
          } catch (error) { await close(); signal.throwIfAborted(); throw serverError(error); }
        },
      };
    } catch (error) { await close(); signal.throwIfAborted(); throw serverError(error); }
  }

  return {
    query(language, source, position, callerSignal, typeDefinition = false) {
      if (disposed) return Promise.reject(failure('language navigation has been disposed', 'LANGUAGE_SERVER_DISPOSED', 503));
      const caller = AbortSignal.any([lifetime.signal, callerSignal]);
      if (caller.aborted) return Promise.reject(caller.reason);
      const key = language + ':' + ctx.fs.fileUrl(source.root);
      let entry = entries.get(key);
      if (!entry) { entry = { language, root: source.root, rootUri: ctx.fs.fileUrl(source.root), epoch: new AbortController(), tail: Promise.resolve(), session: null, generation: -1, ...observe(language, source) }; entries.set(key, entry); }
      const signal = AbortSignal.any([caller, entry.epoch.signal]);
      const previous = entry.tail;
      const query = abortable(previous, signal).then(async () => {
        await abortable(entry.ready, signal);
        for (let attempt = 0; attempt < 2; attempt++) {
          signal.throwIfAborted();
          if (entry.state.error) throw entry.state.error;
          let generation = entry.state.revision;
          if (!entry.session || entry.session.dead || entry.generation !== generation) {
            await entry.session?.close();
            entry.generation = generation;
            entry.session = await start(language, source, signal);
            generation = entry.state.revision; entry.generation = generation;
          }
          const locations = await entry.session.definition(source, position, signal, typeDefinition);
          const missing = await hasRemovedTarget(locations, signal);
          if (entry.state.error) throw entry.state.error;
          const emptyKey = JSON.stringify([ctx.fs.fileUrl(source.file), source.version, position.line, position.character, generation]);
          const checkEmpty = attempt === 0 && language === 'python' && !typeDefinition && locations.length === 0 && entry.emptyChecked !== emptyKey;
          if (!missing && generation === entry.state.revision && !checkEmpty) return locations;
          if (checkEmpty) entry.emptyChecked = emptyKey;
          // Queries racing dependency edits must retry against a fresh workspace state.
          entry.generation = -1;
          if (attempt === 1) throw failure('workspace changed during navigation; retry after file changes finish', 'LANGUAGE_SERVER_WORKSPACE_CHANGED');
        }
      });
      // An aborted waiter must not allow later requests to overtake the active query.
      entry.tail = previous.then(() => query).then(() => {}, () => {});
      return track(query);
    },
    /** Reset owned services for one workspace, draining old queries and rebuilding watchers before returning. */
    reset(root) {
      if (disposed) return Promise.reject(failure('language navigation has been disposed', 'LANGUAGE_SERVER_DISPOSED', 503));
      const rootUri = ctx.fs.fileUrl(root);
      const tasks = [...entries.values()].filter(entry => entry.rootUri === rootUri).map(entry => {
        entry.epoch.abort(failure('navigation cancelled by workspace refresh', 'LANGUAGE_SERVER_REFRESHED', 409));
        entry.epoch = new AbortController();
        const task = entry.tail.then(async () => {
          await entry.session?.close();
          await entry.watcher.close();
          entry.session = null; entry.generation = -1; entry.emptyChecked = undefined;
          lifetime.signal.throwIfAborted();
          Object.assign(entry, observe(entry.language, { root: entry.root }));
          await abortable(entry.ready, lifetime.signal);
        }).catch(error => {
          entry.state.error = failure('workspace navigation refresh failed: ' + error.message, 'LANGUAGE_SERVER_REFRESH_FAILED');
          throw entry.state.error;
        });
        entry.tail = task.then(() => {}, () => {});
        return task;
      });
      return track(Promise.all(tasks).then(() => ({ resetServices: tasks.length })));
    },
    async dispose() {
      disposed = true; lifetime.abort();
      await Promise.allSettled([...pending]);
      const results = await Promise.allSettled([...entries.values()].flatMap(entry => [entry.session?.close(), entry.watcher.close()]));
      entries.clear();
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'language-server teardown failed');
    },
  };
}
