import assert from 'node:assert/strict';
import test from 'node:test';
import { requireAgentBackendSecret } from './agent-backend.js';

test('internal Agent backend rejects absent or incorrect shared secret', () => {
  const env = { AGENT_INTERNAL_SECRET: 'expected-secret' };
  assert.throws(() => requireAgentBackendSecret({ headers: {} }, env), error => error.code === 'agent_backend_forbidden');
  assert.throws(() => requireAgentBackendSecret({ headers: { 'x-agent-internal-secret': 'wrong' } }, env), error => error.code === 'agent_backend_forbidden');
  assert.doesNotThrow(() => requireAgentBackendSecret({ headers: { 'x-agent-internal-secret': 'expected-secret' } }, env));
});
