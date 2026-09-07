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
      AI_WORKFLOW_TIMEOUT_MS: '20000',
      AI_RETRY_DELAY_MS: '0'
    }
  });
  const result = await model.completeJson({ messages: [{ role: 'user', content: 'test' }] });
  assert.equal(calls, 2);
  assert.deepEqual(result.value, { answer: 'ok' });
});

test('system model respects the configured gateway output-token ceiling', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
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
      LLM_GATEWAY_MAX_TOKENS: '1200'
    }
  });
  await model.completeJson({ messages: [{ role: 'user', content: 'test' }], maxTokens: 4200 });
  assert.equal(body.max_tokens, 1200);
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

test('review loop keeps the best candidate when a reviewer introduces new structural defects', async () => {
  const values = [
    { answer: { objectives: ['一', '二'], lessonPlan: ['完整'] } },
    { answer: { objectives: [], lessonPlan: [] } },
    { answer: { objectives: ['一', '二'], lessonPlan: ['完整'] } }
  ];
  let calls = 0;
  const issueLists = [];
  const model = {
    configured: true,
    remainingMs: () => 20_000,
    async completeJson() {
      const value = values[calls];
      calls += 1;
      return { completion: { model: 'test' }, value };
    }
  };
  const detectIssues = value => value.answer.objectives.length >= 2 && value.answer.lessonPlan.length
    ? []
    : ['方案结构不完整'];
  const result = await runStructuredReviewLoop({
    model,
    initialMessages: [{ role: 'user', content: 'draft' }],
    reviewMessages: ({ issues }) => {
      issueLists.push(issues);
      return [{ role: 'user', content: 'review' }];
    },
    detectIssues
  });
  assert.equal(calls, 3);
  assert.deepEqual(issueLists, [[], ['方案结构不完整']]);
  assert.deepEqual(result.unresolvedIssues, []);
  assert.equal(result.trace[1].status, 'rejected_regression');
  assert.deepEqual(result.value, values[0]);
});

test('review loop supplies current deterministic issues to the evidence review round', async () => {
  let calls = 0;
  let received = [];
  const model = {
    configured: true,
    remainingMs: () => 20_000,
    async completeJson() {
      calls += 1;
      return { completion: { model: 'test' }, value: { complete: calls > 1 } };
    }
  };
  const result = await runStructuredReviewLoop({
    model,
    initialMessages: [{ role: 'user', content: 'draft' }],
    reviewMessages: ({ issues }) => {
      received = issues;
      return [{ role: 'user', content: 'review' }];
    },
    detectIssues: value => value.complete ? [] : ['缺少课堂收束']
  });
  assert.deepEqual(received, ['缺少课堂收束']);
  assert.equal(result.trace[0].issues, 1);
  assert.equal(result.trace[1].issuesAfter, 0);
});

test('a rejected review finding is not silently lost at the deadline', async () => {
  let calls = 0;
  const result = await runStructuredReviewLoop({
    model: { configured: true, remainingMs: () => calls < 2 ? 10000 : 1, completeJson: async () => ({ completion: {}, value: { unresolved: ++calls === 2 } }) },
    initialMessages: [{ role: 'user', content: 'draft' }],
    reviewMessages: () => [{ role: 'user', content: 'review' }],
    detectIssues: value => value.unresolved ? ['引文对象仍需核对'] : []
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.unresolvedIssues, ['引文对象仍需核对']);
  assert.equal(result.trace.at(-1).status, 'skipped_deadline');
});

test('expired shared workflow deadline never starts a fresh model budget', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not run'); });
  const model = createStructuredModel({ env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-key', LLM_GATEWAY_MODEL: 'test' }, deadlineAt: Date.now() - 1 });
  assert.equal(model.remainingMs(), 0);
  await assert.rejects(model.completeJson({ messages: [{ role: 'user', content: 'test' }] }), /gateway_timeout/);
  assert.equal(calls, 0);
});

test('malformed or truncated JSON gets one bounded format repair, not an endless retry', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ model: 'test', choices: [{ finish_reason: requests.length === 1 ? 'length' : 'stop', message: { content: requests.length === 1 ? '{"answer":"未闭合' : '{"answer":"完整对象"}' } }] });
  });
  const model = createStructuredModel({ env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-key', LLM_GATEWAY_MODEL: 'test', AI_RETRY_DELAY_MS: '0' } });
  assert.deepEqual((await model.completeJson({ messages: [{ role: 'user', content: '本轮问题' }] })).value, { answer: '完整对象' });
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages.at(-1).content, /重新输出一个完整 JSON 对象/u);
  assert.doesNotMatch(JSON.stringify(requests[1].messages), /未闭合/u);
});

test('persistent invalid JSON stops after two transport attempts', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ choices: [{ message: { content: 'not json' } }] }); });
  const model = createStructuredModel({ env: { LLM_GATEWAY_BASE_URL: 'https://gateway.test', LLM_GATEWAY_API_KEY: 'test-key', LLM_GATEWAY_MODEL: 'test', AI_RETRY_DELAY_MS: '0' } });
  await assert.rejects(model.completeJson({ messages: [{ role: 'user', content: 'test' }] }), /gateway_invalid_response/);
  assert.equal(calls, 2);
});
