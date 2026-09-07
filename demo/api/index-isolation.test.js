import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { encryptSecret, requireUser } from '../serverless/auth.js';
import aiHandler from './ai.js';
import draftsHandler from './drafts.js';
import { createModels, fauxProvider, fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai';
import { createPiRetrievalRuntime, runPiRetrievalAgent } from '../serverless/pi-retrieval-agent.js';

// Real HTTP handlers/auth/REST/encryption; only the external provider and
// Supabase transport are replaced. No network or production accounts.
import { LocalFullTextIndexProvider } from '../serverless/index-provider.js';
import indexHandler from './index.js';
import askHandler from './ask.js';
const asks = [];

async function request(handler, path, { owner = 'B', method = 'GET', body = {} } = {}) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    setHeader() { return this; }, end(value) { this.payload = JSON.parse(value); } };
  await handler({ url: path, method, headers: owner ? { authorization: `Bearer token-${owner}` } : {},
    query: { userId: 'A' }, body: { ...body, userId: 'A', user_id: 'A' } }, res);
  return res;
}

test('JWT owner isolates drafts, keys, and ask history across A/B accounts', async t => {
  const providerMock = mock.method(LocalFullTextIndexProvider.prototype, 'ask', async input => { asks.push(input); return { ok: true }; });
  t.after(() => providerMock.mock.restore());
  const env = { DOCUMENT_INDEX_PROVIDER: 'local', SUPABASE_URL: 'https://isolation.invalid', SUPABASE_ANON_KEY: 'fixture-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', USER_DEEPSEEK_KEY_ENCRYPTION_SECRET: 'fixture-encryption-only' };
  for (const [key, value] of Object.entries(env)) {
    const prior = process.env[key]; process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  const drafts = ['A', 'B'].map(owner => ({ id: `draft-${owner}`, user_id: owner, title: '备课',
    answer: { conversationHistory: [{ role: 'user', content: `${owner}-private-history` }] }, lesson_context: {}, version: 1, cards: [], citations: [] }));
  const keys = ['A', 'B'].map(owner => {
    const encrypted = encryptSecret(`sk-fixture-${owner}-only`, env.USER_DEEPSEEK_KEY_ENCRYPTION_SECRET);
    return { id: `key-${owner}`, user_id: owner, model: 'deepseek-v4-flash', is_active: true,
      key_ciphertext: encrypted.ciphertext, key_iv: encrypted.iv, key_tag: encrypted.tag, key_hint: 'fixture' };
  });
  const calls = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, env.SUPABASE_URL, 'unexpected external request');
    const owner = /^Bearer token-([AB])$/.exec(options.headers.Authorization)?.[1];
    if (url.pathname === '/auth/v1/user') return Response.json(owner ? { id: owner } : {}, { status: owner ? 200 : 401 });
    assert.ok(owner, 'REST must forward current JWT, not service credential');
    const table = url.pathname.split('/').at(-1);
    assert.ok(['lesson_drafts', 'user_deepseek_keys'].includes(table));
    const rows = table === 'lesson_drafts' ? drafts : keys;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ table, method, owner });
    if (method === 'POST') {
      assert.equal(body.user_id, owner, 'client cannot select inserted owner');
      const row = { ...body, id: `new-${table}-${owner}` }; rows.push(row); return Response.json([row]);
    }
    // Intentionally no simulated RLS: missing owner predicates must fail here.
    assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
    const selected = rows.filter(row => row.user_id === owner &&
      (!url.searchParams.has('id') || url.searchParams.get('id') === `eq.${row.id}`) &&
      (!url.searchParams.has('key_fingerprint') || url.searchParams.get('key_fingerprint') === `eq.${row.key_fingerprint}`));
    if (method === 'DELETE') selected.forEach(row => rows.splice(rows.indexOf(row), 1));
    if (method === 'PATCH') selected.forEach(row => Object.assign(row, body));
    return Response.json(selected);
  };

  await t.test('userId cannot override authenticated owner; invalid session fails', async () => {
    assert.equal((await requireUser({ headers: { authorization: 'Bearer token-B' }, body: { userId: 'A' } })).id, 'B');
    await assert.rejects(requireUser({ headers: { authorization: 'Bearer invalid' } }), /auth_invalid/);
    for (const [handler, path] of [[aiHandler, '/api/ai/keys'], [draftsHandler, '/api/drafts'], [askHandler, '/api/ask']]) {
      assert.equal((await request(handler, path, { owner: '', method: handler === askHandler ? 'POST' : 'GET' })).statusCode, 401);
    }
  });
  await t.test('B lists only B and cannot read, change, or delete A drafts/keys', async () => {
    assert.deepEqual((await request(draftsHandler, '/api/drafts')).payload.drafts.map(row => row.id), ['draft-B']);
    assert.deepEqual((await request(aiHandler, '/api/ai/keys')).payload.keys.map(row => row.id), ['key-B']);
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      assert.equal((await request(draftsHandler, '/api/drafts/draft-A', { method, body: { version: 1 } })).statusCode, 404);
    }
    for (const [suffix, method] of [['/test', 'POST'], ['/activate', 'POST'], ['', 'DELETE']]) {
      assert.equal((await request(aiHandler, `/api/ai/keys/key-A${suffix}`, { method })).statusCode, 404);
    }
    assert.equal(calls.filter(call => ['PATCH', 'DELETE'].includes(call.method)).length, 0);
  });
  await t.test('draft/key creation binds JWT owner and never returns key ciphertext', async () => {
    assert.equal((await request(draftsHandler, '/api/drafts', { method: 'POST', body: { question: '备课' } })).payload.draft.user_id, 'B');
    const created = await request(aiHandler, '/api/ai/keys', { method: 'POST', body: { apiKey: 'sk-fixture-new-only' } });
    assert.equal(created.statusCode, 201);
    assert.doesNotMatch(JSON.stringify(created.payload), /ciphertext|key_iv|key_tag|sk-fixture/);
  });
  await t.test('both ask routes reject another owner draft/key before provider invocation', async () => {
    asks.length = 0;
    for (const [handler, path] of [[askHandler, '/api/ask'], [indexHandler, '/api/index/ask']]) {
      for (const body of [{ draftId: 'draft-A' }, { keyId: 'key-A' }]) {
        assert.equal((await request(handler, path, { method: 'POST', body: { question: '备课', ...body } })).statusCode, 404);
      }
    }
    assert.equal(asks.length, 0);
  });
  await t.test('ask uses current owner history/key, never stale client history or previous account key', async () => {
    for (const owner of ['A', 'B']) {
      assert.equal((await request(askHandler, '/api/ask', { owner, method: 'POST', body: {
        question: '继续', draftId: `draft-${owner}`, keyId: `key-${owner}`,
        history: [{ role: 'assistant', content: 'other-account-stale-history' }]
      } })).statusCode, 200);
      const input = asks.at(-1);
      assert.deepEqual(input.history, [{ role: 'user', content: `${owner}-private-history` }]);
      assert.equal(input.deepseek.apiKey, `sk-fixture-${owner}-only`);
      assert.equal(input.userId, undefined);
    }
    await request(askHandler, '/api/ask', { method: 'POST', body: { question: '新对话', history: [{ role: 'user', content: 'A-private-history' }] } });
    assert.deepEqual(asks.at(-1).history, []);
    assert.equal(asks.at(-1).deepseek, null);
  });
});

test('Pi runs concurrent and subsequent requests with independent messages, evidence, and runtime keys', async () => {
  const runtimes = ['A', 'B'].map(owner => createPiRetrievalRuntime({ env: {}, deepseek: { apiKey: `fixture-${owner}`, model: 'deepseek-v4-flash' } }));
  assert.notEqual(runtimes[0].streamFn, runtimes[1].streamFn);
  assert.equal(runtimes[0].apiKey, 'fixture-A');
  assert.equal(runtimes[1].apiKey, 'fixture-B');
  const seen = [];
  async function run(owner) {
    const faux = fauxProvider(); const models = createModels(); models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage(fauxText('READY'))]);
    const runtime = { configured: true, model: faux.getModel(), apiKey: `fixture-${owner}`, timeoutMs: 2000,
      streamFn(model, context, options) { seen.push({ owner, messages: structuredClone(context.messages), key: options.apiKey }); return models.streamSimple(model, context, options); } };
    const result = await runPiRetrievalAgent({ question: `question-${owner}`, history: [{ role: 'user', content: `history-${owner}` }],
      evidence: [{ documentId: 'textbook', documentType: 'textbook', pdfPage: 1, text: `evidence-${owner}` }], retrieveMore: async () => [], runtime });
    assert.equal(result.evidence[0].text, `evidence-${owner}`);
  }
  await Promise.all([run('A'), run('B')]);
  await run('C');
  assert.equal(seen.length, 3);
  for (const call of seen) {
    assert.equal(call.messages.length, 1, 'new agent starts with only its own prompt');
    assert.equal(call.key, `fixture-${call.owner}`);
    const text = JSON.stringify(call.messages);
    assert.ok(text.includes(`history-${call.owner}`));
    for (const other of ['A', 'B', 'C'].filter(owner => owner !== call.owner)) assert.ok(!text.includes(`history-${other}`));
  }
});
