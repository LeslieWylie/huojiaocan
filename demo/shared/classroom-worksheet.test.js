import assert from 'node:assert/strict';
import test from 'node:test';

import { buildClassroomWorksheet, buildClassroomWorksheetHtml } from './classroom-worksheet.js';

const input = {
  title: '《岳阳楼记》',
  coreQuestion: '景、情、理怎样逐层推进？',
  cards: [
    { type: 'question', items: [
      { id: 'Q1', text: '“衔远山，吞长江”怎样写出洞庭湖气象？', citationIds: ['T1', 'G1', 'S1'] },
      { id: 'Q2', text: '阴晴两景为什么形成对照？', citationIds: ['T2', 'G1'] }
    ] },
    { type: 'assessment', items: [{ id: 'A1', text: '引用原文说明“不以物喜”的意义', citationIds: ['T2', 'G1'] }] }
  ],
  citations: [
    { id: 'T1', documentId: 'textbook', documentType: 'textbook', documentTitle: '学生教材', pdfPage: 48 },
    { id: 'T2', documentId: 'textbook', documentType: 'textbook', documentTitle: '学生教材', pdfPage: 49 },
    { id: 'G1', documentId: 'teacher-guide', documentType: 'teacher_guide', documentTitle: '教师教学用书', pdfPage: 224 },
    { id: 'S1', documentId: 'curriculum-standard', documentType: 'curriculum_standard', documentTitle: '课程标准', pdfPage: 21 }
  ]
};

test('builds three classroom tasks from confirmed cards and physical textbook pages', () => {
  const sheet = buildClassroomWorksheet(input);
  assert.equal(sheet.status, 'ready');
  assert.deepEqual(sheet.tasks.map(item => item.level), ['A', 'B', 'C']);
  assert.equal(sheet.tasks[0].studentCitations[0].pdfPage, 48);
  assert.ok(sheet.tasks[0].teacherCitations.some(item => item.documentType === 'teacher-guide'));
  assert.equal(sheet.usedCitationCount, 4);
});

test('student page never contains teacher-guide references while teacher page keeps them', () => {
  const pack = buildClassroomWorksheetHtml(buildClassroomWorksheet(input));
  const studentPage = pack.html.match(/<section class="page student-page">([\s\S]*?)<section class="page teacher-page">/u)?.[1] || '';
  const teacherPage = pack.html.match(/<section class="page teacher-page">([\s\S]*?)<\/section><\/main>/u)?.[1] || '';
  assert.doesNotMatch(studentPage, /教师教学用书|课程标准|PDF 第 (?:224|21) 页/u);
  assert.match(studentPage, /学生教材 · PDF 第 48 页/u);
  assert.match(teacherPage, /教师教学用书 · PDF 第 224 页/u);
  assert.match(teacherPage, /课程标准 · PDF 第 21 页/u);
  assert.match(pack.html, /只打印学生页/u);
  assert.equal(pack.pageCount, 2);
});

test('does not invent tasks when a card has only teacher-guide evidence', () => {
  const sheet = buildClassroomWorksheet({
    ...input,
    cards: [{ type: 'question', items: [{ text: '只有教参的内容', citationIds: ['G1'] }] }]
  });
  assert.equal(sheet.status, 'blocked');
  assert.equal(sheet.tasks.length, 0);
  assert.match(sheet.warnings[0], /没有绑定学生教材原页/u);
});

test('offline worksheet escapes content and contains no URLs or credentials', () => {
  const pack = buildClassroomWorksheetHtml(buildClassroomWorksheet({ ...input, title: '<img src=x onerror=alert(1)>' }));
  assert.doesNotMatch(pack.html, /<img src=x|access_token|refresh_token|apiKey|https?:\/\//u);
  assert.match(pack.html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
});
