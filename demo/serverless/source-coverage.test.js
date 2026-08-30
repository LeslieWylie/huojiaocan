import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSourceCoverage, sourceRole } from './source-coverage.js';

test('source coverage recognises the three material roles', () => {
  assert.equal(sourceRole({ documentId: 'textbook' }), 'textbook');
  assert.equal(sourceRole({ documentType: 'teacher_guide' }), 'teacherGuide');
  assert.equal(sourceRole({ documentType: 'curriculum-standard' }), 'curriculumStandard');
  assert.deepEqual(deriveSourceCoverage([
    { documentId: 'textbook' },
    { documentId: 'teacher-guide' },
    { documentType: 'curriculum-standard' }
  ]), {
    textbook: true,
    teacherGuide: true,
    curriculumStandard: true,
    missing: [],
    label: '三类材料均已覆盖',
    complete: true
  });
});

test('missing curriculum material is stated instead of being fabricated', () => {
  const coverage = deriveSourceCoverage([{ documentId: 'textbook' }, { documentId: 'teacher-guide' }]);
  assert.equal(coverage.complete, false);
  assert.deepEqual(coverage.missing, ['课程标准材料']);
});
