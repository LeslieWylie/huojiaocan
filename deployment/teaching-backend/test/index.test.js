import assert from 'node:assert/strict';
import test from 'node:test';
import handler, { forwardTeachingRequest } from '../src/index.js';

test('service binding proxy forwards only execute/save with the internal secret', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ result: { ok: true } });
  };
  const response = await forwardTeachingRequest(new Request('https://internal/execute', {
    method: 'POST', body: JSON.stringify({ requestId: 'r1' })
  }), {
    TEACHING_ORIGIN: 'https://example.vercel.app/path',
    AGENT_INTERNAL_SECRET: 'secret'
  }, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, 'https://example.vercel.app/api/agent-internal');
  assert.equal(calls[0].options.headers['X-Agent-Internal-Secret'], 'secret');
  assert.deepEqual(JSON.parse(calls[0].options.body), { action: 'execute', requestId: 'r1' });
  assert.equal((await forwardTeachingRequest(new Request('https://internal/other', { method: 'POST' }), {}, fetchImpl)).status, 404);
});

test('worker handler does not pass ExecutionContext as fetch', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ result: { ok: true } });
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await handler.fetch(new Request('https://internal/execute', {
    method: 'POST', body: JSON.stringify({ requestId: 'r1' })
  }), {
    TEACHING_ORIGIN: 'https://example.vercel.app',
    AGENT_INTERNAL_SECRET: 'secret'
  }, { waitUntil() {} });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: { ok: true } });
});
