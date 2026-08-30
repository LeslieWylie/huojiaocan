import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import handler, { createUploadHandler } from './upload.js';
import indexHandler from './index.js';
import { sha256Hex, storeLocalImmutablePdf, storeSupabaseImmutablePdf } from '../serverless/upload-storage.js';

const samplePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1');
const localUploadEnv = values => ({ ALLOW_ANONYMOUS_LOCAL_UPLOAD: 'true', ...(values || {}) });

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    end(value = '') { this.payload = value ? JSON.parse(value) : undefined; return this; }
  };
}

async function call(uploadHandler, { body = samplePdf, headers = {}, query = {}, method = 'POST', url = '/api/upload' } = {}) {
  const req = {
    method,
    url,
    query,
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(body.length),
      'x-filename': encodeURIComponent('九年级语文.pdf'),
      'x-document-type': 'textbook',
      ...headers
    },
    body
  };
  const res = mockResponse();
  await uploadHandler(req, res);
  return res;
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'huojiaocan-upload-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('local immutable PDF storage is content addressed and never overwrites', async t => {
  const directory = await temporaryDirectory(t);
  const env = { PDF_UPLOAD_LOCAL_DIR: directory };
  const sha256 = sha256Hex(samplePdf);

  const first = await storeLocalImmutablePdf({ bytes: samplePdf, sha256, env });
  const second = await storeLocalImmutablePdf({ bytes: samplePdf, sha256, env });

  assert.equal(first.backend, 'local-filesystem');
  assert.equal(first.objectKey, `originals/${sha256}.pdf`);
  assert.equal(first.deduplicated, false);
  assert.equal(second.objectKey, first.objectKey);
  assert.equal(second.deduplicated, true);
  assert.deepEqual(await fs.readFile(path.join(directory, first.objectKey)), samplePdf);
  assert.doesNotMatch(JSON.stringify(first), new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('upload handler stores bytes, computes metadata and registers the document', async t => {
  const directory = await temporaryDirectory(t);
  const registrations = [];
  const env = localUploadEnv({ PDF_UPLOAD_LOCAL_DIR: directory, PDF_UPLOAD_MAX_BYTES: String(samplePdf.length + 10) });
  const uploadHandler = createUploadHandler({
    env,
    providerResolver: () => ({
      provider: {
        id: 'test-provider',
        async createDocument(input) {
          registrations.push(input);
          return { provider: 'test-provider', document: { id: input.documentId, title: input.title } };
        }
      }
    })
  });

  const res = await call(uploadHandler);
  const expectedSha = sha256Hex(samplePdf);
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.upload.sha256, expectedSha);
  assert.equal(res.payload.upload.byteSize, samplePdf.length);
  assert.equal(res.payload.upload.mimeType, 'application/pdf');
  assert.equal(res.payload.upload.storage.backend, 'local-filesystem');
  assert.equal(res.payload.upload.storage.objectKey, `originals/${expectedSha}.pdf`);
  assert.equal(res.payload.upload.originalFilename, '九年级语文.pdf');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].documentId, `doc_${expectedSha.slice(0, 24)}`);
  assert.equal(registrations[0].originalObjectKey, `originals/${expectedSha}.pdf`);
  assert.equal(registrations[0].byteSize, samplePdf.length);
  assert.equal(registrations[0].sha256, expectedSha);
  assert.ok(!('bytes' in registrations[0]));
});

test('URL-encoded Chinese document titles round-trip without percent escapes', async t => {
  const directory = await temporaryDirectory(t);
  const registrations = [];
  const uploadHandler = createUploadHandler({
    env: localUploadEnv({ PDF_UPLOAD_LOCAL_DIR: directory }),
    providerResolver: () => ({
      provider: {
        async createDocument(input) {
          registrations.push(input);
          return { provider: 'test-provider', document: { id: input.documentId, title: input.title } };
        }
      }
    })
  });

  const title = '义务教育教科书 语文 九年级 上册';
  const res = await call(uploadHandler, {
    headers: { 'x-document-title': encodeURIComponent(title) }
  });

  assert.equal(res.statusCode, 201);
  assert.equal(registrations[0].title, title);
  assert.equal(res.payload.registration.document.title, title);
  assert.doesNotMatch(res.payload.registration.document.title, /%[0-9A-F]{2}/i);
});

test('PageIndex uploads send original bytes to the ingest boundary with the selected policy', async t => {
  const directory = await temporaryDirectory(t);
  const calls = [];
  const uploadHandler = createUploadHandler({
    env: localUploadEnv({ PDF_UPLOAD_LOCAL_DIR: directory, PAGEINDEX_INLINE_INGEST_MAX_BYTES: '1024' }),
    providerResolver: () => ({
      provider: {
        id: 'pageindex',
        async createDocument(input) {
          calls.push({ type: 'register', input });
          return { provider: 'pageindex', document: { id: input.documentId, title: input.title } };
        },
        async ingest(input) {
          calls.push({ type: 'ingest', input });
          return { provider: 'pageindex', jobId: 'job_upload_1', documentId: input.documentId, status: 'running' };
        }
      }
    })
  });

  const res = await call(uploadHandler, { headers: { 'x-extraction-policy': 'ocr' } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.indexing.provider, 'pageindex');
  assert.equal(res.payload.indexing.jobId, 'job_upload_1');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].type, 'ingest');
  assert.equal(calls[1].input.extractionPolicy, 'ocr');
  assert.equal(Buffer.from(calls[1].input.pdfBase64, 'base64').toString(), samplePdf.toString());
  assert.equal(calls[1].input.metadata.visibility, 'public');
});

test('large PageIndex uploads are marked deferred instead of creating an empty build', async t => {
  const directory = await temporaryDirectory(t);
  let buildCalled = false;
  const uploadHandler = createUploadHandler({
    env: localUploadEnv({ PDF_UPLOAD_LOCAL_DIR: directory, PAGEINDEX_INLINE_INGEST_MAX_BYTES: '8' }),
    providerResolver: () => ({
      provider: {
        id: 'pageindex',
        async createDocument(input) { return { provider: 'pageindex', document: { id: input.documentId, title: input.title } }; },
        async ingest() { buildCalled = true; }
      }
    })
  });

  const res = await call(uploadHandler);
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.indexing.status, 'deferred');
  assert.equal(res.payload.indexing.reason, 'pdf_too_large_for_inline_index');
  assert.equal(buildCalled, false);
});

test('upload validation rejects wrong MIME, invalid signatures and oversized bodies', async () => {
  const storage = async () => { throw new Error('storage should not be called'); };
  const providerResolver = () => ({ provider: { createDocument: async () => ({}) } });

  const wrongMime = await call(createUploadHandler({ storage, providerResolver, env: localUploadEnv() }), {
    headers: { 'content-type': 'text/plain' }
  });
  assert.equal(wrongMime.statusCode, 415);
  assert.deepEqual(wrongMime.payload, { ok: false, error: 'pdf_content_type_required' });

  const invalid = Buffer.from('not a PDF');
  const invalidSignature = await call(createUploadHandler({ storage, providerResolver, env: localUploadEnv() }), { body: invalid });
  assert.equal(invalidSignature.statusCode, 400);
  assert.deepEqual(invalidSignature.payload, { ok: false, error: 'invalid_pdf_signature' });

  const tooLarge = await call(createUploadHandler({ storage, providerResolver, env: localUploadEnv({ PDF_UPLOAD_MAX_BYTES: '8' }) }));
  assert.equal(tooLarge.statusCode, 413);
  assert.deepEqual(tooLarge.payload, { ok: false, error: 'pdf_too_large' });
});

test('registration failures are sanitized while preserving non-secret storage state', async t => {
  const directory = await temporaryDirectory(t);
  const secret = 'registration-secret-must-not-leak';
  const uploadHandler = createUploadHandler({
    env: localUploadEnv({ PDF_UPLOAD_LOCAL_DIR: directory }),
    providerResolver: () => ({
      provider: { createDocument: async () => { throw new Error(`upstream:${secret}`); } }
    })
  });

  const res = await call(uploadHandler);
  assert.equal(res.statusCode, 502);
  assert.equal(res.payload.error, 'stored_but_registration_failed');
  assert.equal(res.payload.upload.storage.backend, 'local-filesystem');
  const serialized = JSON.stringify(res.payload);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Supabase storage uses immutable upload headers without exposing credentials', async () => {
  const secret = 'service-role-test-secret';
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'HEAD') return new Response(null, { status: 404 });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await storeSupabaseImmutablePdf({
    bytes: samplePdf,
    sha256: sha256Hex(samplePdf),
    env: {
      SUPABASE_URL: 'https://storage.test',
      SUPABASE_SERVICE_ROLE_KEY: secret,
      SUPABASE_STORAGE_BUCKET: 'materials'
    },
    fetchImpl
  });

  assert.equal(result.backend, 'supabase-storage');
  assert.equal(result.deduplicated, false);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.headers['x-upsert'], 'false');
  assert.equal(requests[1].options.headers['Content-Type'], 'application/pdf');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test('production-like environments require authentication before storage work', async () => {
  const uploadHandler = createUploadHandler({
    env: { NODE_ENV: 'production' },
    providerResolver: () => ({ provider: { createDocument: async () => ({}) } })
  });
  const res = await call(uploadHandler);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { ok: false, error: 'auth_required' });
});

test('BFF /api/index/documents/upload route reaches the upload handler', { concurrency: false }, async t => {
  const directory = await temporaryDirectory(t);
  const keys = ['NODE_ENV', 'VERCEL', 'PDF_UPLOAD_LOCAL_DIR', 'DOCUMENT_INDEX_PROVIDER', 'ALLOW_ANONYMOUS_LOCAL_UPLOAD'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  delete process.env.NODE_ENV;
  delete process.env.VERCEL;
  process.env.PDF_UPLOAD_LOCAL_DIR = directory;
  process.env.DOCUMENT_INDEX_PROVIDER = 'local';
  process.env.ALLOW_ANONYMOUS_LOCAL_UPLOAD = 'true';

  const req = {
    method: 'POST',
    url: '/api/index/documents/upload',
    indexPath: '/documents/upload',
    query: {},
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(samplePdf.length),
      'x-filename': 'bff-sample.pdf'
    },
    body: samplePdf
  };
  const res = mockResponse();
  await indexHandler(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.upload.storage.backend, 'local-filesystem');
  assert.equal(res.payload.registration.provider, 'local-fulltext');
});

test('default handler rejects non-POST requests without reading a body', async () => {
  const res = await call(handler, { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.payload, { ok: false, error: 'method_not_allowed' });
  assert.equal(res.headers.allow, 'POST');
});
