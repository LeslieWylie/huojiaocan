import { allowMethod, json, readJson } from '../serverless/shared.js';
import { createDeepSeekClient, DeepSeekError } from '../serverless/deepseek.js';
import {
  decryptSecret, encryptSecret, keyHint, keyFingerprint, publicKeyRecord, requireUser,
  safeAuthResponse, supabaseConfig, supabaseRest, validateDeepSeekKey, validDeepSeekModel
} from '../serverless/auth.js';

function routePath(req) {
  if (req.query?.path) return `/${String(req.query.path).replace(/^\/+/, '')}`;
  try { return new URL(req.url, 'http://local').pathname.replace(/^\/api\/ai/, '') || '/'; } catch { return '/'; }
}

function keyIdFromPath(path) {
  const match = path.match(/^\/keys\/([^/]+)(?:\/([^/]+))?$/);
  return match ? { id: decodeURIComponent(match[1]), action: match[2] || '' } : null;
}
function userRest(user, path, options = {}) { return supabaseRest(path, { ...options, authToken: user.token }); }

async function ownedKey(user, id, env) {
  const rows = await userRest(user, 'user_deepseek_keys', { env, query: { select: '*', id: `eq.${id}`, user_id: `eq.${user.id}`, limit: '1' } });
  const record = Array.isArray(rows) ? rows[0] : null;
  if (!record) throw Object.assign(new Error('key_not_found'), { code: 'key_not_found', status: 404 });
  return record;
}

async function activeKey(user, requestedId, env) {
  if (requestedId) return ownedKey(user, requestedId, env);
  const rows = await userRest(user, 'user_deepseek_keys', { env, query: { select: '*', user_id: `eq.${user.id}`, is_active: 'eq.true', order: 'created_at.desc', limit: '1' } });
  const record = Array.isArray(rows) ? rows[0] : null;
  if (!record) throw Object.assign(new Error('key_not_found'), { code: 'key_not_found', status: 404 });
  return record;
}

export async function resolveActiveDeepSeekKey(user, requestedId, env = process.env) {
  const record = await activeKey(user, requestedId, env);
  const config = supabaseConfig(env);
  return { record, apiKey: decryptSecret(record, config.encryptionSecret), model: record.model };
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    const path = routePath(req);
    if (path === '/providers') {
      if (!allowMethod(req, res, 'GET')) return;
      return json(res, 200, { providers: [{ id: 'deepseek', label: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] }] });
    }
    if (path === '/keys' && req.method === 'GET') {
      const rows = await userRest(user, 'user_deepseek_keys', { query: { select: 'id,model,key_hint,is_active,last_test_status,last_tested_at,created_at,updated_at', user_id: `eq.${user.id}`, order: 'created_at.desc' } });
      return json(res, 200, { provider: 'deepseek', keys: (Array.isArray(rows) ? rows : []).map(publicKeyRecord) });
    }
    if (path === '/keys' && req.method === 'POST') {
      const body = await readJson(req);
      const key = validateDeepSeekKey(body.apiKey || body.key);
      const model = body.model || 'deepseek-v4-flash';
      if (!validDeepSeekModel(model)) throw Object.assign(new Error('key_invalid'), { code: 'key_invalid', status: 400 });
      const config = supabaseConfig();
      const encrypted = encryptSecret(key, config.encryptionSecret);
      const existing = await userRest(user, 'user_deepseek_keys', { query: { select: 'id', user_id: `eq.${user.id}`, key_fingerprint: `eq.${keyFingerprint(key)}`, limit: '1' } });
      if (Array.isArray(existing) && existing.length) throw Object.assign(new Error('key_already_exists'), { code: 'key_already_exists', status: 409 });
      const row = await userRest(user, 'user_deepseek_keys', {
        method: 'POST',
        body: {
          user_id: user.id,
          provider: 'deepseek',
          model,
          key_ciphertext: encrypted.ciphertext,
          key_iv: encrypted.iv,
          key_tag: encrypted.tag,
          key_fingerprint: keyFingerprint(key),
          key_hint: keyHint(key),
          is_active: !Array.isArray(existing) || existing.length === 0,
          last_test_status: 'untested'
        }
      });
      return json(res, 201, { key: publicKeyRecord(Array.isArray(row) ? row[0] : row) });
    }
    const keyRoute = keyIdFromPath(path);
    if (keyRoute && keyRoute.action === 'test' && req.method === 'POST') {
      const record = await ownedKey(user, keyRoute.id);
      const config = supabaseConfig();
      const apiKey = decryptSecret(record, config.encryptionSecret);
      const client = createDeepSeekClient({ apiKey, model: record.model });
      let status = 'invalid';
      try {
        await client.testKey();
        status = 'valid';
      } catch (error) {
        await userRest(user, 'user_deepseek_keys', { method: 'PATCH', body: { last_test_status: status, last_tested_at: new Date().toISOString() }, query: { id: `eq.${record.id}`, user_id: `eq.${user.id}` } });
        throw error;
      }
      const rows = await userRest(user, 'user_deepseek_keys', { method: 'PATCH', body: { last_test_status: status, last_tested_at: new Date().toISOString() }, query: { id: `eq.${record.id}`, user_id: `eq.${user.id}` } });
      return json(res, 200, { ok: true, key: publicKeyRecord(Array.isArray(rows) ? rows[0] : { ...record, last_test_status: status, last_tested_at: new Date().toISOString() }) });
    }
    if (keyRoute && keyRoute.action === 'activate' && req.method === 'POST') {
      const record = await ownedKey(user, keyRoute.id);
      await userRest(user, 'user_deepseek_keys', { method: 'PATCH', body: { is_active: false }, query: { user_id: `eq.${user.id}` } });
      const rows = await userRest(user, 'user_deepseek_keys', { method: 'PATCH', body: { is_active: true }, query: { id: `eq.${record.id}`, user_id: `eq.${user.id}` } });
      return json(res, 200, { key: publicKeyRecord(Array.isArray(rows) ? rows[0] : { ...record, is_active: true }) });
    }
    if (keyRoute && !keyRoute.action && req.method === 'DELETE') {
      const record = await ownedKey(user, keyRoute.id);
      await userRest(user, 'user_deepseek_keys', { method: 'DELETE', query: { id: `eq.${record.id}`, user_id: `eq.${user.id}` } });
      return json(res, 200, { ok: true, deleted: record.id });
    }
    return json(res, 404, { ok: false, error: 'route_not_found' });
  } catch (error) {
    if (error instanceof DeepSeekError) error.code = error.message;
    return safeAuthResponse(res, error);
  }
}
