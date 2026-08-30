const STORAGE_KEY = 'huojiaocan.supabase.session';
const AUTH_EVENT = 'huojiaocan:auth-change';
let runtimeConfig = null;
let consumedAuthCallback;

const AUTH_ERROR_ALIASES = Object.freeze({
  invalid_grant: 'auth_invalid',
  invalid_credentials: 'auth_invalid',
  invalid_login_credentials: 'auth_invalid',
  user_not_found: 'auth_invalid',
  email_exists: 'user_already_exists',
  user_already_exists: 'user_already_exists',
  over_email_send_rate_limit: 'auth_rate_limited',
  over_request_rate_limit: 'auth_rate_limited'
});

export function normalizeAuthErrorCode(value) {
  const code = String(value || 'auth_failed').trim().toLowerCase();
  return AUTH_ERROR_ALIASES[code] || code;
}

async function config() {
  if (runtimeConfig) return runtimeConfig;
  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    const data = await response.json();
    runtimeConfig = { ready: Boolean(data.supabaseConfigured) };
  } catch {
    runtimeConfig = { ready: false };
  }
  return runtimeConfig;
}

export function getSession() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}
export function accessToken() { return getSession()?.access_token || ''; }
export function sessionExpired(session = getSession(), skewSeconds = 30) {
  const expiresAt = Number(session?.expires_at || 0);
  return Boolean(expiresAt && expiresAt * 1000 <= Date.now() + Math.max(0, Number(skewSeconds) || 0) * 1000);
}
export function authRecoveryKey() { return 'huojiaocan.auth.recovery'; }
const AUTH_RECOVERY_BACKUP_KEY = `${authRecoveryKey()}.backup`;
const AUTH_RECOVERY_TTL_MS = 2 * 60 * 60 * 1000;
function safeRecoveryPath(value) {
  const path = String(value || '').trim();
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('://') && !path.includes('\\') ? path : '/ask/';
}
export function safeAuthReturnPath(value) {
  return safeRecoveryPath(value);
}
function normalizeRecovery(value, userId = '') {
  if (!value || typeof value !== 'object') return null;
  const savedAt = Date.parse(value.savedAt || '');
  if (!savedAt || Date.now() - savedAt > AUTH_RECOVERY_TTL_MS) return null;
  const ownerUserId = String(value.ownerUserId || '');
  const currentUserId = String(userId || '');
  // An owner-bound payload is private even while an email-confirmation
  // callback has produced tokens but no user object yet. Only a positively
  // identified matching owner may read it. Ownerless payloads must carry the
  // marker written by saveAuthRecovery; legacy/malformed ownerless values are
  // not treated as anonymous hand-offs by accident.
  if (ownerUserId ? ownerUserId !== currentUserId : value.anonymousHandoff !== true) return null;
  return { ...value, next: safeRecoveryPath(value.next) };
}
export function saveAuthRecovery(value) {
  const ownerUserId = String(value?.ownerUserId || getSession()?.user?.id || '');
  const payload = {
    ...(value || {}),
    ownerUserId,
    anonymousHandoff: !ownerUserId,
    next: safeRecoveryPath(value?.next),
    messages: Array.isArray(value?.messages) ? value.messages.slice(-12) : [],
    conversationHistory: Array.isArray(value?.conversationHistory) ? value.conversationHistory.slice(-12) : [],
    savedAt: value?.savedAt || new Date().toISOString()
  };
  const serialized = JSON.stringify(payload);
  try { sessionStorage.setItem(authRecoveryKey(), serialized); } catch {}
  // Session storage is the primary hand-off, but a confirmation link may open
  // in a new tab. Keep the same non-secret recovery payload in a short-lived
  // backup so the teacher does not lose the question and draft context.
  try { localStorage.setItem(AUTH_RECOVERY_BACKUP_KEY, serialized); } catch {}
}
export function readAuthRecovery(userId = getSession()?.user?.id || '') {
  let value = null;
  try { value = normalizeRecovery(JSON.parse(sessionStorage.getItem(authRecoveryKey()) || 'null'), userId); } catch {}
  if (value) return value;
  try {
    value = normalizeRecovery(JSON.parse(localStorage.getItem(AUTH_RECOVERY_BACKUP_KEY) || 'null'), userId);
    if (value) {
      try { sessionStorage.setItem(authRecoveryKey(), JSON.stringify(value)); } catch {}
      return value;
    }
  } catch {}
  return null;
}
export function clearAuthRecovery() {
  try { sessionStorage.removeItem(authRecoveryKey()); } catch {}
  try { localStorage.removeItem(AUTH_RECOVERY_BACKUP_KEY); } catch {}
}
export function authOwnersConflict(previousOwner = '', nextOwner = '') {
  const previous = String(previousOwner || '');
  const next = String(nextOwner || '');
  return Boolean(previous && next && previous !== next);
}
export function canPersistAuthOwner(activeOwner = '', sessionOwner = '', transitioning = false) {
  return !transitioning && !authOwnersConflict(activeOwner, sessionOwner);
}
export function subscribeAuth(listener) {
  if (typeof window === 'undefined' || typeof listener !== 'function') return () => {};
  const notify = () => listener(getSession());
  window.addEventListener(AUTH_EVENT, notify);
  window.addEventListener('storage', notify);
  window.addEventListener('focus', notify);
  return () => {
    window.removeEventListener(AUTH_EVENT, notify);
    window.removeEventListener('storage', notify);
    window.removeEventListener('focus', notify);
  };
}
function notifyAuthChange() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try { window.dispatchEvent(new Event(AUTH_EVENT)); } catch {}
}
function save(session) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
  notifyAuthChange();
  return session;
}

// Supabase email confirmation links return their result in the URL hash. The
// app used to ignore that hash, so a valid confirmation could not create a
// local session and an expired confirmation would later surface as the vague
// "auth_failed" message. Keep the parser pure so the callback behavior is
// deterministic and easy to verify without exposing any token in the UI.
export function parseAuthCallbackHash(hash = '') {
  const value = String(hash || '').replace(/^#/, '');
  if (!value) return null;
  const params = new URLSearchParams(value);
  const errorCode = params.get('error_code') || params.get('error');
  const errorDescription = params.get('error_description') || params.get('msg') || '';
  if (errorCode) return { type: 'error', code: errorCode, description: errorDescription };
  const accessTokenValue = params.get('access_token');
  const refreshTokenValue = params.get('refresh_token');
  if (!accessTokenValue || !refreshTokenValue) return null;
  return {
    type: 'session',
    session: {
      access_token: accessTokenValue,
      refresh_token: refreshTokenValue,
      token_type: params.get('token_type') || 'bearer',
      expires_in: Number(params.get('expires_in') || 0) || undefined,
      expires_at: Number(params.get('expires_at') || 0) || undefined,
      type: params.get('type') || ''
    }
  };
}

export function consumeAuthCallback() {
  // React StrictMode may evaluate lazy state initializers twice in local
  // development. Cache the result so the first evaluation does not consume a
  // callback that the second evaluation then loses.
  if (consumedAuthCallback !== undefined) return consumedAuthCallback;
  if (typeof window === 'undefined' || !window.location?.hash) {
    consumedAuthCallback = null;
    return consumedAuthCallback;
  }
  const result = parseAuthCallbackHash(window.location.hash);
  if (!result) {
    consumedAuthCallback = null;
    return consumedAuthCallback;
  }
  if (result.type === 'session') save(result.session);
  // The hash can contain access and refresh tokens. Remove it immediately so
  // it is not retained in browser history, copied into a URL, or reprocessed
  // after a refresh.
  window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  consumedAuthCallback = result;
  return consumedAuthCallback;
}

async function authRequest(path, body, token = '') {
  let response;
  try {
    const action = path === 'token?grant_type=password' ? 'password'
      : path === 'token?grant_type=refresh_token' ? 'refresh'
        : path;
    response = await fetch('/api/auth', { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ action, payload: body || {} }) });
  } catch {
    throw Object.assign(new Error('auth_unavailable'), { code: 'auth_unavailable', status: 503 });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const rawCode = data.error_code || data.error || data.code || 'auth_failed';
    const code = normalizeAuthErrorCode(rawCode);
    throw Object.assign(new Error(data.error_description || data.msg || data.message || rawCode), { code, status: response.status });
  }
  return data;
}
export async function signIn(email, password) { return save(await authRequest('token?grant_type=password', { email, password })); }
export async function signUp(email, password) {
  const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/login/` : '';
  return save(await authRequest('signup', { email, password, ...(redirectTo ? { redirect_to: redirectTo } : {}) }));
}
export async function resendVerification(email) {
  return authRequest('resend', { type: 'signup', email: String(email || '').trim() });
}
export async function signOut() { const session = getSession(); if (session?.access_token) await authRequest('logout', {}, session.access_token).catch(() => {}); save(null); }
export async function refreshSession() {
  const session = getSession();
  if (!session?.refresh_token) return null;
  try { return save(await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token })); } catch { save(null); return null; }
}
export async function ensureSession() {
  const session = getSession();
  if (!session) return null;
  return sessionExpired(session) ? refreshSession() : session;
}
export async function authConfigReady() { return Boolean((await config()).ready); }
