import test from 'node:test';
import assert from 'node:assert/strict';
import { classRelationshipContext } from '../class-graph-client.js';

test('active file language takes priority over project files and Python availability is explicit', () => {
 assert.deepEqual(classRelationshipContext('src/index.js',['main.py']),{language:'javascript',source:'file',supported:false});
 for(const path of ['index.mjs','index.cjs','View.jsx'])assert.equal(classRelationshipContext(path,[]).language,'javascript');
 for(const path of ['index.ts','index.mts','index.cts','View.tsx'])assert.equal(classRelationshipContext(path,[]).language,'typescript');
 for(const path of ['main.py','types.pyi'])assert.equal(classRelationshipContext(path,['index.js']).supported,true);
 assert.deepEqual(classRelationshipContext('README.md',['main.py']),{language:'markdown',source:'file',supported:false});
 assert.equal(classRelationshipContext('main.go',[]).language,'go');assert.equal(classRelationshipContext('Main.java',[]).language,'java');
 assert.equal(classRelationshipContext('dsh-library://id/types.pyi',[],true).supported,false);
});

test('project detection handles loading, Python-only, mixed, JS/TS and empty repositories without guessing', () => {
 assert.equal(classRelationshipContext(null,null).source,'loading');
 assert.deepEqual(classRelationshipContext(null,['README.md','types.pyi']),{language:'python',source:'project',supported:true});
 assert.deepEqual(classRelationshipContext(null,['index.js','View.tsx','package.json']),{language:'javascript-typescript',source:'project',supported:false});
 assert.deepEqual(classRelationshipContext(null,['index.js','main.py']),{language:null,source:'mixed',supported:false});
 assert.deepEqual(classRelationshipContext(null,[]),{language:null,source:'project',supported:false});
});
