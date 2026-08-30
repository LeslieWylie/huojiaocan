import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSubstituteTeachingPack } from './substitute-teaching-pack.js';

function sample() {
  return {
    draft: {
      id: 'draft-private',
      user_id: 'user-private',
      email: 'teacher@example.test',
      access_token: 'token-private',
      title: '《岳阳楼记》',
      question: '古仁人之心如何超越个人悲喜？',
      lesson_context: { className: '九年级（2）班', classLevel: '含不应导出的分层数据', periods: 2 },
      answer: {
        lesson: { title: '《岳阳楼记》', coreQuestion: '古仁人之心如何超越个人悲喜？' },
        summary: '从景、情、理的转折进入作者的价值判断。',
        objectives: ['能结合文本说明“先忧后乐”的内涵。'],
        teachingMethod: ['朗读比较', '问题链推进'],
        lessonPlan: [{ title: '朗读入境', content: '比较阴晴景物与迁客骚人的情感。', duration: '12 分钟' }],
        conversationHistory: [{ content: '不应导出的对话历史' }],
        aiMetadata: { model: 'private-model', prompt: '不应导出的提示词' },
        classLearningProfile: { summary: '不应导出的班级聚合学情' },
        classroomRun: { notes: '不应导出的课堂记录' },
        reflection: '不应导出的复盘',
        homeworkReview: { result: '不应导出的作业批改结果' }
      },
      citations: [
        { id: 'E1', documentId: 'textbook', pdfPage: 56, quote: '不应导出的教材引用原文', snippet: '不应导出的片段' },
        { id: 'E2', documentType: 'teacher_guide', pdf_page: 224, quote: '不应导出的教师用书原文' }
      ],
      studentName: '张同学',
      rawAnswer: '不应导出的学生原始答案'
    },
    cards: [
      { type: 'board', items: [{ text: '景—情—志', studentName: '李同学', rawAnswer: '李同学的未脱敏原答' }] },
      { type: 'question', items: [{ text: '迁客骚人的悲喜由什么触发？' }] },
      { type: 'assessment', items: [{ text: '能引用文本解释古仁人之心。' }] },
      { type: 'reflection', items: [{ text: '不应导出的卡片复盘' }] },
      { type: 'chat', items: [{ text: '不应导出的卡片对话' }] }
    ]
  };
}

test('教学接棒单包含代课所需内容并按白名单排除隐私与历史', () => {
  const pack = buildSubstituteTeachingPack(sample());
  const output = `${pack.markdown}\n${pack.html}`;
  assert.equal(pack.title, '《岳阳楼记》 · 教学接棒单');
  assert.match(pack.filename, /岳阳楼记-教学接棒单\.html$/u);
  for (const expected of ['九年级（2）班', '2 课时', '朗读比较', '核心问题', '方案概述', '课堂流程', '景—情—志', '课堂提问', '课堂评价', '学生教材 PDF 第 56 页', '教师用书 PDF 第 224 页', '实际完成到哪一步', '学生最卡住的问题', '下一位教师需要接着做的事']) {
    assert.match(output, new RegExp(expected, 'u'), expected);
  }
  for (const forbidden of ['user-private', 'teacher@example.test', 'token-private', '不应导出的对话历史', 'private-model', '不应导出的提示词', '不应导出的班级聚合学情', '不应导出的课堂记录', '不应导出的复盘', '不应导出的作业批改结果', '不应导出的教材引用原文', '不应导出的片段', '不应导出的教师用书原文', '张同学', '不应导出的学生原始答案', '李同学', '李同学的未脱敏原答', '不应导出的卡片复盘', '不应导出的卡片对话']) {
    assert.equal(output.includes(forbidden), false, forbidden);
  }
  assert.equal(pack.citationCount, 2);
  assert.equal(pack.sectionCount, 10);
  assert.doesNotMatch(pack.html, /<script|https?:\/\/|user_id|access_token|quote|snippet/iu);
});

test('HTML 转义所有教师可编辑内容且保持完整无脚本文档', () => {
  const value = '<img src=x onerror="alert(1)"> & </style><script>alert(2)</script>';
  const pack = buildSubstituteTeachingPack({
    draft: {
      title: value,
      question: value,
      lessonContext: { className: value, periods: 1 },
      answer: { summary: value, objectives: [value], method: value, flow: [value] }
    },
    cards: [{ type: 'board', content: [value] }, { type: 'question', items: [{ content: value }] }, { type: 'assessment', items: [value] }]
  });
  assert.match(pack.html, /^<!doctype html><html lang="zh-CN">/u);
  assert.doesNotMatch(pack.html, /<img src=x|<script>alert|<\/style><script/iu);
  assert.match(pack.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &lt;\/style&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;/u);
});

test('教材与教师用书 PDF 页码按来源和页码去重并稳定排序', () => {
  const pack = buildSubstituteTeachingPack({ draft: { citations: [
    { documentType: 'teacher_guide', pdf_page: 224, quote: '不输出' },
    { documentId: 'textbook', pdfPage: 57 },
    { documentType: 'teacher-guide', pageNumber: 224 },
    { sourceType: 'textbook', page: 56 },
    { documentType: 'curriculum_standard', pdfPage: 10 },
    { documentId: 'textbook', pdfPage: 57 },
    { documentId: 'textbook', pdfPage: 0 }
  ] } });
  assert.equal(pack.citationCount, 3);
  const first = pack.markdown.indexOf('学生教材 PDF 第 56 页');
  const second = pack.markdown.indexOf('学生教材 PDF 第 57 页');
  const third = pack.markdown.indexOf('教师用书 PDF 第 224 页');
  assert.ok(first < second && second < third);
  assert.doesNotMatch(pack.markdown, /课程标准|不输出/u);
});

test('兼容旧草稿、旧卡片和旧引用字段', () => {
  const pack = buildSubstituteTeachingPack({ draft: {
    lesson_title: '孔乙己',
    coreQuestion: '笑声背后是什么？',
    class_name: '九年级一班',
    lessonContext: { period_count: 1 },
    answer: {
      goals: ['理解看客的作用'],
      methods: ['圈点批注'],
      flow: [{ name: '聚焦笑声', teacher_action: '比较不同人物的笑。', time: '15 分钟' }]
    },
    citations: [{ document_type: 'textbook', page_number: 88 }, { source_type: 'guide', page: 301 }],
    cards: [
      { type: 'board', content: ['笑声—看客—悲凉'] },
      { type: 'question', content: [{ content: '谁在笑？为何笑？' }] },
      { type: 'assessment', content: ['能用细节说明看客作用。'] }
    ]
  } });
  const output = `${pack.markdown}\n${pack.html}`;
  for (const expected of ['孔乙己', '九年级一班', '1 课时', '理解看客的作用', '圈点批注', '聚焦笑声：比较不同人物的笑。（15 分钟）', '笑声—看客—悲凉', '谁在笑？为何笑？', '学生教材 PDF 第 88 页', '教师用书 PDF 第 301 页']) assert.match(output, new RegExp(expected, 'u'));
});

test('构建过程不修改输入且同一输入稳定输出', () => {
  const input = sample();
  const snapshot = structuredClone(input);
  const first = buildSubstituteTeachingPack(input);
  const second = buildSubstituteTeachingPack(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), ['title', 'filename', 'markdown', 'html', 'citationCount', 'sectionCount']);
});
