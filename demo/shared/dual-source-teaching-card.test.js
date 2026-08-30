import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDualSourceTeachingCard, focusedSnippet } from './dual-source-teaching-card.js';

test('双源讲解卡只使用已定位的教材与教参原页', () => {
  const card = buildDualSourceTeachingCard({
    lessonTitle: '《岳阳楼记》',
    focus: '先天下之忧而忧',
    sources: [
      { documentId: 'textbook', pdfPage: 56, printedPage: '50', sectionPath: ['第三单元', '11 岳阳楼记'], text: '嗟夫！予尝求古仁人之心。先天下之忧而忧，后天下之乐而乐。' },
      { documentId: 'teacher-guide', pdfPage: 224, printedPage: '212', text: '围绕“先天下之忧而忧”理解范仲淹的政治情怀。' }
    ]
  });
  assert.equal(card.status, 'direct');
  assert.equal(card.textbook.pdfPage, 56);
  assert.equal(card.teacherGuide.pdfPage, 224);
  assert.match(card.markdown, /学生教材 · PDF 第 56 页/u);
  assert.match(card.markdown, /教师用书 · PDF 第 224 页/u);
  assert.match(card.markdown, /不替学生预写结论/u);
  assert.doesNotMatch(card.markdown, /apiKey|documentId/u);
});

test('缺少任一来源或有效物理页时不生成双源讲解卡', () => {
  assert.equal(buildDualSourceTeachingCard({ focus: '关键词', sources: [{ documentId: 'textbook', pdfPage: 56 }] }), null);
  assert.equal(buildDualSourceTeachingCard({ focus: '关键词', sources: [{ documentId: 'textbook', pdfPage: 0 }, { documentId: 'teacher-guide', pdfPage: 2 }] }), null);
});

test('聚焦片段只截取原文上下文，不改写原句', () => {
  const result = focusedSnippet('甲'.repeat(90) + '不以物喜，不以己悲' + '乙'.repeat(90), '不以物喜，不以己悲', 12);
  assert.equal(result.directMatch, true);
  assert.match(result.text, /不以物喜，不以己悲/u);
  assert.equal(result.text.startsWith('…'), true);
  assert.equal(result.text.endsWith('…'), true);
});

test('当前页没有聚焦词时不展示无关页首文字', () => {
  const result = focusedSnippet('这是同一页的其他教学内容，与当前聚焦无关。', '政治情怀');
  assert.deepEqual(result, { text: '', directMatch: false });
});
