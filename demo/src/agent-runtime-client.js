const terminalRequestStates = new Set(['saved', 'needs_evidence', 'needs_input', 'interrupted', 'failed', 'cancelled']);

function codedError(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}

export async function persistentAgentCapabilities(request) {
  try {
    const result = await request('/api/agent/capabilities');
    return result?.enabled ? result : null;
  } catch (error) {
    if (['agent_runtime_not_enabled', 'route_not_found'].includes(String(error?.code || error?.message || '')) || error?.status === 404) return null;
    return null;
  }
}

export async function runPersistentAgentTurn(options = {}) {
  const {
    request,
    draft,
    connectionId,
    question,
    inputSnapshot = {},
    materialSnapshot = [],
    maxWaitMs = 135_000,
    clientRequestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  } = options;
  const wait = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const clock = options.now || Date.now;
  if (!draft?.id || !(Number(draft.version) > 0)) throw codedError('draft_loading');
  const created = await request('/api/agent/sessions', {
    method: 'POST', body: { draftId: draft.id, title: draft.title || question }
  });
  const sessionId = created?.session?.id;
  if (!sessionId) throw codedError('agent_session_invalid');
  await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: {
      clientRequestId,
      draftId: draft.id,
      draftVersion: Number(draft.version),
      connectionId,
      question,
      inputSnapshot,
      materialSnapshot
    }
  });

  const started = clock();
  let retriedSave = false;
  while (clock() - started < maxWaitMs) {
    const state = await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}`);
    const active = Array.isArray(state?.session?.requests)
      ? state.session.requests.find(item => item.clientRequestId === clientRequestId) || state.session.requests.at(-1)
      : null;
    if (active?.status === 'saved') {
      if (!active.result?.response) throw codedError('agent_result_invalid');
      return { sessionId, request: active, response: active.result.response };
    }
    if (active?.status === 'ready_to_save' && !retriedSave) {
      retriedSave = true;
      await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}/retry-save`, { method: 'POST', body: {} });
    } else if (active && terminalRequestStates.has(active.status)) {
      throw codedError(active.errorCode || `agent_${active.status}`, { sessionId, request: active });
    }
    await wait(900);
  }
  throw codedError('agent_timeout', { sessionId });
}
