import assert from 'node:assert/strict';
import test from 'node:test';
import { persistentAgentCapabilities, runPersistentAgentTurn } from './agent-runtime-client.js';

test('capability discovery treats the fail-closed 404 as disabled', async () => {
  assert.equal(await persistentAgentCapabilities(async () => { throw Object.assign(new Error('agent_runtime_not_enabled'), { status: 404, code: 'agent_runtime_not_enabled' }); }), null);
  assert.deepEqual(await persistentAgentCapabilities(async () => ({ enabled: true, transport: 'sse' })), { enabled: true, transport: 'sse' });
});

test('persistent turn waits for server-side save and returns the durable result', async () => {
  let reads = 0;
  const request = async (path) => {
    if (path === '/api/agent/sessions') return { session: { id: 's1' } };
    if (path.endsWith('/messages')) return { request: { id: 'r1' } };
    if (path.endsWith('/s1')) {
      reads += 1;
      return { session: { requests: [{ clientRequestId: 'c1', status: reads > 1 ? 'saved' : 'composing', result: reads > 1 ? { response: { answer: { summary: '完成' } } } : null }] } };
    }
    throw new Error(`unexpected:${path}`);
  };
  let clock = 0;
  const result = await runPersistentAgentTurn({
    request, draft: { id: 'd1', version: 3 }, connectionId: 'k1', question: '继续',
    clientRequestId: 'c1', now: () => clock, sleep: async ms => { clock += ms; }
  });
  assert.equal(result.response.answer.summary, '完成');
  assert.equal(reads, 2);
});

test('brief status read disconnect reconnects to the same request without new generation', async () => {
  let reads = 0; let messages = 0; let clock = 0;
  const request = async path => {
    if (path === '/api/agent/sessions') return { session: { id: 's1' } };
    if (path.endsWith('/messages')) { messages++; return {}; }
    if (++reads === 1) throw new TypeError('Failed to fetch');
    return { session: { requests: [{ clientRequestId: 'c1', status: 'saved', result: { response: { answer: { summary: '原任务结果' } } } }] } };
  };
  const result = await runPersistentAgentTurn({ request, draft: { id: 'd1', version: 3 }, clientRequestId: 'c1', now: () => clock, sleep: async ms => { clock += ms; } });
  assert.equal(result.response.answer.summary, '原任务结果');
  assert.equal(messages, 1);
});

test('save conflict surfaces generated result immediately instead of timing out', async () => {
  const request = async path => {
    if (path === '/api/agent/sessions') return { session: { id: 's1' } };
    if (path.endsWith('/messages')) return {};
    return { session: { requests: [{ clientRequestId: 'c1', status: 'ready_to_save', errorCode: 'edit_conflict', result: { response: { answer: { summary: '保留生成结果' } } } }] } };
  };
  await assert.rejects(runPersistentAgentTurn({ request, draft: { id: 'd1', version: 3 }, clientRequestId: 'c1' }), error => error.code === 'edit_conflict' && error.generatedResponse.answer.summary === '保留生成结果');
});

test('a different request result is never adopted as the current result', async () => {
  const request = async path => {
    if (path === '/api/agent/sessions') return { session: { id: 's1' } };
    if (path.endsWith('/messages')) return {};
    return { session: { requests: [{ clientRequestId: 'other', status: 'saved', result: { response: {} } }] } };
  };
  await assert.rejects(runPersistentAgentTurn({ request, draft: { id: 'd1', version: 3 }, clientRequestId: 'c1' }), error => error.code === 'agent_request_not_found');
});

test('successful save retry reads fresh state rather than returning the old error', async () => {
  let saved = false; let clock = 0;
  const request = async path => {
    if (path === '/api/agent/sessions') return { session: { id: 's1' } };
    if (path.endsWith('/messages')) return {};
    if (path.endsWith('/retry-save')) { saved = true; return {}; }
    return { session: { requests: [{ clientRequestId: 'c1', status: saved ? 'saved' : 'ready_to_save', errorCode: saved ? null : 'save_failed', result: { response: { answer: { summary: '原结果已保存' } } } }] } };
  };
  const result = await runPersistentAgentTurn({ request, draft: { id: 'd1', version: 3 }, clientRequestId: 'c1', now: () => clock, sleep: async ms => { clock += ms; } });
  assert.equal(result.response.answer.summary, '原结果已保存');
});
