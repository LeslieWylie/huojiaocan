import assert from 'node:assert/strict';
import test from 'node:test';
import handler, { assertLockedCardsUnchanged, relayDraftId, repairDraftForClassroom, sanitizeClientAnswer, sanitizeClientCards } from './drafts.js';
import { buildLearningEvidence, learningEvidenceSourceKey } from '../shared/learning-evidence.js';
import { buildPreClassPulse } from '../shared/preclass-pulse.js';
import { normalizeTeachingDeliberation, teachingDeliberationSourceKey } from '../shared/teaching-deliberation.js';
import { buildLessonStudy } from '../shared/lesson-study.js';
import { buildLayeredHomework } from '../shared/layered-homework.js';
import { buildHomeworkReview, mergeHomeworkReview } from '../shared/homework-review.js';
import { defaultClassroomMomentTriage, mergeClassroomMomentTriage } from '../shared/classroom-carryover.js';

function draftFixture() {
  return {
    id: 'draft-old',
    title: '怎么备课岳阳楼记',
    question: '怎样备课《岳阳楼记》？',
    answer: {
      lesson: { title: '换成两课时设计', coreQuestion: '换成两课时设计' },
      lessonPlan: [
        { title: '品味语言', duration: '18分钟' },
        { title: '课堂小结', duration: '5分钟' },
        { title: '诵读课文，疏通文意', duration: '18分钟' }
      ],
      periodPlan: {
        version: 1, sourceKey: 'legacy-period', periods: 2,
        activities: [
          { id: 'a1', title: '品味语言', period: 1, minutes: 18, order: 1 },
          { id: 'a2', title: '课堂小结', period: 1, minutes: 5, order: 2 },
          { id: 'a3', title: '诵读课文，疏通文意', period: 2, minutes: 18, order: 3 }
        ]
      }
    },
    cards: [
      {
        id: 'board-1', type: 'board', status: 'draft',
        items: [{ id: 'b1', text: '写景：洞庭大观 → 迁客骚人的悲喜', citationIds: ['citation-1'] }],
        boardPlan: { coreQuestion: '换成两课时设计', branches: [], blankZones: ['教师补写'], stage: 4 }
      },
      {
        id: 'question-1', type: 'question', status: 'locked',
        items: [{ id: 'q1', text: '教师手改内容，不应覆盖', citationIds: ['citation-1'] }]
      }
    ]
  };
}

test('repairDraftForClassroom restores lesson identity without overwriting teacher work', () => {
  const original = draftFixture();
  const result = repairDraftForClassroom(original);

  assert.equal(result.changed, true);
  assert.equal(result.draft.title, '《岳阳楼记》');
  assert.equal(result.draft.answer.lesson.title, '《岳阳楼记》');
  assert.doesNotMatch(result.draft.answer.lesson.coreQuestion, /换成.*课时/u);
  assert.equal(result.draft.cards[0].boardPlan.stage, 4);
  assert.equal(result.draft.cards[0].boardPlan.blankZones[0], '教师补写');
  assert.ok(result.draft.cards[0].boardPlan.branches.some(branch => branch.nodes.length));
  assert.deepEqual(result.draft.cards[1], original.cards[1]);
  assert.deepEqual(result.draft.answer.periodPlan.activities.map(item => item.title), ['诵读课文，疏通文意', '品味语言', '课堂小结']);
  assert.equal(result.draft.answer.periodPlan.repairKind, 'derived_sequence');
});

test('repairDraftForClassroom does not disturb a normal manually named plan', () => {
  const draft = draftFixture();
  draft.title = '《岳阳楼记》两课时备课方案';
  draft.answer.lesson = { title: '《岳阳楼记》', coreQuestion: '作者如何由写景转入先忧后乐的价值判断？' };
  draft.cards[0].boardPlan = {
    coreQuestion: '作者如何由写景转入先忧后乐的价值判断？',
    branches: [{ title: '文本发现', nodes: [] }], stage: 3
  };
  draft.answer.periodPlan.updatedAt = '2026-08-27T00:00:00.000Z';
  const result = repairDraftForClassroom(draft);
  assert.equal(result.changed, false);
  assert.deepEqual(result.draft, draft);
});

test('assertLockedCardsUnchanged allows an unchanged locked card', () => {
  const locked = { id: 'board-1', type: 'board', status: 'locked', items: [{ id: 'item-1', text: '教师确认内容' }] };
  assert.equal(assertLockedCardsUnchanged([locked], [{ ...locked }]), true);
});

test('assertLockedCardsUnchanged rejects changing or dropping a locked card', () => {
  const locked = { id: 'board-1', type: 'board', status: 'locked', items: [{ id: 'item-1', text: '教师确认内容' }] };
  assert.throws(
    () => assertLockedCardsUnchanged([locked], [{ ...locked, items: [{ id: 'item-1', text: '被覆盖' }] }]),
    error => error.code === 'card_locked' && error.status === 409
  );
  assert.throws(
    () => assertLockedCardsUnchanged([locked], []),
    error => error.code === 'card_locked' && error.status === 409
  );
});

test('client card writes cannot mint locks or source confirmation metadata', () => {
  const current = { id: 'board-1', type: 'board', status: 'draft', sourceConfirmedVersion: 8, sourceConfirmedAt: 'server-time' };
  const [saved] = sanitizeClientCards([
    { ...current, status: 'locked', sourceConfirmedVersion: 99, sourceConfirmedAt: 'forged', lockedBy: 'forged', title: '教师修改' }
  ], [current]);
  assert.equal(saved.status, 'draft');
  assert.equal(saved.sourceConfirmedVersion, 8);
  assert.equal(saved.sourceConfirmedAt, 'server-time');
  assert.equal(saved.lockedBy, undefined);
  assert.equal(saved.title, '教师修改');

  const [created] = sanitizeClientCards([{ id: 'new', status: 'locked', sourceConfirmedVersion: 99, lockedBy: 'forged' }]);
  assert.equal(created.status, 'draft');
  assert.equal(created.sourceConfirmedVersion, undefined);
  assert.equal(created.lockedBy, undefined);
});

test('ordinary draft saves preserve server-owned previous lesson reflection provenance', () => {
  const current = {
    summary: '原方案',
    previousLessonReflection: {
      sourceDraftId: 'source-draft', sourceVersion: 7,
      feedback: { observedLearning: '学生能找到关键词' }
    }
  };
  const saved = sanitizeClientAnswer({
    summary: '教师修改后的方案',
    previousLessonReflection: {
      sourceDraftId: 'forged', sourceVersion: 99,
      feedback: { observedLearning: '伪造内容' }
    }
  }, current);
  assert.equal(saved.summary, '教师修改后的方案');
  assert.deepEqual(saved.previousLessonReflection, current.previousLessonReflection);
  assert.equal(sanitizeClientAnswer({ previousLessonReflection: { sourceDraftId: 'forged' } }).previousLessonReflection, undefined);
});

test('ordinary draft saves cannot forge or erase a server-owned classroom run', () => {
  const current = { summary: '原方案', classroomRun: { status: 'in_progress', currentStage: 3, keywords: [{ id: 'k1', stage: 3, text: '土地、黎明' }] } };
  const saved = sanitizeClientAnswer({ summary: '教师修改', classroomRun: { status: 'confirmed', keywords: [] } }, current);
  assert.equal(saved.summary, '教师修改');
  assert.deepEqual(saved.classroomRun, current.classroomRun);
  assert.equal(sanitizeClientAnswer({ classroomRun: { status: 'completed' } }).classroomRun, undefined);
});

test('ordinary draft saves cannot forge classroom triage or next-lesson completion state', () => {
  const current = {
    classroomMomentTriage: { status: 'confirmed', sourceKey: 'source', items: [{ sourceMomentId: 'm1', resolution: 'carryover', carryoverText: '先画关系图' }] },
    previousLessonCarryover: { status: 'active', items: [{ sourceMomentId: 'm1', text: '先画关系图', status: 'todo' }] }
  };
  const saved = sanitizeClientAnswer({ classroomMomentTriage: { status: 'draft', items: [] }, previousLessonCarryover: { status: 'completed', items: [] } }, current);
  assert.deepEqual(saved.classroomMomentTriage, current.classroomMomentTriage);
  assert.deepEqual(saved.previousLessonCarryover, current.previousLessonCarryover);
  const fresh = sanitizeClientAnswer({ classroomMomentTriage: current.classroomMomentTriage, previousLessonCarryover: current.previousLessonCarryover });
  assert.equal(fresh.classroomMomentTriage, undefined);
  assert.equal(fresh.previousLessonCarryover, undefined);
});

test('ordinary draft saves cannot forge or erase a server-owned question rehearsal', () => {
  const current = { summary: '原方案', questionRehearsal: { status: 'draft', steps: [{ id: 'q1', question: '真实问题', citationIds: ['E1'] }] } };
  const saved = sanitizeClientAnswer({ summary: '教师修改', questionRehearsal: { status: 'confirmed', steps: [] } }, current);
  assert.equal(saved.summary, '教师修改');
  assert.deepEqual(saved.questionRehearsal, current.questionRehearsal);
  assert.equal(sanitizeClientAnswer({ questionRehearsal: { status: 'confirmed' } }).questionRehearsal, undefined);
});

test('ordinary draft saves cannot forge or erase server-owned learning evidence', () => {
  const current = { summary: '原方案', learningEvidence: { status: 'draft', entries: [{ id: 'L1', prompt: '真实问题', assignedCount: 42 }] } };
  const saved = sanitizeClientAnswer({ summary: '教师修改', learningEvidence: { status: 'confirmed', entries: [] } }, current);
  assert.equal(saved.summary, '教师修改');
  assert.deepEqual(saved.learningEvidence, current.learningEvidence);
  assert.equal(sanitizeClientAnswer({ learningEvidence: { status: 'confirmed' } }).learningEvidence, undefined);
});

test('ordinary draft saves cannot forge or erase a server-owned pre-class pulse', () => {
  const current = { summary: '原方案', preClassPulse: { status: 'draft', prompts: [{ id: 'P1', prompt: '真实问题', citationIds: ['E1'] }] } };
  const saved = sanitizeClientAnswer({ summary: '教师修改', preClassPulse: { status: 'confirmed', prompts: [] } }, current);
  assert.equal(saved.summary, '教师修改');
  assert.deepEqual(saved.preClassPulse, current.preClassPulse);
  assert.equal(sanitizeClientAnswer({ preClassPulse: { status: 'confirmed' } }).preClassPulse, undefined);
});

test('ordinary draft saves cannot forge or erase server-owned teaching choices', () => {
  const current = { summary: '原方案', teachingDeliberation: { status: 'draft', sourceKey: 'server-key', decisions: [{ id: 'd1', question: '真实取舍' }] } };
  const saved = sanitizeClientAnswer({ summary: '教师修改', teachingDeliberation: { status: 'confirmed', decisions: [] } }, current);
  assert.equal(saved.summary, '教师修改');
  assert.deepEqual(saved.teachingDeliberation, current.teachingDeliberation);
  assert.equal(sanitizeClientAnswer({ teachingDeliberation: { status: 'confirmed' } }).teachingDeliberation, undefined);
});

test('ordinary draft saves cannot forge or erase a server-owned lesson study', () => {
  const current = { summary: '原方案', lessonStudy: { status: 'draft', sourceKey: 'server-key', title: '真实课题' } };
  const saved = sanitizeClientAnswer({ summary: '教师修改', lessonStudy: { status: 'confirmed', title: '伪造课题' } }, current);
  assert.equal(saved.summary, '教师修改');
  assert.deepEqual(saved.lessonStudy, current.lessonStudy);
  assert.equal(sanitizeClientAnswer({ lessonStudy: { status: 'confirmed' } }).lessonStudy, undefined);
});

test('ordinary draft saves cannot forge or erase server-owned same-lesson comparisons', () => {
  const current = { summary: '原方案', sameLessonComparisons: [{ sourceKey: 'server-key', status: 'confirmed' }], sameLessonComparisonHistory: [{ sourceKey: 'old-key' }] };
  const saved = sanitizeClientAnswer({ summary: '教师修改', sameLessonComparisons: [{ sourceKey: 'browser-key' }], sameLessonComparisonHistory: [] }, current);
  assert.equal(saved.summary, '教师修改');
  assert.deepEqual(saved.sameLessonComparisons, current.sameLessonComparisons);
  assert.deepEqual(saved.sameLessonComparisonHistory, current.sameLessonComparisonHistory);
  assert.equal(sanitizeClientAnswer({ sameLessonComparisons: [{ sourceKey: 'browser-key' }] }).sameLessonComparisons, undefined);
});

test('ordinary draft saves cannot forge or erase server-owned teaching slides', () => {
  const current = { summary: '原方案', teachingSlides: { sourceKey: 'slides1:server', status: 'confirmed', slides: [{ id: 'cover', title: '真实课题' }] } };
  const saved = sanitizeClientAnswer({ summary: '教师修改', teachingSlides: { sourceKey: 'slides1:browser', status: 'confirmed' } }, current);
  assert.equal(saved.summary, '教师修改');
  assert.deepEqual(saved.teachingSlides, current.teachingSlides);
  assert.equal(sanitizeClientAnswer({ teachingSlides: { sourceKey: 'slides1:browser' } }).teachingSlides, undefined);
});

test('ordinary draft saves cannot forge or erase server-owned layered homework', () => {
  const current = { summary: '原方案', layeredHomework: { sourceKey: 'homework1:server', status: 'confirmed', tasks: [{ id: 'foundation', prompt: '真实题目' }] } };
  const saved = sanitizeClientAnswer({ summary: '教师修改', layeredHomework: { sourceKey: 'homework1:browser', status: 'confirmed' } }, current);
  assert.equal(saved.summary, '教师修改');
  assert.deepEqual(saved.layeredHomework, current.layeredHomework);
  assert.equal(sanitizeClientAnswer({ layeredHomework: { sourceKey: 'homework1:browser' } }).layeredHomework, undefined);
});

test('ordinary draft saves cannot forge or erase server-owned homework review', () => {
  const current = { summary: '原方案', homeworkReview: { sourceKey: 'review1:server', status: 'draft', responseCount: 30 }, homeworkReviewHistory: [{ sourceKey: 'old' }] };
  const saved = sanitizeClientAnswer({ summary: '教师修改', homeworkReview: { sourceKey: 'browser', responseCount: 999 }, homeworkReviewHistory: [] }, current);
  assert.equal(saved.summary, '教师修改');
  assert.deepEqual(saved.homeworkReview, current.homeworkReview);
  assert.deepEqual(saved.homeworkReviewHistory, current.homeworkReviewHistory);
});

function apiDraft() {
  return {
    id: 'draft-1', user_id: 'teacher-1', version: 8, title: '《岳阳楼记》', question: '如何理解先忧后乐？',
    scope: ['textbook'], lesson_context: { periods: 2 },
    answer: {
      summary: '由写景进入价值判断。',
      lessonPlan: [{ title: '比较阴晴两景' }],
      questionChain: [{ question: '两种景如何影响情感？' }],
      assessment: ['能引用原文说明判断'],
      revisions: []
    },
    citations: [{ id: 'E1', documentId: 'textbook', documentType: 'textbook', pdfPage: 56, quote: '本文题为《岳阳楼记》' }],
    cards: []
  };
}

function deliberationDraft() {
  const current = apiDraft();
  const generated = normalizeTeachingDeliberation({
    promptVersion: 1,
    sourceDraftVersion: current.version,
    sourceKey: teachingDeliberationSourceKey(current),
    decisions: [
      { id: 'decision-1', question: '第一课时收在哪里？', whyItMatters: '影响第二课时起点', recommendedOptionId: 'option-A', options: [
        { id: 'option-A', label: '收在写景', approach: '先完成阴晴两景比较', tradeoff: '价值讨论后置', evidenceRefs: ['E1'] },
        { id: 'option-B', label: '推进景情', approach: '完成景情关系', tradeoff: '朗读时间更紧', evidenceRefs: ['E1'] }
      ] },
      { id: 'decision-2', question: '朗读怎样进入分析？', whyItMatters: '影响文本体验', recommendedOptionId: 'option-B', options: [
        { id: 'option-A', label: '先读后析', approach: '先形成整体感受', tradeoff: '细读起步较慢', evidenceRefs: ['E1'] },
        { id: 'option-B', label: '随析随读', approach: '分析后立即朗读验证', tradeoff: '整体感受较碎', evidenceRefs: ['E1'] }
      ] }
    ]
  });
  current.answer.teachingDeliberation = generated;
  return current;
}

function responseJson(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return value; } };
}

async function invokeApi({ method, url, body, draft = apiDraft(), deleteRows = [], listRows, createdRow, createStatus = 200, modelResponse }) {
  const calls = [];
  const previous = {
    fetch: globalThis.fetch,
    url: process.env.SUPABASE_URL,
    anon: process.env.SUPABASE_ANON_KEY,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
    gatewayUrl: process.env.LLM_GATEWAY_BASE_URL,
    gatewayKey: process.env.LLM_GATEWAY_API_KEY,
    gatewayModel: process.env.LLM_GATEWAY_MODEL
  };
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (modelResponse) {
    process.env.LLM_GATEWAY_BASE_URL = 'https://gateway.test';
    process.env.LLM_GATEWAY_API_KEY = 'gateway-secret';
    process.env.LLM_GATEWAY_MODEL = 'test-model';
  }
  globalThis.fetch = async (target, options = {}) => {
    calls.push({ url: String(target), options });
    if (String(target).startsWith('https://gateway.test/')) return responseJson({ choices: [{ message: { content: typeof modelResponse === 'string' ? modelResponse : JSON.stringify(modelResponse) }, finish_reason: 'stop' }], model: 'test-model' });
    if (String(target).includes('/auth/v1/user')) return responseJson({ id: 'teacher-1', email: 'teacher@example.test' });
    if (options.method === 'PATCH') {
      const patchBody = JSON.parse(options.body);
      return responseJson([{ ...draft, ...patchBody }]);
    }
    if (options.method === 'DELETE') return responseJson(deleteRows);
    if (options.method === 'POST') return responseJson([createdRow || draft], createStatus);
    if (String(target).includes('/rest/v1/lesson_drafts') && new URL(String(target)).searchParams.get('id') === `eq.${createdRow?.id}`) return responseJson([createdRow]);
    if (String(target).includes('/rest/v1/lesson_drafts') && !new URL(String(target)).searchParams.has('id') && listRows) return responseJson(listRows);
    return responseJson([draft]);
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
    if (previous.gatewayUrl === undefined) delete process.env.LLM_GATEWAY_BASE_URL; else process.env.LLM_GATEWAY_BASE_URL = previous.gatewayUrl;
    if (previous.gatewayKey === undefined) delete process.env.LLM_GATEWAY_API_KEY; else process.env.LLM_GATEWAY_API_KEY = previous.gatewayKey;
    if (previous.gatewayModel === undefined) delete process.env.LLM_GATEWAY_MODEL; else process.env.LLM_GATEWAY_MODEL = previous.gatewayModel;
  }
}

test('GET returns the stored draft without an implicit repair write', async () => {
  const result = await invokeApi({ method: 'GET', url: '/api/drafts/draft-1' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.draft.version, 8);
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('GET exposes a repaired legacy view without writing it implicitly', async () => {
  const legacy = draftFixture();
  legacy.id = 'draft-1'; legacy.user_id = 'teacher-1'; legacy.version = 8;
  const result = await invokeApi({ method: 'GET', url: '/api/drafts/draft-1', draft: legacy });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.repairNeeded, true);
  assert.equal(result.payload.draft.title, '《岳阳楼记》');
  assert.deepEqual(result.payload.draft.cards[1], legacy.cards[1]);
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('GET task flow returns one compact next action per owned draft', async () => {
  const rows = [
    { ...apiDraft(), id: 'review-draft', title: '《我爱这土地》', updated_at: '2026-08-27T09:00:00Z', answer: { classroomRun: { status: 'pending_review' } } },
    { ...apiDraft(), id: 'prepare-draft', title: '《乡愁》', updated_at: '2026-08-27T10:00:00Z', answer: {}, cards: [] }
  ];
  const result = await invokeApi({ method: 'GET', url: '/api/drafts/tasks', listRows: rows });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.tasks.map(item => item.draftId), ['review-draft', 'prepare-draft']);
  assert.equal(result.payload.tasks[0].phase, 'confirm_reflection');
  assert.equal(result.payload.tasks[0].lessonTitle, '《我爱这土地》');
  assert.equal('answer' in result.payload.tasks[0], false);
  assert.equal('cards' in result.payload.tasks[0], false);
  const queryUrl = new URL(result.calls.find(call => call.url.includes('/rest/v1/lesson_drafts')).url);
  assert.equal(queryUrl.searchParams.get('user_id'), 'eq.teacher-1');
  assert.equal(queryUrl.searchParams.get('limit'), '50');
});

test('GET class profiles returns only compact owner-scoped class continuity', async () => {
  const rows = [
    {
      ...apiDraft(), id: 'class-draft-1', title: '《岳阳楼记》', updated_at: '2026-08-27T10:00:00Z',
      lesson_context: { className: '九年级3班', classLevel: '基础扎实' },
      answer: { lessonReflection: { observedLearning: '能找到景物变化', nextLessonAdjustment: '加强情感转折的追问' } }
    },
    { ...apiDraft(), id: 'class-draft-2', title: '《醉翁亭记》', lesson_context: { className: '九年级4班' }, answer: {} },
    { ...apiDraft(), id: 'no-class', lesson_context: {}, answer: { rawStudentWork: '不得返回' } }
  ];
  const result = await invokeApi({ method: 'GET', url: '/api/drafts/class-profiles', listRows: rows });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.profiles.map(item => item.className), ['九年级3班', '九年级4班']);
  assert.match(result.payload.profiles[0].confirmedObservation, /景物变化/u);
  assert.match(result.payload.profiles[0].nextFocus, /情感转折/u);
  assert.equal('answer' in result.payload.profiles[0], false);
  const queryUrl = new URL(result.calls.find(call => call.url.includes('/rest/v1/lesson_drafts')).url);
  assert.equal(queryUrl.searchParams.get('user_id'), 'eq.teacher-1');
  assert.equal(queryUrl.searchParams.get('limit'), '80');
});

test('class adaptation creates an isolated editable draft for another class', async () => {
  const source = apiDraft();
  source.lesson_context = { periods: 2, className: '九年级3班', classLevel: '基础扎实', lessonRef: { title: '岳阳楼记' } };
  source.answer = {
    ...source.answer,
    lesson: { title: '《岳阳楼记》', coreQuestion: '景、情、理如何层层推进？' },
    planApproval: { status: 'confirmed' },
    classroomRun: { status: 'confirmed', moments: [{ text: '源班课堂记录' }] },
    lessonReflection: { observedLearning: '源班复盘' }
  };
  source.cards = [{ id: 'board-1', type: 'board', status: 'locked', lockedAt: 'server-time', sourceConfirmedVersion: 8, items: [{ id: 'b1', text: '景 → 情 → 理', citationIds: ['E1'] }], boardPlan: { coreQuestion: '景、情、理如何层层推进？' } }];
  const operationId = 'adapt-operation-1';
  const expectedId = relayDraftId('teacher-1', source.id, `class:${operationId}`);
  const result = await invokeApi({
    method: 'POST', url: `/api/drafts/${source.id}/adapt-class`, draft: source,
    listRows: [{ ...apiDraft(), id: 'target-history', lesson_context: { className: '九年级4班', classLevel: '需要更多支架' }, answer: {} }],
    createdRow: { id: expectedId, version: 1 },
    body: { sourceVersion: 8, targetClassName: '九年级4班', operationId }
  });
  assert.equal(result.statusCode, 201);
  const post = result.calls.find(call => call.options.method === 'POST' && call.url.includes('/rest/v1/lesson_drafts'));
  const created = JSON.parse(post.options.body);
  assert.equal(created.id, expectedId);
  assert.equal(created.user_id, 'teacher-1');
  assert.equal(created.lesson_context.className, '九年级4班');
  assert.equal(created.lesson_context.classLevel, '需要更多支架');
  assert.equal(created.answer.lesson.title, '《岳阳楼记》');
  assert.equal(created.answer.planApproval, undefined);
  assert.equal(created.answer.classroomRun, undefined);
  assert.equal(created.answer.lessonReflection, undefined);
  assert.equal(created.answer.classAdaptation.sourceDraftId, source.id);
  assert.equal(created.answer.classAdaptation.operationId, operationId);
  assert.equal(created.cards[0].status, 'draft');
  assert.equal(created.cards[0].lockedAt, undefined);
  assert.deepEqual(created.cards[0].items[0].citationIds, ['E1']);
  assert.deepEqual(created.citations, source.citations);
});

test('class adaptation is idempotent for one operation and owner scoped', async () => {
  const source = { ...apiDraft(), lesson_context: { className: '九年级3班' } };
  const existing = { ...apiDraft(), id: 'adapted-draft', lesson_context: { className: '九年级4班' }, answer: { classAdaptation: { operationId: 'same-op', sourceDraftId: source.id } } };
  const result = await invokeApi({ method: 'POST', url: `/api/drafts/${source.id}/adapt-class`, draft: source, listRows: [existing], body: { sourceVersion: source.version, targetClassName: '九年级4班', operationId: 'same-op' } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.reused, true);
  assert.equal(result.payload.draft.id, 'adapted-draft');
  assert.equal(result.calls.some(call => call.options.method === 'POST'), false);
  const listCall = result.calls.find(call => call.url.includes('/rest/v1/lesson_drafts') && new URL(call.url).searchParams.has('order'));
  assert.equal(new URL(listCall.url).searchParams.get('user_id'), 'eq.teacher-1');
});

test('PATCH requires an explicit client version before writing', async () => {
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1', body: { title: '新标题' } });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error, 'version_required');
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

function slideDraft() {
  const current = apiDraft();
  current.answer.lesson = { title: '《岳阳楼记》', coreQuestion: '作者如何由写景走向价值判断？' };
  current.answer.objectives = ['比较阴晴两景', '引用原文说明判断'];
  current.answer.planApproval = { status: 'confirmed', hasUnconfirmedChanges: false, confirmedAt: '2026-08-27T08:00:00Z' };
  current.citations.push({ id: 'E2', documentId: 'teacher-guide', documentType: 'teacher_guide', pdfPage: 224, quote: '教师参考提示' });
  current.cards = [
    { id: 'b', type: 'board', items: [{ id: 'b1', text: '景—情—志', citationIds: ['E1', 'E2'] }] },
    { id: 'q', type: 'question', items: [{ id: 'q1', text: '两种景怎样影响情感？', citationIds: ['E1', 'E2'] }] },
    { id: 'a', type: 'assessment', items: [{ id: 'a1', text: '引用原文说明古仁人之心。', citationIds: ['E1', 'E2'] }] }
  ];
  return current;
}

test('slides endpoint builds from the owned confirmed draft without writing on read', async () => {
  const result = await invokeApi({ method: 'GET', url: '/api/drafts/draft-1/slides', draft: slideDraft() });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.deck.slides.length, 7);
  assert.equal(result.payload.draftVersion, 8);
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('slides endpoint CAS-saves teacher edits while keeping citation identity server-owned', async () => {
  const current = slideDraft();
  const preview = await invokeApi({ method: 'GET', url: '/api/drafts/draft-1/slides', draft: current });
  const submitted = structuredClone(preview.payload.deck);
  submitted.slides[2].title = '教师修改：回到原文';
  submitted.slides[2].citationIds = ['forged'];
  submitted.slides[2].teacherCitationIds = ['forged'];
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/slides', draft: current, body: { version: 8, deck: submitted, confirm: true } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.deck.status, 'confirmed');
  assert.equal(result.payload.deck.slides[2].title, '教师修改：回到原文');
  assert.deepEqual(result.payload.deck.slides[2].citationIds, ['E1']);
  assert.deepEqual(result.payload.deck.slides[2].teacherCitationIds, ['E2']);
  const write = result.calls.find(call => call.options.method === 'PATCH');
  assert.equal(new URL(write.url).searchParams.get('version'), 'eq.8');
  assert.equal(JSON.parse(write.options.body).version, 9);
});

test('homework endpoint builds A B C tasks from the owned confirmed draft', async () => {
  const result = await invokeApi({ method: 'GET', url: '/api/drafts/draft-1/homework-pack', draft: slideDraft() });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.pack.tasks.map(item => item.level), ['A', 'B', 'C']);
  assert.equal(result.payload.draftVersion, 8);
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('homework endpoint saves teacher wording but keeps scores and evidence server-owned', async () => {
  const current = slideDraft();
  const preview = await invokeApi({ method: 'GET', url: '/api/drafts/draft-1/homework-pack', draft: current });
  const submitted = structuredClone(preview.payload.pack);
  submitted.tasks[0].prompt = '教师修改后的基础题'; submitted.tasks[0].score = 100; submitted.tasks[0].studentCitationIds = ['forged']; submitted.tasks[0].rubric[0].points = 100;
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/homework-pack', draft: current, body: { version: 8, pack: submitted, confirm: true } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.pack.status, 'confirmed');
  assert.equal(result.payload.pack.tasks[0].prompt, '教师修改后的基础题');
  assert.notEqual(result.payload.pack.tasks[0].score, 100);
  assert.deepEqual(result.payload.pack.tasks[0].studentCitationIds, ['E1']);
  const write = result.calls.find(call => call.options.method === 'PATCH');
  assert.equal(new URL(write.url).searchParams.get('version'), 'eq.8');
  assert.equal(JSON.parse(write.options.body).version, 9);
});

function markingDraft() {
  const current = slideDraft();
  current.answer.layeredHomework = buildLayeredHomework(current);
  current.answer.layeredHomework.status = 'confirmed';
  return current;
}

test('anonymous marking saves only class aggregate and returns transient feedback', async () => {
  const current = markingDraft(), task = current.answer.layeredHomework.tasks[0];
  const rawAnswer = '我找到了相关词句，但作用分析还不完整。';
  const modelResponse = { results: [{ index: 1, score: 2, strengths: ['能够定位原文'], nextStep: '补充词句怎样形成画面特点。', issueTags: [task.rubric[1].id] }], commonPatterns: ['能够定位原文，但解释关系不足'], nextActions: ['用“词句—特点—判断”关系图集中讲评'] };
  const result = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/homework-review/analyze', draft: current, body: { version: 8, taskId: task.id, responses: [rawAnswer] }, modelResponse });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.results.length, 1);
  assert.equal(result.payload.draftVersion, 9);
  const write = result.calls.find(call => call.options.method === 'PATCH');
  const saved = JSON.parse(write.options.body);
  assert.equal(saved.answer.homeworkReview.responseCount, 1);
  assert.equal(JSON.stringify(saved).includes(rawAnswer), false);
  assert.equal(JSON.stringify(saved).includes('补充词句怎样形成画面特点'), false);
});

test('homework review confirmation only accepts server-proposed actions', async () => {
  const current = markingDraft(), task = current.answer.layeredHomework.tasks[0];
  current.answer.homeworkReview = buildHomeworkReview({ pack: current.answer.layeredHomework, task, results: [{ status: 'partial', score: 2 }], patterns: ['解释关系不足'], nextActions: ['集中讲评关系图'] });
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/homework-review', draft: current, body: { version: 8, review: { selectedActionIds: ['action-1', 'forged'], teacherNote: '先补足景情关系，再进入价值判断。' }, confirm: true } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.review.status, 'confirmed');
  assert.deepEqual(result.payload.review.selectedActionIds, ['action-1']);
  assert.equal(result.payload.review.patterns[0], '解释关系不足');
});

test('period planning is versioned and makes the previous confirmation pending without changing lesson identity', async () => {
  const current = apiDraft();
  current.title = '《岳阳楼记》两课时教学设计';
  current.answer.lesson = { title: '岳阳楼记', coreQuestion: '古仁人之心是什么？' };
  current.answer.planApproval = {
    status: 'confirmed', hasUnconfirmedChanges: false,
    confirmedSnapshot: { plan: { summary: current.answer.summary }, conditions: current.lesson_context, citations: current.citations }
  };
  const periodPlan = {
    version: 1, sourceKey: 'period-test', periods: 2,
    activities: [{ id: 'activity-1', title: '朗读写景段', detail: '', period: 1, minutes: 18, order: 1 }]
  };
  const result = await invokeApi({
    method: 'PATCH', url: '/api/drafts/draft-1', draft: current,
    body: { version: 8, answer: { ...current.answer, periodPlan } }
  });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.deepEqual(saved.answer.periodPlan, periodPlan);
  assert.equal(saved.answer.planApproval.status, 'changes_pending');
  assert.equal(saved.answer.planApproval.hasUnconfirmedChanges, true);
  assert.equal(Object.hasOwn(saved, 'title'), false);
  assert.equal(saved.answer.lesson.title, '岳阳楼记');
  assert.equal(saved.version, 9);
});

test('feedback endpoint stores a bounded reflection without invalidating confirmation', async () => {
  const current = apiDraft();
  current.answer.planApproval = {
    status: 'confirmed', hasUnconfirmedChanges: false,
    confirmedSnapshot: { plan: { summary: current.answer.summary }, conditions: current.lesson_context, citations: current.citations }
  };
  const result = await invokeApi({
    method: 'PATCH', url: '/api/drafts/draft-1/feedback', draft: current,
    body: {
      version: 8,
      reflection: {
        classResponse: '能找出关键句', unfinishedQuestions: '还不能说明景与情的关系',
        usedCards: ['提问卡', '提问卡'], nextStep: '拆成两次追问', ignored: '不得写入'
      }
    }
  });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.planApproval.status, 'confirmed');
  assert.equal(saved.answer.planApproval.hasUnconfirmedChanges, false);
  assert.equal(saved.answer.lessonReflection.observedLearning, '能找出关键句');
  assert.equal(saved.answer.lessonReflection.unresolvedLearning, '还不能说明景与情的关系');
  assert.deepEqual(saved.answer.lessonReflection.cardUsage, ['提问卡']);
  assert.equal(saved.answer.lessonReflection.ignored, undefined);
  assert.equal(saved.version, 9);
});

test('feedback endpoint rejects a stale version before writing', async () => {
  const result = await invokeApi({
    method: 'PATCH', url: '/api/drafts/draft-1/feedback',
    body: { version: 7, reflection: { classResponse: '本地旧记录' } }
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.payload.error, 'edit_conflict');
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('lesson study generation reads server classroom evidence and ignores client-authored findings', async () => {
  const current = apiDraft();
  current.answer.classroomRun = {
    status: 'confirmed', currentStage: 5, paceSignal: 'students_stuck',
    stages: [{ stage: 2, outcome: 'reached' }, { stage: 4, outcome: 'needs_followup' }],
    keywords: [{ id: 'k1', stage: 4, text: '景情关系' }], usedCards: ['提问卡']
  };
  current.answer.lessonReflection = {
    observedLearning: '学生能比较阴晴两景。',
    unresolvedLearning: '还不能说明古仁人之心。',
    nextLessonAdjustment: '增加景—情—志关系支架。'
  };
  current.cards = [{ id: 'assessment-1', type: 'assessment', items: [{ id: 'a1', text: '能引用原文说明判断', citationIds: ['E1'] }] }];
  const result = await invokeApi({
    method: 'POST', url: '/api/drafts/draft-1/lesson-study/generate', draft: current,
    body: { version: 8, conclusion: { decision: 'retain', finding: '客户端伪造结论' }, citationIds: ['evil'] }
  });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.lessonStudy.status, 'draft');
  assert.notEqual(saved.answer.lessonStudy.conclusion.finding, '客户端伪造结论');
  assert.deepEqual(saved.answer.lessonStudy.citationIds, ['E1']);
  assert.ok(saved.answer.lessonStudy.evidence.classroomFacts.some(item => /仍需追问/u.test(item)));
  assert.equal(saved.version, 9);
});

test('lesson study confirmation preserves source facts and stores only the teacher conclusion', async () => {
  const current = apiDraft();
  current.answer.classroomRun = { status: 'confirmed', stages: [{ stage: 2, outcome: 'reached' }], keywords: [{ id: 'k1', stage: 2, text: '阴晴两景' }] };
  current.answer.lessonReflection = { observedLearning: '学生能比较两种景物。', unresolvedLearning: '价值归纳仍需追问。' };
  current.cards = [{ id: 'assessment-1', type: 'assessment', items: [{ id: 'a1', text: '能引用原文说明判断', citationIds: ['E1'] }] }];
  current.answer.lessonStudy = buildLessonStudy(current, '2026-08-27T08:00:00.000Z');
  const submitted = structuredClone(current.answer.lessonStudy);
  submitted.title = '伪造标题';
  submitted.evidence.classroomFacts = ['伪造课堂事实'];
  submitted.conclusion = { decision: 'adjust', finding: '比较任务有效，价值归纳仍需支架。', nextTrial: '下次只调整归纳问题。' };
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/lesson-study', draft: current, body: { version: 8, lessonStudy: submitted, confirm: true } });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.lessonStudy.status, 'confirmed');
  assert.equal(saved.answer.lessonStudy.title, '《岳阳楼记》');
  assert.notDeepEqual(saved.answer.lessonStudy.evidence.classroomFacts, ['伪造课堂事实']);
  assert.equal(saved.answer.lessonStudy.conclusion.decision, 'adjust');
  assert.equal(saved.answer.lessonStudy.confirmedBy, 'teacher-1');
});

test('classroom run endpoint stores bounded classroom facts without changing locked cards', async () => {
  const current = apiDraft();
  current.cards = [{ id: 'board-1', type: 'board', status: 'locked', items: [{ id: 'b1', text: '教师定稿板书' }] }];
  const result = await invokeApi({
    method: 'PATCH', url: '/api/drafts/draft-1/classroom-run', draft: current,
    body: { version: 8, status: 'in_progress', currentStage: 4, stages: [{ stage: 3, outcome: 'reached' }], keywords: [{ id: 'k1', stage: 3, text: '土地、河流、黎明' }], moments: [{ id: 'm1', type: 'confusion', stage: 3, text: '仍不能说明意象关系', elapsedMinutes: 18.7 }, { id: 'forged', type: 'student_name', text: '不应保存' }], usedCards: ['板书卡', '伪造卡片'], startedAt: 'forged' }
  });
  assert.equal(result.statusCode, 200);
  const write = result.calls.find(call => call.options.method === 'PATCH');
  const saved = JSON.parse(write.options.body);
  assert.equal(saved.answer.classroomRun.status, 'in_progress');
  assert.equal(saved.answer.classroomRun.currentStage, 4);
  assert.deepEqual(saved.answer.classroomRun.usedCards, ['板书卡']);
  assert.deepEqual(saved.answer.classroomRun.moments, [{ id: 'm1', type: 'confusion', stage: 3, text: '仍不能说明意象关系', elapsedMinutes: 18, createdAt: null }]);
  assert.notEqual(saved.answer.classroomRun.startedAt, 'forged');
  assert.deepEqual(saved.cards, undefined);
});

test('classroom run completion is versioned and seeds no lesson reflection automatically', async () => {
  const current = apiDraft();
  current.answer.classroomRun = { status: 'in_progress', currentStage: 3, keywords: [{ id: 'k1', stage: 3, text: '关键意象' }], startedAt: 'server-start' };
  const result = await invokeApi({
    method: 'PATCH', url: '/api/drafts/draft-1/classroom-run', draft: current,
    body: { version: 8, status: 'pending_review', currentStage: 5, stages: [{ stage: 3, outcome: 'needs_followup' }] }
  });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.classroomRun.status, 'pending_review');
  assert.equal(saved.answer.classroomRun.startedAt, 'server-start');
  assert.ok(saved.answer.classroomRun.endedAt);
  assert.equal(saved.answer.lessonReflection, undefined);
});

test('saving teacher reflection confirms the pending classroom record in the same versioned write', async () => {
  const current = apiDraft();
  current.answer.classroomRun = { status: 'pending_review', currentStage: 5, stages: [{ stage: 3, outcome: 'needs_followup' }], keywords: [{ id: 'k1', stage: 3, text: '关键意象' }], endedAt: 'server-end' };
  const result = await invokeApi({
    method: 'PATCH', url: '/api/drafts/draft-1/feedback', draft: current,
    body: { version: 8, reflection: { classResponse: '学生能找到关键意象', nextStep: '继续说明意象关系' } }
  });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.classroomRun.status, 'confirmed');
  assert.ok(saved.answer.classroomRun.confirmedAt);
  assert.equal(saved.answer.classroomRun.endedAt, 'server-end');
  assert.equal(saved.answer.lessonReflection.observedLearning, '学生能找到关键意象');
});

test('saving reflection confirms each classroom moment destination on the server', async () => {
  const current = apiDraft();
  current.answer.classroomRun = { status: 'pending_review', moments: [
    { id: 'm1', type: 'confusion', stage: 3, text: '学生还不能说明意象关系', elapsedMinutes: 18 },
    { id: 'm2', type: 'timing', stage: 4, text: '讨论多用五分钟', elapsedMinutes: 31 }
  ] };
  const triage = defaultClassroomMomentTriage(current.answer.classroomRun);
  triage.items[0].resolution = 'carryover';
  triage.items[0].carryoverText = '下一课先画意象关系图再归纳';
  triage.items[1].resolution = 'dismissed';
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/feedback', draft: current, body: { version: 8, reflection: { classResponse: '已完成课堂观察' }, momentTriage: triage } });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.classroomMomentTriage.status, 'confirmed');
  assert.equal(saved.answer.classroomMomentTriage.items[0].resolution, 'carryover');
  assert.equal(saved.answer.classroomMomentTriage.items[0].carryoverText, '下一课先画意象关系图再归纳');
  assert.equal(saved.answer.classroomRun.status, 'confirmed');
});

test('classroom run endpoint rejects a stale version without losing the client retry opportunity', async () => {
  const result = await invokeApi({
    method: 'PATCH', url: '/api/drafts/draft-1/classroom-run',
    body: { version: 7, status: 'in_progress', currentStage: 2, stages: [{ stage: 2, outcome: 'reached' }] }
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.payload.error, 'edit_conflict');
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('a confirmed classroom record is immutable and classroom saves do not add plan revisions', async () => {
  const inProgress = apiDraft();
  inProgress.answer.revisions = [{ id: 'plan-revision-1', snapshot: true }];
  const savedResult = await invokeApi({
    method: 'PATCH', url: '/api/drafts/draft-1/classroom-run', draft: inProgress,
    body: { version: 8, status: 'in_progress', currentStage: 2, stages: [{ stage: 2, outcome: 'reached' }] }
  });
  const saved = JSON.parse(savedResult.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.deepEqual(saved.answer.revisions, inProgress.answer.revisions);

  const confirmed = apiDraft();
  confirmed.answer.classroomRun = { status: 'confirmed', currentStage: 5, keywords: [{ id: 'k1', stage: 5, text: '教师确认内容' }], endedAt: 'server-end', confirmedAt: 'server-confirmed' };
  const blocked = await invokeApi({
    method: 'PATCH', url: '/api/drafts/draft-1/classroom-run', draft: confirmed,
    body: { version: 8, currentStage: 1, keywords: [] }
  });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.payload.error, 'classroom_run_confirmed');
  assert.equal(blocked.calls.some(call => call.options.method === 'PATCH'), false);
});

test('rehearsal generation uses confirmed server cards and rejects forged citation identity', async () => {
  const current = apiDraft();
  current.answer.planApproval = { status: 'confirmed', hasUnconfirmedChanges: false };
  current.cards = [{ id: 'question-1', type: 'question', status: 'locked', items: [{ id: 'q1', text: '主问：为什么先写阴再写晴？｜追问：人物活动有什么不同？｜预期学生回应：比较景物与情感', citationIds: ['E1', 'forged'] }] }];
  const result = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/rehearsal/generate', draft: current, body: { version: 8, citationIds: ['forged'], userId: 'another-user' } });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.questionRehearsal.steps[0].question, '为什么先写阴再写晴？');
  assert.deepEqual(saved.answer.questionRehearsal.steps[0].citationIds, ['E1']);
  assert.equal(JSON.stringify(saved.answer.questionRehearsal).includes('another-user'), false);
  assert.deepEqual(saved.answer.revisions, current.answer.revisions);
});

test('rehearsal save preserves server question and citations and requires current version', async () => {
  const current = apiDraft();
  current.answer.questionRehearsal = {
    status: 'draft', currentStep: 0, sourceDraftVersion: 8,
    steps: [{ id: 'q1', question: '真实问题', expectedAction: '回到原文', estimatedMinutes: 4, citationIds: ['E1'], branches: { reached: '收束', partial: '追问', silent: '拆小' } }]
  };
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/rehearsal', draft: current, body: { version: 8, rehearsal: { currentStep: 0, steps: [{ id: 'q1', question: '伪造问题', citationIds: ['evil'], selectedOutcome: 'partial', teacherNote: '先静读' }] }, confirm: true } });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.questionRehearsal.status, 'confirmed');
  assert.equal(saved.answer.questionRehearsal.steps[0].question, '真实问题');
  assert.deepEqual(saved.answer.questionRehearsal.steps[0].citationIds, ['E1']);
  assert.equal(saved.answer.questionRehearsal.steps[0].selectedOutcome, 'partial');

  const stale = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/rehearsal', draft: current, body: { version: 7, rehearsal: current.answer.questionRehearsal } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.payload.error, 'edit_conflict');
});

test('a changed question archives a confirmed rehearsal before creating a fresh one', async () => {
  const current = apiDraft();
  current.answer.planApproval = { status: 'confirmed', hasUnconfirmedChanges: false };
  current.answer.questionRehearsal = { status: 'confirmed', sourceKey: 'qv1-old', confirmedAt: 'teacher-confirmed', steps: [{ id: 'old', question: '旧问题', selectedOutcome: 'reached' }] };
  current.cards = [{ id: 'question-1', type: 'question', items: [{ id: 'q-new', text: '主问：新问题怎样回到原文？｜追问：依据是什么？｜预期学生回应：指出关键词', citationIds: ['E1'] }] }];
  const result = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/rehearsal/generate', draft: current, body: { version: 8 } });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.questionRehearsal.status, 'draft');
  assert.equal(saved.answer.questionRehearsalHistory[0].confirmedAt, 'teacher-confirmed');
  const writeUrl = new URL(result.calls.find(call => call.options.method === 'PATCH').url);
  assert.equal(writeUrl.searchParams.get('user_id'), 'eq.teacher-1');
  assert.equal(writeUrl.searchParams.get('id'), 'eq.draft-1');
  assert.equal(writeUrl.searchParams.get('version'), 'eq.8');
});

test('pre-class pulse generation and save keep questions and citations server-owned', async () => {
  const current = apiDraft();
  current.answer.planApproval = { status: 'confirmed', hasUnconfirmedChanges: false };
  current.cards = [{ id: 'question-1', type: 'question', items: [{ id: 'q1', text: '“衔远山，吞长江”怎样写出洞庭湖气象？', citationIds: ['E1'] }] }];
  const generated = await invokeApi({
    method: 'POST', url: '/api/drafts/draft-1/preclass-pulse/generate', draft: current,
    body: { version: 8, prompts: [{ prompt: '客户端伪造', citationIds: ['evil'] }], userId: 'forged' }
  });
  assert.equal(generated.statusCode, 200);
  const generatedWrite = JSON.parse(generated.calls.find(call => call.options.method === 'PATCH').options.body);
  const pulse = generatedWrite.answer.preClassPulse;
  assert.equal(pulse.prompts[0].prompt, '“衔远山，吞长江”怎样写出洞庭湖气象？');
  assert.deepEqual(pulse.prompts[0].citationIds, ['E1']);
  assert.equal(JSON.stringify(pulse).includes('forged'), false);

  const afterGenerate = { ...current, version: 9, answer: { ...current.answer, preClassPulse: pulse } };
  const submitted = structuredClone(pulse);
  submitted.prompts = [{ id: 'evil', prompt: '伪造问题', citationIds: ['evil'] }];
  Object.assign(submitted, {
    presentCount: 42, respondedCount: 40, secureCount: 12, partialCount: 18, notYetCount: 10,
    observedPattern: '能说出结论，但还没有落到具体动词。', teacherDecision: 'adopt',
    recommendation: { title: '伪造建议', citationIds: ['evil'] }
  });
  const savedResult = await invokeApi({
    method: 'PATCH', url: '/api/drafts/draft-1/preclass-pulse', draft: afterGenerate,
    body: { version: 9, preClassPulse: submitted, confirm: true }
  });
  assert.equal(savedResult.statusCode, 200);
  const saved = JSON.parse(savedResult.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.preClassPulse.status, 'confirmed');
  assert.equal(saved.answer.preClassPulse.prompts[0].prompt, pulse.prompts[0].prompt);
  assert.deepEqual(saved.answer.preClassPulse.prompts[0].citationIds, ['E1']);
  assert.equal(saved.answer.preClassPulse.recommendation.level, 'scaffold');
  assert.equal(saved.answer.planApproval.status, 'confirmed');
  assert.deepEqual(saved.answer.revisions, current.answer.revisions);
});

test('pre-class pulse rejects invalid class aggregates before writing', async () => {
  const current = apiDraft();
  current.cards = [{ id: 'question-1', type: 'question', items: [{ id: 'q1', text: '真实问题', citationIds: ['E1'] }] }];
  current.answer.preClassPulse = buildPreClassPulse(current);
  const submitted = structuredClone(current.answer.preClassPulse);
  Object.assign(submitted, { presentCount: 42, respondedCount: 40, secureCount: 10, partialCount: 10, notYetCount: 10 });
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/preclass-pulse', draft: current, body: { version: 8, preClassPulse: submitted } });
  assert.equal(result.statusCode, 422);
  assert.equal(result.payload.error, 'preclass_pulse_counts_invalid');
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('learning evidence binds aggregate results to server questions and ignores forged identities', async () => {
  const current = apiDraft();
  current.cards = [{ id: 'question-1', type: 'question', items: [{ id: 'q1', text: '为什么先写阴再写晴？', citationIds: ['E1'] }] }];
  const generated = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/learning-evidence/generate', draft: current, body: { version: 8, userId: 'forged' } });
  assert.equal(generated.statusCode, 200);
  const generatedWrite = JSON.parse(generated.calls.find(call => call.options.method === 'PATCH').options.body);
  const evidence = generatedWrite.answer.learningEvidence;
  assert.equal(evidence.entries[0].prompt, '为什么先写阴再写晴？');
  assert.equal(JSON.stringify(evidence).includes('forged'), false);

  const afterGenerate = { ...current, version: 9, answer: { ...current.answer, learningEvidence: evidence } };
  const submitted = structuredClone(evidence);
  Object.assign(submitted.entries[0], {
    prompt: '客户端伪造问题', citationIds: ['evil'], assignedCount: 42, submittedCount: 40,
    secureCount: 12, partialCount: 21, notYetCount: 7,
    observedPattern: '能找出景物，但没有说明情感关系', teacherAction: '先比较，再归纳'
  });
  const savedResult = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/learning-evidence', draft: afterGenerate, body: { version: 9, learningEvidence: submitted, confirm: true } });
  assert.equal(savedResult.statusCode, 200);
  const saved = JSON.parse(savedResult.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.learningEvidence.status, 'confirmed');
  assert.equal(saved.answer.learningEvidence.entries[0].prompt, '为什么先写阴再写晴？');
  assert.deepEqual(saved.answer.learningEvidence.entries[0].citationIds, ['E1']);
  assert.equal(saved.answer.learningEvidence.entries[0].partialCount, 21);
  const writeUrl = new URL(savedResult.calls.find(call => call.options.method === 'PATCH').url);
  assert.equal(writeUrl.searchParams.get('user_id'), 'eq.teacher-1');
  assert.equal(writeUrl.searchParams.get('version'), 'eq.9');
});

test('learning evidence rejects inconsistent aggregate counts before writing', async () => {
  const current = apiDraft();
  current.cards = [{ id: 'question-1', type: 'question', items: [{ id: 'q1', text: '真实问题', citationIds: ['E1'] }] }];
  current.answer.learningEvidence = buildLearningEvidence(current);
  const submitted = structuredClone(current.answer.learningEvidence);
  Object.assign(submitted.entries[0], { assignedCount: 42, submittedCount: 40, secureCount: 10, partialCount: 10, notYetCount: 10 });
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/learning-evidence', draft: current, body: { version: 8, learningEvidence: submitted } });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error, 'learning_evidence_counts_invalid');
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('unit relay creates the verified next lesson without carrying old citations or cards', async () => {
  const current = apiDraft();
  current.title = '《我爱这土地》';
  current.lesson_context = {
    classLevel: '普通', teachingMode: '探究',
    unitRef: { key: 'textbook:textbook-u1', documentId: 'textbook', nodeId: 'textbook-u1', title: '第一单元 · 活动探究' },
    lessonRef: { documentId: 'textbook', nodeId: 'textbook-u1-n4', title: '我爱这土地', pageRange: [14, 14] }
  };
  current.answer.lessonReflection = { observedLearning: '学生能找出意象', unresolvedLearning: '还不能说明意象关系', pacingNotes: '', cardUsage: ['提问卡'], nextLessonAdjustment: '先做意象比较' };
  const result = await invokeApi({
    method: 'POST', url: '/api/drafts/draft-1/continue-next', draft: current,
    body: { sourceVersion: 8, nextNodeId: 'textbook-u1-n5', operationId: 'relay-op-1', pdfPage: 999, userId: 'forged' },
    createdRow: { id: 'draft-next', version: 1 }
  });
  assert.equal(result.statusCode, 201);
  const create = result.calls.find(call => call.options.method === 'POST' && call.url.includes('/rest/v1/lesson_drafts'));
  const saved = JSON.parse(create.options.body);
  assert.equal(saved.user_id, 'teacher-1');
  assert.equal(saved.title, '《乡愁》');
  assert.equal(saved.lesson_context.lessonRef.nodeId, 'textbook-u1-n5');
  assert.deepEqual(saved.lesson_context.lessonRef.pageRange, [15, 15]);
  assert.equal(saved.lesson_context.unitRef.nodeId, 'textbook-u1');
  assert.deepEqual(saved.citations, []);
  assert.deepEqual(saved.cards, []);
  assert.equal(saved.answer.previousLessonReflection.feedback.unresolvedLearning, '还不能说明意象关系');
  assert.equal(saved.answer.unitContinuity.operationId, 'relay-op-1');
  assert.equal(JSON.stringify(saved).includes('999'), false);
});

test('unit relay copies only teacher-confirmed classroom carryover and the next lesson can complete it', async () => {
  const current = apiDraft();
  current.title = '《我爱这土地》';
  current.lesson_context = { unitRef: { documentId: 'textbook', nodeId: 'textbook-u1' }, lessonRef: { nodeId: 'textbook-u1-n4' } };
  current.answer.lessonReflection = { observedLearning: '已记录课堂事实' };
  current.answer.classroomRun = { status: 'confirmed', moments: [
    { id: 'm1', type: 'confusion', stage: 3, text: '关系没有说清', elapsedMinutes: 22 },
    { id: 'm2', type: 'breakthrough', stage: 4, text: '学生说出了象征意义', elapsedMinutes: 31 }
  ] };
  const base = defaultClassroomMomentTriage(current.answer.classroomRun);
  base.items[0].resolution = 'carryover'; base.items[0].carryoverText = '先画意象关系图，再进入情感归纳';
  current.answer.classroomMomentTriage = mergeClassroomMomentTriage(base, base, current.answer.classroomRun, { confirm: true, now: '2026-08-27T08:00:00Z' });
  const relayed = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/continue-next', draft: current, body: { sourceVersion: 8, nextNodeId: 'textbook-u1-n5', operationId: 'relay-carryover' }, createdRow: { id: 'draft-next', version: 1 } });
  assert.equal(relayed.statusCode, 201);
  const created = JSON.parse(relayed.calls.find(call => call.options.method === 'POST' && call.url.includes('/rest/v1/lesson_drafts')).options.body);
  assert.equal(created.answer.previousLessonCarryover.items.length, 1);
  assert.equal(created.answer.previousLessonCarryover.items[0].text, '先画意象关系图，再进入情感归纳');
  assert.equal(created.answer.previousLessonCarryover.items[0].status, 'todo');
  const next = { ...apiDraft(), id: 'draft-next', version: 1, answer: created.answer };
  const completed = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-next/carryover/m1', draft: next, body: { version: 1, status: 'done' } });
  assert.equal(completed.statusCode, 200);
  const saved = JSON.parse(completed.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.previousLessonCarryover.status, 'completed');
  assert.equal(saved.answer.previousLessonCarryover.items[0].status, 'done');
  assert.equal(saved.answer.previousLessonCarryover.items[0].text, '先画意象关系图，再进入情感归纳');
});

test('unit relay is idempotent for the same source and operation id', async () => {
  const current = apiDraft();
  current.lesson_context = { unitRef: { documentId: 'textbook', nodeId: 'textbook-u1' }, lessonRef: { nodeId: 'textbook-u1-n4' } };
  current.answer.lessonReflection = { observedLearning: '已记录课堂事实' };
  const existing = { id: 'draft-next', answer: { unitContinuity: { operationId: 'relay-op-1', sourceDraftId: 'draft-1' } } };
  const result = await invokeApi({
    method: 'POST', url: '/api/drafts/draft-1/continue-next', draft: current, listRows: [current, existing],
    body: { sourceVersion: 8, nextNodeId: 'textbook-u1-n5', operationId: 'relay-op-1' }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.draft.id, 'draft-next');
  assert.equal(result.calls.some(call => call.options.method === 'POST' && call.url.includes('/rest/v1/lesson_drafts')), false);
});

test('unit relay can use confirmed aggregate learning evidence without copying old material citations', async () => {
  const current = apiDraft();
  current.title = '《我爱这土地》';
  current.lesson_context = { unitRef: { documentId: 'textbook', nodeId: 'textbook-u1' }, lessonRef: { nodeId: 'textbook-u1-n4' } };
  current.answer.learningEvidence = {
    status: 'confirmed', entries: [{ id: 'L1', questionId: 'q1', prompt: '说明意象关系', assignedCount: 42, submittedCount: 40, secureCount: 12, partialCount: 21, notYetCount: 7, observedPattern: '关系没有说清', teacherAction: '先比较再归纳' }]
  };
  current.cards = [{ id: 'question-1', type: 'question', items: [{ id: 'q1', text: '说明意象关系', citationIds: [] }] }];
  current.answer.learningEvidence.sourceKey = learningEvidenceSourceKey(current);
  const result = await invokeApi({
    method: 'POST', url: '/api/drafts/draft-1/continue-next', draft: current,
    body: { sourceVersion: 8, nextNodeId: 'textbook-u1-n5', operationId: 'relay-learning-only' },
    createdRow: { id: 'draft-learning-next', version: 1 }
  });
  assert.equal(result.statusCode, 201);
  const create = result.calls.find(call => call.options.method === 'POST' && call.url.includes('/rest/v1/lesson_drafts'));
  const saved = JSON.parse(create.options.body);
  assert.equal(saved.answer.previousLessonReflection, undefined);
  assert.equal(saved.answer.previousLessonLearningEvidence.summary.submittedCount, 40);
  assert.deepEqual(saved.citations, []);
  assert.deepEqual(saved.cards, []);
});

test('unit relay can use a confirmed anonymous homework review without student answers', async () => {
  const current = markingDraft();
  current.title = '《我爱这土地》';
  current.lesson_context = { unitRef: { documentId: 'textbook', nodeId: 'textbook-u1' }, lessonRef: { nodeId: 'textbook-u1-n4' } };
  const task = current.answer.layeredHomework.tasks[0];
  const base = buildHomeworkReview({ pack: current.answer.layeredHomework, task, results: [{ status: 'partial', score: 2 }], patterns: ['能够定位原文，但关系解释不足'], nextActions: ['先用关系图复盘'] });
  current.answer.homeworkReview = mergeHomeworkReview(base, { selectedActionIds: ['action-1'], teacherNote: '下一课先补关系。' }, { confirm: true });
  const result = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/continue-next', draft: current, body: { sourceVersion: 8, nextNodeId: 'textbook-u1-n5', operationId: 'relay-homework-review' }, createdRow: { id: 'draft-review-next', version: 1 } });
  assert.equal(result.statusCode, 201);
  const create = result.calls.find(call => call.options.method === 'POST' && call.url.includes('/rest/v1/lesson_drafts'));
  const saved = JSON.parse(create.options.body);
  assert.equal(saved.answer.previousLessonHomeworkReview.summary.responseCount, 1);
  assert.deepEqual(saved.answer.previousLessonHomeworkReview.summary.nextActions, ['先用关系图复盘']);
  assert.equal(JSON.stringify(saved).includes('学生答案原文'), false);
  assert.deepEqual(saved.citations, []);
});

test('unit relay rejects confirmed learning evidence after its source questions changed', async () => {
  const current = apiDraft();
  current.lesson_context = { unitRef: { documentId: 'textbook', nodeId: 'textbook-u1' }, lessonRef: { nodeId: 'textbook-u1-n4' } };
  current.cards = [{ id: 'question-1', type: 'question', items: [{ id: 'q1', text: '最新问题', citationIds: [] }] }];
  current.answer.learningEvidence = { status: 'confirmed', sourceKey: 'v1-old', entries: [{ id: 'L1', questionId: 'q1', prompt: '旧问题', assignedCount: 40, submittedCount: 40, secureCount: 20, partialCount: 20, notYetCount: 0 }] };
  const result = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/continue-next', draft: current, body: { sourceVersion: 8, nextNodeId: 'textbook-u1-n5', operationId: 'stale-learning' } });
  assert.equal(result.statusCode, 409);
  assert.equal(result.payload.error, 'learning_evidence_stale');
});

test('switching lesson clears unlocked cards, citations and derived classroom records', async () => {
  const current = apiDraft();
  current.lesson_context = { lessonRef: { documentId: 'textbook', nodeId: 'textbook-u3-n1', title: '岳阳楼记' } };
  current.cards = [{ id: 'question-1', type: 'question', status: 'draft', items: [{ id: 'q1', text: '旧问题' }] }];
  current.answer.questionRehearsal = { status: 'draft', steps: [{ id: 'q1', question: '旧问题' }] };
  current.answer.learningEvidence = { status: 'draft', entries: [{ id: 'L1', prompt: '旧问题' }] };
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1', draft: current, body: { version: 8, lesson_context: { lessonRef: { documentId: 'textbook', nodeId: 'textbook-u1-n4', title: '我爱这土地' } }, citations: current.citations, cards: current.cards, answer: current.answer } });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.deepEqual(saved.citations, []);
  assert.deepEqual(saved.cards, []);
  assert.equal(saved.answer.questionRehearsal, undefined);
  assert.equal(saved.answer.learningEvidence, undefined);
});

test('bundled textbook citations outside the current lesson range are rejected', async () => {
  const current = apiDraft();
  current.lesson_context = { lessonRef: { documentId: 'textbook', nodeId: 'textbook-u3-n1', title: '岳阳楼记' } };
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1', draft: current, body: { version: 8, citations: [{ id: 'E2', documentId: 'textbook', pdfPage: 14, quote: '其他篇目' }] } });
  assert.equal(result.statusCode, 422);
  assert.equal(result.payload.error, 'citation_outside_lesson');
});

test('unit relay uses a deterministic draft id to close concurrent retry races', () => {
  const first = relayDraftId('teacher-1', 'draft-1', 'relay-op-1');
  assert.equal(first, relayDraftId('teacher-1', 'draft-1', 'relay-op-1'));
  assert.notEqual(first, relayDraftId('teacher-1', 'draft-1', 'relay-op-2'));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/u);
});

test('unit relay returns the winning draft after a concurrent insert conflict', async () => {
  const current = apiDraft();
  current.lesson_context = { unitRef: { documentId: 'textbook', nodeId: 'textbook-u1' }, lessonRef: { nodeId: 'textbook-u1-n4' } };
  current.answer.lessonReflection = { observedLearning: '已记录课堂事实' };
  const operationId = 'relay-race';
  const createdRow = {
    id: relayDraftId('teacher-1', 'draft-1', operationId),
    answer: { unitContinuity: { operationId, sourceDraftId: 'draft-1' } }
  };
  const result = await invokeApi({
    method: 'POST', url: '/api/drafts/draft-1/continue-next', draft: current,
    body: { sourceVersion: 8, nextNodeId: 'textbook-u1-n5', operationId },
    createdRow, createStatus: 409
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.reused, true);
  assert.equal(result.payload.draft.id, createdRow.id);
});

test('unit relay rejects skipping a lesson before creating a draft', async () => {
  const current = apiDraft();
  current.lesson_context = { unitRef: { documentId: 'textbook', nodeId: 'textbook-u1' }, lessonRef: { nodeId: 'textbook-u1-n4' } };
  current.answer.lessonReflection = { observedLearning: '已记录课堂事实' };
  const result = await invokeApi({
    method: 'POST', url: '/api/drafts/draft-1/continue-next', draft: current,
    body: { sourceVersion: 8, nextNodeId: 'textbook-u1-n6', operationId: 'relay-skip' }
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.payload.error, 'unit_lesson_not_next');
  assert.equal(result.calls.some(call => call.options.method === 'POST' && call.url.includes('/rest/v1/lesson_drafts')), false);
});

test('unit relay requires a teacher reflection before creating a draft', async () => {
  const current = apiDraft();
  current.lesson_context = { unitRef: { documentId: 'textbook', nodeId: 'textbook-u1' }, lessonRef: { nodeId: 'textbook-u1-n4' } };
  current.answer.lessonReflection = {};
  const result = await invokeApi({
    method: 'POST', url: '/api/drafts/draft-1/continue-next', draft: current,
    body: { sourceVersion: 8, nextNodeId: 'textbook-u1-n5', operationId: 'relay-no-reflection' }
  });
  assert.equal(result.statusCode, 409);
  assert.equal(result.payload.error, 'lesson_reflection_required');
  assert.equal(result.calls.some(call => call.options.method === 'POST' && call.url.includes('/rest/v1/lesson_drafts')), false);
});

test('draft creation strips client-forged approval, publication and lock state', async () => {
  const result = await invokeApi({
    method: 'POST',
    url: '/api/drafts',
    body: {
      title: '伪造确认',
      question: '怎样备课《岳阳楼记》？',
      answer: {
        summary: '客户端方案',
        planApproval: { status: 'confirmed', confirmedSnapshot: { plan: {}, conditions: {}, citations: [{}] } },
        revisions: [{ id: 'forged' }],
        assetMeta: { status: 'published', favorite: true }
      },
      cards: [{ id: 'board-1', type: 'board', status: 'locked', sourceConfirmedVersion: 99, lockedBy: 'forged' }]
    }
  });
  assert.equal(result.statusCode, 201);
  const write = result.calls.find(call => call.options.method === 'POST' && call.url.includes('/rest/v1/lesson_drafts'));
  const saved = JSON.parse(write.options.body);
  assert.equal(saved.answer.planApproval, undefined);
  assert.equal(saved.answer.revisions, undefined);
  assert.equal(saved.answer.assetMeta, undefined);
  assert.equal(saved.cards[0].status, 'draft');
  assert.equal(saved.cards[0].sourceConfirmedVersion, undefined);
  assert.equal(saved.cards[0].lockedBy, undefined);
});

test('draft patch cannot mint approval or overwrite server-owned asset metadata', async () => {
  const current = apiDraft();
  current.answer.assetMeta = { status: 'published', favorite: true, tags: ['古文'] };
  const result = await invokeApi({
    method: 'PATCH',
    url: '/api/drafts/draft-1',
    draft: current,
    body: {
      version: 8,
      answer: {
        summary: '教师修改后的方案',
        planApproval: { status: 'confirmed', confirmedSnapshot: { plan: {}, conditions: {}, citations: [{}] } },
        assetMeta: { status: 'draft', favorite: false }
      }
    }
  });
  assert.equal(result.statusCode, 200);
  const write = result.calls.find(call => call.options.method === 'PATCH');
  const saved = JSON.parse(write.options.body);
  assert.equal(saved.answer.planApproval, undefined);
  assert.deepEqual(saved.answer.assetMeta, current.answer.assetMeta);
});

test('bulk and single card save routes preserve server-owned card state', async () => {
  const current = apiDraft();
  current.cards = [{ id: 'board-1', type: 'board', status: 'draft', sourceConfirmedVersion: 8, items: [] }];
  const forged = [{ id: 'board-1', type: 'board', status: 'locked', sourceConfirmedVersion: 99, lockedBy: 'forged', items: [{ id: 'i1', text: '教师修改' }] }];
  const bulk = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/cards', draft: current, body: { version: 8, cards: forged } });
  assert.equal(bulk.statusCode, 200);
  const bulkSaved = JSON.parse(bulk.calls.find(call => call.options.method === 'PATCH').options.body).cards[0];
  assert.equal(bulkSaved.status, 'draft');
  assert.equal(bulkSaved.sourceConfirmedVersion, 8);
  assert.equal(bulkSaved.lockedBy, undefined);

  const single = await invokeApi({
    method: 'PATCH',
    url: '/api/drafts/draft-1/cards/board-1',
    draft: current,
    body: { version: 8, status: 'locked', sourceConfirmedVersion: 99, lockedBy: 'forged', title: '教师修改' }
  });
  assert.equal(single.statusCode, 200);
  const singleSaved = JSON.parse(single.calls.find(call => call.options.method === 'PATCH').options.body).cards[0];
  assert.equal(singleSaved.status, 'draft');
  assert.equal(singleSaved.sourceConfirmedVersion, 8);
  assert.equal(singleSaved.lockedBy, undefined);
  assert.equal(singleSaved.title, '教师修改');
});

test('group card generation requires an explicit client version before model work or writes', async () => {
  const result = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/cards/generate', body: {} });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error, 'version_required');
  assert.equal(result.calls.filter(call => call.url.includes('/rest/v1/lesson_drafts')).length, 1);
});

test('teaching choices are generated from server citations and CAS-saved', async () => {
  const modelResponse = { decisions: [
    { question: '第一课时收在哪里？', whyItMatters: '影响第二课时起点', recommendedOption: 'A', options: [
      { id: 'A', label: '收在写景', approach: '完成阴晴两景比较', tradeoff: '价值讨论后置', evidenceRefs: ['E1', 'forged'] },
      { id: 'B', label: '推进景情', approach: '完成景情关系', tradeoff: '朗读时间更紧', evidenceRefs: ['E1'] }
    ] },
    { question: '朗读怎样进入分析？', whyItMatters: '影响文本体验', recommendedOption: 'B', options: [
      { id: 'A', label: '先读后析', approach: '先形成整体感受', tradeoff: '细读起步较慢', evidenceRefs: ['E1'] },
      { id: 'B', label: '随析随读', approach: '分析后立即朗读验证', tradeoff: '整体感受较碎', evidenceRefs: ['E1'] }
    ] }
  ] };
  const result = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/deliberation/generate', body: { version: 8, userId: 'attacker' }, modelResponse });
  assert.equal(result.statusCode, 200);
  const write = result.calls.find(call => call.options.method === 'PATCH');
  assert.equal(new URL(write.url).searchParams.get('user_id'), 'eq.teacher-1');
  assert.equal(new URL(write.url).searchParams.get('version'), 'eq.8');
  const saved = JSON.parse(write.options.body);
  assert.equal(saved.answer.teachingDeliberation.sourceDraftVersion, 8);
  assert.deepEqual(saved.answer.teachingDeliberation.decisions[0].options[0].evidenceRefs, ['E1']);
  assert.equal(JSON.stringify(saved).includes('forged'), false);
});

test('teacher confirmation accepts only selected option ids and invalidates an older plan approval', async () => {
  const current = deliberationDraft();
  current.answer.planApproval = { status: 'confirmed', hasUnconfirmedChanges: false, confirmedSnapshot: { plan: { summary: '旧定稿' }, conditions: {}, citations: current.citations } };
  const submitted = structuredClone(current.answer.teachingDeliberation);
  submitted.decisions[0].question = '客户端伪造问题';
  submitted.decisions[0].options[0].approach = '客户端伪造路径';
  submitted.decisions[0].selectedOptionId = 'option-B';
  submitted.decisions[1].selectedOptionId = 'option-A';
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/deliberation', draft: current, body: { version: 8, deliberation: submitted, confirm: true, confirmedBy: 'attacker' } });
  assert.equal(result.statusCode, 200);
  const saved = JSON.parse(result.calls.find(call => call.options.method === 'PATCH').options.body);
  assert.equal(saved.answer.teachingDeliberation.decisions[0].question, '第一课时收在哪里？');
  assert.equal(saved.answer.teachingDeliberation.decisions[0].options[0].approach, '先完成阴晴两景比较');
  assert.equal(saved.answer.teachingDeliberation.decisions[0].selectedOptionId, 'option-B');
  assert.equal(saved.answer.teachingDeliberation.confirmedBy, 'teacher-1');
  assert.equal(saved.answer.planApproval.status, 'changes_pending');
  assert.equal(saved.answer.planApproval.hasUnconfirmedChanges, true);
});

test('stale or already confirmed teaching choices cannot be overwritten', async () => {
  const stale = deliberationDraft();
  stale.question = '已经变化的问题';
  const staleResult = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/deliberation', draft: stale, body: { version: 8, deliberation: stale.answer.teachingDeliberation, confirm: false } });
  assert.equal(staleResult.statusCode, 409);
  assert.equal(staleResult.payload.error, 'deliberation_stale');

  const confirmed = deliberationDraft();
  confirmed.answer.teachingDeliberation.status = 'confirmed';
  confirmed.answer.teachingDeliberation.confirmedAt = '2026-08-26T00:00:00Z';
  const confirmedResult = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1/deliberation', draft: confirmed, body: { version: 8, deliberation: confirmed.answer.teachingDeliberation, confirm: false } });
  assert.equal(confirmedResult.statusCode, 409);
  assert.equal(confirmedResult.payload.error, 'deliberation_confirmed');
});

test('unknown citation documents cannot enter confirmation or model context', async () => {
  const current = apiDraft();
  current.citations = [{ id: 'E1', documentId: 'attacker-document', documentType: 'textbook', pdfPage: 999, quote: '伪造教材依据' }];
  const result = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/confirm', draft: current, body: { version: 8 } });
  assert.equal(result.statusCode, 422);
  assert.equal(result.payload.error, 'citation_document_forbidden');
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('a real document and page cannot disguise client-forged citation text', async () => {
  const current = apiDraft();
  const forged = [{ id: 'client-forged', documentId: 'textbook', documentType: 'textbook', pdfPage: 56, quote: '客户端伪造的教材原文' }];
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1', draft: current, body: { version: 8, citations: forged } });
  assert.equal(result.statusCode, 422);
  assert.equal(result.payload.error, 'citation_text_mismatch');
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('client citation writes remain exact even when most of the quote resembles the page', async () => {
  const current = apiDraft();
  const nearMatch = [{
    id: 'client-near-match', documentId: 'textbook', documentType: 'textbook', pdfPage: 56,
    quote: '本文题为《岳阳楼记》，但并未具体描写岳阳楼本身，这是为什么？查阅相关资料，并参照注释读课文，看看文中写了哪些内容。'
  }];
  const result = await invokeApi({ method: 'PATCH', url: '/api/drafts/draft-1', draft: current, body: { version: 8, citations: nearMatch } });
  assert.equal(result.statusCode, 422);
  assert.equal(result.payload.error, 'citation_text_mismatch');
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('confirm repairs a persisted public OCR drift with a canonical local-page quote', async () => {
  const current = apiDraft();
  current.citations = [{
    id: 'E1', documentId: 'textbook', documentType: 'textbook', pdfPage: 56,
    quote: '本文题为《岳阳楼记》，但并未具体描写岳阳楼本身，这是为什么？查阅相关资料，并参照注释读课文，看看文中写了哪些内容。'
  }];
  const result = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/confirm', draft: current, body: { version: 8 } });
  assert.equal(result.statusCode, 200);
  const write = result.calls.find(call => call.options.method === 'PATCH');
  const saved = JSON.parse(write.options.body);
  assert.match(saved.citations[0].quote, /这是为什么呢/u);
  assert.equal(saved.citations[0].text, saved.citations[0].quote);
  assert.equal(saved.answer.planApproval.confirmedSnapshot.citations[0].quote, saved.citations[0].quote);
});

test('confirm rejects an unrelated persisted public quote without writing', async () => {
  const current = apiDraft();
  current.citations = [{
    id: 'E1', documentId: 'textbook', documentType: 'textbook', pdfPage: 56,
    quote: '这是一段与岳阳楼记物理页完全无关的历史草稿摘录，不能被系统自动修复。'
  }];
  const result = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/confirm', draft: current, body: { version: 8 } });
  assert.equal(result.statusCode, 422);
  assert.equal(result.payload.error, 'citation_text_mismatch');
  assert.equal(result.calls.some(call => call.options.method === 'PATCH'), false);
});

test('confirm validates and CAS-saves a sanitized current snapshot', async () => {
  const result = await invokeApi({ method: 'POST', url: '/api/drafts/draft-1/confirm', body: { version: 8 } });
  assert.equal(result.statusCode, 200);
  const write = result.calls.find(call => call.options.method === 'PATCH');
  assert.ok(write);
  assert.equal(new URL(write.url).searchParams.get('version'), 'eq.8');
  const saved = JSON.parse(write.options.body);
  assert.equal(saved.version, 9);
  assert.equal(saved.answer.planApproval.confirmedVersion, 8);
  assert.equal(saved.answer.planApproval.confirmedBy, 'teacher-1');
  assert.equal(saved.answer.planApproval.confirmedSnapshot.plan.summary, '由写景进入价值判断。');
  assert.equal(saved.answer.revisions[0].version, 8);
});

test('DELETE reports a CAS conflict when the datastore deletes zero rows', async () => {
  const result = await invokeApi({ method: 'DELETE', url: '/api/drafts/draft-1?version=8', deleteRows: [] });
  assert.equal(result.statusCode, 409);
  assert.equal(result.payload.error, 'edit_conflict');
  const write = result.calls.find(call => call.options.method === 'DELETE');
  assert.equal(write.options.headers.Prefer, 'return=representation');
});
