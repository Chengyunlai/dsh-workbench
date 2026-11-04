import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
const writer = new StreamMessageWriter(process.stdout); let seq = 0, mode, program, pendingInspection;
const points = new Map();
const send = message => writer.write({ ...message, seq: ++seq });
new StreamMessageReader(process.stdin).listen(async message => {
 const { command, arguments: args = {} } = message;
 let body = {};
 if (command === 'initialize') body = { supportsConfigurationDoneRequest: true };
 if (command === 'launch' || command === 'attach') { mode = command; program = args.program; await send({ type: 'event', event: 'initialized' }); }
 if (command === 'setBreakpoints' && process.argv.includes('--fail-clear') && !args.breakpoints.length) { await send({ type: 'response', command, request_seq: message.seq, success: false, message: 'cannot clear breakpoints' }); return; }
 if (command === 'setBreakpoints') { points.set(args.source.path, args.breakpoints); body = { breakpoints: args.breakpoints.map(point => ({ id: point.line, line: point.line, verified: true })) }; }
 if (command === 'threads') body = { threads: [{ id: 1, name: 'main' }] };
 if (command === 'stackTrace') body = { stackFrames: [10, 11].map(id => ({ id, name: 'frame' + id, source: { path: program }, line: 2, column: 1 })) };
 if (command === 'scopes') body = { scopes: process.argv.includes('--inspect-defer') ? [{name:'Locals',variablesReference:100+args.frameId}] : [] };
 if (command === 'variables' && process.argv.includes('--inspect-defer')) {
  pendingInspection=message;await send({type:'event',event:'output',body:{output:'inspection pending\n'}});return;
 }
 if (['continue','next'].includes(command) && pendingInspection) {
  await send({type:'response',request_seq:pendingInspection.seq,command:'variables',success:true,body:{variables:[]}});pendingInspection=null;
 }
 if (command === 'evaluate') {
  if (args.expression === 'missing') { await send({ type: 'response', command, request_seq: message.seq, success: false, message: 'unknown name' }); return; }
  if (args.expression === 'resume') await send({ type: 'event', event: 'continued' });
  body = { result: args.expression === '$points' ? JSON.stringify(Object.fromEntries(points)) : args.expression === '$request' ? JSON.stringify(args) : '42', type: 'int', variablesReference: 0 };
  if (args.expression === '$invalid') body = { result: 42, variablesReference: -1 };
 }

 if (command === 'disconnect' && args.terminateDebuggee !== (mode === 'launch')) { await send({ type: 'response', command, request_seq: message.seq, success: false, message: 'incorrect process ownership' }); return; }
 await send({ type: 'response', command, request_seq: message.seq, success: true, body });
 if (command === 'configurationDone' && process.argv.includes('--paused')) await send({ type: 'event', event: 'stopped', body: { threadId: 1, reason: 'breakpoint' } });
 if (command === 'disconnect') process.exitCode = 0;
});
