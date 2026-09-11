import { paginateTemplateSlides } from './teaching-slides-pagination.js';
import { normalizeSlide, validateScene } from '@openmaic/dsl';
import { applyEditorTransaction, isValidEditorElement } from '@openmaic/editor/core';
import { buildTeachingSlideDeck, normalizeTeachingSlideDeck, teachingSlidesSourceKey } from './teaching-slides.js';

export const TEACHING_SLIDES_V2_VERSION = 2;
export const TEACHING_SLIDES_SCHEMA_VERSION = 1;
export const TEACHING_SLIDES_ALLOWED_ELEMENTS = Object.freeze(['text', 'image', 'line', 'table', 'latex']);

const MAX_IMAGE_BYTES = 700 * 1024;
const MAX_DECK_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES_PER_SLIDE = 4;

const ALLOWED_ELEMENT_TYPES = new Set(TEACHING_SLIDES_ALLOWED_ELEMENTS);
const THEME = Object.freeze({
  backgroundColor: '#173d34',
  themeColors: ['#173d34', '#e6c56f', '#f7f2e4', '#b9cec6', '#315e50'],
  fontColor: '#f7f2e4',
  fontName: 'Microsoft YaHei',
  outline: { color: '#e6c56f', width: 2, style: 'solid' },
  shadow: { h: 0, v: 2, blur: 8, color: '#0b201b55' }
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function plainText(value, max = 600) {
  return String(value || '').replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function imageDataBytes(src) {
  const match = /^data:image\/(?:png|jpeg|webp);base64,([a-z0-9+/=]+)$/iu.exec(String(src || ''));
  if (!match) return -1;
  const payload = match[1];
  return Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
}

function validImageAddress(src) {
  return /^ast_[0-9a-z]+$/u.test(String(src || '')) || imageDataBytes(src) >= 0;
}

function validateSlideImages(canvas) {
  const images = canvas.elements.filter(element => element.type === 'image');
  if (images.length > MAX_IMAGES_PER_SLIDE || images.some(element => {
    const bytes = imageDataBytes(element.src);
    return !/^ast_[0-9a-z]+$/u.test(String(element.src || '')) && (bytes < 1 || bytes > MAX_IMAGE_BYTES);
  })) {
    throw Object.assign(new Error('teaching_slides_image_invalid'), { code: 'teaching_slides_image_invalid', status: 422 });
  }
  return images.reduce((total, element) => total + Math.max(0, imageDataBytes(element.src)), 0);
}

function validateDeckImageBudget(slides) {
  const bytes = slides.reduce((total, slide) => total + validateSlideImages(slide.content.canvas), 0);
  if (bytes > MAX_DECK_IMAGE_BYTES) {
    throw Object.assign(new Error('teaching_slides_images_too_large'), { code: 'teaching_slides_images_too_large', status: 422 });
  }
}

function textElement(id, content, geometry, { size = 34, color = '#f7f2e4', weight = 500, textType = 'content', align = 'left' } = {}) {
  return {
    id, type: 'text', ...geometry, rotate: 0,
    content: `<div style="font-size:${size}px;font-weight:${weight};line-height:1.35;text-align:${align};color:${color}">${escapeHtml(content)}</div>`,
    defaultFontName: 'Microsoft YaHei', defaultColor: color, lineHeight: 1.35, textType
  };
}

function canvasForSlide(slide, referenceMap) {
  const elements = [
    textElement(`${slide.id}-kind`, slide.kind, { left: 72, top: 54, width: 856, height: 34 }, { size: 16, color: '#e6c56f', weight: 800, textType: 'header' }),
    textElement(`${slide.id}-title`, slide.title, { left: 72, top: 105, width: 856, height: 120 }, { size: slide.kind === 'cover' ? 54 : 45, weight: 800, textType: 'title' })
  ];
  const bodyTop = slide.kind === 'cover' ? 265 : 245;
  slide.body.forEach((line, index) => {
    elements.push(textElement(`${slide.id}-body-${index + 1}`, `• ${line}`, { left: 94, top: bodyTop + index * 58, width: 820, height: 52 }, { size: slide.kind === 'cover' ? 32 : 28, weight: 500, textType: 'item' }));
  });
  if (slide.prompt) {
    elements.push(textElement(`${slide.id}-prompt`, slide.prompt, { left: 72, top: 485, width: 856, height: 58 }, { size: 20, color: '#e6c56f', weight: 650, textType: 'footer' }));
  }
  const refs = slide.citationIds.map(id => referenceMap.get(String(id))).filter(item => item?.documentId === 'textbook' && item.pdfPage > 0);
  if (refs.length) {
    elements.push(textElement(`${slide.id}-references`, refs.map(item => `学生教材 PDF 第 ${item.pdfPage} 页`).join(' · '), { left: 72, top: 545, width: 856, height: 24 }, { size: 13, color: '#b9cec6', weight: 500, textType: 'footer' }));
  }
  return normalizeSlide({
    id: `canvas-${slide.id}`,
    viewportSize: 1000,
    viewportRatio: 0.5625,
    theme: clone(THEME),
    elements,
    background: { type: 'solid', color: '#173d34' },
    type: slide.kind === 'cover' ? 'cover' : 'content'
  });
}

function normalizeStringList(value, limit, itemLimit) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => plainText(item, itemLimit)).filter(Boolean))].slice(0, limit);
}

function validateContent(content, slideId = 'slide') {
  if (!content || content.type !== 'slide' || !content.canvas || !Array.isArray(content.canvas.elements)) {
    throw Object.assign(new Error('teaching_slides_invalid_content'), { code: 'teaching_slides_invalid_content', status: 422 });
  }
  if (content.canvas.elements.length > 120) {
    throw Object.assign(new Error('teaching_slides_too_many_elements'), { code: 'teaching_slides_too_many_elements', status: 422 });
  }
  const canvas = normalizeSlide(content.canvas);
  if (canvas.elements.some(element => !ALLOWED_ELEMENT_TYPES.has(element.type) || !isValidEditorElement(element) || element.type === 'image' && !validImageAddress(element.src))) {
    throw Object.assign(new Error('teaching_slides_element_not_allowed'), { code: 'teaching_slides_element_not_allowed', status: 422 });
  }
  validateSlideImages(canvas);
  const normalized = { type: 'slide', schemaVersion: TEACHING_SLIDES_SCHEMA_VERSION, canvas };
  const validation = validateScene({ id: `scene-${slideId}`, stageId: 'teaching-slides', type: 'slide', title: slideId, order: 0, content: normalized, actions: [], createdAt: 0, updatedAt: 0 });
  if (!validation.valid) {
    throw Object.assign(new Error('teaching_slides_invalid_content'), { code: 'teaching_slides_invalid_content', status: 422, issues: validation.errors });
  }
  return normalized;
}

export function teachingSlideDeckV1ToV2(value = {}) {
  const legacy = normalizeTeachingSlideDeck(value);
  const referenceMap = new Map(legacy.references.map(item => [String(item.id), item]));
  return normalizeTeachingSlideDeckV2({
    version: TEACHING_SLIDES_V2_VERSION,
    schemaVersion: TEACHING_SLIDES_SCHEMA_VERSION,
    sourceKey: legacy.sourceKey,
    status: legacy.status,
    lessonTitle: legacy.lessonTitle,
    slides: paginateTemplateSlides(legacy.slides.map(item => ({
      id: item.id,
      kind: item.kind,
      order: item.order,
      title: item.title,
      summary: item.body[0] || item.prompt || '',
      content: { type: 'slide', schemaVersion: TEACHING_SLIDES_SCHEMA_VERSION, canvas: canvasForSlide(item, referenceMap) },
      metadata: {
        citationIds: [...item.citationIds],
        teacherCitationIds: [...item.teacherCitationIds],
        teacherNotes: [...item.teacherNotes]
      }
    })), { generated: true }).slides,
    references: clone(legacy.references),
    updatedAt: legacy.updatedAt,
    confirmedAt: legacy.confirmedAt,
    confirmedBy: legacy.confirmedBy,
    renderer: { name: '@openmaic/renderer', version: '0.1.6' },
    editor: { name: '@openmaic/editor', version: '0.0.5' }
  });
}

export function buildTeachingSlideDeckV2(draft = {}) {
  return teachingSlideDeckV1ToV2(buildTeachingSlideDeck(draft));
}

export function normalizeTeachingSlideDeckV2(value = {}) {
  if (Number(value.version) !== TEACHING_SLIDES_V2_VERSION) {
    throw Object.assign(new Error('teaching_slides_version_unsupported'), { code: 'teaching_slides_version_unsupported', status: 422 });
  }
  if (!Array.isArray(value.slides) || value.slides.length > 120) throw Object.assign(new Error('teaching_slides_page_limit'), { code: 'teaching_slides_page_limit', status: 422 });
  if (new Set(value.slides.map((item, index) => plainText(item?.id || `slide-${index + 1}`, 100))).size !== value.slides.length) throw Object.assign(new Error('teaching_slides_duplicate_id'), { code: 'teaching_slides_duplicate_id', status: 422 });
  const slides = value.slides.map((item, index) => ({
    id: plainText(item?.id || `slide-${index + 1}`, 100),
    kind: plainText(item?.kind || 'content', 40),
    order: index + 1,
    title: plainText(item?.title, 120),
    summary: plainText(item?.summary, 260),
    content: validateContent(item?.content, plainText(item?.id, 100) || `slide-${index + 1}`),
    metadata: {
      citationIds: normalizeStringList(item?.metadata?.citationIds, 8, 100),
      teacherCitationIds: normalizeStringList(item?.metadata?.teacherCitationIds, 8, 100),
      teacherNotes: normalizeStringList(item?.metadata?.teacherNotes, 5, 360)
    }
  }));
  validateDeckImageBudget(slides);
  return {
    version: TEACHING_SLIDES_V2_VERSION,
    schemaVersion: TEACHING_SLIDES_SCHEMA_VERSION,
    sourceKey: plainText(value.sourceKey, 120),
    status: value.status === 'confirmed' ? 'confirmed' : 'draft',
    lessonTitle: plainText(value.lessonTitle, 120),
    slides,
    references: (Array.isArray(value.references) ? value.references : []).map(item => ({
      id: plainText(item?.id, 100), documentId: plainText(item?.documentId, 80),
      pdfPage: Math.floor(Number(item?.pdfPage || 0)), printedPage: plainText(item?.printedPage, 30)
    })).filter(item => item.id && item.pdfPage > 0).slice(0, 30),
    updatedAt: value.updatedAt || null,
    confirmedAt: value.confirmedAt || null,
    confirmedBy: plainText(value.confirmedBy, 120) || null,
    renderer: { name: '@openmaic/renderer', version: '0.1.6' },
    editor: { name: '@openmaic/editor', version: '0.0.5' }
  };
}

export function teachingSlideDeckV2IsStale(draft = {}) {
  const deck = draft.answer?.teachingSlidesV2;
  return Boolean(deck?.sourceKey && deck.sourceKey !== teachingSlidesSourceKey(draft));
}

export function updateTeachingSlideDeckV2(baseValue, { slideId, transaction, metadataPatch, confirm = false, confirmedBy = '' } = {}) {
  const base = normalizeTeachingSlideDeckV2(baseValue);
  if (base.status === 'confirmed') throw Object.assign(new Error('teaching_slides_confirmed'), { code: 'teaching_slides_confirmed', status: 409 });
  const index = slideId ? base.slides.findIndex(item => item.id === String(slideId)) : -1;
  if ((transaction || metadataPatch) && index < 0) throw Object.assign(new Error('teaching_slide_not_found'), { code: 'teaching_slide_not_found', status: 404 });
  const slides = base.slides.map(item => ({ ...item, content: clone(item.content), metadata: clone(item.metadata) }));
  if (index >= 0 && transaction) {
    try {
      slides[index].content = validateContent(applyEditorTransaction(slides[index].content, transaction), slides[index].id);
    } catch (error) {
      if (error?.code) throw error;
      throw Object.assign(new Error('teaching_slides_invalid_transaction'), { code: 'teaching_slides_invalid_transaction', status: 422, cause: error });
    }
  }
  if (index >= 0 && metadataPatch) {
    slides[index].metadata.teacherNotes = normalizeStringList(metadataPatch.teacherNotes ?? slides[index].metadata.teacherNotes, 5, 360);
  }
  validateDeckImageBudget(slides);
  if (confirm && slides.some(item => !item.content.canvas.elements.some(element => element.type === 'text' && plainText(element.content)))) {
    throw Object.assign(new Error('teaching_slides_incomplete'), { code: 'teaching_slides_incomplete', status: 422 });
  }
  const now = new Date().toISOString();
  return { ...base, slides, status: confirm ? 'confirmed' : 'draft', updatedAt: now, confirmedAt: confirm ? now : null, confirmedBy: confirm ? plainText(confirmedBy, 120) || null : null };
}

export function createTeachingSlideDeckV2Revision(baseValue) {
  const base = normalizeTeachingSlideDeckV2(baseValue);
  if (base.status !== 'confirmed') throw Object.assign(new Error('teaching_slides_revision_requires_confirmed'), { code: 'teaching_slides_revision_requires_confirmed', status: 409 });
  return { ...base, status: 'draft', updatedAt: new Date().toISOString(), confirmedAt: null, confirmedBy: null };
}

export function teachingSlideDeckV2Html(value = {}, imageDataUrls = []) {
  const deck = normalizeTeachingSlideDeckV2(value);
  if (imageDataUrls.length !== deck.slides.length || imageDataUrls.some(item => !String(item).startsWith('data:image/png;base64,'))) {
    throw Object.assign(new Error('teaching_slides_export_images_invalid'), { code: 'teaching_slides_export_images_invalid', status: 422 });
  }
  const slides = imageDataUrls.map((src, index) => `<section class="slide ${index === 0 ? 'active' : ''}" data-index="${index}"><img src="${src}" alt="第 ${index + 1} 页课堂投屏"><div class="counter">${String(index + 1).padStart(2, '0')} / ${String(imageDataUrls.length).padStart(2, '0')}</div></section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(deck.lessonTitle)} · 课堂投屏稿</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0d241f}.slide{display:none;width:100vw;height:100vh;align-items:center;justify-content:center}.slide.active{display:flex}.slide img{display:block;max-width:100vw;max-height:100vh;object-fit:contain}.counter{position:fixed;right:24px;top:18px;color:#d7e5df;background:#0d241fcc;border-radius:999px;padding:7px 11px;font:700 13px system-ui}@media print{html,body{overflow:visible}.slide{display:flex!important;page-break-after:always}.counter{display:none}}</style></head><body>${slides}<script>(()=>{let i=0;const s=[...document.querySelectorAll('.slide')];const show=n=>{i=Math.max(0,Math.min(s.length-1,n));s.forEach((el,j)=>el.classList.toggle('active',j===i))};addEventListener('keydown',e=>{if(['ArrowRight','PageDown',' '].includes(e.key))show(i+1);if(['ArrowLeft','PageUp'].includes(e.key))show(i-1);if(e.key.toLowerCase()==='f')document.documentElement.requestFullscreen?.()});show(0)})()</script></body></html>`;
}

export function paginateTeachingSlideDeckV2(value) {
  const base = normalizeTeachingSlideDeckV2(value);
  const { slides, report } = paginateTemplateSlides(base.slides);
  const deck = normalizeTeachingSlideDeckV2({ ...base, slides, status: 'draft', updatedAt: new Date().toISOString(), confirmedAt: null, confirmedBy: null });
  return { deck, report };
}
