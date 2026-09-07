import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest } from '../../cloudflare-worker.js';

test('Agent binding 缺失时不回退 Vercel', async () => {
  const response = await handleRequest(new Request('https://app.test/api/agent/capabilities'), {});
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: 'agent_runtime_not_enabled' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('只把 /api/agent 路径交给内部 Service Binding', async () => {
  const seen = [];
  const env = {
    AGENT_RUNTIME: {
      async fetch(request) {
        seen.push(request.url);
        return Response.json({ enabled: true }, { headers: { server: 'hidden-upstream' } });
      }
    }
  };
  const response = await handleRequest(new Request('https://app.test/api/agent/capabilities'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true });
  assert.deepEqual(seen, ['https://app.test/api/agent/capabilities']);
  assert.equal(response.headers.get('server'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
});
