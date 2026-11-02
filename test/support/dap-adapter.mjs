import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
const writer = new StreamMessageWriter(process.stdout); let seq = 0, mode;
const send = message => writer.write({ ...message, seq: ++seq });
new StreamMessageReader(process.stdin).listen(async message => {
 const { command, arguments: args = {} } = message;
 let body = {};
 if (command === 'initialize') body = { supportsConfigurationDoneRequest: true };
 if (command === 'launch' || command === 'attach') { mode = command; await send({ type: 'event', event: 'initialized' }); }
 if (command === 'setBreakpoints') body = { breakpoints: args.breakpoints.map(point => ({ id: point.line, line: point.line, verified: true })) };
 if (command === 'disconnect' && args.terminateDebuggee !== (mode === 'launch')) { await send({ type: 'response', command, request_seq: message.seq, success: false, message: 'incorrect process ownership' }); return; }
 await send({ type: 'response', command, request_seq: message.seq, success: true, body });
 if (command === 'disconnect') process.exitCode = 0;
});
