import { allowMethod, json, readJson } from './shared.js';
import { requireUser, safeAuthResponse, supabaseConfig, supabaseRest } from './auth.js';
import { requireDraftVersion } from './draft-revisions.js';
import { buildTeachingShareSnapshot, createShareToken, publicShareRecord, shareTokenHash, validShareToken } from './teaching-share.js';

function routePath(req) {
  if (Object.prototype.hasOwnProperty.call(req.query || {}, 'sharePath')) return `/${String(req.query.sharePath || '').replace(/^\/+/, '')}`;
  if (Object.prototype.hasOwnProperty.call(req.query || {}, 'share')) return '/';
  if (req.query?.path) return `/${String(req.query.path).replace(/^\/+/, '')}`;
  try { return new URL(req.url, 'http://local').pathname.replace(/^\/api\/shares/, '') || '/'; } catch { return '/'; }
}

function parts(req) {
  return routePath(req).split('/').filter(Boolean).map(decodeURIComponent);
}

function ownedQuery(userId, extra = {}) {
  return { owner_id: `eq.${userId}`, ...extra };
}

function userRest(user, path, options = {}) {
  return supabaseRest(path, { ...options, authToken: user.token });
}

function clampExpiryDays(value) {
  return Math.max(1, Math.min(30, Number(value) || 14));
}

async function ownedDraft(user, id) {
  const rows = await userRest(user, 'lesson_drafts', { query: { user_id: `eq.${user.id}`, id: `eq.${id}`, limit: '1' } });
  if (!Array.isArray(rows) || !rows[0]) throw Object.assign(new Error('draft_not_found'), { code: 'draft_not_found', status: 404 });
  return rows[0];
}

function assertCurrentVersion(current, value) {
  const expected = requireDraftVersion(value);
  if (expected !== Number(current.version)) throw Object.assign(new Error('edit_conflict'), { code: 'edit_conflict', status: 409 });
}

async function resolvePublicShare(token) {
  const config = supabaseConfig();
  if (!config.serviceKey) throw Object.assign(new Error('share_service_not_configured'), { code: 'share_service_not_configured', status: 503 });
  const hash = shareTokenHash(token);
  const rows = await supabaseRest('teaching_shares', {
    query: { token_hash: `eq.${hash}`, revoked_at: 'is.null', limit: '1' }
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error('share_not_found'), { code: 'share_not_found', status: 404 });
  }
  return row;
}

export default async function handler(req, res) {
  try {
    const path = parts(req);
    if (path.length === 1 && path[0] === 'resolve' && req.method === 'POST') {
      const body = await readJson(req);
      const row = await resolvePublicShare(validShareToken(body.token));
      return json(res, 200, {
        share: {
          ...publicShareRecord(row),
          snapshot: row.snapshot
        }
      });
    }

    const user = await requireUser(req);
    if (!path.length && req.method === 'GET') {
      const draftId = String(req.query?.draftId || '').trim();
      const rows = await userRest(user, 'teaching_shares', {
        query: ownedQuery(user.id, {
          ...(draftId ? { draft_id: `eq.${draftId}` } : {}),
          select: 'id,draft_id,snapshot_digest,version,expires_at,revoked_at,created_at,snapshot',
          order: 'created_at.desc'
        })
      });
      return json(res, 200, { shares: (rows || []).map(publicShareRecord) });
    }
    if (!path.length && req.method === 'POST') {
      const body = await readJson(req);
      const current = await ownedDraft(user, body.draftId);
      assertCurrentVersion(current, body.version);
      const now = new Date();
      const snapshot = buildTeachingShareSnapshot(current, { now: now.toISOString() });
      const token = createShareToken();
      const expiresAt = new Date(now.getTime() + clampExpiryDays(body.expiresInDays) * 86400000).toISOString();
      const rows = await userRest(user, 'teaching_shares', {
        method: 'POST',
        body: {
          owner_id: user.id,
          draft_id: current.id,
          token_hash: shareTokenHash(token),
          snapshot_digest: snapshot.digest,
          snapshot,
          version: 1,
          expires_at: expiresAt
        }
      });
      const created = Array.isArray(rows) ? rows[0] : rows;
      return json(res, 201, { share: publicShareRecord(created), token });
    }
    if (path.length === 2 && path[1] === 'revoke' && req.method === 'POST') {
      const body = await readJson(req);
      const expected = requireDraftVersion(body.version);
      const rows = await userRest(user, 'teaching_shares', {
        method: 'PATCH',
        query: ownedQuery(user.id, { id: `eq.${path[0]}`, version: `eq.${expected}` }),
        body: { revoked_at: new Date().toISOString(), version: expected + 1 }
      });
      if (!Array.isArray(rows) || !rows[0]) throw Object.assign(new Error('edit_conflict'), { code: 'edit_conflict', status: 409 });
      return json(res, 200, { share: publicShareRecord(rows[0]) });
    }
    return allowMethod(res, ['GET', 'POST']);
  } catch (error) {
    return safeAuthResponse(res, error);
  }
}
