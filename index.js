import { createPythonClassGraph } from './python-class-graph.js';
import { navigationHandlers } from './navigation.js';
import { createWorkspaceSearch } from './workspace-search.js';
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
 * The dispatch route (`/api/git.dispatch`) turns one structured panel action
 * (`intent: 'task'` assignment or `intent: 'explain'` explanation request)
 * into a single server-composed message and posts it into a fresh workspace
 * conversation through the same `sessionController.prompt` RPC the chat input
 * itself uses — it never touches git and returns the newly created session id.
 * The memory-card routes (`/api/git.cards`, `/api/git.card`) read the Markdown
 * cards that explanation sessions sediment under the workspace's card
 * directory.
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
/** Cap the dispatch body sent to the conversation. */
const MAX_DISPATCH_TEXT = 8192;
/** Cap the attached code excerpt (lines are joined with newlines before measuring). */
const MAX_DISPATCH_CODE = 65536;
/** Cap one target label (`tag` or `path`) taken from the panel. */
const MAX_TARGET_FIELD = 400;
/** Memory cards: one workspace-relative directory, bounded listing arithmetic. */
const MAX_CARD_FILES = 300;
const MAX_CARD_BYTES = 256 * 1024;
const MAX_CARD_DEPTH = 4;

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
  if (root === '') return json({ isRepo: false, capabilities: { workspaceRefresh: true } });
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
    capabilities: { workspaceRefresh: true },
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
  if (query.has('commit')) {
    const hash = requireCommitHash(query.get('commit'));
    const meta = await runGit(ctx, cwd, ['log', '-1', '--format=%P', hash], { signal });
    const parents = meta.stdout.trim().split(' ').filter(Boolean);
    const args = parents.length > 0
      ? ['diff', '--no-ext-diff', '--no-renames', parents[0], hash, '--', path]
      : ['show', '--no-ext-diff', '--no-renames', '--format=', hash, '--', path];
    const result = await runGit(ctx, cwd, args, { signal });
    return json({ text: result.stdout, binary: /^Binary files .* differ$/m.test(result.stdout) || /^GIT binary patch$/m.test(result.stdout) });
  }
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
  const parents = (fields[6] ?? '').split(' ').filter(Boolean);
  const statsArgs = parents.length > 0
    ? ['diff', '--no-ext-diff', '--no-renames', '--numstat', '-z', parents[0], hash]
    : ['show', '--no-ext-diff', '--no-renames', '--numstat', '-z', '--format=', hash];
  const statsOut = await runGit(ctx, cwd, statsArgs, { signal });
  const files = [];
  for (const record of statsOut.stdout.split('\0')) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
    if (match) files.push({ path: match[3], ins: Number(match[1]) || 0, del: Number(match[2]) || 0, ...(match[1] === '-' ? { binary: true } : {}) });
  }
  // Patch: for a root commit use `git show`; otherwise diff against the first
  // parent (merge commits do not emit a usable combined patch by default).
  const patchOut = query.get('summary') === '1' ? { stdout: '' } : parents.length > 0
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

/** The dispatch body; bounded so one composed message stays sane. */
function requireDispatchText(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_DISPATCH_TEXT) {
    throw Object.assign(new Error('invalid dispatch text'), { status: 400, code: 'INVALID_TEXT' });
  }
  return value;
}

/** The panel action decides which server-side message template is used. */
function requireDispatchIntent(value) {
  if (value !== 'task' && value !== 'explain') {
    throw Object.assign(new Error('invalid dispatch intent'), { status: 400, code: 'INVALID_INTENT' });
  }
  return value;
}

/** Optional code-excerpt lines; joined into one diff fence server-side. */
function optionalCodeLines(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((line) => typeof line !== 'string')) {
    throw Object.assign(new Error('code must be an array of strings'), { status: 400, code: 'INVALID_CODE' });
  }
  if (value.join('\n').length > MAX_DISPATCH_CODE) {
    throw Object.assign(new Error('code excerpt is too large'), { status: 400, code: 'INVALID_CODE' });
  }
  return value;
}

/** Optional `{ tag, path }` provenance label; each field is a bounded plain string. */
function optionalTarget(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('target must be an object'), { status: 400, code: 'INVALID_TARGET' });
  }
  const read = (field) => {
    const raw = value[field];
    if (typeof raw !== 'string' || raw.length > MAX_TARGET_FIELD || /[\u0000-\u001f\u007f]/.test(raw)) {
      throw Object.assign(new Error(`invalid target ${field}`), { status: 400, code: 'INVALID_TARGET' });
    }
    return raw;
  };
  return { tag: read('tag'), path: read('path') };
}

/** One optional diff fence shared by both intents. */
function codeSection(code) {
  return code.length === 0 ? '' : `\n\n\`\`\`diff\n${code.join('\n')}\n\`\`\``;
}

/** One optional provenance footer; wording follows the intent and locale. */
function sourceSection(target, zhLabel, enLabel, locale) {
  if (target === null) return '';
  return locale === 'en'
    ? `\n\n---\n${enLabel}: Workbench · ${target.tag} · ${target.path}`
    : `\n\n---\n${zhLabel}：工作台 · ${target.tag} · ${target.path}`;
}

/** Guide the explanation and give its conversation exactly one card destination. */
function explainRequirements(cardPath, locale) {
  if (locale === 'en') {
    return [
      'Explanation requirements:',
      '1. Answer in English. Address the original question directly, then explain the mechanism. For code, inspect the relevant definitions and callers when available. Trace one concrete input through the important steps to the observable output, explaining what each step changes and why. Use a meaningful boundary case when it helps. Label any example or behavior you have not verified.',
      `2. Save exactly one Markdown card for this conversation at \`${cardPath}\`. Create the parent directory if needed. Keep subtopics in this file and update the same file if a follow-up changes the explanation. Do not create other card files.`,
      '3. Start the card with YAML frontmatter: a question-specific title, tags, kind: concept, and a source field when known. Open the body with a one- or two-sentence recap of what the reader wants to understand. Then preserve the full explanation, worked example, and evidence, using headings that fit the question.',
      '4. After the explanation, add a recall question that revisits the original issue and asks the reader to explain the mechanism in their own words. When useful, change one condition in the same example and ask them to predict the result. Place a short answer and its reasoning in a separate subsection below.',
      '5. Use a workspace-root path starting with `/` (for example `/src/main.py`) or a path relative to the card file for source links. Give the full explanation in the conversation and link the card if saved. If saving fails, still answer and report the failure.',
    ].join('\n');
  }
  return [
    '讲解要求：',
    '1. 用中文先直接回答原问题，再解释机制。遇到代码时，在条件允许时读相关定义和调用处。用一个具体输入串起关键步骤和可观察的输出，解释每一步改变了什么、为什么。必要时用一个边界情况检验理解。标明未经验证的示例或行为。',
    `2. 本会话只保存一张 Markdown 卡片，路径固定为 \`${cardPath}\`。目录缺失时先创建。子问题放在同一文件，追问补充时更新这张卡。不要创建其他卡片文件。`,
    '3. YAML 文件头包含针对问题的 title、tags、kind: concept，来源明确时补充 source。正文开头用一两句话概括读者想弄懂的问题，再给出对话中的完整讲解、演算例子和证据，按问题选用自然的小标题。',
    '4. 讲解结束后用一道回忆题回到原问题，让读者用自己的话复述机制。适合时改变同一例子的一个条件，请读者预测结果。把简短答案和理由放在题目下方的独立小节。',
    '5. 源码链接使用以 `/` 开头的工作区根路径（例如 `/src/main.py`），或相对卡片文件的路径。对话里给出完整讲解，保存成功后附卡片链接。保存失败时仍回答问题并说明失败。',
  ].join('\n');
}

/** Compose the one message a dispatch action is admitted with; the client only sends structured fields. */
function composeDispatchMessage(intent, { text, code, target, locale, cardPath }) {
  const english = locale === 'en';
  if (intent === 'task') {
    return `${text}${codeSection(code)}${sourceSection(target, '任务来源', 'Task source', locale)}`;
  }
  const intro = english
    ? 'I want to understand the following. Please explain it in plain language, with the goal of truly understanding the principles rather than memorizing the conclusions.'
    : '我想弄懂下面的内容。请用深入浅出的方式讲解，目标是真正理解原理，而不是记住结论。';
  const source = sourceSection(target, '来源', 'Source', locale);
  return `${intro}\n\n${text}${codeSection(code)}${source}\n\n${explainRequirements(cardPath, locale)}`;
}

/** Turn one folder or file label into a portable path segment. */
function cardSlug(value, fallback) {
  const cleaned = value.normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  const name = [...cleaned].slice(0, 32).join('') || fallback;
  return /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i.test(name) ? `file-${name}` : name;
}

/** Resolve display grouping from a repository-relative path, excluding commit hashes. */
function cardSourceLocation(path) {
  if (!path || /^[a-f0-9]{4,64}$/i.test(path)) return null;
  let parts;
  try { parts = requireRelativePath(path).split('/'); }
  catch (error) { return null; /* Non-file review targets have no source folder. */ }
  const basename = parts.pop();
  return { basename, folder: parts.slice(-2).map(part => cardSlug(part, 'module')).join('/') || 'root' };
}

/** Keep a readable file name and at most two archive levels within the card scanner's depth. */
function explanationCardPath(cardsDir, target, text, id) {
  const source = cardSourceLocation(target?.path);
  const folder = source?.folder ?? 'general';
  const name = source ? cardSlug(source.basename.replace(/\.[^.]+$/, ''), 'source') : cardSlug(text.trim().split(/\r?\n/, 1)[0], 'question');
  return `${cardPrefix(cardsDir)}${folder}/${name}-${id}.md`;
}

/**
 * Compose and bridge one panel action into a NEW project conversation. A fresh
 * Session is created bound to the workspace the panel is showing (so the action
 * never pollutes the user's existing chat), then the single server-composed
 * message is admitted through the same `sessionController.prompt` RPC the chat
 * input uses (`mode: 'queue'` queues while the agent is running). Git is never
 * touched; the created Session is returned so the panel can open it.
 */
async function handleDispatch(ctx, config, request, signal) {
  let payload;
  try { payload = await request.json(); } catch { payload = null; }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('invalid dispatch payload'), { status: 400, code: 'INVALID_PAYLOAD' });
  }
  const intent = requireDispatchIntent(payload.intent);
  const text = requireDispatchText(payload.text);
  const code = optionalCodeLines(payload.code);
  const target = optionalTarget(payload.target);
  const locale = payload.locale === 'en' ? 'en' : 'zh';
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
  const workspace = await requireWorkspacePath(ctx, cwd, signal);
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  const cardPath = intent === 'explain' ? explanationCardPath(config.cardsDir, target, text, id) : undefined;
  const message = composeDispatchMessage(intent, { text, code, target, locale, cardPath });
  const created = await ctx.sessionController.create({ workspaceId: workspace.id, sessionId: `session-${id}` });
  const sessionId = requireSessionId(created?.sessionId ?? '');
  try {
    const result = await ctx.sessionController.prompt({
      requestId: crypto.randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: message }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }, signal);
    return json({ ok: result.accepted === true, sessionId, created: true });
  } catch (error) {
    // Creation is durable even if prompt admission fails or its outcome is unknown.
    return json({ ok: false, sessionId, created: true, phase: 'prompt' });
  }
}

/** Strip one pairing of surrounding quotes off a frontmatter scalar. */
function unquoteValue(value) {
  if (value.length >= 2) {
    const first = value[0], last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1);
  }
  return value;
}

/** Normalize `tags: [a, b]` / `tags: a, b` / quoted values into a clean array. */
function splitTags(value) {
  let inner = unquoteValue(value.trim());
  if (inner.startsWith('[') && inner.endsWith(']')) inner = inner.slice(1, -1);
  return inner.split(',').map((tag) => unquoteValue(tag.trim())).filter((tag) => tag !== '');
}

/**
 * Parse one memory-card Markdown file: a leading flat YAML frontmatter block for
 * metadata, then the body the panel displays. Malformed frontmatter is treated
 * as body text so a hand-edited card never makes a listing fail.
 */
function parseCard(text, fileName) {
  let content = typeof text === 'string' ? text : '';
  if (content.startsWith('\uFEFF')) content = content.slice(1);
  const lines = content.split(/\r?\n/);
  const meta = {};
  let bodyStart = 0;
  const end = lines[0]?.trim() === '---' ? lines.findIndex((line, index) => index > 0 && line.trim() === '---') : -1;
  if (end > 0) {
    bodyStart = end + 1;
    for (let index = 1; index < end; index++) {
      const match = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(lines[index]);
      if (!match) continue;
      const key = match[1];
      const value = match[2].trim();
      if (key === 'tags' && value === '') {
        const list = [];
        const item = /^\s*-\s+(.+)$/;
        while (index + 1 < end && item.test(lines[index + 1])) {
          index++;
          list.push(unquoteValue(item.exec(lines[index])[1].trim()));
        }
        meta.tags = list;
        continue;
      }
      meta[key] = unquoteValue(value);
    }
  }
  const body = lines.slice(bodyStart).join('\n').trim();
  const tags = Array.isArray(meta.tags) ? meta.tags : typeof meta.tags === 'string' ? splitTags(meta.tags) : [];
  let heading = '';
  for (const line of body.split('\n')) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match) { heading = match[1].trim(); break; }
  }
  const title = (typeof meta.title === 'string' && meta.title !== '' ? meta.title : '') || heading || fileName.replace(/\.md$/i, '');
  let summary = '';
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) continue;
    summary = trimmed.length > 160 ? trimmed.slice(0, 160) : trimmed;
    break;
  }
  return {
    title,
    tags,
    kind: typeof meta.kind === 'string' ? meta.kind : '',
    source: typeof meta.source === 'string' ? meta.source : '',
    summary,
    body,
  };
}

/** The workspace-relative prefix every listed card path carries (for example `.dsh/cards/`). */
function cardPrefix(cardsDir) {
  const normalized = String(cardsDir).replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized === '' ? '' : normalized + '/';
}

/**
 * Read-only memory-card routes. The card directory is deployment configuration,
 * but is still resolved through `ctx.fs` and fenced inside the registered
 * workspace so no panel request can leave the workspace or read arbitrary files.
 */
function createCardHandlers(ctx, config) {
  async function locate(cwd, signal) {
    const workspaceRoot = await ctx.fs.resolve(cwd, { signal });
    const cardsRoot = await ctx.fs.resolve(config.cardsDir, { cwd, signal });
    if (!ctx.fs.contains(workspaceRoot, cardsRoot)) {
      throw Object.assign(new Error(`memory card directory "${config.cardsDir}" is outside the workspace`), { status: 403, code: 'CARDS_OUTSIDE_WORKSPACE' });
    }
    return { workspaceRoot, cardsRoot };
  }

  const list = async (request, signal) => {
    const cwd = queryOf(request).get('cwd') ?? '';
    await requireWorkspacePath(ctx, cwd, signal);
    const { workspaceRoot, cardsRoot } = await locate(cwd, signal);
    signal.throwIfAborted();
    const info = await ctx.fs.stat(cardsRoot, signal);
    if (!info || info.type !== 'directory') return json({ ok: true, cardsDir: config.cardsDir, exists: false, cards: [] });
    const cards = [];
    const rootPrefix = cardPrefix(config.cardsDir);
    let skipped = 0;
    let truncated = false;
    const walk = async (directory, prefix, depth) => {
      const entries = await ctx.fs.listDir(directory, signal);
      for (const entry of entries) {
        signal.throwIfAborted();
        if (!ctx.fs.contains(workspaceRoot, entry.target) || !ctx.fs.contains(cardsRoot, entry.target)) { skipped++; continue; }
        if (entry.type === 'directory') {
          if (depth + 1 < MAX_CARD_DEPTH) await walk(entry.target, prefix + entry.name + '/', depth + 1);
          if (truncated) return;
          continue;
        }
        if (!entry.name.toLowerCase().endsWith('.md')) continue;
        if (entry.type !== 'file') { skipped++; continue; }
        const size = typeof entry.size === 'number' ? entry.size : (await ctx.fs.stat(entry.target, signal))?.size ?? 0;
        if (size > MAX_CARD_BYTES) { skipped++; continue; }
        if (cards.length >= MAX_CARD_FILES) { truncated = true; return; }
        try {
          const model = parseCard(await ctx.fs.readText(entry.target, signal), entry.name);
          const sourcePath = model.source.split(/[；;]/, 1)[0].trim().replace(/^\/(?!\/)/, '').replace(/(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)$/, '');
          const archived = prefix.slice(rootPrefix.length, -1);
          const group = archived || (/\.[^./\s]+$/.test(sourcePath) ? cardSourceLocation(sourcePath)?.folder : null);
          cards.push({
            path: prefix + entry.name,
            title: model.title,
            tags: model.tags,
            ...(model.kind === '' ? {} : { kind: model.kind }),
            ...(model.source === '' ? {} : { source: model.source }),
            ...(group ? { group } : {}),
            summary: model.summary,
          });
        } catch (error) {
          if (signal.aborted) throw error;
          skipped++;
        }
      }
    };
    await walk(cardsRoot, rootPrefix, 0);
    cards.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    return json({ ok: true, cardsDir: config.cardsDir, exists: true, cards, skipped, truncated });
  };

  const detail = async (request, signal) => {
    const query = queryOf(request);
    const cwd = query.get('cwd') ?? '';
    const path = requireRelativePath(query.get('path') ?? '');
    await requireWorkspacePath(ctx, cwd, signal);
    const { workspaceRoot, cardsRoot } = await locate(cwd, signal);
    const file = await ctx.fs.resolve(path, { cwd, signal });
    if (!ctx.fs.contains(workspaceRoot, file)) {
      throw Object.assign(new Error('card is outside the workspace'), { status: 403, code: 'CARD_OUTSIDE_WORKSPACE' });
    }
    if (!ctx.fs.contains(cardsRoot, file)) {
      throw Object.assign(new Error('card is outside the memory card directory'), { status: 403, code: 'CARD_OUTSIDE_CARDS_DIR' });
    }
    const info = await ctx.fs.stat(file, signal);
    if (!info || info.type !== 'file') {
      throw Object.assign(new Error('card not found'), { status: 404, code: 'CARD_NOT_FOUND' });
    }
    if (info.size > MAX_CARD_BYTES) {
      throw Object.assign(new Error('card is too large'), { status: 413, code: 'CARD_TOO_LARGE' });
    }
    let text;
    try {
      text = await ctx.fs.readText(file, signal);
    } catch (error) {
      if (error?.code === 'FS_NOT_TEXT') throw Object.assign(new Error('card is not UTF-8 text'), { status: 415, code: 'CARD_NOT_TEXT' });
      throw error;
    }
    const model = parseCard(text, path.split('/').pop() ?? '');
    return json({ ok: true, path, title: model.title, tags: model.tags, kind: model.kind, source: model.source, body: model.body });
  };

  return { list, detail };
}

/** Register the read-only git, dispatch and memory-card routes inside Connection's authentication fence. */
function registerRoutes(ctx, config, languageServers) {
  const debug = createDebugService(ctx, config, requireWorkspacePath, json);
  ctx.effect(() => () => debug.dispose(), 'workbench: debug sessions');
  const lifetime = new AbortController();
  const pending = new Set();
  ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([...pending]); }, 'workbench: query lifetime');
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
  route('/api/git.refresh', ['POST'], async (ctx, request, signal) => {
    const cwd = queryOf(request).get('cwd') ?? '';
    await requireWorkspacePath(ctx, cwd, signal);
    const root = await ctx.fs.resolve(cwd, { signal });
    const result = await languageServers.reset(root);
    signal.throwIfAborted();
    return json({ ok: true, ...result });
  });
  route('/api/git.status', ['GET'], handleStatus);
  route('/api/git.diff', ['GET'], handleDiff);
  route('/api/git.log', ['GET'], handleLog);
  route('/api/git.commit', ['GET'], handleCommit);
  const navigation = navigationHandlers({ runGit, requireWorkspacePath, requireRelativePath, json, languageServers, imagePreviewMaxBytes: config.imagePreviewMaxBytes, navigationMaxLibrarySources: config.navigationMaxLibrarySources });
  ctx.effect(() => () => navigation.dispose(), 'workbench: library source references');
  route('/api/git.tree', ['GET'], navigation.tree);
  route('/api/git.source', ['GET'], navigation.source);
  route('/api/git.definition', ['GET'], navigation.definition);
  route('/api/git.classes', ['GET'], createPythonClassGraph({ runGit, requireWorkspacePath, requireRelativePath, json, config }));
  route('/api/git.search', ['GET'], createWorkspaceSearch({ runGit, requireWorkspacePath, requireRelativePath, json, config }));
  const cards = createCardHandlers(ctx, config);
  route('/api/git.dispatch', ['POST'], (ctx, request, signal) => handleDispatch(ctx, config, request, signal));
  route('/api/git.cards', ['GET'], (ctx, request, signal) => cards.list(request, signal));
  route('/api/git.card', ['GET'], (ctx, request, signal) => cards.detail(request, signal));
  route('/api/git.debug.configurations', ['GET'], (ctx, request) => debug.configurations(request));
  route('/api/git.debug.status', ['GET'], (ctx, request) => debug.status(request));
  route('/api/git.debug.action', ['POST'], (ctx, request, signal) => debug.action(request, signal));
}

export function apply(ctx, options = {}) {
  const config = Config(options);
  config.debugAdapters = { ...(config.useInstalledDebugAdapters ? installedDebugAdapters() : {}), ...config.debugAdapters };
  const servers = createLanguageServers(ctx, serverSpecifications({ ...(config.useInstalledServers ? installedServers() : {}), ...config.languageServers }), config);
  ctx.effect(() => () => servers.dispose(), 'workbench: language servers');
  registerRoutes(ctx, config, servers);
}
