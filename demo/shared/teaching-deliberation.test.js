import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeTeachingDeliberation, normalizeTeachingDeliberation, teachingDeliberationContext, teachingDeliberationIsStale, teachingDeliberationSourceKey } from './teaching-deliberation.js';

function fixture() {
  const draft = { title: '《岳阳楼记》', question: '如何理解先忧后乐？', lesson_context: { periods: 2 }, answer: { summary: '由写景进入价值判断' }, citations: [{ id: 'E1', documentId: 'textbook', pdfPage: 56, quote: '先天下之忧而忧' }] };
  draft.answer.teachingDeliberation = normalizeTeachingDeliberation({ sourceKey: teachingDeliberationSourceKey(draft), decisions: [{ id: 'd1', question: '第一课时收在哪里？', whyItMatters: '影响第二课时起点', options: [{ id: 'a', label: '收在写景', approach: '先完成阴晴两景比较', tradeoff: '价值讨论推迟', evidenceRefs: ['E1'] }, { id: 'b', label: '推进到迁客骚人', approach: '第一课时完成景情关系', tradeoff: '朗读时间更紧', evidenceRefs: ['E1'] }] }] });
  return draft;
}

test('teacher selects only server-generated option ids', () => {
  const draft = fixture();
  const submitted = structuredClone(draft.answer.teachingDeliberation);
  submitted.decisions[0].question = '客户端伪造问题';
  submitted.decisions[0].options[0].approach = '客户端伪造方案';
  submitted.decisions[0].selectedOptionId = 'b';
  const confirmed = mergeTeachingDeliberation(draft.answer.teachingDeliberation, submitted, { confirm: true, confirmedBy: 'teacher-1', now: '2026-08-26T00:00:00Z' });
  assert.equal(confirmed.decisions[0].question, '第一课时收在哪里？');
  assert.equal(confirmed.decisions[0].options[0].approach, '先完成阴晴两景比较');
  assert.equal(confirmed.decisions[0].selectedOptionId, 'b');
  assert.equal(confirmed.confirmedBy, 'teacher-1');
  assert.equal(teachingDeliberationContext(confirmed).decisions[0].choice, '推进到迁客骚人');
});

test('confirmation requires every decision and becomes immutable', () => {
  const draft = fixture();
  assert.throws(() => mergeTeachingDeliberation(draft.answer.teachingDeliberation, draft.answer.teachingDeliberation, { confirm: true }), /deliberation_incomplete/u);
  const selected = structuredClone(draft.answer.teachingDeliberation);
  selected.decisions[0].selectedOptionId = 'a';
  const confirmed = mergeTeachingDeliberation(draft.answer.teachingDeliberation, selected, { confirm: true });
  assert.throws(() => mergeTeachingDeliberation(confirmed, selected), /deliberation_confirmed/u);
});

test('source changes make a saved deliberation stale', () => {
  const draft = fixture();
  assert.equal(teachingDeliberationIsStale(draft), false);
  assert.equal(teachingDeliberationIsStale({ ...draft, citations: [{ ...draft.citations[0], pdfPage: 57 }] }), true);
  assert.equal(teachingDeliberationIsStale({ ...draft, answer: { ...draft.answer, summary: '完全改写后的课堂方案' } }), true);
});

test('missing teaching choices normalize to an empty safe value', () => {
  assert.deepEqual(normalizeTeachingDeliberation(null).decisions, []);
  assert.equal(teachingDeliberationContext(null), null);
});
