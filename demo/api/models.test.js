import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelsHandler, normalizeModelList } from './models.js';

const secret = 'test-only-model-secret';

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    end(value = '') { this.payload = value ? JSON.parse(value) : undefined; return this; }
  };
}

async function call(handler, { env, fetchImpl, method = 'GET' } = {}) {
  const req = { method };
  const res = mockResponse();
  await handler(req, res);
  return res;
}

test('normalizes model lists and drops upstream diagnostics', () => {
  assert.deepEqual(normalizeModelList({
    object: 'list',
    data: [
      { id: 'mlamp/deepseek-v4-flash', object: 'model', owned_by: 'gateway', debug: { key: secret } },
      { id: '  ', internalUrl: 'https://internal.example' },
      null
    ],
    api_key: secret
  }), {
    object: 'list',
    data: [{ id: 'mlamp/deepseek-v4-flash', object: 'model', owned_by: 'gateway' }]
  });
});

test('calls /v1/models for a root gateway and sends server-side authorization', async () => {
  const calls = [];
  const handler = createModelsHandler({
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.example/', LLM_GATEWAY_API_KEY: secret },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ data: [{ id: 'test-model', owned_by: 'provider', debug: secret }] }), { status: 200 });
    }
  });

  const res = await call(handler);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    object: 'list',
    data: [{ id: 'test-model', object: 'model', owned_by: 'provider' }]
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://gateway.example/v1/models');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${secret}`);
  assert.doesNotMatch(JSON.stringify(res.payload), /test-only-model-secret|internal\.example|debug/);
});

test('does not produce /v1/v1/models for an already-versioned gateway', async () => {
  let requestedUrl = '';
  const handler = createModelsHandler({
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.example/v1/', LLM_GATEWAY_API_KEY: secret },
    fetchImpl: async url => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), { status: 200 });
    }
  });

  const res = await call(handler);
  assert.equal(res.statusCode, 200);
  assert.equal(requestedUrl, 'https://gateway.example/v1/models');
  assert.doesNotMatch(requestedUrl, /\/v1\/v1/);
});

test('maps upstream errors to stable public codes without upstream body', async () => {
  const cases = [
    [401, 502, 'gateway_unauthorized'],
    [403, 502, 'gateway_forbidden'],
    [404, 502, 'gateway_invalid_request'],
    [408, 504, 'gateway_timeout'],
    [429, 429, 'gateway_rate_limited'],
    [500, 503, 'gateway_unavailable'],
    [400, 502, 'gateway_invalid_request']
  ];

  for (const [upstreamStatus, publicStatus, code] of cases) {
    const handler = createModelsHandler({
      env: { LLM_GATEWAY_BASE_URL: 'https://gateway.example', LLM_GATEWAY_API_KEY: secret },
      fetchImpl: async () => new Response(JSON.stringify({ error: `sensitive-${secret}`, internalUrl: 'https://internal.example' }), { status: upstreamStatus })
    });
    const res = await call(handler);
    assert.equal(res.statusCode, publicStatus);
    assert.deepEqual(res.payload, { error: code });
    assert.doesNotMatch(JSON.stringify(res.payload), /sensitive|internal|test-only-model-secret/);
  }
});

test('maps network failure, timeout, malformed JSON, and invalid model lists safely', async () => {
  const network = createModelsHandler({
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.example', LLM_GATEWAY_API_KEY: secret },
    fetchImpl: async () => { throw new Error(`network-sensitive-${secret}`); }
  });
  let res = await call(network);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.payload, { error: 'gateway_request_failed' });

  const timeout = createModelsHandler({
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.example', LLM_GATEWAY_API_KEY: secret, LLM_GATEWAY_TIMEOUT_MS: '5' },
    fetchImpl: async (_url, { signal }) => await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'AbortError' })), { once: true });
    })
  });
  res = await call(timeout);
  assert.equal(res.statusCode, 504);
  assert.deepEqual(res.payload, { error: 'gateway_timeout' });

  const malformed = createModelsHandler({
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.example', LLM_GATEWAY_API_KEY: secret },
    fetchImpl: async () => new Response('{malformed', { status: 200 })
  });
  res = await call(malformed);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.payload, { error: 'gateway_invalid_response' });

  for (const body of [{}, { data: [{}] }, { data: 'not-an-array' }]) {
    const invalid = createModelsHandler({
      env: { LLM_GATEWAY_BASE_URL: 'https://gateway.example', LLM_GATEWAY_API_KEY: secret },
      fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 })
    });
    res = await call(invalid);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.payload, { error: 'gateway_invalid_response' });
  }
});

test('fails closed before fetch when configuration or method is invalid', async () => {
  let invoked = false;
  const fetchImpl = async () => { invoked = true; throw new Error('must not call'); };
  const missingKey = createModelsHandler({
    env: { LLM_GATEWAY_BASE_URL: 'https://gateway.example' },
    fetchImpl
  });
  let res = await call(missingKey);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'gateway_not_configured' });
  assert.equal(invoked, false);

  const invalidUrl = createModelsHandler({
    env: { LLM_GATEWAY_BASE_URL: 'not a url', LLM_GATEWAY_API_KEY: secret },
    fetchImpl
  });
  res = await call(invalidUrl);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.payload, { error: 'gateway_invalid_url' });
  assert.equal(invoked, false);

  res = await call(invalidUrl, { method: 'POST' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET');
});
