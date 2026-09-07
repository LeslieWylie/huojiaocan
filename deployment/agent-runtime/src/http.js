import { HttpError } from './auth.js';

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function body(request) {
  try { return await request.json(); } catch { throw new HttpError('invalid_json', 400); }
}

function requestView(request) {
  if (!request) return null;
  return {
    id: request.id,
    clientRequestId: request.clientRequestId,
    sessionId: request.sessionId,
    draftId: request.draftId,
    draftVersion: request.draftVersion,
    status: request.status,
    errorCode: request.errorCode,
    modelCallCount: request.modelCallCount,
    result: request.result,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt
  };
}

function sessionView(session, requests = []) {
  return {
    id: session.id,
    status: session.status,
    attempt: session.attempt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    requests: requests.map(requestView)
  };
}

export async function handleAgentRequest(request, { runtime, user }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/agent/, '') || '/';
  if (path === '/sessions' && request.method === 'POST') {
    const input = await body(request);
    const session = await runtime.createSession(user.id, input);
    return json({ session: sessionView(session) }, 201);
  }
  const match = path.match(/^\/sessions\/([^/]+)(?:\/(messages|events|cancel|retry-save))?$/);
  if (!match) throw new HttpError('route_not_found', 404);
  const sessionId = decodeURIComponent(match[1]);
  const action = match[2] || '';
  const session = await runtime.ownedSession(user.id, sessionId);
  if (!session) throw new HttpError('session_not_found', 404);

  if (!action && request.method === 'GET') {
    return json({ session: sessionView(session, await runtime.requests.listForSession(sessionId, user.id)) });
  }
  if (action === 'messages' && request.method === 'POST') {
    const input = await body(request);
    for (const key of ['clientRequestId', 'draftId', 'connectionId', 'question']) {
      if (!String(input[key] || '').trim()) throw new HttpError(`${key.replace(/[A-Z]/g, value => `_${value.toLowerCase()}`)}_required`, 400);
    }
    if (!(Number(input.draftVersion) > 0)) throw new HttpError('draft_version_required', 400);
    const created = await runtime.postMessage(user.id, sessionId, {
      ...input,
      draftVersion: Number(input.draftVersion),
      inputSnapshot: input.inputSnapshot && typeof input.inputSnapshot === 'object' ? input.inputSnapshot : {},
      materialSnapshot: Array.isArray(input.materialSnapshot) ? input.materialSnapshot : []
    });
    return json({ request: requestView(created.request), reused: created.reused }, 202);
  }
  if (action === 'cancel' && request.method === 'POST') {
    await runtime.sessions.requestCancel(sessionId);
    const cancelled = await runtime.requests.cancelOpenRequests(sessionId, user.id);
    await runtime.queue?.send?.({ sessionId, action: 'cancel' });
    return json({ ok: true, sessionId, cancelledRequestIds: cancelled.map(item => item.id) }, 202);
  }
  if (action === 'retry-save' && request.method === 'POST') {
    await runtime.queue?.send?.({ sessionId, action: 'retry-save' });
    return json({ ok: true, sessionId }, 202);
  }
  if (action === 'events' && request.method === 'GET') {
    const headerSeq = request.headers.get('last-event-id');
    const after = Math.max(0, Number(url.searchParams.get('after') || headerSeq || 0) || 0);
    const events = await runtime.sessions.readEventsAfterForReplay(sessionId, after, runtime.limits.eventPageSize);
    if (url.searchParams.get('format') === 'json') return json(events);
    const payload = events.events.map(event => `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`).join('');
    return new Response(payload || ': heartbeat\n\n', {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
      }
    });
  }
  throw new HttpError('method_not_allowed', 405);
}

export function errorResponse(error) {
  const status = Number(error?.status) || 500;
  const code = status >= 500 ? 'agent_runtime_unavailable' : String(error?.code || error?.message || 'request_failed');
  return json({ ok: false, error: code }, status);
}
