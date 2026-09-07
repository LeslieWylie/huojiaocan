import assert from 'node:assert/strict';
import test from 'node:test';
import { requireUser } from '../src/auth.js';

const request = new Request('https://app.test/api/agent/sessions', {
  headers: { Authorization: 'Bearer user-token' }
});
const fetchUser = async () => Response.json({ id: 'teacher-a', email: 'teacher@example.test' });

test('测试账号白名单缺失时保持关闭', async () => {
  await assert.rejects(
    requireUser(request, { SUPABASE_URL: 'https://supabase.test', SUPABASE_ANON_KEY: 'anon' }, fetchUser),
    error => error.code === 'agent_runtime_not_enabled' && error.status === 404
  );
});

test('测试账号可按 owner id 或 email 开启', async () => {
  const base = { SUPABASE_URL: 'https://supabase.test', SUPABASE_ANON_KEY: 'anon' };
  assert.equal((await requireUser(request, { ...base, AGENT_RUNTIME_ALLOWLIST: 'teacher-a' }, fetchUser)).id, 'teacher-a');
  assert.equal((await requireUser(request, { ...base, AGENT_RUNTIME_ALLOWLIST: 'teacher@example.test' }, fetchUser)).id, 'teacher-a');
});
