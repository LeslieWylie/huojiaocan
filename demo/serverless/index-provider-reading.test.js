import test from 'node:test';
import assert from 'node:assert/strict';
import { PageIndexProvider, normalizeSearchResult } from './index-provider.js';

const lessonIdentity = { title: '《岳阳楼记》' };
const tree = { id: 'python-root', title: '目录', level: 0, startPdfPage: 1, endPdfPage: 400, sectionPath: [], children: [
  { id: 'python-node', title: '11 岳阳楼记', level: 1, startPdfPage: 224, endPdfPage: 238, sectionPath: ['11 岳阳楼记'], children: [] }
] };

test('PageIndex reading uses existing HTTP tree/page APIs and returns unified full pages', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).endsWith('/tree')) return Response.json(tree);
    const pdfPageNumber = Number(String(url).split('/').at(-1));
    return Response.json({ documentId: 'teacher-guide', page: {
      pdfPageNumber, printedPage: '服务端印刷页', pageTitle: '服务端当前篇标题', sectionPath: ['服务端路径', '岳阳楼记'],
      retrievalText: `真实原页${pdfPageNumber} ${'教学重点'.repeat(1000)}`, textSource: 'ocr', qualityStatus: 'normal', includeInIndex: true
    }, viewer: { page: pdfPageNumber } });
  });
  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const context = provider.createReadingContext({ scope: ['teacher-guide'], lessonIdentity, evidence: [{ documentId: 'teacher-guide', pdfPage: 227 }] });
  const [section] = await context.listSections();
  assert.equal(section.documentType, 'teacher_guide');
  const pages = await context.readSection(section.sectionRef);
  assert.equal(pages.length, 2, 'real SelectedPage shape must not silently empty all reads');
  assert.deepEqual(calls.map(call => call.url), [
    'https://pageindex.test/internal/v1/indexes/teacher-guide/tree',
    'https://pageindex.test/internal/v1/indexes/teacher-guide/pages/227',
    'https://pageindex.test/internal/v1/indexes/teacher-guide/pages/228'
  ]);
  assert.ok(calls.every(call => call.method === 'GET'));
  for (const result of pages) {
    for (const key of ['documentId', 'documentTitle', 'documentType', 'pdfPage', 'sectionPath', 'text', 'textSource', 'qualityStatus', 'viewer']) assert.ok(Object.hasOwn(result, key), key);
    assert.equal(result.title, '服务端当前篇标题');
    assert.deepEqual(result.sectionPath, ['服务端路径', '岳阳楼记']);
    assert.equal(result.nodeId, 'python-node');
    assert.equal(result.printedPage, '服务端印刷页');
    assert.equal(result.text.length > 4000, true);
    assert.equal(result.quote, result.text);
    assert.equal(result.viewer.page, result.pdfPage);
    assert.equal(result.pageNumber, result.pdfPage);
    assert.equal(result.readMode, 'full_page');
    assert.equal(normalizeSearchResult(result).readMode, 'full_page');
  }
});

test('explicit empty/missing scope never expands to public documents; aliases are preserved', async () => {
  const provider = new PageIndexProvider();
  const calls = [];
  provider.getTree = async id => { calls.push(id); return tree; };
  for (const scope of [undefined, null, '', [], ['']]) {
    assert.deepEqual(await provider.createReadingContext({ scope, lessonIdentity }).listSections(), []);
  }
  assert.deepEqual(calls, []);
  const sections = await provider.createReadingContext({ scope: 'guide', lessonIdentity }).listSections();
  assert.equal(sections[0].documentType, 'teacher_guide');
  assert.deepEqual(calls, ['teacher-guide']);
});

test('private tree/page failures and empty text never invoke runtime/snapshot fallback', async () => {
  for (const failure of ['tree', 'page', 'empty']) {
    const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
    let fallbackCalls = 0;
    provider.stableFallback = async () => { fallbackCalls += 1; throw new Error('must not be used'); };
    provider.getTree = async id => { assert.equal(id, 'private-current'); if (failure === 'tree') throw new Error('offline'); return tree; };
    provider.getPage = async (id, pdfPageNumber) => { if (failure === 'page') throw new Error('offline'); return { documentId: id, page: { pdfPageNumber, retrievalText: '' } }; };
    const context = provider.createReadingContext({ scope: ['private-current'], lessonIdentity });
    const sections = await context.listSections();
    if (sections.length) assert.deepEqual(await context.readSection(sections[0].sectionRef), []);
    assert.equal(fallbackCalls, 0);
  }
});

test('ask creates the lazy reading context from input scope, not an expanded provider response', async () => {
  const provider = new PageIndexProvider();
  let options;
  provider.retrieve = async () => ({ scope: ['private-current', 'not-authorized'], results: [] });
  provider.createReadingContext = input => { options = input; return { listSections: async () => [], readSection: async () => [] }; };
  await provider.ask({ question: '教学重点', scope: ['private-current'], lessonIdentity, deadlineAt: Date.now() - 1 });
  assert.deepEqual(options.scope, ['private-current']);
  assert.deepEqual(options.lessonIdentity, lessonIdentity);
  assert.deepEqual(options.evidence, []);
  assert.match(options.query, /岳阳楼记/);
});

test('expired provider reads do not start HTTP; active reads abort at their request deadline', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  let calls = 0;
  let aborted = false;
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); }, { once: true });
    });
  });
  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test', timeoutMs: 30000 });
  await assert.rejects(provider.getTree('private-current', { deadlineAt: Date.now() - 1 }), /pageindex_timeout/);
  assert.equal(calls, 0);
  const reading = provider.getPage('private-current', 224, { deadlineAt: Date.now() + 30 });
  t.mock.timers.tick(30);
  await assert.rejects(reading, /pageindex_timeout/);
  assert.equal(calls, 1);
  assert.equal(aborted, true);
});

test('source-specific retrieveMore intersects the original scope and never falls back from empty', async () => {
  const provider = new PageIndexProvider();
  const calls = [];
  provider.retrieve = async input => {
    calls.push(input);
    return { results: [
      { documentId: 'curriculum-standard', pdfPage: 33 },
      { documentId: 'private-current', pdfPage: 3 },
      { documentId: 'not-authorized', pdfPage: 1 }
    ] };
  };
  const result = await provider.retrieveMore({ query: '课程要求', scope: ['textbook', 'curriculum-standard'], sourceType: 'curriculum_standard' });
  assert.deepEqual(calls[0].scope, ['curriculum-standard']);
  assert.deepEqual(result.map(item => item.documentId), ['curriculum-standard']);
  for (const scope of [[], ['textbook'], ['private-current']]) {
    assert.deepEqual(await provider.retrieveMore({ query: '课程要求', scope, sourceType: 'curriculum_standard' }), []);
  }
  assert.equal(calls.length, 1);
  const privateResult = await provider.retrieveMore({ query: '教学建议', scope: ['textbook', 'private-current'], sourceType: 'teacher_guide', evidence: [{ documentId: 'private-current', documentType: 'teacher_guide' }] });
  assert.deepEqual(calls[1].scope, ['private-current']);
  assert.deepEqual(privateResult.map(item => item.documentId), ['private-current']);
});
