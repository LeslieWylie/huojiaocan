import { allowMethod, json, readJson } from '../serverless/shared.js';
import { requireUser, safeAuthResponse, supabaseRest } from '../serverless/auth.js';
import { assetFromDraft, copyDraftForReuse, filterAssets } from '../serverless/asset-model.js';
import { compareRevision, confirmedDraftContext, requireDraftVersion } from '../serverless/draft-revisions.js';
import teachingShareHandler from '../serverless/teaching-share-api.js';
import { buildSameLessonComparison, mergeSameLessonComparison, normalizeSameLessonComparison, sameLessonComparisonIsStale } from '../shared/same-lesson-comparison.js';
import { buildResearchLedger } from '../shared/research-ledger.js';
import { buildObservationProtocol } from '../shared/observation-protocol.js';

function routePath(req) {
  if (req.query?.path) return `/${String(req.query.path).replace(/^\/+/, '')}`;
  try { return new URL(req.url, 'http://local').pathname.replace(/^\/api\/assets/, '') || '/'; } catch { return '/'; }
}
function parts(req) { return routePath(req).split('/').filter(Boolean).map(decodeURIComponent); }
function userRest(user, path, options = {}) { return supabaseRest(path, { ...options, authToken: user.token }); }
function query(userId, extra = {}) { return { user_id: `eq.${userId}`, ...extra }; }

async function patchOwnedDraft(user, id, expectedVersion, body) {
  const rows = await userRest(user, 'lesson_drafts', {
    method: 'PATCH',
    body,
    query: query(user.id, { id: `eq.${id}`, version: `eq.${Number(expectedVersion)}` })
  });
  if (!Array.isArray(rows) || !rows[0]) throw Object.assign(new Error('edit_conflict'), { code: 'edit_conflict', status: 409 });
  return rows[0];
}

function assertCurrentVersion(current, value) {
  const expected = requireDraftVersion(value);
  if (expected !== Number(current.version)) {
    throw Object.assign(new Error('edit_conflict'), { code: 'edit_conflict', status: 409 });
  }
  return expected;
}

function assertArchivable(current) {
  const approval = current.answer?.planApproval;
  if (approval?.status !== 'confirmed' || approval?.hasUnconfirmedChanges === true) {
    throw Object.assign(new Error('plan_confirmation_required'), { code: 'plan_confirmation_required', status: 409 });
  }
  confirmedDraftContext(current);
}

async function draft(user, id) {
  const rows = await userRest(user, 'lesson_drafts', { query: query(user.id, { id: `eq.${id}`, limit: '1' }) });
  if (!Array.isArray(rows) || !rows[0]) throw Object.assign(new Error('asset_not_found'), { code: 'asset_not_found', status: 404 });
  return rows[0];
}

async function listDraftAssets(user) {
  const rows = await userRest(user, 'lesson_drafts', { query: query(user.id, { select: 'id,title,question,answer,citations,cards,version,created_at,updated_at,lesson_context', order: 'updated_at.desc' }) });
  return (rows || []).map(assetFromDraft);
}

export default async function handler(req, res) {
  if (Object.prototype.hasOwnProperty.call(req.query || {}, 'share') || Object.prototype.hasOwnProperty.call(req.query || {}, 'sharePath')) {
    return teachingShareHandler(req, res);
  }
  try {
    const user = await requireUser(req);
    const path = parts(req);
    if (!path.length && req.method === 'GET') {
      const items = await listDraftAssets(user);
      const queryText = req.query?.q || req.query?.query || '';
      const availableTags = [...new Set(items.flatMap(item => Array.isArray(item.tags) ? item.tags : []))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      return json(res, 200, { assets: filterAssets(items, { query: queryText, favorite: req.query?.favorite === 'true', tag: req.query?.tag || '' }), tags: availableTags });
    }
    if (!path.length && req.method === 'POST') {
      const body = await readJson(req);
      const current = await draft(user, body.draftId);
      assertCurrentVersion(current, body.version);
      assertArchivable(current);
      const currentMeta = current.answer?.assetMeta || {};
      const nextVersion = Number(current.version || 1) + 1;
      const nextAnswer = { ...(current.answer || {}), assetMeta: { ...currentMeta, assetKey: currentMeta.assetKey || current.id, status: 'published', tags: Array.isArray(body.tags) ? body.tags.slice(0, 20) : (currentMeta.tags || []), favorite: Boolean(body.favorite ?? currentMeta.favorite), publishedAt: new Date().toISOString(), version: nextVersion } };
      const saved = await patchOwnedDraft(user, current.id, current.version || 1, { answer: nextAnswer, updated_at: new Date().toISOString(), version: nextVersion });
      return json(res, 201, { asset: assetFromDraft(saved) });
    }
    if (path.length === 1 && path[0] === 'research' && req.method === 'GET') {
      const rows = await userRest(user, 'lesson_drafts', { query: query(user.id, { select: 'id,title,question,answer,citations,cards,version,created_at,updated_at,lesson_context', order: 'updated_at.desc' }) });
      return json(res, 200, { ledger: buildResearchLedger(rows || []) });
    }
    const id = path[0];
    if (path.length === 4 && path[1] === 'compare' && path[3] === 'observation' && req.method === 'GET') {
      const [left, right] = await Promise.all([draft(user, id), draft(user, path[2])]);
      const comparison = (Array.isArray(left.answer?.sameLessonComparisons) ? left.answer.sameLessonComparisons : [])
        .map(normalizeSameLessonComparison)
        .find(item => item.right?.draftId === right.id);
      if (!comparison) throw Object.assign(new Error('same_lesson_comparison_not_found'), { code: 'same_lesson_comparison_not_found', status: 404 });
      if (sameLessonComparisonIsStale(comparison, left, right)) throw Object.assign(new Error('same_lesson_comparison_stale'), { code: 'same_lesson_comparison_stale', status: 409 });
      return json(res, 200, { protocol: buildObservationProtocol(comparison, left, right) });
    }
    if (path.length === 3 && path[1] === 'compare' && req.method === 'GET') {
      const [left, right] = await Promise.all([draft(user, id), draft(user, path[2])]);
      const stored = (Array.isArray(left.answer?.sameLessonComparisons) ? left.answer.sameLessonComparisons : [])
        .map(normalizeSameLessonComparison)
        .find(item => item.right?.draftId === right.id);
      const stale = stored ? sameLessonComparisonIsStale(stored, left, right) : false;
      const comparison = stored && !stale ? stored : buildSameLessonComparison(left, right);
      return json(res, 200, { comparison, stale, leftVersion: Number(left.version || 1) });
    }
    if (path.length === 3 && path[1] === 'compare' && req.method === 'PATCH') {
      const [left, right] = await Promise.all([draft(user, id), draft(user, path[2])]);
      const body = await readJson(req);
      assertCurrentVersion(left, body.version);
      const answer = JSON.parse(JSON.stringify(left.answer || {}));
      const comparisons = (Array.isArray(answer.sameLessonComparisons) ? answer.sameLessonComparisons : []).map(normalizeSameLessonComparison);
      const existingIndex = comparisons.findIndex(item => item.right?.draftId === right.id);
      const existing = existingIndex >= 0 ? comparisons[existingIndex] : null;
      const stale = existing ? sameLessonComparisonIsStale(existing, left, right) : false;
      if (existing && stale) {
        answer.sameLessonComparisonHistory = [existing, ...(Array.isArray(answer.sameLessonComparisonHistory) ? answer.sameLessonComparisonHistory : [])].slice(0, 12);
      }
      const current = existing && !stale ? existing : buildSameLessonComparison(left, right);
      const comparison = mergeSameLessonComparison(current, body.comparison || body, {
        confirm: body.confirm === true,
        confirmedBy: user.id
      });
      const nextComparisons = comparisons.filter(item => item.right?.draftId !== right.id);
      answer.sameLessonComparisons = [comparison, ...nextComparisons].slice(0, 8);
      const nextVersion = Number(left.version || 1) + 1;
      const saved = await patchOwnedDraft(user, left.id, left.version || 1, { answer, updated_at: comparison.updatedAt, version: nextVersion });
      return json(res, 200, { comparison, draft: saved, leftVersion: nextVersion });
    }
    if (path.length === 2 && path[1] === 'copy' && req.method === 'POST') {
      const current = await draft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, body.version);
      const prepared = copyDraftForReuse(current, { title: body.title, useFeedback: body.useFeedback === true });
      const rows = await userRest(user, 'lesson_drafts', {
        method: 'POST',
        body: { user_id: user.id, ...prepared },
      });
      const created = Array.isArray(rows) ? rows[0] : rows;
      return json(res, 201, { draft: created, asset: assetFromDraft(created) });
    }
    if (path.length === 2 && path[1] === 'versions' && req.method === 'GET') {
      const current = await draft(user, id);
      const revisions = Array.isArray(current.answer?.revisions) ? current.answer.revisions : [];
      const versions = [{ id: 'current', version: current.version, status: current.answer?.assetMeta?.status || 'draft', title: current.title, updatedAt: current.updated_at }, ...revisions.map(item => ({ id: item.id, version: item.version, reason: item.reason, createdAt: item.createdAt, title: item.title }))];
      const compareId = req.query?.compare;
      return json(res, 200, { versions, comparison: compareId ? compareRevision(current, compareId) : null });
    }
    if (path.length === 2 && path[1] === 'favorite' && req.method === 'PATCH') {
      const current = await draft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, body.version);
      const nextVersion = Number(current.version || 1) + 1;
      const answer = { ...(current.answer || {}), assetMeta: { ...(current.answer?.assetMeta || {}), favorite: Boolean(body.favorite), version: nextVersion } };
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: new Date().toISOString(), version: nextVersion });
      return json(res, 200, { asset: assetFromDraft(saved) });
    }
    if (path.length === 2 && path[1] === 'tags' && req.method === 'PATCH') {
      const current = await draft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, body.version);
      const tags = Array.isArray(body.tags)
        ? [...new Set(body.tags.map(tag => String(tag || '').trim()).filter(Boolean))].slice(0, 20)
        : [];
      const nextVersion = Number(current.version || 1) + 1;
      const answer = { ...(current.answer || {}), assetMeta: { ...(current.answer?.assetMeta || {}), tags, version: nextVersion } };
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: new Date().toISOString(), version: nextVersion });
      return json(res, 200, { asset: assetFromDraft(saved) });
    }
    if (path.length === 1 && req.method === 'GET') return json(res, 200, { asset: assetFromDraft(await draft(user, id)) });
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (error) { return safeAuthResponse(res, error); }
}
