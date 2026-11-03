/** Bounded source reads and semantic navigation for the Git workspace browser. */
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { imageMime, readImagePreview } from './image-preview.js';
import { serverLanguage } from './language-servers.js';

const MAX_SOURCE_BYTES = 512 * 1024;
const TYPESCRIPT_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const failure = (message, code, status = 400) => Object.assign(new Error(message), { code, status });
const versionOf = text => createHash('sha256').update(text).digest('hex');

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
  const stat = await ctx.fs.stat(file, signal);
  if (stat?.type !== 'file') throw failure('source file does not exist or is not regular', 'SOURCE_NOT_FILE', 404);
  if (stat.size > MAX_SOURCE_BYTES) throw failure('source exceeds 512 KiB', 'SOURCE_TOO_LARGE', 413);
  const bytes = await ctx.fs.readBytes(file, signal, MAX_SOURCE_BYTES);
  if (bytes.includes(0)) throw failure('binary source cannot be displayed', 'SOURCE_BINARY', 415);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (error) { throw failure('source must be UTF-8', 'SOURCE_ENCODING', 415); }
  return { root, file, text, version: versionOf(text) };
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

/**
 * Create authenticated route handlers using the plugin's workspace and Git validation.
 * @param dependencies - Shared Git runner, registered-workspace/path validators, and JSON response writer.
 * @returns Tree, source/image preview, and definition handlers with bounded workspace reads.
 */
export function navigationHandlers({ runGit, requireWorkspacePath, requireRelativePath, json, languageServers, imagePreviewMaxBytes }) {
  const readQuery = async (ctx, request, signal) => {
    const query = new URL(request.url).searchParams;
    const cwd = query.get('cwd') ?? '';
    await requireWorkspacePath(ctx, cwd, signal);
    return { query, cwd };
  };
  return {
    tree: async (ctx, request, signal) => {
      const { cwd } = await readQuery(ctx, request, signal);
      const result = await runGit(ctx, cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '-z'], { signal });
      const prefix = (await runGit(ctx, cwd, ['rev-parse', '--show-prefix'], { signal })).stdout.replace(/\r?\n$/, '');
      const files = [...new Set(result.stdout.split('\0').filter(path => path && path.startsWith(prefix)).map(path => path.slice(prefix.length)))].sort();
      return json({ files });
    },
    source: async (ctx, request, signal) => {
      const { query, cwd } = await readQuery(ctx, request, signal);
      const path = requireRelativePath(query.get('path'));
      if (imageMime(path)) return json(await readImagePreview(ctx, cwd, path, signal, imagePreviewMaxBytes));
      const source = await readWorkspaceSource(ctx, cwd, path, signal);
      return json({ path, text: source.text, version: source.version });
    },
    definition: async (ctx, request, signal) => {
      const { query, cwd } = await readQuery(ctx, request, signal);
      const path = requireRelativePath(query.get('path'));
      const source = await readWorkspaceSource(ctx, cwd, path, signal);
      if (query.get('version') !== source.version) throw failure('source changed; reopen it before navigating', 'SOURCE_CHANGED', 409);
      const lineText = query.get('line'), characterText = query.get('character');
      if (!/^\d+$/.test(lineText ?? '') || !/^\d+$/.test(characterText ?? '')) throw failure('invalid source position', 'INVALID_POSITION');
      const line = Number(lineText), character = Number(characterText);
      const lines = source.text.split('\n');
      if (!Number.isSafeInteger(line) || !Number.isSafeInteger(character) || line >= lines.length || character >= lines[line].length) throw failure('source position is outside the file', 'INVALID_POSITION');
      const lsp = ctx.get('lsp');
      let locations;
      let engine = 'lsp';
      if (lsp) {
        try {
          const result = await lsp.query({ operation: 'goToDefinition', filePath: path, position: { line, character }, workspaceRoot: cwd }, signal);
          if (result.kind !== 'locations') throw failure('unexpected language-service response', 'NAVIGATION_FAILED', 502);
          locations = result.locations;
        } catch (error) {
          if (error.code !== 'LSP_UNAVAILABLE') throw error;
        }
      }
      if (locations === undefined) {
        const language = serverLanguage(path);
        if (!language && !TYPESCRIPT_EXT.test(path)) throw failure('no language service is configured for this file', 'NAVIGATION_UNAVAILABLE', 503);
        const mappedRoot = ctx.fs.processPathFromHostPath?.(cwd);
        if (!mappedRoot || await realpath(mappedRoot) !== ctx.fs.processPath(source.root)) throw failure('built-in navigation requires a local filesystem; configure an LSP provider for this workspace', 'NAVIGATION_UNAVAILABLE', 503);
        if (language) {
          engine = language;
          locations = await languageServers.query(language, source, { line, character }, signal);
        } else {
          engine = 'typescript';
          locations = await typescriptDefinitions({ root: ctx.fs.processPath(source.root), file: ctx.fs.processPath(source.file), text: source.text, line, character }, signal);
        }
      }
      const rootUrl = new URL(ctx.fs.fileUrl(source.root));
      const prefix = rootUrl.pathname.replace(/\/$/, '') + '/';
      const targets = [];
      let external = 0;
      for (const location of locations) {
        const url = new URL(location.uri);
        if (url.protocol !== rootUrl.protocol || url.host !== rootUrl.host || !url.pathname.startsWith(prefix)) { external++; continue; }
        const relative = requireRelativePath(url.pathname.slice(prefix.length).split('/').map(decodeURIComponent).join('/'));
        const target = await ctx.fs.resolve(relative, { cwd, signal });
        if (!ctx.fs.contains(source.root, target)) { external++; continue; }
        const entry = { path: relative, line: location.range.start.line, character: location.range.start.character };
        if (!targets.some(item => item.path === entry.path && item.line === entry.line && item.character === entry.character)) targets.push(entry);
      }
      signal.throwIfAborted();
      // The source can change while the language service is working; stale positions must not open a target.
      if ((await readWorkspaceSource(ctx, cwd, path, signal)).version !== source.version) throw failure('source changed; reopen it before navigating', 'SOURCE_CHANGED', 409);
      return json({ targets, external, engine });
    },
  };
}
