import test from 'node:test';
import assert from 'node:assert/strict';
import { answerConsistencyIssues } from './answer-consistency.js';

test('one-period correction cannot retain second-period position or activities', () => {
  assert.equal(answerConsistencyIssues({ answer: { lessonPosition: '第二课时聚焦第五段', lessonPlan: [{ period: 2 }] } }, { periods: 1 }).length, 2);
  assert.deepEqual(answerConsistencyIssues({ answer: { lessonPosition: '第二课时聚焦第五段', lessonPlan: [{ period: 2 }] } }, { periods: 2 }), []);
});

test('source audit cannot certify unsupported or unbound conclusions', () => {
  assert.equal(answerConsistencyIssues({ sourceChecks: [{ status: 'contradicted' }, { status: 'verified', evidenceRefs: ['E99'] }] }, {}, [{ ref: 'E1' }]).length, 2);
  assert.deepEqual(answerConsistencyIssues({ sourceChecks: [{ status: 'corrected', evidenceRefs: ['E1'] }, { status: 'verified', evidenceRefs: ['E1'] }] }, {}, [{ ref: 'E1' }]), []);
});

test('malformed model plan is left to structural validation, not a consistency crash', () => {
  assert.doesNotThrow(() => answerConsistencyIssues({ answer: { lessonPlan: {} } }));
});


test('verbatim assessment cannot pass off a reversed paraphrase as textbook wording', () => {
  const references = [{ ref: 'E1', documentType: 'textbook', excerpt: '不以物喜，不以己悲。先天下之忧而忧，后天下之乐而乐。' }];
  const value = { threeCardSuggestions: { assessment: [{ task: '用课文原句概括两者的态度', observablePerformance: '写出“以物喜，以己悲”和“不以物喜，不以己悲”。' }] } };
  const issues = answerConsistencyIssues(value, {}, references);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /未在当前学生教材片段中匹配/u);
  value.threeCardSuggestions.assessment[0].task = '用自己的话概括两者的态度';
  assert.deepEqual(answerConsistencyIssues(value, {}, references), []);
});
