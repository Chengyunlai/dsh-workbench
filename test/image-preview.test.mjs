import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './support/host.mjs';
import { imageMime } from '../image-preview.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
function icns(...entries) {
  const parts = entries.map(([type, data]) => { const header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(data.length + 8, 4); return Buffer.concat([header, data]); });
  const header = Buffer.alloc(8); header.write('icns'); header.writeUInt32BE(8 + parts.reduce((n, part) => n + part.length, 0), 4);
  return Buffer.concat([header, ...parts]);
}

test('authenticated source route previews images without decoding binary data as UTF-8; SVG source remains available', async t => {
  const h = await fixture(t);
  for (const [path, bytes, mime] of [['icon.PNG', png, 'image/png'], ['tray.gif', Buffer.from('GIF89a'), 'image/gif'], ['logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'), 'image/svg+xml']]) {
    await writeFile(join(h.root, path), bytes);
    const result = await h.call('source', { path });
    assert.equal(result.status, 200); assert.equal(result.kind, 'image'); assert.equal(result.mime, mime);
    assert.equal(result.size, bytes.length); assert.deepEqual(Buffer.from(result.dataUrl.split(',')[1], 'base64'), bytes);
    assert.equal(result.text, path.endsWith('.svg') ? bytes.toString() : undefined);
    await writeFile(join(h.root, path), Buffer.concat([bytes, Buffer.from(' ')]));
    assert.notEqual((await h.call('source', { path })).version, result.version);
  }
  for (const ext of ['png','apng','jpg','jpeg','gif','webp','bmp','avif','ico','svg','icns']) assert.ok(imageMime('x.' + ext));
  assert.equal(imageMime('x.constructor'), undefined);
  assert.equal(imageMime('x.pdf'), undefined);
  await writeFile(join(h.root, 'plain.py'), 'value = 1\n');
  assert.equal((await h.call('source', { path: 'plain.py' })).kind, undefined);
});

test('ICNS chooses the largest embedded PNG, rejects malformed lengths and names unsupported legacy encoding', async t => {
  const h = await fixture(t);
  const larger = Buffer.from(png); larger.writeUInt32BE(2, 16); larger.writeUInt32BE(2, 20);
  const path = 'icon.icns';
  await writeFile(join(h.root, path), icns(['ic07', png], ['ic08', larger]));
  const result = await h.call('source', { path });
  assert.equal(result.status, 200); assert.equal(result.mime, 'image/png');
  assert.deepEqual(Buffer.from(result.dataUrl.split(',')[1], 'base64'), larger);
  await writeFile(join(h.root, path), icns(['is32', Buffer.from([1, 2, 3])]));
  assert.equal((await h.call('source', { path })).code, 'IMAGE_ICNS_UNSUPPORTED');
  const invalid = icns(['ic07', png]); invalid.writeUInt32BE(0, 12);
  for (const bytes of [Buffer.from('icns'), invalid, icns(['ic07', png]).subarray(0, 12)]) {
    await writeFile(join(h.root, path), bytes);
    assert.equal((await h.call('source', { path })).code, 'IMAGE_INVALID');
  }
});

test('image reads enforce registered workspaces, symlink containment, regular files and configured byte limits', async t => {
  const h = await fixture(t, undefined, { imagePreviewMaxBytes: 1024 });
  await writeFile(join(h.base, 'secret.png'), png);
  await symlink(join(h.base, 'secret.png'), join(h.root, 'escape.png'));
  await writeFile(join(h.root, 'large.png'), Buffer.alloc(1025));
  for (const [path, status, code] of [['escape.png',403,'SOURCE_OUTSIDE_WORKSPACE'], ['large.png',413,'IMAGE_TOO_LARGE'], ['missing.png',404,'SOURCE_NOT_FILE']]) {
    const result = await h.call('source', { path }); assert.equal(result.status, status); assert.equal(result.code, code);
  }
  assert.equal((await h.call('source', { cwd: h.base, path: 'secret.png' })).status, 403);
  assert.equal((await h.call('source', { path: '../secret.png' })).status, 400);
  await writeFile(join(h.root, 'okay.png'), png);
  const originalRead = h.ctx.fs.readBytes;
  h.ctx.fs.readBytes = async (...args) => { assert.equal(args[2], 1024); return originalRead(...args); };
  assert.equal((await h.call('source', { path: 'okay.png' })).status, 200);
});
