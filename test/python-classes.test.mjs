import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePythonClasses, linkPythonClasses } from '../python-class-graph.js';
import { classGraphLayout } from '../class-graph-client.js';
import { fixture } from './support/host.mjs';
const parsed = (path, text) => parsePythonClasses(path, text, 'version');

test('Python grammar resolves aliases, relative imports, reexports, generics, abstract methods and nested classes', () => {
 const modules = [
 parsed('pkg/base.py','from abc import ABC as Root, abstractmethod as required\nclass Backend(Root):\n @required\n def send(self): pass\nclass Outer:\n class Nested(Backend): pass\n'),
 parsed('pkg/__init__.py','from .base import Backend as Public\n'),
 parsed('pkg/impl.py','from . import Public as B\nclass Concrete(B[str]):\n def send(self): return 1\n'),
 parsed('app.py','import pkg.base as m\nclass Child(m.Outer.Nested): pass\n')];
 const result=linkPythonClasses(modules), node=name=>result.nodes.find(n=>n.qualified===name);
 assert.equal(node('Backend').kind,'abstract');assert.equal(node('Outer.Nested').kind,'abstract');
 assert.equal(node('Concrete').kind,'class');assert.deepEqual(node('Concrete').overrides,['send']);
 assert.ok(result.edges.some(e=>e.from===node('Concrete').id&&e.to===node('Backend').id));
 assert.ok(result.edges.some(e=>e.from===node('Child').id&&e.to===node('Outer.Nested').id));
 assert.equal(node('Concrete').line,1);assert.equal(node('Concrete').methods[0].line,2);
});

test('declarations do not invent Protocol implementations, dynamic bases, or same-name cross-module inheritance', () => {
 const result=linkPythonClasses([
 parsed('p.py','from typing import Protocol as P\nclass Contract(P):\n def run(self): ...\nclass Duck:\n def run(self): pass\nclass Explicit(Contract): pass\nclass Dynamic(factory()): pass\nclass Unknown(Missing): pass\n'),
 parsed('other.py','class Missing: pass\n')]);
 assert.equal(result.nodes.find(n=>n.name==='Contract').kind,'protocol');
 assert.equal(result.edges.length,1);
 assert.deepEqual(result.nodes.find(n=>n.name==='Dynamic').unresolved,['factory()']);
 assert.deepEqual(result.nodes.find(n=>n.name==='Unknown').unresolved,['Missing']);
 assert.throws(()=>parsed('bad.py','class Broken(:\n pass'),{code:'CLASS_GRAPH_SYNTAX'});
});

test('class graph route scans Git-visible files without executing Python and excludes escaped links', async t => {
 const h=await fixture(t,null);
 await mkdir(join(h.root,'pkg'));
 await writeFile(join(h.root,'pkg/base.py'),'from abc import ABC, abstractmethod\nclass Base(ABC):\n @abstractmethod\n def run(self): pass\n');
 await writeFile(join(h.root,'pkg/child.py'),'raise RuntimeError("must never execute")\nfrom .base import Base\nclass Child(Base):\n def run(self): return 1\n');
 await writeFile(join(h.root,'bad.py'),'class Bad(:\n pass');
 await writeFile(join(h.base,'secret.py'),'class External: pass\n');
 await symlink(join(h.base,'secret.py'),join(h.root,'escape.py'));
 const data=await h.call('classes');assert.equal(data.status,200,JSON.stringify(data));
 assert.equal(data.nodes.length,2);assert.equal(data.edges.length,1);
 assert.deepEqual(data.skipped.map(row=>row.code).sort(),['CLASS_GRAPH_SYNTAX','SOURCE_OUTSIDE_WORKSPACE']);
 const layout=classGraphLayout(data,data.nodes.find(n=>n.name==='Child').id);
 assert.ok(layout.nodes.find(n=>n.name==='Base').y<layout.nodes.find(n=>n.name==='Child').y);
 assert.equal((await h.call('classes',{cwd:h.base})).status,403);
});

test('class graph scan reports limits and respects request cancellation', async t => {
 const h=await fixture(t,null,{classGraphMaxFiles:1});
 await writeFile(join(h.root,'a.py'),'class A: pass\n');await writeFile(join(h.root,'b.py'),'class B: pass\n');
 const data=await h.call('classes');assert.equal(data.limited,true);assert.equal(data.scanned,1);assert.equal(data.total,2);
 const controller=new AbortController();controller.abort();
 const response=await h.routes.get('/api/git.classes')(new Request('http://localhost/api/git.classes?'+new URLSearchParams({cwd:h.root}),{signal:controller.signal}));
 assert.equal(response.status,408);
});

test('rebound symbols and ambiguous classes are unresolved, while multiple inheritance follows declaration MRO', () => {
 const result=linkPythonClasses([
 parsed('base.py','class Base: pass\nBase = factory()\n'),
 parsed('use.py','from base import Base\nclass Child(Base): pass\n'),
 parsed('methods.py','from abc import ABC, abstractmethod\nclass A(ABC):\n @abstractmethod\n def run(self): pass\nclass B:\n def run(self): pass\nclass Good(B,A): pass\nclass StillAbstract(A,B): pass\nclass Duplicate: pass\nclass Duplicate: pass\nclass Ambiguous(Duplicate): pass\n')]);
 const node=name=>result.nodes.find(n=>n.name===name);
 assert.deepEqual(node('Child').unresolved,['Base']);
 assert.deepEqual(node('Ambiguous').unresolved,['Duplicate']);
 assert.deepEqual(node('Good').abstractMethods,[]);assert.deepEqual(node('StillAbstract').abstractMethods,['run']);
});

test('bounded relationship layouts keep the selected class visible in a large connected project', () => {
 const nodes=Array.from({length:110},(_,i)=>({id:String(i)})),edges=nodes.slice(1).map((n,i)=>({from:n.id,to:String(i)}));
 const view=classGraphLayout({nodes,edges},'109');
 assert.equal(view.nodes.length,100);assert.ok(view.nodes.some(n=>n.id==='109'));assert.equal(view.limited,true);
});

test('method signatures come from syntax, omit self/cls, and preserve optional annotations without executing defaults', () => {
 const mod=parsed('api.py','class Api:\n def read(self, key: str, fallback=factory()) -> str | None: pass\n @classmethod\n def create(cls, name): pass\n');
 const [read,create]=mod.classes[0].methods;
 assert.equal(read.parameters,'key: str, fallback=factory()');assert.equal(read.returns,'str | None');
 assert.equal(create.parameters,'name');assert.equal(create.returns,'');
});
