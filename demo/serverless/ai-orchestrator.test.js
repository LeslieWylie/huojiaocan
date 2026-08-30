import assert from 'node:assert/strict';
import test from 'node:test';
import { createStructuredModel, parseStructuredJson, runStructuredReviewLoop } from './ai-orchestrator.js';

test('structured JSON parser accepts fenced output but rejects arrays', () => {
  assert.deepEqual(parseStructuredJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.equal(parseStructuredJson('[{"ok":true}]'), null);
});

test('system model retries one transient provider failure within one workflow budget', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('{"error":"busy"}', { status: 503 });
    return new Response(JSON.stringify({
      model: 'test-model',
      choices: [{ message: { content: '{"answer":"ok"}' } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const model = createStructuredModel({
    env: {
      LLM_GATEWAY_BASE_URL: 'https://gateway.test',
      LLM_GATEWAY_API_KEY: 'test-key',
      LLM_GATEWAY_MODEL: 'test-model',
      LLM_GATEWAY_TIMEOUT_MS: '1000',
      AI_WORKFLOW_TIMEOUT_MS: '20000'
    }
  });
  const result = await model.completeJson({ messages: [{ role: 'user', content: 'test' }] });
  assert.equal(calls, 2);
  assert.deepEqual(result.value, { answer: 'ok' });
});

test('review loop keeps the valid draft when an optional review fails', async () => {
  let calls = 0;
  const model = {
    configured: true,
    remainingMs: () => 20_000,
    async completeJson() {
      calls += 1;
      if (calls === 1) return { completion: { model: 'test' }, value: { answer: { summary: 'draft' } } };
      throw Object.assign(new Error('gateway_timeout'), { retryable: true });
    }
  };
  const result = await runStructuredReviewLoop({
    model,
    initialMessages: [{ role: 'user', content: 'draft' }],
    reviewMessages: () => [{ role: 'user', content: 'review' }]
  });
  assert.equal(result.value.answer.summary, 'draft');
  assert.equal(result.trace[1].status, 'fallback_to_draft');
});

test('review loop stops cleanly when the shared request deadline is nearly exhausted', async () => {
  let remaining = 20_000;
  const model = {
    configured: true,
    remainingMs: () => remaining,
    async completeJson() {
      remaining = 1_000;
      return { completion: { model: 'test' }, value: { answer: { summary: 'draft' } } };
    }
  };
  const result = await runStructuredReviewLoop({
    model,
    initialMessages: [{ role: 'user', content: 'draft' }],
    reviewMessages: () => [{ role: 'user', content: 'review' }]
  });
  assert.deepEqual(result.trace.map(item => item.status), ['completed', 'skipped_deadline']);
});
