import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSearchResults, prioritizeSearchResults } from './app-core.js';

test('混合教材搜索优先展示学生教材原文，再展示教师用书参考', () => {
  const results = prioritizeSearchResults([
    { documentId: 'teacher-guide', pdfPage: 236 },
    { documentId: 'textbook', pdfPage: 56 },
    { documentId: 'curriculum-standard', pdfPage: 21 }
  ]);
  assert.deepEqual(results.map(item => item.documentId), ['textbook', 'teacher-guide', 'curriculum-standard']);
});

test('搜索结果按学生原文、教师解析和其他材料分组', () => {
  const groups = groupSearchResults([
    { documentId: 'teacher-guide', pdfPage: 220 },
    { documentId: 'curriculum-standard', pdfPage: 21 },
    { documentId: 'textbook', pdfPage: 56 },
    { documentId: 'textbook', pdfPage: 57 }
  ]);
  assert.deepEqual(groups.map(group => [group.id, group.items.length]), [
    ['textbook', 2],
    ['teacher-guide', 1],
    ['other', 1]
  ]);
});
