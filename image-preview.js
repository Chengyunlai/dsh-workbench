/** Bounded workspace image reads; ICNS containers expose their largest embedded PNG without native converters. */
import { createHash } from 'node:crypto';

const MIME = { png: 'image/png', apng: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon', svg: 'image/svg+xml', icns: 'image/icns' };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const failure = (message, code, status = 415) => Object.assign(new Error(message), { code, status });

/** Get the explicit image MIME allowlist entry; unknown files retain the text reader.
 * @param path - Workspace-relative filename.
 * @returns Image MIME type or undefined.
 */
export function imageMime(path) { const ext = /\.([^./]+)$/.exec(path)?.[1].toLowerCase(); return Object.hasOwn(MIME, ext) ? MIME[ext] : undefined; }

/** Validate all container lengths before choosing the largest PNG representation. */
function icnsPng(bytes) {
  if (bytes.length < 8 || bytes.toString('ascii', 0, 4) !== 'icns' || bytes.readUInt32BE(4) !== bytes.length) throw failure('invalid ICNS container', 'IMAGE_INVALID');
  let best, area = -1;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw failure('truncated ICNS entry', 'IMAGE_INVALID');
    const length = bytes.readUInt32BE(offset + 4);
    if (length < 8 || length > bytes.length - offset) throw failure('invalid ICNS entry length', 'IMAGE_INVALID');
    const data = bytes.subarray(offset + 8, offset + length);
    if (data.length >= 24 && data.subarray(0, 8).equals(PNG) && data.toString('ascii', 12, 16) === 'IHDR') {
      const size = data.readUInt32BE(16) * data.readUInt32BE(20);
      if (size > area) { best = data; area = size; }
    }
    offset += length;
  }
  if (!best) throw failure('ICNS has no embedded PNG; legacy and JPEG 2000 representations are unsupported', 'IMAGE_ICNS_UNSUPPORTED');
  return best;
}

/** Read an image in a registered workspace through the filesystem provider.
 * @param ctx - Host filesystem service.
 * @param cwd - Validated registered workspace.
 * @param path - Validated workspace-relative filename in the image allowlist.
 * @param signal - Cancels filesystem work.
 * @param maxBytes - Validated imagePreviewMaxBytes deployment limit.
 * @returns Versioned image data; SVG additionally offers bounded UTF-8 source. Browser decoding reports corrupt or unsupported raster data.
 * @throws Structured errors for escaped paths, nonfiles, size limits, malformed ICNS or unsupported ICNS encoding.
 */
export async function readImagePreview(ctx, cwd, path, signal, maxBytes) {
  const root = await ctx.fs.resolve(cwd, { signal });
  const file = await ctx.fs.resolve(path, { cwd, signal });
  if (!ctx.fs.contains(root, file)) throw failure('file is outside the workspace', 'SOURCE_OUTSIDE_WORKSPACE', 403);
  const stat = await ctx.fs.stat(file, signal);
  if (stat?.type !== 'file') throw failure('image is missing or is not a regular file', 'SOURCE_NOT_FILE', 404);
  if (stat.size > maxBytes) throw failure('image exceeds the configured preview limit', 'IMAGE_TOO_LARGE', 413);
  const original = Buffer.from(await ctx.fs.readBytes(file, signal, maxBytes));
  if (original.length > maxBytes) throw failure('image exceeds the configured preview limit', 'IMAGE_TOO_LARGE', 413);
  let mime = imageMime(path), bytes = original;
  if (mime === 'image/icns') { bytes = icnsPng(original); mime = 'image/png'; }
  let text;
  if (mime === 'image/svg+xml' && original.length <= 512 * 1024) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(original); }
    catch (error) { throw failure('SVG source must be UTF-8', 'SOURCE_ENCODING'); }
  }
  signal?.throwIfAborted();
  return { path, version: createHash('sha256').update(original).digest('hex'), kind: 'image', mime, size: original.length,
    dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, ...(text === undefined ? {} : { text }) };
}
