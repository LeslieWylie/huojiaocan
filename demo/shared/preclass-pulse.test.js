import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPreClassPulse,
  mergePreClassPulse,
  preClassPulseClassroomCue,
  preClassPulseIsStale,
  preClassPulseProgress
} from './preclass-pulse.js';

function draft() {
  return {
    version: 7,
    answer: { planApproval: { status: 'confirmed', hasUnconfirmedChanges: false } },
    citations: [
      { id: 'c1', documentId: 'textbook', pdfPage: 33, quote: '衔远山，吞长江' },
      { id: 'c2', documentId: 'teacher-guide', pdfPage: 224, quote: '把握景物描写与情感变化' }
    ],
    cards: [{
      id: 'question-card', type: 'question', items: [
        { id: 'q1', text: '“衔远山，吞长江”怎样写出洞庭湖的气象？', citationIds: ['c1', 'c2'] },
        { id: 'q2', text: '两段写景为什么形成鲜明对照？', citationIds: ['c1'] }
      ]
    }]
  };
}

test('builds at most two grounded pre-class prompts from the question card', () => {
  const pulse = buildPreClassPulse(draft(), '2026-08-27T08:00:00.000Z');
  assert.equal(pulse.prompts.length, 2);
  assert.deepEqual(pulse.prompts[0].citationIds, ['c1', 'c2']);
  assert.match(pulse.sourceKey, /^pulse-v1-/u);
  assert.equal(pulse.recommendation, null);
});

test('derives a scaffolded classroom opening from aggregate counts only', () => {
  const current = buildPreClassPulse(draft());
  const saved = mergePreClassPulse(current, {
    ...current,
    presentCount: 40,
    respondedCount: 38,
    secureCount: 8,
    partialCount: 16,
    notYetCount: 14,
    observedPattern: '多数回答停留在“景色很壮阔”，没有指出动词。',
    teacherDecision: 'adopt'
  }, { confirm: true, now: '2026-08-27T08:03:00.000Z' });
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.recommendation.level, 'scaffold');
  assert.deepEqual(saved.recommendation.citationIds, ['c1', 'c2']);
  assert.equal(preClassPulseProgress(saved).complete, true);
  const withPulse = draft();
  withPulse.answer.preClassPulse = saved;
  assert.equal(preClassPulseClassroomCue(withPulse).counts.responded, 38);
});

test('rejects invalid distributions and student identifiers', () => {
  const current = buildPreClassPulse(draft());
  assert.throws(() => mergePreClassPulse(current, {
    ...current, presentCount: 40, respondedCount: 38, secureCount: 10, partialCount: 10, notYetCount: 10
  }), error => error.code === 'preclass_pulse_counts_invalid');
  assert.throws(() => mergePreClassPulse(current, {
    ...current, presentCount: 40, respondedCount: 38, secureCount: 10, partialCount: 14, notYetCount: 14,
    observedPattern: '姓名：张同学', teacherDecision: 'keep_original'
  }), error => error.code === 'preclass_pulse_contains_identifier');
});

test('browser submissions cannot replace prompts, citations or recommendations', () => {
  const current = buildPreClassPulse(draft());
  const merged = mergePreClassPulse(current, {
    ...current,
    prompts: [{ id: 'forged', prompt: '伪造题目', citationIds: ['fake'] }],
    recommendation: { title: '伪造建议', citationIds: ['fake'] },
    presentCount: 20,
    respondedCount: 20,
    secureCount: 15,
    partialCount: 5,
    notYetCount: 0,
    teacherDecision: 'keep_original'
  });
  assert.equal(merged.prompts[0].prompt, current.prompts[0].prompt);
  assert.deepEqual(merged.prompts[0].citationIds, ['c1', 'c2']);
  assert.equal(merged.recommendation.level, 'deepen');
});

test('marks the pulse stale when the question card or evidence changes', () => {
  const source = draft();
  source.answer.preClassPulse = buildPreClassPulse(source);
  assert.equal(preClassPulseIsStale(source), false);
  source.cards[0].items[0].text = '新的核心问题';
  assert.equal(preClassPulseIsStale(source), true);
});
