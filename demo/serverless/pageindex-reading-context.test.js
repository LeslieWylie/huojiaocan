import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReadingContext } from './pageindex-reading-context.js';

const lessonIdentity = { title: '《岳阳楼记》' };
const lesson = () => ({ id: 'server-node', title: '10 岳阳楼记', summary: '服务端目录摘要', startPdfPage: 56, endPdfPage: 61, children: [
  { id: 'detail', title: '教学重点', summary: '迁客骚人与古仁人', startPdfPage: 57, endPdfPage: 59, children: [] }
] });
function pageResponse(documentId, pdfPageNumber) {
  return { documentId, page: { pdfPageNumber, printedPage: '48', pageTitle: '岳阳楼记', sectionPath: ['第三单元', '10 岳阳楼记'], retrievalText: `物理页${pdfPageNumber}的完整原文。${'原页内容'.repeat(1000)}`, textSource: 'native', qualityStatus: 'normal', includeInIndex: true }, viewer: { page: pdfPageNumber } };
}
function setup(options = {}, overrides = {}) {
  const calls = { trees: [], pages: [] };
  const provider = {
    id: 'pageindex',
    async getTree(id) { calls.trees.push(id); return overrides.tree ? overrides.tree(id) : { id: 'root', title: '语文', startPdfPage: 1, endPdfPage: 100, children: [lesson(), { title: '醉翁亭记', startPdfPage: 62, endPdfPage: 65 }] }; },
    async getPage(id, page) { calls.pages.push([id, page]); return overrides.page ? overrides.page(id, page) : pageResponse(id, page); }
  };
  const context = createReadingContext({ provider, scope: ['textbook'], lessonIdentity, ...options });
  return { calls, context };
}

test('real PageResponse envelope produces full text, physical identity and readMode', async () => {
  const { context, calls } = setup({ evidence: [{ documentId: 'textbook', pdfPage: 59 }] });
  assert.deepEqual(calls.trees, []);
  const [candidate] = await context.listSections();
  assert.deepEqual(Object.keys(candidate).sort(), ['documentType', 'pageEnd', 'pageStart', 'sectionRef', 'summary', 'title'].sort());
  assert.equal(candidate.documentType, 'textbook');
  assert.equal(candidate.summary, '服务端目录摘要');
  assert.equal(candidate.pageStart, 56);
  const pages = await context.readSection(candidate.sectionRef);
  assert.deepEqual(calls.pages, [['textbook', 59], ['textbook', 60]]);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].text, pageResponse('textbook', 59).page.retrievalText);
  assert.equal(pages[0].quote, pages[0].text);
  assert.equal(pages[0].pdfPage, 59);
  assert.equal(pages[0].printedPage, '48');
  assert.equal(pages[0].readMode, 'full_page');
  assert.equal(pages[0].providerMetadata.readingContext, true);
});

for (const [name, wrap] of Object.entries({ array: node => [node], rootObject: node => ({ title: '目录', children: [node] }), tree: node => ({ tree: [node] }), root: node => ({ root: node }), node: node => ({ node }), nested: node => ({ tree: { root: { node } } }), vendor: node => ({ structure: [{ title: '书', nodes: [node] }] }) })) {
  test(`directory shape: ${name}`, async () => {
    const { context } = setup({}, { tree: () => wrap(lesson()) });
    assert.equal((await context.listSections()).length, 2);
  });
}

for (const [start, end] of [['startPage', 'endPage'], ['startPdfPage', 'endPdfPage'], ['start_pdf_page', 'end_pdf_page'], ['pageStart', 'pageEnd'], ['page_start', 'page_end'], ['start_page', 'end_page'], ['start_index', 'end_index']]) {
  test(`physical range aliases: ${start}/${end}`, async () => {
    const { context } = setup({}, { tree: () => ({ node_id: 'opaque-server-id', name: '第十课 岳阳楼记', description: '原始摘要', [start]: '56', [end]: '57' }) });
    const [section] = await context.listSections();
    assert.equal(section.pageStart, 56);
    assert.equal(section.pageEnd, 57);
    assert.equal((await context.readSection(section.sectionRef)).length, 2);
  });
}

test('bundled real textbook and teacher guide tree shapes match only this lesson', async () => {
  const { context } = setup({ scope: ['textbook', 'teacher-guide'] }, {
    tree: id => JSON.parse(fs.readFileSync(new URL(`../data/index/${id}-tree.json`, import.meta.url)))
  });
  const sections = await context.listSections();
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map(section => section.documentType), ['textbook', 'teacher_guide']);
  assert.ok(sections.every(section => section.title.includes('岳阳楼记')));
  assert.deepEqual(sections.map(section => section.pageStart), [56, 224]);
});

test('fixed scope, lesson and hit snapshot; candidate mutation cannot widen a read', async () => {
  const scope = ['private-current'];
  const identity = { ...lessonIdentity };
  const evidence = [{ documentId: 'private-current', pdfPage: 61, documentType: 'teacher_guide' }];
  const { context, calls } = setup({ scope, lessonIdentity: identity, evidence });
  scope.push('other-owner'); identity.title = '醉翁亭记'; evidence[0].pdfPage = 62;
  const sections = await context.listSections();
  sections[0].pageEnd = 999; sections[0].title = '醉翁亭记';
  const original = await context.listSections();
  assert.equal(original[0].pageEnd, 61);
  assert.equal(original[0].documentType, 'teacher_guide');
  await context.readSection(sections[0].sectionRef);
  assert.deepEqual(calls.trees, ['private-current']);
  assert.deepEqual(calls.pages, [['private-current', 61], ['private-current', 60]]);
});

test('unknown, structured and cross-request refs never fetch pages or trees', async () => {
  const a = setup(); const b = setup();
  assert.deepEqual(await a.context.readSection({ documentId: 'textbook', page: 56 }), []);
  assert.deepEqual(await a.context.readSection('textbook:56'), []);
  assert.deepEqual(a.calls.trees, []);
  const [section] = await a.context.listSections();
  await b.context.listSections();
  assert.deepEqual(await b.context.readSection(section.sectionRef), []);
  assert.deepEqual(b.calls.pages, []);
});

test('cross-lesson, ambiguous, missing-range and wrong-document trees fail closed', async () => {
  for (const tree of [
    { title: '醉翁亭记', startPage: 56, endPage: 61, summary: '岳阳楼记' },
    { ...lesson(), title: '岳阳楼记与醉翁亭记比较' },
    [lesson(), { ...lesson(), startPdfPage: 80, endPdfPage: 85 }],
    { ...lesson(), endPdfPage: undefined },
    { ...lesson(), document_id: 'not-in-scope' },
    { documentId: 'not-in-scope', tree: [lesson()] },
    { ...lesson(), startPage: 1 }
  ]) {
    const { context, calls } = setup({ query: '岳阳楼记', evidence: [{ documentId: 'textbook', pdfPage: 56, title: '岳阳楼记' }] }, { tree: () => tree });
    assert.deepEqual(await context.listSections(), []);
    assert.deepEqual(calls.pages, []);
  }
});

test('child reads cannot cross lesson bounds or enter separately numbered lessons', async () => {
  const { context, calls } = setup({}, { tree: () => ({ ...lesson(), children: [
    { title: '合法小节', startPage: 60, endPage: 61 },
    { title: '越界小节', startPage: 61, endPage: 62 },
    { title: '11 醉翁亭记', startPage: 60, endPage: 61 }
  ] }) });
  const sections = await context.listSections();
  assert.deepEqual(sections.map(section => section.title), ['10 岳阳楼记', '合法小节']);
  await context.readSection(sections[1].sectionRef);
  assert.deepEqual(calls.pages.map(([, page]) => page), [60, 61]);
});

for (const key of ['pdfPageNumber', 'pdf_page_number', 'pdfPage', 'pdf_page', 'pageNumber', 'page_number', 'page']) {
  test(`page aliases: ${key}`, async () => {
    const { context } = setup({}, { page: (id, number) => ({ document_id: id, page: { [key]: String(number), retrieval_text: '服务端原文', quality_status: 'normal' } }) });
    const [section] = await context.listSections();
    assert.equal((await context.readSection(section.sectionRef)).length, 2);
  });
}

test('flat page payload and inner-only document identity are accepted', async () => {
  for (const wrap of [page => page, page => ({ page })]) {
    const { context } = setup({}, { page: (id, number) => wrap({ documentId: id, pdfPage: number, text: '实际原文' }) });
    const [section] = await context.listSections();
    assert.equal((await context.readSection(section.sectionRef)).length, 2);
  }
});

test('reject missing/conflicting document IDs, physical pages, viewer pages and absent text', async () => {
  const invalid = [
    (id, n) => ({ ...pageResponse(id, n), documentId: 'other-owner' }),
    (id, n) => ({ ...pageResponse(id, n), document_id: 'other-owner' }),
    (id, n) => ({ ...pageResponse(id, n), page: { ...pageResponse(id, n).page, documentId: 'other-owner' } }),
    (id, n) => ({ ...pageResponse(id, n), documentId: undefined }),
    (id, n) => pageResponse(id, n + 1),
    (id, n) => ({ ...pageResponse(id, n), pdfPage: n + 1 }),
    (id, n) => ({ ...pageResponse(id, n), page: { ...pageResponse(id, n).page, pageNumber: n + 1 } }),
    (id, n) => ({ ...pageResponse(id, n), page: { ...pageResponse(id, n).page, pdfPageNumber: undefined, printedPage: n } }),
    (id, n) => ({ ...pageResponse(id, n), viewer: { page: n + 1 } }),
    (id, n) => ({ documentId: id, pdfPage: n, quote: '片段不是原页' }),
    (id, n) => ({ documentId: id, pdfPage: n, text: '失败原文', qualityStatus: 'failed' }),
    (id, n) => ({ documentId: id, pdfPage: n, text: '未收录', includeInIndex: false })
  ];
  for (const page of invalid) {
    const { context, calls } = setup({}, { page });
    const [section] = await context.listSections();
    assert.deepEqual(await context.readSection(section.sectionRef), []);
    assert.equal(calls.pages.length, 2);
  }
});

test('four-attempt budget is shared by sections/documents/concurrent reads, and failures count', async () => {
  for (const fail of [false, true]) {
    const { context, calls } = setup({ scope: ['textbook', 'private-current'] }, { page: async (id, n) => { await Promise.resolve(); if (fail) throw new Error('unavailable'); return pageResponse(id, n); } });
    const sections = await context.listSections();
    const results = await Promise.all(sections.flatMap(section => [context.readSection(section.sectionRef), context.readSection(section.sectionRef)]));
    assert.equal(calls.pages.length, 4);
    assert.equal(new Set(calls.pages.map(call => JSON.stringify(call))).size, 4);
    assert.ok(results.every(result => result.length <= 2));
    assert.deepEqual(await context.readSection(sections[0].sectionRef), []);
  }
});

test('no scope/identity/match makes no page reads; private failure cannot use snapshots', async () => {
  for (const options of [{ scope: [] }, { lessonIdentity: null }, { lessonIdentity: { title: '未收录篇目' } }]) {
    const { context, calls } = setup(options);
    assert.deepEqual(await context.listSections(), []);
    assert.deepEqual(calls.pages, []);
  }
  const { context, calls } = setup({ scope: ['private-current'] }, { tree: () => { throw new Error('unavailable'); } });
  assert.deepEqual(await context.listSections(), []);
  assert.deepEqual(calls.trees, ['private-current']);
  assert.deepEqual(calls.pages, []);
});

test('expired and in-flight deadlines stop discovery and original-page reads', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const expired = setup({ deadlineAt: Date.now() - 1 });
  assert.deepEqual(await expired.context.listSections(), []);
  assert.deepEqual(expired.calls.trees, []);
  const stuck = setup({ deadlineAt: Date.now() + 30 }, { tree: () => new Promise(() => {}) });
  const listing = stuck.context.listSections();
  await Promise.resolve();
  t.mock.timers.tick(30);
  assert.deepEqual(await listing, []);
  const page = setup({ deadlineAt: Date.now() + 30 }, { page: () => new Promise(() => {}) });
  const [section] = await page.context.listSections();
  const reading = page.context.readSection(section.sectionRef);
  await Promise.resolve();
  t.mock.timers.tick(30);
  assert.deepEqual(await reading, []);
  assert.equal(page.calls.pages.length, 1);
});

test('shared deadline is thirty seconds; individual trees/pages receive at most four seconds', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const deadlines = [];
  const provider = {
    async getTree(_id, { deadlineAt }) { deadlines.push(deadlineAt); return lesson(); },
    async getPage(id, n, { deadlineAt }) { deadlines.push(deadlineAt); return pageResponse(id, n); }
  };
  const context = createReadingContext({ provider, scope: ['textbook'], lessonIdentity, deadlineAt: Date.now() + 60000 });
  const [section] = await context.listSections();
  t.mock.timers.tick(1000);
  await context.readSection(section.sectionRef);
  assert.deepEqual(deadlines, [104000, 105000, 105000]);
  t.mock.timers.tick(29000);
  assert.deepEqual(await context.listSections(), []);
  assert.deepEqual(await context.readSection(section.sectionRef), []);
});

test('a slow tree only spends four seconds; another document can still be read after model thinking', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const calls = [];
  const provider = {
    async getTree(id, { deadlineAt }) {
      calls.push([id, deadlineAt]);
      return id === 'slow-private' ? new Promise(() => {}) : lesson();
    },
    async getPage(id, page, { deadlineAt }) { calls.push([page, deadlineAt]); return pageResponse(id, page); }
  };
  const context = createReadingContext({ provider, scope: ['slow-private', 'textbook'], lessonIdentity, deadlineAt: 128000 });
  const listing = context.listSections();
  await Promise.resolve();
  t.mock.timers.tick(4000);
  const [section] = await listing;
  assert.deepEqual(calls, [['slow-private', 104000], ['textbook', 108000]]);
  t.mock.timers.tick(22000); // Reading begins after 26s, with 2s left in the caller's deadline.
  assert.equal((await context.readSection(section.sectionRef)).length, 2);
  assert.deepEqual(calls.slice(2), [[56, 128000], [57, 128000]]);
});

test('parallel listings fetch each tree once and return independent candidate objects', async () => {
  const { context, calls } = setup();
  const [first, second] = await Promise.all([context.listSections(), context.listSections()]);
  assert.deepEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.equal(calls.trees.length, 1);
});
