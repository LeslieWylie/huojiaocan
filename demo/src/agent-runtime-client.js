const terminalRequestStates = new Set(['saved', 'needs_evidence', 'needs_input', 'interrupted', 'failed', 'cancelled']);
const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
const pendingKey = (ownerId, draftId) => `huojiaocan.agent.pending.${encodeURIComponent(ownerId)}.${encodeURIComponent(draftId)}`;

function codedError(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}

export function readPendingAgentTurn(ownerId, draftId) {
  if (!ownerId || !draftId) return null;
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey(ownerId, draftId)) || 'null');
    return value?.ownerId === ownerId && value?.draftId === draftId && value?.sessionId && value?.clientRequestId ? value : null;
  } catch { return null; }
}

export function clearPendingAgentTurn(ownerId, draftId, clientRequestId) {
  const pending = readPendingAgentTurn(ownerId, draftId);
  if (pending && pending.clientRequestId !== clientRequestId) return;
  try { localStorage.removeItem(pendingKey(ownerId, draftId)); } catch {}
}

function rememberPending(pending) {
  if (!pending.ownerId) return;
  try { localStorage.setItem(pendingKey(pending.ownerId, pending.draftId), JSON.stringify(pending)); } catch {}
}

function transient(error) {
  return error instanceof TypeError || error?.name === 'TimeoutError' || transientStatuses.has(error?.status)
    || ['gateway_unavailable', 'gateway_timeout', 'agent_runtime_unavailable'].includes(error?.code);
}

export async function persistentAgentCapabilities(request) {
  try {
    const result = await request('/api/agent/capabilities');
    return result?.enabled ? result : null;
  } catch { return null; }
}

export async function resumePersistentAgentTurn(options = {}) {
  const { request, pending, maxWaitMs = 300_000, onProgress } = options;
  if (!pending?.sessionId || !pending?.clientRequestId) throw codedError('agent_session_invalid');
  const { sessionId, clientRequestId } = pending;
  const wait = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const clock = options.now || Date.now;
  const started = clock();
  let failures = 0;
  let retriedSave = false;
  let saveRetriedAt = 0;
  let saveErrorVersion;
  while (clock() - started < maxWaitMs) {
    let state;
    try {
      state = await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, { signal: globalThis.AbortSignal.timeout(Math.max(1, Math.min(20_000, maxWaitMs - (clock() - started)))) });
      failures = 0;
    } catch (error) {
      if (!transient(error)) throw error;
      failures += 1;
      onProgress?.({ status: 'reconnecting', sessionId });
      await wait(Math.min(8000, 1000 * 2 ** Math.min(failures - 1, 3)));
      continue;
    }
    // Never accept another request's result, even if it is the latest in a session.
    const active = state?.session?.requests?.find(item => item.clientRequestId === clientRequestId);
    if (!active) throw codedError('agent_request_not_found', { sessionId });
    onProgress?.({ status: active.status, sessionId });
    if (active.status === 'saved') {
      if (!active.result?.response) throw codedError('agent_result_invalid');
      clearPendingAgentTurn(pending.ownerId, pending.draftId, clientRequestId);
      return { sessionId, request: active, response: active.result.response };
    }
    if (active.status === 'ready_to_save') {
      if (active.errorCode === 'edit_conflict' || active.errorCode === 'agent_evidence_insufficient') {
        throw codedError(active.errorCode, { sessionId, request: active, generatedResponse: active.result?.response });
      }
      if (!retriedSave) {
        retriedSave = true;
        saveRetriedAt = clock();
        saveErrorVersion = active.updatedAt;
        try { await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}/retry-save`, { method: 'POST', body: {}, signal: globalThis.AbortSignal.timeout(20_000) }); }
        catch (error) { if (!transient(error)) throw error; }
        await wait(1500);
        continue; // Read fresh state after retry instead of reusing the old save error.
      }
      if (active.errorCode && retriedSave && (active.updatedAt !== saveErrorVersion || clock() - saveRetriedAt >= 15_000)) {
        throw codedError('agent_save_pending', { sessionId, request: active, generatedResponse: active.result?.response });
      }
    } else if (terminalRequestStates.has(active.status)) {
      clearPendingAgentTurn(pending.ownerId, pending.draftId, clientRequestId);
      if (active.status === 'needs_evidence' && active.result?.response) return { sessionId, request: active, response: active.result.response };
      throw codedError(active.errorCode || `agent_${active.status}`, { sessionId, request: active });
    }
    await wait(1500);
  }
  // The worker may still finish. Retain the handle and offer observation, not regeneration.
  throw codedError('agent_still_running', { sessionId, pending });
}

export async function runPersistentAgentTurn(options = {}) {
  const { request, draft, ownerId = '', connectionId, question, inputSnapshot = {}, materialSnapshot = [],
    clientRequestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` } = options;
  if (!draft?.id || !(Number(draft.version) > 0)) throw codedError('draft_loading');
  const existing = readPendingAgentTurn(ownerId, draft.id);
  if (existing) throw codedError('agent_pending_request', { pending: existing, sessionId: existing.sessionId });
  const created = await request('/api/agent/sessions', { method: 'POST', body: { draftId: draft.id, title: draft.title || question }, signal: globalThis.AbortSignal.timeout(20_000) });
  const sessionId = created?.session?.id;
  if (!sessionId) throw codedError('agent_session_invalid');
  const pending = { ownerId, draftId: draft.id, sessionId, clientRequestId };
  // Persist before submitting: an accepted response can be lost on the network.
  rememberPending(pending);
  const body = { clientRequestId, draftId: draft.id, draftVersion: Number(draft.version), connectionId, question, inputSnapshot, materialSnapshot };
  try {
    await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, { method: 'POST', body, signal: globalThis.AbortSignal.timeout(20_000) });
  } catch (error) {
    if (!transient(error)) { clearPendingAgentTurn(ownerId, draft.id, clientRequestId); throw error; }
    // This endpoint deduplicates by owner + clientRequestId. Reuse exactly that id.
    try { await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, { method: 'POST', body, signal: globalThis.AbortSignal.timeout(20_000) }); }
    catch (retryError) {
      if (!transient(retryError)) { clearPendingAgentTurn(ownerId, draft.id, clientRequestId); throw retryError; }
      throw codedError('agent_connection_interrupted', { sessionId, pending, cause: retryError });
    }
  }
  options.onAccepted?.(pending);
  return resumePersistentAgentTurn({ ...options, pending });
}
