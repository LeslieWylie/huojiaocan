import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerWithCurrentRevision,
  appendRevision,
  compareRevision,
  confirmDraftPlan,
  listRevisions,
  requireDraftVersion,
  restoreRevision
} from './draft-revisions.js';
import { teachingDeliberationSourceKey } from '../shared/teaching-deliberation.js';

test('draft revisions keep a restorable snapshot and public metadata', () => {
  const draft = {
    id: 'draft-1', version: 3, title: '《沁园春·雪》', question: '怎样备课？',
    scope: ['textbook'], lesson_context: { periods: 1 },
    answer: { summary: '旧方案' }, citations: [{ pdfPage: 9 }],
    cards: [{ id: 'board-1', type: 'board', status: 'draft', items: [{ id: 'i1', text: '旧板书' }] }]
  };
  const withHistory = { ...draft, answer: appendRevision(draft, 'AI 初稿') };
  const history = listRevisions(withHistory);
  assert.equal(history.length, 1);
  assert.equal(history[0].reason, 'AI 初稿');
  assert.equal(history[0].answer, undefined);
  const restored = restoreRevision(withHistory, history[0].id);
  assert.equal(restored.title, draft.title);
  assert.equal(restored.answer.summary, '旧方案');
  assert.deepEqual(restored.cards, draft.cards);
});

test('restoring a revision preserves a locked card while restoring other content', () => {
  const locked = { id: 'board-1', type: 'board', status: 'locked', items: [{ id: 'i1', text: '教师确认内容' }] };
  const draft = { id: 'draft-2', version: 2, title: '课文', question: '问题', answer: { summary: '当前' }, cards: [locked] };
  const historyAnswer = appendRevision({ ...draft, cards: [{ ...locked, items: [{ id: 'i1', text: '旧内容' }] }] }, '旧版本');
  const restored = restoreRevision({ ...draft, answer: historyAnswer }, historyAnswer.revisions[0].id);
  assert.deepEqual(restored.cards[0], locked);
});

test('revision comparison returns compact field changes without full snapshot payload', () => {
  const original = {
    version: 2,
    title: '《沁园春·雪》备课方案',
    question: '怎么备课《沁园春·雪》',
    lesson_context: { periods: 1, classLevel: '普通', teachingGoal: '理解文本', teachingMode: '探究' },
    answer: { summary: '先读景，再品情。' },
    cards: [{ id: 'board', type: 'board', items: [{ id: 'i1', text: '北国风光' }] }]
  };
  const withRevision = { ...original, answer: appendRevision(original, '教师修改') };
  const current = {
    ...withRevision,
    version: 3,
    title: '《沁园春·雪》两课时备课方案',
    lesson_context: { ...original.lesson_context, periods: 2 },
    answer: { ...withRevision.answer, summary: '第一课时读景，第二课时品情。' }
  };
  const comparison = compareRevision(current, withRevision.answer.revisions[0].id);
  assert.equal(comparison.current.version, 3);
  assert.equal(comparison.changed, true);
  assert.ok(comparison.changes.some(item => item.label === '课时'));
  assert.ok(comparison.changes.some(item => item.label === '方案概述'));
  assert.equal(Object.hasOwn(comparison, 'answer'), false);
});

test('a save snapshots the pre-write current draft and keeps the old confirmation marked pending', () => {
  const current = {
    version: 4, title: '旧标题', question: '旧问题', scope: ['textbook'], lesson_context: { periods: 1 },
    answer: {
      summary: '旧方案',
      planApproval: {
        status: 'confirmed', hasUnconfirmedChanges: false, confirmedVersion: 3,
        confirmedSnapshot: { plan: { summary: '确认方案' }, conditions: {}, citations: [{ documentId: 'book', documentType: 'textbook', pdfPage: 1, quote: '依据' }] }
      }
    },
    citations: [], cards: []
  };
  const next = answerWithCurrentRevision(current, { summary: '新方案', planApproval: { confirmedVersion: 999 } }, '保存方案', { planChanged: true });
  assert.equal(next.revisions[0].version, 4);
  assert.equal(next.revisions[0].answer.summary, '旧方案');
  assert.equal(next.summary, '新方案');
  assert.equal(next.planApproval.confirmedVersion, 3);
  assert.equal(next.planApproval.status, 'changes_pending');
  assert.equal(next.planApproval.hasUnconfirmedChanges, true);
  assert.equal(next.planApproval.confirmedSnapshot.plan.summary, '确认方案');
});

test('confirmDraftPlan stores only current plan, conditions and valid citations without history or keys', () => {
  const draft = {
    version: 8, title: '《岳阳楼记》', question: '如何理解先忧后乐？', scope: ['textbook'],
    lesson_context: { periods: 2, apiKey: 'must-not-copy' },
    answer: {
      summary: '由写景进入价值判断。',
      lessonPlan: [{ title: '比较阴晴两景' }],
      questionChain: [{ question: '两种景如何影响情感？' }],
      assessment: ['能引文判断'],
      revisions: [{ id: 'old', snapshot: true }],
      conversationHistory: [{ role: 'user', content: '旧对话' }],
      teachingDeliberation: {
        status: 'confirmed', confirmedAt: '2026-08-26T08:00:00.000Z', confirmedBy: 'teacher-1',
        decisions: [{ id: 'd1', question: '第一课时收在哪里？', selectedOptionId: 'a', options: [
          { id: 'a', label: '收在写景', approach: '比较阴晴两景', tradeoff: '价值讨论后置', evidenceRefs: ['E1'] },
          { id: 'b', label: '推进景情', approach: '完成景情关系', tradeoff: '朗读时间更紧', evidenceRefs: ['E1'] }
        ] }]
      },
      providerToken: 'must-not-copy'
    },
    citations: [
      { id: 'E1', documentId: 'textbook', documentType: 'textbook', pdfPage: 56, quote: '原文依据', token: 'must-not-copy' },
      { id: 'bad', documentId: 'web', documentType: 'web', pdfPage: 1, quote: '网页' }
    ]
  };
  draft.answer.teachingDeliberation.sourceKey = teachingDeliberationSourceKey(draft);
  const answer = confirmDraftPlan(draft, { confirmedBy: 'teacher-1', confirmedAt: '2026-08-26T09:00:00.000Z' });
  const approval = answer.planApproval;
  assert.equal(approval.confirmedVersion, 8);
  assert.equal(approval.confirmedBy, 'teacher-1');
  assert.equal(approval.confirmedSnapshot.citations.length, 1);
  assert.equal(approval.confirmedSnapshot.plan.summary, draft.answer.summary);
  assert.equal(approval.confirmedSnapshot.plan.revisions, undefined);
  assert.equal(approval.confirmedSnapshot.plan.conversationHistory, undefined);
  assert.equal(approval.confirmedSnapshot.plan.teachingDeliberation, undefined);
  assert.equal(approval.confirmedSnapshot.plan.confirmedTeachingChoices.decisions[0].choice, '收在写景');
  assert.equal(approval.confirmedSnapshot.conditions.lessonContext.apiKey, undefined);
  assert.equal(approval.confirmedSnapshot.citations[0].token, undefined);
  assert.deepEqual(answer.revisions, draft.answer.revisions);
});

test('confirmation rejects incomplete plans or missing versions', () => {
  assert.throws(() => requireDraftVersion(undefined), error => error.code === 'version_required' && error.status === 400);
  assert.throws(() => confirmDraftPlan({ version: 1, answer: { summary: '只有摘要' }, citations: [] }), error => error.code === 'plan_incomplete' && error.status === 422);
});
