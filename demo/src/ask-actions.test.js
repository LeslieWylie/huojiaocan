import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAskAction } from './ask-actions.js';

test('follow-up action objects keep prompt and operation instead of becoming object text', () => {
  const action = normalizeAskAction({ prompt: '请调整为两课时。', operation: { type: 'change_periods', periods: 2 } }, {}, '原始篇目');
  assert.equal(action.text, '请调整为两课时。');
  assert.deepEqual(action.options.operation, { type: 'change_periods', periods: 2 });
});

test('retrying an action can still apply a recovery scope or snapshot mode', () => {
  const result = normalizeAskAction(
    { prompt: '请优先展开教师用书依据。' },
    { scope: 'teacher-guide', retrievalMode: 'stable_snapshot' },
    '当前篇目'
  );
  assert.equal(result.text, '请优先展开教师用书依据。');
  assert.equal(result.options.scope, 'teacher-guide');
  assert.equal(result.options.retrievalMode, 'stable_snapshot');
});

test('plain questions still use the current composer text', () => {
  assert.equal(normalizeAskAction('怎样组织朗读？', {}, '旧问题').text, '怎样组织朗读？');
  assert.equal(normalizeAskAction(null, {}, '当前篇目').text, '当前篇目');
});
