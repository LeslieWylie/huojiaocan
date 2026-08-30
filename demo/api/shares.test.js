import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../serverless/teaching-share-api.js';
import assetsHandler from './assets.js';

const token = 'A'.repeat(32);

function draft() {
  const citations = [{ id: 'E1', documentId: 'textbook', documentType: 'textbook', pdfPage: 56, quote: '先天下之忧而忧' }];
  return {
    id: 'draft-1', user_id: 'teacher-1', version: 8, title: '《岳阳楼记》', question: '如何理解先忧后乐？',
    answer: { planApproval: { status: 'confirmed', hasUnconfirmedChanges: false, confirmedAt: '2026-08-27T01:00:00Z', confirmedSnapshot: { plan: { summary: '由写景进入价值判断。' }, conditions: { title: '《岳阳楼记》', question: '如何理解先忧后乐？', lessonContext: {} }, citations } } },
    citations,
    cards: [{ type: 'board', title: '板书卡', items: [{ text: '景→情→志', citationIds: ['E1'] }] }]
  };
}

function responseJson(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return value; } };
}

async function invoke({ method, url, body, mode = 'create', storedDraft = draft(), handlerImpl = handler, query: queryOverride }) {
  const calls = [];
  const previous = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  globalThis.fetch = async (target, options = {}) => {
    calls.push({ url: String(target), options });
    const requestUrl = String(target);
    if (requestUrl.includes('/auth/v1/user')) return responseJson({ id: 'teacher-1', email: 'teacher@example.test' });
    if (requestUrl.includes('/lesson_drafts')) return responseJson([storedDraft]);
    if (requestUrl.includes('/teaching_shares') && options.method === 'POST') {
      const created = JSON.parse(options.body);
      return responseJson([{ id: 'share-1', draft_id: 'draft-1', ...created, created_at: '2026-08-27T02:00:00Z', revoked_at: null }]);
    }
    if (requestUrl.includes('/teaching_shares') && options.method === 'PATCH') {
      const update = JSON.parse(options.body);
      return responseJson([{ id: 'share-1', draft_id: 'draft-1', snapshot: { title: '《岳阳楼记》' }, snapshot_digest: 'd'.repeat(64), expires_at: '2099-01-01T00:00:00Z', created_at: '2026-08-27T02:00:00Z', ...update }]);
    }
    if (requestUrl.includes('/teaching_shares')) {
      if (mode === 'missing') return responseJson([]);
      return responseJson([{ id: 'share-1', draft_id: 'draft-1', snapshot: { title: '《岳阳楼记》', digest: 'd'.repeat(64) }, snapshot_digest: 'd'.repeat(64), version: 1, expires_at: '2099-01-01T00:00:00Z', revoked_at: null, created_at: '2026-08-27T02:00:00Z' }]);
    }
    return responseJson([]);
  };
  const result = { statusCode: 0, payload: null };
  const parsed = new URL(url, 'http://local');
  const req = { method, url, body, headers: { authorization: 'Bearer test-token' }, query: queryOverride || Object.fromEntries(parsed.searchParams) };
  const res = { status(code) { result.statusCode = code; return this; }, setHeader() { return this; }, end(value) { result.payload = JSON.parse(value); return this; } };
  try { await handlerImpl(req, res); return { ...result, calls }; }
  finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['SUPABASE_URL', previous.url], ['SUPABASE_ANON_KEY', previous.anon], ['SUPABASE_SERVICE_ROLE_KEY', previous.service]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('owner creates an immutable share and the raw token is never persisted', async () => {
  const result = await invoke({ method: 'POST', url: '/api/shares', body: { draftId: 'draft-1', version: 8, expiresInDays: 7 } });
  assert.equal(result.statusCode, 201);
  assert.match(result.payload.token, /^[A-Za-z0-9_-]{32}$/u);
  const write = result.calls.find(call => call.url.includes('/teaching_shares') && call.options.method === 'POST');
  const stored = JSON.parse(write.options.body);
  assert.equal(stored.token_hash.length, 64);
  assert.equal(JSON.stringify(stored).includes(result.payload.token), false);
  assert.equal(JSON.stringify(stored.snapshot).includes('先天下之忧而忧'), false);
});

test('public resolve accepts the token in the request body and returns only the snapshot', async () => {
  const result = await invoke({ method: 'POST', url: '/api/shares/resolve', body: { token } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.share.snapshot.title, '《岳阳楼记》');
  assert.equal(result.payload.share.ownerId, undefined);
  const lookup = result.calls.find(call => call.url.includes('/teaching_shares'));
  assert.equal(lookup.url.includes(token), false);
  assert.equal(lookup.options.headers.Authorization, 'Bearer service-test');
});

test('the public /api/shares contract is dispatched through the existing asset function', async () => {
  const result = await invoke({ method: 'POST', url: '/api/assets', body: { token }, handlerImpl: assetsHandler, query: { sharePath: 'resolve' } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.share.snapshot.title, '《岳阳楼记》');
  assert.equal(result.calls.some(call => call.url.includes('/auth/v1/user')), false);
});

test('owner revocation is versioned and an unknown public link stays indistinguishable', async () => {
  const revoked = await invoke({ method: 'POST', url: '/api/shares/share-1/revoke', body: { version: 1 } });
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.payload.share.status, 'revoked');
  const write = revoked.calls.find(call => call.options.method === 'PATCH');
  assert.equal(new URL(write.url).searchParams.get('version'), 'eq.1');

  const missing = await invoke({ method: 'POST', url: '/api/shares/resolve', body: { token }, mode: 'missing' });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.payload.error, 'share_not_found');
});
