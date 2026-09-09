import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AssetNotFoundError, newAssetId } from '@openmaic/storage';
import { supabaseConfig, supabaseRest } from './auth.js';

const TABLE = 'slide_media_assets';

function cleanMime(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase().slice(0, 120);
}

function selectedMime(data, meta, fallback = '') {
  return cleanMime(meta && Object.prototype.hasOwnProperty.call(meta, 'contentType') ? meta.contentType : data.type || fallback);
}

function objectKey(owner, id) {
  return `slide-assets/${encodeURIComponent(owner)}/${encodeURIComponent(id)}`;
}

function storageEndpoint(config, key) {
  return `${config.url}/storage/v1/object/${[config.bucket, ...key.split('/')].map(encodeURIComponent).join('/')}`;
}

function storageConfig(env = process.env) {
  const database = supabaseConfig(env);
  const bucket = String(env.SUPABASE_STORAGE_BUCKET || '').trim();
  return database.url && database.serviceKey && bucket ? { ...database, bucket } : null;
}

function storageHeaders(config, extra = {}) {
  return { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, ...extra };
}

async function storageWrite(config, key, bytes, mime, { replace = false, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(storageEndpoint(config, key), {
    method: 'POST',
    headers: storageHeaders(config, {
      'Content-Type': mime || 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'x-upsert': replace ? 'true' : 'false'
    }),
    body: bytes
  });
  if (!response.ok) throw new Error('slide_asset_storage_write_failed');
}

async function storageRead(config, key, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(storageEndpoint(config, key), { headers: storageHeaders(config) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('slide_asset_storage_read_failed');
  return new Uint8Array(await response.arrayBuffer());
}

async function storageRemove(config, key, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}`, {
    method: 'DELETE',
    headers: storageHeaders(config, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: [key] })
  });
  if (!response.ok && response.status !== 404) throw new Error('slide_asset_storage_delete_failed');
}

function rowQuery(principal, ref, extra = {}) {
  return { owner_id: `eq.${principal.key}`, asset_id: `eq.${String(ref)}`, ...extra };
}

export class SupabaseSlideAssetStore {
  constructor({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.config = storageConfig(env);
    if (!this.config) throw new Error('slide_asset_storage_not_configured');
  }

  async row(principal, ref) {
    const rows = await supabaseRest(TABLE, {
      query: rowQuery(principal, ref, { select: 'asset_id,object_key,mime_type,byte_size,revision,metadata', limit: '1' }),
      env: this.env,
      fetchImpl: this.fetchImpl
    });
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async list(principal, limit = 12) {
    const rows = await supabaseRest(TABLE, {
      query: { owner_id: `eq.${principal.key}`, select: 'asset_id,mime_type,byte_size,revision,metadata,created_at,updated_at', order: 'updated_at.desc', limit: String(Math.max(1, Math.min(60, Number(limit) || 12))) },
      env: this.env,
      fetchImpl: this.fetchImpl
    });
    return (Array.isArray(rows) ? rows : []).map(row => ({ id: row.asset_id, mime: row.mime_type || '', byteLength: Number(row.byte_size), revision: Number(row.revision), metadata: row.metadata || {}, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  async put(principal, data, meta = {}) {
    const id = newAssetId();
    const key = objectKey(principal.key, id);
    const bytes = new Uint8Array(await data.arrayBuffer());
    const mime = selectedMime(data, meta);
    await storageWrite(this.config, key, bytes, mime, { fetchImpl: this.fetchImpl });
    try {
      await supabaseRest(TABLE, {
        method: 'POST',
        body: { asset_id: id, owner_id: principal.key, object_key: key, mime_type: mime, byte_size: bytes.byteLength, revision: 1, metadata: meta },
        env: this.env,
        fetchImpl: this.fetchImpl
      });
    } catch (error) {
      await storageRemove(this.config, key, this.fetchImpl).catch(() => {});
      throw error;
    }
    return id;
  }

  async identify(principal, ref) {
    const row = await this.row(principal, ref);
    return row ? { mime: row.mime_type || '', revision: Number(row.revision), byteLength: Number(row.byte_size) } : null;
  }

  async resolve(principal, ref) {
    const row = await this.row(principal, ref);
    if (!row) return null;
    const bytes = await storageRead(this.config, row.object_key, this.fetchImpl);
    return bytes ? { bytes, mime: row.mime_type || '', revision: Number(row.revision) } : null;
  }

  async remove(principal, ref) {
    const row = await this.row(principal, ref);
    if (!row) return;
    await supabaseRest(TABLE, { method: 'DELETE', query: rowQuery(principal, ref), env: this.env, fetchImpl: this.fetchImpl });
    await storageRemove(this.config, row.object_key, this.fetchImpl);
  }

  async replace(principal, ref, data, meta) {
    const row = await this.row(principal, ref);
    if (!row) throw new AssetNotFoundError();
    const bytes = new Uint8Array(await data.arrayBuffer());
    const mime = selectedMime(data, meta, row.mime_type);
    const metadata = meta === undefined ? row.metadata || {} : meta;
    const revision = Number(row.revision) + 1;
    const nextKey = `${row.object_key}.r${revision}-${newAssetId().slice(4)}`;
    await storageWrite(this.config, nextKey, bytes, mime, { fetchImpl: this.fetchImpl });
    let rows;
    try {
      rows = await supabaseRest(TABLE, {
        method: 'PATCH',
        query: rowQuery(principal, ref, { revision: `eq.${Number(row.revision)}` }),
        body: { object_key: nextKey, mime_type: mime, byte_size: bytes.byteLength, revision, metadata, updated_at: new Date().toISOString() },
        env: this.env,
        fetchImpl: this.fetchImpl
      });
      if (!Array.isArray(rows) || !rows[0]) throw new Error('slide_asset_edit_conflict');
    } catch (error) {
      await storageRemove(this.config, nextKey, this.fetchImpl).catch(() => {});
      throw error;
    }
    await storageRemove(this.config, row.object_key, this.fetchImpl).catch(() => {});
    return revision;
  }
}

function localRoot(env = process.env) {
  return path.resolve(env.SLIDE_ASSET_LOCAL_DIR || path.join(os.tmpdir(), 'huojiaocan-slide-assets'));
}

export class LocalSlideAssetStore {
  constructor({ env = process.env } = {}) {
    this.root = localRoot(env);
  }

  paths(principal, ref) {
    const owner = encodeURIComponent(principal.key);
    const id = encodeURIComponent(String(ref));
    return { bytes: path.join(this.root, owner, `${id}.bin`), meta: path.join(this.root, owner, `${id}.json`) };
  }

  async row(principal, ref) {
    try { return JSON.parse(await fs.readFile(this.paths(principal, ref).meta, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  }

  async list(principal, limit = 12) {
    const directory = path.join(this.root, encodeURIComponent(principal.key));
    let names;
    try { names = await fs.readdir(directory); } catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
    const rows = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
      const id = decodeURIComponent(name.slice(0, -5));
      const [row, stat] = await Promise.all([this.row(principal, id), fs.stat(path.join(directory, name))]);
      return row ? { id, mime: row.mime || '', byteLength: Number(row.byteLength), revision: Number(row.revision), metadata: row.metadata || {}, createdAt: row.createdAt || stat.birthtime.toISOString(), updatedAt: stat.mtime.toISOString() } : null;
    }));
    return rows.filter(Boolean).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))).slice(0, Math.max(1, Math.min(60, Number(limit) || 12)));
  }

  async put(principal, data, meta = {}) {
    const id = newAssetId();
    const files = this.paths(principal, id);
    const bytes = new Uint8Array(await data.arrayBuffer());
    await fs.mkdir(path.dirname(files.bytes), { recursive: true, mode: 0o700 });
    await fs.writeFile(files.bytes, bytes, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(files.meta, JSON.stringify({ mime: selectedMime(data, meta), byteLength: bytes.byteLength, revision: 1, metadata: meta, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    return id;
  }

  async identify(principal, ref) {
    const row = await this.row(principal, ref);
    return row ? { mime: row.mime || '', revision: Number(row.revision), byteLength: Number(row.byteLength) } : null;
  }

  async resolve(principal, ref) {
    const row = await this.row(principal, ref);
    if (!row) return null;
    try { return { bytes: new Uint8Array(await fs.readFile(this.paths(principal, ref).bytes)), mime: row.mime || '', revision: Number(row.revision) }; }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  }

  async remove(principal, ref) {
    const files = this.paths(principal, ref);
    await Promise.all([fs.rm(files.bytes, { force: true }), fs.rm(files.meta, { force: true })]);
  }

  async replace(principal, ref, data, meta) {
    const row = await this.row(principal, ref);
    if (!row) throw new AssetNotFoundError();
    const files = this.paths(principal, ref);
    const bytes = new Uint8Array(await data.arrayBuffer());
    const next = { mime: selectedMime(data, meta, row.mime), byteLength: bytes.byteLength, revision: Number(row.revision) + 1, metadata: meta === undefined ? row.metadata || {} : meta, createdAt: row.createdAt || new Date().toISOString() };
    const suffix = `${process.pid}-${Date.now()}`;
    await fs.writeFile(`${files.bytes}.${suffix}`, bytes, { mode: 0o600 });
    await fs.writeFile(`${files.meta}.${suffix}`, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(`${files.bytes}.${suffix}`, files.bytes);
    await fs.rename(`${files.meta}.${suffix}`, files.meta);
    return next.revision;
  }
}

export function createSlideAssetStore(options = {}) {
  return storageConfig(options.env || process.env) ? new SupabaseSlideAssetStore(options) : new LocalSlideAssetStore(options);
}
