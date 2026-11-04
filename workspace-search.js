/** Literal workspace content search, with Git enumeration and the reader's filesystem restrictions. */
import { readWorkspaceSource } from './navigation.js';

const failure = (message, status = 400) => Object.assign(new Error(message), { status });

/** Parse Git's NUL-delimited filename/line prefixes without treating filename punctuation as separators.
 * @param output - Complete stdout from `git grep -n -z` without headings, context or colors.
 * @returns Candidate file paths and one-based line numbers.
 */
export function parseSearchOutput(output) {
  const rows = [];
  let position = 0;
  while (position < output.length) {
    const pathEnd = output.indexOf('\0', position), lineEnd = output.indexOf('\0', pathEnd + 1);
    if (pathEnd < position || lineEnd < 0) throw failure('invalid search output', 502);
    const path = output.slice(position, pathEnd), line = Number(output.slice(pathEnd + 1, lineEnd));
    if (!path || !/^\d+$/.test(output.slice(pathEnd + 1, lineEnd)) || !Number.isSafeInteger(line) || line < 1) throw failure('invalid search output', 502);
    const end = output.indexOf('\n', lineEnd + 1);
    rows.push({ path, line });
    position = end < 0 ? output.length : end + 1;
  }
  return rows;
}

/** Create an authenticated route searching only readable files inside the registered workspace.
 * @param dependencies - Existing Git runner, workspace/path validators, response helper and validated search limits.
 * @returns A cancellable, read-only content-search handler.
 */
export function createWorkspaceSearch({ runGit, requireWorkspacePath, requireRelativePath, json, config }) {
  return async (ctx, request, signal) => {
    const params = new URL(request.url).searchParams, cwd = params.get('cwd');
    await requireWorkspacePath(ctx, cwd, signal);
    const query = params.get('query'), scope = params.get('scope') ?? '', caseSensitive = params.get('caseSensitive') !== '0';
    if (params.has('caseSensitive') && !['0', '1'].includes(params.get('caseSensitive'))) throw failure('caseSensitive must be 0 or 1');
    if (!query || !query.trim() || query.length > 512 || /[\u0000-\u001f\u007f]/.test(query)) throw failure('enter a single-line search query of 1–512 characters');
    if (scope) requireRelativePath(scope);
    if (scope.split('/').some(part => part.toLowerCase() === '.git')) throw failure('Git metadata cannot be searched');
    const root = await ctx.fs.resolve(cwd, { signal });
    if (scope) {
      const target = await ctx.fs.resolve(scope, { cwd, signal });
      if (!ctx.fs.contains(root, target)) throw failure('search scope is outside the workspace', 403);
      if (!await ctx.fs.stat(target, signal)) throw failure('search scope no longer exists', 404);
    }
    const args = ['--literal-pathspecs', '-c', 'core.fsmonitor=false', 'grep', '--untracked', '--exclude-standard',
      '-I', '-n', '-z', '--no-color', '--no-heading', '--no-break', '--no-textconv', '--no-ext-grep',
      '--no-recurse-submodules', '--no-full-name', '-F', ...(caseSensitive ? [] : ['-i']), '-e', query, '--', ...(scope ? [scope] : [])];
    const output = await runGit(ctx, cwd, args, { signal, allowed: [0, 1], maxBytes: config.searchMaxOutputBytes });
    const grouped = new Map();
    for (const row of parseSearchOutput(output.stdout)) {
      if (!grouped.has(row.path)) grouped.set(row.path, new Set());
      grouped.get(row.path).add(row.line);
    }
    const literal = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'u' : 'iu');
    const matches = [];
    let limited = false, scanned = 0, skipped = 0;
    for (const [path, numbers] of grouped) {
      signal.throwIfAborted();
      if (scanned++ >= config.searchMaxFiles) { limited = true; break; }
      try { requireRelativePath(path); } catch (error) { skipped++; continue; }
      let source;
      try { source = await readWorkspaceSource(ctx, cwd, path, signal); }
      catch (error) {
        if (['SOURCE_NOT_FILE', 'SOURCE_OUTSIDE_WORKSPACE', 'SOURCE_TOO_LARGE', 'SOURCE_BINARY', 'SOURCE_ENCODING'].includes(error.code)) { skipped++; continue; }
        throw error;
      }
      const lines = source.text.split('\n');
      for (const line of numbers) {
        const text = lines[line - 1];
        const found = text === undefined ? null : literal.exec(text);
        if (!found) continue;
        if (matches.length === config.searchMaxResults) { limited = true; break; }
        const start = Math.max(0, found.index - 80);
        matches.push({ path, line, character: found.index, text: text.slice(start, start + 320).replace(/\r$/, '') });
      }
      if (limited) break;
    }
    return json({ matches, limited, skipped });
  };
}
