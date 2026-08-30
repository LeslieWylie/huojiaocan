import test from 'node:test';
import assert from 'node:assert/strict';
import { assetFromDraft, copyDraftForReuse, filterAssets } from './asset-model.js';
import { learningEvidenceSourceKey } from '../shared/learning-evidence.js';
import { normalizeTeachingDeliberation, teachingDeliberationSourceKey } from '../shared/teaching-deliberation.js';
import { buildLessonStudy, mergeLessonStudy } from '../shared/lesson-study.js';

test('drafts become searchable teaching assets without losing source coverage', () => {
  const asset = assetFromDraft({
    id: 'd1', title: '《岳阳楼记》两课时方案', version: 4,
    answer: {
      lesson: { title: '《岳阳楼记》' }, sourceCoverage: { textbook: true }, assetMeta: { tags: ['文言文'], favorite: true, version: 3 },
      teachingFeedback: { unfinishedQuestions: '迁客骚人的情感转折仍需追问', usedCards: ['提问卡'] },
      classroomRun: { status: 'pending_review', currentStage: 5, stages: [{ stage: 3, outcome: 'reached' }], keywords: [{ id: 'k1', stage: 3, text: '阴、晴、忧、乐' }], endedAt: '2026-08-13T00:00:00Z' },
      learningEvidence: { status: 'confirmed', sourceKey: 'v1:test', entries: [{ id: 'L1', prompt: '比较阴晴两景', assignedCount: 40, submittedCount: 38, secureCount: 12, partialCount: 20, notYetCount: 6, observedPattern: '关系说明不完整', teacherAction: '先比较再归纳' }] },
      sameLessonComparisons: [{ status: 'confirmed', sourceKey: 'comparison-1', synthesis: { transferableFinding: '私密教研结论' } }],
      planApproval: { status: 'confirmed', hasUnconfirmedChanges: false, confirmedSnapshot: { plan: { summary: '定稿' }, conditions: {}, citations: [] } },
      revisions: [{ answer: { planApproval: { confirmedSnapshot: { plan: { summary: '历史定稿' } } } } }]
    },
    citations: [{ pdfPage: 56 }], cards: [{ id: 'board', status: 'locked' }, { id: 'question', status: 'draft' }], updated_at: '2026-08-13T00:00:00Z'
  });
  assert.equal(asset.draftId, 'd1');
  assert.equal(asset.lessonKey, '《岳阳楼记》');
  assert.equal(asset.favorite, true);
  assert.equal(asset.version, 4);
  assert.equal(asset.teacherConfirmed, true);
  assert.equal(asset.hasUnconfirmedChanges, false);
  assert.equal(asset.cardsGenerated, true);
  assert.equal(asset.lockedCardsCount, 1);
  assert.equal(asset.workflowStatus, 'cards_locked');
  assert.equal(asset.hasReflection, true);
  assert.equal(asset.hasClassroomRecord, true);
  assert.equal(asset.classroomStatus, 'pending_review');
  assert.equal(asset.classroomRecord.keywordsCount, 1);
  assert.equal(asset.content.answer.classroomRun, undefined);
  assert.equal(asset.content.answer.learningEvidence, undefined);
  assert.equal(asset.content.answer.sameLessonComparisons, undefined);
  assert.equal(asset.sameLessonComparisonCount, 1);
  assert.equal(asset.learningEvidenceStatus, 'confirmed');
  assert.equal(asset.learningEvidenceSummary.submittedCount, 38);
  assert.equal(asset.reflection.unresolvedLearning, '迁客骚人的情感转折仍需追问');
  assert.equal(asset.content.answer.planApproval.confirmedSnapshot, undefined);
  assert.equal(asset.content.answer.revisions[0].answer.planApproval.confirmedSnapshot, undefined);
  assert.deepEqual(filterAssets([asset], { query: '岳阳楼' }).map(item => item.draftId), ['d1']);
  assert.deepEqual(filterAssets([asset], { favorite: true, tag: '文言文' }).map(item => item.draftId), ['d1']);
});

test('copying an asset creates a clean editable copy', () => {
  const copied = copyDraftForReuse({
    id: 'd1', title: '《岳阳楼记》备课方案', question: '怎么备课《岳阳楼记》',
    lesson_context: { periods: 2 }, answer: { summary: '教师确认方案', classroomRun: { status: 'confirmed', keywords: [{ id: 'k1', stage: 3, text: '旧课关键词' }] }, revisions: [{ id: 'old' }], conversationHistory: [{ role: 'user', content: '旧问题' }], conversationTurns: [{ question: '旧问题' }], evidenceShelf: [{ documentId: 'teacher-guide', pdfPage: 224 }], sameLessonComparisons: [{ sourceKey: 'private-comparison' }], sameLessonComparisonHistory: [{ sourceKey: 'old-comparison' }], planApproval: { status: 'confirmed', confirmedSnapshot: { plan: { summary: '教师确认方案' } } }, assetMeta: { status: 'published', favorite: true, tags: ['文言文'], assetKey: 'old-key' } },
    citations: [{ documentId: 'teacher-guide', pdfPage: 224 }], cards: [{ id: 'board', status: 'locked', lockedAt: '2026-08-26T00:00:00Z', lockedBy: 'teacher-1', sourceConfirmedVersion: 4, sourceConfirmedAt: '2026-08-26T00:00:00Z', items: [{ text: '先天下之忧而忧' }] }]
  });
  assert.equal(copied.title, '《岳阳楼记》备课方案（副本）');
  assert.equal(copied.version, 1);
  assert.equal(copied.answer.assetMeta.status, 'draft');
  assert.equal(copied.answer.assetMeta.favorite, false);
  assert.deepEqual(copied.answer.assetMeta.tags, []);
  assert.equal(copied.answer.revisions, undefined);
  assert.equal(copied.answer.conversationHistory, undefined);
  assert.equal(copied.answer.conversationTurns, undefined);
  assert.equal(copied.answer.evidenceShelf, undefined);
  assert.equal(copied.answer.planApproval, undefined);
  assert.equal(copied.answer.classroomRun, undefined);
  assert.equal(copied.answer.sameLessonComparisons, undefined);
  assert.equal(copied.answer.sameLessonComparisonHistory, undefined);
  assert.equal(copied.cards[0].status, 'draft');
  assert.equal(copied.cards[0].lockedAt, undefined);
  assert.equal(copied.cards[0].lockedBy, undefined);
  assert.equal(copied.cards[0].sourceConfirmedVersion, undefined);
  assert.equal(copied.cards[0].sourceConfirmedAt, undefined);
  assert.equal(copied.answer.assetMeta.copiedFrom, 'd1');
});

test('assets expose teaching-choice status without leaking the generated decision paper', () => {
  const draft = {
    id: 'd-choice', version: 3, title: '《岳阳楼记》', question: '如何理解先忧后乐？',
    lesson_context: { periods: 2 }, citations: [{ id: 'E1', documentId: 'textbook', pdfPage: 56, quote: '先天下之忧而忧' }], cards: [],
    answer: { summary: '由写景进入价值判断。' }
  };
  draft.answer.teachingDeliberation = normalizeTeachingDeliberation({
    status: 'confirmed', sourceKey: teachingDeliberationSourceKey(draft), confirmedAt: '2026-08-26T00:00:00Z', confirmedBy: 'teacher-1',
    decisions: [{ id: 'd1', question: '第一课时收在哪里？', selectedOptionId: 'a', options: [
      { id: 'a', label: '收在写景', approach: '比较阴晴两景', tradeoff: '价值讨论后置', evidenceRefs: ['E1'] },
      { id: 'b', label: '推进景情', approach: '完成景情关系', tradeoff: '朗读时间更紧', evidenceRefs: ['E1'] }
    ] }]
  });
  const asset = assetFromDraft(draft);
  assert.equal(asset.deliberationStatus, 'confirmed');
  assert.equal(asset.deliberationStale, false);
  assert.equal(asset.content.answer.teachingDeliberation, undefined);
  const copied = copyDraftForReuse(draft);
  assert.equal(copied.answer.teachingDeliberation, undefined);
});

test('assets surface a compact lesson-study decision without leaking the full research record', () => {
  const draft = {
    id: 'd-study', version: 9, title: '《岳阳楼记》', question: '如何理解先忧后乐？',
    citations: [{ id: 'E1', documentId: 'textbook', pdfPage: 56 }],
    cards: [{ id: 'assessment-1', type: 'assessment', items: [{ id: 'a1', text: '能引用原文说明判断', citationIds: ['E1'] }] }],
    answer: {
      summary: '比较阴晴两景，再理解古仁人之心。',
      lessonReflection: { observedLearning: '学生能比较两景。', unresolvedLearning: '价值归纳仍需支架。' }
    }
  };
  const generated = buildLessonStudy(draft, '2026-08-27T08:00:00Z');
  draft.answer.lessonStudy = mergeLessonStudy(generated, { conclusion: { decision: 'adjust', finding: '比较有效，归纳仍需支架。', nextTrial: '增加景情志关系图。' } }, { confirm: true, confirmedBy: 'teacher-1' });
  const asset = assetFromDraft(draft);
  assert.equal(asset.lessonStudyStatus, 'confirmed');
  assert.equal(asset.lessonStudyStale, false);
  assert.equal(asset.lessonStudySummary.decision, 'adjust');
  assert.equal(asset.lessonStudySummary.finding, '比较有效，归纳仍需支架。');
  assert.equal(asset.content.answer.lessonStudy, undefined);
  const copied = copyDraftForReuse(draft);
  assert.equal(copied.answer.lessonStudy, undefined);
});

test('feedback-based reuse carries reflection into a clean re-preparation draft', () => {
  const source = {
    id: 'd2', title: '《我爱这土地》课堂方案', question: '怎样组织朗读教学',
    answer: {
      summary: '以意象和情感线索推进',
      teachingFeedback: {
        unfinishedQuestions: '“嘶哑”与时代处境的联系没有说透',
        timeManagement: '朗读展示超时',
        usedCards: ['板书卡', '提问卡']
      },
      learningEvidence: { status: 'confirmed', entries: [{ id: 'L1', prompt: '说明意象关系', assignedCount: 42, submittedCount: 40, secureCount: 12, partialCount: 21, notYetCount: 7, observedPattern: '关系没有说清', teacherAction: '先比较再归纳' }] }
    },
    cards: [{ id: 'question-1', type: 'question', items: [{ id: 'q1', text: '说明意象关系', citationIds: [] }] }]
  };
  source.answer.learningEvidence.sourceKey = learningEvidenceSourceKey(source);
  const copied = copyDraftForReuse(source, { useFeedback: true });
  assert.equal(copied.title, '《我爱这土地》课堂方案（复备）');
  assert.equal(copied.answer.teachingFeedback, undefined);
  assert.equal(copied.answer.previousLessonReflection.sourceDraftId, 'd2');
  assert.equal(copied.answer.previousLessonReflection.sourceVersion, 1);
  assert.equal(copied.answer.previousLessonReflection.feedback.timeManagement, '朗读展示超时');
  assert.equal(copied.answer.learningEvidence, undefined);
  assert.equal(copied.answer.previousLessonLearningEvidence.summary.submittedCount, 40);
  assert.equal(JSON.stringify(copied.answer.previousLessonLearningEvidence).includes('原始答卷'), false);
});
