/** Bounded source reads and semantic navigation with scoped references for installed library files. */
import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { parser as pythonParser } from '@lezer/python';
import { imageMime, readImagePreview } from './image-preview.js';
import { serverLanguage } from './language-servers.js';

const MAX_SOURCE_BYTES = 512 * 1024;
const TYPESCRIPT_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const LIBRARY_SOURCE = /\.(?:pyi?|go|java|[cm]?[jt]sx?)$/i;
const LIBRARY_PREFIX = 'dsh-library://';
const failure = (message, code, status = 400) => Object.assign(new Error(message), { code, status });
const editablePath = (path, file) => !imageMime(path) && !path.toLowerCase().split('/').includes('.git') && !file.targetKey.toLowerCase().split(/[\\/]/).includes('.git');
const versionOf = text => createHash('sha256').update(text).digest('hex');

function pythonReceiverType(locations, sourceUri, lines, line, character) {
  // Pyright may report the parameter declaration for its synthesized Self type.
  const receiver = /\bself\b/g;
  if (locations.length !== 1 || locations[0].uri !== sourceUri
    || ![...lines[line].matchAll(receiver)].some(match => match.index <= character && character < match.index + match[0].length)) return locations;
  const { start } = locations[0].range;
  const offset = (row, column) => lines.slice(0, row).reduce((length, text) => length + text.length + 1, column);
  const position = offset(start.line, start.character), text = lines.join('\n');
  const parameter = pythonParser.parse(text).resolveInner(position, 1);
  const params = parameter.parent, method = params?.parent, owner = method?.parent?.parent;
  if (parameter.name !== 'VariableName' || parameter.from !== position || text.slice(parameter.from, parameter.to) !== 'self'
    || params?.name !== 'ParamList' || params.getChild('VariableName')?.from !== position || parameter.nextSibling?.name === 'TypeDef'
    || method?.name !== 'FunctionDefinition' || method.parent?.name !== 'Body' || owner?.name !== 'ClassDefinition') return locations;
  const name = owner.getChild('VariableName');
  if (!name) return locations;
  const before = text.slice(0, name.from), row = before.split('\n').length - 1, column = before.length - before.lastIndexOf('\n') - 1;
  return [{ uri: sourceUri, range: { start: { line: row, character: column }, end: { line: row, character: column + name.to - name.from } } }];
}

/**
 * Resolve and read a bounded UTF-8 regular file inside a registered workspace.
 * @param ctx - Host with the filesystem service.
 * @param cwd - Already validated registered workspace path.
 * @param path - Already validated workspace-relative path.
 * @param signal - Aborts filesystem work.
 * @returns Canonical targets, source text, and a content version for navigation.
 */
export async function readWorkspaceSource(ctx, cwd, path, signal) {
  const root = await ctx.fs.resolve(cwd, { signal });
  const file = await ctx.fs.resolve(path, { cwd, signal });
  if (!ctx.fs.contains(root, file)) throw failure('file is outside the workspace', 'SOURCE_OUTSIDE_WORKSPACE', 403);
  return readSourceFile(ctx, root, file, signal);
}

async function readSourceFile(ctx, root, file, signal) {
  const stat = await ctx.fs.stat(file, signal);
  if (stat?.type !== 'file') throw failure('source file does not exist or is not regular', 'SOURCE_NOT_FILE', 404);
  if (stat.size > MAX_SOURCE_BYTES) throw failure('source exceeds 512 KiB', 'SOURCE_TOO_LARGE', 413);
  const bytes = await ctx.fs.readBytes(file, signal, MAX_SOURCE_BYTES);
  if (bytes.includes(0)) throw failure('binary source cannot be displayed', 'SOURCE_BINARY', 415);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (error) { throw failure('source must be UTF-8', 'SOURCE_ENCODING', 415); }
  return { root, file, text, version: versionOf(text), writeVersion: stat.version };
}

/**
 * Terminate and await the per-query compiler thread on success, error, cancellation, and disposal.
 * @param data - Canonical local paths, current source text and zero-based UTF-16 position.
 * @param signal - Aborts the query and terminates its thread.
 * @returns Compiler definition locations; an empty list means no definition.
 */
export async function typescriptDefinitions(data, signal) {
  signal?.throwIfAborted();
  const worker = new Worker(new URL('./typescript-worker.js', import.meta.url), { workerData: data, execArgv: [] });
  let abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      worker.once('message', message => message.error ? reject(failure(message.error, 'NAVIGATION_FAILED', 502)) : resolve(message.locations));
      worker.once('error', reject);
      worker.once('exit', code => reject(failure(`compiler worker exited before replying (${code})`, 'NAVIGATION_FAILED', 502)));
      if (signal?.aborted) abort();
    });
  } finally {
    signal?.removeEventListener('abort', abort);
    await worker.terminate();
  }
}

const TREE_CACHE_DIRS = ['node_modules', '.venv', 'venv', '__pycache__', '.cache', '.tools'];

async function listPlainWorkspace(ctx, cwd, signal) {
  const root = await ctx.fs.resolve(cwd, { signal });
  const files = [];
  const pending = [{ target: root, prefix: '' }];
  const seen = new Set([root.targetKey]);
  let visited = 0;
  while (pending.length) {
    signal.throwIfAborted();
    const { target, prefix } = pending.pop();
    for (const entry of await ctx.fs.listDir(target, signal)) {
      signal.throwIfAborted();
      if (++visited > 20_000) return { files: files.sort(), truncated: true };
      if (!ctx.fs.contains(root, entry.target)) continue;
      const path = prefix + entry.name;
      if (entry.type === 'file') files.push(path);
      if (entry.type !== 'directory' || entry.name === '.git' || TREE_CACHE_DIRS.includes(entry.name) || seen.has(entry.target.targetKey)) continue;
      seen.add(entry.target.targetKey);
      pending.push({ target: entry.target, prefix: path + '/' });
    }
  }
  return { files: files.sort() };
}

/**
 * Create authenticated route handlers using the plugin's workspace and Git validation.
 * @param dependencies - Shared Git runner, registered-workspace/path validators, and JSON response writer.
 * @returns Tree, source/image, save and definition handlers, plus disposal of workspace-scoped library references.
 */
export function navigationHandlers({ runGit, requireWorkspacePath, requireRelativePath, json, languageServers, imagePreviewMaxBytes, navigationMaxLibrarySources }) {
  const libraries = new Map(); let disposed = false;
  const readSource = async (ctx, cwd, path, signal) => {
    if (!path?.startsWith(LIBRARY_PREFIX)) return readWorkspaceSource(ctx, cwd, requireRelativePath(path), signal);
    const entry = libraries.get(path);
    if (!entry || entry.cwd !== cwd) throw failure('library reference expired; navigate from project source again', 'LIBRARY_SOURCE_EXPIRED', 410);
    const root = await ctx.fs.resolve(cwd, { signal }), file = await ctx.fs.resolve(entry.displayPath, { signal });
    if (ctx.fs.fileUrl(file) !== entry.uri) throw failure('library target changed; navigate from project source again', 'SOURCE_CHANGED', 409);
    return { ...await readSourceFile(ctx, root, file, signal), external: true, displayPath: entry.displayPath };
  };
  const libraryTarget = async (ctx, cwd, rootUrl, url, signal) => {
    if (url.protocol !== 'file:' || url.protocol !== rootUrl.protocol || url.host !== rootUrl.host || url.search || url.hash || !LIBRARY_SOURCE.test(url.pathname)) return null;
    const decoded = url.pathname.split('/').map(decodeURIComponent).join('/');
    const path = url.host ? '//' + url.host + decoded : /^\/[a-z]:\//i.test(decoded) ? decoded.slice(1) : decoded;
    if (/[\u0000-\u001f\u007f]/.test(path)) return null;
    const file = await ctx.fs.resolve(path, { signal });
    const stat = await ctx.fs.stat(file, signal);
    if (stat?.type !== 'file' || stat.size > MAX_SOURCE_BYTES) return null;
    const uri = ctx.fs.fileUrl(file), displayPath = file.displayPath;
    const previous = [...libraries].find(([, entry]) => entry.cwd === cwd && entry.uri === uri);
    if (previous) { libraries.delete(previous[0]); libraries.set(...previous); return { path: previous[0], external: true, displayPath }; }
    signal.throwIfAborted();
    if (disposed) throw failure('navigation is disposed', 'NAVIGATION_UNAVAILABLE', 503);
    const key = LIBRARY_PREFIX + randomUUID() + '/' + displayPath.split(/[\\/]/).at(-1);
    if (libraries.size >= navigationMaxLibrarySources) libraries.delete(libraries.keys().next().value);
    libraries.set(key, { cwd, displayPath, uri });
    return { path: key, external: true, displayPath };
  };
  const readQuery = async (ctx, request, signal) => {
    const query = new URL(request.url).searchParams;
    const cwd = query.get('cwd') ?? '';
    await requireWorkspacePath(ctx, cwd, signal);
    return { query, cwd };
  };
  return {
    dispose: () => { disposed = true; libraries.clear(); },
    tree: async (ctx, request, signal) => {
      const { cwd, query } = await readQuery(ctx, request, signal);
      const probe = await runGit(ctx, cwd, ['rev-parse', '--is-inside-work-tree', '--show-prefix'], { allowed: [0, 128], signal });
      if (!probe.stdout.startsWith('true\n') && !probe.stdout.startsWith('true\r\n')) return json(await listPlainWorkspace(ctx, cwd, signal));
      const result = await runGit(ctx, cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '-z'], { signal });
      const includeIgnored = query.get('includeIgnored') === '1';
      const ignoredDsh = await runGit(ctx, cwd, ['ls-files', '--others', '--ignored', '--exclude-standard', '--full-name', '-z', '--', ...(includeIgnored ? ['.', ...TREE_CACHE_DIRS.map(name => ':(exclude,glob)**/' + name + '/**')] : ['.dsh/'])], { signal });
      const prefix = probe.stdout.replace(/^true\r?\n/, '').replace(/\r?\n$/, '');
      const files = [...new Set([result, ignoredDsh].flatMap(({ stdout }) => stdout.split('\0'))
        .filter(path => path && path.startsWith(prefix)).map(path => path.slice(prefix.length)))].sort();
      return json({ files });
    },
    source: async (ctx, request, signal) => {
      const { query, cwd } = await readQuery(ctx, request, signal);
      const path = query.get('path');
      if (path?.startsWith(LIBRARY_PREFIX)) {
        const source = await readSource(ctx, cwd, path, signal);
        return json({ path, text: source.text, version: source.version, external: true, displayPath: source.displayPath });
      }
      requireRelativePath(path);
      if (imageMime(path)) return json(await readImagePreview(ctx, cwd, path, signal, imagePreviewMaxBytes));
      const source = await readWorkspaceSource(ctx, cwd, path, signal);
      return json({ path, text: source.text, version: source.version, writeVersion: editablePath(path, source.file) ? source.writeVersion : undefined });
    },
    save: async (ctx, request, signal) => {
      const { cwd, query } = await readQuery(ctx, request, signal);
      const path = requireRelativePath(query.get('path'));
      let payload;
      try { payload = await request.json(); } catch { throw failure('invalid save payload', 'INVALID_SAVE_PAYLOAD'); }
      if (typeof payload?.text !== 'string' || typeof payload.writeVersion !== 'string' || !payload.writeVersion || typeof payload.version !== 'string' || payload.text.includes('\0') || !payload.text.isWellFormed()) {
        throw failure('invalid save payload', 'INVALID_SAVE_PAYLOAD');
      }
      if (Buffer.byteLength(payload.text) > MAX_SOURCE_BYTES) throw failure('source exceeds 512 KiB', 'SOURCE_TOO_LARGE', 413);
      let source;
      try { source = await readWorkspaceSource(ctx, cwd, path, signal); }
      catch (error) {
        if (error.status === 404 || error.status === 413 || error.status === 415) throw failure('file changed on disk', 'SOURCE_SAVE_CONFLICT', 409);
        throw error;
      }
      if (!editablePath(path, source.file)) throw failure('file cannot be edited', 'SOURCE_NOT_EDITABLE', 403);
      if (source.writeVersion !== payload.writeVersion || source.version !== payload.version) throw failure('file changed on disk', 'SOURCE_SAVE_CONFLICT', 409);
      try {
        const saved = await ctx.fs.writeText(source.file, payload.text, { kind: 'replaceIfVersion', version: source.writeVersion }, signal);
        return json({ version: versionOf(payload.text), writeVersion: saved.version });
      } catch (error) {
        if (error.code === 'FS_STALE_VERSION') throw failure('file changed on disk', 'SOURCE_SAVE_CONFLICT', 409);
        throw error;
      }
    },
    definition: async (ctx, request, signal) => {
      const { query, cwd } = await readQuery(ctx, request, signal);
      const path = query.get('path');
      const kind = query.get('kind');
      if (kind !== null && kind !== 'type') throw failure('invalid definition kind', 'INVALID_DEFINITION_KIND');
      const typeDefinition = kind === 'type';
      const source = await readSource(ctx, cwd, path, signal);
      if (query.get('version') !== source.version) throw failure('source changed; reopen it before navigating', 'SOURCE_CHANGED', 409);
      const lineText = query.get('line'), characterText = query.get('character');
      if (!/^\d+$/.test(lineText ?? '') || !/^\d+$/.test(characterText ?? '')) throw failure('invalid source position', 'INVALID_POSITION');
      const line = Number(lineText), character = Number(characterText);
      const lines = source.text.split('\n');
      if (!Number.isSafeInteger(line) || !Number.isSafeInteger(character) || line >= lines.length || character >= lines[line].length) throw failure('source position is outside the file', 'INVALID_POSITION');
      const lsp = ctx.get('lsp');
      let locations;
      let engine = 'lsp';
      if (lsp && !typeDefinition) {
        try {
          const result = await lsp.query({ operation: 'goToDefinition', filePath: source.external ? source.displayPath : path, position: { line, character }, workspaceRoot: cwd }, signal);
          if (result.kind !== 'locations') throw failure('unexpected language-service response', 'NAVIGATION_FAILED', 502);
          locations = result.locations;
        } catch (error) {
          if (error.code !== 'LSP_UNAVAILABLE') throw error;
        }
      }
      if (locations === undefined) {
        const sourcePath = source.external ? source.displayPath : path, language = serverLanguage(sourcePath);
        if (!language && !TYPESCRIPT_EXT.test(sourcePath)) throw failure('no language service is configured for this file', 'NAVIGATION_UNAVAILABLE', 503);
        const mappedRoot = ctx.fs.processPathFromHostPath?.(cwd);
        if (!mappedRoot || await realpath(mappedRoot) !== ctx.fs.processPath(source.root)) throw failure('built-in navigation requires a local filesystem; configure an LSP provider for this workspace', 'NAVIGATION_UNAVAILABLE', 503);
        if (language) {
          engine = language;
          locations = await languageServers.query(language, source, { line, character }, signal, typeDefinition);
          if (typeDefinition && language === 'python') locations = pythonReceiverType(locations, ctx.fs.fileUrl(source.file), lines, line, character);
        } else {
          engine = 'typescript';
          locations = await typescriptDefinitions({ root: ctx.fs.processPath(source.root), file: ctx.fs.processPath(source.file), text: source.text, line, character, typeDefinition }, signal);
        }
      }
      const rootUrl = new URL(ctx.fs.fileUrl(source.root));
      const prefix = rootUrl.pathname.replace(/\/$/, '') + '/';
      const targets = [];
      let external = 0;
      for (const location of locations) {
        const url = new URL(location.uri);
        if (url.protocol !== rootUrl.protocol || url.host !== rootUrl.host || !url.pathname.startsWith(prefix)) {
          if (targets.filter(item => item.external).length >= navigationMaxLibrarySources) { external++; continue; }
          const library = await libraryTarget(ctx, cwd, rootUrl, url, signal);
          if (library) {
            const entry = { ...library, line: location.range.start.line, character: location.range.start.character };
            if (!targets.some(item => item.path === entry.path && item.line === entry.line && item.character === entry.character)) targets.push(entry);
          } else external++;
          continue;
        }
        const relative = requireRelativePath(url.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/'));
        const target = await ctx.fs.resolve(relative, { cwd, signal });
        if (!ctx.fs.contains(source.root, target)) { external++; continue; }
        const entry = { path: relative, line: location.range.start.line, character: location.range.start.character };
        if (!targets.some(item => item.path === entry.path && item.line === entry.line && item.character === entry.character)) targets.push(entry);
      }
      signal.throwIfAborted();
      // The source can change while the language service is working; stale positions must not open a target.
      const fresh = source.external ? await readSourceFile(ctx, source.root, await ctx.fs.resolve(source.displayPath, { signal }), signal) : await readSource(ctx, cwd, path, signal);
      if (fresh.version !== source.version || ctx.fs.fileUrl(fresh.file) !== ctx.fs.fileUrl(source.file)) throw failure('source changed; reopen it before navigating', 'SOURCE_CHANGED', 409);
      return json({ targets, external, engine });
    },
  };
}
