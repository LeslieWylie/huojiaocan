import crypto from 'node:crypto';
import { json } from './shared.js';

function envValue(env, key) {
  return typeof env?.[key] === 'string' ? env[key].trim() : '';
}

export class AuthError extends Error {
  constructor(code, status = 401) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

export class DataStoreError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = 'DataStoreError';
    this.code = code;
    this.status = status;
  }
}

export function supabaseConfig(env = process.env) {
  return {
    url: envValue(env, 'SUPABASE_URL').replace(/\/$/, ''),
    serviceKey: envValue(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    anonKey: envValue(env, 'SUPABASE_ANON_KEY'),
    encryptionSecret: envValue(env, 'USER_DEEPSEEK_KEY_ENCRYPTION_SECRET')
  };
}

export function authConfigStatus(env = process.env) {
  const config = supabaseConfig(env);
  return {
    supabaseConfigured: Boolean(config.url && config.anonKey),
    databaseConfigured: Boolean(config.url && (config.serviceKey || config.anonKey)),
    keyEncryptionConfigured: Boolean(config.encryptionSecret)
  };
}

function authHeader(req) {
  const headers = req?.headers || {};
  return headers.authorization || headers.Authorization || '';
}

function bearerToken(req) {
  const value = String(authHeader(req) || '').trim();
  return value.replace(/^Bearer\s+/i, '').trim();
}

export async function requireUser(req, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = bearerToken(req);
  if (!token) throw new AuthError('auth_required', 401);
  const config = supabaseConfig(env);
  if (!config.url || !config.anonKey || typeof fetchImpl !== 'function') {
    throw new AuthError('auth_not_configured', 503);
  }
  let response;
  try {
    response = await fetchImpl(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` }
    });
  } catch {
    throw new AuthError('auth_unavailable', 503);
  }
  if (!response.ok) throw new AuthError('auth_invalid', 401);
  const user = await response.json().catch(() => null);
  if (!user || typeof user.id !== 'string') throw new AuthError('auth_invalid', 401);
  return { id: user.id, email: typeof user.email === 'string' ? user.email : '', token };
}

function encodeQueryValue(value) {
  return encodeURIComponent(String(value));
}

export async function supabaseRest(path, { method = 'GET', body, query, env = process.env, fetchImpl = globalThis.fetch, authToken = '' } = {}) {
  const config = supabaseConfig(env);
  const apiKey = config.serviceKey || config.anonKey;
  if (!config.url || !apiKey) throw new DataStoreError('database_not_configured');
  const url = new URL(`${config.url}/rest/v1/${String(path).replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${authToken || config.serviceKey || apiKey}`,
        'Content-Type': 'application/json',
        Prefer: method === 'POST' || method === 'PATCH' || method === 'DELETE' ? 'return=representation' : 'return=minimal'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new DataStoreError('database_unavailable');
  }
  if (!response.ok) throw new DataStoreError('database_request_failed', response.status >= 400 && response.status < 500 ? 400 : 503);
  return response.status === 204 ? [] : response.json().catch(() => []);
}

function encryptionKey(secret) {
  if (!secret) throw new DataStoreError('key_encryption_not_configured');
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

export function decryptSecret(record, secret) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(record.key_iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.key_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(record.key_ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new DataStoreError('key_decrypt_failed', 503);
  }
}

export function keyHint(value) {
  const text = String(value || '');
  return text.length >= 4 ? `••••${text.slice(-4)}` : '已保存';
}

export function keyFingerprint(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

export function validDeepSeekModel(value) {
  return value === 'deepseek-v4-flash' || value === 'deepseek-v4-pro';
}

export function validateDeepSeekKey(value) {
  const key = String(value || '').trim();
  if (!/^sk-[A-Za-z0-9_-]{8,}$/.test(key)) throw new DataStoreError('key_invalid', 400);
  return key;
}

export function publicKeyRecord(record) {
  return {
    id: record.id,
    provider: 'deepseek',
    model: record.model,
    keyHint: record.key_hint,
    isActive: Boolean(record.is_active),
    lastTestStatus: record.last_test_status || 'untested',
    lastTestedAt: record.last_tested_at || null,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

export function safeAuthResponse(res, error) {
  const code = String(error?.code || error?.message || 'request_failed');
  const known = new Set([
    'auth_required', 'auth_invalid', 'auth_not_configured', 'auth_unavailable',
    'auth_rate_limited', 'email_not_confirmed', 'user_already_exists',
    'database_not_configured', 'database_unavailable', 'database_request_failed', 'classroom_run_confirmed',
    'classroom_moment_triage_confirmed', 'classroom_moment_triage_stale', 'classroom_moment_triage_incomplete', 'classroom_carryover_not_found', 'classroom_carryover_status_invalid',
    'rehearsal_evidence_required', 'rehearsal_confirmed', 'rehearsal_not_found', 'rehearsal_stale', 'rehearsal_incomplete',
    'preclass_pulse_evidence_required', 'preclass_pulse_confirmed', 'preclass_pulse_not_found', 'preclass_pulse_stale', 'preclass_pulse_incomplete', 'preclass_pulse_counts_invalid', 'preclass_pulse_contains_identifier',
    'learning_evidence_questions_required', 'learning_evidence_confirmed', 'learning_evidence_not_found', 'learning_evidence_stale', 'learning_evidence_incomplete', 'learning_evidence_counts_invalid', 'student_sample_contains_contact', 'homework_marking_requires_confirmed_pack', 'homework_marking_pack_stale', 'homework_marking_task_not_found', 'homework_marking_responses_invalid', 'homework_marking_contains_identifier', 'homework_marking_invalid_response', 'homework_review_not_found', 'homework_review_stale', 'homework_review_confirmed', 'homework_review_incomplete', 'citation_outside_lesson', 'citation_document_forbidden', 'citation_text_mismatch', 'lesson_change_requires_new_draft', 'deliberation_confirmed', 'deliberation_not_found', 'deliberation_stale', 'deliberation_incomplete', 'deliberation_invalid_response',
    'key_encryption_not_configured', 'key_decrypt_failed', 'key_invalid', 'key_already_exists',
    'key_not_found', 'key_not_owned', 'deepseek_unauthorized', 'deepseek_forbidden',
    'deepseek_rate_limited', 'deepseek_timeout', 'deepseek_unavailable',
    'deepseek_invalid_response', 'deepseek_invalid_request', 'deepseek_request_failed',
    'gateway_not_configured', 'gateway_invalid_url', 'gateway_invalid_request', 'gateway_unauthorized',
    'gateway_forbidden', 'gateway_rate_limited', 'gateway_timeout', 'gateway_unavailable',
    'gateway_invalid_response', 'gateway_request_failed',
    'pageindex_unavailable', 'pageindex_unauthorized', 'pageindex_forbidden', 'pageindex_rate_limited',
    'pageindex_timeout', 'pageindex_invalid_request', 'pageindex_invalid_response', 'pageindex_request_failed',
    'pageindex_not_found', 'pageindex_method_not_allowed', 'evidence_insufficient', 'card_generation_failed',
    'draft_not_found', 'draft_not_owned', 'card_not_found', 'card_locked', 'index_write_forbidden',
    'edit_conflict', 'version_required', 'plan_incomplete', 'plan_confirmation_required',
    'revision_not_found', 'asset_not_found', 'asset_not_owned', 'unit_lesson_not_found', 'unit_lesson_not_next',
    'unit_context_required', 'lesson_reflection_required', 'operation_id_required',
    'share_not_found', 'share_token_invalid', 'share_service_not_configured',
    'share_public_evidence_required', 'share_cards_required', 'method_not_allowed'
  ]);
  const safe = known.has(code) ? code : 'request_failed';
  const status = safe === 'auth_required' || safe === 'auth_invalid' || safe === 'email_not_confirmed' || safe === 'key_not_owned' || safe === 'draft_not_owned' ? 401
    : safe.endsWith('_not_found') ? 404
      : safe === 'card_locked' || safe === 'edit_conflict' || safe === 'plan_confirmation_required' || safe === 'rehearsal_confirmed' || safe === 'rehearsal_stale' || safe === 'preclass_pulse_confirmed' || safe === 'preclass_pulse_stale' || safe === 'learning_evidence_confirmed' || safe === 'learning_evidence_stale' || safe === 'homework_marking_requires_confirmed_pack' || safe === 'homework_marking_pack_stale' || safe === 'homework_review_confirmed' || safe === 'homework_review_stale' || safe === 'deliberation_confirmed' || safe === 'deliberation_stale' || safe === 'classroom_moment_triage_confirmed' || safe === 'classroom_moment_triage_stale' || safe === 'lesson_change_requires_new_draft' || safe === 'unit_context_required' || safe === 'unit_lesson_not_next' || safe === 'lesson_reflection_required' || safe === 'user_already_exists' ? 409
          : safe === 'evidence_insufficient' || safe === 'plan_incomplete' || safe === 'classroom_moment_triage_incomplete' || safe === 'classroom_carryover_status_invalid' || safe === 'learning_evidence_incomplete' || safe === 'homework_review_incomplete' || safe === 'deliberation_incomplete' || safe === 'share_public_evidence_required' || safe === 'share_cards_required' || safe === 'citation_outside_lesson' || safe === 'citation_document_forbidden' || safe === 'citation_text_mismatch' ? 422
            : safe === 'deliberation_invalid_response' || safe === 'homework_marking_invalid_response' ? 502
          : safe.includes('required') || safe === 'learning_evidence_counts_invalid' || safe === 'student_sample_contains_contact' || safe === 'homework_marking_responses_invalid' || safe === 'homework_marking_contains_identifier' || safe === 'key_invalid' || safe === 'key_already_exists' || safe === 'deepseek_invalid_request' ? (safe === 'key_already_exists' ? 409 : 400)
          : safe.includes('unavailable') || safe.includes('timeout') || safe.includes('rate_limited') || safe.includes('not_configured') ? 503
            : Number(error?.status) >= 400 && Number(error?.status) < 500 ? Number(error.status) : 500;
  return json(res, status, { ok: false, error: safe });
}
