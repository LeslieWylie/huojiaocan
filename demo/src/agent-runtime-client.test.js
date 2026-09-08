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
