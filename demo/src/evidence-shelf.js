const STORAGE_PREFIX = 'huojiaocan.evidence-shelf.v1';

export function evidenceShelfKey(userId = 'guest') {
  return `${STORAGE_PREFIX}.${userId || 'guest'}`;
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
