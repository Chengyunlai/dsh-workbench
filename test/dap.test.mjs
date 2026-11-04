import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { dapPeer } from '../debug-dap.js';
const exec = promisify(execFile);

test('disposing an incomplete DAP message leaves no timer keeping the process alive', async () => {
 const moduleUrl = new URL('../debug-dap.js', import.meta.url).href;
 const code = `import {PassThrough} from 'node:stream';
import {dapPeer} from ${JSON.stringify(moduleUrl)};
const input=new PassThrough(), output=new PassThrough();
const peer=dapPeer(input,output,()=>{},async()=>({}),10000,()=>{});
input.write('Content-Length: 128\\r\\n\\r\\n{');
peer.dispose(); input.destroy(); output.destroy();
process.stdout.write('disposed\\n');`;
 const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', code], { timeout: 10000 });
 assert.equal(stdout, 'disposed\n');
});

test('disposing a DAP peer releases its data subscription and ignores queued events', async () => {
 const input=new PassThrough(),output=new PassThrough(),events=[];
 const peer=dapPeer(input,output,event=>events.push(event),async()=>({}),10000,()=>{});
 const body=JSON.stringify({type:'event',event:'stopped',body:{threadId:1}});
 input.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
 peer.dispose();peer.dispose();
 await nextTurn();
 assert.deepEqual(events,[]);
 assert.equal(input.listenerCount('data'),0);
 input.destroy();output.destroy();
});

test('disposing a DAP peer rejects outstanding requests without reporting a transport failure', async () => {
 const input=new PassThrough(),output=new PassThrough(),failures=[];
 const peer=dapPeer(input,output,()=>{},async()=>({}),10000,error=>failures.push(error));
 const pending=peer.request('threads');
 peer.dispose();
 await assert.rejects(pending,/debug adapter disconnected/);
 await assert.rejects(peer.request('threads'),/debug adapter is disconnected/);
 assert.deepEqual(failures,[]);
 input.destroy();output.destroy();
});

test('aborting a DAP read removes its deadline and ignores a late response while later requests still work', async () => {
 const input=new PassThrough(),output=new PassThrough(),controller=new AbortController();
 const peer=dapPeer(input,output,()=>{},async()=>({}),10000,()=>{});
 const pending=peer.request('scopes',{frameId:1},controller.signal);controller.abort();
 await assert.rejects(pending,{name:'AbortError'});
 const response=(id,body)=>{const json=JSON.stringify({type:'response',request_seq:id,success:true,body});input.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);};
 response(1,{scopes:[{name:'late'}]});
 const next=peer.request('threads');response(2,{threads:[{id:1}]});
 assert.deepEqual(await next,{threads:[{id:1}]});
 await assert.rejects(peer.request('scopes',{},controller.signal),{name:'AbortError'});
 peer.dispose();input.destroy();output.destroy();
});
