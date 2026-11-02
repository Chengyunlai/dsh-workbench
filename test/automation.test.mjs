import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkLocales, checkPackageFiles, checkDocumentLinks, checkReleaseTag } from '../scripts/repository-checks.mjs';

test('translation checks reject missing keys, empty values and incompatible placeholders', () => {
  checkLocales({ en: { error: 'Failed: {message}' }, zh: { error: '失败：{message}' } });
  for (const zh of [{}, { error: '' }, { error: '失败：{reason}' }]) assert.throws(() => checkLocales({ en: { error: 'Failed: {message}' }, zh }));
});
test('payload checks reject missing workers and accidental private files', () => {
  assert.throws(() => checkPackageFiles(['package.json', 'index.js']), /missing package resource/);
  for (const path of ['.tools/key.json', 'node_modules/dependency/index.js', '.env', 'debug.log', 'demo.gif']) assert.throws(() => checkPackageFiles([path]), /private|development|media/);
});
test('document checks reject broken and escaping links while accepting local and external links', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'document-gate-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'target.md'), '# Target\n');
  await checkDocumentLinks('README.md', '[local](target.md) [site](https://example.invalid) [anchor](#target)', directory);
  await assert.rejects(checkDocumentLinks('README.md', '[missing](missing.md)', directory), /missing link target/);
  await assert.rejects(checkDocumentLinks('README.md', '[escape](../target.md)', directory), /outside repository/);
});
test('release checks require a matching version tag, including prerelease suffixes', () => {
  checkReleaseTag('v1.0.0', '1.0.0'); checkReleaseTag('v1.1.0-beta.1', '1.1.0-beta.1');
  for (const tag of ['1.0.0', 'v2.0.0', 'v1.0.0\n']) assert.throws(() => checkReleaseTag(tag, '1.0.0'));
  assert.throws(() => checkReleaseTag('vbad', 'bad'));
  assert.throws(() => checkReleaseTag('v1.0.0\n', '1.0.0\n'));
});
