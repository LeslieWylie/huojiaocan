import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTeachingPlanQuality } from './lesson-quality.js';

const citations = [
  { id: 'T1', documentType: 'textbook' },
  { id: 'G1', documentType: 'teacher_guide' },
  { id: 'C1', documentType: 'curriculum_standard' }
];

const cards = ['board', 'question', 'assessment'].map(type => ({
  type,
  status: 'draft',
  items: [{ text: `${type} 内容`, citationIds: ['T1'] }]
}));

test('returns ready for a complete, referenced teaching plan', () => {
  const result = analyzeTeachingPlanQuality({
    lessonPlan: [{ title: '导入', evidenceRefs: ['T1'] }],
    questionChain: [{ question: '核心问题', evidenceRefs: ['G1'] }],
    assessment: [{ text: '可观察表现', evidenceRefs: ['C1'] }],
    citations
  }, cards);

  assert.equal(result.status, 'ready');
  assert.equal(result.score, 100);
  assert.deepEqual(result.coverage, { textbook: true, teacherGuide: true, curriculumStandard: true });
  assert.equal(result.issues.length, 0);
});

test('returns review for empty and unreferenced cards and incomplete answer', () => {
  const result = analyzeTeachingPlanQuality({ lessonPlan: [], citations: [] }, [
    { type: 'board', items: [] },
    { type: 'question', status: 'locked', items: [{ text: '没有依据' }] },
    { type: 'assessment', items: [{ text: '有依据', citationIds: ['T1'] }] }
  ]);

  assert.equal(result.status, 'review');
  assert.ok(result.issues.some(item => item.code === 'CARD_EMPTY'));
  assert.ok(result.issues.some(item => item.code === 'CARD_ITEM_UNREFERENCED'));
  assert.ok(result.issues.some(item => item.code === 'CARD_LOCKED'));
  assert.ok(result.issues.some(item => item.code === 'ANSWER_QUESTIONCHAIN_MISSING'));
});

test('flags missing curriculum standard coverage', () => {
  const result = analyzeTeachingPlanQuality({
    lessonPlan: [{}], questionChain: [{}], assessment: [{}],
    citations: citations.filter(item => item.documentType !== 'curriculum_standard')
  }, cards);

  assert.equal(result.coverage.curriculumStandard, false);
  assert.ok(result.issues.some(item => item.message.includes('课程标准')));
});
