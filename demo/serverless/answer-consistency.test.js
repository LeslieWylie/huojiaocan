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
