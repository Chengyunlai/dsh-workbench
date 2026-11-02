/** Workspace-owned DAP sessions. Launch owns the debuggee; attach only owns the adapter. */
import { connect } from 'node:net';
import { realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { dapPeer } from './debug-dap.js';
import { readWorkspaceSource } from './navigation.js';
import { currentFileTarget, attachTarget } from './debug-targets.js';
const fail = (message, status = 400, code = 'DEBUG_FAILED') => Object.assign(new Error(message), { status, code });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

/**
 * Register project configuration and session actions behind the plugin's authenticated routes.
 * @param ctx - Scoped host with filesystem and managed subprocess services.
 * @param config - Validated plugin adapter commands and timeouts.
 * @param validateWorkspace - Registered workspace validator.
 * @param json - Response encoder.
 * @returns Read/write route handlers and an awaited disposer.
 */
export function createDebugService(ctx, config, validateWorkspace, json) {
  for (const language of Object.keys(config.debugAdapters)) if (!['python', 'go', 'javascript'].includes(language)) throw fail('unsupported debug adapter: ' + language);
  const sessions = new Map(), starting = new Map(); let disposed = false;
  const validatePoints = async (cwd, points) => {
    if (!points || typeof points !== 'object' || Array.isArray(points) || Object.keys(points).length > 100) throw fail('invalid breakpoints');
    for (const [path, lines] of Object.entries(points)) {
      if (isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.')) throw fail('breakpoint paths must be workspace-relative');
      if (!Array.isArray(lines) || lines.length > 1000) throw fail('invalid breakpoint lines');
      const source = await readWorkspaceSource(ctx, cwd, path);
      if (!lines.every(line => Number.isSafeInteger(line) && line > 0 && line <= source.text.split('\n').length)) throw fail('invalid breakpoint line');
    }
    return points;
  };
  const local = async cwd => {
    await validateWorkspace(ctx, cwd);
    const root = await ctx.fs.resolve(cwd);
    const mapped = ctx.fs.processPathFromHostPath?.(cwd);
    if (!mapped || await realpath(mapped) !== ctx.fs.processPath(root)) throw fail('debugging requires a local workspace', 503);
    return root;
  };
  const configurations = async cwd => {
    await local(cwd);
    const file = await ctx.fs.resolve('.dsh/debug.json', { cwd });
    const root = await ctx.fs.resolve(cwd);
    if (!ctx.fs.contains(root, file)) throw fail('debug configuration is outside the workspace');
    if (!await ctx.fs.stat(file)) return [];
    const source = await readWorkspaceSource(ctx, cwd, '.dsh/debug.json');
    const parsed = ts.parseConfigFileTextToJson('.dsh/debug.json', source.text);
    if (parsed.error) throw fail(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
    const rows = parsed.config?.configurations;
    if (!Array.isArray(rows) || rows.length > 50) throw fail('debug.json requires a configurations array (at most 50 entries)');
    const names = new Set();
    return rows.map(row => {
      if (!row || typeof row.name !== 'string' || !row.name.trim() || names.has(row.name) || !['python', 'go', 'javascript', 'typescript'].includes(row.language) || !['launch', 'attach'].includes(row.request) || typeof row.arguments !== 'object' || row.arguments === null || Array.isArray(row.arguments)) throw fail('invalid or duplicate debug configuration');
      names.add(row.name); return row;
    });
  };
  // Frame selections expire across pauses, independently of output-driven revisions.
  const snapshot = session => ({ id: session.id, name: session.name, request: session.mode, state: session.state, error: session.error,
    breakpoints: session.breakpointResults, frames: session.frames, scopes: session.scopes, output: session.output, revision: session.revision, pauseId: session.stopEpoch ?? 0 });
  const changed = session => { session.revision++; };
  async function close(session) {
    session.closeTask ??= (async () => {
      session.closing = true;
      try {
        if (session.state !== 'ended') {
          const results = await Promise.allSettled(session.peers.map(peer => peer.request('disconnect', { terminateDebuggee: session.mode === 'launch' })));
          const rejected = results.find(result => result.status === 'rejected');
          if (rejected) session.error = rejected.reason.message;
        }
      }
      finally {
        for (const peer of session.peers) peer.dispose();
        for (const socket of session.sockets) socket.destroy();
        if (session.child) {
          let exited = false, timer;
          try {
            await Promise.race([
              session.child.waitForExit().then(() => { exited = true; }),
              new Promise(resolve => { timer = setTimeout(resolve, config.serverKillGraceMs); }),
            ]);
          } finally { clearTimeout(timer); }
          if (!exited) session.child.terminate();
          await session.child.waitForExit();
        }
        session.state = 'ended'; session.frames = []; session.scopes = []; changed(session);
      }
    })();
    return session.closeTask;
  }
  function expand(value, cwd) {
    if (typeof value === 'string') {
      if (/\$\{(?!workspaceFolder\})/.test(value)) throw fail('only ${workspaceFolder} substitutions are supported');
      return value.replaceAll('${workspaceFolder}', cwd);
    }
    if (Array.isArray(value)) return value.map(item => expand(item, cwd));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, cwd)]));
    return value;
  }
  async function configurePeer(session, input, output, args, request) {
    if (session.closeTask || disposed) throw fail('debug session has ended', 409);
    const initialized = deferred();
    let peer;
    peer = dapPeer(input, output, (event, body) => {
      if (session.closing) return;
      if (event === 'initialized') initialized.resolve();
      if (event === 'output' && body.category !== 'telemetry') { session.output = (session.output + String(body.output ?? '')).slice(-config.debugOutputChars); changed(session); }
      if (event === 'stopped') {
        const epoch = session.stopEpoch = (session.stopEpoch ?? 0) + 1;
        session.activePeer = peer; session.threadId = body.threadId; session.state = 'paused'; changed(session);
        session.refresh = session.refresh.then(async () => {
          if (session.state !== 'paused' || session.stopEpoch !== epoch) return;
          if (!Number.isSafeInteger(session.threadId)) session.threadId = (await peer.request('threads')).threads?.[0]?.id;
          const stack = await peer.request('stackTrace', { threadId: session.threadId, startFrame: 0, levels: 100 });
          const frames = (stack.stackFrames ?? []).map(frame => {
            const path = frame.source?.path && relative(session.processRoot, frame.source.path);
            return { id: frame.id, name: frame.name, line: frame.line, column: frame.column,
              path: path && !isAbsolute(path) && path !== '..' && !path.startsWith('../') ? path : null };
          });
          const scopes = frames[0] ? (await peer.request('scopes', { frameId: frames[0].id })).scopes ?? [] : [];
          if (session.state !== 'paused' || session.stopEpoch !== epoch) return;
          session.frames = frames; session.scopes = scopes; changed(session);
        }).catch(error => { session.error = error.message; changed(session); });
      }
      if (event === 'continued' && (!session.activePeer || session.activePeer === peer)) { session.stopEpoch = (session.stopEpoch ?? 0) + 1; session.state = 'running'; session.frames = []; session.scopes = []; changed(session); }
      if (event === 'terminated' && (session.activePeer === peer || session.peers[0] === peer)) {
        session.state = 'ended'; session.frames = []; session.scopes = []; changed(session);
        close(session).catch(error => { session.error = error.message; changed(session); });
      }
      if (event === 'breakpoint') { session.breakpointResults = session.breakpointResults.map(item => item.id === body.breakpoint?.id ? { ...item, ...body.breakpoint } : item); changed(session); }
    }, async (command, body) => {
      if (command !== 'startDebugging' || !session.port || !body.configuration) throw fail('unsupported debugger reverse request: ' + command);
      const socket = await socketFor(session);
      const request = body.request ?? body.configuration.request ?? session.mode;
      await configurePeer(session, socket, socket, { ...body.configuration, request }, request);
      return {};
    }, config.debugTimeoutMs, error => {
      if (session.closing || session.state === 'ended') return;
      session.state = 'unknown'; session.frames = []; session.scopes = []; session.error = error.message; changed(session);
    });
    session.peers.push(peer);
    const capabilities = await peer.request('initialize', { clientID: 'dsh-git-control', adapterID: session.language, pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true,
      supportsVariableType: true, supportsStartDebuggingRequest: true, supportsRunInTerminalRequest: false });
    const launched = peer.request(request, args); launched.catch(() => {});
    await Promise.race([initialized.promise, launched.then(() => { throw fail('adapter did not initialize the debug session'); })]);
    await setBreakpoints(session, peer);
    if (capabilities.supportsConfigurationDoneRequest) await peer.request('configurationDone');
    await launched;
    if (session.state === 'starting') session.state = 'running';
    changed(session);
    return peer;
  }
  async function socketFor(session) {
    const socket = connect({ host: '127.0.0.1', port: session.port }); session.sockets.push(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(fail('debug adapter connection timed out')); }, config.debugTimeoutMs);
      socket.once('connect', () => { clearTimeout(timer); resolve(); }); socket.once('error', error => { clearTimeout(timer); reject(error); });
    });
    return socket;
  }
  async function setBreakpoints(session, peer) {
    const results = [];
    for (const path of Object.keys(session.breakpoints)) session.breakpointPaths.add(path);
    for (const path of session.breakpointPaths) {
      const lines = session.breakpoints[path] ?? [];
      const source = await readWorkspaceSource(ctx, session.cwd, path);
      const count = source.text.split('\n').length;
      if (!lines.every(line => Number.isSafeInteger(line) && line > 0 && line <= count)) throw fail('invalid breakpoint line');
      const result = await peer.request('setBreakpoints', { source: { path: ctx.fs.processPath(source.file) }, breakpoints: lines.map(line => ({ line })), sourceModified: false });
      results.push(...(result.breakpoints ?? []).map(item => ({ ...item, path })));
    }
    session.breakpointResults = results; changed(session);
  }
  const startSession = async (cwd, body) => {
    if (disposed) throw fail('debugger is unloaded', 503);
    const root = await local(cwd);
    for (const [id, old] of sessions) if (old.cwd === cwd && old.state === 'ended') { await close(old); sessions.delete(id); }
    if ([...sessions.values()].some(item => item.cwd === cwd && item.state !== 'ended')) throw fail('a debug session is already active in this workspace', 409);
    const target = body.currentFile !== undefined ? await currentFileTarget(ctx, cwd, body.currentFile)
      : body.attach !== undefined ? attachTarget(body.attach)
      : (await configurations(cwd)).find(row => row.name === body.name);
    if (!target) throw fail('debug configuration not found');
    const language = target.language === 'typescript' ? 'javascript' : target.language;
    const adapter = config.debugAdapters[language];
    if (!adapter) throw fail('configure debugAdapters.' + language + ' in plugin settings', 503);
    const command = await ctx.subprocess.resolveExecutable(adapter.command, adapter.env);
    const points = await validatePoints(cwd, body.breakpoints ?? {});
    if (disposed) throw fail('debugger is unloaded', 503);
    const session = { id: randomUUID(), cwd, processRoot: ctx.fs.processPath(root), name: target.name, language, mode: target.request, state: 'starting', peers: [], sockets: [], child: null,
      port: null, activePeer: null, frames: [], scopes: [], breakpoints: points, breakpointPaths: new Set(), breakpointResults: [], output: '', revision: 0, refresh: Promise.resolve() };
    sessions.set(session.id, session);
    try {
      if (target.request === 'attach' && target.arguments.connect && language !== 'javascript') {
        const { host = '127.0.0.1', port } = target.arguments.connect;
        if (!['127.0.0.1', 'localhost'].includes(host) || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw fail('attach requires a loopback debug adapter port');
        session.port = port;
        const socket = await socketFor(session);
        const args = { ...(language === 'python' ? { justMyCode: true } : {}), ...target.arguments }; delete args.connect;
        await configurePeer(session, socket, socket, args, 'attach');
        return snapshot(session);
      }
      session.child = ctx.subprocess.spawn({ argv: [command, ...adapter.args], cwd: ctx.fs.processPath(root), env: adapter.env, graceMs: config.serverKillGraceMs,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 65536 } } });
      session.child.done.then(() => { if (session.state !== 'ended') { session.state = 'ended'; changed(session); } }, error => { session.error = error.message; session.state = 'ended'; changed(session); });
      let input = session.child.stdout, output = session.child.stdin;
      if (adapter.transport === 'tcp') {
        session.port = await new Promise((resolve, reject) => {
          let text = '';
          const timer = setTimeout(() => { input.off('data', data); reject(fail('adapter did not announce a loopback port')); }, config.debugTimeoutMs);
          const data = chunk => { text = (text + chunk).slice(-65536); const match = /(?:127\.0\.0\.1:|port\s+)(\d+)/.exec(text); if (match) { clearTimeout(timer); input.off('data', data); resolve(Number(match[1])); } };
          input.on('data', data); session.child.done.then(() => { clearTimeout(timer); input.off('data', data); reject(fail('debug adapter exited before announcing its port')); }, reject);
        });
        input.resume(); const socket = await socketFor(session); input = output = socket;
      }
      await configurePeer(session, input, output, { ...(language === 'javascript' ? { __workspaceFolder: session.processRoot, pauseForSourceMap: true } : {}), ...(target.language === 'typescript' && target.request === 'launch' ? { stopOnEntry: true } : {}), ...expand(target.arguments, cwd), ...(language === 'python' ? { console: 'internalConsole', subProcess: false } : {}), ...(language === 'javascript' ? { name: target.name, request: target.request, console: 'internalConsole', autoAttachChildProcesses: false } : {}) }, target.request);
      return snapshot(session);
    } catch (error) { session.error = error.message; await close(session); throw error; }
  };
  const start = (cwd, body) => {
    if (starting.has(cwd)) throw fail('a debugger is starting in this workspace', 409);
    const task = startSession(cwd, body); starting.set(cwd, task);
    task.then(() => starting.delete(cwd), () => starting.delete(cwd));
    return task;
  };
  const find = (cwd, id) => { const session = sessions.get(id); if (!session || session.cwd !== cwd) throw fail('debug session not found', 404); return session; };
  return {
    async configurations(request) {
      const query = new URL(request.url).searchParams, cwd = query.get('cwd');
      const rows = await configurations(cwd);
      let launchError;
      if (query.get('path') && !rows.some(row => row.request === 'launch')) {
        try { rows.push(await currentFileTarget(ctx, cwd, query.get('path'))); }
        catch (error) {
          if (!['DEBUG_TARGET_REQUIRED', 'DEBUG_TS_BUILD'].includes(error.code)) throw error;
          launchError = error.code;
        }
      }
      return json({ configurations: rows.map(({ name, language, request, currentFile }) => ({ name, language, request, currentFile })), launchError });
    },
    async status(request) { const query = new URL(request.url).searchParams; const cwd = query.get('cwd'); await local(cwd); const session = query.get('id') ? find(cwd, query.get('id')) : [...sessions.values()].find(item => item.cwd === cwd && item.state !== 'ended'); return json(session ? snapshot(session) : { id: null, state: 'idle' }); },
    async action(request) {
      const body = await request.json(); if (!body || typeof body.cwd !== 'string') throw fail('missing workspace'); await local(body.cwd);
      if (body.action === 'start') return json(await start(body.cwd, body));
      const session = find(body.cwd, body.id);
      const task = (session.actions ?? Promise.resolve()).then(async () => {
      const peer = session.activePeer ?? session.peers[0];
      if (body.action === 'stop') { await close(session); return json(snapshot(session)); }
      if (session.state === 'ended') throw fail('debug session has ended', 409, 'DEBUG_SESSION_ENDED');
      if (body.action === 'breakpoints') {
        if (!body.breakpoints || typeof body.breakpoints !== 'object' || Array.isArray(body.breakpoints)) throw fail('invalid breakpoints');
        session.breakpoints = await validatePoints(session.cwd, body.breakpoints);
        for (const p of session.peers) await setBreakpoints(session, p);
      } else if (['continue', 'next', 'stepIn', 'stepOut', 'pause'].includes(body.action)) {
        if (body.action !== 'pause' && session.state !== 'paused') throw fail('program is not paused', 409);
        if (!Number.isSafeInteger(session.threadId)) session.threadId = (await peer.request('threads')).threads?.[0]?.id;
        if (body.action !== 'pause') { session.stopEpoch = (session.stopEpoch ?? 0) + 1; session.state = 'running'; session.frames = []; session.scopes = []; changed(session); }
        try { await peer.request(body.action, { threadId: session.threadId }); }
        catch (error) { session.state = 'unknown'; session.frames = []; session.scopes = []; session.error = error.message; changed(session); throw error; }
      } else if (body.action === 'scopes') {
        if (session.state !== 'paused' || !session.frames.some(frame => frame.id === body.frameId)) throw fail('stale stack frame', 409);
        return json(await peer.request('scopes', { frameId: body.frameId }));
      } else if (body.action === 'variables') {
        if (session.state !== 'paused' || !Number.isSafeInteger(body.reference) || body.reference <= 0) throw fail('invalid variable reference');
        return json(await peer.request('variables', { variablesReference: body.reference, start: 0, count: 100 }));
      } else throw fail('unsupported debug action');
      return json(snapshot(session));
      });
      session.actions = task.then(() => {}, () => {});
      return task;
    },
    async dispose() { disposed = true; await Promise.all([...sessions.values()].map(close)); await Promise.allSettled([...starting.values()]); await Promise.all([...sessions.values()].map(close)); sessions.clear(); },
  };
}
