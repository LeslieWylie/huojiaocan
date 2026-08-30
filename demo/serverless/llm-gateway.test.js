import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GatewayError,
  callGatewayChatCompletion,
  createGatewayClient,
  gatewayChatCompletionsUrl,
  gatewayErrorForStatus,
  normalizeChatCompletion,
  normalizeGatewayBaseUrl
} from './llm-gateway.js';

const secret = 'test-only-gateway-secret';
const messages = [{ role: 'user', content: '请用一句话回答。' }];

function assertGatewayError(error, code) {
  assert.ok(error instanceof GatewayError);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  assert.doesNotMatch(JSON.stringify(error), /test-only-gateway-secret/);
  assert.doesNotMatch(String(error.stack), /test-only-gateway-secret/);
}

test('normalizes gateway roots and /v1 bases without duplicate /v1', () => {
  assert.equal(normalizeGatewayBaseUrl('https://gateway.example'), 'https://gateway.example/v1');
  assert.equal(normalizeGatewayBaseUrl('https://gateway.example/'), 'https://gateway.example/v1');
  assert.equal(normalizeGatewayBaseUrl('https://gateway.example/v1'), 'https://gateway.example/v1');
  assert.equal(normalizeGatewayBaseUrl('https://gateway.example/v1/'), 'https://gateway.example/v1');
  assert.equal(normalizeGatewayBaseUrl('https://gateway.example/proxy/v1/v1/'), 'https://gateway.example/proxy/v1');
  assert.equal(gatewayChatCompletionsUrl('https://gateway.example'), 'https://gateway.example/v1/chat/completions');
  assert.equal(gatewayChatCompletionsUrl('https://gateway.example/v1/'), 'https://gateway.example/v1/chat/completions');
});

test('rejects missing, malformed, credential-bearing, or query-bearing base URLs', () => {
  for (const value of ['', '   ', 'not a url', 'ftp://gateway.example', 'https://user:pass@gateway.example', 'https://gateway.example?token=secret']) {
    assert.throws(() => normalizeGatewayBaseUrl(value), error => {
      assertGatewayError(error, value.trim() ? 'gateway_invalid_url' : 'gateway_not_configured');
      return true;
    });
  }
});

test('calls /v1/chat/completions for a root gateway and projects only safe fields', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({
      id: 'completion-1',
      model: 'test-model',
      choices: [{ message: { role: 'assistant', content: '安全的回答' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      debug: { upstreamUrl: 'https://internal.example', apiKey: secret }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await callGatewayChatCompletion({ messages, temperature: 0.2, maxTokens: 80 }, {
    baseUrl: 'https://gateway.example',
    apiKey: secret,
    model: 'test-model',
    timeoutMs: 1000,
    fetchImpl
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://gateway.example/v1/chat/completions');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${secret}`);
  const payload = JSON.parse(calls[0].options.body);
  assert.deepEqual(payload.messages, messages);
  assert.equal(payload.model, 'test-model');
  assert.equal(payload.temperature, 0.2);
  assert.equal(payload.max_tokens, 80);
  assert.deepEqual(result, {
    id: 'completion-1',
    model: 'test-model',
    content: '安全的回答',
    finishReason: 'stop',
    usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 }
  });
  assert.doesNotMatch(JSON.stringify(result), /internal\.example|apiKey|test-only-gateway-secret/);
});

test('uses injected fetch and does not duplicate /v1 for a versioned base', async () => {
  let requestedUrl = '';
  let invoked = false;
  const fetchImpl = async url => {
    invoked = true;
    requestedUrl = String(url);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };

  await createGatewayClient({
    baseUrl: 'https://gateway.example/v1/',
    apiKey: secret,
    model: 'test-model',
    fetchImpl
  }).chatCompletions({ messages });

  assert.equal(invoked, true);
  assert.equal(requestedUrl, 'https://gateway.example/v1/chat/completions');
  assert.doesNotMatch(requestedUrl, /\/v1\/v1/);
});

test('maps missing upstream response to a retryable request failure', () => {
  const error = gatewayErrorForStatus(0);
  assertGatewayError(error, 'gateway_request_failed');
  assert.equal(error.retryable, true);
});

test('maps upstream statuses to stable GatewayError codes without upstream body', async () => {
  const cases = [
    [401, 'gateway_unauthorized'],
    [403, 'gateway_forbidden'],
    [404, 'gateway_invalid_request'],
    [408, 'gateway_timeout'],
    [429, 'gateway_rate_limited'],
    [500, 'gateway_unavailable'],
    [503, 'gateway_unavailable'],
    [400, 'gateway_invalid_request']
  ];

  for (const [status, code] of cases) {
    const fetchImpl = async () => new Response(JSON.stringify({ error: `sensitive-${secret}` }), { status });
    await assert.rejects(
      createGatewayClient({ baseUrl: 'https://gateway.example', apiKey: secret, model: 'test-model', fetchImpl }).chatCompletions({ messages }),
      error => {
        assertGatewayError(error, code);
        assert.equal(error.status, status);
        return true;
      }
    );
  }
});

test('maps timeout and network failures without exposing the thrown error', async () => {
  const timeoutFetch = async () => {
    const error = new Error(`network-sensitive-${secret}`);
    error.name = 'AbortError';
    throw error;
  };
  await assert.rejects(
    createGatewayClient({ baseUrl: 'https://gateway.example', apiKey: secret, model: 'test-model', fetchImpl: timeoutFetch }).chatCompletions({ messages }),
    error => {
      assertGatewayError(error, 'gateway_timeout');
      assert.equal(error.retryable, true);
      return true;
    }
  );

  const networkFetch = async () => { throw new Error(`network-sensitive-${secret}`); };
  await assert.rejects(
    createGatewayClient({ baseUrl: 'https://gateway.example', apiKey: secret, model: 'test-model', fetchImpl: networkFetch }).chatCompletions({ messages }),
    error => {
      assertGatewayError(error, 'gateway_request_failed');
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test('maps malformed JSON, empty choices, and missing content to gateway_invalid_response', async () => {
  const malformedFetch = async () => new Response('{malformed', { status: 200 });
  await assert.rejects(
    createGatewayClient({ baseUrl: 'https://gateway.example', apiKey: secret, model: 'test-model', fetchImpl: malformedFetch }).chatCompletions({ messages }),
    error => { assertGatewayError(error, 'gateway_invalid_response'); return true; }
  );

  for (const body of [{}, { choices: [] }, { choices: [{ message: {} }] }]) {
    const fetchImpl = async () => new Response(JSON.stringify(body), { status: 200 });
    await assert.rejects(
      createGatewayClient({ baseUrl: 'https://gateway.example', apiKey: secret, model: 'test-model', fetchImpl }).chatCompletions({ messages }),
      error => { assertGatewayError(error, 'gateway_invalid_response'); return true; }
    );
  }
});

test('fails closed when configuration or request input is incomplete', async () => {
  await assert.rejects(
    createGatewayClient({ baseUrl: 'https://gateway.example', apiKey: '', model: 'test-model', fetchImpl: async () => { throw new Error('must not call'); } }).chatCompletions({ messages }),
    error => { assertGatewayError(error, 'gateway_not_configured'); return true; }
  );
  await assert.rejects(
    createGatewayClient({ baseUrl: 'https://gateway.example', apiKey: secret, model: '', fetchImpl: async () => { throw new Error('must not call'); } }).chatCompletions({ messages }),
    error => { assertGatewayError(error, 'gateway_not_configured'); return true; }
  );
  await assert.rejects(
    createGatewayClient({ baseUrl: 'https://gateway.example', apiKey: secret, model: 'test-model', fetchImpl: async () => { throw new Error('must not call'); } }).chatCompletions({ messages: [] }),
    error => { assertGatewayError(error, 'gateway_invalid_request'); return true; }
  );
});

test('normalizes text content arrays without returning upstream fields', () => {
  assert.deepEqual(normalizeChatCompletion({
    id: 'completion-2',
    choices: [{ message: { content: [{ type: 'text', text: '一' }, { type: 'text', text: '二' }] } }],
    sensitive: secret
  }), {
    id: 'completion-2',
    model: undefined,
    content: '一二',
    finishReason: undefined,
    usage: undefined
  });
});
