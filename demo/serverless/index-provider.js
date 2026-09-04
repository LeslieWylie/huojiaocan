import crypto from 'node:crypto';
import fs from 'node:fs';
import { generateGroundedAnswer, runReActRetrieval } from './grounded-answer.js';
import { deriveSourceCoverage } from './source-coverage.js';

function readJsonOrFallback(url, fallback) {
  try { return JSON.parse(fs.readFileSync(url, 'utf8')); } catch { return fallback; }
}
function readPageSet(name) {
  const direct = readJsonOrFallback(new URL(`../data/index/${name}.json`, import.meta.url), null);
  if (Array.isArray(direct)) return direct;
  try {
    const directory = new URL(`../data/index/${name}.parts/`, import.meta.url);
    return fs.readdirSync(directory).filter(file => file.endsWith('.json')).sort().flatMap(file => readJsonOrFallback(new URL(file, directory), []));
  } catch { return []; }
}
const manifest = readJsonOrFallback(new URL('../data/index/manifest.json', import.meta.url), { version: 1, documents: [] });
const staticPageSets = {
  textbook: readPageSet('textbook-pages'),
  'teacher-guide': readPageSet('teacher-guide-pages'),
  'curriculum-standard': readPageSet('curriculum-standard-pages')
};

const DOCUMENT_TYPE = { textbook: 'textbook', 'teacher-guide': 'teacher_guide', 'curriculum-standard': 'curriculum_standard' };
const DEFAULT_TEACHING_DOCUMENTS = ['textbook', 'teacher-guide'];
const stopWords = new Set(['什么', '怎么', '如何', '为什么', '是否', '可以', '这个', '那个', '学生', '教师', '教学', '课文', '问题', '设计', '进行', '需要', '应该']);
// Public textbook aliases improve the common “作者 / 人物 → 篇目” route
// without inventing a page number.  They resolve only to a title; the actual
// physical page still comes from the indexed catalog and verified snapshot.
const LESSON_QUERY_ALIASES = new Map([
  ['范仲淹', '岳阳楼记'],
  ['欧阳修', '醉翁亭记'],
  ['张岱', '湖心亭看雪'],
  ['毛泽东', '沁园春雪'],
  ['艾青', '我爱这土地'],
  ['余光中', '乡愁'],
  ['鲁迅', '故乡'],
  ['莫泊桑', '我的叔叔于勒'],
  ['曹文轩', '孤独之旅'],
  ['刘绍棠', '蒲柳人家'],
  ['梁启超', '敬业与乐业'],
  ['傅雷', '傅雷家书'],
  ['巴特勒信', '就英法联军远征中国致巴特勒上尉的信']
]);
const mutableDocuments = new Map();
const pageOverrides = new Map();
const jobs = new Map();
const validations = new Map();

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`; }
function clean(value = '') { return String(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''); }
function clampLimit(value, fallback = 12) { return Math.max(1, Math.min(50, Number(value) || fallback)); }
function normalizeDocumentType(value) {
  const type = String(value || '').trim().toLowerCase().replaceAll('_', '-').replace(/\s+/g, '-');
  if (['teacher-guide', 'teacher-guidebook', 'guide'].includes(type)) return 'teacher_guide';
  if (['textbook', 'student-textbook', 'student-book'].includes(type)) return 'textbook';
  if (['curriculum-standard', 'curriculum', 'standard', 'course-standard'].includes(type)) return 'curriculum_standard';
  return type || 'other';
}
function documentType(documentId, explicit) { return normalizeDocumentType(explicit || DOCUMENT_TYPE[documentId] || 'other'); }
function documentRecord(documentId) {
  const stored = mutableDocuments.get(documentId);
  if (stored) return stored;
  const source = manifest.documents.find(doc => doc.id === documentId);
  if (!source) return null;
  return { ...source, documentType: documentType(documentId), indexStatus: 'ready', pdfStatus: 'ready' };
}
function allDocumentIds() { return [...new Set([...Object.keys(staticPageSets), ...mutableDocuments.keys()])]; }
function pagesFor(documentId) {
  const pages = staticPageSets[documentId] || [];
  return pages.map(page => pageOverrides.get(`${documentId}:${page.pageNumber}`) || page);
}
function flattenTree(nodes = [], path = [], output = []) {
  for (const node of nodes || []) {
    const sectionPath = [...path, node.title].filter(Boolean);
    output.push({ ...node, sectionPath });
    flattenTree(node.children || [], sectionPath, output);
  }
  return output;
}
const flatTrees = new Map(manifest.documents.map(doc => [doc.id, flattenTree(doc.tree || [])]));
function nodeForPage(documentId, page) {
  const nodes = flatTrees.get(documentId) || [];
  const exact = page.nodeId && nodes.find(node => node.id === page.nodeId);
  if (exact) return exact;
  return nodes.filter(node => Number(node.startPage) <= page.pageNumber && Number(node.endPage) >= page.pageNumber).sort((a, b) => b.level - a.level)[0] || null;
}
function pageByNumber(documentId, pageNumber) {
  return pagesFor(documentId).find(page => Number(page.pageNumber) === Number(pageNumber)) || null;
}
function validPdfPage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}
function viewerUrl(page, documentId, pageNumber) {
  const pdfPage = validPdfPage(pageNumber);
  if (!pdfPage) return '';
  // Only URLs from locally registered document/page metadata are trusted. Remote
  // provider hits may contain arbitrary viewer URLs and must not control links.
  const configuredBase = String(process.env.PDF_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  const registered = String(documentRecord(documentId)?.pdfUrl || page?.pdfUrl || '').split('#')[0];
  const base = configuredBase && registered.startsWith('/') ? `${configuredBase}${registered}` : registered;
  return base ? `${base}#page=${pdfPage}` : '';
}

function queryTerms(query) {
  const raw = String(query || '').trim();
  const chunks = raw.match(/[\p{Script=Han}]{2,}|[a-zA-Z0-9]{2,}/gu) || [];
  const terms = new Set();
  for (const chunk of chunks) {
    if (!stopWords.has(chunk)) terms.add(chunk);
    if (/^[\p{Script=Han}]+$/u.test(chunk)) {
      for (const size of [4, 3, 2]) {
        if (chunk.length < size) continue;
        for (let i = 0; i <= chunk.length - size; i += 1) {
          const token = chunk.slice(i, i + size);
          if (!stopWords.has(token)) terms.add(token);
        }
      }
    }
  }
  return [...terms].sort((a, b) => b.length - a.length).slice(0, 40);
}
function countOccurrences(text, term) {
  let count = 0;
  let cursor = 0;
  while ((cursor = text.indexOf(term, cursor)) !== -1) {
    count += 1;
    cursor += Math.max(1, term.length);
    if (count >= 8) break;
  }
  return count;
}
function bestQuote(text, query, terms, maxLength = 230) {
  const source = String(text || '').replace(/\n{3,}/g, '\n\n');
  const candidates = [String(query || '').trim(), ...terms].filter(Boolean);
  let index = -1;
  for (const candidate of candidates) {
    index = source.toLowerCase().indexOf(candidate.toLowerCase());
    if (index >= 0) break;
  }
  if (index < 0) index = 0;
  const start = Math.max(0, index - Math.floor(maxLength * 0.32));
  const end = Math.min(source.length, start + maxLength);
  const quote = source.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${quote}${end < source.length ? '…' : ''}`;
}

// PageIndex may return a page-start preview even when it selected the page for
// a phrase near the end, or an aggregated snippet that never appears on the
// page at all. For bundled public books, a citation's text must always trace
// back to a physical page we can re-verify later, so it is always rebuilt
// from our immutable local page snapshot rather than kept from the remote
// response. Page identity and ranking still come from PageIndex; private
// uploads have no local snapshot entry and are deliberately left untouched.
function centerPublicResultSnippets(results = [], query = '') {
  const q = String(query || '').trim();
  const terms = queryTerms(q);
  return results.map(result => {
    const sourcePage = pageByNumber(result.documentId, result.pdfPage);
    if (!sourcePage) return result;
    const source = String(sourcePage.retrievalText || sourcePage.text || '').trim();
    if (!source) return result;
    const quote = bestQuote(source, q, terms);
    return { ...result, text: quote, quote };
  });
}
function normalizeScope(scope) {
  const allowed = new Set(allDocumentIds());
  const publicIds = Object.keys(staticPageSets);
  const incoming = scope == null || scope === '' || scope === 'both'
    ? DEFAULT_TEACHING_DOCUMENTS
    : scope === 'all' ? publicIds
    : Array.isArray(scope) ? scope : [scope];
  const normalized = incoming.flatMap(item => item === 'both' ? DEFAULT_TEACHING_DOCUMENTS : item === 'all' ? publicIds : [item])
    .map(item => item === 'guide' || item === 'teacher_guide' ? 'teacher-guide' : String(item || '').trim())
    .filter(item => allowed.has(item));
  return [...new Set(normalized)];
}

function providerScopePayload(scope) {
  // The public API also accepts a scalar scope. PageIndex validates
  // documentIds as an array, so normalize before crossing that service
  // boundary instead of sending scope="both" or scope="textbook".
  const publicIds = Object.keys(staticPageSets);
  const incoming = scope == null || scope === '' || scope === 'both'
    ? DEFAULT_TEACHING_DOCUMENTS
    : scope === 'all' ? publicIds
    : Array.isArray(scope) ? scope : [scope];
  const normalized = [...new Set(incoming.flatMap(item => item === 'both' ? DEFAULT_TEACHING_DOCUMENTS : item === 'all' ? publicIds : [item])
    .map(item => item === 'guide' || item === 'teacher_guide' ? 'teacher-guide' : String(item || '').trim())
    .filter(Boolean))];
  return normalized.length ? normalized : publicIds;
}

function filterResultsByDocumentIds(results = [], documentIds = []) {
  const allowed = new Set(documentIds.map(String));
  return results.filter(result => allowed.has(String(result?.documentId || result?.document_id || '')));
}

// A follow-up such as “教师用书怎么处理这一步？” is meaningful only in the
// current lesson. Keep the lesson title in the retrieval query at the provider
// boundary as a second line of defence; the browser may omit it on a later
// turn, but PageIndex must never receive an unanchored cross-lesson query.
function lessonAwareLookup(retrievalQuery, question, lessonIdentity) {
  const explicit = String(retrievalQuery || '').trim();
  const current = String(question || '').trim();
  const title = String(lessonIdentity?.title || '').trim();
  const lookup = explicit || current;
  if (!title) return lookup;
  if (!lookup) return title;
  if (clean(lookup).includes(clean(title))) return lookup;
  return `${title} ${lookup}`.trim();
}

/** Normalize every provider-specific hit into the public SearchResult contract.
 * Legacy aliases remain so the current V1.1 frontend keeps working.
 */
export function normalizeSearchResult(raw = {}, provider = 'unknown') {
  const documentId = String(raw.documentId || raw.document_id || '');
  const pdfPage = validPdfPage(raw.pdfPage ?? raw.pdf_page ?? raw.pageNumber ?? raw.page);
  if (!pdfPage) return null;
  const doc = documentRecord(documentId) || {};
  const sourcePage = pageByNumber(documentId, pdfPage) || {};
  const node = nodeForPage(documentId, { ...sourcePage, nodeId: raw.nodeId || raw.node_id, pageNumber: pdfPage });
  const text = String(raw.text ?? raw.quote ?? raw.retrievalText ?? sourcePage.retrievalText ?? sourcePage.text ?? '');
  const printedPage = raw.printedPage ?? raw.printed_page ?? sourcePage.printedPage ?? undefined;
  const sectionPath = Array.isArray(raw.sectionPath) ? raw.sectionPath : Array.isArray(raw.section_path) ? raw.section_path : node?.sectionPath || [raw.title || sourcePage.title].filter(Boolean);
  const pdfUrl = viewerUrl(sourcePage, documentId, pdfPage);
  // For bundled public books, page metadata from the immutable local snapshot
  // is authoritative. A remote provider may return a broad node title for a
  // neighboring page; allowing that title to replace the local page mapping
  // is how an unrelated lesson can masquerade as the requested one.
  const title = sourcePage.title || node?.title || raw.title || doc.title || documentId;
  const textSource = raw.textSource || raw.text_source || sourcePage.selectedTextSource || 'native';
  const qualityStatus = raw.qualityStatus || raw.quality_status || sourcePage.textQualityStatus || 'normal';
  const result = {
    documentId,
    documentTitle: raw.documentTitle || raw.document_title || doc.title || documentId,
    documentType: documentType(documentId, raw.documentType || raw.document_type),
    pdfPage,
    printedPage,
    sectionPath,
    text,
    textSource,
    qualityStatus,
    score: raw.score == null ? undefined : Number(raw.score),
    providerMetadata: { provider, ...(raw.providerMetadata || raw.provider_metadata || {}) },
    viewer: { pdfUrl, page: pdfPage },
    // V1.1 compatibility aliases.
    id: raw.id || `${documentId}-p${pdfPage}`,
    pageNumber: pdfPage,
    title,
    nodeId: raw.nodeId || raw.node_id || sourcePage.nodeId || node?.id || null,
    quote: String(raw.quote || text),
    pdfUrl,
    matchedTerms: raw.matchedTerms || []
  };
  return result;
}

function queryEvidenceProfile(query) {
  const raw = String(query || '').trim();
  const asciiAnchors = (raw.match(/[a-zA-Z0-9]{2,}/g) || []).map(clean).filter(Boolean);
  const hanChunks = (raw.match(/[\p{Script=Han}]{2,}/gu) || []).map(clean).filter(chunk => chunk && !stopWords.has(chunk));
  return { raw, normalized: clean(raw), asciiAnchors: [...new Set(asciiAnchors)], hanChunks: [...new Set(hanChunks)] };
}

/**
 * A score alone is not proof. Common overlapping Chinese n-grams can otherwise
 * turn an unrelated page into "evidence". Require stable query anchors before
 * generation while keeping broad search results available for exploration.
 */
function hasQueryCoverage(result, query) {
  const profile = queryEvidenceProfile(query);
  const haystack = clean(`${result.title || ''}${(result.sectionPath || []).join('')}${result.text || ''}`);
  if (!haystack) return false;
  if (profile.asciiAnchors.some(anchor => !haystack.includes(anchor))) return false;
  if (profile.normalized && haystack.includes(profile.normalized)) return true;

  const matched = [...new Set((result.matchedTerms || []).map(clean).filter(Boolean))];
  const longMatches = matched.filter(term => term.length >= 4);
  const mediumMatches = matched.filter(term => term.length === 3);
  if (longMatches.length > 0 || mediumMatches.length >= 2) return true;

  // The remote PageIndex contract returns ranked page text, not the local
  // provider's `matchedTerms` diagnostic. Derive a conservative four-character
  // anchor from the query so a natural-language question such as
  // “讲一下沁园春雪应该怎么备课” can still be tied to the page title/content
  // without trusting a score alone.
  const derivedAnchors = profile.hanChunks
    .filter(chunk => chunk.length >= 4)
    .flatMap(chunk => Array.from({ length: chunk.length - 3 }, (_, index) => chunk.slice(index, index + 4)))
    .filter(anchor => haystack.includes(anchor));
  if (derivedAnchors.length > 0) return true;

  // Short entity/title queries (for example “鲁迅”) must match exactly rather
  // than being rejected merely because they cannot produce a four-character n-gram.
  return profile.hanChunks.some(chunk => chunk.length <= 4 && haystack.includes(chunk));
}

function safeEvidence(results = []) {
  return results.filter(item => {
    if (!item) return false;
    const scoreIsValid = item.score == null || (Number.isFinite(Number(item.score)) && Number(item.score) >= 0);
    return Boolean(
      String(item.documentId || '').trim() &&
      Number.isInteger(Number(item.pdfPage)) &&
      Number(item.pdfPage) > 0 &&
      String(item.text || '').trim() &&
      item.qualityStatus !== 'failed' &&
      scoreIsValid
    );
  });
}

function normalizeLessonTitle(value) {
  return clean(value).replace(/^\d+/, '').replace(/^第[一二三四五六七八九十百]+课/, '');
}

function lessonTargetsForQuery(query, scope) {
  const normalizedQuery = clean(query);
  if (!normalizedQuery) return [];
  // A provider call without an explicit scope is a generic low-level search.
  // Do not impose a lesson window there: callers may be looking for a person,
  // unit concept, or cross-book reference. Teacher-facing ask/search calls
  // always send the selected material scope when they want lesson anchoring.
  if (scope == null) return [];
  const titleQueries = [normalizedQuery, LESSON_QUERY_ALIASES.get(normalizedQuery)].filter(Boolean);
  const allowed = new Set(normalizeScope(scope));
  const targets = [];
  const known = new Set();
  const addTarget = ({ documentId, title, startPage, endPage }) => {
    const normalizedTitle = normalizeLessonTitle(title);
    const start = Number(startPage || 0);
    const end = Number(endPage || start);
    if (!normalizedTitle || !start || !end) return;
    const key = `${documentId}:${normalizedTitle}:${start}:${end}`;
    if (known.has(key)) return;
    known.add(key);
    targets.push({ documentId, title: normalizedTitle, startPage: start, endPage: end });
  };
  for (const [documentId, nodes] of flatTrees.entries()) {
    if (!allowed.has(documentId)) continue;
    for (const node of nodes || []) {
      if (Number(node.level || 0) < 2) continue;
      const title = normalizeLessonTitle(node.title);
      // Unit/task labels are useful navigation nodes but are too broad to be
      // treated as a lesson anchor for evidence filtering.
      if (title.length < 2 || /任务|单元说明|教学设计|整本书阅读/.test(title)) continue;
      // A teacher will often enter just the distinctive half of a title, such
      // as “岳阳楼” rather than “岳阳楼记”.  Treat that as the same concrete
      // lesson anchor, while still ignoring short, generic labels above.
      if (!titleQueries.some(candidate => candidate.includes(title) || title.includes(candidate))) continue;
    const window = lessonContentWindow(documentId, node, title);
    addTarget({ documentId, title, startPage: window.startPage, endPage: window.endPage });
    }
  }

  // Titles alone do not cover the way teachers search.  For an author/person
  // such as “范仲淹”, derive a lesson anchor only from a page whose own heading
  // belongs to a concrete lesson.  This deliberately ignores broad unit and
  // writing pages that merely mention the same person as an example.
  if (!targets.length && normalizedQuery.length >= 2) {
    for (const documentId of allowed) {
      for (const page of pagesFor(documentId)) {
        const pageText = clean(page.text || page.retrievalText || '');
        if (!pageText.includes(normalizedQuery)) continue;
        const node = nodeForPage(documentId, page);
        const pageTitle = normalizeLessonTitle(page.title || '');
        const nodeTitle = normalizeLessonTitle(node?.title || '');
        if (!node || Number(node.level || 0) < 2 || !pageTitle || !nodeTitle) continue;
        if (/任务|单元说明|教学设计|整本书阅读|阅读综合实践|写作/.test(nodeTitle)) continue;
        // The page itself must carry the lesson heading.  This prevents a
        // stray historical reference inside a writing exercise from stealing
        // the search intent away from the actual text.
        if (!pageTitle.includes(nodeTitle) && !nodeTitle.includes(pageTitle)) continue;
        const window = lessonContentWindow(documentId, node, nodeTitle);
        addTarget({ documentId, title: nodeTitle, startPage: window.startPage, endPage: window.endPage });
      }
    }
  }
  return targets;
}

// The generated PageIndex tree is intentionally broad: a teacher-guide node
// can begin on the unit overview and end before the next lesson heading. That
// is useful for navigation, but it is too broad for answer evidence. Build a
// narrower lesson window from the immutable page text, using the actual
// “教学重点” heading as the start and the next lesson's heading as the end.
// This keeps directory navigation broad while making teaching answers precise.
function lessonContentWindow(documentId, node, lessonTitle) {
  const baseStart = Number(node?.startPage || 0);
  const baseEnd = Number(node?.endPage || baseStart);
  if (!baseStart || !baseEnd || documentId !== 'teacher-guide') {
    return { startPage: baseStart, endPage: baseEnd };
  }

  const siblings = (flatTrees.get(documentId) || [])
    .filter(item => Number(item.level || 0) === Number(node.level || 0))
    .sort((a, b) => Number(a.startPage || 0) - Number(b.startPage || 0));
  const next = siblings.find(item => Number(item.startPage || 0) > baseStart
    && !/任务|单元说明|教学设计|整本书阅读|阅读综合实践|写作/.test(normalizeLessonTitle(item.title)));
  const nextTitle = next ? normalizeLessonTitle(next.title) : '';
  const pages = pagesFor(documentId);
  const titleNeedle = clean(lessonTitle);
  const contentStart = pages.find(page => {
    const number = Number(page.pageNumber);
    if (number < baseStart || number > baseEnd) return false;
    const text = clean(page.retrievalText || page.text || '');
    return text.includes(titleNeedle) && text.includes(clean('教学重点'));
  });

  const effectiveStart = Number(contentStart?.pageNumber || baseStart);
  let effectiveEnd = baseEnd;
  if (nextTitle) {
    const nextHeading = pages.find(page => {
      const number = Number(page.pageNumber);
      if (number <= effectiveStart) return false;
      const text = clean(page.retrievalText || page.text || '');
      return text.includes(clean(nextTitle)) && text.includes(clean('教学重点'));
    });
    if (nextHeading) effectiveEnd = Math.max(effectiveStart, Number(nextHeading.pageNumber) - 1);
  }
  return { startPage: effectiveStart, endPage: Math.max(effectiveStart, effectiveEnd) };
}

function rerankProviderResults(results = [], query, scope) {
  const targets = lessonTargetsForQuery(query, scope);
  if (!targets.length) return results;
  const decorated = [];
  for (const result of results) {
    const target = targets.find(item => item.documentId === result.documentId);
    if (!target) {
      decorated.push({ result, rank: Number(result.score) || 0, inTarget: true });
      continue;
    }
    const page = Number(result.pdfPage);
    const heading = clean(`${result.title || ''}${(result.sectionPath || []).join('')}`);
    const content = clean(result.text || '');
    const exactTitle = heading.includes(target.title);
    const hasLessonInPageText = content.includes(target.title);
    const compactQuery = clean(query).replace(/[·・\s]/gu, '');
    const compactTitle = clean(target.title).replace(/[·・\s]/gu, '');
    const recognizedQueryTitle = LESSON_QUERY_ALIASES.get(compactQuery) || compactQuery;
    const exactLessonQuery = recognizedQueryTitle === compactTitle;
    const lessonStart = page === target.startPage;
    const guideFocusHeading = exactLessonQuery && result.documentId === 'teacher-guide'
      && /(教学重点|教学目标|教学建议|教学设计)/u.test(content);
    const guideLessonHeading = exactLessonQuery && result.documentId === 'teacher-guide'
      && content.slice(0, 320).includes(target.title);
    // Teacher-guide headings can begin a couple of physical pages before the
    // generated tree node (front matter and page headers). Keep that narrow
    // buffer, but do not let a directory hit stand in for the lesson.
    const inTarget = Number.isInteger(page)
      && page >= Math.max(1, target.startPage - 2)
      && page <= target.endPage + 2;
    if (!inTarget) continue;
    const rank = (Number(result.score) || 0)
      + (inTarget ? 1000 : 0)
      + (exactTitle ? 250 : 0)
      + (hasLessonInPageText ? 180 : 0)
      + (exactLessonQuery && lessonStart ? 220 : 0)
      + (guideFocusHeading ? 240 : 0)
      + (guideLessonHeading ? 120 : 0)
      // A teacher-guide directory label is copied onto every page in the
      // lesson window. Pages that only mention a neighboring text (for
      // example another 岳阳楼 poem) must not outrank the lesson treatment.
      - (exactLessonQuery && result.documentId === 'teacher-guide' && !hasLessonInPageText && !guideFocusHeading && !guideLessonHeading ? 180 : 0);
    decorated.push({ result, rank, inTarget });
  }
  // Once a concrete lesson is recognized, an empty filtered set is stronger
  // evidence of a retrieval miss than a fallback to unrelated pages.
  if (!decorated.length) return [];
  return decorated
    .sort((a, b) => b.rank - a.rank || Number(a.result.pdfPage) - Number(b.result.pdfPage))
    .map(item => item.result);
}

function hasLessonTargetHit(results = [], query, scope) {
  const targets = lessonTargetsForQuery(query, scope);
  if (!targets.length) return results.some(result => hasQueryCoverage(result, query));
  return results.some(result => targets.some(target => {
    if (target.documentId !== result.documentId) return false;
    const page = Number(result.pdfPage);
    const heading = clean(`${result.title || ''}${(result.sectionPath || []).join('')}`);
    return Number.isInteger(page) && page >= target.startPage && page <= target.endPage;
  }));
}

/**
 * PageIndex is the active provider.  The immutable public textbook snapshot
 * is used only as a page-level correction when the remote result misses a
 * clearly recognized lesson.  This prevents a valid but broad remote hit
 * (for example a table of contents) from hiding the actual lesson page.
 */
async function correctRecognizedLessonMiss(results = [], input = {}) {
  const query = String(input.query || input.question || '').trim();
  const requestedScope = input.scope ?? input.documentIds;
  const scope = requestedScope;
  const targets = lessonTargetsForQuery(query, scope);
  // A no-scope provider call is a generic low-level lookup.  Do not add
  // snapshot hits there; the teacher-facing search/ask flows always state
  // their intended material scope explicitly.
  if (!query || requestedScope == null || !targets.length) return results;
  // A broad remote result can hit the student textbook but still omit the
  // matching teacher-guide pages.  For an explicitly named lesson, fill only
  // the missing document side from the immutable verified snapshot.  This
  // keeps the self-hosted service primary while preserving the expected
  // "原文 + 教师用书参考" reading path.
  const missingDocuments = [...new Set(targets.map(target => target.documentId).filter(documentId => !results.some(result =>
    result.documentId === documentId && hasLessonTargetHit([result], query, [documentId])
  )))];
  if (!missingDocuments.length) return results;

  const snapshot = await new LocalFullTextIndexProvider().search({
    query,
    scope: missingDocuments,
    limit: Math.max(24, clampLimit(input.limit ?? input.topK, 8) * 3)
  });
  const corrected = rerankProviderResults(snapshot.results || [], query, scope)
    // A recognized shorthand can identify the lesson without appearing as a
    // contiguous phrase on the page (for example “巴特勒信” vs “巴特勒上尉的信”).
    // Keep only verified pages inside that lesson window; do not require the
    // shorthand itself to be copied verbatim into the source text.
    .filter(result => hasQueryCoverage(result, query)
      || hasLessonTargetHit([result], query, [result.documentId]))
    .map(result => ({
      ...result,
      providerMetadata: { ...(result.providerMetadata || {}), rankCorrection: 'verified_snapshot' }
    }));
  if (!corrected.length) return results;

  // Keep the result list useful for teaching: put a small teacher-guide
  // correction block first, then retain the provider's original textbook hit
  // near the top instead of burying the source text below an entire guide.
  const leadingCorrections = [];
  const correctionCounts = new Map();
  const remainingCorrections = [];
  for (const result of corrected) {
    const count = correctionCounts.get(result.documentId) || 0;
    if (count < 1) {
      leadingCorrections.push(result);
      correctionCounts.set(result.documentId, count + 1);
    } else {
      remainingCorrections.push(result);
    }
  }
  const seen = new Set();
  return [...leadingCorrections, ...results, ...remainingCorrections].filter(result => {
    const key = `${result.documentId}:${result.pdfPage}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requestsCurriculumStandard(input = {}) {
  return providerScopePayload(input.scope ?? input.documentIds).includes('curriculum-standard');
}

async function curriculumSnapshotResults(input = {}, mode = 'search') {
  if (!requestsCurriculumStandard(input)) return [];
  const query = String(input.query || input.question || '').trim();
  if (!query) return [];
  const local = new LocalFullTextIndexProvider();
  const request = {
    query,
    scope: ['curriculum-standard'],
    limit: Math.max(6, clampLimit(input.limit ?? input.topK, mode === 'search' ? 12 : 8))
  };
  const response = mode === 'retrieve' ? await local.retrieve(request) : await local.search(request);
  return (response.results || []).filter(result => hasQueryCoverage(result, query)).map(result => ({
    ...result,
    providerMetadata: {
      ...(result.providerMetadata || {}),
      source: 'verified_curriculum_snapshot',
      officialDocument: true
    }
  }));
}

function mergeDistinctResults(primary = [], supplements = []) {
  const seen = new Set();
  return [...primary, ...supplements].filter(result => {
    const key = `${result?.documentId || ''}:${Number(result?.pdfPage) || 0}`;
    if (!result?.documentId || !Number(result?.pdfPage) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function buildEvidenceAnswer({ provider, question, teachingFocus = '', scope, results, history = [], teacherReflectionContext = '', deepseek, lessonContext, lessonIdentity, followUpInstruction, operation, retrieveMore, retrievalMeta = {}, deadlineAt }) {
  // ReAct belongs to the answer boundary, not to the PageIndex request body.
  // It may ask the active provider for one or two narrower page searches when
  // the first retrieval is broad or empty. This is also what makes a follow-up
  // question behave like a real agentic RAG turn instead of a second isolated
  // keyword lookup.
  const react = await runReActRetrieval({
    question,
    scope: providerScopePayload(scope),
    evidence: safeEvidence(results),
    history,
    teacherReflectionContext,
    lessonIdentity,
    env: process.env,
    deepseek,
    retrieveMore,
    deadlineAt
  });
  const safeResults = safeEvidence(react.evidence);
  // Combined teacher work should start from the teacher guide's handling,
  // then verify it against the student textbook. Preserve ranking within each
  // source so this is a source-priority rule, not a new relevance score.
  const normalizedResults = safeResults.map(item => ({ ...item, documentType: normalizeDocumentType(item.documentType) }));
  const evidence = [
    ...normalizedResults.filter(item => item.documentType === 'teacher_guide').slice(0, 2),
    ...normalizedResults.filter(item => item.documentType === 'textbook').slice(0, 2),
    ...normalizedResults.filter(item => item.documentType === 'curriculum_standard').slice(0, 2),
    ...normalizedResults.filter(item => !['teacher_guide', 'textbook', 'curriculum_standard'].includes(item.documentType)).slice(0, 2)
  ].slice(0, 8);
  if (!evidence.length) {
    return {
      provider,
      generation: 'blocked-no-evidence',
      evidenceSufficient: false,
      question,
      conversation: {
        historyUsed: Array.isArray(history) && history.length > 0,
        historyTurns: Math.floor((Array.isArray(history) ? history.length : 0) / 2),
        lessonTitle: lessonIdentity?.title || ''
      },
      ...retrievalMeta,
      understanding: `没有找到足以支撑“${question}”的相关页面。`,
      answer: null,
      route: { scopes: providerScopePayload(scope), documents: [], sectionPaths: [], pageRanges: [], retrievalSteps: ['读取教材结构', '未找到足够的相关页面'], matchedNodes: [], evidenceCount: 0 },
      citations: [],
      sourceCoverage: deriveSourceCoverage([]),
      reactTrace: react.trace,
      sections: [{ title: '依据不足', text: '当前材料中没有找到足以支撑回答的原始教材依据，未生成结论。请调整关键词或搜索范围。', citations: [] }]
    };
  }
  const textbook = evidence.filter(item => item.documentType === 'textbook');
  const guide = evidence.filter(item => item.documentType === 'teacher_guide');
  const standard = evidence.filter(item => item.documentType === 'curriculum_standard');
  const sourceCoverage = deriveSourceCoverage(evidence);
  const citations = items => items.slice(0, 3).map(item => ({
    documentId: item.documentId,
    documentTitle: item.documentTitle,
    documentType: item.documentType,
    pdfPage: item.pdfPage,
    pageNumber: item.pdfPage,
    printedPage: item.printedPage,
    sectionPath: item.sectionPath,
    text: item.text,
    quote: item.quote,
    textSource: item.textSource,
    qualityStatus: item.qualityStatus,
    viewer: item.viewer,
    pdfUrl: item.viewer.pdfUrl,
    nodeId: item.nodeId,
    title: item.title
  }));
  const summary = items => items.slice(0, 2).map(item => item.quote.replace(/\s+/g, ' ')).join('；');
  const route = { scopes: providerScopePayload(scope), matchedNodes: [...new Set(evidence.map(item => item.nodeId).filter(Boolean))], evidenceCount: evidence.length };
  const extractiveSections = [
    { title: '问题理解', text: `围绕“${question}”定位课程标准、学生教材与教师教学用书中的直接依据，并区分原文事实与教学推导。`, citations: [] },
    { title: '课程标准依据', text: standard.length ? summary(standard) : '本次未定位到课程标准直接依据；不会把教学推断写成课程标准原文。', citations: citations(standard) },
    { title: '学生教材依据', text: textbook.length ? summary(textbook) : '本次未找到足够的学生教材直接依据。', citations: citations(textbook) },
    { title: '教师用书依据', text: guide.length ? summary(guide) : '本次未找到足够的教师教学用书直接依据。', citations: citations(guide) },
    { title: '基于依据的教学解释', text: '建议先让学生定位并朗读引用页面中的关键语句，再通过比较、追问和书面表达说明结论来自何处。该建议仅基于上列可核验材料，不补写材料中未出现的页码或结论。', citations: citations(evidence) },
    { title: '可加入一课三卡', text: '可将关键语句加入板书卡，将“结论从哪里来”加入提问卡，并把“能够引用原文说明理由”加入评价卡。', citations: citations(evidence.slice(0, 2)) }
  ];
  const grounded = await generateGroundedAnswer({ question, teachingFocus, scope: route.scopes, evidence, history, teacherReflectionContext, deepseek, lessonContext, lessonIdentity, followUpInstruction, operation, reactResult: react, deadlineAt });
  return {
    provider,
    generation: grounded?.generation || 'evidence-first-extractive',
    evidenceSufficient: true,
    question,
    conversation: {
      historyUsed: Array.isArray(history) && history.length > 0,
      historyTurns: Math.floor((Array.isArray(history) ? history.length : 0) / 2),
      lessonTitle: lessonIdentity?.title || grounded?.answer?.lesson?.title || ''
    },
    ...retrievalMeta,
    route: {
      ...route,
      ...(grounded?.route || {}),
      scopes: route.scopes,
      matchedNodes: route.matchedNodes,
      evidenceCount: route.evidenceCount,
      reactTrace: grounded?.reactTrace || react.trace || []
    },
    understanding: grounded?.understanding || `围绕“${question}”定位教材与教师教学用书中的直接依据。`,
    reactTrace: grounded?.reactTrace || react.trace || [],
    generationTrace: grounded?.generationTrace || [],
    generationRounds: grounded?.generationRounds || 0,
    answer: grounded?.answer || {
      type: 'extractive',
      reply: '先回到教材原页定位关键语句，再组织课堂解释。',
      summary: '建议先回到原始页面定位关键语句，再组织课堂解释。',
      lessonPosition: '',
      objectives: [],
      keyPoints: [],
      lessonPlan: [],
      questionChain: [],
      homework: [],
      assessment: [],
      evidenceRefs: evidence.slice(0, 3).map((_, index) => `E${index + 1}`),
      sourceLayers: {
        curriculumStandard: { label: '课程标准直接要求', available: standard.length > 0, summary: standard.length ? summary(standard) : '本次没有定位到课程标准原文。', citationIds: standard.map(item => `E${evidence.indexOf(item) + 1}`) },
        teacherGuide: { label: '教师用书参考处理', available: guide.length > 0, summary: guide.length ? summary(guide) : '本次没有定位到教师用书的直接处理建议。', citationIds: guide.slice(0, 3).map((_, index) => `E${evidence.indexOf(guide[index]) + 1}`) },
        textbook: { label: '学生教材原文依据', available: textbook.length > 0, summary: textbook.length ? summary(textbook) : '本次没有定位到学生教材的直接原文依据。', citationIds: textbook.slice(0, 3).map((_, index) => `E${evidence.indexOf(textbook[index]) + 1}`) },
        synthesis: { label: '基于三类材料的备课建议', available: true, summary: '课程标准限定学段要求，教师用书提供教学处理，学生教材锁定课堂原文。', citationIds: evidence.slice(0, 4).map((_, index) => `E${index + 1}`) }
      }
    },
    citations: grounded?.citations || citations(evidence),
    sourceCoverage,
    cardSuggestions: grounded?.cardSuggestions || undefined,
    model: grounded?.model,
    sections: grounded?.sections || extractiveSections,
    threeCardSuggestions: grounded?.threeCardSuggestions || undefined
  };
}

export class LocalFullTextIndexProvider {
  id = 'local-fulltext';
  label = 'LocalFullTextIndexProvider';

  async healthCheck() { return { provider: this.id, status: 'healthy', mode: 'fixture' }; }
  async createDocument(input = {}) {
    const documentId = String(input.id || input.documentId || id('doc'));
    if (!mutableDocuments.has(documentId) && !documentRecord(documentId)) {
      mutableDocuments.set(documentId, {
        id: documentId,
        title: input.title || input.originalFilename || documentId,
        documentType: documentType(documentId, input.documentType),
        originalFilename: input.originalFilename || null,
        pageCount: Number(input.pageCount || 0),
        pdfUrl: input.pdfUrl || '',
        pdfStatus: 'registered',
        indexStatus: 'pending',
        createdAt: now(),
        updatedAt: now()
      });
    }
    return { provider: this.id, document: documentRecord(documentId) };
  }
  async startIndex(documentId, options = {}) {
    const document = documentRecord(documentId);
    if (!document) throw new Error('document_not_found');
    const pageCount = pagesFor(documentId).length || Number(document.pageCount || 0);
    const job = {
      id: id('job'), jobId: null, provider: this.id, documentId, type: 'index', status: pageCount ? 'ready' : 'partial',
      stage: pageCount ? 7 : 1, stageName: pageCount ? '可用于问答和三卡生成' : '等待页面解析', totalPages: pageCount,
      processedPages: pageCount, successPages: pageCount, warningPages: 0, failedPages: 0, options, createdAt: now(), updatedAt: now()
    };
    job.jobId = job.id;
    jobs.set(job.id, job);
    return job;
  }
  async getJob(jobId) { const job = jobs.get(jobId); if (!job) throw new Error('job_not_found'); return job; }
  async getDocument(documentId) {
    const document = documentRecord(documentId);
    if (!document) throw new Error('document_not_found');
    return { provider: this.id, status: document.indexStatus || 'ready', document };
  }
  async getStatus(documentId) {
    if (documentId) return this.getDocument(documentId);
    const documents = allDocumentIds().map(documentRecord).filter(Boolean);
    return { provider: this.id, status: 'ready', indexedPages: documents.reduce((sum, doc) => sum + Number(doc.indexedPages || doc.pageCount || pagesFor(doc.id).length || 0), 0), documents };
  }
  async ingest(input = {}) {
    if (!input.documentId && !input.id && !input.title && !input.originalFilename) return this.getStatus();
    const created = await this.createDocument(input);
    if (input.build === false) return created;
    return this.startIndex(created.document.id, input);
  }
  async getTree(documentId) {
    const document = documentRecord(documentId);
    if (!document) throw new Error('document_not_found');
    return { provider: this.id, document: { ...document, tree: undefined }, tree: manifest.documents.find(doc => doc.id === documentId)?.tree || [] };
  }
  async getPage(documentId, pageNumber) {
    if (!documentRecord(documentId)) throw new Error('document_not_found');
    const page = pageByNumber(documentId, pageNumber);
    if (!page) throw new Error('page_not_found');
    const result = normalizeSearchResult({ ...page, pdfPage: page.pageNumber, text: page.retrievalText || page.text, quote: page.retrievalText || page.text }, this.id);
    return { provider: this.id, page: { ...page, ...result, retrievalText: result.text, selectedTextSource: result.textSource, textQualityStatus: result.qualityStatus } };
  }
  async search({ query, scope, limit = 12, nodeId } = {}) {
    const q = String(query || '').trim();
    const scopes = normalizeScope(scope);
    if (!q) return { provider: this.id, query: q, scope: scopes, total: 0, results: [] };
    const terms = queryTerms(q);
    const normalizedQuery = clean(q);
    const results = [];
    for (const documentId of scopes) {
      for (const page of pagesFor(documentId)) {
        if (page.includeInIndex === false || page.textQualityStatus === 'failed') continue;
        if (nodeId && page.nodeId !== nodeId) continue;
        const sourceText = page.retrievalText || page.text || '';
        const normalizedTitle = clean(page.title);
        const normalizedText = clean(sourceText);
        let score = 0;
        const matchedTerms = [];
        if (normalizedQuery && normalizedTitle.includes(normalizedQuery)) score += 180;
        if (normalizedQuery && normalizedText.includes(normalizedQuery)) score += 90 + Math.min(40, countOccurrences(normalizedText, normalizedQuery) * 8);
        for (const term of terms) {
          const token = clean(term);
          if (!token) continue;
          const titleHits = countOccurrences(normalizedTitle, token);
          const textHits = countOccurrences(normalizedText, token);
          if (titleHits || textHits) { matchedTerms.push(term); score += titleHits * (22 + term.length * 6) + textHits * (3 + term.length * 1.8); }
        }
        if (!score) continue;
        if (Number(page.charCount || sourceText.length) > 500) score += 2;
        results.push(normalizeSearchResult({ ...page, pdfPage: page.pageNumber, text: bestQuote(sourceText, q, matchedTerms), quote: bestQuote(sourceText, q, matchedTerms), score: Number(score.toFixed(2)), matchedTerms }, this.id));
      }
    }
    results.sort((a, b) => (b.score || 0) - (a.score || 0) || a.pdfPage - b.pdfPage);
    // Apply the same lesson/person reranking to the verified snapshot as the
    // self-hosted provider.  This keeps a direct author search from being
    // dominated by unrelated unit introductions that happen to mention the
    // same person.
    const ranked = rerankProviderResults(results, q, scopes);
    return { provider: this.id, query: q, scope: scopes, total: ranked.length, results: ranked.slice(0, clampLimit(limit)) };
  }
  async retrieve({ query, question, scope, limit = 8, ...rest } = {}) {
    const requested = String(query || question || '').trim();
    if (!requested) throw new Error('query_required');
    const search = await this.search({ query: requested, scope, limit, ...rest });
    const evidence = safeEvidence(search.results).filter(result => hasQueryCoverage(result, requested));
    return { provider: this.id, query: requested, scope: search.scope, evidenceSufficient: evidence.length > 0, total: evidence.length, results: evidence };
  }
  async ask({ question, retrievalQuery, teachingFocus = '', scope, limit = 8, history = [], teacherReflectionContext = '', deepseek, lessonContext, lessonIdentity, followUpInstruction, operation, deadlineAt } = {}) {
    const query = String(question || '').trim();
    if (!query) throw new Error('question_required');
    const lookup = lessonAwareLookup(retrievalQuery, query, lessonIdentity) || query;
    const retrieved = await this.retrieve({ question: lookup, scope, limit });
    return buildEvidenceAnswer({
      provider: this.id,
      question: query,
      teachingFocus,
      scope: retrieved.scope,
      results: retrieved.results,
      history,
      teacherReflectionContext,
      deepseek,
      lessonContext,
      lessonIdentity,
      followUpInstruction,
      operation,
      deadlineAt,
      retrieveMore: nextQuery => this.retrieve({
        query: lessonAwareLookup(nextQuery, query, lessonIdentity),
        scope: retrieved.scope,
        limit
      }).then(value => value.results),
    });
  }
  async rerunPages(documentId, input = {}) {
    if (!documentRecord(documentId)) throw new Error('document_not_found');
    const requested = Array.isArray(input.pages) ? input.pages.map(Number) : [];
    const start = Number(input.startPage || input.start || 0);
    const end = Number(input.endPage || input.end || start);
    const pages = requested.length ? requested : start > 0 ? Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index) : [];
    if (!pages.length) throw new Error('pages_required');
    const invalid = pages.filter(page => !pageByNumber(documentId, page));
    if (invalid.length) throw new Error('page_not_found');
    const job = { id: id('job'), jobId: null, provider: this.id, documentId, type: 'page-rerun', status: 'ready', stage: 3, stageName: '文本提取与扫描页识别', totalPages: pages.length, processedPages: pages.length, successPages: pages.length, warningPages: 0, failedPages: 0, pages, options: { extractionPolicy: input.extractionPolicy || 'auto' }, createdAt: now(), updatedAt: now() };
    job.jobId = job.id;
    jobs.set(job.id, job);
    return job;
  }
  async updatePage(documentId, pageNumber, patch = {}) {
    const existing = pageByNumber(documentId, pageNumber);
    if (!existing) throw new Error('page_not_found');
    const allowed = ['printedPage', 'printedPageLabel', 'pageTitle', 'title', 'sectionPath', 'retrievalText', 'includeInIndex', 'textQualityStatus', 'qualityFlags'];
    const update = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
    const next = { ...existing, ...update, pageNumber: Number(existing.pageNumber), documentId: existing.documentId };
    if ('printedPageLabel' in update) next.printedPage = update.printedPageLabel;
    if ('pageTitle' in update) next.title = update.pageTitle;
    pageOverrides.set(`${documentId}:${Number(pageNumber)}`, next);
    return this.getPage(documentId, pageNumber);
  }
  async validate(documentId, input = {}) {
    const document = documentRecord(documentId);
    if (!document) throw new Error('document_not_found');
    const pages = pagesFor(documentId);
    const failed = pages.filter(page => page.textQualityStatus === 'failed');
    const excluded = pages.filter(page => page.includeInIndex === false);
    const validPages = pages.filter(page => page.includeInIndex !== false && page.textQualityStatus !== 'failed' && String(page.retrievalText || page.text || '').trim());
    const requestedQuestions = Array.isArray(input.questions) ? input.questions : [];
    const questionResults = [];

    for (const entry of requestedQuestions) {
      const config = typeof entry === 'string' ? { question: entry } : (entry || {});
      const question = String(config.question || config.query || '').trim();
      if (!question) continue;
      const retrieved = await this.retrieve({ query: question, scope: [documentId], limit: Number(config.limit) || 5 });
      const hit = retrieved.results[0] || null;
      const expectedPages = (config.expectedPdfPages || config.expectedPages || []).map(Number).filter(Number.isFinite);
      const expectedDocumentId = config.expectedDocumentId ? String(config.expectedDocumentId) : null;
      const expectedMatch = Boolean(hit)
        && (!expectedDocumentId || hit.documentId === expectedDocumentId)
        && (!expectedPages.length || expectedPages.includes(Number(hit.pdfPage)));
      questionResults.push({
        question,
        passed: Boolean(retrieved.evidenceSufficient && hit && expectedMatch),
        evidenceSufficient: Boolean(retrieved.evidenceSufficient),
        expected: { documentId: expectedDocumentId, pdfPages: expectedPages },
        hit: hit ? {
          documentId: hit.documentId,
          documentTitle: hit.documentTitle,
          documentType: hit.documentType,
          pdfPage: hit.pdfPage,
          printedPage: hit.printedPage,
          sectionPath: hit.sectionPath,
          text: hit.text,
          textSource: hit.textSource,
          qualityStatus: hit.qualityStatus,
          score: hit.score,
          viewer: hit.viewer
        } : null
      });
    }

    const questionStatus = questionResults.length ? (questionResults.every(item => item.passed) ? 'passed' : 'failed') : 'not_run';
    const checks = {
      pageMapping: { passed: pages.every((page, index) => Number(page.pageNumber) === index + 1), total: pages.length },
      retrievablePages: { passed: validPages.length > 0, valid: validPages.length, failed: failed.length },
      exclusions: { passed: true, count: excluded.length },
      treeRanges: { passed: (flatTrees.get(documentId) || []).every(node => Number(node.startPage) > 0 && Number(node.endPage) >= Number(node.startPage)) },
      standardQuestions: {
        passed: questionStatus === 'passed',
        status: questionStatus,
        requested: requestedQuestions.length,
        run: questionResults.length,
        passedCount: questionResults.filter(item => item.passed).length,
        mode: 'local-provider'
      }
    };
    const requiredChecksPass = checks.pageMapping.passed && checks.retrievablePages.passed && checks.treeRanges.passed && questionStatus === 'passed';
    const status = validPages.length === 0 ? 'failed' : requiredChecksPass ? 'ready' : 'partial';
    const result = { provider: this.id, providerKind: 'local', documentId, status, checkedAt: now(), checks, questionResults };
    validations.set(documentId, result);
    return result;
  }
  async getValidation(documentId) {
    if (!documentRecord(documentId)) throw new Error('document_not_found');
    return validations.get(documentId) || { provider: this.id, documentId, status: 'not_run', checkedAt: null, checks: {} };
  }
  async deleteDocument(documentId) {
    if (!mutableDocuments.has(documentId)) throw new Error('operation_not_supported_for_fixture_document');
    mutableDocuments.delete(documentId);
    return { provider: this.id, documentId, deleted: true };
  }
}

export class PageIndexProvider {
  id = 'pageindex';
  label = 'PageIndexProvider';
  constructor({ baseUrl, apiKey, timeoutMs = 30000, apiPrefix = '/internal/v1' } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.apiKey = String(apiKey || '');
    this.timeoutMs = Number(timeoutMs) || 30000;
    this.apiPrefix = `/${String(apiPrefix || '/internal/v1').replace(/^\/+|\/+$/g, '')}`;
    // Public bundled教材可在 PageIndex 短暂不可用时使用已核验快照；私人文档仍
    // 被 canUseRuntimeFallback 拒绝，避免把账号私有内容混入公共兜底。
    this.allowRuntimeFallback = String(process.env.ALLOW_INDEX_PROVIDER_RUNTIME_FALLBACK ?? 'true').trim().toLowerCase() === 'true';
  }
  get configured() { return Boolean(this.baseUrl); }
  async request(path, options = {}) {
    if (!this.configured) throw new Error('pageindex_unavailable');
    const { retry = false, ...fetchOptions } = options;
    const attempts = retry ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          ...fetchOptions, signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}), ...(fetchOptions.headers || {}) }
        });
        if (!response.ok) throw pageIndexErrorForStatus(Number(response.status) || 0);
        const body = await response.json().catch(() => null);
        if (!body || typeof body !== 'object') throw pageIndexError('pageindex_invalid_response');
        return body;
      } catch (error) {
        const normalized = error?.code ? error : error?.name === 'AbortError'
          ? pageIndexError('pageindex_timeout', { retryable: true })
          : pageIndexError('pageindex_request_failed', { retryable: true });
        if (normalized.retryable && attempt + 1 < attempts) {
          await new Promise(resolve => setTimeout(resolve, 180));
          continue;
        }
        throw normalized;
      } finally { clearTimeout(timer); }
    }
    throw pageIndexError('pageindex_request_failed', { retryable: true });
  }
  healthCheck() { return this.request('/healthz', { retry: true }); }
  createDocument(input) { return this.request(`${this.apiPrefix}/indexes`, { method: 'POST', body: JSON.stringify({ operation: 'register', ...input }) }); }
  startIndex(documentId, options = {}) { return this.request(`${this.apiPrefix}/indexes`, { method: 'POST', body: JSON.stringify({ operation: 'build', documentId, ...options }) }); }
  getJob(jobId) { return this.request(`${this.apiPrefix}/jobs/${encodeURIComponent(jobId)}`); }
  getDocument(documentId) { return this.request(`${this.apiPrefix}/indexes/${encodeURIComponent(documentId)}`); }
  getStatus(documentId) { return documentId ? this.getDocument(documentId) : this.request(`${this.apiPrefix}/indexes`); }
  async ingest(input = {}) {
    const documentId = String(input.documentId || input.id || '').trim();
    if (!documentId) throw pageIndexError('document_not_found');
    // PDF bytes are accepted only at this server-to-server boundary. The
    // browser never receives or submits provider-specific OCR payloads.
    if (input.pdfBase64) {
      return this.request(`${this.apiPrefix}/ingest`, {
        method: 'POST',
        body: JSON.stringify({
          documentId,
          documentTitle: input.title || input.documentTitle || documentId,
          documentType: input.documentType || 'other',
          extractionPolicy: input.extractionPolicy || 'auto',
          pdfBase64: String(input.pdfBase64),
          pdfUrl: input.pdfUrl || '',
          originalFilename: input.originalFilename || null,
          originalObjectKey: input.originalObjectKey || null,
          metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
        })
      });
    }
    return this.startIndex(documentId, {
      extractionPolicy: input.extractionPolicy || 'auto',
      documentType: input.documentType || 'other'
    });
  }
  getTree(documentId) { return this.request(`${this.apiPrefix}/indexes/${encodeURIComponent(documentId)}/tree`); }
  getPage(documentId, pageNumber) { return this.request(`${this.apiPrefix}/indexes/${encodeURIComponent(documentId)}/pages/${Number(pageNumber)}`); }
  async search(input = {}) {
    const payload = pageIndexRetrievePayload(input, 'search');
    const remotePayload = { ...payload, documentIds: payload.documentIds.filter(documentId => documentId !== 'curriculum-standard') };
    let body = { results: [] };
    if (remotePayload.documentIds.length) {
      try {
        body = await this.request(`${this.apiPrefix}/retrieve`, { method: 'POST', body: JSON.stringify(remotePayload), retry: true });
      } catch (error) {
        if (!this.canUseRuntimeFallback(input, error)) throw error;
        return this.stableFallback(input, 'search', error);
      }
    }
    const rawResults = filterResultsByDocumentIds(body.results || body.hits || [], remotePayload.documentIds);
    const query = input.query || input.question || '';
    const reranked = rerankProviderResults(
      rawResults.map(item => normalizeSearchResult(item, this.id)).filter(Boolean),
      query,
      input.scope
    );
    const primaryResults = centerPublicResultSnippets(
      await correctRecognizedLessonMiss(reranked, input),
      query
    );
    const results = mergeDistinctResults(primaryResults, await curriculumSnapshotResults(input, 'search'));
    const { results: _rawResults, hits: _rawHits, contexts: _rawContexts, ...metadata } = body;
    return {
      ...metadata,
      provider: this.id,
      query: input.query || '',
      scope: payload.documentIds,
      total: results.length,
      results: results.slice(0, clampLimit(input.limit ?? input.topK, 12))
    };
  }
  async retrieve(input = {}) {
    const payload = pageIndexRetrievePayload(input);
    const remotePayload = { ...payload, documentIds: payload.documentIds.filter(documentId => documentId !== 'curriculum-standard') };
    let body = { results: [] };
    if (remotePayload.documentIds.length) {
      try {
        body = await this.request(`${this.apiPrefix}/retrieve`, { method: 'POST', body: JSON.stringify(remotePayload), retry: true });
      } catch (error) {
        if (!this.canUseRuntimeFallback(input, error)) throw error;
        return this.stableFallback(input, 'retrieve', error);
      }
    }
    const rawResults = filterResultsByDocumentIds(body.results || body.hits || body.contexts || [], remotePayload.documentIds);
    const query = String(input.query || input.question || '').trim();
    const normalized = rerankProviderResults(
      rawResults.map(item => normalizeSearchResult(item, this.id)).filter(Boolean),
      query,
      input.scope || input.documentIds
    );
    const corrected = centerPublicResultSnippets(
      await correctRecognizedLessonMiss(normalized, input),
      query
    );
    const requestedLimit = clampLimit(input.limit ?? input.topK, 8);
    const curriculumResults = await curriculumSnapshotResults(input, 'retrieve');
    const curriculumQuota = Math.min(2, curriculumResults.length);
    const combined = mergeDistinctResults(
      corrected.slice(0, Math.max(0, requestedLimit - curriculumQuota)),
      curriculumResults.slice(0, curriculumQuota)
    );
    const results = safeEvidence(combined)
      .filter(result => !query || hasQueryCoverage(result, query))
      .slice(0, requestedLimit);
    const { results: _rawResults, hits: _rawHits, contexts: _rawContexts, ...metadata } = body;
    return { ...metadata, provider: this.id, query, scope: payload.documentIds, evidenceSufficient: results.length > 0, total: results.length, results };
  }
  async ask({ question, retrievalQuery, teachingFocus = '', scope, limit = 8, history = [], teacherReflectionContext = '', deepseek, lessonContext, lessonIdentity, followUpInstruction, operation, retrievalMode, deadlineAt } = {}) {
    const query = String(question || '').trim();
    if (!query) throw new Error('question_required');
    const lookup = lessonAwareLookup(retrievalQuery, query, lessonIdentity) || query;
    const retrieved = retrievalMode === 'stable_snapshot'
      ? await this.stableFallback({ query: lookup, scope, limit }, 'retrieve', pageIndexError('pageindex_manual_snapshot'))
      : await this.retrieve({ query: lookup, scope, limit });
    return buildEvidenceAnswer({
      provider: retrieved.provider || this.id,
      question: query,
      teachingFocus,
      scope: retrieved.scope || scope,
      results: retrieved.results,
      history,
      teacherReflectionContext,
      deepseek,
      lessonContext,
      lessonIdentity,
      followUpInstruction,
      operation,
      deadlineAt,
      retrieveMore: retrievalMode === 'stable_snapshot'
        ? undefined
        : nextQuery => this.retrieve({ query: lessonAwareLookup(nextQuery, query, lessonIdentity), scope: retrieved.scope || scope, limit }).then(value => value.results),
      retrievalMeta: retrieved.retrievalMode === 'stable_snapshot'
        ? { retrievalMode: retrieved.retrievalMode, fallbackLabel: retrieved.fallbackLabel, fallbackAt: retrieved.fallbackAt, fallbackReason: retrieved.fallbackReason }
        : {}
    });
  }
  canUseRuntimeFallback(input, error) {
    if (!this.configured || !this.allowRuntimeFallback || !isTransientPageIndexError(error)) return false;
    return this.isPublicSnapshotScope(input);
  }
  async stableFallback(input, mode, error) {
    if (!this.isPublicSnapshotScope(input)) throw pageIndexError('pageindex_unavailable');
    const local = new LocalFullTextIndexProvider();
    const response = mode === 'search' ? await local.search(input) : await local.retrieve(input);
    return {
      ...response,
      provider: 'local-fulltext-fallback',
      retrievalMode: 'stable_snapshot',
      fallbackLabel: '已核验教材快照',
      fallbackAt: now(),
      fallbackReason: error?.code || error?.message || 'pageindex_unavailable'
    };
  }
  isPublicSnapshotScope(input = {}) {
    const requested = input.scope ?? input.documentIds;
    const scope = providerScopePayload(requested);
    return scope.length > 0 && scope.every(documentId => Object.hasOwn(staticPageSets, documentId));
  }
  rerunPages(documentId, input = {}) { return this.request(`${this.apiPrefix}/indexes/${encodeURIComponent(documentId)}/refresh`, { method: 'POST', body: JSON.stringify(input) }); }
  updatePage(documentId, pageNumber, patch = {}) { return this.request(`${this.apiPrefix}/indexes/${encodeURIComponent(documentId)}/pages/${Number(pageNumber)}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
  validate(documentId, input = {}) { return this.request(`${this.apiPrefix}/indexes/${encodeURIComponent(documentId)}/validate`, { method: 'POST', body: JSON.stringify(input) }); }
  getValidation(documentId) { return this.request(`${this.apiPrefix}/indexes/${encodeURIComponent(documentId)}/validation`); }
  deleteDocument(documentId) { return this.request(`${this.apiPrefix}/indexes/${encodeURIComponent(documentId)}`, { method: 'DELETE' }); }
}

function pageIndexError(code, { status = 0, retryable = false } = {}) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  return error;
}
function isTransientPageIndexError(error) {
  return ['pageindex_unavailable', 'pageindex_timeout', 'pageindex_rate_limited', 'pageindex_request_failed'].includes(error?.code || error?.message);
}
function pageIndexErrorForStatus(status) {
  if (status === 401) return pageIndexError('pageindex_unauthorized', { status });
  if (status === 403) return pageIndexError('pageindex_forbidden', { status });
  if (status === 404) return pageIndexError('pageindex_not_found', { status });
  if (status === 405) return pageIndexError('pageindex_method_not_allowed', { status });
  if (status === 408 || status === 504) return pageIndexError('pageindex_timeout', { status, retryable: true });
  if (status === 422) return pageIndexError('pageindex_invalid_request', { status });
  if (status === 429) return pageIndexError('pageindex_rate_limited', { status, retryable: true });
  if (status >= 500) return pageIndexError('pageindex_unavailable', { status, retryable: true });
  return pageIndexError('pageindex_request_failed', { status });
}

function pageIndexRetrievePayload(input = {}, mode) {
  const query = String(input.query || input.question || '').trim();
  if (!query) throw pageIndexError('query_required');
  const payload = {
    query,
    documentIds: providerScopePayload(input.scope ?? input.documentIds),
    topK: clampLimit(input.limit ?? input.topK, 8),
    includeReview: input.includeReview !== false
  };
  if (mode) payload.mode = mode;
  return payload;
}

export function getIndexProvider() {
  const requested = String(process.env.DOCUMENT_INDEX_PROVIDER || 'local').toLowerCase();
  if (requested === 'pageindex') {
    const remote = new PageIndexProvider({ baseUrl: process.env.PAGEINDEX_BASE_URL, apiKey: process.env.PAGEINDEX_API_KEY, timeoutMs: process.env.PAGEINDEX_TIMEOUT_MS, apiPrefix: process.env.PAGEINDEX_API_PREFIX });
    if (remote.configured) return { provider: remote, requested, fallback: false };
    const allowFallback = String(process.env.ALLOW_INDEX_PROVIDER_FALLBACK || '').trim().toLowerCase() === 'true';
    if (allowFallback) {
      return { provider: new LocalFullTextIndexProvider(), requested, fallback: true, reason: 'pageindex_not_configured' };
    }
    // Keep provider selection non-throwing because the API handler resolves the
    // provider before its try/catch. The unconfigured remote fails every operation
    // with pageindex_unavailable, producing a sanitized 503 instead of silently
    // serving local fixture data.
    return { provider: remote, requested, fallback: false, reason: 'pageindex_not_configured' };
  }
  return { provider: new LocalFullTextIndexProvider(), requested: 'local', fallback: false };
}
export function getManifest() { return manifest; }
