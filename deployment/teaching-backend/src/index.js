function responseError(code, status = 503) {
  return Response.json({ ok: false, error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function safeOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

export async function forwardTeachingRequest(request, env, fetchImpl = fetch) {
  if (request.method !== 'POST') return responseError('method_not_allowed', 405);
  const path = new URL(request.url).pathname;
  const action = path === '/execute' ? 'execute' : path === '/save' ? 'save' : '';
  if (!action) return responseError('route_not_found', 404);
  const origin = safeOrigin(env.TEACHING_ORIGIN);
  if (!origin || !env.AGENT_INTERNAL_SECRET) return responseError('teaching_backend_not_configured');
  const input = await request.json().catch(() => null);
  if (!input || typeof input !== 'object') return responseError('invalid_json', 400);
  const upstream = await fetchImpl(`${origin}/api/agent-internal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Internal-Secret': env.AGENT_INTERNAL_SECRET
    },
    body: JSON.stringify({ action, ...input })
  }).catch(() => null);
  if (!upstream) return responseError('teaching_backend_unavailable');
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

// Workers passes ExecutionContext as the third handler argument. Keep the
// injectable fetch parameter on the testable function, but do not expose that
// function directly as the runtime handler or the context object is mistaken
// for fetch.
export default {
  fetch(request, env) {
    return forwardTeachingRequest(request, env);
  }
};
