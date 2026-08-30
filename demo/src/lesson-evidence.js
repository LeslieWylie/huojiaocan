const SOURCE_FIELDS = ['documentType', 'sourceType', 'type', 'documentId'];

function canonicalSource(value) {
  if (value === 'teacher_guide') return 'teacher-guide';
  if (value === 'teacher-guide' || value === 'textbook') return value;
  return '';
}

function sourceOf(result) {
  if (!result || typeof result !== 'object') return '';
  const sources = new Set();
  for (const field of SOURCE_FIELDS) {
    const source = canonicalSource(result[field]);
    if (source) sources.add(source);
  }
  return sources.size === 1 ? [...sources][0] : '';
}

function normalizeResult(result) {
  const normalized = { ...result };
  for (const field of SOURCE_FIELDS) {
    if (normalized[field] === 'teacher_guide') normalized[field] = 'teacher-guide';
  }
  return normalized;
}

/**
 * Pair the first valid textbook and teacher-guide results without reordering or
 * inferring missing physical PDF pages.
 */
export function pairLessonEvidence(results) {
  if (!Array.isArray(results)) return { textbook: null, teacherGuide: null };

  let textbook = null;
  let teacherGuide = null;

  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    if (!Number.isInteger(result.pdfPage) || result.pdfPage <= 0) continue;

    const source = sourceOf(result);
    if (source === 'textbook' && textbook === null) textbook = normalizeResult(result);
    if (source === 'teacher-guide' && teacherGuide === null) teacherGuide = normalizeResult(result);

    if (textbook && teacherGuide) return { textbook, teacherGuide };
  }

  return { textbook, teacherGuide };
}

export default pairLessonEvidence;
