import test from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../language-config.js';
import { inspectDebugVariable, readDebugVariables } from '../debug-inspection.js';
import { debugHoverAt } from '../source-editor.js';
import { EditorState } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';

function inspectionFixture() {
 const calls = [], controller = new AbortController();
 const variable = (name, value, variablesReference = 0, type = 'str') => ({ name, value, variablesReference, type });
 const rows = new Map([[1,[variable('path','"/sample/config.json"'),variable('args','Namespace(...)',3,'Namespace')]], [2,[variable('path','shadowed'),variable('globalName','42',0,'int')]], [3,[variable('config','"demo.json"')]]]);
 const peer = { request: async (command,args) => { calls.push({command,args}); return command === 'scopes' ? { scopes:[{variablesReference:1},{variablesReference:2},{variablesReference:4,expensive:true}] } : { variables:rows.get(args.variablesReference) ?? [] }; } };
 const session = { state:'paused',stopEpoch:7,frames:[{id:10},{id:11}],peers:[peer] };
 const body = { expression:'path',frameId:11,pauseId:7 };
 return { calls,controller,rows,peer,session,body,inspect:(expression,limit=1000) => inspectDebugVariable(session,peer,{...body,expression},controller.signal,limit) };
}
test('hover inspection reads the selected frame, preserves local shadowing, and resolves member values without evaluate', async () => {
 const h=inspectionFixture();
 assert.equal((await h.inspect('path')).variable.value,'"/sample/config.json"');
 assert.equal(h.calls[0].args.frameId,11);
 assert.equal((await h.inspect('args.config')).variable.value,'"demo.json"');
 assert.equal((await h.inspect('globalName')).variable.value,'42');
 assert.equal((await h.inspect('missing')).variable,null);
 assert.equal((await h.inspect('path.missing')).variable,null);
 assert.ok(h.calls.every(call => ['scopes','variables'].includes(call.command)));
 assert.ok(h.calls.every(call => call.args.variablesReference !== 4));
});
test('inspection refuses executable expressions, stale frames, and malformed adapter values', async () => {
 const h=inspectionFixture();
 for(const expression of ['call()','value = 2','args[0]','args..config','x;y',42,'x'.repeat(513)]) await assert.rejects(h.inspect(expression),{code:'DEBUG_INSPECTION_INVALID'});
 assert.equal(h.calls.length,0);
 for(const changed of [{pauseId:6},{frameId:999},{frameId:'10'}]) await assert.rejects(inspectDebugVariable(h.session,h.peer,{...h.body,...changed},h.controller.signal,1000),{code:'DEBUG_INSPECTION_STALE'});
 h.rows.set(1,[{name:'broken',value:42,variablesReference:-1}]);
 await assert.rejects(h.inspect('broken'),{code:'DEBUG_INSPECTION_FAILED'});
});
test('a resumed program invalidates pending inspection, and cancellation propagates into DAP reads', async () => {
 const h=inspectionFixture();let release;
 h.peer.request=(command,args,signal)=>{assert.equal(signal,h.controller.signal);return new Promise(resolve=>{release=resolve;});};
 const pending=h.inspect('path'); h.session.state='running'; release({scopes:[]});
 await assert.rejects(pending,{code:'DEBUG_INSPECTION_STALE'});
 h.session.state='paused';const aborted=h.inspect('path'); h.controller.abort(); release({scopes:[]});
 await assert.rejects(aborted,{name:'AbortError'});
});
test('inspection enforces a shared variable budget and reports partial lookup', async () => {
 const h=inspectionFixture();
 assert.deepEqual(await h.inspect('args',1),{variable:null,limited:true});
 assert.equal((await h.inspect('args.config',2)).limited,true);
 assert.equal(h.calls.filter(call=>call.command==='evaluate').length,0);
});
test('hover targets use parsed identifiers in Python, Go, Java, JavaScript and TypeScript', () => {
 const cases=[['py',python(),'path = args.config\nprint(path)\n# args.config\ntext = "args.config"'],['go',go(),'package main\nfunc main() { path := args.config; println(path) }\n// args.config\n'],['java',java(),'class Demo { void run() { String path = args.config; } } // args.config'],['js',javascript(),'const path = args.config; // args.config\nconst s = "args.config"; get().config; args[0].config;'],['ts',javascript({typescript:true}),'const path: string = args?.config; // args.config']];
 for(const [label,language,text] of cases){
  const state=EditorState.create({doc:text,extensions:[language]});
  assert.equal(debugHoverAt(state,text.indexOf('path')+2)?.expression,'path',label+' binding');
  const position=text.indexOf('args')+2;
  assert.equal(debugHoverAt(state,position)?.expression,'args',label);
  assert.equal(debugHoverAt(state,text.indexOf('config')+2)?.expression,'args.config',label);
  const comment=text.lastIndexOf('// args.config')>=0?text.lastIndexOf('// args.config')+5:text.indexOf('# args.config')+4;
  assert.equal(debugHoverAt(state,comment),null,label+' comment');
  if(text.includes('"args.config"')) assert.equal(debugHoverAt(state,text.indexOf('"args.config"')+3),null,label+' string');
  if(label==='js') for(const receiver of ['get().config','args[0].config']) assert.equal(debugHoverAt(state,text.indexOf(receiver)+receiver.length-3),null,receiver);
 }
});

test('inspection budget configuration rejects zero, fractional and excessive values', () => {
 assert.equal(Config({}).debugInspectMaxVariables,1000);
 for (const value of [0,1.5,10001]) assert.throws(()=>Config({debugInspectMaxVariables:value}));
});
test('an exhausted scope budget reports omitted later scopes', async () => {
 const h=inspectionFixture();
 h.rows.set(1,[{name:'other',value:'1',variablesReference:0}]);
 assert.deepEqual(await h.inspect('globalName',1),{variable:null,limited:true});
});

test('object child reads propagate cancellation and reject replies from an expired pause', async () => {
 const h=inspectionFixture();let release;
 h.peer.request=(command,args,signal)=>{assert.equal(command,'variables');assert.equal(args.count,100);assert.equal(signal,h.controller.signal);return new Promise(resolve=>{release=resolve;});};
 const read=()=>readDebugVariables(h.session,h.peer,{reference:3,pauseId:7},h.controller.signal);
 const pending=read();h.session.stopEpoch++;release({variables:[]});
 await assert.rejects(pending,{code:'DEBUG_INSPECTION_STALE'});
 h.session.stopEpoch=7;
 for(const reference of [0,-1,'3']) await assert.rejects(readDebugVariables(h.session,h.peer,{reference},h.controller.signal),{code:'DEBUG_INSPECTION_INVALID'});
 await assert.rejects(readDebugVariables(h.session,h.peer,{reference:3,pauseId:null},h.controller.signal),{code:'DEBUG_INSPECTION_STALE'});
 const cancelled=read();h.controller.abort();release({variables:[]});await assert.rejects(cancelled,{name:'AbortError'});
});
