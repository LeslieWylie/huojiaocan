import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { aggregateLearningContext, classAdaptationPlanContext, confirmedDeliberationContext, confirmedHomeworkReviewContext, mergeAskHistory, ownedClassLearningContext, ownedDraftAskContext, ownedDraftTeachingContext, previousLessonCarryoverContext } from './index.js';

const envKeys = ['DOCUMENT_INDEX_PROVIDER', 'PAGEINDEX_BASE_URL', 'PAGEINDEX_API_KEY', 'PAGEINDEX_API_PREFIX', 'PAGEINDEX_TIMEOUT_MS', 'ALLOW_INDEX_PROVIDER_FALLBACK', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'INDEX_MAINTAINER_EMAILS'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const originalFetch = global.fetch;
const secret = 'api-test-secret-never-return';

test('saved and locally recovered turns are merged without losing a follow-up', () => {
  const history = mergeAskHistory(
    [
      { role: 'user', content: '怎样备课《岳阳楼记》？' },
      { role: 'assistant', content: '先核对篇目和三类材料。' }
    ],
    [
      { role: 'assistant', content: '先核对篇目和三类材料。' },
      { role: 'user', content: '那如何调整为两课时？' }
    ]
  );
  assert.deepEqual(history, [
    { role: 'user', content: '怎样备课《岳阳楼记》？' },
    { role: 'assistant', content: '先核对篇目和三类材料。' },
    { role: 'user', content: '那如何调整为两课时？' }
  ]);
});

test('confirmed teaching choices become teacher context but never textbook evidence', () => {
  const context = confirmedDeliberationContext({
    status: 'confirmed', confirmedAt: '2026-08-26T00:00:00Z',
    decisions: [{ id: 'decision-1', question: '朗读怎样进入分析？', selectedOptionId: 'option-B', options: [
      { id: 'option-A', label: '先读后析', approach: '先形成整体感受', tradeoff: '细读起步较慢', evidenceRefs: ['E1'] },
      { id: 'option-B', label: '随析随读', approach: '分析后立即朗读验证', tradeoff: '整体感受较碎', evidenceRefs: ['E2'] }
    ] }]
  });
  assert.match(context, /教师已经确认的备课取舍/u);
  assert.match(context, /随析随读/u);
  assert.match(context, /不是教材依据/u);
  assert.doesNotMatch(context, /E2/u);
});

test('one-lesson multi-class context carries the source plan but never calls it textbook evidence', () => {
  const context = classAdaptationPlanContext({
    lesson_context: { className: '九年级4班' },
    answer: {
      classAdaptation: { sourceDraftId: 'source-1', sourceClassName: '九年级3班', targetClassName: '九年级4班' },
      summary: '从阴晴两景进入迁客骚人的悲喜，再归纳古仁人之心。',
      objectives: ['比较景物与情感关系'],
      lessonPlan: [{ title: '比较阴晴两景', teacherAction: '圈画关键词，再比较情感色彩' }],
      questionChain: [{ question: '景物如何影响人物心境？' }],
      classroomRun: { moments: [{ text: '不应进入源方案骨架' }] }
    }
  });
  assert.match(context, /一课多班的源方案骨架/u);
  assert.match(context, /比较阴晴两景/u);
  assert.match(context, /只改变课堂起点、支架、节奏/u);
  assert.match(context, /不是教材依据/u);
  assert.doesNotMatch(context, /不应进入源方案骨架/u);
});

test('confirmed anonymous homework aggregate becomes next-lesson context without raw answers', () => {
  const context = confirmedHomeworkReviewContext({ summary: { task: { level: 'B', maxScore: 5 }, responseCount: 38, counts: { secure: 12, partial: 19, notYet: 7 }, averageScore: 3.1, patterns: ['关系解释不足'], nextActions: ['先用关系图复盘'], teacherNote: '先补关系再进入价值判断。' }, rawAnswers: ['不应出现'] });
  assert.match(context, /38 份匿名答案/u);
  assert.match(context, /先用关系图复盘/u);
  assert.match(context, /不是教材依据/u);
  assert.doesNotMatch(context, /不应出现/u);
});

test('unfinished classroom carryover becomes teacher context but not textbook evidence', () => {
  const context = previousLessonCarryoverContext({ items: [
    { sourceMomentId: 'm1', text: '先画意象关系图，再进入情感归纳', status: 'todo' },
    { sourceMomentId: 'm2', text: '这项已经完成', status: 'done', completedAt: '2026-08-27T09:00:00Z' }
  ] });
  assert.match(context, /先画意象关系图/u);
  assert.match(context, /不是教材依据/u);
  assert.doesNotMatch(context, /这项已经完成/u);
});

test('stored aggregate learning context excludes raw student work and is owner-scoped', { concurrency: false }, async () => {
  const previousFetch = global.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousAnon = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://supabase.learning.test';
  process.env.SUPABASE_ANON_KEY = 'anon-learning';
  let requestedUrl = '';
  global.fetch = async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([{ answer: { previousLessonLearningEvidence: { summary: {
      itemCount: 1, submittedCount: 39, counts: { secure: 12, partial: 20, not_yet: 7 },
      focus: [{ question: '比较意象关系', observedPattern: '能找到意象，关系说明不完整', teacherAction: '先比较再归纳' }]
    } } } }]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const context = await ownedDraftTeachingContext({ id: 'teacher-1', token: 'owner-token' }, 'draft-1');
    assert.match(context, /39 份提交/u);
    assert.match(context, /先比较再归纳/u);
    const query = new URL(requestedUrl).searchParams;
    assert.equal(query.get('user_id'), 'eq.teacher-1');
    assert.equal(query.get('id'), 'eq.draft-1');
    assert.doesNotMatch(aggregateLearningContext({ summary: { itemCount: 1, submittedCount: 1, counts: {}, focus: [] }, rawStudentWork: '不应出现' }), /不应出现/u);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousAnon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previousAnon;
  }
});

test('saved draft ask context owns lesson identity and history', { concurrency: false }, async () => {
  const previousFetch = global.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousAnon = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://supabase.learning.test';
  process.env.SUPABASE_ANON_KEY = 'anon-learning';
  global.fetch = async () => new Response(JSON.stringify([{
    id: 'draft-1', title: '我爱这土地怎么备课', question: '怎样理解土地意象？',
    lesson_context: { periods: 2, lessonRef: { title: '我爱这土地', nodeId: 'textbook-u1-n4' } },
    answer: { lesson: { title: '我爱这土地怎么备课', coreQuestion: '土地意象如何推进情感？' }, conversationHistory: [{ role: 'user', content: '先分析意象' }, { role: 'assistant', content: '先回到原文。' }] },
    citations: [], cards: []
  }]), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const context = await ownedDraftAskContext({ id: 'teacher-1', token: 'owner-token' }, 'draft-1');
    assert.equal(context.lessonIdentity.title, '《我爱这土地》');
    assert.equal(context.lessonContext.periods, 2);
    assert.deepEqual(context.history.map(item => item.role), ['user', 'assistant']);
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousAnon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previousAnon;
  }
});

test('class continuity reads only the owner rows and contains no raw student work', { concurrency: false }, async () => {
  const previousFetch = global.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousAnon = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://supabase.learning.test';
  process.env.SUPABASE_ANON_KEY = 'anon-learning';
  let requestedUrl = '';
  global.fetch = async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([
      {
        id: 'previous-lesson', title: '《岳阳楼记》', updated_at: '2026-08-27T10:00:00Z',
        lesson_context: { className: '九年级3班', classLevel: '基础扎实' },
        answer: { lessonReflection: { observedLearning: '能找到景物变化', nextLessonAdjustment: '加强情感转折的追问' }, rawStudentWork: '张三的原始答案' }
      },
      { id: 'other-class', title: '《醉翁亭记》', lesson_context: { className: '九年级4班' }, answer: { lessonReflection: { observedLearning: '另一个班的信息' } } },
      { id: 'current-draft', title: '当前课', lesson_context: { className: '九年级3班' }, answer: { lessonReflection: { observedLearning: '当前课不应回灌' } } }
    ]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const context = await ownedClassLearningContext({ id: 'teacher-1', token: 'owner-token' }, '九年级3班', 'current-draft');
    assert.match(context, /能找到景物变化/u);
    assert.match(context, /不是教材依据/u);
    assert.doesNotMatch(context, /张三|另一个班|当前课不应回灌/u);
    const query = new URL(requestedUrl).searchParams;
    assert.equal(query.get('user_id'), 'eq.teacher-1');
    assert.equal(query.get('limit'), '80');
  } finally {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousAnon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previousAnon;
  }
});

function restoreEnvironment() {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  global.fetch = originalFetch;
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    end(value = '') { this.payload = value ? JSON.parse(value) : undefined; return this; }
  };
}

async function request(path, { method = 'GET', body, headers = { authorization: 'Bearer maintainer-token' } } = {}) {
  const req = { method, url: `/api/index${path}`, indexPath: path, query: {}, body, headers };
  const res = mockResponse();
  await handler(req, res);
  return res;
}

test('index API contract', { concurrency: false }, async t => {
  t.after(restoreEnvironment);
  process.env.DOCUMENT_INDEX_PROVIDER = 'local';
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_ANON_KEY = 'anon-test-key';
  process.env.INDEX_MAINTAINER_EMAILS = 'maintainer@example.test';
  global.fetch = async url => {
    if (String(url).startsWith('https://supabase.test/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'maintainer-1', email: 'maintainer@example.test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return originalFetch(url);
  };
  delete process.env.PAGEINDEX_BASE_URL;
  delete process.env.PAGEINDEX_API_KEY;
  delete process.env.ALLOW_INDEX_PROVIDER_FALLBACK;

  await t.test('POST /retrieve returns verifiable local evidence', async () => {
    const res = await request('/retrieve', { method: 'POST', body: { query: '我爱这土地', limit: 2 } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.evidenceSufficient, true);
    assert.ok(res.payload.results.length > 0);
    for (const result of res.payload.results) {
      assert.ok(result.documentId);
      assert.ok(result.pdfPage > 0);
      assert.equal(result.viewer.page, result.pdfPage);
    }
  });

  await t.test('PATCH page preserves physical identity', async () => {
    const before = await request('/documents/textbook/pages/2');
    const res = await request('/documents/textbook/pages/2', {
      method: 'PATCH',
      body: { printedPageLabel: 'API测试页', documentId: 'teacher-guide', pageNumber: 999, pdfPage: 999 }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.page.documentId, before.payload.page.documentId);
    assert.equal(res.payload.page.pageNumber, 2);
    assert.equal(res.payload.page.pdfPage, 2);
    assert.equal(res.payload.page.printedPage, 'API测试页');
    await request('/documents/textbook/pages/2', {
      method: 'PATCH',
      body: { printedPage: before.payload.page.printedPage }
    });
  });

  await t.test('index writes require an authenticated configured maintainer', async () => {
    const anonymous = await request('/documents/textbook/pages/2', {
      method: 'PATCH',
      headers: {},
      body: { printedPageLabel: '不应写入' }
    });
    assert.equal(anonymous.statusCode, 401);
    assert.deepEqual(anonymous.payload, { ok: false, error: 'auth_required' });

    process.env.INDEX_MAINTAINER_EMAILS = 'another@example.test';
    const ordinaryTeacher = await request('/documents/textbook/validate', {
      method: 'POST',
      body: { questions: ['我爱这土地'] }
    });
    assert.equal(ordinaryTeacher.statusCode, 403);
    assert.deepEqual(ordinaryTeacher.payload, { ok: false, error: 'index_write_forbidden' });
    process.env.INDEX_MAINTAINER_EMAILS = 'maintainer@example.test';
  });

  await t.test('page rerun, validate and validation routes are operational', async () => {
    const rerun = await request('/documents/textbook/pages/rerun', { method: 'POST', body: { pages: [1, 2] } });
    assert.equal(rerun.statusCode, 202);
    assert.equal(rerun.payload.type, 'page-rerun');
    assert.ok(rerun.payload.jobId);

    const validate = await request('/documents/textbook/validate', { method: 'POST', body: { questions: ['我爱这土地'] } });
    assert.equal(validate.statusCode, 202);
    assert.equal(validate.payload.documentId, 'textbook');
    assert.equal(validate.payload.questionResults.length, 1);
    assert.equal(validate.payload.questionResults[0].passed, true);
    assert.ok(Number.isInteger(validate.payload.questionResults[0].hit.pdfPage));
    assert.ok(validate.payload.questionResults[0].hit.pdfPage > 0);
    assert.equal(validate.payload.questionResults[0].hit.viewer.page, validate.payload.questionResults[0].hit.pdfPage);

    const validation = await request('/documents/textbook/validation');
    assert.equal(validation.statusCode, 200);
    assert.equal(validation.payload.checkedAt, validate.payload.checkedAt);

    const impossible = await request('/documents/textbook/validate', { method: 'POST', body: { questions: ['完全不存在的词组XYZ987654321'] } });
    assert.equal(impossible.statusCode, 202);
    assert.equal(impossible.payload.status, 'partial');
    assert.equal(impossible.payload.questionResults[0].passed, false);
    assert.equal(impossible.payload.questionResults[0].hit, null);

    const empty = await request('/documents/textbook/validate', { method: 'POST', body: { questions: [] } });
    assert.equal(empty.statusCode, 202);
    assert.equal(empty.payload.checks.standardQuestions.status, 'not_run');
    assert.deepEqual(empty.payload.questionResults, []);
  });

  await t.test('GET validation is read-only and leaves a fresh validation as not_run', async () => {
    const first = await request('/documents/teacher-guide/validation', { headers: {} });
    const second = await request('/documents/teacher-guide/validation', { headers: {} });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.payload, {
      provider: 'local-fulltext',
      documentId: 'teacher-guide',
      status: 'not_run',
      checkedAt: null,
      checks: {}
    });
    assert.deepEqual(second.payload, first.payload);
  });

  await t.test('document catalog and page reads isolate private documents by Supabase JWT owner', async () => {
    process.env.DOCUMENT_INDEX_PROVIDER = 'pageindex';
    process.env.PAGEINDEX_BASE_URL = 'https://pageindex.test';
    process.env.PAGEINDEX_API_KEY = secret;

    global.fetch = async (url, options = {}) => {
      const target = String(url);
      const authorization = String(options.headers?.Authorization || options.headers?.authorization || '');
      if (target === 'https://supabase.test/auth/v1/user') {
        if (authorization === 'Bearer invalid-token') {
          return new Response(JSON.stringify({ error: 'invalid token' }), { status: 401, headers: { 'content-type': 'application/json' } });
        }
        const owner = authorization === 'Bearer owner-token';
        return new Response(JSON.stringify({ id: owner ? 'owner-1' : 'other-1', email: `${owner ? 'owner' : 'other'}@example.test` }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (target.startsWith('https://supabase.test/rest/v1/document_access')) {
        const rows = authorization === 'Bearer owner-token' ? [{ document_id: 'private-doc' }] : [];
        return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (target === 'https://pageindex.test/internal/v1/indexes') {
        return new Response(JSON.stringify({
          status: 'ready',
          documents: [
            { id: 'textbook', title: '公开教材', visibility: 'public' },
            { id: 'private-doc', title: '账号私有教案', visibility: 'private' }
          ]
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (target === 'https://pageindex.test/internal/v1/indexes/private-doc') {
        return new Response(JSON.stringify({ document: { id: 'private-doc', title: '账号私有教案', visibility: 'private' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (target === 'https://pageindex.test/internal/v1/indexes/textbook') {
        return new Response(JSON.stringify({ document: { id: 'textbook', title: '公开教材', visibility: 'public' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (target.endsWith('/indexes/private-doc/pages/1')) {
        return new Response(JSON.stringify({ page: { documentId: 'private-doc', pageNumber: 1, text: '私有内容' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (target.endsWith('/indexes/textbook/pages/1')) {
        return new Response(JSON.stringify({ page: { documentId: 'textbook', pageNumber: 1, text: '公开内容' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch: ${target}`);
    };

    const anonymousCatalog = await request('/documents', { headers: {} });
    assert.deepEqual(anonymousCatalog.payload.documents.map(document => document.id), ['textbook', 'teacher-guide', 'curriculum-standard']);

    const ownerCatalog = await request('/documents', { headers: { authorization: 'Bearer owner-token' } });
    assert.deepEqual(ownerCatalog.payload.documents.map(document => document.id), ['textbook', 'private-doc', 'teacher-guide', 'curriculum-standard']);

    const otherCatalog = await request('/documents', { headers: { authorization: 'Bearer other-token' } });
    assert.deepEqual(otherCatalog.payload.documents.map(document => document.id), ['textbook', 'teacher-guide', 'curriculum-standard']);

    const invalidCatalog = await request('/documents', { headers: { authorization: 'Bearer invalid-token' } });
    assert.equal(invalidCatalog.statusCode, 401);
    assert.deepEqual(invalidCatalog.payload, { ok: false, error: 'auth_invalid' });

    const anonymousPrivatePage = await request('/documents/private-doc/pages/1', { headers: {} });
    assert.equal(anonymousPrivatePage.statusCode, 404);
    assert.deepEqual(anonymousPrivatePage.payload, { ok: false, error: 'document_not_found' });

    const anonymousPrivateTree = await request('/tree/private-doc', { headers: {} });
    assert.equal(anonymousPrivateTree.statusCode, 404);
    assert.deepEqual(anonymousPrivateTree.payload, { ok: false, error: 'document_not_found' });

    const otherPrivatePage = await request('/page/private-doc/1', { headers: { authorization: 'Bearer other-token' } });
    assert.equal(otherPrivatePage.statusCode, 404);
    assert.deepEqual(otherPrivatePage.payload, { ok: false, error: 'document_not_found' });

    const invalidPrivatePage = await request('/page/private-doc/1', { headers: { authorization: 'Bearer invalid-token' } });
    assert.equal(invalidPrivatePage.statusCode, 404);
    assert.deepEqual(invalidPrivatePage.payload, { ok: false, error: 'document_not_found' });

    const ownerPrivatePage = await request('/documents/private-doc/pages/1', { headers: { authorization: 'Bearer owner-token' } });
    assert.equal(ownerPrivatePage.statusCode, 200);
    assert.equal(ownerPrivatePage.payload.page.text, '私有内容');

    const anonymousPublicPage = await request('/page/textbook/1', { headers: {} });
    assert.equal(anonymousPublicPage.statusCode, 200);
    assert.equal(anonymousPublicPage.payload.page.text, '公开内容');

    process.env.DOCUMENT_INDEX_PROVIDER = 'local';
    delete process.env.PAGEINDEX_BASE_URL;
    delete process.env.PAGEINDEX_API_KEY;
  });

  await t.test('search, retrieve and ask enforce JWT-owned document scope and filter a scope-ignoring provider', async () => {
    process.env.DOCUMENT_INDEX_PROVIDER = 'pageindex';
    process.env.PAGEINDEX_BASE_URL = 'https://pageindex.test';
    process.env.PAGEINDEX_API_KEY = secret;
    const providerPayloads = [];

    global.fetch = async (url, options = {}) => {
      const target = String(url);
      const authorization = String(options.headers?.Authorization || options.headers?.authorization || '');
      if (target === 'https://supabase.test/auth/v1/user') {
        const owner = authorization === 'Bearer owner-token';
        return new Response(JSON.stringify({ id: owner ? 'owner-1' : 'other-1', email: `${owner ? 'owner' : 'other'}@example.test` }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (target.startsWith('https://supabase.test/rest/v1/document_access')) {
        return new Response(JSON.stringify(authorization === 'Bearer owner-token' ? [{ document_id: 'private-doc' }] : []), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (target === 'https://pageindex.test/internal/v1/indexes/private-doc') {
        return new Response(JSON.stringify({ document: { id: 'private-doc', title: '账号私有教案', visibility: 'private' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (target === 'https://pageindex.test/internal/v1/retrieve') {
        const payload = JSON.parse(options.body);
        providerPayloads.push(payload);
        // Deliberately ignore documentIds to verify the application filters
        // unrequested documents after the remote response returns.
        return new Response(JSON.stringify({
          total: 3,
          hits: [
            { documentId: 'textbook', pdfPage: 9, text: '公开教材 千里冰封', score: 0.9 },
            { documentId: 'private-doc', pdfPage: 1, text: '私有备课 私人材料', score: 0.95 },
            { documentId: 'other-private', pdfPage: 1, text: '其他账号私有备课', score: 0.99 }
          ]
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch: ${target}`);
    };

    // Public provider-only snippets are not accepted as evidence. Use a phrase
    // that the immutable textbook page can substantiate after reconstruction.
    const anonymousSearch = await request('/search', { method: 'POST', headers: {}, body: { query: '千里冰封', userId: 'owner-1' } });
    assert.equal(anonymousSearch.statusCode, 200);
    assert.ok(anonymousSearch.payload.results.some(item => item.documentId === 'textbook'));
    assert.ok(anonymousSearch.payload.results.every(item => ['textbook', 'teacher-guide'].includes(item.documentId)));
    assert.deepEqual(providerPayloads.at(-1).documentIds, ['textbook', 'teacher-guide']);

    const ownerBoth = await request('/retrieve', {
      method: 'POST',
      headers: { authorization: 'Bearer owner-token' },
      body: { query: '千里冰封', scope: 'both', userId: 'other-1' }
    });
    assert.ok(ownerBoth.payload.results.some(item => item.documentId === 'textbook'));
    assert.ok(ownerBoth.payload.results.every(item => ['textbook', 'teacher-guide'].includes(item.documentId)));
    assert.deepEqual(providerPayloads.at(-1).documentIds, ['textbook', 'teacher-guide']);

    const anonymousPrivate = await request('/retrieve', { method: 'POST', headers: {}, body: { query: '私有备课', scope: ['private-doc'] } });
    assert.equal(anonymousPrivate.statusCode, 404);
    assert.deepEqual(anonymousPrivate.payload, { ok: false, error: 'document_not_found' });

    const otherPrivate = await request('/search', {
      method: 'POST',
      headers: { authorization: 'Bearer other-token' },
      body: { query: '私有备课', scope: ['private-doc'], userId: 'owner-1' }
    });
    assert.equal(otherPrivate.statusCode, 404);
    assert.deepEqual(otherPrivate.payload, { ok: false, error: 'document_not_found' });

    const ownerPrivate = await request('/retrieve', {
      method: 'POST',
      headers: { authorization: 'Bearer owner-token' },
      body: { query: '私有备课', scope: ['private-doc'], userId: 'other-1' }
    });
    assert.equal(ownerPrivate.statusCode, 200);
    assert.deepEqual(ownerPrivate.payload.results.map(item => item.documentId), ['private-doc']);
    assert.deepEqual(providerPayloads.at(-1).documentIds, ['private-doc']);
    assert.deepEqual(Object.keys(providerPayloads.at(-1)).sort(), ['documentIds', 'includeReview', 'query', 'topK']);

    const ownerAsk = await request('/ask', {
      method: 'POST',
      headers: { authorization: 'Bearer owner-token' },
      body: { question: '私有备课', scope: ['private-doc'], userId: 'other-1' }
    });
    assert.equal(ownerAsk.statusCode, 200);
    assert.equal(ownerAsk.payload.evidenceSufficient, true);
    assert.ok(ownerAsk.payload.citations.length > 0);
    assert.ok(ownerAsk.payload.citations.every(item => item.documentId === 'private-doc'));
    assert.deepEqual(ownerAsk.payload.route.scopes, ['private-doc']);
    assert.deepEqual(providerPayloads.at(-1).documentIds, ['private-doc']);

    const otherAsk = await request('/ask', {
      method: 'POST',
      headers: { authorization: 'Bearer other-token' },
      body: { question: '私有备课', scope: ['private-doc'], userId: 'owner-1' }
    });
    assert.equal(otherAsk.statusCode, 404);
    assert.deepEqual(otherAsk.payload, { ok: false, error: 'document_not_found' });

    const anonymousAsk = await request('/ask', { method: 'POST', headers: {}, body: { question: '教材' } });
    assert.equal(anonymousAsk.statusCode, 401);
    assert.deepEqual(anonymousAsk.payload, { ok: false, error: 'auth_required' });

    process.env.DOCUMENT_INDEX_PROVIDER = 'local';
    delete process.env.PAGEINDEX_BASE_URL;
    delete process.env.PAGEINDEX_API_KEY;
  });


  await t.test('explicit PageIndex without configuration fails closed', async () => {
    process.env.DOCUMENT_INDEX_PROVIDER = 'pageindex';
    delete process.env.PAGEINDEX_BASE_URL;
    delete process.env.PAGEINDEX_API_KEY;
    delete process.env.ALLOW_INDEX_PROVIDER_FALLBACK;

    const res = await request('/retrieve', { method: 'POST', body: { query: '我爱这土地' } });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.payload, { ok: false, error: 'pageindex_unavailable' });

    process.env.DOCUMENT_INDEX_PROVIDER = 'local';
  });

  await t.test('remote provider errors are sanitized and never include service secrets', async () => {
    process.env.DOCUMENT_INDEX_PROVIDER = 'pageindex';
    process.env.PAGEINDEX_BASE_URL = 'https://pageindex.test';
    process.env.PAGEINDEX_API_KEY = secret;
    delete process.env.ALLOW_INDEX_PROVIDER_FALLBACK;
    global.fetch = async () => new Response(JSON.stringify({ error: `upstream:${secret}:database-detail` }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });

    const res = await request('/retrieve', { method: 'POST', body: { query: '我爱这土地' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.provider, 'local-fulltext-fallback');
    assert.equal(res.payload.retrievalMode, 'stable_snapshot');
    assert.equal(res.payload.fallbackLabel, '已核验教材快照');
    assert.doesNotMatch(JSON.stringify(res.payload), new RegExp(secret));

    process.env.DOCUMENT_INDEX_PROVIDER = 'local';
    delete process.env.PAGEINDEX_BASE_URL;
    delete process.env.PAGEINDEX_API_KEY;
    global.fetch = originalFetch;
  });
});
