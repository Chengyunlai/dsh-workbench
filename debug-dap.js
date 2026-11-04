/** DAP framing and correlated requests; subprocess ownership belongs to the debug service. */
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';

/**
 * Connect a DAP peer over existing streams without exposing arbitrary requests to a browser.
 * @param input - Readable adapter stream.
 * @param output - Writable adapter stream.
 * @param onEvent - Adapter notification receiver.
 * @param onReverse - Reverse request handler, or a rejected request when unsupported.
 * @param timeoutMs - Maximum request duration.
 * @param onFailure - Reports transport/protocol failures while no request is pending.
 * @returns Requests with optional AbortSignals and an idempotent disposer rejecting outstanding work; abort stops waiting without promising adapter cancellation.
 */
export function dapPeer(input, output, onEvent, onReverse, timeoutMs, onFailure) {
  const reader = new StreamMessageReader(input), writer = new StreamMessageWriter(output);
  // Request deadlines own liveness; partial-message notices have no consumer and retain timers after disposal.
  reader.partialMessageTimeout = 0;
  const pending = new Map(); let sequence = 0, closed = false, disposed = false;
  const fail = error => { for (const entry of pending.values()) { entry.cleanup(); entry.reject(error); } pending.clear(); if (!disposed) onFailure(error); };
  const send = message => writer.write({ ...message, seq: ++sequence });
  reader.onError(error => { closed = true; fail(error); }); writer.onError(([error]) => { closed = true; fail(error); });
  reader.onClose(() => { closed = true; fail(new Error('debug adapter connection closed')); });
  const subscription = reader.listen(message => {
    if (disposed) return;
    if (!message || typeof message !== 'object') { closed = true; fail(new Error('invalid debug adapter message')); return; }
    if (message.type === 'response') {
      const entry = pending.get(message.request_seq);
      if (!entry) return;
      pending.delete(message.request_seq); entry.cleanup();
      if (message.success) entry.resolve(message.body ?? {});
      else entry.reject(new Error(message.message ?? 'debug adapter rejected request'));
    } else if (message.type === 'event' && typeof message.event === 'string') {
      try { onEvent(message.event, message.body ?? {}); }
      catch (error) { closed = true; fail(error); }
    }
    else if (message.type === 'request') {
      Promise.resolve().then(() => onReverse(message.command, message.arguments ?? {}))
        .then(body => send({ type: 'response', request_seq: message.seq, command: message.command, success: true, body }),
          error => send({ type: 'response', request_seq: message.seq, command: message.command, success: false, message: error.message }))
        .catch(error => fail(error));
    }
  });
  return {
    request(command, args = {}, signal) {
      if (signal?.aborted) return Promise.reject(signal.reason);
      if (closed) return Promise.reject(new Error('debug adapter is disconnected'));
      const seq = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(seq); cleanup(); reject(new Error(`debug request timed out: ${command}`)); }, timeoutMs);
        const abort = () => { pending.delete(seq); cleanup(); reject(signal.reason); };
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
        pending.set(seq, { resolve, reject, cleanup });
        signal?.addEventListener('abort', abort, { once: true });
        writer.write({ seq, type: 'request', command, arguments: args }).catch(error => { pending.delete(seq); cleanup(); reject(error); });
      });
    },
    dispose() { if (disposed) return; disposed = true; closed = true; fail(new Error('debug adapter disconnected')); subscription.dispose(); reader.dispose(); writer.dispose(); },
  };
}
