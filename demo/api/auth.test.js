import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../serverless/auth-proxy.js';

function responseCapture() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { this.payload = value ? JSON.parse(value) : null; }
  };
}

function request(body, headers = {}) {
  return { method: 'POST', headers, body };
}

test('same-origin auth proxy only forwards allowlisted Supabase actions', async () => {
  const previous = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
  };
  const calls = [];
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ access_token: 'session-token', refresh_token: 'refresh-token' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = responseCapture();
    await handler(request({ action: 'password', payload: { email: 'teacher@example.com', password: 'password' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.access_token, 'session-token');
    assert.equal(calls[0].url, 'https://example.supabase.co/auth/v1/token?grant_type=password');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer anon-test-key');
    assert.equal(calls[0].options.body.includes('teacher@example.com'), true);
    assert.equal(calls[0].options.body.includes('anon-test-key'), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('same-origin auth proxy rejects arbitrary upstream paths and sanitizes errors', async () => {
  const previous = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY };
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'invalid credentials', sensitive: 'do-not-forward' }), { status: 400, headers: { 'content-type': 'application/json' } });
  try {
    const invalid = responseCapture();
    await handler(request({ action: 'https://attacker.example/path' }), invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.payload.error, 'auth_invalid_request');

    const failed = responseCapture();
    await handler(request({ action: 'password', payload: {} }), failed);
    assert.equal(failed.statusCode, 400);
    assert.deepEqual(failed.payload, { error_code: 'invalid_grant', error_description: 'invalid credentials' });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('same-origin auth proxy distinguishes an unreachable configured project', async () => {
  const previous = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY };
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://missing-project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  globalThis.fetch = async () => {
    const error = new TypeError('fetch failed');
    error.cause = { code: 'ENOTFOUND' };
    throw error;
  };
  try {
    const res = responseCapture();
    await handler(request({ action: 'password', payload: { email: 'teacher@example.com', password: '123456' } }), res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.payload, { ok: false, error: 'auth_configuration_unreachable' });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
