import path from 'node:path';
import { getIndexProvider } from '../serverless/index-provider.js';
import { json } from '../serverless/shared.js';
import { selectUploadStorage, sha256Hex, UploadStorageError } from '../serverless/upload-storage.js';
import { requireUser, safeAuthResponse, supabaseRest } from '../serverless/auth.js';

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const MAX_ALLOWED_BYTES = 512 * 1024 * 1024;
// Larger files need an object-storage pull worker. Do not silently start a
// remote build with no page bytes for them.
const DEFAULT_INLINE_INDEX_BYTES = 24 * 1024 * 1024;

class UploadRequestError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'UploadRequestError';
    this.code = code;
    this.status = status;
  }
}

function header(req, name) {
  if (typeof req.get === 'function') return req.get(name);
  const headers = req.headers || {};
  return headers[name.toLowerCase()] ?? headers[name] ?? headers[name.toUpperCase()];
}

function maxUploadBytes(env) {
  const configured = Number(env.PDF_UPLOAD_MAX_BYTES || DEFAULT_MAX_BYTES);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_BYTES;
  return Math.min(Math.floor(configured), MAX_ALLOWED_BYTES);
}

function inlineIndexBytes(env) {
  const configured = Number(env.PAGEINDEX_INLINE_INGEST_MAX_BYTES || DEFAULT_INLINE_INDEX_BYTES);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_INLINE_INDEX_BYTES;
  return Math.min(Math.floor(configured), MAX_ALLOWED_BYTES);
}

function normalizeContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function decodeHeaderText(value, maxLength = 240) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* keep the original header value */ }
  return decoded
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function decodeFilename(value) {
  const decoded = decodeHeaderText(value);
  if (!decoded) return 'upload.pdf';
  const basename = path.basename(decoded.replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 240);
  if (!basename) return 'upload.pdf';
  return basename.toLowerCase().endsWith('.pdf') ? basename : `${basename}.pdf`;
}

function normalizeDocumentType(value) {
  const type = String(value || 'other').trim().toLowerCase();
  return ['textbook', 'teacher_guide', 'other'].includes(type) ? type : 'other';
}

function normalizeExtractionPolicy(value) {
  const policy = String(value || 'auto').trim().toLowerCase();
  return ['auto', 'native', 'ocr'].includes(policy) ? policy : 'auto';
}

function requestMetadata(req) {
  const query = req.query || {};
  const originalFilename = decodeFilename(header(req, 'x-filename') || query.filename);
  const documentType = normalizeDocumentType(header(req, 'x-document-type') || query.documentType);
  const requestedTitle = decodeHeaderText(header(req, 'x-document-title') || query.title);
  return {
    originalFilename,
    documentType,
    extractionPolicy: normalizeExtractionPolicy(header(req, 'x-extraction-policy') || query.extractionPolicy),
    title: requestedTitle || originalFilename.replace(/\.pdf$/i, '')
  };
}

function bufferFromBody(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body && body.type === 'Buffer' && Array.isArray(body.data)) return Buffer.from(body.data);
  if (typeof body === 'string') return Buffer.from(body, 'binary');
  return null;
}

export async function readPdfBytes(req, limit) {
  const declaredLength = Number(header(req, 'content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new UploadRequestError('pdf_too_large', 413);

  const existingBody = bufferFromBody(req.body);
  if (existingBody) {
    if (existingBody.length > limit) throw new UploadRequestError('pdf_too_large', 413);
    return existingBody;
  }

  if (!req || typeof req[Symbol.asyncIterator] !== 'function') throw new UploadRequestError('pdf_body_required', 400);
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > limit) throw new UploadRequestError('pdf_too_large', 413);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

function validatePdf(bytes, declaredMime) {
  if (declaredMime !== 'application/pdf') throw new UploadRequestError('pdf_content_type_required', 415);
  if (!bytes.length) throw new UploadRequestError('pdf_body_required', 400);
  const headerWindow = bytes.subarray(0, Math.min(bytes.length, 1024)).toString('latin1');
  if (!headerWindow.includes('%PDF-')) throw new UploadRequestError('invalid_pdf_signature', 400);
  return 'application/pdf';
}

function safeRegistration(value) {
  const document = value?.document && typeof value.document === 'object' ? value.document : {};
  return {
    provider: String(value?.provider || 'unknown'),
    document: {
      id: String(document.id || document.documentId || ''),
      title: String(document.title || ''),
      documentType: String(document.documentType || 'other'),
      pageCount: Number(document.pageCount || 0),
      pdfStatus: String(document.pdfStatus || 'registered'),
      indexStatus: String(document.indexStatus || 'pending')
    }
  };
}

function safeIndexing(value, fallbackProvider = 'unknown') {
  const source = value && typeof value === 'object' ? value : {};
  return {
    provider: String(source.provider || fallbackProvider),
    status: String(source.status || source.indexStatus || source.state || 'queued'),
    jobId: source.jobId || source.id || null,
    indexVersion: source.indexVersion || null
  };
}

function safeIndexingFailure(error, provider = 'unknown') {
  const code = String(error?.code || error?.message || 'indexing_failed');
  const allowed = new Set([
    'pageindex_unavailable', 'pageindex_unauthorized', 'pageindex_forbidden',
    'pageindex_rate_limited', 'pageindex_timeout', 'pageindex_invalid_request',
    'pageindex_invalid_response', 'pageindex_request_failed',
    'ocr_unavailable', 'ocr_provider_not_configured', 'ocr_failed',
    'ocr_requires_pdf_ingest', 'waiting_for_pages'
  ]);
  return { provider, status: 'failed', error: allowed.has(code) ? code : 'indexing_failed' };
}

function safeFailure(error) {
  if (error instanceof UploadRequestError || error instanceof UploadStorageError) {
    return { status: error.status, code: error.code };
  }
  return { status: 500, code: 'pdf_upload_failed' };
}

export function createUploadHandler({ env = process.env, storage, providerResolver = getIndexProvider, fetchImpl = global.fetch } = {}) {
  return async function uploadHandler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    try {
      // Seeded public materials are read-only. Product uploads are always
      // private user documents and require a verified session. A local-only
      // fixture mode must be opted into explicitly for tests or offline demos.
      let ownerId = null;
      let ownerToken = '';
      const anonymousLocalFixture = String(env.ALLOW_ANONYMOUS_LOCAL_UPLOAD || '').toLowerCase() === 'true'
        && String(env.NODE_ENV || '').toLowerCase() !== 'production';
      if (!anonymousLocalFixture) {
        try { const user = await requireUser(req, { env }); ownerId = user.id; ownerToken = user.token; } catch (error) { return safeAuthResponse(res, error); }
      }
      const limit = maxUploadBytes(env);
      const bytes = await readPdfBytes(req, limit);
      const mimeType = validatePdf(bytes, normalizeContentType(header(req, 'content-type')));
      const metadata = requestMetadata(req);
      const sha256 = sha256Hex(bytes);
      const documentId = `doc_${sha256.slice(0, 24)}`;
      const save = storage || selectUploadStorage({ env, fetchImpl });
      const stored = await save({ bytes, sha256, mimeType, originalFilename: metadata.originalFilename });

      let registration;
      let indexing = null;
      try {
        const resolved = providerResolver();
        const provider = resolved?.provider || resolved;
        if (!provider || typeof provider.createDocument !== 'function') throw new Error('provider_unavailable');
        const providerRegistration = await provider.createDocument({
          id: documentId,
          documentId,
          title: metadata.title,
          documentType: metadata.documentType,
          originalFilename: metadata.originalFilename,
          originalObjectKey: stored.objectKey,
          byteSize: bytes.length,
          sha256,
          mimeType,
          pageCount: 0,
          pdfUrl: stored.pdfUrl || ''
          ,ownerId
          ,visibility: ownerId ? 'private' : 'public'
        });
        registration = safeRegistration(providerRegistration);

        // A new remote document must go through /ingest with the original
        // bytes. A bare /build call has no page inputs and would only create a
        // misleading empty job. The ingest service decides native vs mature
        // PaddleOCR processing page by page.
        if (provider.id === 'pageindex' && typeof provider.ingest === 'function') {
          const maxInline = inlineIndexBytes(env);
          if (bytes.length > maxInline) {
            indexing = {
              provider: provider.id,
              status: 'deferred',
              reason: 'pdf_too_large_for_inline_index',
              maxBytes: maxInline
            };
          } else {
            try {
              const indexed = await provider.ingest({
                documentId,
                title: metadata.title,
                documentType: metadata.documentType,
                extractionPolicy: metadata.extractionPolicy,
                pdfBase64: bytes.toString('base64'),
                pdfUrl: stored.pdfUrl || '',
                originalFilename: metadata.originalFilename,
                originalObjectKey: stored.objectKey,
                metadata: { ownerId, visibility: ownerId ? 'private' : 'public' }
              });
              indexing = safeIndexing(indexed, provider.id);
            } catch (error) {
              indexing = safeIndexingFailure(error, provider.id);
            }
          }
        }
      } catch {
        return json(res, 502, {
          ok: false,
          error: 'stored_but_registration_failed',
          upload: {
            documentId,
            originalFilename: metadata.originalFilename,
            byteSize: bytes.length,
            sha256,
            mimeType,
            storage: {
              backend: stored.backend,
              objectKey: stored.objectKey,
              deduplicated: Boolean(stored.deduplicated)
            }
          }
        });
      }

      if (ownerId) {
        try {
          await supabaseRest('document_access', { env, authToken: ownerToken, method: 'POST', body: { document_id: documentId, owner_id: ownerId, visibility: 'private', object_key: stored.objectKey } });
        } catch {
          return json(res, 503, { ok: false, error: 'document_access_registration_failed' });
        }
      }

      return json(res, stored.deduplicated ? 200 : 201, {
        ok: true,
        upload: {
          documentId,
          title: metadata.title,
          documentType: metadata.documentType,
          originalFilename: metadata.originalFilename,
          byteSize: bytes.length,
          sha256,
          mimeType,
          storage: {
            backend: stored.backend,
            objectKey: stored.objectKey,
            pdfUrl: stored.pdfUrl || null,
            deduplicated: Boolean(stored.deduplicated)
          }
        },
        registration,
        indexing: indexing || { provider: registration.provider, status: 'registered' }
      });
    } catch (error) {
      const failure = safeFailure(error);
      return json(res, failure.status, { ok: false, error: failure.code });
    }
  };
}

export default createUploadHandler();
