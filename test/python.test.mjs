import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './support/host.mjs';

test('bundled Pyright resolves cross-file function aliases and class names', async t => {
  const h = await fixture(t);
  await writeFile(join(h.root, 'shapes.py'), 'class Shape:\n    size: int = 2\n\ndef render(s: Shape) -> int:\n    return s.size\n');
  await writeFile(join(h.root, 'main.py'), 'from shapes import Shape, render as draw\nshape: Shape = Shape()\nvalue = draw(shape)\n');
  let result = await h.definition('main.py', 2, 'draw');
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.engine, 'python');
  assert.deepEqual(result.targets, [{ path: 'shapes.py', line: 3, character: 4 }]);
  result = await h.definition('main.py', 1, 'Shape');
  assert.deepEqual(result.targets, [{ path: 'shapes.py', line: 0, character: 6 }]);
});

test('missing server commands are actionable and do not create a process', async t => {
  const h = await fixture(t, null, { languageServers: { python: { command: 'not-installed-test-server' } } });
  let spawns = 0;
  h.ctx.subprocess.resolveExecutable = async () => { throw new Error('not found'); };
  h.ctx.subprocess.spawn = () => { spawns++; throw new Error('must not spawn'); };
  await writeFile(join(h.root, 'main.py'), 'print(1)');
  const result = await h.definition('main.py', 0, 'print');
  assert.equal(result.status, 503);
  assert.equal(result.code, 'LANGUAGE_SERVER_MISSING');
  assert.equal(spawns, 0);
});

test('bundled Pyright library definitions can be read outside the project without changing its code', async t => {
 const h=await fixture(t);const path=join(h.root,'library.py'),text='from pathlib import Path\nvalue = Path("sample.json")\n';
 await writeFile(path,text);
 const result=await h.definition('library.py',1,'Path');
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.external,0);
 const target=result.targets.find(target=>target.external);assert.ok(target,'Pyright exposes its installed library declarations');
 const source=await h.call('source',{path:target.path});assert.equal(source.status,200);assert.ok(source.text.includes('class Path'));
 assert.equal(source.external,true);
});
