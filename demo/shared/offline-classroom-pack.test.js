import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOfflineClassroomPack } from './offline-classroom-pack.js';

const input = {
  title: '《岳阳楼记》',
  coreQuestion: '景、情、理怎样逐层推进？',
  cards: [
    { type: 'board', items: [{ text: '览物之情 → 古仁人之心', citationIds: ['E1'] }] },
    { type: 'question', items: [{ text: '迁客骚人的悲喜由什么触发？', citationIds: ['E1'] }, { text: '古仁人为何不随景迁？', citationIds: ['E2'] }] },
    { type: 'assessment', items: [{ text: '引用原文说明“不以物喜”的意义', citationIds: ['E2'] }] }
  ],
  citations: [
    { id: 'E1', documentTitle: '学生教材', pdfPage: 48, printedPage: '46', viewer: { pdfUrl: '/secret.pdf' } },
    { id: 'E2', documentTitle: '教师教学用书', pdfPage: 224, printedPage: '212' }
  ]
};

test('offline classroom pack is self-contained, interactive and grounded', () => {
  const pack = buildOfflineClassroomPack(input);
  assert.match(pack.filename, /岳阳楼记.*离线课堂包\.html/u);
  assert.match(pack.html, />离线课堂包<\/span>/u);
  assert.match(pack.html, /data-stage-button="5"/u);
  assert.match(pack.html, /时间不足/u);
  assert.match(pack.html, /学生卡住/u);
  assert.match(pack.html, /提前完成/u);
  assert.match(pack.html, /学生教材 PDF 第 48 页/u);
  assert.match(pack.html, /教师教学用书 PDF 第 224 页/u);
  assert.equal(pack.citationCount, 2);
  assert.doesNotMatch(pack.html, /secret\.pdf|access_token|apiKey|refresh_token/u);
  assert.doesNotMatch(pack.html, /https?:\/\//u);
});

test('offline classroom pack escapes teacher text instead of creating executable markup', () => {
  const pack = buildOfflineClassroomPack({ ...input, title: '<img src=x onerror=alert(1)>', coreQuestion: '</script><script>alert(1)</script>' });
  assert.doesNotMatch(pack.html, /<img src=x|<script>alert\(1\)<\/script>/u);
  assert.match(pack.html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.match(pack.html, /&lt;\/script&gt;/u);
  assert.match(pack.html, /&lt;sc/u);
});

test('offline classroom pack ignores unreferenced or invalid citation pages', () => {
  const pack = buildOfflineClassroomPack({ ...input, citations: [...input.citations, { id: 'E3', documentTitle: '伪造材料', pdfPage: 0 }, { id: 'E4', documentTitle: '未使用材料', pdfPage: 99 }] });
  assert.doesNotMatch(pack.html, /伪造材料|未使用材料/u);
  assert.equal(pack.citationCount, 2);
});
