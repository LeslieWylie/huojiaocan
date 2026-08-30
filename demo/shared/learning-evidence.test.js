import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLearningEvidence,
  learningEvidenceContext,
  learningEvidenceIsStale,
  learningEvidenceProgress,
  mergeLearningEvidence
} from './learning-evidence.js';

function draftFixture() {
  return {
    version: 7,
    citations: [{ id: 'E1', documentId: 'textbook', pdfPage: 56, quote: '为什么我的眼里常含泪水' }],
    cards: [{ type: 'question', items: [{ id: 'q1', text: '这句诗怎样收束全诗情感？', citationIds: ['E1'] }] }],
    answer: {}
  };
}

test('builds a learning evidence sheet from server-owned questions and citations', () => {
  const draft = draftFixture();
  const evidence = buildLearningEvidence(draft, '2026-08-26T00:00:00.000Z');
  assert.equal(evidence.entries[0].prompt, '这句诗怎样收束全诗情感？');
  assert.deepEqual(evidence.entries[0].citationIds, ['E1']);
  assert.equal(learningEvidenceIsStale({ ...draft, answer: { learningEvidence: evidence } }), false);
  assert.equal(learningEvidenceIsStale({ ...draft, citations: [{ ...draft.citations[0], pdfPage: 57 }], answer: { learningEvidence: evidence } }), true);
});

test('stale or unconfirmed rehearsal never overrides the current question card', () => {
  const draft = draftFixture();
  draft.answer.questionRehearsal = {
    status: 'confirmed', sourceKey: 'qv1-old',
    steps: [{ id: 'old', question: '已经过期的问题', citationIds: ['E1'] }]
  };
  const evidence = buildLearningEvidence(draft);
  assert.equal(evidence.entries[0].prompt, '这句诗怎样收束全诗情感？');
});

test('only merges aggregate learning results and requires a complete item before confirmation', () => {
  const evidence = buildLearningEvidence(draftFixture());
  assert.throws(() => mergeLearningEvidence(evidence, evidence, { confirm: true }), /learning_evidence_incomplete/u);
  const submitted = structuredClone(evidence);
  submitted.entries[0] = {
    ...submitted.entries[0],
    prompt: '伪造问题',
    citationIds: ['forged'],
    assignedCount: 42,
    submittedCount: 40,
    secureCount: 12,
    partialCount: 21,
    notYetCount: 7,
    observedPattern: '只说情感，没有联系全诗意象',
    teacherAction: '先串联意象，再回到结尾'
  };
  const confirmed = mergeLearningEvidence(evidence, submitted, { confirm: true, now: '2026-08-26T01:00:00.000Z' });
  assert.equal(confirmed.entries[0].prompt, evidence.entries[0].prompt);
  assert.deepEqual(confirmed.entries[0].citationIds, ['E1']);
  assert.equal(learningEvidenceProgress(confirmed).ready, true);
  assert.equal(confirmed.status, 'confirmed');
  assert.throws(() => mergeLearningEvidence(confirmed, submitted), /learning_evidence_confirmed/u);
});

test('confirmed model context contains only aggregate results and teacher summaries', () => {
  const evidence = buildLearningEvidence(draftFixture());
  const submitted = structuredClone(evidence);
  Object.assign(submitted.entries[0], {
    assignedCount: 42,
    submittedCount: 39,
    secureCount: 12,
    partialCount: 20,
    notYetCount: 7,
    observedPattern: '没有联系意象',
    teacherAction: '增加意象关系图'
  });
  const confirmed = mergeLearningEvidence(evidence, submitted, { confirm: true });
  const context = learningEvidenceContext(confirmed);
  assert.equal(context.itemCount, 1);
  assert.equal(context.submittedCount, 39);
  assert.equal(context.focus[0].teacherAction, '增加意象关系图');
});

test('rejects invalid counts and obvious contact details in teacher summaries', () => {
  const evidence = buildLearningEvidence(draftFixture());
  const submitted = structuredClone(evidence);
  Object.assign(submitted.entries[0], { assignedCount: 1, submittedCount: 1, secureCount: 1, observedPattern: '联系 13800138000' });
  assert.throws(() => mergeLearningEvidence(evidence, submitted), /student_sample_contains_contact/u);
  Object.assign(submitted.entries[0], { observedPattern: '', teacherAction: '联系 student@example.com 再处理' });
  assert.throws(() => mergeLearningEvidence(evidence, submitted), /student_sample_contains_contact/u);
  Object.assign(submitted.entries[0], { assignedCount: 10, submittedCount: 9, secureCount: 3, partialCount: 3, notYetCount: 1, observedPattern: '', teacherAction: '' });
  assert.throws(() => mergeLearningEvidence(evidence, submitted), /learning_evidence_counts_invalid/u);
});
