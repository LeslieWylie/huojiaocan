import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialOriginalHandler } from './material-original.js';

// The real owner UI cannot cover another owner's denied access or forged object paths.
test('original address is owner-bound, short-lived, and never accepts a client object path', async () => {
  const env = { SUPABASE_URL: 'https://storage.example', SUPABASE_ANON_KEY: 'anon-fixture', SUPABASE_SERVICE_ROLE_KEY: 'service-fixture', SUPABASE_STORAGE_BUCKET: 'pdf' };
  const key = `originals/${'a'.repeat(64)}.pdf`;
  for (const scenario of ['anonymous', 'foreign', 'owner', 'missing', 'upstream']) {
    let signed = 0;
    const handler = createMaterialOriginalHandler({ env, fetchImpl: async (url, options) => {
      url = String(url);
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'owner' });
      if (url.includes('/rest/v1/document_access')) {
        const query = new URL(url).searchParams;
        assert.equal(query.get('owner_id'), 'eq.owner');
        assert.equal(query.get('document_id'), 'eq.doc_fixture');
        assert.equal(options.headers.Authorization, 'Bearer user-fixture');
        return Response.json([{ document_id: 'doc_fixture', owner_id: scenario === 'foreign' ? 'someone-else' : 'owner', visibility: 'private', object_key: key }]);
      }
      signed++;
      assert.equal(url, `https://storage.example/storage/v1/object/sign/pdf/${key}`);
      assert.deepEqual(JSON.parse(options.body), { expiresIn: 300 });
      if (scenario === 'missing') return Response.json({ code: 'NoSuchKey' }, { status: 400 });
      if (scenario === 'upstream') return Response.json({}, { status: 503 });
      return Response.json({ signedURL: `/object/sign/pdf/${key}?token=synthetic` });
    } });
    const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, end(body) { this.data = JSON.parse(body); return this; }, status(n) { this.code = n; return this; }, json(data) { this.data = data; return this; } };
    await handler({ method: 'GET', headers: scenario === 'anonymous' ? {} : { authorization: 'Bearer user-fixture' }, query: { documentId: 'doc_fixture', objectKey: 'originals/foreign.pdf', url: 'https://foreign.example' } }, res);
    assert.equal(res.code, { anonymous: 401, foreign: 404, owner: 200, missing: 404, upstream: 503 }[scenario]);
    assert.match(res.headers['Cache-Control'], /no-store/);
    assert.equal(signed, ['anonymous','foreign'].includes(scenario) ? 0 : 1);
    if (scenario === 'owner') {
      assert.equal(res.data.documentId, 'doc_fixture');
      assert.match(res.data.url, /^https:\/\/storage.example\/storage\/v1\/object\/sign\/pdf\/originals\//);
      assert.ok(Date.parse(res.data.expiresAt) - Date.now() <= 300000);
    } else assert.equal(res.data.url, undefined);
  }
});
