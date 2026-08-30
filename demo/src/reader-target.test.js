import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPdfPageUrl, buildReaderHref, findTreeNodeByNormalizedTitle, normalizeLessonIdentity, pairedDocumentId, pairedFocusQuery, pairedLessonQuery, resolveCrossDocTarget, resolveReaderReturn, stripPdfHash, validReaderPage } from './reader-target.js';
// The tree matching functions internally use reader-target's own
// normalizeLessonIdentity, which strips leading digits so that
// "21 标题" and "标题" match the same node.  Query normalization
// must use the same function.

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadTree(name) {
  const raw = JSON.parse(readFileSync(resolve(__dirname, '../data/index', name), 'utf-8'));
  // Normalize the tree the same way App.jsx does
  const walk = (nodes, parentPath = []) => nodes.flatMap((node, index) => {
    if (!node || typeof node !== 'object') return [];
    const id = String(node.id || node.nodeId || `${parentPath.join('-') || 'root'}-${index}`);
    const title = String(node.title || node.name || node.label || '未命名节点');
    const rawChildren = node.children ?? node.nodes ?? [];
    const children = Array.isArray(rawChildren) ? walk(rawChildren, [...parentPath, id]) : [];
    const start = node.startPage || (children.length ? Math.min(...children.map(c => c.startPage || Infinity)) : 0);
    const end = node.endPage || Math.max(...children.map(c => c.endPage || 0)) || start;
    return [{
      ...node,
      id,
      title,
      level: Number.isFinite(Number(node.level)) ? Number(node.level) : parentPath.length + 1,
      startPage: start,
      endPage: Math.max(start, end),
      pageRange: { start, end: Math.max(start, end) },
      children
    }];
  });
  const source = Array.isArray(raw) ? raw : raw?.data?.tree ?? raw?.tree ?? raw?.children ?? raw?.nodes ?? [];
  return walk(Array.isArray(source) ? source : [source]);
}

const textbookTree = loadTree('textbook-tree.json');
const teacherGuideTree = loadTree('teacher-guide-tree.json');

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

test('page 72 is a valid physical page and builds correct PDF URL', () => {
  assert.equal(validReaderPage('72'), 72);
  assert.equal(validReaderPage(72), 72);
  assert.equal(buildPdfPageUrl('/materials/textbook.pdf', 72), '/materials/textbook.pdf#page=72&view=FitH');
  assert.equal(buildPdfPageUrl('/materials/textbook.pdf#old=hash', 72), '/materials/textbook.pdf#page=72&view=FitH');
  assert.equal(buildPdfPageUrl('', 72), '');
  assert.equal(buildPdfPageUrl('/materials/textbook.pdf', 0), '');
});

test('stripPdfHash removes any hash fragment from PDF URLs', () => {
  assert.equal(stripPdfHash('/materials/guide.pdf#page=1'), '/materials/guide.pdf');
  assert.equal(stripPdfHash('/materials/guide.pdf#page=72&zoom=100'), '/materials/guide.pdf');
  assert.equal(stripPdfHash('/materials/guide.pdf#'), '/materials/guide.pdf');
  assert.equal(stripPdfHash('/materials/guide.pdf'), '/materials/guide.pdf');
  assert.equal(stripPdfHash(''), '');
  assert.equal(stripPdfHash('https://example.com/file.pdf#page=5'), 'https://example.com/file.pdf');
});

test('buildReaderHref preserves return path and draftId through URL params', () => {
  const href = buildReaderHref({ documentId: 'textbook', page: 72, nodeId: 'lesson-11', lessonTitle: '11 岳阳楼记', returnTo: '/ask/?draftId=draft-abc-123&scope=both', scope: 'both' });
  const target = new URL(href, 'https://local.test');
  assert.equal(target.searchParams.get('doc'), 'textbook');
  assert.equal(target.searchParams.get('page'), '72');
  assert.equal(target.searchParams.get('node'), 'lesson-11');
  assert.equal(target.searchParams.get('lesson'), '11 岳阳楼记');
  assert.equal(target.searchParams.get('return'), '/ask/?draftId=draft-abc-123&scope=both');
  assert.equal(target.searchParams.get('scope'), 'both');
});

test('buildReaderHref with paired flag preserves the paired setting', () => {
  const href = buildReaderHref({ documentId: 'teacher-guide', page: 72, lessonTitle: '岳阳楼记', paired: true, returnTo: 'cards' });
  const target = new URL(href, 'https://local.test');
  assert.equal(target.searchParams.get('paired'), '1');
  assert.equal(target.searchParams.get('return'), 'cards');
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

test('normalizeLessonIdentity strips lesson number, book title marks and whitespace', () => {
  assert.equal(normalizeLessonIdentity('5 你是人间的四月天'), '你是人间的四月天');
  assert.equal(normalizeLessonIdentity('21 就英法联军远征中国致巴特勒上尉的信'), '就英法联军远征中国致巴特勒上尉的信');
  assert.equal(normalizeLessonIdentity('《岳阳楼记》'), '岳阳楼记');
  assert.equal(normalizeLessonIdentity('单元说明'), '单元说明');
  assert.equal(normalizeLessonIdentity(''), '');
  assert.equal(normalizeLessonIdentity('   '), '');
  // Operational phrases should not be stripped to empty
  assert.equal(normalizeLessonIdentity('任务二 诗歌朗诵'), '任务二诗歌朗诵');
  // Book title marks in the middle; middle dot (·) is preserved as legitimate
  assert.equal(normalizeLessonIdentity('整本书阅读 《简·爱》'), '整本书阅读简·爱');
  // Middle dot in poem titles is preserved
  assert.equal(normalizeLessonIdentity('1 沁园春·雪'), '沁园春·雪');
});

test('normalizeLessonIdentity returns empty for operational / question phrases', () => {
  assert.equal(normalizeLessonIdentity('换成两课时'), '');
  assert.equal(normalizeLessonIdentity('调整为一课时'), '');
  assert.equal(normalizeLessonIdentity('调整为两课时'), '');
  assert.equal(normalizeLessonIdentity('改成三课时'), '');
  assert.equal(normalizeLessonIdentity('改为两课时'), '');
  assert.equal(normalizeLessonIdentity('这篇课文怎么备课'), '');
  assert.equal(normalizeLessonIdentity('这篇课文怎么教'), '');
  assert.equal(normalizeLessonIdentity('这个难点怎么处理'), '');
  assert.equal(normalizeLessonIdentity('如何设计课堂活动'), '');
  assert.equal(normalizeLessonIdentity('怎样安排教学环节'), '');
  // Legitimate lesson titles still match
  assert.equal(normalizeLessonIdentity('就英法联军远征中国致巴特勒上尉的信'), '就英法联军远征中国致巴特勒上尉的信');
  assert.equal(normalizeLessonIdentity('沁园春·雪'), '沁园春·雪');
  assert.equal(normalizeLessonIdentity('岳阳楼记'), '岳阳楼记');
  assert.equal(normalizeLessonIdentity('单元说明'), '单元说明');
});

test('findTreeNodeByNormalizedTitle finds matching lesson in a tree', () => {
  // teacher-guide "5 你是人间的四月天" at page 72
  const match = findTreeNodeByNormalizedTitle(teacherGuideTree, normalizeLessonIdentity('5 你是人间的四月天'));
  assert.ok(match);
  assert.equal(match.startPage, 72);
  assert.equal(match.title, '5 你是人间的四月天');

  // textbook "5 你是人间的四月天" at page 16
  const match2 = findTreeNodeByNormalizedTitle(textbookTree, normalizeLessonIdentity('5 你是人间的四月天'));
  assert.ok(match2);
  assert.equal(match2.startPage, 16);
  assert.equal(match2.title, '5 你是人间的四月天');

  // Non-existent title returns null
  assert.equal(findTreeNodeByNormalizedTitle(teacherGuideTree, '不存在'), null);
  assert.equal(findTreeNodeByNormalizedTitle([], 'test'), null);
  assert.equal(findTreeNodeByNormalizedTitle(null, 'test'), null);
});

test('resolveCrossDocTarget: teacher-guide 四月天 page 72 → textbook page 16', () => {
  const treesCache = { textbook: textbookTree, 'teacher-guide': teacherGuideTree };
  const docs = [
    { id: 'textbook', pageCount: 200 },
    { id: 'teacher-guide', pageCount: 650 }
  ];
  const result = resolveCrossDocTarget({
    targetDocId: 'textbook',
    lessonTitle: '5 你是人间的四月天',
    pageNo: 72,
    treesCache,
    docs
  });
  assert.equal(result.page, 16, '四月天 in textbook starts at page 16');
  assert.equal(result.nodeId, 'textbook-u1-n6');
  assert.equal(result.lessonTitle, '5 你是人间的四月天');
});

test('resolveCrossDocTarget: teacher-guide 巴特勒信 page 429 → textbook page 124', () => {
  const treesCache = { textbook: textbookTree, 'teacher-guide': teacherGuideTree };
  const docs = [
    { id: 'textbook', pageCount: 200 },
    { id: 'teacher-guide', pageCount: 650 }
  ];
  const result = resolveCrossDocTarget({
    targetDocId: 'textbook',
    lessonTitle: '21 就英法联军远征中国致巴特勒上尉的信',
    pageNo: 429,
    treesCache,
    docs
  });
  assert.equal(result.page, 124, '巴特勒信 in textbook starts at page 124');
  assert.equal(result.nodeId, 'textbook-u5-n3');
  assert.equal(result.lessonTitle, '21 就英法联军远征中国致巴特勒上尉的信');
});

test('resolveCrossDocTarget: textbook 四月天 page 16 → teacher-guide page 72', () => {
  const treesCache = { textbook: textbookTree, 'teacher-guide': teacherGuideTree };
  const docs = [
    { id: 'textbook', pageCount: 200 },
    { id: 'teacher-guide', pageCount: 650 }
  ];
  const result = resolveCrossDocTarget({
    targetDocId: 'teacher-guide',
    lessonTitle: '5 你是人间的四月天',
    pageNo: 16,
    treesCache,
    docs
  });
  assert.equal(result.page, 72, '四月天 in teacher-guide starts at page 72');
  assert.equal(result.nodeId, 'teacher-guide-u1-n7');
  assert.equal(result.lessonTitle, '5 你是人间的四月天');
});

test('resolveCrossDocTarget: textbook 巴特勒信 page 124 → teacher-guide page 429', () => {
  const treesCache = { textbook: textbookTree, 'teacher-guide': teacherGuideTree };
  const docs = [
    { id: 'textbook', pageCount: 200 },
    { id: 'teacher-guide', pageCount: 650 }
  ];
  const result = resolveCrossDocTarget({
    targetDocId: 'teacher-guide',
    lessonTitle: '21 就英法联军远征中国致巴特勒上尉的信',
    pageNo: 124,
    treesCache,
    docs
  });
  assert.equal(result.page, 429, '巴特勒信 in teacher-guide starts at page 429');
  assert.equal(result.nodeId, 'teacher-guide-u5-n4');
  assert.equal(result.lessonTitle, '21 就英法联军远征中国致巴特勒上尉的信');
});

test('resolveCrossDocTarget: without lesson title keeps clamped page', () => {
  const treesCache = { textbook: textbookTree, 'teacher-guide': teacherGuideTree };
  const docs = [
    { id: 'textbook', pageCount: 200 },
    { id: 'teacher-guide', pageCount: 650 }
  ];
  // No lesson title → keep current page (clamped to target pageCount)
  const result = resolveCrossDocTarget({
    targetDocId: 'textbook',
    lessonTitle: '',
    pageNo: 999,
    treesCache,
    docs
  });
  assert.equal(result.page, 200, 'clamped to textbook pageCount');
  assert.equal(result.nodeId, '');
  assert.equal(result.lessonTitle, '');
});

test('resolveCrossDocTarget: lesson not found in target tree keeps clamped page', () => {
  const treesCache = { textbook: textbookTree };
  const docs = [
    { id: 'textbook', pageCount: 200 }
  ];
  // "单元说明" exists in the tree but is not a lesson; test with a truly
  // non-matching title to verify the fallback.
  const result = resolveCrossDocTarget({
    targetDocId: 'textbook',
    lessonTitle: '不存在的篇目',
    pageNo: 50,
    treesCache,
    docs
  });
  assert.equal(result.page, 50, 'keeps the original page when no match found');
  assert.equal(result.nodeId, '');
  assert.equal(result.lessonTitle, '不存在的篇目');
});

test('resolveCrossDocTarget: without tree cache falls back to clamped page', () => {
  const docs = [
    { id: 'textbook', pageCount: 200 }
  ];
  // No cache yet → fall back to clamped page but keep the lesson title
  const result = resolveCrossDocTarget({
    targetDocId: 'textbook',
    lessonTitle: '5 你是人间的四月天',
    pageNo: 72,
    treesCache: {},
    docs
  });
  assert.equal(result.page, 72, 'fallback to clamped page');
  assert.equal(result.lessonTitle, '5 你是人间的四月天');
});

test('async loading contract: caller must ensure tree before resolveCrossDocTarget', async () => {
  // Simulate the real UI flow: first call without cache falls back, then
  // after the tree is loaded the correct page is resolved.
  const docs = [
    { id: 'textbook', pageCount: 200 },
    { id: 'teacher-guide', pageCount: 650 }
  ];
  const treesCache = {};

  // Phase 1 — tree NOT cached: fallback to clamped physical page
  const before = resolveCrossDocTarget({
    targetDocId: 'textbook',
    lessonTitle: '5 你是人间的四月天',
    pageNo: 72,
    treesCache,
    docs
  });
  assert.equal(before.page, 72, 'uncached tree falls back to clamped page');
  assert.equal(before.nodeId, '', 'uncached tree returns empty nodeId');

  // Phase 2 — caller loads the tree (simulated async load)
  const loaded = await Promise.resolve().then(() => textbookTree);
  treesCache.textbook = loaded;

  // Phase 3 — tree IS cached: correct page from target tree
  const after = resolveCrossDocTarget({
    targetDocId: 'textbook',
    lessonTitle: '5 你是人间的四月天',
    pageNo: 72,
    treesCache,
    docs
  });
  assert.equal(after.page, 16, 'cached tree resolves to correct start page');
  assert.equal(after.nodeId, 'textbook-u1-n6', 'cached tree returns target nodeId');
  assert.equal(after.lessonTitle, '5 你是人间的四月天', 'cached tree preserves lesson title');
});
