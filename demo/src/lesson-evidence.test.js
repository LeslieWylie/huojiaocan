import assert from 'node:assert/strict';
import test from 'node:test';
import { pairLessonEvidence } from './lesson-evidence.js';

test('从混合结果中按输入顺序配对教材与教师用书', () => {
  const result = pairLessonEvidence([
    { documentType: 'other', pdfPage: 2, title: '无关资料' },
    { documentType: 'teacher-guide', pdfPage: 224, title: '教师用书' },
    { documentType: 'textbook', pdfPage: 56, title: '学生教材' }
  ]);

  assert.deepEqual(result, {
    textbook: { documentType: 'textbook', pdfPage: 56, title: '学生教材' },
    teacherGuide: { documentType: 'teacher-guide', pdfPage: 224, title: '教师用书' }
  });
});

test('把 teacher_guide 规范为 teacher-guide', () => {
  const result = pairLessonEvidence([
    { documentType: 'teacher_guide', documentId: 'teacher_guide', pdfPage: 8 },
    { documentType: 'textbook', pdfPage: 3 }
  ]);

  assert.equal(result.teacherGuide.documentType, 'teacher-guide');
  assert.equal(result.teacherGuide.documentId, 'teacher-guide');
});

test('同一来源只取首条有效结果', () => {
  const result = pairLessonEvidence([
    { documentType: 'textbook', pdfPage: 11, id: 'first-textbook' },
    { documentType: 'textbook', pdfPage: 12, id: 'second-textbook' },
    { documentType: 'teacher-guide', pdfPage: 21, id: 'first-guide' },
    { documentType: 'teacher-guide', pdfPage: 22, id: 'second-guide' }
  ]);

  assert.equal(result.textbook.id, 'first-textbook');
  assert.equal(result.teacherGuide.id, 'first-guide');
});

test('跳过无效 pdfPage，且不从其他页码字段猜测', () => {
  const result = pairLessonEvidence([
    { documentType: 'textbook', pdfPage: 0 },
    { documentType: 'teacher-guide', pdfPage: -1 },
    { documentType: 'textbook', pdfPage: 1.5 },
    { documentType: 'teacher-guide', pdfPage: '9' },
    { documentType: 'textbook', page: 7 },
    { documentType: 'teacher-guide', viewer: { page: 8 } },
    { documentType: 'teacher-guide', pdfPage: 18 },
    { documentType: 'textbook', pdfPage: 7 }
  ]);

  assert.equal(result.textbook.pdfPage, 7);
  assert.equal(result.teacherGuide.pdfPage, 18);
});

test('任一来源缺失时保留已定位的一侧，不猜测另一侧', () => {
  assert.deepEqual(pairLessonEvidence([{ documentType: 'textbook', pdfPage: 7 }]), {
    textbook: { documentType: 'textbook', pdfPage: 7 },
    teacherGuide: null
  });
  assert.deepEqual(pairLessonEvidence([{ documentType: 'teacher-guide', pdfPage: 18 }]), {
    textbook: null,
    teacherGuide: { documentType: 'teacher-guide', pdfPage: 18 }
  });
  assert.deepEqual(pairLessonEvidence(null), { textbook: null, teacherGuide: null });
});

test('来源字段互相冲突时拒绝配对，避免把页码绑定到错误教材', () => {
  const result = pairLessonEvidence([
    { documentType: 'textbook', documentId: 'teacher-guide', pdfPage: 56 },
    { documentType: 'teacher-guide', documentId: 'teacher-guide', pdfPage: 224 }
  ]);
  assert.equal(result.textbook, null);
  assert.equal(result.teacherGuide.pdfPage, 224);
});
