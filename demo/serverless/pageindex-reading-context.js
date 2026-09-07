import { randomUUID } from 'node:crypto';

const START_KEYS = ['startPdfPage', 'start_pdf_page', 'startPage', 'start_page', 'pageStart', 'page_start', 'start_index'];
const END_KEYS = ['endPdfPage', 'end_pdf_page', 'endPage', 'end_page', 'pageEnd', 'page_end', 'end_index'];
const PAGE_KEYS = ['pdfPageNumber', 'pdf_page_number', 'pdfPage', 'pdf_page', 'pageNumber', 'page_number', 'page'];
const DOC_KEYS = ['documentId', 'document_id'];
const DOCUMENT_TYPES = { textbook: 'textbook', 'teacher-guide': 'teacher_guide', 'curriculum-standard': 'curriculum_standard' };
function documentType(documentId, value) {
  const type = DOCUMENT_TYPES[documentId] || String(value || '').replaceAll('-', '_');
  return ['textbook', 'teacher_guide', 'curriculum_standard', 'other'].includes(type) ? type : 'other';
}
const first = (object, keys) => keys.map(key => object?.[key]).find(value => value != null);
const physicalPage = value => (typeof value === 'number' || typeof value === 'string') && String(value).trim() && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const titleKey = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/^[《「\s]*(?:第\s*)?[一二三四五六七八九十百\d]+\s*课/u, '')
  .replace(/^[《「\s]*\d+[\s.、]*/u, '').replace(/[\s\p{P}\p{S}]/gu, '');

function sameDocument(object, documentId) {
  return DOC_KEYS.every(key => object?.[key] == null || object[key] === documentId);
}

// Retain only explicit server ranges. Missing ends are not guessed from the
// next sibling, printed-page labels, hit text, or local public snapshots.
function treeNodes(value, documentId, parentPath = [], seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || seen.has(value) || depth > 64 || seen.size >= 10000) return [];
  seen.add(value);
  if (Array.isArray(value)) return value.flatMap(item => treeNodes(item, documentId, parentPath, seen, depth + 1));
  if (!sameDocument(value, documentId) || (value.document?.id && value.document.id !== documentId)) return [];
  const title = String(value.title ?? value.name ?? value.sectionTitle ?? value.section_title ?? '').trim();
  const path = title ? [...parentPath, title] : parentPath;
  const children = ['children', 'nodes', 'tree', 'root', 'node', 'structure']
    .flatMap(key => treeNodes(value[key], documentId, path, seen, depth + 1));
  if (!title) return children;
  const start = physicalPage(first(value, START_KEYS));
  const end = physicalPage(first(value, END_KEYS));
  const consistentRange = (keys, expected) => keys.every(key => value[key] == null || physicalPage(value[key]) === expected);
  return [{
    title, summary: String(value.summary ?? value.description ?? value.node_summary ?? ''),
    nodeId: value.id ?? value.nodeId ?? value.node_id ?? null, path, children,
    start: start && end && end >= start && consistentRange(START_KEYS, start) && consistentRange(END_KEYS, end) ? start : null,
    end
  }];
}

function matchingLessons(nodes, identity) {
  return nodes.flatMap(node => titleKey(node.title) === identity
    ? (node.start ? [node] : [])
    : matchingLessons(node.children, identity));
}

function sectionsWithin(lesson) {
  const walk = node => {
    if (!node.start || node.start < lesson.start || node.end > lesson.end) return [];
    // A nested, separately numbered lesson is not a subsection of this one.
    if (node !== lesson && /^(?:第[一二三四五六七八九十百\d]+课|\d+[\s、.]+|《)/u.test(node.title)
      && titleKey(node.title) !== titleKey(lesson.title)) return [];
    return [node, ...node.children.flatMap(walk)];
  };
  return walk(lesson);
}

/**
 * Request-local capability, NOT an authorization layer: callers must provide
 * authenticated document IDs and the fixed lesson identity. Never derive scope
 * or lesson identity from the query, hits, a model tool argument, or a response.
 *
 * listSections() -> [{ sectionRef, title, summary, pageStart, pageEnd, documentType }]
 * readSection(sectionRef) -> unified page evidence[], with complete page text.
 * Invalid/missing nodes, provider failures and exhausted deadlines return [].
 * Attempts (including failures) share a four-page budget. Repeated calls advance
 * to unread pages; concurrent calls reserve pages before awaiting the provider.
 */
export function createReadingContext({ provider, scope = [], lessonIdentity, evidence = [], query = '', deadlineAt, normalizeResult = value => value } = {}) {
  const documentIds = [...new Set((Array.isArray(scope) ? scope : [scope]).filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))];
  const identity = titleKey(lessonIdentity?.title);
  const hits = (Array.isArray(evidence) ? evidence : []).map(item => ({ documentId: first(item, DOC_KEYS), page: physicalPage(first(item, PAGE_KEYS)), documentType: item.documentType || item.document_type }));
  const queryKey = titleKey(query);
  const expiresAt = Math.min(Date.now() + 30000, Number.isFinite(Number(deadlineAt)) && deadlineAt != null ? Number(deadlineAt) : Infinity);
  const expired = () => Date.now() >= expiresAt;
  const references = new Map();
  const attempted = new Set();
  let candidatesPromise;

  async function boundedRead(read) {
    if (expired()) return null;
    const requestDeadlineAt = Math.min(expiresAt, Date.now() + 4000);
    let timer;
    try {
      const pending = Promise.resolve().then(() => Date.now() >= requestDeadlineAt ? null : read(requestDeadlineAt));
      return await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, requestDeadlineAt - Date.now())); })]);
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  async function discover() {
    if (!identity || identity === titleKey('当前篇目') || expired()) return [];
    for (const documentId of documentIds) {
      const payload = await boundedRead(requestDeadlineAt => provider.getTree(documentId, { deadlineAt: requestDeadlineAt }));
      if (expired()) break;
      const lessons = matchingLessons(treeNodes(payload, documentId), identity);
      // Multiple same-title locations are ambiguous. Do not choose via model
      // prose or page guesses; a future contract can add trusted lesson node IDs.
      if (lessons.length !== 1) continue;
      const type = documentType(documentId, payload?.documentType || payload?.document_type || payload?.document?.documentType || payload?.document?.document_type || hits.find(hit => hit.documentId === documentId)?.documentType);
      for (const node of sectionsWithin(lessons[0])) {
        const sectionRef = `section_${randomUUID()}`;
        references.set(sectionRef, { ...node, documentId, documentType: type });
      }
    }
    return [...references].map(([sectionRef, node]) => ({ sectionRef, title: node.title, summary: node.summary, pageStart: node.start, pageEnd: node.end, documentType: node.documentType }))
      .sort((a, b) => Number(Boolean(queryKey && titleKey(b.title + b.summary).includes(queryKey))) - Number(Boolean(queryKey && titleKey(a.title + a.summary).includes(queryKey))));
  }

  async function listSections() {
    if (expired()) return [];
    candidatesPromise ??= discover();
    return (await candidatesPromise).map(candidate => ({ ...candidate }));
  }

  async function readSection(sectionRef) {
    // Unknown refs must not trigger even a catalogue fetch.
    if (typeof sectionRef !== 'string' || !references.has(sectionRef) || expired()) return [];
    const node = references.get(sectionRef);
    const anchor = hits.find(hit => hit.documentId === node.documentId && hit.page >= node.start && hit.page <= node.end)?.page ?? node.start;
    const pages = [];
    // With a global budget of four, looking at four neighbors on each side is
    // sufficient; never allocate an array proportional to a provider page range.
    for (let distance = 0; distance <= 4 && pages.length < 2; distance += 1) {
      for (const page of distance ? [anchor + distance, anchor - distance] : [anchor]) {
        const key = `${node.documentId}:${page}`;
        if (page < node.start || page > node.end || attempted.has(key)) continue;
        if (attempted.size >= 4 || pages.length >= 2) break;
        attempted.add(key);
        pages.push(page);
      }
    }
    const results = [];
    for (const requestedPage of pages) {
      if (expired()) break;
      const payload = await boundedRead(requestDeadlineAt => provider.getPage(node.documentId, requestedPage, { deadlineAt: requestDeadlineAt }));
      if (!payload || expired()) continue;
      const page = payload.page && typeof payload.page === 'object' ? payload.page : payload;
      const owners = [payload, page].flatMap(item => DOC_KEYS.filter(key => item[key] != null).map(key => item[key]));
      const numbers = [...new Set([payload, page])].flatMap(item => PAGE_KEYS.filter(key => item[key] != null && !(key === 'page' && typeof item[key] === 'object')).map(key => physicalPage(item[key])));
      if (!owners.length || owners.some(owner => owner !== node.documentId) || !numbers.length || numbers.some(number => number !== requestedPage)) continue;
      if ([payload.viewer, page.viewer].some(viewer => viewer?.page != null && physicalPage(viewer.page) !== requestedPage)) continue;
      const text = first(page, ['retrievalText', 'retrieval_text', 'text']);
      const qualityStatus = first(page, ['qualityStatus', 'quality_status', 'textQualityStatus']) || 'normal';
      if (typeof text !== 'string' || !text.trim() || qualityStatus === 'failed' || page.includeInIndex === false || page.include_in_index === false) continue;
      const title = first(page, ['pageTitle', 'page_title', 'title']) || node.title;
      const sectionPath = first(page, ['sectionPath', 'section_path']);
      const raw = {
        documentId: node.documentId, documentTitle: payload.documentTitle || payload.document_title || evidence.find(item => item?.documentId === node.documentId)?.documentTitle || ({ textbook: '学生教材', teacher_guide: '教师用书', curriculum_standard: '课程标准' }[node.documentType] || '当前教材'),
        documentType: node.documentType,
        pdfPage: requestedPage, pageNumber: requestedPage, id: `${node.documentId}-p${requestedPage}`,
        printedPage: first(page, ['printedPage', 'printed_page']), title,
        sectionPath: Array.isArray(sectionPath) && sectionPath.length ? [...sectionPath] : [...node.path],
        nodeId: node.nodeId, text, quote: text, readMode: 'full_page',
        textSource: first(page, ['textSource', 'text_source', 'selectedTextSource']) || 'native', qualityStatus,
        providerMetadata: { provider: provider.id || 'pageindex', readingContext: true, sectionRef }
      };
      const normalized = normalizeResult(raw);
      if (normalized) results.push({ ...normalized, readMode: 'full_page' });
    }
    return results;
  }

  return Object.freeze({ listSections, readSection });
}
