export class HttpError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function bearer(request) {
  return String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

export async function requireUser(request, env, fetchImpl = fetch) {
  const token = bearer(request);
  if (!token) throw new HttpError('auth_required', 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new HttpError('auth_not_configured', 503);
  const response = await fetchImpl(`${String(env.SUPABASE_URL).replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  }).catch(() => null);
  if (!response?.ok) throw new HttpError('auth_invalid', 401);
  const user = await response.json().catch(() => null);
  if (!user?.id) throw new HttpError('auth_invalid', 401);
  const allowlist = new Set(String(env.AGENT_RUNTIME_ALLOWLIST || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  // The first release is test-account only. An absent allowlist must never
  // silently turn a partially configured runtime into a public feature.
  if (!allowlist.size || (!allowlist.has(String(user.id).toLowerCase()) && !allowlist.has(String(user.email || '').toLowerCase()))) {
    throw new HttpError('agent_runtime_not_enabled', 404);
  }
  return { id: String(user.id), email: String(user.email || '') };
}
