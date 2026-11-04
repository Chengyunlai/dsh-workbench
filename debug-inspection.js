/** Paused-frame variable lookup through DAP scopes/variables, without evaluating source expressions. */
const fail = (message, status, code) => Object.assign(new Error(message), { status, code });
const identifier = /^[$\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;

function pausedReader(session, peer, body, signal, requireFrame) {
  const epoch = session.stopEpoch ?? 0;
  const current = () => {
    signal?.throwIfAborted();
    if (session.closing || session.state !== 'paused' || body.pauseId !== epoch || epoch !== (session.stopEpoch ?? 0)
      || (requireFrame && (!Number.isSafeInteger(body.frameId) || !session.frames.some(frame => frame.id === body.frameId)))
      || (session.activePeer ?? session.peers[0]) !== peer) throw fail('stack frame is no longer paused', 409, 'DEBUG_INSPECTION_STALE');
  };
  const read = async (command, args) => {
    current();
    try { const result = await peer.request(command, args, signal); current(); return result; }
    catch (error) { current(); throw fail(error.message, 502, 'DEBUG_INSPECTION_FAILED'); }
  };
  return { read, current };
}

/** Inspect a variable or dotted member path in one pause generation.
 * @param session - Workspace-owned debug session.
 * @param peer - Adapter serving the selected stack frame.
 * @param body - Wire request with expression, frameId and pauseId.
 * @param signal - Request lifetime; cancellation stops waiting for adapter reads.
 * @param maxVariables - Maximum variable rows inspected across scopes and member levels.
 * @returns An adapter-provided variable, or a missing/limited lookup; no evaluate request is sent.
 */
export async function inspectDebugVariable(session, peer, body, signal, maxVariables) {
  const expression = body.expression;
  if (typeof expression !== 'string' || !expression || expression.length > 512) throw fail('invalid inspection path', 400, 'DEBUG_INSPECTION_INVALID');
  const parts = expression.split('.');
  if (parts.length > 16 || !parts.every(part => identifier.test(part))) throw fail('inspection requires a variable or dotted member path', 400, 'DEBUG_INSPECTION_INVALID');
  const { read, current } = pausedReader(session, peer, body, signal, true);
  const scopes = (await read('scopes', { frameId: body.frameId }))?.scopes;
  if (!Array.isArray(scopes) || !scopes.every(scope => scope && Number.isSafeInteger(scope.variablesReference) && scope.variablesReference >= 0)) throw fail('invalid scope response', 502, 'DEBUG_INSPECTION_FAILED');
  let budget = maxVariables, limited = false;
  const find = async (reference, name) => {
    if (budget <= 0) { limited = true; return null; }
    const rows = (await read('variables', { variablesReference: reference, start: 0, count: budget }))?.variables;
    if (!Array.isArray(rows) || !rows.every(row => row && typeof row.name === 'string' && typeof row.value === 'string'
      && Number.isSafeInteger(row.variablesReference) && row.variablesReference >= 0)) throw fail('invalid variable response', 502, 'DEBUG_INSPECTION_FAILED');
    const allowed = rows.slice(0, budget); limited ||= rows.length >= budget; budget -= allowed.length;
    return allowed.find(row => row.name === name) ?? null;
  };
  let variable = null;
  for (const scope of scopes) {
    if (!scope.variablesReference || scope.expensive) continue;
    variable = await find(scope.variablesReference, parts[0]);
    if (variable) break;
  }
  for (const name of parts.slice(1)) {
    if (!variable?.variablesReference) { variable = null; break; }
    variable = await find(variable.variablesReference, name);
  }
  current();
  return { variable: variable ? { name: expression, value: variable.value, type: typeof variable.type === 'string' ? variable.type : undefined, variablesReference: variable.variablesReference } : null, limited };
}

/** Read object children without blocking execution actions; discard replies from an expired pause.
 * @param session - Workspace-owned debug session.
 * @param peer - Adapter owning the variable reference.
 * @param body - Wire request with reference and optional pauseId.
 * @param signal - Request lifetime.
 * @returns Adapter variable rows for the current pause.
 */
export async function readDebugVariables(session, peer, body, signal) {
  if (!Number.isSafeInteger(body.reference) || body.reference <= 0) throw fail('invalid variable reference', 400, 'DEBUG_INSPECTION_INVALID');
  const { read } = pausedReader(session, peer, { ...body, pauseId: body.pauseId === undefined ? (session.stopEpoch ?? 0) : body.pauseId }, signal, false);
  return read('variables', { variablesReference: body.reference, start: 0, count: 100 });
}
