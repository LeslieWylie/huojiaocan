import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshSession, signOut, getSession } from './auth.js';
import { fetchJson } from './app-core.js';
const key = 'huojiaocan.supabase.session';
const session = (id = 'a', token = 'old') => ({ user: { id }, access_token: `${id}-${token}`, refresh_token: `${id}-refresh-${token}`, expires_at: Math.floor(Date.now() / 1000) + 3600 });
function setup(t) {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  t.after(() => { globalThis.localStorage = previous; });
  const set = value => localStorage.setItem(key, JSON.stringify(value));
  set(session());
  return set;
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('simultaneous expired requests share one refresh and persist the rotated session', async t => {
  setup(t); const pending = deferred(); let count = 0;
  t.mock.method(globalThis, 'fetch', async () => { count++; await pending.promise; return Response.json(session('a', 'new')); });
  const first = refreshSession(); const second = refreshSession();
  pending.resolve(); await Promise.all([first, second]);
  assert.equal(count, 1); assert.equal(getSession().access_token, 'a-new');
});
test('transient refresh failure preserves the login for a later retry', async t => {
  setup(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  await assert.rejects(refreshSession(), error => error.code === 'auth_unavailable');
  assert.equal(getSession().user.id, 'a');
});
test('late refresh success cannot overwrite a newly signed-in owner', async t => {
  const set = setup(t); const pending = deferred();
  t.mock.method(globalThis, 'fetch', async () => { await pending.promise; return Response.json(session('a', 'new')); });
  const refresh = refreshSession(); set(session('b')); pending.resolve();
  assert.equal(await refresh, null); assert.equal(getSession().user.id, 'b');
});
test('late refresh rejection cannot clear another account', async t => {
  const set = setup(t); const pending = deferred();
  t.mock.method(globalThis, 'fetch', async () => { await pending.promise; return Response.json({ error: 'auth_invalid' }, { status: 401 }); });
  const refresh = refreshSession(); set(session('b')); pending.resolve();
  assert.equal(await refresh, null); assert.equal(getSession().user.id, 'b');
});
test('logout immediately clears locally and its late response cannot erase new login', async t => {
  const set = setup(t); const pending = deferred();
  t.mock.method(globalThis, 'fetch', async () => { await pending.promise; return Response.json({}); });
  const logout = signOut(); assert.equal(getSession(), null);
  set(session('b')); pending.resolve(); await logout; assert.equal(getSession().user.id, 'b');
});
test('a request started by A is not retried with B credentials after account switch', async t => {
  const set = setup(t); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; set(session('b')); return Response.json({}, { status: 401 }); });
  await assert.rejects(fetchJson('/api/drafts/a', { method: 'PATCH', body: { title: 'A private lesson' } }), error => error.code === 'auth_owner_changed');
  assert.equal(calls, 1); assert.equal(getSession().user.id, 'b');
});
test('a delayed A response is never delivered into B page state', async t => {
  const set = setup(t);
  t.mock.method(globalThis, 'fetch', async () => { set(session('b')); return Response.json({ title: 'A private lesson' }); });
  await assert.rejects(fetchJson('/api/drafts/a'), error => error.code === 'auth_owner_changed');
});
