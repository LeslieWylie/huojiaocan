import assert from 'node:assert/strict';
import test from 'node:test';
import handler from './assets.js';
import { lessonStudySourceKey } from '../shared/lesson-study.js';
import { buildSameLessonComparison, mergeSameLessonComparison } from '../shared/same-lesson-comparison.js';

function confirmedDraft() {
  return {
    id: 'draft-1', user_id: 'teacher-1', version: 8, title: '《岳阳楼记》', question: '如何理解先忧后乐？',
    answer: {
      summary: '由写景进入价值判断。',
      planApproval: {
        status: 'confirmed', hasUnconfirmedChanges: false, confirmedVersion: 7, confirmedAt: '2026-08-26T08:00:00.000Z',
        confirmedSnapshot: {
          plan: { summary: '由写景进入价值判断。' },
          conditions: { title: '《岳阳楼记》' },
          citations: [{ documentId: 'textbook', documentType: 'textbook', pdfPage: 56, quote: '先天下之忧而忧' }]
        }
      },
      assetMeta: { status: 'draft', favorite: false, tags: [] }
    },
    citations: [{ id: 'E1', documentId: 'textbook', documentType: 'textbook', pdfPage: 56, quote: '先天下之忧而忧' }],
    cards: [{ id: 'board', status: 'locked' }]
  };
}

function responseJson(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return value; } };
}

async function invokeApi({ method, url, body, stored = confirmedDraft(), storedById, patchRows, postRows }) {
  const calls = [];
  const previous = {
    fetch: globalThis.fetch,
    url: process.env.SUPABASE_URL,
    anon: process.env.SUPABASE_ANON_KEY,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = async (target, options = {}) => {
    calls.push({ url: String(target), options });
    if (String(target).includes('/auth/v1/user')) return responseJson({ id: 'teacher-1', email: 'teacher@example.test' });
    if (options.method === 'PATCH') {
      const patch = JSON.parse(options.body);
      return responseJson(patchRows === undefined ? [{ ...stored, ...patch }] : patchRows);
    }
    if (options.method === 'POST') {
      const created = JSON.parse(options.body);
      return responseJson(postRows === undefined ? [{ id: 'copy-1', ...created }] : postRows);
    }
    const requestedId = new URL(String(target)).searchParams.get('id')?.replace(/^eq\./u, '');
    return responseJson([requestedId && storedById?.[requestedId] ? storedById[requestedId] : stored]);
  };
  const result = { statusCode: 0, headers: {}, payload: null };
  const req = { method, url, body, headers: { authorization: 'Bearer test-token' }, query: {} };
  const res = {
    status(code) { result.statusCode = code; return this; },
    setHeader(key, value) { result.headers[key] = value; return this; },
    end(value) { result.payload = JSON.parse(value); return this; }
  };
  try {
    await handler(req, res);
    return { ...result, calls };
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.anon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previous.anon;
    if (previous.service === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.service;
  }
}

test('asset list exposes workflow summary without the complete confirmation snapshot', async () => {
  const result = await invokeApi({ method: 'GET', url: '/api/assets' });
  assert.equal(result.statusCode, 200);
  const asset = result.payload.assets[0];
  assert.equal(asset.teacherConfirmed, true);
  assert.equal(asset.cardsGenerated, true);
  assert.equal(asset.lockedCardsCount, 1);
  assert.equal(asset.workflowStatus, 'cards_locked');
  assert.equal(asset.content.answer.planApproval.confirmedSnapshot, undefined);
});

test('archive requires an explicit matching version and a current valid confirmation', async () => {
  const missingVersion = await invokeApi({ method: 'POST', url: '/api/assets', body: { draftId: 'draft-1' } });
  assert.equal(missingVersion.statusCode, 400);
  assert.equal(missingVersion.payload.error, 'version_required');
  assert.equal(missingVersion.calls.some(call => call.options.method === 'PATCH'), false);

  const pending = confirmedDraft();
  pending.answer.planApproval.hasUnconfirmedChanges = true;
  pending.answer.planApproval.status = 'changes_pending';
  const notConfirmed = await invokeApi({ method: 'POST', url: '/api/assets', body: { draftId: 'draft-1', version: 8 }, stored: pending });
  assert.equal(notConfirmed.statusCode, 409);
  assert.equal(notConfirmed.payload.error, 'plan_confirmation_required');
  assert.equal(notConfirmed.calls.some(call => call.options.method === 'PATCH'), false);

  const malformed = confirmedDraft();
  malformed.answer.planApproval.confirmedSnapshot.citations = [];
  const invalidSnapshot = await invokeApi({ method: 'POST', url: '/api/assets', body: { draftId: 'draft-1', version: 8 }, stored: malformed });
  assert.equal(invalidSnapshot.statusCode, 409);
  assert.equal(invalidSnapshot.payload.error, 'plan_confirmation_required');
  assert.equal(invalidSnapshot.calls.some(call => call.options.method === 'PATCH'), false);
});

test('archive CAS-writes the client version and reports datastore conflicts', async () => {
  const saved = await invokeApi({ method: 'POST', url: '/api/assets', body: { draftId: 'draft-1', version: 8 } });
  assert.equal(saved.statusCode, 201);
  const write = saved.calls.find(call => call.options.method === 'PATCH');
  assert.equal(new URL(write.url).searchParams.get('version'), 'eq.8');
  assert.equal(JSON.parse(write.options.body).version, 9);

  const conflict = await invokeApi({ method: 'POST', url: '/api/assets', body: { draftId: 'draft-1', version: 8 }, patchRows: [] });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.payload.error, 'edit_conflict');
});

test('favorite and tag mutations require version and use CAS', async () => {
  for (const request of [
    { url: '/api/assets/draft-1/favorite', body: { favorite: true } },
    { url: '/api/assets/draft-1/tags', body: { tags: ['文言文'] } }
  ]) {
    const missing = await invokeApi({ method: 'PATCH', ...request });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.payload.error, 'version_required');
    assert.equal(missing.calls.some(call => call.options.method === 'PATCH'), false);

    const saved = await invokeApi({ method: 'PATCH', url: request.url, body: { ...request.body, version: 8 } });
    assert.equal(saved.statusCode, 200);
    const write = saved.calls.find(call => call.options.method === 'PATCH');
    assert.equal(new URL(write.url).searchParams.get('version'), 'eq.8');
  }
});

test('copy creates an editable draft without confirmation, locks, or source confirmation markers', async () => {
  const source = confirmedDraft();
  source.cards[0] = { ...source.cards[0], lockedAt: '2026-08-26T09:00:00Z', lockedBy: 'teacher-1', sourceConfirmedVersion: 7, sourceConfirmedAt: '2026-08-26T08:00:00Z' };
  const result = await invokeApi({ method: 'POST', url: '/api/assets/draft-1/copy', body: { version: source.version }, stored: source });
  assert.equal(result.statusCode, 201);
  assert.equal(result.payload.draft.version, 1);
  assert.equal(result.payload.draft.answer.planApproval, undefined);
  assert.equal(result.payload.draft.cards[0].status, 'draft');
  assert.equal(result.payload.draft.cards[0].lockedAt, undefined);
  assert.equal(result.payload.draft.cards[0].lockedBy, undefined);
  assert.equal(result.payload.draft.cards[0].sourceConfirmedVersion, undefined);
  assert.equal(result.payload.draft.cards[0].sourceConfirmedAt, undefined);
  assert.equal(result.payload.asset.workflowStatus, 'cards_generated');
});

test('copy requires the current source version', async () => {
  const result = await invokeApi({ method: 'POST', url: '/api/assets/draft-1/copy', body: {}, stored: confirmedDraft() });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error, 'version_required');
  assert.equal(result.calls.some(call => call.options.method === 'POST'), false);
});

function comparisonDraft(id, level, secure) {
  const value = confirmedDraft();
  value.id = id;
  value.version = id === 'draft-1' ? 8 : 5;
  value.lesson_context = { classLevel: level };
  value.answer.lesson = { title: '《岳阳楼记》', coreQuestion: '作者如何由写景走向价值判断？' };
  value.answer.lessonStudy = {
    status: 'confirmed', sourceKey: '', title: '《岳阳楼记》', inquiryQuestion: '作者如何由写景走向价值判断？', confirmedAt: '2026-08-27T08:00:00.000Z',
    evidence: { classroomFacts: ['课堂第 2 步已经达成'], reflectionFacts: ['尚未解决：价值归纳缺少支架'], learningSummary: { itemCount: 1, submittedCount: 40, counts: { secure, partial: 20, notYet: 40 - secure - 20 }, focus: ['景—情—志关系'] } },
    conclusion: { decision: 'adjust', finding: `${level}课堂发现`, nextTrial: `${level}下一轮调整`, scopeBoundary: '只说明本次课堂。' }
  };
  value.answer.lessonStudy.sourceKey = lessonStudySourceKey(value);
  return value;
}

test('same-lesson comparison reads two owned studies and CAS-saves only teacher synthesis', async () => {
  const left = comparisonDraft('draft-1', '基础班', 14);
  const right = comparisonDraft('draft-2', '提高班', 22);
  const storedById = { 'draft-1': left, 'draft-2': right };
  const preview = await invokeApi({ method: 'GET', url: '/api/assets/draft-1/compare/draft-2', stored: left, storedById });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.payload.comparison.left.label, '基础班');
  assert.equal(preview.payload.comparison.right.label, '提高班');

  const saved = await invokeApi({
    method: 'PATCH', url: '/api/assets/draft-1/compare/draft-2', stored: left, storedById,
    body: { version: 8, confirm: true, comparison: { left: { finding: '浏览器伪造事实' }, synthesis: { decision: 'transferable', transferableFinding: '两次课堂都需要景—情—志支架。', contextBoundary: '适用于完成文意疏通的班级。', nextExperiment: '只改变关系图出现时机。' } } }
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.payload.comparison.status, 'confirmed');
  assert.equal(saved.payload.comparison.left.finding, '基础班课堂发现');
  const write = saved.calls.find(call => call.options.method === 'PATCH');
  assert.equal(new URL(write.url).searchParams.get('version'), 'eq.8');
  assert.equal(JSON.parse(write.options.body).answer.sameLessonComparisons[0].synthesis.decision, 'transferable');
});

test('research ledger is built only from the authenticated owner rows and omits full draft answers', async () => {
  const stored = comparisonDraft('draft-1', '基础班', 14);
  const result = await invokeApi({ method: 'GET', url: '/api/assets/research', stored });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ledger.items.length, 1);
  assert.equal(result.payload.ledger.items[0].samples[0].draftId, 'draft-1');
  assert.equal('answer' in result.payload.ledger.items[0].samples[0], false);
  const dataCall = result.calls.find(call => call.url.includes('/rest/v1/lesson_drafts'));
  assert.match(new URL(dataCall.url).searchParams.get('user_id'), /^eq\.teacher-1$/u);
});

test('observation protocol requires and projects a confirmed owned same-lesson comparison', async () => {
  const left = comparisonDraft('draft-1', '基础班', 14);
  const right = comparisonDraft('draft-2', '提高班', 22);
  const generated = buildSameLessonComparison(left, right);
  left.answer.sameLessonComparisons = [mergeSameLessonComparison(generated, { synthesis: { decision: 'needs_more', transferableFinding: '先建立景情关系，再进入价值判断。', contextBoundary: '适用于完成文意疏通的班级。', nextExperiment: '只改变关系图出现时机。' } }, { confirm: true, confirmedBy: 'teacher-1' })];
  const storedById = { 'draft-1': left, 'draft-2': right };
  const result = await invokeApi({ method: 'GET', url: '/api/assets/draft-1/compare/draft-2/observation', stored: left, storedById });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.protocol.lessonTitle, '《岳阳楼记》');
  assert.equal(result.payload.protocol.changeVariable, '只改变关系图出现时机。');
  assert.equal(result.payload.protocol.timeWindows.length, 4);
  assert.equal('answer' in result.payload.protocol, false);
});
