import { allowMethod, json, readJson } from './shared.js';
import { supabaseConfig } from './auth.js';

const ACTIONS = new Map([
  ['password', 'token?grant_type=password'],
  ['refresh', 'token?grant_type=refresh_token'],
  ['signup', 'signup'],
  ['resend', 'resend'],
  ['logout', 'logout']
]);

function safeAction(body = {}) {
  const action = String(body.action || '').trim();
  if (ACTIONS.has(action)) return action;
  if (action === 'token?grant_type=password') return 'password';
  if (action === 'token?grant_type=refresh_token') return 'refresh';
  throw Object.assign(new Error('auth_invalid_request'), { code: 'auth_invalid_request', status: 400 });
}

function bearer(req) {
  const value = req.headers?.authorization || req.headers?.Authorization || '';
  return String(value).replace(/^Bearer\s+/i, '').trim();
}

function publicUpstreamError(data = {}) {
  const code = String(data.error_code || data.error || data.code || 'auth_failed').slice(0, 80);
  const description = String(data.error_description || data.msg || data.message || '').slice(0, 240);
  return { error_code: code, error_description: description };
}

function upstreamFailureCode(error) {
  const code = String(error?.cause?.code || error?.code || '').toUpperCase();
  return ['ENOTFOUND', 'EAI_AGAIN'].includes(code) ? 'auth_configuration_unreachable' : 'auth_unavailable';
}

export default async function handler(req, res) {
  if (!allowMethod(req, res, 'POST')) return;
  try {
    const body = await readJson(req);
    const action = safeAction(body);
    const config = supabaseConfig();
    if (!config.url || !config.anonKey) throw Object.assign(new Error('auth_not_configured'), { code: 'auth_not_configured', status: 503 });
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    const token = bearer(req);
    let response;
    try {
      response = await fetch(`${config.url}/auth/v1/${ACTIONS.get(action)}`, {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${token || config.anonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      const code = upstreamFailureCode(error);
      throw Object.assign(new Error(code), { code, status: 503 });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json(res, response.status, publicUpstreamError(data));
    return json(res, response.status || 200, action === 'logout' && response.status === 204 ? { ok: true } : data);
  } catch (error) {
    const code = ['auth_invalid_request', 'auth_not_configured', 'auth_configuration_unreachable', 'auth_unavailable'].includes(error?.code) ? error.code : 'auth_unavailable';
    const status = code === 'auth_invalid_request' ? 400 : 503;
    return json(res, status, { ok: false, error: code });
  }
}
