import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamMessageReader } from 'vscode-jsonrpc/node';
import { fixture } from './support/host.mjs';
import { Config, serverSpecifications } from '../language-config.js';

const server = mode => ({ command: process.execPath, args: [fileURLToPath(new URL('./support/lsp-server.mjs', import.meta.url)), mode], waitForJavaReady: true });

test('configuration rejects missing commands and unsupported language keys', () => {
  assert.throws(() => Config({ languageServers: { go: {} } }));
  assert.throws(() => serverSpecifications({ rust: { command: 'rust-analyzer' } }));
  assert.throws(() => Config({ navigationTimeoutMs: 1000.5 }));
  const config = Config({ languageServers: { java: { command: 'jdtls' } } });
  const spec = serverSpecifications(config.languageServers).java;
  assert.equal(spec.waitForJavaReady, true);
  assert.equal(spec.settings.java.autobuild.enabled, false);
  assert.ok(spec.env.JAVA_TOOL_OPTIONS.includes('-Djava.import.generatesMetadataFilesAtProjectRoot=false'));
});

test('stdio navigation normalizes LocationLink and refuses server edits', async t => {
  const h = await fixture(t, null, { languageServers: { python: server('ok') } });
  await writeFile(join(h.root, 'main.py'), 'example()');
  const result = await h.definition('main.py', 0, 'example');
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.deepEqual(result.targets, [{ path: 'main.py', line: 0, character: 0 }]);
});

test('non-UTF-16 negotiation and malformed locations fail visibly', async t => {
  for (const mode of ['utf8', 'malformed']) {
    const h = await fixture(t, null, { languageServers: { python: server(mode) } });
    await writeFile(join(h.root, 'main.py'), 'example()');
    const result = await h.definition('main.py', 0, 'example');
    assert.equal(result.code, 'LANGUAGE_SERVER_PROTOCOL');
    assert.equal(result.status, 502);
  }
});

test('numeric JSON-RPC failures become stable language-server error codes', async t => {
  const h = await fixture(t, null, { languageServers: { python: server('request-error') } });
  await writeFile(join(h.root, 'main.py'), 'example()');
  const result = await h.definition('main.py', 0, 'example');
  assert.equal(result.status, 502); assert.equal(result.code, 'LANGUAGE_SERVER_FAILED');
});

test('a stalled definition returns an actionable timeout and stops its server', { timeout: 10000 }, async t => {
  const h = await fixture(t, null, { languageServers: { python: server('hang') }, navigationTimeoutMs: 1000 });
  await writeFile(join(h.root, 'main.py'), 'example()');
  const result = await h.definition('main.py', 0, 'example');
  assert.equal(result.status, 408); assert.equal(result.code, 'LANGUAGE_SERVER_TIMEOUT');
});

test('unload aborts active server queries and waits for exit before removing Java state', async t => {
  const h = await fixture(t, null, { languageServers: { java: server('hang') } });
  await writeFile(join(h.root, 'Main.java'), 'example()');
  let started, reachedExit, release;
  const active = new Promise(resolve => { started = resolve; });
  const exited = new Promise(resolve => { reachedExit = resolve; });
  const finish = new Promise(resolve => { release = resolve; });
  const spawn = h.ctx.subprocess.spawn;
  let state, reader;
  h.ctx.subprocess.spawn = spec => {
    const handle = spawn(spec);
    if (spec.stdio.stdout !== 'pipe') return handle;
    state = spec.argv.at(-1);
    reader = new StreamMessageReader(handle.stdout);
    reader.listen(message => { if (message.method === 'test/queryStarted') started(); });
    const wait = handle.waitForExit;
    return { ...handle, waitForExit: async () => { await wait(); reachedExit(); await finish; } };
  };
  const query = h.definition('Main.java', 0, 'example');
  await active;
  let complete = false;
  const disposal = h.dispose().then(() => { complete = true; });
  await exited;
  assert.equal(complete, false); await access(state);
  release(); await disposal; reader.dispose();
  assert.equal((await query).status, 408);
  await assert.rejects(access(state), { code: 'ENOENT' });
});

test('Python navigation refreshes cached imports after a definition is moved', async t => {
  const { mkdir, rename } = await import('node:fs/promises');
  const h = await fixture(t);
  await mkdir(join(h.root, 'pkg'));
  await writeFile(join(h.root, 'pkg/__init__.py'), 'from .old import ModelMessage\n');
  await writeFile(join(h.root, 'pkg/old.py'), 'class ModelMessage: pass\n');
  await writeFile(join(h.root, 'main.py'), 'from pkg import ModelMessage\nModelMessage()\n');
  assert.equal((await h.definition('main.py', 1, 'ModelMessage')).targets[0]?.path, 'pkg/old.py');
  await rename(join(h.root, 'pkg/old.py'), join(h.root, 'pkg/new.py'));
  await writeFile(join(h.root, 'pkg/__init__.py'), 'from .new import ModelMessage\n');
  const result = await h.definition('main.py', 1, 'ModelMessage');
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.targets[0]?.path, 'pkg/new.py');
});
