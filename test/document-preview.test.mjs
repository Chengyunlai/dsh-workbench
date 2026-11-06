import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreviewAddress, documentPreviewTarget, resolveDocumentPreview } from '../document-preview.js';

const workspaces = [{ workspaceId: 'root', path: '/repo' }, { workspaceId: 'nested', path: '/repo/nested' }];

test('document resource parsing keeps encoded names and rejects other viewers and malformed coordinates', () => {
  assert.deepEqual(parsePreviewAddress('dsh-resource://file/session/s%201/docs/hello%20%23%3F.MD'),
    { kind: 'file', sessionId: 's 1', path: 'docs/hello #?.MD' });
  assert.deepEqual(parsePreviewAddress('dsh-resource://changes-review/session/s%201/12/3'), { kind: 'review', sessionId: 's 1', seq: 12 });
  for (const address of ['https://a/README.md', 'dsh-resource://file/absolute/repo/README.md',
    'dsh-resource://file/session/s/image.png', 'dsh-resource://file/session/%zz/README.md',
    'dsh-resource://changes-review/session/s/9007199254740992/1', 'dsh-resource://changes-review/session/s/1/0']) {
    assert.equal(parsePreviewAddress(address), null, address);
  }
});

test('document navigation resolves subdirectory sessions, absolute paths, Windows paths and the nearest workspace', () => {
  assert.equal(documentPreviewTarget('../guide.md', '/repo/docs', workspaces).target.path, 'guide.md');
  assert.equal(documentPreviewTarget('/repo/nested/guide.md', '/repo/docs', workspaces).workspaceId, 'nested');
  assert.equal(documentPreviewTarget('guide.md', 'C:\\repo\\docs', [{ workspaceId: 'win', path: 'C:\\repo' }]).target.path, 'docs/guide.md');
  for (const path of ['/repo-other/guide.md', '../../outside.md', 'bad\0.md', '-bad.md']) {
    assert.equal(documentPreviewTarget(path, '/repo', workspaces), null, path);
  }
});

test('changed-file index selects the document while code, deleted files, missing summaries and non-Git roots keep their original preview', async () => {
  const resource = { kind: 'review', sessionId: 'own', seq: 42 };
  const requests = [];
  const read = async path => {
    requests.push(path);
    if (path.startsWith('api/changes.summary?')) return { files: [{ path: 'main.ts' }, { path: 'docs/guide.md' }] };
    if (path.startsWith('api/changes.diff?')) return { kind: 'text', after: true };
    return { isRepo: true };
  };
  assert.equal(await resolveDocumentPreview(resource, 0, '/repo', workspaces, read), null);
  requests.length = 0;
  const result = await resolveDocumentPreview(resource, 1, '/repo', workspaces, read);
  assert.equal(result.target.path, 'docs/guide.md');
  assert.equal(new URL(requests[1], 'http://example').searchParams.get('index'), '1');
  assert.equal(new URL(requests[0], 'http://example').searchParams.get('sessionId'), 'own');
  assert.equal(await resolveDocumentPreview(resource, 1, '/repo', workspaces, async path =>
    path.startsWith('api/changes.diff?') ? { kind: 'text', after: false } : read(path)), null);
  assert.equal(await resolveDocumentPreview(resource, 1, '/repo', workspaces, async path =>
    path.startsWith('api/git.status?') ? { isRepo: false } : read(path)), null);
  await assert.rejects(resolveDocumentPreview(resource, 1, '/repo', workspaces, async () => null), /summary/);
});
