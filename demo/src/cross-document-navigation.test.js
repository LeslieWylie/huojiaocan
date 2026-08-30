/**
 * 跨教材切换 + 导航合同验收。
 *
 * 三条判据，全部只用仓库内已有的教材索引，不引用外部资料：
 *
 *   1. 同一篇课文在学生教材和教师教学用书里必须互相定位得到对方的
 *      起始物理页（《你是人间的四月天》72↔16、《巴特勒信》429↔124），
 *      而且这件事在「用户第一次切换教材、目标教材目录还没取过」时就要成立，
 *      不能要求先手动去目标教材里逛一圈把目录焐热。
 *
 *   2. 目录点击、搜索结果点击、ask 引用、cards 引用四条入口，
 *      doc / page / node / lesson / return / draftId 六项定位状态不能丢。
 *
 *   3. 跨教材切换时不能把源教材的 nodeId 带进目标教材的地址栏。
 *
 * 目前唯一为红的是「搜索命中另一份教材」那条：跨教材定位会把搜索命中的
 * 精确物理页改写成该课课头，教师看不到自己搜到的那一段。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildReaderHref,
  findTreeNodeByNormalizedTitle,
  normalizeLessonIdentity,
  resolveCrossDocTarget,
  resolveReaderReturn
} from './reader-target.js';
// The tree matching functions internally use reader-target's own
// normalizeLessonIdentity, which strips leading digits so that
// "21 标题" and "标题" match the same node.  Query normalization
// must use the same function.

const appSource = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');

/** 复刻 App.jsx 的 normalizeTree：把索引 JSON 拍平成带 startPage / pageRange 的节点树。 */
function loadTree(name) {
  const raw = JSON.parse(readFileSync(new URL(`../data/index/${name}`, import.meta.url), 'utf8'));
  const walk = (nodes, parentPath = []) => nodes.flatMap((node, index) => {
    if (!node || typeof node !== 'object') return [];
    const id = String(node.id || node.nodeId || `${parentPath.join('-') || 'root'}-${index}`);
    const children = Array.isArray(node.children ?? node.nodes ?? []) ? walk(node.children ?? node.nodes ?? [], [...parentPath, id]) : [];
    const start = node.startPage || (children.length ? Math.min(...children.map(child => child.startPage || Infinity)) : 0);
    const end = node.endPage || Math.max(...children.map(child => child.endPage || 0)) || start;
    return [{ ...node, id, title: String(node.title || node.name || '未命名节点'), startPage: start, endPage: Math.max(start, end), pageRange: { start, end: Math.max(start, end) }, children }];
  });
  const source = Array.isArray(raw) ? raw : raw?.data?.tree ?? raw?.tree ?? raw?.children ?? raw?.nodes ?? [];
  return walk(Array.isArray(source) ? source : [source]);
}

const TREES = Object.freeze({
  textbook: loadTree('textbook-tree.json'),
  'teacher-guide': loadTree('teacher-guide-tree.json')
});

/** 教材页数取自真实目录清单，和 App.jsx 里 docs 的来源一致。 */
const manifest = JSON.parse(readFileSync(new URL('../data/index/manifest.json', import.meta.url), 'utf8'));
const DOCS = (manifest.documents || []).map(item => ({ id: item.id, pageCount: item.pageCount }));
assert.equal(DOCS.find(item => item.id === 'textbook')?.pageCount, 168, '学生教材页数应当来自目录清单');
assert.ok(DOCS.find(item => item.id === 'teacher-guide')?.pageCount >= 579, '教师用书页数应当覆盖第 27 课');

function lessonNodes(nodes, output = []) {
  for (const node of nodes || []) {
    if (/^\d+\s/u.test(node.title || '')) output.push(node);
    lessonNodes(node.children || [], output);
  }
  return output;
}

/**
 * 复刻 App.jsx 的 findTreeNodeById：按节点 id 精确匹配。
 * 首次地址校正 effect 里，urlNode 存在时先走这条路径；只有查不到（返回 null）
 * 才会退回到按规范化篇名匹配（findTreeNodeByNormalizedTitle）。旧地址栏里的
 * node 参数如果 id 本身没有改名，真正会被执行的是这一条，而不是篇名回退。
 */
function findTreeNodeById(nodes, id) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  for (const node of nodes || []) {
    if (String(node?.id || '') === wanted) return node;
    const child = findTreeNodeById(node?.children, wanted);
    if (child) return child;
  }
  return null;
}

const GUIDE_LESSONS = lessonNodes(TREES['teacher-guide']);
const TEXTBOOK_LESSONS = lessonNodes(TREES.textbook);

/** 从 App.jsx 里取出某个函数/常量所在的那一行，用来做源码级合同断言。 */
function appLine(pattern) {
  return appSource.split('\n').find(line => pattern.test(line)) || '';
}

/**
 * 取出某个声明起始处的一段源码。函数体是压在一行还是拆成多行属于排版选择，
 * 合同断言不应该被排版改动打翻，所以统一按字符区间取。
 */
function appBlock(pattern, length = 700) {
  const line = appSource.split('\n').find(item => pattern.test(item));
  if (!line) return '';
  return appSource.slice(appSource.indexOf(line), appSource.indexOf(line) + length);
}

const SWITCH_DOCUMENT = appBlock(/const switchDocument\s*=/u);

// ---------------------------------------------------------------------------
// 判据 1：同一篇课文的跨教材对位
// ---------------------------------------------------------------------------

test('27 课在学生教材与教师用书之间双向对位，落在各自的起始物理页', () => {
  assert.equal(GUIDE_LESSONS.length, 27, `教师用书应有 27 课，实际 ${GUIDE_LESSONS.length}`);
  assert.equal(TEXTBOOK_LESSONS.length, 27, `学生教材应有 27 课，实际 ${TEXTBOOK_LESSONS.length}`);

  const drift = [];
  for (const guide of GUIDE_LESSONS) {
    const identity = normalizeLessonIdentity(guide.title);
    const peer = TEXTBOOK_LESSONS.find(node => normalizeLessonIdentity(node.title) === identity);
    if (!peer) { drift.push(`《${guide.title}》在学生教材里找不到同名篇目`); continue; }

    const toTextbook = resolveCrossDocTarget({ targetDocId: 'textbook', lessonTitle: guide.title, pageNo: guide.startPage, treesCache: TREES, docs: DOCS });
    if (toTextbook.page !== peer.startPage) drift.push(`《${guide.title}》教师用书 ${guide.startPage} → 学生教材落在 ${toTextbook.page}，应为 ${peer.startPage}`);
    if (toTextbook.nodeId !== peer.id) drift.push(`《${guide.title}》切到学生教材后 nodeId 是 ${toTextbook.nodeId}，应为 ${peer.id}`);

    const backToGuide = resolveCrossDocTarget({ targetDocId: 'teacher-guide', lessonTitle: peer.title, pageNo: peer.startPage, treesCache: TREES, docs: DOCS });
    if (backToGuide.page !== guide.startPage) drift.push(`《${peer.title}》学生教材 ${peer.startPage} → 教师用书落在 ${backToGuide.page}，应为 ${guide.startPage}`);
    if (backToGuide.nodeId !== guide.id) drift.push(`《${peer.title}》切回教师用书后 nodeId 是 ${backToGuide.nodeId}，应为 ${guide.id}`);
  }
  assert.deepEqual(drift, [], `${drift.length} 处跨教材对位错误`);
});

test('两个人工复核锚点的跨教材往返：四月天 72↔16、巴特勒信 429↔124', () => {
  const cases = [
    { title: '5 你是人间的四月天', guidePage: 72, textbookPage: 16, guideNode: 'teacher-guide-u1-n7', textbookNode: 'textbook-u1-n6' },
    { title: '21 就英法联军远征中国致巴特勒上尉的信', guidePage: 429, textbookPage: 124, guideNode: 'teacher-guide-u5-n4', textbookNode: 'textbook-u5-n3' }
  ];
  for (const item of cases) {
    const forward = resolveCrossDocTarget({ targetDocId: 'textbook', lessonTitle: item.title, pageNo: item.guidePage, treesCache: TREES, docs: DOCS });
    assert.equal(forward.page, item.textbookPage, `《${item.title}》教师用书 ${item.guidePage} 页应切到学生教材 ${item.textbookPage} 页`);
    assert.equal(forward.nodeId, item.textbookNode);

    const backward = resolveCrossDocTarget({ targetDocId: 'teacher-guide', lessonTitle: item.title, pageNo: item.textbookPage, treesCache: TREES, docs: DOCS });
    assert.equal(backward.page, item.guidePage, `《${item.title}》学生教材 ${item.textbookPage} 页应切回教师用书 ${item.guidePage} 页`);
    assert.equal(backward.nodeId, item.guideNode);
  }
});

// ---------------------------------------------------------------------------
// 判据 1b：首次切换（目标教材目录还没取过）
// ---------------------------------------------------------------------------

test('首次跨教材切换不依赖预缓存：openReaderTarget 必须先取回目标教材目录再定位', () => {
  // resolveCrossDocTarget 本身是纯函数：目标目录没进缓存时它只能回退到按源教材页码算出的页。
  const coldCache = { 'teacher-guide': TREES['teacher-guide'] };
  const cold = resolveCrossDocTarget({ targetDocId: 'textbook', lessonTitle: '5 你是人间的四月天', pageNo: 72, treesCache: coldCache, docs: DOCS });
  assert.notEqual(cold.page, 16, '前提确认：冷缓存时纯函数无法定位，所以补取目录是调用方的责任');

  // switchDocument 自己不再处理目录加载，只把切换请求原样交给 openReaderTarget——
  // 首次跨教材加载的责任现在整个压在 openReaderTarget 一处。
  assert.ok(SWITCH_DOCUMENT, '没有找到 switchDocument');
  assert.match(
    SWITCH_DOCUMENT,
    /return\s+openReaderTarget\s*\(/u,
    'switchDocument 必须把切换请求原样交给 openReaderTarget，不能自己另起一套目录加载或定位逻辑'
  );

  const OPEN_READER_TARGET = appBlock(/const openReaderTarget\s*=/u, 2600);
  assert.ok(OPEN_READER_TARGET, '没有找到 openReaderTarget');

  // 只有跨文档且带着篇目身份时才需要补目标教材目录——同文档翻页或没有篇目标题时，
  // resolveCrossDocTarget 用不上目标树，不必为它多等一次网络请求。
  assert.match(
    OPEN_READER_TARGET,
    /if\s*\(canonicalId\s*!==\s*doc\s*&&\s*nextLessonTitle\)\s*\{/u,
    'openReaderTarget 必须只在跨文档且有篇目身份时才去补目标教材目录'
  );
  assert.match(
    OPEN_READER_TARGET,
    /await\s+ensureTree\(canonicalId\)/u,
    'openReaderTarget 首次跨教材切换时没有 await 目标教材目录：缓存是空的，' +
    '《四月天》会停在 72 页而不是 16 页，《巴特勒信》会被 clamp 到学生教材第 168 页。'
  );
  assert.ok(
    OPEN_READER_TARGET.indexOf('await ensureTree(canonicalId)') < OPEN_READER_TARGET.indexOf('resolveCrossDocTarget('),
    'ensureTree 必须发生在 resolveCrossDocTarget 之前，否则跨教材定位仍然读到空缓存'
  );

  // 目标教材目录取不回来时（网络失败等）现在是准确性优先：catch 块必须先给出
  // 教师可读的中文错误提示，再 return false 原地中止——绝不能悄悄用回退页
  // 完成 setDoc/setPageNo/updateUrl，把教师带去一个被 clamp 出来的错误页。
  const catchBlock = OPEN_READER_TARGET.match(/catch\s*\(error\)\s*\{([\s\S]*?)\n\s*\}/u)?.[1] || '';
  assert.ok(catchBlock, '没有找到 openReaderTarget 里跨教材目录加载失败的 catch 块');
  assert.match(
    catchBlock,
    /setTreeError\('目标教材目录暂时无法读取，当前页面未切换。请重试。'\)/u,
    '目标教材目录加载失败时 catch 块必须用 setTreeError 给出教师可读的中文错误提示，不能悄悄吞掉这次失败'
  );
  assert.match(
    catchBlock,
    /\breturn false\b/u,
    '目标教材目录加载失败时 catch 块必须 return false，导航到此为止，不能继续往下执行'
  );
  assert.ok(
    OPEN_READER_TARGET.indexOf('catch (error)') < OPEN_READER_TARGET.indexOf('setDoc(target.id)') &&
    OPEN_READER_TARGET.indexOf('catch (error)') < OPEN_READER_TARGET.indexOf('setPageNo(') &&
    OPEN_READER_TARGET.indexOf('catch (error)') < OPEN_READER_TARGET.indexOf('updateUrl('),
    'catch 块必须写在 setDoc/setPageNo/updateUrl 之前，配合 return false 挡住失败路径：' +
    '目录取不回来时这三步必须一步都不执行，教师停在原页面，而不是被带去用回退页算出来的错误位置'
  );
});

test('取目录的入口把结果写进共享缓存，切换与目录加载走同一份数据', () => {
  const ensure = appSource.slice(appSource.indexOf('const ensureTree'), appSource.indexOf('const ensureTree') + 600);
  assert.ok(ensure.startsWith('const ensureTree'), '没有找到 ensureTree');
  assert.match(ensure, /treesCache\.current\[[^\]]+\]\s*=/u, 'ensureTree 必须把取回的目录写进 treesCache');
  assert.match(ensure, /return/u, 'ensureTree 必须把目录交回给调用方');

  const loadTree = appLine(/const loadTree\s*=/u);
  assert.match(loadTree, /await\s+ensureTree\(doc\)/u, '目录面板加载也要走 ensureTree，避免两套缓存各说各话');
});

// ---------------------------------------------------------------------------
// 判据 2：doc / page / node / lesson / return / draftId 不丢
// ---------------------------------------------------------------------------

test('目录点击与搜索结果点击都把 nodeId 和篇目标题交给 openReaderTarget', () => {
  const pick = appLine(/const pick\s*=\s*node\s*=>/u);
  assert.match(pick, /nodeId:\s*node\.id/u, '目录点击必须带上节点 id');
  assert.match(pick, /lessonTitle:\s*node\.title/u, '目录点击必须带上篇目标题');
  assert.match(pick, /pageNumber:\s*nextPage/u, '目录点击必须跳到该节点的起始页');

  const searchClick = appSource.split('\n').find(line => /openReaderTarget\(\{documentId:\s*resultDocumentId/u.test(line)) || '';
  assert.ok(searchClick, '没有找到搜索结果的点击处理');
  assert.match(searchClick, /pageNumber:\s*resultPage/u, '搜索结果必须跳到命中页的物理页');
  assert.match(searchClick, /nodeId:\s*r\.nodeId\s*\|\|\s*r\.node_id/u, '搜索结果必须带上命中节点');
  assert.match(searchClick, /lessonTitle:\s*resultTitle/u, '搜索结果必须带上篇目标题');
});

test('library 地址栏保留 doc / page / node / lesson / q / scope 六项', () => {
  const updateUrl = appLine(/const updateUrl\s*=/u);
  assert.ok(updateUrl, '没有在 App.jsx 中找到 updateUrl');
  for (const [key, pattern] of [
    ['doc', /doc:\s*documentId/u],
    ['page', /page:\s*String\(pageNumber\)/u],
    ['node', /\{node:\s*nodeId\}/u],
    ['lesson', /\{lesson:\s*lessonTitle\}/u],
    ['q', /\{q:\s*query\}/u],
    ['scope', /\{scope\}/u]
  ]) {
    assert.match(updateUrl, pattern, `library 地址栏丢了 ${key}`);
  }
});

test('切换教材或清空结果时只清除搜索词，不丢失用户选定的搜索范围', () => {
  const updateUrl = appLine(/const updateUrl\s*=/u);
  const clearSearch = appLine(/const clearSearch\s*=/u);
  assert.match(updateUrl, /\.\.\.\(scope\?\{scope\}:\{\}\)/u, 'scope 必须独立于 keepSearch 写回 URL');
  assert.doesNotMatch(updateUrl, /keepSearch&&scope/u, '切换教材会清除 q，但不应连 scope 一起清除');
  assert.match(clearSearch, /searchParams\.delete\('q'\)/u, '清空搜索应删除 q');
  assert.doesNotMatch(clearSearch, /searchParams\.delete\('scope'\)/u, '清空搜索不应删除 scope');
});

test('阅读器返回 library 时保留 doc / page / node / lesson / scope', () => {
  const start = appSource.indexOf('const libraryHref = `/library/?');
  assert.ok(start > 0, '没有找到 DocumentPage 的 libraryHref');
  const block = appSource.slice(start, start + 320);
  for (const [key, pattern] of [
    ['doc', /\n\s*doc,/u],
    ['page', /page:\s*String\(page\)/u],
    ['node', /\{\s*node:\s*nodeId\s*\}/u],
    ['lesson', /\{\s*lesson:\s*explicitLesson\s*\}/u],
    ['scope', /\{\s*scope:\s*params\.get\('scope'\)\s*\}/u]
  ]) {
    assert.match(block, pattern, `从阅读器回 library 时丢了 ${key}`);
  }
});

test('ask 与 cards 的引用链接把 draftId 原样带进 return，再原样还回来', () => {
  assert.match(appSource, /const askReaderReturn = draftId \? `\/ask\/\?draftId=\$\{encodeURIComponent\(draftId\)\}`/u);
  assert.match(appSource, /const cardsReaderReturn = draftId \? `\/cards\/\?draftId=\$\{encodeURIComponent\(draftId\)\}`/u);
  assert.match(appSource, /const askReturnTo = cardsDraftId \? `\/ask\/\?draftId=\$\{encodeURIComponent\(cardsDraftId\)\}`/u);

  for (const returnTo of ['/ask/?draftId=draft-2026-a', '/cards/?draftId=draft-2026-a&classroom=1']) {
    const href = buildReaderHref({ documentId: 'teacher-guide', page: 429, nodeId: 'teacher-guide-u5-n4', lessonTitle: '21 就英法联军远征中国致巴特勒上尉的信', returnTo });
    const target = new URL(href, 'https://local.test');
    assert.equal(target.pathname, '/document/');
    assert.equal(target.searchParams.get('doc'), 'teacher-guide');
    assert.equal(target.searchParams.get('page'), '429');
    assert.equal(target.searchParams.get('node'), 'teacher-guide-u5-n4');
    assert.equal(target.searchParams.get('lesson'), '21 就英法联军远征中国致巴特勒上尉的信');
    assert.equal(target.searchParams.get('return'), returnTo, 'return 必须原样保留，draftId 不能被截断');

    const back = resolveReaderReturn(target.searchParams.get('return'));
    assert.equal(back.href, returnTo, '从阅读器返回时必须回到带 draftId 的原工作流地址');
    assert.match(new URL(back.href, 'https://local.test').searchParams.get('draftId') || '', /^draft-2026-a$/u);
  }
});

test('引用链接不因跨教材而改写 documentId，两份教材各自回到自己的物理页', () => {
  for (const [documentId, page] of [['teacher-guide', 429], ['textbook', 124]]) {
    const href = buildReaderHref({ documentId, page, lessonTitle: '21 就英法联军远征中国致巴特勒上尉的信', returnTo: '/ask/?draftId=draft-9' });
    const target = new URL(href, 'https://local.test');
    assert.equal(target.searchParams.get('doc'), documentId);
    assert.equal(target.searchParams.get('page'), String(page));
  }
});

// ---------------------------------------------------------------------------
// 判据 3：切换教材不回第 1 页、不把源教材的 nodeId 带进目标教材
// ---------------------------------------------------------------------------

test('切换教材时不把当前页重置回第 1 页', () => {
  assert.ok(SWITCH_DOCUMENT, '没有找到 switchDocument');
  assert.doesNotMatch(SWITCH_DOCUMENT, /pageNumber:\s*1\b/u, '切换教材不能硬编码回第 1 页，会丢掉教师当前正在读的篇目位置');
  assert.match(SWITCH_DOCUMENT, /pageNumber:\s*pageNo/u, '切换教材应当以当前物理页为起点，再按篇目重新定位');
  assert.match(SWITCH_DOCUMENT, /lessonTitle:\s*selectedLessonTitle/u, '切换教材必须带上当前篇目，否则无法跨教材对位');
});

test('跨教材切换不把源教材的节点 id 带进目标教材地址', () => {
  const miss = resolveCrossDocTarget({ targetDocId: 'textbook', lessonTitle: '教师用书独有的操作说明', pageNo: 64, treesCache: TREES, docs: DOCS });
  assert.equal(miss.nodeId, '', '目标教材里没有这一篇时，不能给出任何 nodeId');

  // openReaderTarget 在跨教材未命中时会回退成传进来的 nodeId，
  // 所以切换入口不能把当前教材的 selectedNode 递进去。
  assert.match(
    SWITCH_DOCUMENT,
    /nodeId:\s*''/u,
    '切换教材时把源教材的 selectedNode 递给了 openReaderTarget：' +
    '跨教材未命中时它会原样落进地址栏，得到 /library/?doc=textbook&node=teacher-guide-u1-n6，' +
    '目标教材目录高亮不到该节点，popstate 回放时还会把这个外来 id 写回 selectedNode。'
  );
});

test('搜索命中另一份教材时，跳转必须落在命中页而不是该课的课头页', () => {
  // 搜索结果自带目标教材的精确物理页（例如「巴特勒」命中教师用书第 441 页）。
  // 这一页已经在《巴特勒信》429—444 的范围内，跨教材定位不得把它拽回课头 429。
  const guideLesson = GUIDE_LESSONS.find(node => node.startPage === 429);
  assert.ok(guideLesson && 441 >= guideLesson.startPage && 441 <= guideLesson.endPage, '前提确认：441 页落在《巴特勒信》范围内');

  const hit = resolveCrossDocTarget({ targetDocId: 'teacher-guide', lessonTitle: guideLesson.title, pageNo: 441, treesCache: TREES, docs: DOCS });
  assert.equal(
    hit.page,
    441,
    '在学生教材页面上点击「教师用书第 441 页」的搜索结果时，跨教材定位把页码改写成了课头 ' +
    `${hit.page}，教师看不到自己搜索的那一段。命中页已经在该课范围内时应当原样保留。`
  );

  // 反向确认：命中页不在目标教材该课范围内时，仍然应当按课头定位。
  const jump = resolveCrossDocTarget({ targetDocId: 'textbook', lessonTitle: '21 就英法联军远征中国致巴特勒上尉的信', pageNo: 441, treesCache: TREES, docs: DOCS });
  assert.equal(jump.page, 124, '源教材页码落在目标教材该课范围之外时，仍按课头定位');
});

// ---------------------------------------------------------------------------
// 判据 4：教材身份切换——旧教材的 tree 不能参与新教材的校正
//
// LibraryPage 用 treeDocumentId 记录「当前 tree state 里装的到底是哪个教材的目录」，
// 用 treeRequestRef（下面称作最新请求序号）记录「最新一次 loadTree 调用的编号」。
// 两者合起来保证：教材切换之后，旧教材的 tree、或者晚到的旧请求响应，都不会被
// 误当成新教材的目录去做「翻页节点校正」或「首次地址校正」。
// ---------------------------------------------------------------------------

const LOAD_TREE_SOURCE = appLine(/const loadTree=async/u);

test('loadTree 发起新请求时必须同步清空 tree 与 treeDocumentId，不留旧教材目录的残影', () => {
  assert.ok(LOAD_TREE_SOURCE, '没有找到 loadTree');
  assert.match(
    LOAD_TREE_SOURCE,
    /const requestId=\+\+treeRequestRef\.current; setTree\(\[\]\); setTreeDocumentId\(''\); setTreeBusy\(true\); setTreeError\(''\); try \{ const normalized = await ensureTree\(doc\);/u,
    'loadTree 必须在 await ensureTree(doc) 之前，也就是切换教材的同一刻，就同步清空 tree 和 treeDocumentId：' +
    '否则在新请求飞行途中，两个校正 effect 会读到「新 doc + 旧教材的 tree」这个自相矛盾的组合去做校正。'
  );
});

test('loadTree 用最新请求序号防止迟到的响应覆盖新教材的目录与身份', () => {
  assert.ok(LOAD_TREE_SOURCE, '没有找到 loadTree');
  assert.match(
    LOAD_TREE_SOURCE,
    /if\(requestId!==treeRequestRef\.current\)return; setTree\(normalized \|\| \[\]\); setTreeDocumentId\(doc\);/u,
    '目录取回成功时，loadTree 必须先判断 requestId 仍是最新请求，才允许把取回的目录连同 treeDocumentId 一起写进 state。' +
    '教师连续切换 A→B 两份教材时，A 的目录请求可能晚于 B 落地；缺了这道判断，B 的 tree 会被 A 迟到的响应覆盖成 A 的目录，' +
    '而 treeDocumentId 却仍写成 B，两个校正 effect 就会拿着「A 的 tree + B 的身份」去校正 B。'
  );
  assert.match(
    LOAD_TREE_SOURCE,
    /catch\(error\) \{ if\(requestId!==treeRequestRef\.current\)return; setTree\(\[\]\); setTreeDocumentId\(''\);/u,
    '目录取回失败时同样要判断 requestId 仍是最新请求，否则 A 请求失败的清空动作会晚于 B 成功加载之后发生，' +
    '把 B 已经取回的目录又清空掉。'
  );
});

test('翻页时的节点校正 effect 与首次地址校正 effect 都要求 treeDocumentId===doc', () => {
  assert.match(
    appSource,
    /if \(!tree\.length \|\| !pageNo \|\| treeDocumentId !== doc\) return;/u,
    '合并后的单一 effect 必须要求 treeDocumentId===doc，' +
    '否则教材切换后、新教材目录还没落地前，会拿上一份教材的 tree 给新 doc 的 pageNo 校正节点。'
  );
  assert.match(
    appSource,
    /if \(!initialAddressCorrected\.current\[docId\]\)/u,
    '首次地址校正 Phase 1 必须检查 initialAddressCorrected.current[docId]，' +
    '防止同一份教材的首次校正重复执行。'
  );
});

// ---------------------------------------------------------------------------
// 判据 5：首次地址校正——旧地址校正到课头，合法深链接原样保留
// ---------------------------------------------------------------------------

const FIRST_ADDRESS_CORRECTION = appBlock(/Phase 1: 首次地址校正/u, 5000);

test('首次地址校正按 nodeContainsPage 分支：落在节点范围内保留 urlPage，范围外校正到 startPage', () => {
  assert.ok(FIRST_ADDRESS_CORRECTION, '没有找到首次地址校正 effect');
  assert.match(FIRST_ADDRESS_CORRECTION, /\}, \[tree, pageNo, selectedNode, selectedLessonTitle, doc, treeDocumentId\]\);/u, 'appBlock 截取长度不够，没有覆盖到首次地址校正 effect 的结尾');

  assert.match(
    FIRST_ADDRESS_CORRECTION,
    /if \(Number\.isInteger\(urlPage\) && urlPage > 0 && nodeContainsPage\(intendedNode, urlPage\)\) \{/u,
    '首次地址校正必须按 nodeContainsPage(intendedNode, urlPage) 判断 URL 页码是否落在目标节点范围内'
  );
  assert.match(
    FIRST_ADDRESS_CORRECTION,
    /nodeContainsPage\(intendedNode, urlPage\)\) \{[\s\S]{0,320}?pageNumber:\s*urlPage,/u,
    '落在节点范围内的分支必须保留 urlPage 原样写回 URL，不能改写成课头页——这条分支保护的正是合法深链接'
  );
  assert.match(
    FIRST_ADDRESS_CORRECTION,
    /\} else \{[\s\S]{0,320}?setPageNo\(intendedNode\.startPage\);/u,
    '不在节点范围内的分支必须把 pageNo 校正为该节点的 startPage（课头页）——这条分支保护的正是失效的旧地址'
  );
  assert.match(
    FIRST_ADDRESS_CORRECTION,
    /setPageNo\(intendedNode\.startPage\);[\s\S]{0,320}?pageNumber:\s*intendedNode\.startPage,/u,
    '校正分支里 setPageNo 和写回 URL 的 pageNumber 必须用同一个值 intendedNode.startPage，不能两处各算一套'
  );
});

test('教师用书第21课：旧地址 425 页应校正到课头 429 页，合法深链接 441 页必须原样保留', () => {
  const lessonTitle = '21 就英法联军远征中国致巴特勒上尉的信';
  const intendedNode = findTreeNodeByNormalizedTitle(TREES['teacher-guide'], normalizeLessonIdentity(lessonTitle));
  assert.ok(intendedNode, '应能在教师用书目录树里按规范化篇名找到第21课节点');

  // 上一条测试已经把首次地址校正的分支锁定为：
  //   nodeContainsPage(intendedNode, urlPage) 为真 → 保留 urlPage
  //   为假                                      → setPageNo(intendedNode.startPage)
  // 这里只需要确认第21课自己的物理页范围，两个真实地址各自会走哪条分支、落在哪一页就是确定的。
  const inRange = page => page >= intendedNode.startPage && page <= intendedNode.endPage;
  assert.equal(intendedNode.startPage, 429, '第21课课头必须是物理 429 页——这也是校正分支里 setPageNo(intendedNode.startPage) 会落到的值');
  assert.equal(inRange(425), false, '旧地址 425 页不在第21课范围内 → 走校正分支，落点是课头 429');
  assert.equal(inRange(441), true, '合法深链接 441 页落在第21课范围内 → 走保留分支，落点原样是 441，不回退到课头');
});

test('首次地址校正每次读取当前 location.search，不复用挂载时缓存的初始 params', () => {
  assert.ok(FIRST_ADDRESS_CORRECTION, '没有找到首次地址校正 effect');
  assert.match(
    FIRST_ADDRESS_CORRECTION,
    /const currentParams = new URLSearchParams\(location\.search\);/u,
    '首次地址校正必须每次读取当前 location.search，而不是 LibraryPage 挂载时 useMemo 出来的初始 params'
  );
  assert.match(FIRST_ADDRESS_CORRECTION, /currentParams\.get\('node'\)/u, '首次地址校正读 urlNode 必须来自 currentParams');
  assert.match(FIRST_ADDRESS_CORRECTION, /currentParams\.get\('lesson'\)/u, '首次地址校正读 urlLesson 必须来自 currentParams');
  assert.match(FIRST_ADDRESS_CORRECTION, /currentParams\.get\('page'\)/u, '首次地址校正读 urlPage 必须来自 currentParams');
  assert.doesNotMatch(
    FIRST_ADDRESS_CORRECTION,
    /\bparams\.get\(/u,
    '首次地址校正不能读取挂载时缓存的初始 params：教师第一次打开页面看的是教材 A（初始 params 记的是 A 的 node/lesson），' +
    '随后第一次切到教材 B 时，B 的首次校正如果读到 A 的 params，会把 A 的篇目身份错误地套用到 B 的目录树上查找。'
  );
});

// ---------------------------------------------------------------------------
// 判据 6：翻页跨到另一课时，node 与 lesson 必须一起同步进 URL
// ---------------------------------------------------------------------------

const PAGE_MATCH_EFFECT = appBlock(/const located = findTreeNode\(tree, pageNo\);/u, 1200);

test('翻页跨到另一课时，selectedNode 与 selectedLessonTitle 必须一起更新，且一起写回 URL', () => {
  assert.ok(PAGE_MATCH_EFFECT, '没有找到翻页节点校正 effect');
  assert.match(
    PAGE_MATCH_EFFECT,
    /\}, \[tree, pageNo, selectedNode, selectedLessonTitle, doc, treeDocumentId\]\);/u,
    'appBlock 截取长度不够，没有覆盖到该 effect 的结尾'
  );

  assert.match(
    PAGE_MATCH_EFFECT,
    /if \(located && \(located\.id !== selectedNode \|\| located\.title !== selectedLessonTitle\)\) \{\s*setSelectedNode\(located\.id\);\s*setSelectedLessonTitle\(located\.title\);/u,
    '翻页命中新节点时，setSelectedNode 和 setSelectedLessonTitle 必须在同一分支里一起调用，不能只更新其中一个——' +
    '否则翻到下一课时，要么高亮停在旧节点，要么篇名与实际所在课不一致。'
  );
  assert.match(
    PAGE_MATCH_EFFECT,
    /updateUrl\(\{\s*documentId:\s*doc,\s*pageNumber:\s*pageNo,\s*nodeId:\s*located\.id,\s*lessonTitle:\s*located\.title,/u,
    '翻页跨课时同步 URL 的 updateUrl 调用必须同时带上 nodeId: located.id 和 lessonTitle: located.title，' +
    '只写其中一个会让地址栏和教师当前实际所在的课不一致，分享出去的链接会指回错误的篇目。'
  );
});
