import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestionRehearsal, mergeQuestionRehearsal, normalizeQuestionRehearsal, questionRehearsalIsStale, rehearsalProgress } from './question-rehearsal.js';

const draft = { version: 7, citations: [{ id: 'c1', documentId: 'textbook', pdfPage: 56 }], cards: [{ type: 'question', items: [{ id: 'q1', text: '主问：为什么先写阴再写晴？｜追问：两段人物活动有什么不同？｜预期学生回应：比较两组景物与情感', citationIds: ['c1', 'forged'] }] }] };

test('builds rehearsal from server cards and only binds existing citations', () => {
  const result = buildQuestionRehearsal(draft, '2026-08-26T00:00:00.000Z');
  assert.equal(result.sourceDraftVersion, 7);
  assert.equal(result.steps[0].question, '为什么先写阴再写晴？');
  assert.deepEqual(result.steps[0].citationIds, ['c1']);
  assert.match(result.steps[0].branches.partial, /人物活动/);
  assert.equal(questionRehearsalIsStale({ ...draft, answer: { questionRehearsal: result } }), false);
  assert.equal(questionRehearsalIsStale({ ...draft, cards: [{ ...draft.cards[0], items: [{ ...draft.cards[0].items[0], text: '主问：新问题', citationIds: ['c1'] }] }], answer: { questionRehearsal: result } }), true);
});

test('merge accepts only teacher outcome and note, preserving grounded fields', () => {
  const current = buildQuestionRehearsal(draft);
  const submitted = structuredClone(current);
  submitted.steps[0] = { ...submitted.steps[0], question: '伪造问题', citationIds: ['evil'], selectedOutcome: 'partial', teacherNote: '先回看原文' };
  const saved = mergeQuestionRehearsal(current, submitted);
  assert.equal(saved.steps[0].question, current.steps[0].question);
  assert.deepEqual(saved.steps[0].citationIds, ['c1']);
  assert.equal(saved.steps[0].selectedOutcome, 'partial');
  assert.equal(rehearsalProgress(saved).complete, true);
});

test('confirmed rehearsal is immutable', () => {
  const current = buildQuestionRehearsal(draft);
  const confirmed = mergeQuestionRehearsal(current, { ...current, steps: [{ ...current.steps[0], selectedOutcome: 'reached' }] }, { confirm: true });
  assert.equal(normalizeQuestionRehearsal(confirmed).status, 'confirmed');
  assert.throws(() => mergeQuestionRehearsal(confirmed, confirmed), /rehearsal_confirmed/);
});

test('server refuses to confirm an incomplete rehearsal', () => {
  const current = buildQuestionRehearsal(draft);
  assert.throws(() => mergeQuestionRehearsal(current, current, { confirm: true }), /rehearsal_incomplete/);
});

test('source identity changes when a bound PDF page changes and supports legacy card content', () => {
  const current = buildQuestionRehearsal(draft);
  assert.equal(questionRehearsalIsStale({ ...draft, citations: [{ ...draft.citations[0], pdfPage: 57 }], answer: { questionRehearsal: current } }), true);
  const legacy = { ...draft, cards: [{ id: 'legacy-question', type: 'question', content: ['为什么这样安排段落？'], citationIds: ['c1'] }] };
  const generated = buildQuestionRehearsal(legacy);
  assert.equal(generated.steps[0].question, '为什么这样安排段落？');
  assert.deepEqual(generated.steps[0].citationIds, ['c1']);
});
