import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalFullTextIndexProvider, PageIndexProvider, getIndexProvider } from './index-provider.js';

const secret = 'test-secret-never-return';

function assertUnifiedResult(result) {
  for (const key of ['documentId', 'documentTitle', 'documentType', 'pdfPage', 'sectionPath', 'text', 'textSource', 'qualityStatus', 'viewer']) {
    assert.ok(Object.hasOwn(result, key), `missing ${key}`);
  }
  assert.equal(result.pageNumber, result.pdfPage);
  assert.equal(result.quote, result.text);
  assert.equal(result.pdfUrl, result.viewer.pdfUrl);
  assert.equal(result.viewer.page, result.pdfPage);
}

test('local search returns unified SearchResult plus V1.1 aliases', async () => {
  const provider = new LocalFullTextIndexProvider();
  const response = await provider.search({ query: '我爱这土地', limit: 4 });
  assert.ok(response.results.length > 0);
  for (const result of response.results) assertUnifiedResult(result);
});

test('local curriculum-standard search returns the verified physical PDF page', async () => {
  const provider = new LocalFullTextIndexProvider();
  const response = await provider.search({ query: '文学阅读与创意表达', scope: ['curriculum-standard'], limit: 4 });
  assert.ok(response.results.length > 0);
  assert.equal(response.results[0].documentId, 'curriculum-standard');
  assert.equal(response.results[0].documentType, 'curriculum_standard');
  assert.equal(response.results[0].pdfPage, 33);
  assert.match(response.results[0].viewer.pdfUrl, /#page=33$/u);
});

test('local retrieve keeps physical PDF page and viewer target', async () => {
  const provider = new LocalFullTextIndexProvider();
  const response = await provider.retrieve({ query: '我爱这土地', limit: 3 });
  assert.equal(response.evidenceSufficient, true);
  assert.ok(response.results.length > 0);
  for (const result of response.results) {
    assert.ok(Number.isInteger(result.pdfPage));
    assert.ok(result.pdfPage > 0);
    assert.equal(result.viewer.page, result.pdfPage);
    assert.match(result.viewer.pdfUrl, /#page=\d+$/);
  }
});

test('local retrieval accepts exact and meaningful Chinese evidence coverage', async () => {
  const provider = new LocalFullTextIndexProvider();
  const exact = await provider.retrieve({ query: '我爱这土地', limit: 3 });
  assert.equal(exact.evidenceSufficient, true);
  assert.ok(exact.results.some(result => `${result.title}${result.text}`.includes('我爱这土地')));

  const natural = await provider.retrieve({ query: '我爱这土地朗读处理建议', limit: 8 });
  assert.equal(natural.evidenceSufficient, true);
  assert.ok(natural.results.length > 0);
});

test('local retrieval normalizes title punctuation and keeps the requested lesson first', async () => {
  const provider = new LocalFullTextIndexProvider();
  const retrieved = await provider.retrieve({
    query: '讲一下沁园春雪应该怎么备课',
    scope: ['textbook', 'teacher-guide'],
    limit: 6
  });
  assert.equal(retrieved.evidenceSufficient, true);
  assert.ok(retrieved.results.length > 0);
  assert.equal(retrieved.results[0].title, '1 沁园春·雪');
  assert.match(retrieved.results[0].sectionPath.join(' › '), /沁园春·雪/);
  assert.ok(retrieved.results.every(result => /沁园春·雪/.test(result.title) || /沁园春·雪/.test(result.sectionPath.join(' › '))));
});

test('author search resolves to the concrete lesson instead of a broad reference page', async () => {
  const provider = new LocalFullTextIndexProvider();
  const response = await provider.search({
    query: '范仲淹',
    scope: ['textbook', 'teacher-guide'],
    limit: 6
  });
  assert.ok(response.results.length > 0);
  assert.ok(response.results.some(result => result.documentId === 'textbook' && result.pdfPage === 56));
  assert.ok(response.results.every(result => /岳阳楼记/.test(`${result.title}${result.sectionPath.join(' ')}`)));
});

test('lesson search prefers the teacher-guide teaching treatment over a neighboring reference page', async () => {
  const provider = new LocalFullTextIndexProvider();
  const response = await provider.search({ query: '岳阳楼记', scope: ['teacher-guide'], limit: 6 });
  assert.ok(response.results.length > 0);
  assert.equal(response.results[0].pdfPage, 224);
  assert.match(response.results[0].text, /教学重点/);
});

test('local retrieve and ask block generation when there is no evidence', async () => {
  const provider = new LocalFullTextIndexProvider();
  const query = '完全不存在的词组XYZ987654321';
  const retrieved = await provider.retrieve({ query });
  assert.equal(retrieved.evidenceSufficient, false);
  assert.deepEqual(retrieved.results, []);
  const answer = await provider.ask({ question: query });
  assert.equal(answer.evidenceSufficient, false);
  assert.equal(answer.generation, 'blocked-no-evidence');
  assert.equal(answer.route.evidenceCount, 0);
});

test('local page PATCH only accepts editable fields and preserves identity', async () => {
  const provider = new LocalFullTextIndexProvider();
  const before = (await provider.getPage('textbook', 1)).page;
  const response = await provider.updatePage('textbook', 1, {
    printedPageLabel: '测试页',
    pageTitle: '测试标题',
    includeInIndex: false,
    documentId: 'teacher-guide',
    pageNumber: 999,
    pdfPage: 999,
    providerMetadata: { leaked: true }
  });
  const page = response.page;
  assert.equal(page.documentId, before.documentId);
  assert.equal(page.pageNumber, 1);
  assert.equal(page.pdfPage, 1);
  assert.equal(page.printedPage, '测试页');
  assert.equal(page.title, '测试标题');
  assert.equal(page.includeInIndex, false);
  assert.equal(Object.hasOwn(page, 'providerMetadata') && page.providerMetadata?.leaked, undefined);

  // Restore mutable fixture state for the remaining tests.
  await provider.updatePage('textbook', 1, {
    printedPage: before.printedPage,
    title: before.title,
    includeInIndex: before.includeInIndex ?? true
  });
});

test('local page rerun creates a queryable job and rejects invalid pages', async () => {
  const provider = new LocalFullTextIndexProvider();
  const job = await provider.rerunPages('textbook', { pages: [1, 2] });
  assert.equal(job.type, 'page-rerun');
  assert.deepEqual(job.pages, [1, 2]);
  assert.deepEqual(await provider.getJob(job.jobId), job);
  await assert.rejects(provider.rerunPages('textbook', { pages: [9999] }), /page_not_found/);
});

test('local validation records real per-question hits and physical PDF pages', async () => {
  const provider = new LocalFullTextIndexProvider();
  const validation = await provider.validate('textbook', { questions: ['我爱这土地'] });
  assert.equal(validation.documentId, 'textbook');
  assert.equal(validation.providerKind, 'local');
  assert.equal(validation.questionResults.length, 1);
  assert.equal(validation.questionResults[0].passed, true);
  assert.equal(validation.questionResults[0].hit.documentId, 'textbook');
  assert.ok(validation.questionResults[0].hit.pdfPage > 0);
  assert.equal(validation.questionResults[0].hit.viewer.page, validation.questionResults[0].hit.pdfPage);
  assert.equal(validation.checks.standardQuestions.status, 'passed');
  assert.deepEqual(await provider.getValidation('textbook'), validation);
});

test('local validation fails impossible questions instead of fabricating fixture success', async () => {
  const provider = new LocalFullTextIndexProvider();
  const validation = await provider.validate('textbook', { questions: ['完全不存在的词组XYZ987654321'] });
  assert.equal(validation.status, 'partial');
  assert.equal(validation.checks.standardQuestions.passed, false);
  assert.equal(validation.checks.standardQuestions.status, 'failed');
  assert.equal(validation.questionResults[0].passed, false);
  assert.equal(validation.questionResults[0].hit, null);
});

test('local validation reports mixed question sets as partial and empty sets as not_run', async () => {
  const provider = new LocalFullTextIndexProvider();
  const mixed = await provider.validate('textbook', { questions: ['我爱这土地', '完全不存在的词组XYZ987654321'] });
  assert.equal(mixed.status, 'partial');
  assert.equal(mixed.checks.standardQuestions.passedCount, 1);
  const empty = await provider.validate('textbook', { questions: [] });
  assert.equal(empty.status, 'partial');
  assert.equal(empty.checks.standardQuestions.status, 'not_run');
  assert.equal(empty.checks.standardQuestions.passed, false);
  assert.deepEqual(empty.questionResults, []);
});

test('remote PageIndex filters invalid physical pages and builds trusted local viewer URLs', async t => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({
      total: 99,
      hits: [{
        document_id: 'textbook',
        document_title: '远程教材标题',
        document_type: 'textbook',
        pdf_page: 57,
        printed_page: '49',
        section_path: ['第一单元', '我爱这土地'],
        text: '为什么我的眼里常含泪水？因为我对这土地爱得深沉。',
        text_source: 'ocr',
        quality_status: 'normal',
        score: 0.92,
        viewer: { pdfUrl: 'https://attacker.invalid/untrusted.pdf#page=999', page: 999 }
      }, {
        document_id: 'textbook', text: 'missing page'
      }, {
        document_id: 'textbook', pdf_page: 0, text: 'zero page'
      }, {
        document_id: 'textbook', pdf_page: -3, text: 'negative page'
      }, {
        document_id: 'textbook', pdf_page: 2.5, text: 'fractional page'
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test', apiKey: secret });
  const searched = await provider.search({ query: '我爱这土地' });
  assert.equal(searched.total, 1);
  assert.equal(searched.results.length, 1);
  assert.equal(searched.results[0].pdfPage, 57);
  assert.equal(searched.results[0].viewer.page, 57);
  assert.equal(searched.results[0].viewer.pdfUrl, '/materials/九年级语文上册-学生教材.pdf#page=57');
  assert.doesNotMatch(searched.results[0].viewer.pdfUrl, /attacker/);

  const retrieved = await provider.retrieve({ query: '我爱这土地' });
  assert.equal(retrieved.evidenceSufficient, true);
  assert.equal(retrieved.results.length, 1);
  assert.equal(retrieved.results[0].score, 0.92);
  assertUnifiedResult(retrieved.results[0]);
  assert.equal(calls[0].url, 'https://pageindex.test/internal/v1/retrieve');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${secret}`);
  assert.doesNotMatch(JSON.stringify(retrieved), new RegExp(secret));
});

test('remote PageIndex accepts natural-language questions through page-text anchors', async t => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    results: [{
      documentId: 'textbook',
      pdfPage: 9,
      text: '第一单元任务一 1 沁园春·雪 毛泽东 北国风光，千里冰封，万里雪飘。',
      textSource: 'native',
      qualityStatus: 'normal',
      score: 0.91
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const retrieved = await provider.retrieve({ query: '讲一下沁园春雪应该怎么备课' });
  assert.equal(retrieved.evidenceSufficient, true);
  assert.equal(retrieved.results[0].pdfPage, 9);
  assert.equal(retrieved.results[0].viewer.page, 9);
});

test('remote public hits rebuild their preview around the query from the verified page snapshot', async t => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    results: [{
      documentId: 'teacher-guide',
      pdfPage: 224,
      text: '远程服务返回了该页开头的无关预览。',
      score: 0.9
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const response = await provider.search({
    query: '岳阳楼记 先天下之忧而忧',
    scope: ['teacher-guide'],
    limit: 2
  });
  assert.equal(response.results[0].pdfPage, 224);
  assert.match(response.results[0].text, /先天下之忧而忧/u);
  assert.doesNotMatch(response.results[0].text, /无关预览/u);
});

test('remote public hits never keep a provider-only aggregated excerpt, even without a query match; private hits stay untouched', async t => {
  const originalFetch = global.fetch;
  const aggregatedExcerpt = '这是提供方聚合生成的摘要文本，物理页原文中并不存在这句话。';
  global.fetch = async () => new Response(JSON.stringify({
    results: [
      { documentId: 'textbook', pdfPage: 9, text: aggregatedExcerpt, score: 0.5 },
      { documentId: 'private-doc-42', pdfPage: 1, text: aggregatedExcerpt, score: 0.5 }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const response = await provider.search({
    query: '完全不存在的词组ABC123456',
    scope: ['textbook', 'private-doc-42'],
    limit: 6
  });

  const publicHit = response.results.find(result => result.documentId === 'textbook');
  assert.ok(publicHit);
  assert.equal(publicHit.pdfPage, 9);
  // No local page text can substantiate this nonsense query, so the old
  // "preserve the provider excerpt" escape hatch used to let the remote-only
  // aggregation through untouched. It must now always be rebuilt from the
  // immutable local physical page instead.
  assert.doesNotMatch(publicHit.text, /提供方聚合生成的摘要/u);
  assert.equal(publicHit.text, publicHit.quote);
  assert.match(publicHit.text, /沁园春/u);

  const privateHit = response.results.find(result => result.documentId === 'private-doc-42');
  assert.ok(privateHit);
  assert.equal(privateHit.text, aggregatedExcerpt);
  assert.equal(privateHit.quote, aggregatedExcerpt);
});

test('remote PageIndex converts scalar UI scope into documentIds array', async t => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (_url, options = {}) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ results: [{ documentId: 'textbook', pdfPage: 9, text: '沁园春·雪 北国风光', score: 0.9 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  await provider.retrieve({ query: '沁园春雪怎么备课', scope: 'textbook' });
  assert.deepEqual(payload.documentIds, ['textbook']);
  assert.equal(Object.hasOwn(payload, 'scope'), false);
});

test('remote PageIndex preserves authorized arbitrary document ids and filters a scope-ignoring response', async t => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (_url, options = {}) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({
      hits: [
        { documentId: 'private-doc-42', pdfPage: 1, text: '私人教材证据', score: 0.9 },
        { documentId: 'textbook', pdfPage: 9, text: '不应返回的公共教材', score: 0.99 },
        { documentId: 'other-private', pdfPage: 2, text: '不应返回的他人材料', score: 0.98 }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const response = await provider.search({ query: '私人教材', scope: ['private-doc-42'] });
  assert.deepEqual(payload.documentIds, ['private-doc-42']);
  assert.deepEqual(response.scope, ['private-doc-42']);
  assert.deepEqual(response.results.map(item => item.documentId), ['private-doc-42']);
  assert.equal(Object.hasOwn(response, 'hits'), false);
});

test('remote PageIndex defaults missing and both scope to public documents only', async t => {
  const originalFetch = global.fetch;
  const payloads = [];
  global.fetch = async (_url, options = {}) => {
    payloads.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  await provider.retrieve({ query: '教材' });
  await provider.retrieve({ query: '教材', scope: 'both' });
  assert.deepEqual(payloads[0].documentIds, ['textbook', 'teacher-guide']);
  assert.deepEqual(payloads[1].documentIds, ['textbook', 'teacher-guide']);
});

test('all-source search keeps PageIndex primary and merges the verified curriculum snapshot', async t => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (_url, options = {}) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });
  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const response = await provider.search({ query: '文学阅读与创意表达', scope: 'all', limit: 6 });
  assert.deepEqual(payload.documentIds, ['textbook', 'teacher-guide']);
  assert.ok(response.results.some(item => item.documentId === 'curriculum-standard' && item.pdfPage === 33));
});

test('curriculum-standard-only search does not send an unsupported document id to PageIndex', async t => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return new Response('{}', { status: 200 }); };
  t.after(() => { global.fetch = originalFetch; });
  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const response = await provider.search({ query: '第四学段 阅读与鉴赏', scope: ['curriculum-standard'], limit: 4 });
  assert.equal(calls, 0);
  assert.ok(response.results.some(item => item.documentId === 'curriculum-standard' && item.pdfPage === 21));
});

test('stable snapshot refuses private or mixed document scopes', async () => {
  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  await assert.rejects(
    provider.stableFallback({ query: '私人教材', scope: ['private-doc-42'] }, 'retrieve', new Error('pageindex_timeout')),
    /pageindex_unavailable/
  );
  await assert.rejects(
    provider.ask({ question: '私人教材', scope: ['textbook', 'private-doc-42'], retrievalMode: 'stable_snapshot' }),
    /pageindex_unavailable/
  );
});

test('remote PageIndex ask sends only the retrieve contract fields', async t => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (_url, options = {}) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ results: [{ documentId: 'textbook', pdfPage: 9, text: '沁园春·雪 北国风光，千里冰封，万里雪飘。', score: 0.9 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const answer = await provider.ask({
    question: '沁园春雪怎么备课',
    scope: ['textbook'],
    limit: 6,
    userId: 'user-secret',
    keyId: 'key-secret',
    draftId: 'draft-secret',
    history: [{ role: 'user', content: '不应发送给索引服务' }],
    lessonContext: { periods: 2, classLevel: '普通' }
  });

  assert.deepEqual(Object.keys(payload).sort(), ['documentIds', 'includeReview', 'query', 'topK']);
  assert.deepEqual(payload.documentIds, ['textbook']);
  assert.equal(payload.query, '沁园春雪怎么备课');
  assert.equal(payload.topK, 6);
  assert.equal(answer.evidenceSufficient, true);
});

test('remote PageIndex follow-up retrieves with the lesson-aware lookup query', async t => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (_url, options = {}) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ results: [{ documentId: 'textbook', pdfPage: 9, text: '沁园春·雪 北国风光', score: 0.9 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const answer = await provider.ask({
    question: '为什么要这样朗读？',
    retrievalQuery: '沁园春·雪 为什么要这样朗读？',
    scope: ['textbook'],
    limit: 6
  });
  assert.equal(payload.query, '沁园春·雪 为什么要这样朗读？');
  assert.equal(answer.question, '为什么要这样朗读？');
});

test('remote PageIndex anchors a raw follow-up with the fixed lesson identity', async t => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (_url, options = {}) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ results: [{ documentId: 'textbook', pdfPage: 56, text: '岳阳楼记 课文原文', score: 0.9 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  await provider.ask({
    question: '教师用书建议先处理哪一个问题？',
    retrievalQuery: '教师用书建议先处理哪一个问题？',
    lessonIdentity: { title: '《岳阳楼记》' },
    scope: ['textbook'],
    limit: 4
  });
  assert.equal(payload.query, '《岳阳楼记》 教师用书建议先处理哪一个问题？');
});

test('remote PageIndex maps 422 to invalid request without snapshot fallback', async t => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ detail: 'unexpected field' }), { status: 422, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  await assert.rejects(
    provider.retrieve({ query: '我爱这土地', scope: ['textbook'], userId: 'must-not-leak' }),
    error => error?.message === 'pageindex_invalid_request' && error?.status === 422
  );
  assert.equal(calls, 1);
});

test('remote PageIndex lesson reranking removes directory and unrelated-unit hits', async t => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    results: [
      { documentId: 'textbook', pdfPage: 3, title: '目录', text: '目录 1 沁园春·雪 2 周总理，你在哪里', score: 0.99 },
      { documentId: 'textbook', pdfPage: 9, title: '1 沁园春·雪', text: '1 沁园春·雪 北国风光，千里冰封，万里雪飘。', score: 0.72 },
      { documentId: 'textbook', pdfPage: 162, title: '写作 学会深入思考', text: '写作 学会深入思考 如何确定观点。', score: 0.61 },
      { documentId: 'teacher-guide', pdfPage: 13, title: '目录与版权页', text: '目录 1 沁园春·雪 2 周总理，你在哪里', score: 0.98 },
      { documentId: 'teacher-guide', pdfPage: 33, title: '1 沁园春·雪', text: '1 沁园春·雪 教学设计 朗读感知，构建画面，体会意境。', score: 0.68 },
      { documentId: 'teacher-guide', pdfPage: 100, title: '任务三 尝试创作', text: '诗歌创作的教学建议。', score: 0.60 }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const retrieved = await provider.retrieve({
    query: '沁园春雪应该怎么备课',
    scope: ['textbook', 'teacher-guide'],
    limit: 6
  });
  assert.deepEqual(retrieved.results.map(result => [result.documentId, result.pdfPage]), [
    ['textbook', 9],
    ['teacher-guide', 33]
  ]);
});

test('long teaching prompts retain verified pages from both sides of a recognized lesson', async t => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    results: [
      { documentId: 'teacher-guide', pdfPage: 31, title: '1 沁园春·雪', text: '1 沁园春·雪 教学建议：抓领字，比较意象，反复诵读。', score: 0.92 }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const retrieved = await provider.retrieve({
    query: '《沁园春·雪》请围绕数风流人物还看今朝设计一课时教学并给出课堂流程和评价观察点',
    scope: ['textbook', 'teacher-guide'],
    limit: 8
  });
  assert.ok(retrieved.results.some(result => result.documentId === 'teacher-guide'));
  assert.ok(retrieved.results.some(result => result.documentId === 'textbook'), 'recognized lesson must retain its verified student-textbook page');
  assert.ok(retrieved.results.every(result => /沁园春·雪/u.test(`${result.title}${result.sectionPath.join(' ')}`)));
});

test('课文简称会优先定位教师用书教学重点和学生教材课文起始页', async t => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    results: [
      { documentId: 'teacher-guide', pdfPage: 15, title: '目录', text: '目录 21 就英法联军远征中国致巴特勒上尉的信', score: 0.99 },
      { documentId: 'textbook', pdfPage: 5, title: '目录', text: '目录 21 就英法联军远征中国致巴特勒上尉的信', score: 0.98 },
      { documentId: 'textbook', pdfPage: 127, title: '21 就英法联军远征中国致巴特勒上尉的信', text: '课后任务 巴特勒上尉', score: 0.95 },
      { documentId: 'textbook', pdfPage: 124, title: '21 就英法联军远征中国致巴特勒上尉的信', text: '21 就英法联军远征中国致巴特勒上尉的信 雨果', score: 0.7 },
      { documentId: 'teacher-guide', pdfPage: 471, title: '单元教学设计', text: '单元设计中提到巴特勒上尉', score: 0.94 }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const searched = await provider.search({
    query: '巴特勒信',
    scope: ['textbook', 'teacher-guide'],
    limit: 6
  });
  assert.deepEqual(searched.results.slice(0, 2).map(result => [result.documentId, result.pdfPage]), [
    ['teacher-guide', 429],
    ['textbook', 124]
  ]);
  assert.equal(searched.results.some(result => result.title === '目录'), false);
  assert.equal(searched.results.some(result => result.pdfPage === 471), false);
});

test('remote PageIndex excludes a neighboring teacher-guide lesson page from a broad tree node', async t => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    results: [
      { documentId: 'teacher-guide', pdfPage: 220, text: '《岳阳楼记》相关单元材料，但本页实际为《湖心亭看雪》教学参考。', score: 0.99 },
      { documentId: 'teacher-guide', pdfPage: 224, text: '11 岳阳楼记 教学重点：熟读成诵，探究先忧后乐的思想。', score: 0.8 }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test' });
  const retrieved = await provider.retrieve({
    query: '岳阳楼记教学重点',
    scope: ['teacher-guide'],
    limit: 6
  });
  assert.deepEqual(retrieved.results.map(result => result.pdfPage), [224]);
});

test('remote PageIndex exposes the document catalog instead of using health as a list', async t => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({
      status: 'ok',
      adapter: 'vendor',
      documents: [{ id: 'textbook', title: '九年级语文上册', pageCount: 168 }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test', apiKey: secret });
  const status = await provider.getStatus();
  assert.equal(status.documents[0].id, 'textbook');
  assert.equal(calls[0].url, 'https://pageindex.test/internal/v1/indexes');
});

test('PageIndex selection is fail-closed unless fallback is explicitly enabled', t => {
  const keys = ['DOCUMENT_INDEX_PROVIDER', 'PAGEINDEX_BASE_URL', 'PAGEINDEX_API_KEY', 'ALLOW_INDEX_PROVIDER_FALLBACK'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });

  process.env.DOCUMENT_INDEX_PROVIDER = 'pageindex';
  delete process.env.PAGEINDEX_BASE_URL;
  delete process.env.PAGEINDEX_API_KEY;
  delete process.env.ALLOW_INDEX_PROVIDER_FALLBACK;
  const closed = getIndexProvider();
  assert.equal(closed.provider.id, 'pageindex');
  assert.equal(closed.fallback, false);
  assert.equal(closed.reason, 'pageindex_not_configured');
  assert.equal(closed.provider.configured, false);

  process.env.ALLOW_INDEX_PROVIDER_FALLBACK = 'true';
  const allowed = getIndexProvider();
  assert.equal(allowed.provider.id, 'local-fulltext');
  assert.equal(allowed.fallback, true);
  assert.equal(allowed.reason, 'pageindex_not_configured');
});

test('remote PageIndex transient errors retry once and use the verified public snapshot', async t => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'upstream-sensitive-detail' }), { status: 500, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  const provider = new PageIndexProvider({ baseUrl: 'https://pageindex.test', apiKey: secret });
  const response = await provider.ask({ question: '我爱这土地', scope: ['textbook'] });
  assert.equal(response.retrievalMode, 'stable_snapshot');
  assert.equal(response.fallbackLabel, '已核验教材快照');
  assert.equal(response.evidenceSufficient, true);
  assert.ok(response.citations.every(item => item.viewer.page > 0));
  // The provider retries the transient upstream failure once before fallback.
  assert.equal(calls, 2);
});
