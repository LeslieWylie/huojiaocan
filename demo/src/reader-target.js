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
    if (!text || /^PDF\s*第?\s*\d+\s*页$/iu.test(text) || /目录|封面|版权页/u.test(text)) continue;
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
    return { href: value, label: '返回原页面' };
  }
  if (value === 'library' || !value) {
    return { href: libraryHref || '/library/', label: '返回教材库' };
  }
  return READER_RETURN_TARGETS[value] || { href: libraryHref || '/library/', label: '返回教材库' };
}
