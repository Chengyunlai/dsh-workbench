import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './support/host.mjs';

test('tree includes tracked unchanged and new files, excludes ignored files, scopes subdirectory workspaces', async t => {
  const h = await fixture(t);
  const tree = await h.call('tree');
  assert.equal(tree.status, 200);
  assert.ok(tree.files.includes('src/shapes.ts'));
  assert.ok(tree.files.includes('new.js'));
  assert.ok(!tree.files.includes('ignored.txt'));
  const sub = await h.call('tree', { cwd: join(h.root, 'src') });
  assert.deepEqual(sub.files, ['main.ts', 'shapes.ts']);
});

test('real compiler resolves imported alias, type, local shadowing, UTF-16 columns and JavaScript', async t => {
  const h = await fixture(t);
  let result = await h.definition('src/main.ts', 2, 'draw');
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.engine, 'typescript');
  assert.deepEqual(result.targets, [{ path: 'src/shapes.ts', line: 1, character: 16 }]);
  result = await h.definition('src/main.ts', 1, 'Shape');
  assert.deepEqual(result.targets, [{ path: 'src/shapes.ts', line: 0, character: 17 }]);
  result = await h.definition('src/main.ts', 3, 'draw', 40);
  assert.deepEqual(result.targets, [{ path: 'src/main.ts', line: 3, character: 25 }]);
  result = await h.definition('new.js', 1, 'hello');
  assert.deepEqual(result.targets, [{ path: 'new.js', line: 0, character: 9 }]);
});

test('source rejects traversal, escaping symlinks, binary, oversized and missing files', async t => {
  const h = await fixture(t);
  await fs.writeFile(join(h.base, 'secret.ts'), 'private');
  await fs.symlink(join(h.base, 'secret.ts'), join(h.root, 'escape.ts'));
  await fs.writeFile(join(h.root, 'binary'), Buffer.from([0, 1]));
  await fs.writeFile(join(h.root, 'large'), 'x'.repeat(512 * 1024 + 1));
  for (const [path, expected] of [['../secret.ts', 400], ['escape.ts', 403], ['binary', 415], ['large', 413], ['missing', 404]]) {
    assert.equal((await h.call('source', { path })).status, expected, path);
  }
  assert.equal((await h.call('source', { cwd: h.base, path: 'secret.ts' })).status, 403);
});

test('stale source positions are rejected before provider invocation and unsupported languages are explicit', async t => {
  let calls = 0;
  const h = await fixture(t, { query: () => { calls++; } });
  const source = await h.call('source', { path: 'src/main.ts' });
  await fs.appendFile(join(h.root, 'src/main.ts'), '\n');
  const result = await h.call('definition', { path: 'src/main.ts', line: '0', character: '1', version: source.version });
  assert.equal(result.code, 'SOURCE_CHANGED'); assert.equal(calls, 0);
  const plain = await fixture(t);
  await fs.writeFile(join(plain.root, 'read.rs'), 'println!(1)');
  assert.equal((await plain.definition('read.rs', 0, 'println')).code, 'NAVIGATION_UNAVAILABLE');
});

test('LSP results are used without compiler fallback; external and escaping targets cannot be opened', async t => {
  let h;
  const lsp = { query: async request => {
    assert.equal(request.operation, 'goToDefinition');
    return { kind: 'locations', locations: [
      { uri: pathToFileURL(join(h.root, 'src/shapes.ts')).href, range: { start: { line: 0, character: 17 } } },
      { uri: pathToFileURL(join(h.base, 'secret.ts')).href, range: { start: { line: 0, character: 0 } } },
    ] };
  } };
  h = await fixture(t, lsp);
  const result = await h.definition('src/main.ts', 1, 'Shape');
  assert.equal(result.engine, 'lsp'); assert.equal(result.external, 1);
  assert.deepEqual(result.targets, [{ path: 'src/shapes.ts', line: 0, character: 17 }]);
});

test('plugin disposal cancels navigation and awaits the provider before completing', async t => {
  let enter, cancel, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const cancelled = new Promise(resolve => { cancel = resolve; });
  const finish = new Promise(resolve => { release = resolve; });
  const h = await fixture(t, { query: (request, signal) => {
    enter();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      cancel(); finish.then(() => reject(signal.reason));
    }, { once: true }));
  } });
  const query = h.definition('src/main.ts', 1, 'Shape');
  await entered;
  let disposed = false;
  const disposal = h.dispose().then(() => { disposed = true; });
  await cancelled;
  assert.equal(disposed, false);
  release();
  await disposal;
  assert.equal((await query).status, 408);
});
