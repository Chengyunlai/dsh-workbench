import { navigationHandlers } from './navigation.js';
import { Config, installedServers, installedDebugAdapters, serverSpecifications } from './language-config.js';
import { createLanguageServers } from './language-servers.js';
import { createDebugService } from './debug-service.js';
export { Config } from './language-config.js';

/**
 * DSH Workbench — Host routes for project reading, Git inspection and debugging.
 *
 * Runs git in a registered Harness workspace and serves the results to the
 * browser panel through authenticated `/api/git.*` fetch routes (inside
 * Connection's browser-trust fence). Git is pure read-only: status, per-file
 * diffs, history, and one-commit details. No git write operations are exposed
 * at all. Debug routes own explicit launch/attach sessions separately.
 * The chat bridge route (`/api/git.review`) posts a review
 * suggestion into a fresh workspace conversation through the same
 * `sessionController.prompt` RPC the chat input itself uses — it never touches
 * git and returns the newly created session id.
 */

/** Git selectors inherited from the environment are cleared so a command runs against `cwd` only. */
const GIT_ENV = Object.fromEntries([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE',
  'GIT_ATTR_SOURCE',
].map((key) => [key, undefined]));

const GIT_COMMAND = 'git';
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 30_000;
/** Cap the change rows shipped to the panel so a huge worktree stays responsive. */
const MAX_CHANGES = 500;
/** Cap the review-suggestion body sent to the conversation. */
const MAX_REVIEW_TEXT = 8192;

export const inject = ['connection', 'subprocess', 'workspaceRegistry', 'fs', 'sessionController'];

/** One bounded git run: resolve the executable, spawn, collect, and enforce exit codes. */
async function runGit(ctx, cwd, args, { allowed = [0], maxBytes = MAX_OUTPUT_BYTES, signal } = {}) {
  const executable = await ctx.subprocess.resolveExecutable(GIT_COMMAND, undefined, signal);
  const child = ctx.subprocess.spawn({
    argv: [executable, ...args],
    cwd,
    env: { ...GIT_ENV, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C.UTF-8' },
    signal,
    graceMs: 3000,
    stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes } },
  });
  try {
    const outcome = await child.done;
    signal?.throwIfAborted();
    const stdout = child.collected.stdout.readFrom(0);
    const stderr = child.collected.stderr.readFrom(0);
    if (stdout.lossy || stderr.lossy) throw new Error(`git output exceeds ${maxBytes} bytes`);
    const exitCode = outcome.exitCode ?? -1;
    if (!allowed.includes(exitCode)) {
      const message = stderr.text.trim() || `git ${args[0]} failed`;
      throw Object.assign(new Error(message), { exitCode });
    }
    return { stdout: stdout.text, stderr: stderr.text, exitCode };
  } finally {
    child.terminate();
    await child.waitForExit();
  }
}

/** A repo-relative file path from the panel: no absolute paths, no dot segments, no option-looking tokens. */
function requireRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw Object.assign(new Error('invalid file path'), { status: 400 });
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) throw Object.assign(new Error('file path must not contain control characters'), { status: 400 });
  if (value.startsWith('-')) throw Object.assign(new Error('file path must not start with "-"'), { status: 400 });
  if (value.includes('\\') || value.includes(':')) {
    throw Object.assign(new Error('file path must use forward slashes'), { status: 400 });
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw Object.assign(new Error('file path must not contain empty or dot segments'), { status: 400 });
  }
  return value;
}

/** A commit hash (full or abbreviated, hex only) from the panel. */
function requireCommitHash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{4,64}$/i.test(value)) {
    throw Object.assign(new Error('invalid commit hash'), { status: 400 });
  }
  return value;
}

/** The panel may only run git inside directories the user registered as workspaces. */
async function requireWorkspacePath(ctx, cwd, signal) {
  if (typeof cwd !== 'string' || cwd.length === 0 || cwd.length > 4096) {
    throw Object.assign(new Error('missing workspace path'), { status: 400 });
  }
  for (const workspace of await ctx.workspaceRegistry.list()) {
    if (workspace.path === cwd) return workspace;
  }
  throw Object.assign(new Error('path is not a registered workspace'), { status: 403 });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function queryOf(request) {
  return new URL(request.url).searchParams;
}

/** Detect whether a string is likely binary (NUL byte in the first 8 KiB). */
function looksBinary(text) {
  return text.includes('\0');
}

/** Run `git status --porcelain=v2 -z --branch` and fold the headers and entries into a panel model. */
async function readStatus(ctx, cwd, signal) {
  const status = await runGit(ctx, cwd, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], {
    allowed: [0, 1],
    signal,
  });
  const tokens = status.stdout.split('\0');
  let oid = '';
  let branch = '';
  let upstream = '';
  let ahead = 0;
  let behind = 0;
  const changes = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '') continue;
    if (token.startsWith('#')) {
      if (token.startsWith('# branch.oid ')) oid = token.slice('# branch.oid '.length);
      else if (token.startsWith('# branch.head ')) branch = token.slice('# branch.head '.length);
      else if (token.startsWith('# branch.upstream ')) upstream = token.slice('# branch.upstream '.length);
      else if (token.startsWith('# branch.ab ')) {
        const match = /^\+(\d+) -(\d+)$/.exec(token.slice('# branch.ab '.length));
        if (match) {
          ahead = Number(match[1]);
          behind = Number(match[2]);
        }
      }
      continue;
    }
    if (token === '?' || token.startsWith('? ')) {
      const path = token.slice(2);
      changes.push({ path, displayPath: path, x: '?', y: '?', staged: false, untracked: true, ignored: false });
      continue;
    }
    if (token === '!' || token.startsWith('! ')) {
      const path = token.slice(2);
      changes.push({ path, displayPath: path, x: '!', y: '!', staged: false, untracked: false, ignored: true });
      continue;
    }
    const parts = token.split(' ');
    const kind = parts[0];
    const xy = parts[1] ?? '';
    if (kind === '1') {
      const path = parts.slice(8).join(' ');
      changes.push(changeEntry(xy, path, path));
    } else if (kind === '2') {
      const path = parts.slice(9).join(' ');
      const original = tokens[++index] ?? '';
      changes.push(changeEntry(xy, path, `${original} -> ${path}`));
    }
  }
  return { oid, branch, upstream, ahead, behind, changes };
}

function changeEntry(xy, path, displayPath) {
  const x = xy[0] ?? ' ';
  const y = xy[1] ?? ' ';
  return {
    path,
    displayPath,
    x,
    y,
    staged: 'MADRCU'.includes(x),
    untracked: x === '?',
    ignored: x === '!',
  };
}

/** Porcelain entry letters the panel shows next to each file. */
function entryLetter(entry) {
  if (entry.untracked) return '?';
  if (entry.ignored) return '!';
  return entry.staged ? entry.x : entry.y;
}

/** Decode a porcelain letter into a stable i18n key. */
function letterKey(letter) {
  switch (letter) {
    case 'A': return 'status.a';
    case 'M': return 'status.m';
    case 'D': return 'status.d';
    case 'R': return 'status.r';
    case 'C': return 'status.c';
    case 'U': return 'status.u';
    case '?': return 'status.untracked';
    case '!': return 'status.ignored';
    default: return 'status.m';
  }
}

/** Parse `git diff --numstat` output into a path -> {ins, del} map. */
function parseNumstat(stdout) {
  const map = {};
  for (const line of stdout.split('\n')) {
    const match = /^(\d+)\t(\d+)\t(.+)$/.exec(line);
    if (!match) continue;
    let path = match[3];
    const arrow = path.indexOf(' => ');
    if (arrow !== -1) path = path.slice(arrow + 4);
    if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
      try { path = JSON.parse(path); } catch { path = path.slice(1, -1); }
    }
    map[path] = { ins: Number(match[1]), del: Number(match[2]) };
  }
  return map;
}

async function handleStatus(ctx, request, signal) {
  const cwd = queryOf(request).get('cwd') ?? '';
  await requireWorkspacePath(ctx, cwd, signal);
  const root = (await runGit(ctx, cwd, ['rev-parse', '--show-toplevel'], { allowed: [0, 128], signal })).stdout.replace(/\r?\n$/, '');
  if (root === '') return json({ isRepo: false });
  const status = await readStatus(ctx, cwd, signal);
  // per-file line statistics (staged and unstaged separately, then merged)
  let stats = {};
  for (const args of [['diff', '--cached', '--numstat'], ['diff', '--numstat']]) {
    try {
      const result = await runGit(ctx, cwd, args, { allowed: [0, 1], signal });
      const parsed = parseNumstat(result.stdout);
      for (const [path, value] of Object.entries(parsed)) {
        stats[path] = { ins: (stats[path]?.ins ?? 0) + value.ins, del: (stats[path]?.del ?? 0) + value.del };
      }
    } catch {
      /* numstat is best-effort */
    }
  }
  const changes = status.changes
    .filter((entry) => !entry.ignored)
    .map((entry) => ({
      path: entry.path,
      displayPath: entry.displayPath,
      letter: entryLetter(entry),
      key: letterKey(entryLetter(entry)),
      staged: entry.staged,
      untracked: entry.untracked,
      unstagedToo: entry.staged && 'MDU'.includes(entry.y),
      ins: stats[entry.path]?.ins ?? 0,
      del: stats[entry.path]?.del ?? 0,
    }));
  const shown = Math.min(changes.length, MAX_CHANGES);
  return json({
    isRepo: true,
    root,
    branch: status.branch === 'HEAD' ? null : status.branch,
    detached: status.branch === 'HEAD',
    head: status.oid === '' ? null : status.oid.slice(0, 7),
    ahead: status.ahead,
    behind: status.behind,
    upstream: status.upstream,
    total: changes.length,
    shown,
    changes: changes.slice(0, shown),
  });
}

async function handleDiff(ctx, request, signal) {
  const query = queryOf(request);
  const cwd = query.get('cwd') ?? '';
  const path = requireRelativePath(query.get('path') ?? '');
  const staged = query.get('staged') === '1';
  const both = query.get('both') === '1';
  const untracked = query.get('untracked') === '1';
  await requireWorkspacePath(ctx, cwd, signal);
  if (untracked) {
    const target = await ctx.fs.resolve(path, { cwd, signal });
    const text = await ctx.fs.readText(target, signal);
    return json(looksBinary(text) ? { binary: true } : { untracked: true, text });
  }
  const texts = [];
  if (staged || both) {
    const stagedResult = await runGit(ctx, cwd, ['diff', '--cached', '--', path], { allowed: [0, 1], signal });
    if (stagedResult.stdout !== '') texts.push(stagedResult.stdout);
  }
  if (!staged || both) {
    const worktreeResult = await runGit(ctx, cwd, ['diff', '--', path], { allowed: [0, 1], signal });
    if (worktreeResult.stdout !== '') texts.push(worktreeResult.stdout);
  }
  const text = texts.join('\n');
  return json(looksBinary(text) ? { binary: true } : { text });
}

async function handleLog(ctx, request, signal) {
  const query = queryOf(request);
  const cwd = query.get('cwd') ?? '';
  const limit = Math.min(Math.max(Number(query.get('limit') ?? 60) || 60, 1), 200);
  await requireWorkspacePath(ctx, cwd, signal);
  const result = await runGit(ctx, cwd, ['log', `-n ${limit}`, '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P'], {
    allowed: [0, 128],
    signal,
  });
  const commits = [];
  for (const line of result.stdout.split('\n')) {
    if (line === '') continue;
    const fields = line.split('\x1f');
    commits.push({
      hash: fields[0] ?? '',
      short: fields[1] ?? '',
      author: fields[2] ?? '',
      email: fields[3] ?? '',
      date: fields[4] ?? '',
      subject: fields[5] ?? '',
      parents: (fields[6] ?? '').split(' ').filter(Boolean),
    });
  }
  return json({ commits });
}

/** One commit's metadata, changed-file stats, and full diff. */
async function handleCommit(ctx, request, signal) {
  const query = queryOf(request);
  const cwd = query.get('cwd') ?? '';
  const hash = requireCommitHash(query.get('hash') ?? '');
  await requireWorkspacePath(ctx, cwd, signal);
  const meta = await runGit(ctx, cwd, ['log', '-1', '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P', hash], {
    allowed: [0, 128],
    signal,
  });
  if (meta.stdout === '') return json({ found: false });
  const fields = meta.stdout.split('\x1f');
  // `--numstat` replaces the patch, so stats and the diff text need two runs.
  const statsOut = await runGit(ctx, cwd, ['show', '--no-ext-diff', '--numstat', '--format=', hash], {
    allowed: [0, 128],
    signal,
  });
  const files = [];
  for (const line of statsOut.stdout.split('\n')) {
    const match = /^(\d+)\t(\d+)\t(.+)$/.exec(line);
    if (!match) continue;
    let path = match[3];
    const arrow = path.indexOf(' => ');
    if (arrow !== -1) path = path.slice(arrow + 4);
    if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
      try { path = JSON.parse(path); } catch { path = path.slice(1, -1); }
    }
    files.push({ path, ins: Number(match[1]), del: Number(match[2]) });
  }
  const parents = (fields[6] ?? '').split(' ').filter(Boolean);
  // Patch: for a root commit use `git show`; otherwise diff against the first
  // parent (merge commits do not emit a usable combined patch by default).
  const patchOut = parents.length > 0
    ? await runGit(ctx, cwd, ['diff', `${hash}^..${hash}`], { allowed: [0, 128], signal })
    : await runGit(ctx, cwd, ['show', '--no-ext-diff', '--format=', hash], { allowed: [0, 128], signal });
  return json({
    found: true,
    hash: fields[0] ?? '',
    short: fields[1] ?? '',
    author: fields[2] ?? '',
    email: fields[3] ?? '',
    date: fields[4] ?? '',
    subject: fields[5] ?? '',
    parents,
    files,
    diff: patchOut.stdout,
  });
}

/** A session id taken from the browser panel; must be a plain identifier. */
function requireSessionId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw Object.assign(new Error('invalid session id'), { status: 400 });
  }
  return value;
}

/** The review-suggestion body; bounded so one message stays sane. */
function requireReviewText(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_REVIEW_TEXT) {
    throw Object.assign(new Error('invalid review text'), { status: 400 });
  }
  return value;
}

/**
 * Bridge one review suggestion into a NEW project conversation. A fresh
 * Session is created bound to the workspace the panel is showing (so the
 * review never pollutes the user's existing chat), then the message is
 * admitted through the same `sessionController.prompt` RPC the chat input
 * uses (`mode: 'queue'` queues while the agent is running). Git is never
 * touched; the created Session is returned so the panel can open it.
 */
async function handleReview(ctx, request, signal) {
  const payload = await request.json();
  const cwd = typeof payload?.cwd === 'string' ? payload.cwd : '';
  const text = requireReviewText(payload?.text ?? '');
  const workspace = await requireWorkspacePath(ctx, cwd, signal);
  signal.throwIfAborted();
  const created = await ctx.sessionController.create({ workspaceId: workspace.id, sessionId: `session-${crypto.randomUUID()}` });
  const sessionId = requireSessionId(created?.sessionId ?? '');
  try {
    const result = await ctx.sessionController.prompt({
      requestId: crypto.randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }, signal);
    return json({ ok: result.accepted === true, sessionId, created: true });
  } catch (error) {
    // Creation is durable even if prompt admission fails or its outcome is unknown.
    return json({ ok: false, sessionId, created: true, phase: 'prompt' });
  }
}

/** Register the read-only git routes plus the chat bridge inside Connection's authentication fence. */
function registerRoutes(ctx, config, languageServers) {
  const debug = createDebugService(ctx, config, requireWorkspacePath, json);
  ctx.effect(() => () => debug.dispose(), 'git-control: debug sessions');
  const lifetime = new AbortController();
  const pending = new Set();
  ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([...pending]); }, 'git-control: query lifetime');
  const run = (ctx, request, handler) => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), new URL(request.url).pathname === '/api/git.definition' ? config.navigationTimeoutMs : QUERY_TIMEOUT_MS);
    const signal = AbortSignal.any([request.signal, lifetime.signal, timeout.signal]);
    const task = Promise.resolve()
      .then(() => { signal.throwIfAborted(); return handler(ctx, request, signal); })
      .catch((error) => {
        if (timeout.signal.aborted) return json({ ok: false, code: new URL(request.url).pathname === '/api/git.definition' ? 'LANGUAGE_SERVER_TIMEOUT' : 'QUERY_TIMEOUT', error: 'query timed out' }, 408);
        if (request.signal.aborted || lifetime.signal.aborted || timeout.signal.aborted) {
          return json({ ok: false, error: 'query cancelled' }, 408);
        }
        const status = typeof error?.status === 'number' ? error.status : 500;
        return json({ ok: false, code: error?.code, error: error instanceof Error ? error.message : String(error) }, status);
      })
      .finally(() => { clearTimeout(timer); pending.delete(task); });
    pending.add(task);
    return task;
  };
  const route = (path, methods, handler) => {
    ctx.connection.fetch.register({
      path,
      methods,
      requestBody: 'buffered',
      fetch: (request) => run(ctx, request, handler),
    });
  };
  route('/api/git.status', ['GET'], handleStatus);
  route('/api/git.diff', ['GET'], handleDiff);
  route('/api/git.log', ['GET'], handleLog);
  route('/api/git.commit', ['GET'], handleCommit);
  const navigation = navigationHandlers({ runGit, requireWorkspacePath, requireRelativePath, json, languageServers, imagePreviewMaxBytes: config.imagePreviewMaxBytes });
  route('/api/git.tree', ['GET'], navigation.tree);
  route('/api/git.source', ['GET'], navigation.source);
  route('/api/git.definition', ['GET'], navigation.definition);
  route('/api/git.review', ['POST'], handleReview);
  route('/api/git.debug.configurations', ['GET'], (ctx, request) => debug.configurations(request));
  route('/api/git.debug.status', ['GET'], (ctx, request) => debug.status(request));
  route('/api/git.debug.action', ['POST'], (ctx, request) => debug.action(request));
}

export function apply(ctx, options = {}) {
  const config = Config(options);
  config.debugAdapters = { ...(config.useInstalledDebugAdapters ? installedDebugAdapters() : {}), ...config.debugAdapters };
  const servers = createLanguageServers(ctx, serverSpecifications({ ...(config.useInstalledServers ? installedServers() : {}), ...config.languageServers }), config);
  ctx.effect(() => () => servers.dispose(), 'git-control: language servers');
  registerRoutes(ctx, config, servers);
}
