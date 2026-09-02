const STORAGE_PREFIX = 'huojiaocan.evidence-shelf.v1';

export function evidenceShelfKey(userId = 'guest', draftId = 'new') {
  const owner = encodeURIComponent(String(userId || 'guest'));
  const lesson = encodeURIComponent(String(draftId || 'new'));
  return `${STORAGE_PREFIX}.${owner}.${lesson}`;
}

function normalizedLessonTitle(value) {
  return String(value || '')
    .replace(/[《》]/gu, '')
    .replace(/^\s*\d+\s*/u, '')
    .replace(/\s+/gu, '')
    .trim();
}

/**
 * Older builds stored one evidence shelf per account, so opening another
 * lesson could show pages from the previous text. Keep non-textbook material,
 * but require textbook and teacher-guide pages to belong to the current
 * lesson or to the draft's verified citation set.
 */
export function evidenceShelfForLesson(items, { lessonTitle = '', citations = [] } = {}) {
  const title = normalizedLessonTitle(lessonTitle);
  const verifiedPages = new Set((Array.isArray(citations) ? citations : [])
    .filter(item => item?.documentId && Number(item?.pdfPage) > 0)
    .map(item => `${item.documentId}:${Number(item.pdfPage)}`));
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!['textbook', 'teacher-guide'].includes(String(item?.documentId || ''))) return true;
    if (verifiedPages.has(`${item.documentId}:${Number(item.pdfPage)}`)) return true;
    if (!title) return true;
    const identityText = [item?.title, item?.documentTitle, ...(Array.isArray(item?.sectionPath) ? item.sectionPath : [])]
      .map(normalizedLessonTitle)
      .join('');
    return identityText.includes(title);
  });
}

export function normalizeShelfItem(item) {
  if (!item || !item.documentId || !Number.isInteger(Number(item.pdfPage)) || Number(item.pdfPage) < 1) return null;
  return {
    id: item.id || `${item.documentId}:${item.pdfPage}`,
    documentId: String(item.documentId),
    documentTitle: item.documentTitle || '',
    documentType: item.documentType || 'other',
    pdfPage: Number(item.pdfPage),
    printedPage: item.printedPage || '',
    sectionPath: Array.isArray(item.sectionPath) ? item.sectionPath : [],
    text: String(item.text || ''),
    viewer: item.viewer || {}
  };
}

export function mergeEvidenceShelf(current, additions, maxItems = 12) {
  const merged = [];
  for (const item of [...(Array.isArray(additions) ? additions : []), ...(Array.isArray(current) ? current : [])]) {
    const normalized = normalizeShelfItem(item);
    if (!normalized) continue;
    const key = `${normalized.documentId}:${normalized.pdfPage}`;
    if (merged.some(existing => `${existing.documentId}:${existing.pdfPage}` === key)) continue;
    merged.push(normalized);
    if (merged.length >= maxItems) break;
  }
  return merged;
}

export function removeEvidenceShelfItem(current, documentId, pdfPage) {
  return (Array.isArray(current) ? current : []).filter(item => !(item.documentId === documentId && Number(item.pdfPage) === Number(pdfPage)));
}
