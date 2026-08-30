import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClassAdaptedDraft } from './class-lesson-adaptation.js';

function sourceDraft() {
  return {
    id: 'draft-岳阳楼记-3班',
    user_id: 'teacher-1',
    version: 7,
    title: '《岳阳楼记》',
    question: '如何理解“先忧后乐”？',
    scope: [{ documentId: 'textbook', nodeIds: ['n-1'] }],
    lesson_context: {
      className: '九年级3班',
      classLevel: '基础扎实',
      periods: 2,
      lessonRef: { unit: '第三单元' },
      classLearningProfile: { summary: '源班聚合学情全文' },
      studentProfile: { names: ['源班学生甲'] }
    },
    answer: {
      lesson: { title: '《岳阳楼记》', coreQuestion: '作者如何由写景转入先忧后乐的价值判断？' },
      summary: '以阴晴两景、迁客骚人和古仁人之心组织教学。',
      lessonPlan: [{ title: '比较阴晴两景', content: '圈画景物、情感与价值判断的转折。' }],
      teachingBasis: ['学生教材', '教师用书'],
      homework: ['比较两种景物描写'],
      planApproval: { status: 'confirmed', confirmedSnapshot: { privateAggregate: '源班历史聚合全文' } },
      revisions: [{ id: 'r-1', snapshot: '历史版本全文' }],
      conversationHistory: [{ role: 'user', content: '源班私有对话' }],
      conversationTurns: [{ id: 'turn-1', text: '源班追问' }],
      conversation_turns: [{ id: 'legacy-turn', text: '源班旧对话字段' }],
      evidenceShelf: [{ id: 'private-note', text: '源班证据架' }],
      classroomRun: { moments: [{ text: '源班课堂记录' }] },
      classroomMomentTriage: { items: [{ carryoverText: '源班课堂待办' }] },
      lessonReflection: { observedLearning: '源班课后复盘' },
      teachingFeedback: { classResponse: '源班反馈' },
      layeredHomework: { tasks: [{ prompt: '源班已发布作业' }] },
      homeworkReview: { summary: '源班作业汇总' },
      learningEvidence: { entries: [{ prompt: '源班学习证据' }] },
      learningEvidenceHistory: [{ summary: '源班学习证据历史' }],
      classLearningProfile: { summary: '源班班级学情' },
      class_history: { summary: '源班班级历史' },
      studentAggregate: { summary: '源班学生聚合' },
      preClassPulse: { aggregate: '源班课前摸底' },
      lessonStudy: { conclusion: { finding: '源班一课一研' } },
      teachingSlides: { slides: ['源班课件状态'] },
      assetMeta: { assetKey: 'source-key', favorite: true }
    },
    citations: [
      { id: 'E1', documentId: 'textbook', pdfPage: 56, quote: '先天下之忧而忧' },
      { id: 'E2', documentId: 'teacher-guide', pdfPage: 83, quote: '景、情、志相互勾连' }
    ],
    cards: [{
      id: 'board-1',
      type: 'board',
      status: 'locked',
      lockedAt: '2026-08-27T08:00:00Z',
      lockReason: 'teacher-confirmed',
      sourceConfirmedVersion: 7,
      sourceConfirmedAt: '2026-08-27T08:00:00Z',
      items: [{ id: 'b1', text: '洞庭大观 → 悲喜 → 古仁人之心', citationIds: ['E1', 'E2'], lockedBy: 'teacher-1' }],
      boardPlan: {
        coreQuestion: '作者如何由写景转入先忧后乐的价值判断？',
        branches: [{ title: '文本发现', nodes: [{ text: '阴晴两景', citationIds: ['E1'] }] }]
      }
    }]
  };
}

test('buildClassAdaptedDraft preserves lesson identity, plan, scope and trusted evidence', () => {
  const source = sourceDraft();
  const adapted = buildClassAdaptedDraft(source, {
    className: '九年级5班',
    classLevel: '阅读表达需要更多支架',
    students: [{ name: '目标班学生乙' }],
    aggregateText: '目标班历史聚合全文'
  }, { now: '2026-08-27T12:00:00.000Z' });

  assert.equal(adapted.title, '《岳阳楼记》');
  assert.equal(adapted.answer.lesson.title, '《岳阳楼记》');
  assert.equal(adapted.answer.lesson.coreQuestion, source.answer.lesson.coreQuestion);
  assert.equal(adapted.cards[0].boardPlan.coreQuestion, source.cards[0].boardPlan.coreQuestion);
  assert.deepEqual(adapted.scope, source.scope);
  assert.deepEqual(adapted.citations, source.citations);
  assert.deepEqual(adapted.answer.lessonPlan, source.answer.lessonPlan);
  assert.equal(adapted.answer.summary, source.answer.summary);
  assert.deepEqual(adapted.lesson_context, {
    className: '九年级5班',
    classLevel: '阅读表达需要更多支架',
    periods: 2,
    lessonRef: { unit: '第三单元' }
  });
  assert.doesNotMatch(JSON.stringify(adapted), /适配九年级5班/u);
});

test('adaptation clears source-class lifecycle state and stores only compact provenance', () => {
  const adapted = buildClassAdaptedDraft(sourceDraft(), {
    className: '九年级5班',
    classLevel: '普通班',
    students: [{ name: '目标班学生乙' }],
    aggregateText: '目标班历史聚合全文'
  }, { now: 'fixed-time' });

  assert.deepEqual(adapted.answer.classAdaptation, {
    sourceDraftId: 'draft-岳阳楼记-3班',
    sourceVersion: 7,
    sourceClassName: '九年级3班',
    targetClassName: '九年级5班',
    createdAt: 'fixed-time'
  });
  assert.deepEqual(Object.keys(adapted.answer.classAdaptation), [
    'sourceDraftId', 'sourceVersion', 'sourceClassName', 'targetClassName', 'createdAt'
  ]);
  for (const key of [
    'planApproval', 'revisions', 'conversationHistory', 'conversationTurns', 'evidenceShelf',
    'classroomRun', 'classroomMomentTriage', 'lessonReflection', 'teachingFeedback',
    'homework', 'layeredHomework', 'homeworkReview', 'learningEvidence',
    'learningEvidenceHistory', 'classLearningProfile', 'preClassPulse', 'lessonStudy',
    'teachingSlides', 'assetMeta'
  ]) assert.equal(adapted.answer[key], undefined, `${key} should be cleared`);

  const serialized = JSON.stringify(adapted);
  for (const privateText of [
    '源班聚合学情全文', '源班学生甲', '源班历史聚合全文', '源班私有对话',
    '源班课堂记录', '源班课后复盘', '源班作业汇总', '源班学习证据',
    '源班班级学情', '源班旧对话字段', '源班班级历史', '源班学生聚合',
    '目标班学生乙', '目标班历史聚合全文'
  ]) assert.equal(serialized.includes(privateText), false, `${privateText} should not leak`);
  assert.equal(adapted.id, undefined);
  assert.equal(adapted.user_id, undefined);
  assert.equal(adapted.version, 1);
});

test('all copied cards become independent editable drafts without lock provenance', () => {
  const source = sourceDraft();
  const adapted = buildClassAdaptedDraft(source, { className: '九年级5班', classLevel: '普通班' }, { now: 'fixed-time' });
  const card = adapted.cards[0];

  assert.equal(card.status, 'draft');
  assert.equal(card.lockedAt, undefined);
  assert.equal(card.lockReason, undefined);
  assert.equal(card.sourceConfirmedVersion, undefined);
  assert.equal(card.sourceConfirmedAt, undefined);
  assert.equal(card.items[0].lockedBy, undefined);
  assert.equal(card.items[0].text, source.cards[0].items[0].text);
  assert.deepEqual(card.items[0].citationIds, ['E1', 'E2']);
  assert.deepEqual(card.boardPlan.branches, source.cards[0].boardPlan.branches);
});

test('adaptation is stable for an injected clock, pure, and deeply detached', () => {
  const source = sourceDraft();
  const snapshot = structuredClone(source);
  const target = { className: '九年级5班', classLevel: '普通班', students: ['不应保存'] };
  const first = buildClassAdaptedDraft(source, target, { now: 'fixed-time' });
  const second = buildClassAdaptedDraft(source, target, { now: 'fixed-time' });

  assert.deepEqual(first, second);
  assert.deepEqual(source, snapshot);
  first.answer.lessonPlan[0].content = '目标班修改';
  first.cards[0].items[0].citationIds.push('forged');
  first.citations[0].quote = '目标班修改引用';
  first.lesson_context.lessonRef.unit = '目标班修改单元';
  assert.deepEqual(source, snapshot);
});
