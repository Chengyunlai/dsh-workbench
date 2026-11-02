import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './support/host.mjs';
import { currentFileTarget } from '../debug-targets.js';
const adapter = { command: process.execPath, args: [fileURLToPath(new URL('./support/dap-adapter.mjs', import.meta.url))] };
async function action(h, body) {
 const response = await h.routes.get('/api/git.debug.action')(new Request('http://localhost/api/git.debug.action', { method:'POST', body:JSON.stringify({cwd:h.root,...body}) }));
 return { status:response.status,...await response.json() };
}
async function setup(t) {
 const h = await fixture(t,null,{ debugAdapters:{python:adapter}, debugTimeoutMs:10000 });
 await mkdir(join(h.root,'.dsh'));
 await writeFile(join(h.root,'.dsh/debug.json'), JSON.stringify({ configurations:['launch','attach'].map(request=>({name:request,language:'python',request,arguments:{program:'${workspaceFolder}/new.js'}})) }));
 return h;
}
test('launch and attach pass distinct termination ownership on disconnect',async t=>{
 const h=await setup(t);
 for(const mode of ['launch','attach']) {
  const start=await action(h,{action:'start',name:mode,breakpoints:{'new.js':[2]}});
  assert.equal(start.status,200,JSON.stringify(start));
  assert.equal(start.breakpoints[0].verified,true);
  const stopped=await action(h,{action:'stop',id:start.id});
  assert.equal(stopped.state,'ended'); assert.equal(stopped.error,undefined);
  const late = await action(h, { action: 'next', id: start.id });
  assert.equal(late.status, 409); assert.equal(late.code, 'DEBUG_SESSION_ENDED');
 }
});
test('invalid paths and unknown configurations do not start a debug process',async t=>{
 const h=await setup(t); const spawn=h.ctx.subprocess.spawn;let calls=0;
 h.ctx.subprocess.spawn=spec=>{if(spec.stdio.stdout==='pipe') calls++;return spawn(spec);};
 for(const body of [{name:'missing'},{name:'launch',breakpoints:{'../outside.py':[1]}},{name:'launch',breakpoints:{'new.js':[999]}},{name:'launch',breakpoints:{'new.js':'2'}}]) {
  assert.ok((await action(h,{action:'start',...body})).status>=400);
 }
 assert.equal(calls,0);
});
test('concurrent starts admit one debugger per workspace and unload rejects future starts',async t=>{
 const h=await setup(t);
 const results=await Promise.all([action(h,{action:'start',name:'launch'}),action(h,{action:'start',name:'launch'})]);
 assert.deepEqual(results.map(item=>item.status).sort(),[200,409]);
 await h.dispose();
 assert.equal((await action(h,{action:'start',name:'attach'})).status,408);
});

test('missing project configuration offers the current file and launches without writing a config', async t => {
 const h = await fixture(t, null, { debugAdapters: { javascript: adapter } });
 const configs = await h.call('debug.configurations', { path: 'new.js' });
 assert.equal(configs.status, 200);
 assert.deepEqual(configs.configurations, [{ name: 'new.js', language: 'javascript', request: 'launch', currentFile: 'new.js' }]);
 const started = await action(h, { action: 'start', currentFile: 'new.js', breakpoints: { 'new.js': [2] } });
 assert.equal(started.status, 200, JSON.stringify(started));
 assert.equal(started.name, 'new.js');
 assert.equal((await action(h, { action: 'stop', id: started.id })).error, undefined);
 assert.equal((await h.call('source', { path: '.dsh/debug.json' })).status, 404);
});

test('explicit configurations take priority and malformed configuration is reported', async t => {
 const h = await setup(t);
 const configs = await h.call('debug.configurations', { path: 'new.js' });
 assert.deepEqual(configs.configurations.map(row => row.name), ['launch', 'attach']);
 await writeFile(join(h.root, '.dsh/debug.json'), '{oops');
 assert.equal((await h.call('debug.configurations', { path: 'new.js' })).status, 400);
});

test('current-file resolution rejects traversal, external links, unsupported files and unbuilt TypeScript', async t => {
 const h = await fixture(t, null, { debugAdapters: { javascript: adapter } });
 await writeFile(join(h.base, 'outside.js'), 'console.log(1)');
 await symlink(join(h.base, 'outside.js'), join(h.root, 'outside.js'));
 let spawns = 0; const spawn = h.ctx.subprocess.spawn;
 h.ctx.subprocess.spawn = spec => { spawns++; return spawn(spec); };
 for (const currentFile of ['../outside.js', join(h.base, 'outside.js'), 'outside.js', '.gitignore', 'src/main.ts']) {
  const result = await action(h, { action: 'start', currentFile });
  assert.ok(result.status >= 400, JSON.stringify(result));
 }
 assert.equal(spawns, 0);
 const config = await h.call('debug.configurations', { path: 'src/main.ts' });
 assert.equal(config.status, 200);
 assert.equal(config.launchError, 'DEBUG_TS_BUILD');
 assert.deepEqual(config.configurations, []);
});

test('attach prompt accepts a Go PID and rejects invalid fields before spawning', async t => {
 const h = await fixture(t, null, { debugAdapters: { go: adapter } });
 const configs = await h.call('debug.configurations');
 assert.deepEqual(configs.configurations, []);
 let spawns = 0; const spawn = h.ctx.subprocess.spawn;
 h.ctx.subprocess.spawn = spec => { spawns++; return spawn(spec); };
 for (const attach of [{ language: 'python', kind: 'pid', value: 123 }, { language: 'go', kind: 'port', value: 65536 }, { language: 'go', kind: 'pid', value: -1 }, { language: 'java', kind: 'port', value: 123 }, { language: 'go', kind: 'pid', value: '123' }]) {
  assert.equal((await action(h, { action: 'start', attach })).status, 400);
 }
 assert.equal(spawns, 0);
 const started = await action(h, { action: 'start', attach: { language: 'go', kind: 'pid', value: 123 } });
 assert.equal(started.status, 200, JSON.stringify(started));
 assert.equal((await action(h, { action: 'stop', id: started.id })).error, undefined);
});

test('current-file discovery preserves project venv paths and resolves explicit TypeScript output directories', async t => {
 const h = await fixture(t);
 const python = join(h.root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
 await mkdir(join(python, '..'), { recursive: true });
 await symlink(process.execPath, python);
 await writeFile(join(h.root, 'main.py'), 'print(42)\n');
 const py = await currentFileTarget(h.ctx, h.root, 'main.py');
 assert.deepEqual(py.arguments.python, [python]);
 await mkdir(join(h.root, 'dist'));
 await writeFile(join(h.root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'dist' } }));
 await writeFile(join(h.root, 'dist/main.js'), 'console.log(42);\n//# sourceMappingURL=main.js.map\n');
 await writeFile(join(h.root, 'dist/main.js.map'), '{}');
 const ts = await currentFileTarget(h.ctx, h.root, 'src/main.ts');
 assert.equal(ts.arguments.program, join(h.root, 'dist/main.js'));
 assert.deepEqual(ts.arguments.outFiles, [join(h.root, 'dist/main.js')]);
 await writeFile(join(h.root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: '../../outside' } }));
 await assert.rejects(currentFileTarget(h.ctx, h.root, 'src/main.ts'), { code: 'DEBUG_TS_BUILD' });
});
