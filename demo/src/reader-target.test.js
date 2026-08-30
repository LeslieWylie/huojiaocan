import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPdfPageUrl, buildReaderHref, pairedDocumentId, pairedFocusQuery, pairedLessonQuery, resolveReaderReturn, stripPdfHash, validReaderPage } from './reader-target.js';

test('reader targets preserve the physical page and remove stale PDF fragments', () => {
  assert.equal(validReaderPage('164'), 164);
  assert.equal(validReaderPage('0'), null);
  assert.equal(stripPdfHash('/materials/guide.pdf#page=1'), '/materials/guide.pdf');
  assert.equal(buildPdfPageUrl('/materials/guide.pdf#page=1', 164), '/materials/guide.pdf#page=164&view=FitH');
});

test('citation links carry the same document, page and lesson location contract', () => {
  assert.equal(
    buildReaderHref({ documentId: 'teacher-guide', page: 220, nodeId: 'lesson-11', lessonTitle: '11 岳阳楼记', returnTo: 'ask', scope: 'both' }),
    '/document/?doc=teacher-guide&page=220&node=lesson-11&lesson=11+%E5%B2%B3%E9%98%B3%E6%A5%BC%E8%AE%B0&scope=both&return=ask'
  );
  assert.equal(buildReaderHref({ documentId: 'teacher-guide', page: 0 }), '');
});

test('paired reading switches only between the student textbook and teacher guide', () => {
  assert.equal(pairedDocumentId('textbook'), 'teacher-guide');
  assert.equal(pairedDocumentId('teacher_guide'), 'textbook');
  assert.equal(pairedDocumentId('private-upload'), '');
  assert.equal(pairedLessonQuery({ explicitTitle: '', sectionPath: ['第三单元 · 古诗文', '11 岳阳楼记'], pageTitle: 'PDF 第 48 页' }), '11 岳阳楼记');
  assert.equal(pairedLessonQuery({ sectionPath: ['目录'], pageTitle: 'PDF 第 1 页' }), '');
  assert.match(buildReaderHref({ documentId: 'textbook', page: 48, lessonTitle: '岳阳楼记', paired: true }), /paired=1/u);
});

test('句段追踪保留篇目身份并过滤地址和内部页码字段', () => {
  assert.equal(
    pairedFocusQuery({ lessonTitle: '《岳阳楼记》', focus: '先天下之忧而忧' }),
    '《岳阳楼记》 先天下之忧而忧'
  );
  assert.equal(
    pairedFocusQuery({ lessonTitle: '《岳阳楼记》', focus: 'pdfPage:999 https://bad.example/a 不以物喜' }),
    '《岳阳楼记》 不以物喜'
  );
  const href = buildReaderHref({ documentId: 'teacher-guide', page: 224, lessonTitle: '《岳阳楼记》', focus: '先忧后乐', paired: true });
  const target = new URL(href, 'https://local.test');
  assert.equal(target.searchParams.get('focus'), '先忧后乐');
  assert.equal(target.searchParams.get('paired'), '1');
});

test('reader return targets preserve the exact originating workflow', () => {
  assert.deepEqual(
    resolveReaderReturn('/cards/?draftId=draft-1&classroom=1'),
    { href: '/cards/?draftId=draft-1&classroom=1', label: '返回原页面' }
  );
  assert.deepEqual(resolveReaderReturn('unit'), { href: '/unit/', label: '返回单元接力' });
  assert.deepEqual(resolveReaderReturn('alignment'), { href: '/alignment/', label: '返回课标对齐' });
  assert.deepEqual(resolveReaderReturn('share'), { href: '/share/', label: '返回共备方案' });
  assert.deepEqual(
    resolveReaderReturn('https://outside.example/', { libraryHref: '/library/?doc=textbook&page=12' }),
    { href: '/library/?doc=textbook&page=12', label: '返回教材库' }
  );
  assert.deepEqual(resolveReaderReturn('//outside.example/'), { href: '/library/', label: '返回教材库' });
});
