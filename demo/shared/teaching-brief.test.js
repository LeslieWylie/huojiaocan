import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTeachingBrief } from './teaching-brief.js';

test('教研说课简报只整理已有方案、三卡和真实页码', () => {
  const brief = buildTeachingBrief({
    title: '《岳阳楼记》',
    coreQuestion: '古仁人之心如何超越个人悲喜？',
    lessonContext: { periods: 2, classLevel: '九年级普通班' },
    answer: {
      summary: '从景、情、理的转折中理解作者的政治情怀。',
      objectives: ['能引用原文说明古仁人的胸襟'],
      lessonPlan: [{ title: '朗读入境' }, { title: '比较迁客骚人与古仁人' }]
    },
    cards: [
      { type: 'question', items: [{ text: '为什么要用迁客骚人反衬古仁人？' }] },
      { type: 'assessment', items: [{ text: '学生能引用两处原文完成解释。' }] }
    ],
    citations: [
      { documentId: 'textbook', pdfPage: 56 },
      { documentId: 'teacher-guide', pdfPage: 224 },
      { documentId: 'teacher-guide', pdfPage: 224 }
    ]
  });
  assert.equal(brief.sections.length, 4);
  assert.equal(brief.sourceCoverage, 'balanced');
  assert.equal(brief.sources.length, 2);
  assert.match(brief.markdown, /学生教材 PDF 第 56 页/u);
  assert.match(brief.markdown, /教师用书 PDF 第 224 页/u);
  assert.match(brief.markdown, /学情判断与课堂取舍须由教师确认/u);
  assert.doesNotMatch(brief.markdown, /documentId|apiKey|pdfUrl/u);
});

test('缺少教师用书时明确标注材料缺口', () => {
  const brief = buildTeachingBrief({ title: '我爱这土地', citations: [{ documentId: 'textbook', pdfPage: 57 }] });
  assert.equal(brief.sourceCoverage, 'textbook-only');
  assert.match(brief.markdown, /尚未绑定教师用书原页/u);
});

test('三类材料均有原页时生成完整说课依据', () => {
  const brief = buildTeachingBrief({
    title: '岳阳楼记',
    citations: [
      { documentId: 'curriculum-standard', documentType: 'curriculum_standard', pdfPage: 21 },
      { documentId: 'textbook', pdfPage: 56 },
      { documentId: 'teacher-guide', pdfPage: 224 }
    ]
  });
  assert.equal(brief.sourceCoverage, 'three-source');
  assert.equal(brief.standardCount, 1);
  assert.match(brief.markdown, /课程标准 PDF 第 21 页/u);
});
