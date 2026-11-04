import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { publishArtifact } from '../scripts/npm-publish.mjs';

test('bootstrap publication skips only byte-identical npm versions and rejects network failures or changed content', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'npm-publish-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = Buffer.from('verified release'); await writeFile(join(dir, 'dsh-workbench-1.0.0.tgz'), bytes);
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  let calls = 0;
  assert.equal(await publishArtifact('1.0.0', dir, async () => { calls++; return { stdout: JSON.stringify(integrity) }; }), 'already-published');
  assert.equal(calls, 1);
  await assert.rejects(publishArtifact('1.0.0', dir, async () => ({ stdout: JSON.stringify('sha512-other') })), /different package bytes/);
  const network = Object.assign(new Error('network'), { stdout: JSON.stringify({ error: { code: 'ENETUNREACH' } }) });
  await assert.rejects(publishArtifact('1.0.0', dir, async () => { throw network; }), error => error === network);
  await assert.rejects(publishArtifact('../bad', dir), /invalid release version/);
});

test('only an explicit registry 404 permits publication, with distinct stable and preview tags', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'npm-publish-')); t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [version, tag] of [['1.0.0','latest'], ['1.1.0-beta.1','beta']]) {
    await writeFile(join(dir, `dsh-workbench-${version}.tgz`), 'verified release');
    const calls = [];
    assert.equal(await publishArtifact(version, dir, async (command, args) => {
      calls.push(args);
      if (args[0] === 'view') throw Object.assign(new Error('not found'), { stdout: JSON.stringify({ error: { code: 'E404' } }) });
      return { stdout: '' };
    }), 'published');
    assert.equal(calls.length, 2); assert.ok(calls[1].includes('--tag=' + tag)); assert.ok(calls[1].includes('--provenance'));
  }
});
