import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekClient, DeepSeekError } from './deepseek.js';

test('DeepSeek client uses fixed official endpoint and JSON output without returning key', async () => {
  let request;
  const client = createDeepSeekClient({ apiKey: 'sk-test-secret-value', model: 'deepseek-v4-flash', fetchImpl: async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ model: 'deepseek-v4-flash', choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }), { status: 200 });
  } });
  const result = await client.chat({ messages: [{ role: 'user', content: 'hello' }], responseFormat: true });
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer sk-test-secret-value');
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.thinking.type, 'disabled');
  assert.equal(result.content, '{"ok":true}');
  assert.equal(JSON.stringify(result).includes('sk-test-secret-value'), false);
});

test('DeepSeek client maps auth and malformed response errors', async () => {
  const unauthorized = createDeepSeekClient({ apiKey: 'sk-test', fetchImpl: async () => new Response('{}', { status: 401 }) });
  await assert.rejects(() => unauthorized.chat({ messages: [{ role: 'user', content: 'x' }] }), error => error instanceof DeepSeekError && error.code === 'deepseek_unauthorized');
  const malformed = createDeepSeekClient({ apiKey: 'sk-test', fetchImpl: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }) });
  await assert.rejects(() => malformed.chat({ messages: [{ role: 'user', content: 'x' }] }), error => error instanceof DeepSeekError && error.code === 'deepseek_invalid_response');
});
