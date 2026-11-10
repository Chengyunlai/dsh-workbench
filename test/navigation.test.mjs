import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture } from './support/host.mjs';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';

test('tree includes tracked and new files plus ignored .dsh files within the current workspace', async t => {
  const h = await fixture(t);
  await fs.appendFile(join(h.root, '.gitignore'), '\n.dsh/\n');
  for (const directory of [h.root, join(h.root, 'src')]) {
    await fs.mkdir(join(directory, '.dsh/cards'), { recursive: true });
    await fs.writeFile(join(directory, '.dsh/cards/note.md'), '# Personal note\n');
  }
  const tree = await h.call('tree');
  assert.equal(tree.status, 200);
  assert.ok(tree.files.includes('src/shapes.ts'));
  assert.ok(tree.files.includes('new.js'));
  assert.ok(!tree.files.includes('ignored.txt'));
  assert.ok(tree.files.includes('.dsh/cards/note.md'));
  assert.ok(!tree.files.includes('src/.dsh/cards/note.md'));
  assert.equal((await h.call('source', { path: '.dsh/cards/note.md' })).text, '# Personal note\n');
  const sub = await h.call('tree', { cwd: join(h.root, 'src') });
  assert.deepEqual(sub.files, ['.dsh/cards/note.md', 'main.ts', 'shapes.ts']);
});

test('tree can show ignored local configuration without dependency caches or changing Git ignore rules', async t => {
 const h = await fixture(t);
 await fs.appendFile(join(h.root, '.gitignore'), '\nconfig/*.local.json\nnode_modules/\n.venv/\n');
 for (const dir of ['config','node_modules/pkg','.venv/lib']) await fs.mkdir(join(h.root, dir), { recursive: true });
 for (const path of ['config/harness.local.json','node_modules/pkg/index.js','.venv/lib/module.py']) await fs.writeFile(join(h.root,path), '{}');
 assert.ok(!(await h.call('tree')).files.includes('config/harness.local.json'));
 const shown = await h.call('tree', { includeIgnored: '1' });
 assert.ok(shown.files.includes('config/harness.local.json'));
 assert.ok(!shown.files.includes('node_modules/pkg/index.js'));
 assert.ok(!shown.files.includes('.venv/lib/module.py'));
 assert.ok(!(await h.call('tree')).files.includes('config/harness.local.json'));
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

test('type navigation resolves the type of a variable in TypeScript and Python', async t => {
  const h = await fixture(t);
  const lookup = async (path, line, name) => {
    const source = await h.call('source', { path });
    return h.call('definition', { path, line, character: source.text.split('\n')[line].indexOf(name), version: source.version, kind: 'type' });
  };
  const ts = await lookup('src/main.ts', 1, 'shape');
  assert.deepEqual(ts.targets, [{ path: 'src/shapes.ts', line: 0, character: 17 }]);
  await fs.writeFile(join(h.root, 'model.py'), 'class ModelRequest:\n    pass\n');
  await fs.writeFile(join(h.root, 'client.py'), 'from model import ModelRequest\n\nclass Client:\n    def stream(self, request: ModelRequest):\n        return self, request\n');
  const request = await lookup('client.py', 4, 'request');
  assert.equal(request.status, 200, JSON.stringify(request));
  assert.deepEqual(request.targets, [{ path: 'model.py', line: 0, character: 6 }]);
  const self = await lookup('client.py', 4, 'self');
  assert.deepEqual(self.targets, [{ path: 'client.py', line: 2, character: 6 }]);
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

test('library definitions open through workspace-scoped references and support further navigation without arbitrary path reads', async t => {
 let h, next;
 const lsp={query:async request=>{
  if(request.filePath.startsWith('/'))assert.equal(request.filePath,join(h.base,'library.pyi'));
  return {kind:'locations',locations:[{uri:next,range:{start:{line:0,character:6}}}]};
 }};
 h=await fixture(t,lsp);
 const library=join(h.base,'library.pyi');await fs.writeFile(library,'class Client: ...\n');next=pathToFileURL(library).href;
 const result=await h.definition('src/main.ts',1,'Shape');
 assert.equal(result.external,0);assert.equal(result.targets.length,1);
 const target=result.targets[0];assert.equal(target.external,true);assert.equal(target.displayPath,library);assert.match(target.path,/^dsh-library:\/\//);
 const source=await h.call('source',{path:target.path});assert.equal(source.text,'class Client: ...\n');assert.equal(source.external,true);
 assert.equal((await h.call('source',{path:library})).status,400);
 assert.equal((await h.call('source',{path:'dsh-library://unknown/library.pyi'})).code,'LIBRARY_SOURCE_EXPIRED');
 assert.equal((await h.call('source',{cwd:join(h.root,'src'),path:target.path})).code,'LIBRARY_SOURCE_EXPIRED');
 next=pathToFileURL(join(h.root,'src/shapes.ts')).href;
 const nested=await h.call('definition',{path:target.path,version:source.version,line:'0',character:'7'});
 assert.equal(nested.status,200);assert.equal(nested.targets[0].path,'src/shapes.ts');
 await h.dispose();assert.equal((await h.call('source',{path:target.path})).status,408);
});

test('library previews preserve size/encoding checks, reject changed symlinks and leave virtual or missing sources unavailable', async t => {
 let h,locations=[];
 h=await fixture(t,{query:async()=>({kind:'locations',locations})});
 const locate=path=>({uri:pathToFileURL(path).href,range:{start:{line:0,character:0}}});
 const first=join(h.base,'first.py'),second=join(h.base,'second.py'),link=join(h.base,'alias.py');
 await fs.writeFile(first,'class First: pass\n');await fs.writeFile(second,'class Second: pass\n');await fs.symlink(first,link);
 locations=[locate(link)];const result=await h.definition('src/main.ts',1,'Shape');
 await fs.unlink(link);await fs.symlink(second,link);
 assert.equal((await h.call('source',{path:result.targets[0].path})).code,'SOURCE_CHANGED');
 await fs.symlink(first,join(h.root,'escape.py'));locations=[locate(join(h.root,'escape.py'))];
 const escaped=await h.definition('src/main.ts',1,'Shape');assert.equal(escaped.targets.length,0);assert.equal(escaped.external,1);
 for(const [name,bytes,code] of [['binary.py',Buffer.from([0]),'SOURCE_BINARY'],['encoding.pyi',Buffer.from([255]),'SOURCE_ENCODING']]){
  const path=join(h.base,name);await fs.writeFile(path,bytes);locations=[locate(path)];
  const preview=await h.definition('src/main.ts',1,'Shape');assert.equal((await h.call('source',{path:preview.targets[0].path})).code,code);
 }
 const large=join(h.base,'large.py');await fs.writeFile(large,'x'.repeat(512*1024+1));
 locations=[locate(large),locate(join(h.base,'missing.py')),locate(join(h.base,'.env')),{uri:'jdt://contents/library/Client.class',range:{start:{line:0,character:0}}},{uri:'https://example.invalid/client.py',range:{start:{line:0,character:0}}}];
 const unavailable=await h.definition('src/main.ts',1,'Shape');assert.equal(unavailable.targets.length,0);assert.equal(unavailable.external,5);
});

test('library reference budgets evict old previews, reuse current targets and reject stale library queries', async t => {
 let locations=[],edit=false,h;
 h=await fixture(t,{query:async()=>{
  if(edit)await fs.appendFile(join(h.base,'a.py'),'# changed\n');
  return {kind:'locations',locations};
 }},{navigationMaxLibrarySources:1});
 const a=join(h.base,'a.py'),b=join(h.base,'b.py');await fs.writeFile(a,'class A: pass\n');await fs.writeFile(b,'class B: pass\n');
 const locate=path=>({uri:pathToFileURL(path).href,range:{start:{line:0,character:6}}});
 locations=[locate(a)];const first=await h.definition('src/main.ts',1,'Shape');
 const repeat=await h.definition('src/main.ts',1,'Shape');assert.equal(first.targets[0].path,repeat.targets[0].path);
 const source=await h.call('source',{path:first.targets[0].path});
 locations=[locate(b)];edit=true;
 const stale=await h.call('definition',{path:first.targets[0].path,version:source.version,line:'0',character:'6'});assert.equal(stale.code,'SOURCE_CHANGED');
 assert.equal((await h.call('source',{path:first.targets[0].path})).code,'LIBRARY_SOURCE_EXPIRED');
 edit=false;locations=[locate(a),locate(b)];const limited=await h.definition('src/main.ts',1,'Shape');
 assert.equal(limited.targets.length,1);assert.equal(limited.external,1);assert.equal((await h.call('source',{path:limited.targets[0].path})).status,200);
});

test('real TypeScript compiler opens standard-library declarations outside the project', async t => {
 const h=await fixture(t);await fs.writeFile(join(h.root,'array.ts'),"const values: Array<string> = [];\nvalues.push('x');\n");
 const result=await h.definition('array.ts',1,'push');
 assert.equal(result.status,200);assert.equal(result.external,0);assert.ok(result.targets.some(target=>target.external));
 const source=await h.call('source',{path:result.targets.find(target=>target.external).path});
 assert.equal(source.status,200);assert.ok(source.text.includes('interface Array<T>'));
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


test('compiler navigation supports both case-sensitive and case-insensitive filesystem hosts', { timeout: 15000 }, async t => {
  const h = await fixture(t);
  const source = await h.call('source', { path: 'src/main.ts' });
  for (const testCaseSensitive of [true, false]) {
    const worker = new Worker(new URL('../typescript-worker.js', import.meta.url), {
      execArgv: ['--import', new URL('./support/typescript-system.mjs', import.meta.url).href],
      workerData: { root: h.root, file: join(h.root, 'src/main.ts'), text: source.text, line: 2, character: source.text.split('\n')[2].indexOf('draw'), testCaseSensitive },
    });
    t.after(async () => { await worker.terminate(); });
    const exited = new Promise(resolve => worker.once('exit', resolve));
    const [result] = await once(worker, 'message');
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(result.locations.some(item => item.uri.endsWith('/src/shapes.ts')));
    assert.equal(await exited, 0);
  }
});
