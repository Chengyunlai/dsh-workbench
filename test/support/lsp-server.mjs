/** Keyless stdio fixture exercising the real JSON-RPC transport and process lifetime. */
import { createMessageConnection, ResponseError } from 'vscode-jsonrpc/node';
const mode = process.argv[2];
const rpc = createMessageConnection(process.stdin, process.stdout);
let uri, edit;
rpc.onRequest('initialize', () => ({ capabilities: { definitionProvider: true, textDocumentSync: { openClose: true, change: 1 }, positionEncoding: mode === 'utf8' ? 'utf-8' : 'utf-16' } }));
rpc.onNotification('initialized', () => rpc.sendNotification('language/status', { type: 'ServiceReady' }));
rpc.onNotification('textDocument/didOpen', params => {
  uri = params.textDocument.uri;
  edit = rpc.sendRequest('workspace/applyEdit', { edit: { changes: { [uri]: [] } } });
});
rpc.onRequest('textDocument/definition', async params => {
  const result = await edit;
  if (result.applied !== false) throw new Error('navigation accepted a workspace edit');
  await rpc.sendNotification('test/queryStarted', {});
  if (mode === 'hang') return new Promise(() => {});
  if (mode === 'request-error') throw new ResponseError(-32603, 'test server failed navigation');
  if (mode === 'malformed') return [{ uri, range: { start: { line: -1, character: 0 }, end: { line: 0, character: 0 } } }];
  return [{ targetUri: uri, targetRange: { start: params.position, end: params.position }, targetSelectionRange: { start: params.position, end: params.position } }];
});
rpc.listen();
