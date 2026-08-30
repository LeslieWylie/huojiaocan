import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class UploadStorageError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.name = 'UploadStorageError';
    this.code = code;
    this.status = status;
  }
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function immutableObjectKey(sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new UploadStorageError('invalid_sha256', 400);
  return `originals/${sha256}.pdf`;
}

function localUploadRoot(env) {
  return path.resolve(env.PDF_UPLOAD_LOCAL_DIR || path.join(os.tmpdir(), 'huojiaocan-pdf-originals'));
}

async function verifyExistingFile(filePath, bytes, sha256) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes.length) throw new UploadStorageError('immutable_object_conflict', 409);
  const existing = await fs.readFile(filePath);
  if (sha256Hex(existing) !== sha256) throw new UploadStorageError('immutable_object_conflict', 409);
}

export async function storeLocalImmutablePdf({ bytes, sha256, env = process.env }) {
  const objectKey = immutableObjectKey(sha256);
  const root = localUploadRoot(env);
  const originalsDir = path.join(root, 'originals');
  const finalPath = path.join(root, ...objectKey.split('/'));
  await fs.mkdir(originalsDir, { recursive: true, mode: 0o700 });

  let deduplicated = false;
  const tempPath = path.join(originalsDir, `.${sha256}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tempPath, bytes, { flag: 'wx', mode: 0o600 });
    try {
      // Hard-link publication is atomic and cannot replace an existing immutable object.
      await fs.link(tempPath, finalPath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await verifyExistingFile(finalPath, bytes, sha256);
      deduplicated = true;
    }
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }

  return {
    backend: 'local-filesystem',
    objectKey,
    pdfUrl: null,
    deduplicated
  };
}

function safePublicBaseUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function supabaseConfiguration(env) {
  const values = {
    url: String(env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: String(env.SUPABASE_SERVICE_ROLE_KEY || ''),
    bucket: String(env.SUPABASE_STORAGE_BUCKET || ''),
    publicBaseUrl: safePublicBaseUrl(String(env.SUPABASE_STORAGE_PUBLIC_BASE_URL || ''))
  };
  const configuredCount = [values.url, values.serviceKey, values.bucket].filter(Boolean).length;
  if (configuredCount > 0 && configuredCount < 3) throw new UploadStorageError('storage_configuration_incomplete', 503);
  return configuredCount === 3 ? values : null;
}

function encodeObjectPath(bucket, objectKey) {
  return [bucket, ...objectKey.split('/')].map(encodeURIComponent).join('/');
}

function supabaseHeaders(serviceKey, extra = {}) {
  return {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    ...extra
  };
}

async function remoteObjectExists({ endpoint, headers, expectedSize, fetchImpl }) {
  const response = await fetchImpl(endpoint, { method: 'HEAD', headers });
  if (response.status === 404) return false;
  if (!response.ok) throw new UploadStorageError('storage_remote_unavailable', 503);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length !== expectedSize) throw new UploadStorageError('immutable_object_conflict', 409);
  return true;
}

export async function storeSupabaseImmutablePdf({ bytes, sha256, env = process.env, fetchImpl = global.fetch }) {
  const config = supabaseConfiguration(env);
  if (!config) throw new UploadStorageError('storage_not_configured', 503);
  if (typeof fetchImpl !== 'function') throw new UploadStorageError('storage_remote_unavailable', 503);

  const objectKey = immutableObjectKey(sha256);
  const endpoint = `${config.url}/storage/v1/object/${encodeObjectPath(config.bucket, objectKey)}`;
  const authHeaders = supabaseHeaders(config.serviceKey);
  if (await remoteObjectExists({ endpoint, headers: authHeaders, expectedSize: bytes.length, fetchImpl })) {
    return {
      backend: 'supabase-storage',
      objectKey,
      pdfUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/${objectKey.split('/').map(encodeURIComponent).join('/')}` : null,
      deduplicated: true
    };
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: supabaseHeaders(config.serviceKey, {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
      'x-upsert': 'false'
    }),
    body: bytes
  });

  if (!response.ok) {
    // A concurrent content-addressed upload may win after the HEAD request.
    if (response.status === 400 || response.status === 409) {
      const exists = await remoteObjectExists({ endpoint, headers: authHeaders, expectedSize: bytes.length, fetchImpl });
      if (exists) {
        return {
          backend: 'supabase-storage',
          objectKey,
          pdfUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/${objectKey.split('/').map(encodeURIComponent).join('/')}` : null,
          deduplicated: true
        };
      }
    }
    throw new UploadStorageError('storage_remote_write_failed', 502);
  }

  return {
    backend: 'supabase-storage',
    objectKey,
    pdfUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/${objectKey.split('/').map(encodeURIComponent).join('/')}` : null,
    deduplicated: false
  };
}

export function selectUploadStorage({ env = process.env, fetchImpl = global.fetch } = {}) {
  const remote = supabaseConfiguration(env);
  if (remote) {
    return input => storeSupabaseImmutablePdf({ ...input, env, fetchImpl });
  }

  const productionLike = env.NODE_ENV === 'production' || Boolean(env.VERCEL);
  if (productionLike) throw new UploadStorageError('storage_not_configured', 503);
  return input => storeLocalImmutablePdf({ ...input, env });
}
