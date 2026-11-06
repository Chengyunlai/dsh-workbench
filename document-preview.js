/** Route Harness document resources to the workbench without replacing recorded code comparisons. */
const FILE = 'dsh-resource://file/session/';
const MARKDOWN = /\.(?:md|markdown|mdown)$/i;
const SOURCE_EXTENSIONS = ['py', 'pyi', 'go', 'java', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx'];
export const previewPatterns = [...['md', 'markdown', 'mdown', ...SOURCE_EXTENSIONS].map(ext => '*.' + ext),
  'dsh-resource://changes-review/session/**'];
const supportsFile = path => MARKDOWN.test(path) || SOURCE_EXTENSIONS.includes(path.split('/').at(-1)?.match(/\.([^.]+)$/)?.[1].toLowerCase());
const REVIEW = 'dsh-resource://changes-review/session/';

/** Decode a supported session file or turn-review resource; malformed addresses are not claimed.
 * @param address - Harness resource address.
 * @returns Session coordinates or null.
 */
export function parsePreviewAddress(address) {
  try {
    if (address.startsWith(FILE)) {
      const parts = address.slice(FILE.length).split(/[?#]/)[0].split('/').map(decodeURIComponent);
      const sessionId = parts.shift(), path = parts.join('/');
      if (sessionId && supportsFile(path)) return { kind: 'file', sessionId, path };
    } else if (address.startsWith(REVIEW)) {
      const parts = address.slice(REVIEW.length).split('/');
      if (parts.length === 3 && parts[0] && /^\d+$/.test(parts[1]) && /^[1-9]\d*$/.test(parts[2])
        && parts.slice(1).every(part => Number.isSafeInteger(Number(part)))) {
        return { kind: 'review', sessionId: decodeURIComponent(parts[0]), seq: Number(parts[1]) };
      }
    }
  } catch (error) { /* A malformed percent escape is not a supported resource address. */ }
  return null;
}

/** Resolve a document against its owning session and the closest registered workspace.
 * @param path - Session-relative or absolute file path.
 * @param cwd - Owning session's working directory.
 * @param workspaces - Registered workspace records.
 * @param line - Optional one-based source line from Harness.
 * @returns Workspace and source navigation, or null for paths the workbench cannot read.
 */
export function documentPreviewTarget(path, cwd, workspaces, line) {
  if (typeof path !== 'string' || typeof cwd !== 'string' || !supportsFile(path)
    || /[\u0000-\u001f\u007f]/.test(path)) return null;
  const normalize = value => {
    const parts = [];
    for (const part of value.replace(/\\/g, '/').split('/')) {
      if (part === '..') { if (parts.length === 0) return null; parts.pop(); }
      else if (part !== '.') parts.push(part);
    }
    return parts.join('/').replace(/\/+$/, '');
  };
  const absolute = /^(?:\/|[a-z]:[/\\])/i.test(path);
  const full = normalize(absolute ? path : cwd + '/' + path);
  if (full === null) return null;
  const candidates = workspaces.map(workspace => ({ workspace, root: normalize(workspace.path) }))
    .filter(({ root }) => root && full.startsWith(root + '/')).sort((a, b) => b.root.length - a.root.length);
  const selected = candidates[0];
  if (!selected) return null;
  const relative = full.slice(selected.root.length + 1);
  if (!relative || relative.startsWith('-') || relative.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return { workspaceId: selected.workspace.workspaceId, cwd: selected.workspace.path,
    target: { path: relative, line: Number.isSafeInteger(line) && line > 0 ? line - 1 : 0, character: 0, documentMode: MARKDOWN.test(path) ? 'preview' : 'source', focusSource: true } };
}

/** Resolve a resource, retaining the original viewer for non-document or deleted review entries.
 * @param resource - Parsed Harness resource coordinates.
 * @param index - Selected original summary index.
 * @param cwd - Owning session's working directory.
 * @param workspaces - Registered workspaces.
 * @param read - Authenticated JSON reader scoped to the current navigation's abort signal.
 * @param line - Optional one-based line for direct file links.
 * @returns A workbench document request or null to use the original viewer.
 */
export async function resolveDocumentPreview(resource, index, cwd, workspaces, read, line) {
  let target;
  if (resource.kind === 'file') target = documentPreviewTarget(resource.path, cwd, workspaces, line);
  else {
    const query = new URLSearchParams({ sessionId: resource.sessionId, seq: String(resource.seq) });
    const summary = await read('api/changes.summary?' + query);
    if (!summary || !Array.isArray(summary.files)) throw new Error('Invalid changed-file summary');
    const file = summary.files[index];
    if (!file || typeof file.path !== 'string' || !MARKDOWN.test(file.path)) return null;
    target = documentPreviewTarget(file.path, cwd, workspaces);
    if (!target || file.binary || file.oversized) return null;
    query.set('index', String(index));
    const diff = await read('api/changes.diff?' + query);
    if (!diff || !['text', 'binary', 'oversized'].includes(diff.kind)) throw new Error('Invalid changed-file comparison');
    if (diff.kind !== 'text' || diff.after !== true) return null;
  }
  if (!target) return null;
  const status = await read('api/git.status?' + new URLSearchParams({ cwd: target.cwd }));
  return status?.isRepo === true ? target : null;
}
