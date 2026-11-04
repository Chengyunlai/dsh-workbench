import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fixture } from './support/host.mjs';
import { installedDebugAdapters } from '../language-config.js';
import ts from 'typescript';
const installed = installedDebugAdapters();
const python = installed.python?.command;
if (!python || !installed.go || !installed.javascript) throw new Error('Configure real Python, Go and JS debug adapters with setup:debuggers before running test:debug');
async function request(h, body) {
  const response = await h.routes.get('/api/git.debug.action')(new Request('http://localhost/api/git.debug.action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: h.root, ...body }) }));
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
}
async function status(h, id, predicate) {
  const deadline = Date.now() + 15000; let last;
  while (Date.now() < deadline) {
    const response = await h.routes.get('/api/git.debug.status')(new Request('http://localhost/api/git.debug.status?' + new URLSearchParams({ cwd: h.root, id })));
    const data = await response.json(); last = data;
    if (predicate(data)) return data;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('debug state deadline exceeded: ' + JSON.stringify(last));
}
async function evaluateAndClear(h, paused, expression) {
  const inspected = await request(h, { action: 'inspect', id: paused.id, pauseId: paused.pauseId, frameId: paused.frames[0].id, expression: expression.split(' +')[0] });
  assert.equal(inspected.variable.value, '41', JSON.stringify(inspected));
  const result = await request(h, { action: 'evaluate', id: paused.id, pauseId: paused.pauseId, frameId: paused.frames[0].id, expression });
  assert.equal(result.result, '42', JSON.stringify(result));
  const cleared = await request(h, { action: 'breakpoints', id: paused.id, breakpoints: {} });
  assert.deepEqual(cleared.breakpoints, []);
}
test('real debugpy launches, binds a breakpoint, reads variables, steps and stops', { timeout: 90000 }, async t => {
  const h = await fixture(t, null, { debugAdapters: { python: { command: python, args: ['-m', 'debugpy.adapter'] } } });
  await mkdir(join(h.root, '.dsh'));
  await writeFile(join(h.root, 'main.py'), 'value = 41\nresult = value + 1\nprint(result)\n');
  const started = await request(h, { action: 'start', currentFile: 'main.py', breakpoints: { 'main.py': [2] } });
  const paused = await status(h, started.id, data => data.state === 'paused' && data.frames.length > 0);
  assert.equal(paused.frames[0].path, 'main.py'); assert.equal(paused.frames[0].line, 2);
  assert.equal(paused.breakpoints[0].verified, true);
  const scope = paused.scopes.find(scope => scope.name === 'Locals');
  const vars = await request(h, { action: 'variables', id: started.id, reference: scope.variablesReference });
  assert.ok(vars.variables.some(item => item.name === 'value' && item.value === '41'));
  await evaluateAndClear(h, paused, 'value + 1');
  await request(h, { action: 'next', id: started.id });
  const stepped = await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.line === 3);
  assert.equal(stepped.frames[0].line, 3);
  assert.ok(stepped.pauseId > paused.pauseId);
  await request(h, { action: 'continue', id: started.id });
  await status(h, started.id, data => data.state === 'ended');
  await request(h, { action: 'stop', id: started.id });
});

test('debugpy attach disconnects without terminating the existing process', { timeout: 90000 }, async t => {
  const h = await fixture(t, null, { debugAdapters: { python: { command: python, args: ['-m', 'debugpy.adapter'] } } });
  await mkdir(join(h.root, '.dsh'));
  await writeFile(join(h.root, 'attach.py'), "import debugpy, time\nport = debugpy.listen(('127.0.0.1', 0))[1]\nprint(port, flush=True)\ndebugpy.wait_for_client()\nvalue = 41\nvalue += 1\nwhile True:\n    time.sleep(0.1)\n");
  const child = h.ctx.subprocess.spawn({ argv: [python, join(h.root, 'attach.py')], cwd: h.root, env: {}, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 65536 } } });
  let exited = false; child.done.then(() => { exited = true; });
  t.after(async () => { child.terminate(); await child.waitForExit(); });
  const port = await new Promise((resolve, reject) => { child.stdout.once('data', chunk => resolve(Number(chunk.toString().trim()))); child.done.then(() => reject(new Error('attach target exited'))); });
  const started = await request(h, { action: 'start', attach: { language: 'python', kind: 'port', value: port }, breakpoints: { 'attach.py': [6] } });
  await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.line === 6);
  await request(h, { action: 'stop', id: started.id });
  assert.equal(exited, false);
});

test('Python step over skips a call, step into enters it, and step out returns to the caller', { timeout: 90000 }, async t => {
  const h = await fixture(t, null, { debugAdapters: { python: { command: python, args: ['-m', 'debugpy.adapter'] } } });
  await writeFile(join(h.root, 'steps.py'), 'def child(value):\n    inside = value + 1\n    return inside\ndef main():\n    first = child(1)\n    second = child(first)\n    print(second)\nmain()\n');
  const started = await request(h, { action: 'start', currentFile: 'steps.py', breakpoints: { 'steps.py': [5] } });
  await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.line === 5);
  await request(h, { action: 'next', id: started.id });
  const over = await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.line === 6);
  assert.equal(over.frames[0].name, 'main');
  await request(h, { action: 'stepIn', id: started.id });
  const into = await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.name === 'child');
  assert.equal(into.frames[0].line, 2);
  assert.ok(into.frames.length > over.frames.length);
  await request(h, { action: 'stepOut', id: started.id });
  const out = await status(h, started.id, data => data.state === 'paused' && data.pauseId > into.pauseId && data.frames[0]?.name === 'main');
  assert.equal(out.frames.length, over.frames.length);
  await request(h, { action: 'stop', id: started.id });
});

test('real Delve launches Go, hits a breakpoint and reads a local variable', { timeout: 150000 }, async t => {
  const h = await fixture(t, null, { debugTimeoutMs: 120000, debugAdapters: { go: { ...installed.go } } });
  await mkdir(join(h.root, '.dsh'));
  await writeFile(join(h.root, 'go.mod'), 'module example.com/debug\n\ngo 1.24\n');
  await writeFile(join(h.root, 'main.go'), 'package main\nimport "fmt"\nfunc main() {\n value := 41\n fmt.Println(value)\n}\n');
  const started = await request(h, { action: 'start', currentFile: 'main.go', breakpoints: { 'main.go': [5] } });
  const paused = await status(h, started.id, data => data.state === 'paused' && data.frames.length > 0);
  assert.equal(paused.frames[0].line, 5);
  const vars = await request(h, { action: 'variables', id: started.id, reference: paused.scopes[0].variablesReference });
  assert.ok(vars.variables.some(item => item.name === 'value' && item.value === '41'));
  await evaluateAndClear(h, paused, 'value + 1');
  await request(h, { action: 'stop', id: started.id });
});

test('Delve remote attach disconnects without terminating the existing Go program', { timeout: 150000 }, async t => {
  const h = await fixture(t, null, { debugTimeoutMs: 120000, debugAdapters: { go: { ...installed.go } } });
  await mkdir(join(h.root, '.dsh'));
  await writeFile(join(h.root, 'main.go'), 'package main\nimport "time"\nfunc main() {\n value := 41\n for {\n  value += 1\n  time.Sleep(time.Millisecond * 100)\n }\n}\n');
  const build = h.ctx.subprocess.spawn({ argv: [process.env.DSH_DEBUG_GO ?? 'go', 'build', '-gcflags=all=-N -l', '-o', join(h.root, 'program'), join(h.root, 'main.go')], cwd: h.root, env: {}, stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } } });
  assert.equal((await build.done).exitCode, 0);
  const child = h.ctx.subprocess.spawn({ argv: [installed.go.command, '--headless', '--accept-multiclient', '--listen=127.0.0.1:0', '--api-version=2', 'exec', join(h.root, 'program')], cwd: h.root, env: {}, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 65536 } } });
  let exited = false; child.done.then(() => { exited = true; });
  t.after(async () => { child.terminate(); await child.waitForExit(); });
  const port = await new Promise((resolve, reject) => { let text = ''; child.stdout.on('data', chunk => { text += chunk; const match = /127\.0\.0\.1:(\d+)/.exec(text); if (match) resolve(Number(match[1])); }); child.done.then(() => reject(new Error('Delve exited before announcing port'))); });
  const started = await request(h, { action: 'start', attach: { language: 'go', kind: 'port', value: port }, breakpoints: { 'main.go': [6] } });
  await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.line === 6);
  await request(h, { action: 'stop', id: started.id });
  assert.equal(exited, false);
});

const jsAdapter = installed.javascript;
test('real js-debug launches JavaScript, binds a breakpoint and reads local variables', { timeout: 90000 }, async t => {
  const h = await fixture(t, null, { debugAdapters: { javascript: jsAdapter } });
  await mkdir(join(h.root, '.dsh'));
  await writeFile(join(h.root, 'main.cjs'), 'const value = 41;\nconsole.log(value + 1);\n');
  const started = await request(h, { action: 'start', currentFile: 'main.cjs', breakpoints: { 'main.cjs': [2] } });
  const paused = await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.path === 'main.cjs');
  assert.equal(paused.frames[0].line, 2);
  const vars = await request(h, { action: 'variables', id: started.id, reference: paused.scopes[0].variablesReference });
  assert.ok(vars.variables.some(item => item.name === 'value' && item.value === '41'));
  await evaluateAndClear(h, paused, 'value + 1');
  await request(h, { action: 'stop', id: started.id });
});

test('TypeScript source maps bind original source lines and step through typed code', { timeout: 90000 }, async t => {
  const h = await fixture(t, null, { debugAdapters: { javascript: jsAdapter } });
  await mkdir(join(h.root, '.dsh'));
  const source = 'interface State { value: number }\nconst state: State = { value: 41 };\nconst result: number = state.value + 1;\nconsole.log(result);\n';
  const built = ts.transpileModule(source, { fileName: 'main.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, sourceMap: true, inlineSources: true } });
  await writeFile(join(h.root, 'main.ts'), source);
  await writeFile(join(h.root, 'main.js'), built.outputText);
  await writeFile(join(h.root, 'main.js.map'), built.sourceMapText);
  const started = await request(h, { action: 'start', currentFile: 'main.ts', breakpoints: { 'main.ts': [3] } });
  const entry = await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.path === 'main.ts');
  assert.equal(entry.frames[0].line, 2);
  await request(h, { action: 'continue', id: started.id });
  const paused = await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.path === 'main.ts' && data.frames[0].line === 3);
  assert.equal(paused.frames[0].line, 3);
  await request(h, { action: 'next', id: started.id });
  const stepped = await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.path === 'main.ts' && data.frames[0].line === 4);
  const vars = await request(h, { action: 'variables', id: started.id, reference: stepped.scopes[0].variablesReference });
  assert.ok(vars.variables.some(item => item.name === 'result' && item.value === '42'));
  await evaluateAndClear(h, stepped, 'state.value + 1');
  const object = await request(h, { action: 'evaluate', id: stepped.id, pauseId: stepped.pauseId, frameId: stepped.frames[0].id, expression: 'state' });
  assert.ok(object.variablesReference > 0);
  const children = await request(h, { action: 'variables', id: stepped.id, reference: object.variablesReference, pauseId: stepped.pauseId });
  assert.ok(children.variables.some(item => item.name === 'value' && item.value === '41'));
  await request(h, { action: 'stop', id: started.id });
});

test('Node attach reads variables and disconnects without terminating the original process', { timeout: 90000 }, async t => {
  const h = await fixture(t, null, { debugAdapters: { javascript: jsAdapter } });
  await mkdir(join(h.root, '.dsh'));
  await writeFile(join(h.root, 'attach.cjs'), 'setInterval(() => {\n const value = 41;\n console.log(value);\n}, 100);\n');
  const child = h.ctx.subprocess.spawn({ argv: [process.execPath, '--inspect=127.0.0.1:0', join(h.root, 'attach.cjs')], cwd: h.root, env: {}, stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } } });
  let exited = false; child.done.then(() => { exited = true; });
  t.after(async () => { child.terminate(); await child.waitForExit(); });
  let port;
  const deadline = Date.now() + 10000;
  while (!port && Date.now() < deadline) { port = /ws:\/\/127\.0\.0\.1:(\d+)/.exec(child.collected.stderr.readFrom(0).text)?.[1]; if (!port) await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(port);
  const started = await request(h, { action: 'start', attach: { language: 'javascript', kind: 'port', value: Number(port) }, breakpoints: { 'attach.cjs': [3] } });
  const paused = await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.path === 'attach.cjs');
  const vars = await request(h, { action: 'variables', id: started.id, reference: paused.scopes[0].variablesReference });
  assert.ok(vars.variables.some(item => item.name === 'value' && item.value === '41'));
  await request(h, { action: 'stop', id: started.id }); assert.equal(exited, false);
});

test('TypeScript attach binds source-mapped callbacks and preserves the existing Node process', { timeout: 90000 }, async t => {
  const h = await fixture(t, null, { debugAdapters: { javascript: jsAdapter } });
  await mkdir(join(h.root, '.dsh'));
  const source = 'interface State { value: number }\nsetInterval(() => {\n const state: State = { value: 41 };\n console.log(state.value);\n}, 100);\n';
  const built = ts.transpileModule(source, { fileName: 'attach.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, sourceMap: true, inlineSources: true } });
  await writeFile(join(h.root, 'attach.ts'), source); await writeFile(join(h.root, 'attach.js'), built.outputText); await writeFile(join(h.root, 'attach.js.map'), built.sourceMapText);
  const child = h.ctx.subprocess.spawn({ argv: [process.execPath, '--inspect=127.0.0.1:0', join(h.root, 'attach.js')], cwd: h.root, env: {}, stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } } });
  let exited = false; child.done.then(() => { exited = true; });
  t.after(async () => { child.terminate(); await child.waitForExit(); });
  let port; const deadline = Date.now() + 10000;
  while (!port && Date.now() < deadline) { port = /ws:\/\/127\.0\.0\.1:(\d+)/.exec(child.collected.stderr.readFrom(0).text)?.[1]; if (!port) await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(port);
  const started = await request(h, { action: 'start', attach: { language: 'typescript', kind: 'port', value: Number(port) }, breakpoints: { 'attach.ts': [4] } });
  const paused = await status(h, started.id, data => data.state === 'paused' && data.frames[0]?.path === 'attach.ts' && data.frames[0].line === 4);
  const vars = await request(h, { action: 'variables', id: started.id, reference: paused.scopes[0].variablesReference });
  const state = vars.variables.find(item => item.name === 'state'); assert.ok(state);
  const members = await request(h, { action: 'variables', id: started.id, reference: state.variablesReference });
  assert.ok(members.variables.some(item => item.name === 'value' && item.value === '41'));
  await request(h, { action: 'stop', id: started.id }); assert.equal(exited, false);
});
