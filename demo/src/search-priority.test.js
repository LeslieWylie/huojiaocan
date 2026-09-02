import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeSearchResults } from './app-core.js';

test('混合教材搜索优先展示学生教材原文，再展示教师用书参考', () => {
  const results = prioritizeSearchResults([
    { documentId: 'teacher-guide', pdfPage: 236 },
    { documentId: 'textbook', pdfPage: 56 },
    { documentId: 'curriculum-standard', pdfPage: 21 }
  ]);
  assert.deepEqual(results.map(item => item.documentId), ['textbook', 'teacher-guide', 'curriculum-standard']);
});
