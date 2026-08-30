import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeBundledPublicDocuments } from './index.js';

test('the remote document catalogue is completed with the bundled curriculum standard', () => {
  const documents = mergeBundledPublicDocuments([
    { id: 'textbook', title: '学生教材', documentType: 'textbook', pageCount: 168 },
    { id: 'teacher-guide', title: '教师用书', documentType: 'teacher_guide', pageCount: 612 }
  ]);
  assert.deepEqual(documents.map(item => item.id), ['textbook', 'teacher-guide', 'curriculum-standard']);
  const standard = documents.find(item => item.id === 'curriculum-standard');
  assert.equal(standard.documentType, 'curriculum_standard');
  assert.equal(standard.pageCount, 109);
  assert.equal(standard.indexStatus, 'ready');
  assert.match(standard.pdfUrl, /义务教育语文课程标准2022\.pdf$/u);
});

test('remote metadata wins while missing bundled documents are added once', () => {
  const documents = mergeBundledPublicDocuments([
    { id: 'textbook', title: '远程教材', documentType: 'student-book', pageCount: 168 },
    { id: 'curriculum-standard', title: '远程课标', documentType: 'standard', pageCount: 109 }
  ]);
  assert.equal(documents.filter(item => item.id === 'curriculum-standard').length, 1);
  assert.equal(documents.find(item => item.id === 'curriculum-standard').title, '远程课标');
  assert.equal(documents.find(item => item.id === 'textbook').documentType, 'textbook');
});
