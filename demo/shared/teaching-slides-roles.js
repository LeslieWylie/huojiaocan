import { isTeachingSlideTemplate, paginateTemplateSlides, slideText } from './teaching-slides-pagination.js';

const copy = value => JSON.parse(JSON.stringify(value));
const escape = text => text.replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// V2-only contract, shared by generation, revision, save and export. Never slice
// notes: a teacher must be able to correct an over-limit input without losing it.
export function normalizeTeachingSlideNotes(value = []) {
  const notes = (Array.isArray(value) ? value : []).map(item => String(item ?? '').replace(/\r\n/gu, '\n').trim()).filter(Boolean);
  if (notes.length > 40 || notes.some(note => note.length > 8000) || notes.reduce((sum, note) => sum + note.length, 0) > 24000) {
    throw Object.assign(new Error('teaching_slides_notes_limit'), { code: 'teaching_slides_notes_limit', status: 422 });
  }
  return notes;
}

// This is the question-card format emitted by grounded-answer/card-generation,
// not a keyword classifier. Unstructured text, quotations and assessment criteria
// remain untouched; ambiguous/repeated role markers require teacher review.
export function splitTeachingQuestion(value) {
  const text = String(value ?? '');
  if (!/^(?:•\s*)?主问[:：]/u.test(text) || (text.match(/｜追问[:：]/gu) || []).length !== 1 || (text.match(/｜预期学生回应[:：]/gu) || []).length !== 1) return null;
  const match = /^(?:•\s*)?主问[:：][\s\S]+?｜追问[:：][\s\S]+?(｜预期学生回应[:：])([\s\S]+)$/u.exec(text);
  if (!match || !match[2].trim()) return null;
  return { studentText: text.slice(0, text.length - match[1].length - match[2].length).trim(), expectedResponse: match[2].trim() };
}

export function separateLegacyQuestionRoles(slide) {
  if (slide.kind !== 'questions') return slide;
  const responses = [];
  const body = slide.body.map((text, index) => {
    const parts = splitTeachingQuestion(text);
    if (!parts) return text;
    responses.push(`问题 ${index + 1}｜预期学生回应：${parts.expectedResponse}`);
    return parts.studentText;
  });
  return { ...slide, body, teacherNotes: normalizeTeachingSlideNotes([...(slide.teacherNotes || []), ...responses]) };
}

function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}

function titleElement(slide) { return slide.content.canvas.elements.find(element => element.id === `${slide.id}-title`); }

function sameTemplateContent(current, expected) {
  const content = copy(current.content);
  const title = content.canvas.elements.find(element => element.id === `${current.id}-title`), expectedTitle = titleElement(expected);
  if (!title || !expectedTitle || (title.content.match(/<(?:p|div|h[1-6]|li)\b/giu) || []).length !== 1 || /<br\b/iu.test(title.content)) return false;
  // Text editing auto-sizes this box. Preserve the current title, but do not
  // permit moved/resized/custom elements to masquerade as an untouched template.
  title.content = expectedTitle.content; title.height = expectedTitle.height;
  return same(content, expected.content) && same(current.metadata.citationIds, expected.metadata.citationIds) && same(current.metadata.teacherCitationIds, expected.metadata.teacherCitationIds);
}

function splitTemplate(slide) {
  const result = copy(slide), responses = [];
  const body = result.content.canvas.elements.filter(element => element.textType === 'item');
  body.forEach((element, index) => {
    const parts = splitTeachingQuestion(slideText(element.content));
    if (!parts) return;
    element.content = element.content.replace(/^(<div\b[^>]*>)[\s\S]*(<\/div>)$/u, (_, start, end) => `${start}${escape(parts.studentText)}${end}`);
    responses.push(`问题 ${index + 1}｜预期学生回应：${parts.expectedResponse}`);
  });
  result.summary = slideText(body[0]?.content || '');
  result.metadata.teacherNotes = normalizeTeachingSlideNotes([...result.metadata.teacherNotes, ...responses]);
  return { slide: result, responseCount: responses.length };
}

export function separateSavedQuestionRoles(base, histories = []) {
  const replacements = new Map(), consumed = new Set(), changedPages = [], protectedPages = [];
  const candidates = [...base.slides.filter(slide => slide.kind === 'questions' && isTeachingSlideTemplate(slide)).map(slide => ({ source: slide, expected: [slide] }))];
  // History is evidence, not authority: every current segment must still match
  // its deterministic template output before an old unsplit source can be used.
  for (const history of histories) {
    if (!Array.isArray(history?.slides)) continue;
    const expected = paginateTemplateSlides(history.slides).slides;
    for (const source of history.slides.filter(slide => slide.kind === 'questions' && isTeachingSlideTemplate(slide))) {
      candidates.push({ source, expected: expected.filter(slide => slide.id === source.id || slide.id.startsWith(`${source.id}-cont-`)) });
    }
  }
  for (const { source, expected } of candidates) {
    if (consumed.has(source.id) || !expected.length) continue;
    const indexes = expected.map(slide => base.slides.findIndex(current => current.id === slide.id));
    if (indexes.some((index, i) => index < 0 || index !== indexes[0] + i)) continue;
    const current = indexes.map(index => base.slides[index]);
    const groupTitle = titleElement(current[0]);
    if (!groupTitle || current.some((slide, i) => !sameTemplateContent(slide, expected[i]) || titleElement(slide)?.content !== groupTitle.content || !same(slide.metadata.teacherNotes, current[0].metadata.teacherNotes))) continue;
    // Extra continuations or inserted pages cannot be silently collapsed.
    if (base.slides.some(slide => slide.id.startsWith(`${source.id}-cont-`) && !expected.some(item => item.id === slide.id))) continue;
    const template = copy(source);
    const title = titleElement(template);
    title.content = groupTitle.content;
    template.title = slideText(groupTitle.content);
    template.metadata = copy(current[0].metadata);
    const separated = splitTemplate(template);
    if (!separated.responseCount) continue;
    const paginated = paginateTemplateSlides([separated.slide]);
    if (paginated.report.protectedPages.length) continue;
    const outsideIds = new Set(base.slides.filter(slide => !current.includes(slide)).map(slide => slide.id));
    if (paginated.slides.some(slide => outsideIds.has(slide.id))) continue;
    replacements.set(current[0].id, paginated.slides);
    current.forEach(slide => consumed.add(slide.id));
    changedPages.push({ page: indexes[0] + 1, title: template.title, before: current.length, pages: paginated.slides.length, responses: separated.responseCount });
  }
  for (const [index, slide] of base.slides.entries()) {
    if (slide.kind === 'questions' && !consumed.has(slide.id)) protectedPages.push({ page: index + 1, title: slide.title, reason: '无法确认完整提问分段或存在后续编辑，保持原样，请人工确认' });
  }
  const slides = base.slides.flatMap(slide => replacements.get(slide.id) || (consumed.has(slide.id) ? [] : [copy(slide)])).map((slide, index) => ({ ...slide, order: index + 1 }));
  const imagePages = base.slides.flatMap((slide, index) => slide.content.canvas.elements.some(element => element.type === 'image') ? [{ page: index + 1, title: slide.title }] : []);
  return { slides, report: { before: base.slides.length, after: slides.length, changedPages, protectedPages, imagePages } };
}
