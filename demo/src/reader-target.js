export function validReaderPage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}

export function stripPdfHash(value) {
  return String(value || '').split('#')[0];
}

export function buildPdfPageUrl(value, page, { zoom = '', view = 'FitH' } = {}) {
  const base = stripPdfHash(value);
  const physicalPage = validReaderPage(page);
  if (!base || !physicalPage) return '';
  const params = new URLSearchParams({ page: String(physicalPage) });
  if (zoom) params.set('zoom', String(zoom));
  if (view) params.set('view', view);
  return `${base}#${params}`;
}

/**
 * The page endpoint returns page text in `page`, while the trusted PDF viewer
 * location belongs to the response envelope. Keep both together so the
 * reader does not depend on a second catalogue request before it can show the
 * original page.
 */
export function normalizeReaderPagePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const page = payload.page && typeof payload.page === 'object' ? payload.page : payload;
  const envelopeViewer = payload.viewer && typeof payload.viewer === 'object' ? payload.viewer : null;
  const pageViewer = page.viewer && typeof page.viewer === 'object' ? page.viewer : null;
  return {
    ...page,
    viewer: pageViewer || envelopeViewer,
    pdfUrl: page.pdfUrl || payload.pdfUrl || pageViewer?.pdfUrl || envelopeViewer?.pdfUrl || ''
  };
}

/**
 * Normalize a lesson title for cross-document matching.
 *
 * Strips lesson number prefix ("5 " / "21 "), book title marks, punctuation
 * and whitespace so that "5 你是人间的四月天" and "你是人间的四月天" match.
 * Operational phrases (e.g. "单元说明", "活动任务单") are left intact.
 * Teaching-action or question phrases ("换成两课时", "这篇课文怎么备课") return
 * empty so they are never written into lesson URLs or used for matching.
 */
export function normalizeLessonIdentity(value) {
  const result = String(value || '')
    .normalize('NFKC')
    .replace(/^\d+\s*/u, '')              // Remove leading lesson number e.g. "5 " or "21 "
    .replace(/[《》〈〉「」『』\s•，,。.!！?？:：;；“”"'‘’—_-]/gu, '')
    .replace(/[（(](?:复备|副本|复制|第\s*\d+\s*版)[）)]$/u, '')
    .toLowerCase()
    .trim();
  if (!result) return '';
  // Operational / question phrases are not lesson identities.
  if (/^(?:换成|调整为?|改为|改成)/u.test(result)) return '';
  if (/(?:怎么|如何|怎样)(?:备课|教|处理|上|设计|安排|搞)/u.test(result)) return '';
  return result;
}

/**
 * Recursively search a tree node list for the first node whose normalized
 * title matches `normalizedTitle`. Returns the node (with its startPage, id,
 * title) or null if no match is found.
 */
export function findTreeNodeByNormalizedTitle(nodes, normalizedTitle) {
  if (!Array.isArray(nodes) || !nodes.length || !normalizedTitle) return null;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const nodeNorm = normalizeLessonIdentity(node.title);
    if (nodeNorm === normalizedTitle) return node;
    const child = findTreeNodeByNormalizedTitle(node.children, normalizedTitle);
    if (child) return child;
  }
  return null;
}

/**
 * Given a target document id, the current lesson title and the current page,
 * look up the matching lesson node in the target document's tree.  Returns
 * `{ page, nodeId, lessonTitle }` — the resolved target page, node id and
 * display title — or the original page clamped to the target's pageCount
 * when no matching lesson node exists.
 *
 * @param {object}   opts
 * @param {string}   opts.targetDocId   Document id to switch into
 * @param {string}   opts.lessonTitle   Current lesson title (may be empty)
 * @param {number}   opts.pageNo        Current physical page in source doc
 * @param {object}   opts.treesCache   Map of docId → normalized tree array
 * @param {Array}    opts.docs          Document catalogue list
 * @returns {{ page: number, nodeId: string, lessonTitle: string }}
 */
export function resolveCrossDocTarget({ targetDocId, lessonTitle, pageNo, treesCache = {}, docs = [] } = {}) {
  const docId = String(targetDocId || '').trim();
  const currentPage = validReaderPage(pageNo) || 1;
  const target = docs.find(item => item.id === docId);
  const maxPage = Math.max(1, target?.pageCount || 1);
  const clamped = Math.min(maxPage, currentPage);

  if (!lessonTitle) {
    return { page: clamped, nodeId: '', lessonTitle: '' };
  }

  const normalized = normalizeLessonIdentity(lessonTitle);
  if (!normalized) {
    return { page: clamped, nodeId: '', lessonTitle: '' };
  }

  const targetTree = treesCache[docId];
  if (!targetTree) {
    // Tree not yet cached – report pending so the caller knows to
    // fetch the tree and retry.
    return { page: clamped, nodeId: '', lessonTitle, pending: true };
  }

  const match = findTreeNodeByNormalizedTitle(targetTree, normalized);
  if (match && match.startPage > 0) {
    // If the requested page is already within the matched lesson's range,
    // keep it — the teacher clicked a search result at that exact page.
    // Otherwise snap to the lesson start page.
    const inRange = currentPage >= match.startPage && currentPage <= match.endPage;
    return {
      page: inRange ? currentPage : match.startPage,
      nodeId: match.id || '',
      lessonTitle: match.title || lessonTitle
    };
  }

  // No matching lesson found in target document – keep the current page
  // clamped to the target's pageCount.
  return { page: clamped, nodeId: '', lessonTitle };
}

export function pairedDocumentId(value) {
  const id = String(value || '').trim();
  if (id === 'textbook') return 'teacher-guide';
  if (['teacher-guide', 'teacher_guide', 'guide'].includes(id)) return 'textbook';
  return '';
}

export function pairedLessonQuery({ explicitTitle = '', sectionPath = [], pageTitle = '' } = {}) {
  const candidates = [explicitTitle, ...(Array.isArray(sectionPath) ? [...sectionPath].reverse() : []), pageTitle];
  for (const value of candidates) {
    const text = String(value || '').trim().replace(/^(第[一二三四五六七八九十\d]+单元[·\s]*)/u, '');
    if (!text || /^(?:PDF\s*)?第\s*\d+\s*页$/iu.test(text) || /目录|封面|版权页/u.test(text)) continue;
    return text.slice(0, 80);
  }
  return '';
}

export function pairedFocusQuery({ lessonTitle = '', focus = '' } = {}) {
  const lesson = String(lessonTitle || '').replace(/\s+/gu, ' ').trim().slice(0, 80);
  const detail = String(focus || '')
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/(?:documentId|pdfPage|page|URL)\s*[:：=]\s*\S+/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 100);
  if (!detail || detail === lesson || lesson.includes(detail)) return lesson;
  return [lesson, detail].filter(Boolean).join(' ');
}

export function buildReaderHref({ documentId, page, nodeId = '', lessonTitle = '', focus = '', returnTo = '', scope = '', paired = false } = {}) {
  const doc = String(documentId || '').trim();
  const physicalPage = validReaderPage(page);
  if (!doc || !physicalPage) return '';
  const params = new URLSearchParams({ doc, page: String(physicalPage) });
  if (nodeId) params.set('node', String(nodeId));
  if (lessonTitle) params.set('lesson', String(lessonTitle));
  if (focus) params.set('focus', String(focus));
  if (scope) params.set('scope', String(scope));
  if (paired) params.set('paired', '1');
  if (returnTo) params.set('return', String(returnTo));
  return `/document/?${params}`;
}

/**
 * Build the hand-off from the library reader to the preparation workspace.
 * `scope` controls which materials are searched, while `documentId`/`page`
 * retain the lesson page the teacher was actually reading.  Keeping those
 * concepts separate prevents a source-card action from dropping the selected
 * lesson and starting an unrelated conversation.
 */
export function buildPreparationHref({ scope = 'both', documentId, page, nodeId = '', lessonTitle = '' } = {}) {
  const doc = String(documentId || '').trim();
  const physicalPage = validReaderPage(page);
  if (!doc || !physicalPage) return '/ask/';
  const params = new URLSearchParams({
    scope: String(scope || 'both'),
    doc,
    page: String(physicalPage)
  });
  if (nodeId) params.set('node', String(nodeId));
  if (lessonTitle) params.set('lesson', String(lessonTitle));
  return `/ask/?${params}`;
}

const READER_RETURN_TARGETS = Object.freeze({
  ask: { href: '/ask/', label: '返回本课问答' },
  cards: { href: '/cards/', label: '返回课堂设计' },
  unit: { href: '/unit/', label: '返回单元接力' },
  alignment: { href: '/alignment/', label: '返回课标对齐' },
  validation: { href: '/validation/', label: '返回质量检查' },
  share: { href: '/share/', label: '返回共备方案' }
});

/**
 * Resolve the page opened before the PDF reader.
 *
 * Full in-app paths take priority because they preserve draftId, filters and
 * share fragments. Symbolic targets are retained for older links. External or
 * protocol-relative paths are rejected so the reader never becomes an open
 * redirect.
 */
export function resolveReaderReturn(returnTarget, { libraryHref = '/library/' } = {}) {
  const value = String(returnTarget || '').trim();
  if (value.startsWith('/') && !value.startsWith('//')) {
    const pathname = value.split('?')[0];
    const label = pathname.startsWith('/ask/')
      ? '返回本课问答'
      : pathname.startsWith('/cards/')
        ? '返回一课三卡'
        : pathname.startsWith('/library/')
          ? '返回教材库'
          : '返回原页面';
    return { href: value, label };
  }
  if (value === 'library' || !value) {
    return { href: libraryHref || '/library/', label: '返回教材库' };
  }
  return READER_RETURN_TARGETS[value] || { href: libraryHref || '/library/', label: '返回教材库' };
}
