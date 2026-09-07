import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresSourceRead, hasSourceRead, retrievalExecution, reviewExecution } from './agent-execution.js';
const page = { documentId: 'textbook', pdfPage: 56, text: '不以物喜，不以己悲。', readMode: 'full_page' };
test('source tasks require real original pages, not READY or coverage', () => {
  assert.equal(requiresSourceRead('请核对引文主语'), true);
  assert.equal(requiresSourceRead('换成两课时'), false);
  assert.equal(hasSourceRead([{ ...page, readMode: 'snippet' }]), false);
  assert.equal(retrievalExecution({ required: true, evidence: [{ ...page, readMode: 'snippet' }], coverage: { sufficient: true } }).status, 'needs_evidence');
});
test('retrieval preserves separate stopping reasons and useful evidence', () => {
  for (const stopReason of ['timeout', 'budget_exhausted', 'tool_error', 'model_error']) {
    const result = retrievalExecution({ evidence: [page], stopReason });
    assert.equal(result.status, 'partial');
    assert.equal(result.stopReason, stopReason);
  }
  assert.equal(retrievalExecution({ evidence: [page] }).status, 'completed');
});
test('failed or skipped final review never claims checks completed', () => {
  for (const status of ['fallback_to_reviewed', 'skipped_deadline', 'rejected_regression']) {
    assert.equal(reviewExecution([{ status: 'completed' }, { status: 'completed' }, { status }]).status, 'partial');
  }
  assert.equal(reviewExecution([{ status: 'completed' }, { status: 'completed' }]).status, 'completed');
  assert.equal(reviewExecution([{ status: 'completed' }]).stopReason, 'review_incomplete');
});
test('quoted subject questions trigger source reading without saying 原文', () => {
  assert.equal(requiresSourceRead('《岳阳楼记》：“宠辱偕忘”写的是谁？请与古仁人之心比较。'), true);
  assert.equal(requiresSourceRead('请换成两课时，加强朗读训练'), false);
});
