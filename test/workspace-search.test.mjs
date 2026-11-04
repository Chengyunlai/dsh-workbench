import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture } from './support/host.mjs';
import { parseSearchOutput } from '../workspace-search.js';
import { Config } from '../language-config.js';
const exec = promisify(execFile);

test('Git output captured from a real Unicode file preserves paths and line numbers', async () => {
  const captured = JSON.parse(await fs.readFile(new URL('./fixtures/git-grep-output.json', import.meta.url), 'utf8'));
  assert.deepEqual(parseSearchOutput(captured.stdout), [{ path: '文 件.txt', line: 1 }, { path: '文 件.txt', line: 2 }]);
  for (const value of ['broken', 'file\0x\0text\n', 'file\x000\0text\n', '\x001\0text\n']) assert.throws(() => parseSearchOutput(value), /invalid search output/);
});

test('literal content search includes tracked and new UTF-8 files, scopes directories and returns UTF-16 positions', async t => {
  const { root, call } = await fixture(t);
  await fs.writeFile(join(root, 'src/main.ts'), '😀 Needle .* -flag\nneedle again\n');
  await fs.writeFile(join(root, 'new.js'), 'Needle outside src\n');
  await fs.writeFile(join(root, 'ignored.txt'), 'Needle ignored\n');
  const result = await call('search', { query: 'needle', scope: 'src', caseSensitive: '0' });
  assert.equal(result.status, 200); assert.equal(result.limited, false);
  assert.deepEqual(result.matches.map(row => [row.path, row.line, row.character]), [['src/main.ts', 1, 3], ['src/main.ts', 2, 0]]);
  const all = await call('search', { query: 'Needle', caseSensitive: '1' });
  assert.deepEqual(all.matches.map(row => row.path).sort(), ['new.js', 'src/main.ts']);
  assert.equal((await call('search', { query: '.*' })).matches.length, 1);
  assert.equal((await call('search', { query: '-flag', scope: 'src/main.ts' })).matches[0].character, 13);
  assert.deepEqual((await call('search', { query: 'missing' })).matches, []);
  assert.deepEqual((await call('search', { cwd: join(root, 'src'), query: 'Needle' })).matches.map(row => row.path), ['main.ts']);
});

test('search rejects invalid scopes and ignores binary, oversize and escaping symlink files without executing textconv', async t => {
  const { root, base, call } = await fixture(t);
  await fs.writeFile(join(base, 'outside.txt'), 'needle private\n');
  await fs.symlink(join(base, 'outside.txt'), join(root, 'escape.txt'));
  await fs.symlink(base, join(root, 'outside-dir'));
  await fs.writeFile(join(root, 'binary.bin'), 'needle\0binary');
  await fs.writeFile(join(root, 'large.txt'), 'needle\n' + 'x'.repeat(512 * 1024));
  await fs.writeFile(join(root, 'invalid.txt'), Buffer.from([110,101,101,100,108,101,0xff,10]));
  await fs.writeFile(join(root, '.gitattributes'), '*.ts diff=unsafe\n');
  await exec('git', ['config', 'diff.unsafe.textconv', 'a-command-that-must-never-run'], { cwd: root });
  const result = await call('search', { query: 'needle' });
  assert.equal(result.status, 200); assert.deepEqual(result.matches, []); assert.equal(result.skipped, 2);
  for (const scope of ['../outside.txt', '/etc/passwd', '.git', '.GIT/config', 'src/../new.js', 'src\n']) assert.notEqual((await call('search', { query: 'needle', scope })).status, 200, scope);
  assert.equal((await call('search', { query: 'needle', scope: 'outside-dir' })).status, 403);
  assert.equal((await call('search', { query: 'needle', scope: 'missing' })).status, 404);
  assert.equal((await call('search', { query: 'needle', cwd: base })).status, 403);
  for (const query of ['', ' ', 'a\nb', 'x'.repeat(513)]) assert.equal((await call('search', { query })).status, 400);
  assert.equal((await call('search', { query: 'needle', caseSensitive: 'yes' })).status, 400);
  assert.equal((await call('search', { query: 'Shape' })).matches.length, 4, 'textconv is disabled for source files');
});

test('search reports configured result and file limits and rejects invalid limits', async t => {
  const { root, call } = await fixture(t, undefined, { searchMaxResults: 1, searchMaxFiles: 1 });
  await fs.writeFile(join(root, 'new.js'), 'needle\nneedle\n');
  const result = await call('search', { query: 'needle' });
  assert.equal(result.matches.length, 1); assert.equal(result.limited, true);
  await fs.writeFile(join(root, 'new.js'), 'needle\n');
  await fs.writeFile(join(root, 'src/main.ts'), 'needle\n');
  assert.equal((await call('search', { query: 'needle' })).limited, true);
  for (const options of [{ searchMaxResults: 0 }, { searchMaxFiles: 0 }, { searchMaxOutputBytes: 1 }, { searchMaxResults: 1.5 }]) assert.throws(() => Config(options));
});

test('exceeding the Git output budget fails visibly instead of returning incomplete candidates', async t => {
  const { root, call } = await fixture(t, undefined, { searchMaxOutputBytes: 1024 });
  await fs.writeFile(join(root, 'new.js'), ('needle ' + 'x'.repeat(200) + '\n').repeat(20));
  const result = await call('search', { query: 'needle' });
  assert.notEqual(result.status, 200);
  assert.match(result.error, /limit|large|output|truncated/i);
});
