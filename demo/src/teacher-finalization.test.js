import { appSource } from './test-app-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPlanForm,
  cardsForAskDraft,
  deriveTeacherDraftState,
  draftRecoveryKey,
  planFormFromDraft,
  readDraftRecovery,
  writeDraftRecovery
} from './teacher-finalization.js';
import { errorCopy } from './copy.js';

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

test('draft recovery cache is unavailable without a known account and isolated by user id', () => {
  const store = storage();
  const draft = { id: 'draft-1', title: 'A 的方案' };
  assert.equal(draftRecoveryKey('', 'draft-1'), '');
  assert.equal(writeDraftRecovery(store, '', 'draft-1', draft), false);
  assert.equal(writeDraftRecovery(store, 'user-a', 'draft-1', draft, [], new Date('2026-08-26T00:00:00Z')), true);
  assert.equal(readDraftRecovery(store, 'user-b', 'draft-1'), null);
  assert.equal(readDraftRecovery(store, '', 'draft-1'), null);
  assert.equal(readDraftRecovery(store, 'user-a', 'draft-1').draft.title, 'A 的方案');
});

test('new ask drafts do not promote browser model suggestions to final cards while legacy cards survive', () => {
  const suggestions = [{ type: 'board', items: [{ text: '模型建议' }] }];
  assert.deepEqual(cardsForAskDraft(null, suggestions), []);
  const legacy = [{ id: 'old-board', type: 'board', status: 'draft', content: ['旧板书'] }];
  assert.equal(cardsForAskDraft({ cards: legacy }, suggestions), legacy);
});

test('editable plan form keeps unrelated answer fields and normalizes teacher inputs', () => {
  const draft = { title: '旧标题', answer: { summary: '旧概述', lessonPlan: [{ title: '导入' }] }, lesson_context: { periods: 1, className: '九年级 3 班', classLevel: '普通' } };
  const form = planFormFromDraft(draft);
  const update = applyPlanForm(draft, { ...form, title: '《岳阳楼记》', objectives: '- 理解迁客骚人\n• 说明主旨', keyPoints: '体会情感', periods: '2', teachingGoal: '有依据地表达' });
  assert.equal(update.title, '《岳阳楼记》');
  assert.deepEqual(update.answer.objectives, ['理解迁客骚人', '说明主旨']);
  assert.deepEqual(update.answer.lessonPlan, [{ title: '导入' }]);
  assert.equal(update.lessonContext.periods, 2);
  assert.equal(update.lessonContext.className, '九年级 3 班');
});

test('teacher form reads common model aliases and does not present a generic user prompt as the plan summary', () => {
  const form = planFormFromDraft({
    title: '《就英法联军远征中国致巴特勒上尉的信》',
    answer: {
      summary: '围绕“这篇课文怎么备课”组织可核验的备课方案。',
      teachingObjectives: ['辨析反语', '理解作者立场'],
      difficulties: ['从词语褒贬理解反讽'],
      lessonPlan: [{ title: '辨析赞美词' }, { title: '追问真实立场' }]
    }
  });
  assert.match(form.summary, /辨析赞美词—追问真实立场/u);
  assert.doesNotMatch(form.summary, /怎么备课/u);
  assert.equal(form.objectives, '辨析反语\n理解作者立场');
  assert.equal(form.keyPoints, '从词语褒贬理解反讽');
});

test('teacher workflow states remain explicit and cumulative', () => {
  assert.equal(deriveTeacherDraftState({ draft: null }).teacherConfirmed, false);
  assert.deepEqual(deriveTeacherDraftState({ draft: { answer: {} }, cards: [], dirty: false }), {
    planDraft: true, unsavedChanges: false, teacherConfirmed: false, cardsGenerated: false, cardLocked: false
  });
  const state = deriveTeacherDraftState({ draft: { answer: {} }, cards: [{ status: 'locked' }], dirty: true });
  assert.equal(state.unsavedChanges, true);
  assert.equal(state.teacherConfirmed, true);
  assert.equal(state.cardsGenerated, true);
  assert.equal(state.cardLocked, true);
  const pending = deriveTeacherDraftState({ draft: { answer: { planApproval: { status: 'changes_pending', hasUnconfirmedChanges: true, confirmedAt: '2026-08-26T00:00:00Z' } } }, cards: [] });
  assert.equal(pending.teacherConfirmed, false);
  const confirmed = deriveTeacherDraftState({ draft: { answer: { planApproval: { status: 'confirmed', hasUnconfirmedChanges: false, confirmedAt: '2026-08-26T00:00:00Z' } } }, cards: [] });
  assert.equal(confirmed.teacherConfirmed, true);
});

test('front-end contract confirms the saved version before generating cards and uses teacher-facing CTA', () => {
  const source = appSource;
  const confirmCall = source.indexOf('/confirm`');
  const generateCall = source.indexOf('/cards/generate`');
  assert.ok(confirmCall > 0 && generateCall > confirmCall);
  assert.match(source, /查看并定稿方案/u);
  assert.match(source, /cards:\s*sameLesson\s*\?\s*cardsForAskDraft\(existingDraft\)\s*:\s*\[\]/u);
  assert.doesNotMatch(source, /href=\{cardsHref\}>生成一课三卡/u);
});

test('cards page guides every generation step and keeps citation recovery teacher-facing', () => {
  const source = appSource;
  for (const label of ['本页使用顺序', '核对方案', '生成三卡', '编辑保存锁定', '课堂使用', '重新核对并重试']) {
    assert.match(source, new RegExp(label, 'u'));
  }
  const message = errorCopy({ code: 'citation_text_mismatch' });
  assert.match(message, /修改仍在/u);
  assert.doesNotMatch(message, /citation_text_mismatch|PageIndex|BFF/u);
});
