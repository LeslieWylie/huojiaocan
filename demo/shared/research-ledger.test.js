import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonStudySourceKey } from './lesson-study.js';
import { buildSameLessonComparison, mergeSameLessonComparison } from './same-lesson-comparison.js';
import { buildResearchLedger } from './research-ledger.js';

function draft(id, title = '《岳阳楼记》') {
  const value = {
    id, version: 3, title, updated_at: `2026-08-2${id === 'a' ? 6 : 7}T08:00:00Z`, lesson_context: { classLevel: id === 'a' ? '基础班' : '提高班' }, cards: [], citations: [],
    answer: { lesson: { title, coreQuestion: '作者如何由写景走向价值判断？' }, lessonStudy: { status: 'confirmed', sourceKey: '', title, inquiryQuestion: '作者如何由写景走向价值判断？', confirmedAt: `2026-08-2${id === 'a' ? 6 : 7}T08:00:00Z`, evidence: { classroomFacts: ['课堂事实'], reflectionFacts: ['教师复盘'], learningSummary: null }, conclusion: { decision: 'adjust', finding: `${id} 的课堂发现`, nextTrial: `${id} 的下一次尝试`, scopeBoundary: '只说明本次课堂。' } } }
  };
  value.answer.lessonStudy.sourceKey = lessonStudySourceKey(value);
  return value;
}

test('one confirmed classroom becomes a research line waiting for a second sample', () => {
  const ledger = buildResearchLedger([draft('a')]);
  assert.equal(ledger.items.length, 1);
  assert.equal(ledger.items[0].nextAction.type, 'collect_second_sample');
  assert.equal(ledger.summary.sampleCount, 1);
});

test('two confirmed classrooms of the same lesson become ready for comparison', () => {
  const ledger = buildResearchLedger([draft('a'), draft('b')]);
  assert.equal(ledger.items[0].samples.length, 2);
  assert.deepEqual(ledger.items[0].readyPair, { leftId: 'b', rightId: 'a' });
  assert.equal(ledger.items[0].nextAction.type, 'start_comparison');
  assert.match(ledger.items[0].nextAction.href, /\/compare\//u);
});

test('a confirmed comparison becomes a reusable hypothesis without exposing full draft answers', () => {
  const left = draft('a'), right = draft('b');
  const generated = buildSameLessonComparison(left, right);
  const confirmed = mergeSameLessonComparison(generated, { synthesis: { decision: 'transferable', transferableFinding: '先建立景情关系，再进入价值判断。', contextBoundary: '适用于已经完成文意疏通的班级。', nextExperiment: '只改变关系图出现时机。' } }, { confirm: true, confirmedBy: 'teacher-1' });
  left.answer.sameLessonComparisons = [confirmed];
  const ledger = buildResearchLedger([left, right]);
  assert.equal(ledger.summary.confirmedHypothesisCount, 1);
  assert.equal(ledger.items[0].nextAction.type, 'review_hypothesis');
  assert.equal(ledger.items[0].comparisons[0].transferableFinding, '先建立景情关系，再进入价值判断。');
  assert.equal('answer' in ledger.items[0].samples[0], false);
});

test('different lessons remain separate research lines', () => {
  const ledger = buildResearchLedger([draft('a'), draft('b', '《醉翁亭记》')]);
  assert.equal(ledger.items.length, 2);
  assert.equal(ledger.items.every(item => item.samples.length === 1), true);
});

test('a deleted comparison sample returns to asset selection instead of a broken compare link', () => {
  const left = draft('a'), right = draft('b');
  left.answer.sameLessonComparisons = [buildSameLessonComparison(left, right)];
  const ledger = buildResearchLedger([left]);
  assert.equal(ledger.items[0].nextAction.type, 'refresh_comparison');
  assert.equal(ledger.items[0].nextAction.href, '/assets/');
  assert.equal(ledger.items[0].nextAction.label, '重新选择课堂样本');
});
