// Server-side, deterministic layout. OpenMAIC's DOM-only TextAutoSize cannot run
// here. Reserve its 10px padding and use a conservative em-width bound per glyph;
// explicit line breaks keep browser/font differences from adding unexpected rows.
const KIND_LABELS = { cover: '本课主题', route: '学习路径', evidence: '文本依据', questions: '课堂问题', activity: '课堂活动', board: '课堂小结', assessment: '学习检查' };
const copy = value => JSON.parse(JSON.stringify(value));
const escape = text => text.replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function slideText(html) {
  return String(html || '').replace(/<br\s*\/?\s*>/giu, '\n').replace(/<[^>]*>/gu, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (_, entity) => {
    if (entity[0] === '#') { const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[entity.toLowerCase()];
  });
}
function fontSize(element) { return Math.max(...[...element.content.matchAll(/font-size:\s*([\d.]+)px/gu)].map(match => Number(match[1])), 0); }
function lines(text, size, width) {
  const capacity = Math.max(1, Math.floor((width - 32) / (size * 1.08)));
  return text.split('\n').flatMap(paragraph => {
    const chars = [...paragraph], result = [];
    while (chars.length) result.push(chars.splice(0, capacity).join(''));
    return result.length ? result : [''];
  });
}
function replaceText(element, textLines) {
  // Body/footer recognition requires one flat div, so preserve its exact style.
  return element.content.replace(/^(<div\b[^>]*>)[\s\S]*(<\/div>)$/u, (_, start, end) => `${start}${textLines.map(escape).join('<br>')}${end}`);
}
function recognizable(slide) {
  const canvas = slide.content.canvas, elements = canvas.elements;
  if (canvas.viewportSize !== 1000 || canvas.viewportRatio !== 0.5625) return false;
  const title = elements.find(e => e.id === `${slide.id}-title`), kind = elements.find(e => e.id === `${slide.id}-kind`);
  if (!title || !kind || !elements.some(e => e.id.startsWith(`${slide.id}-body-`))) return false;
  return elements.every(e => {
    if (e.type !== 'text' || e.rotate || e.vertical || e.wordSpace || e.fill || e.outline || e.shadow || e.defaultFontName !== 'Microsoft YaHei' || e.lineHeight !== 1.35) return false;
    const role = e.id.slice(slide.id.length + 1);
    if (!e.id.startsWith(`${slide.id}-`)) return false;
    if (role === 'title') return e.left === 72 && e.top === 105 && e.width === 856 && fontSize(e) >= 28 && fontSize(e) <= 54;
    if (!/^<div\b[^>]*>[^<]*<\/div>$/u.test(e.content)) return false;
    if (role === 'kind') return e.left === 72 && e.top === 54 && e.width === 856 && e.height === 34;
    if (role === 'prompt') return e.left === 72 && e.top === 485 && e.width === 856 && e.height === 58 && fontSize(e) === 20;
    if (role === 'references') return e.left === 72 && e.top === 545 && e.width === 856 && e.height === 24 && fontSize(e) === 13;
    const body = /^body-(\d+)$/u.exec(role);
    return body && e.left === 94 && e.top === (slide.kind === 'cover' ? 265 : 245) + (Number(body[1]) - 1) * 58 && e.width === 820 && e.height === 52 && fontSize(e) === (slide.kind === 'cover' ? 32 : 28);
  });
}
export function paginateTemplateSlides(inputSlides, { generated = false } = {}) {
  const used = new Set(inputSlides.map(s => s.id)), protectedPages = [], changedPages = [], slides = [];
  for (const [originalIndex, slide] of inputSlides.entries()) {
    if (!recognizable(slide)) { slides.push(copy(slide)); protectedPages.push({ page: originalIndex + 1, title: slide.title, reason: '含自定义元素、版式或复杂格式，原样保留' }); continue; }
    const canvas = slide.content.canvas, title = canvas.elements.find(e => e.id === `${slide.id}-title`), kind = canvas.elements.find(e => e.id === `${slide.id}-kind`);
    const refs = canvas.elements.find(e => e.id === `${slide.id}-references`);
    const titleHeight = lines(slideText(title.content), fontSize(title), 856).length * fontSize(title) * 1.35 + 24;
    const top = 82 + titleHeight + 12;
    const refsHeight = refs ? lines(slideText(refs.content), 13, 856).length * 13 * 1.35 + 20 : 0;
    const bottom = 530 - refsHeight - 12;
    if (top + 80 > bottom || titleHeight > 160) { slides.push(copy(slide)); protectedPages.push({ page: originalIndex + 1, title: slide.title, reason: '标题或引用过长，需手动排版' }); continue; }
    const pages = [[]]; let y = top;
    const body = canvas.elements.filter(e => e.id.startsWith(`${slide.id}-body-`));
    const prompt = canvas.elements.find(e => e.id === `${slide.id}-prompt`);
    // Prompt follows the final body segment; never overlaps content or citations.
    for (const element of [...body, ...(prompt ? [prompt] : [])]) {
      const size = fontSize(element), rows = lines(slideText(element.content), size, element.width), rowHeight = size * 1.35;
      let offset = 0;
      while (offset < rows.length) {
        let available = Math.floor((bottom - y - 20) / rowHeight);
        if (available < 1) { pages.push([]); y = top; available = Math.floor((bottom - y - 20) / rowHeight); }
        let selected = rows.slice(offset, offset + available);
        if (offset + selected.length < rows.length) {
          // Prefer a sentence boundary near the page bottom over splitting a word
          // across slides. If none exists, retain the complete line-based split.
          const text = selected.join('');
          const boundary = [...text.matchAll(/[。！？；｜]/gu)].at(-1);
          if (boundary && boundary.index + 1 >= text.length * 0.55) {
            const cut = boundary.index + 1;
            const head = lines(text.slice(0, cut), size, element.width);
            rows.splice(offset, selected.length, ...head, ...lines(text.slice(cut), size, element.width));
            selected = head;
          }
        }
        const height = selected.length * rowHeight + 20;
        pages.at(-1).push({ ...copy(element), id: `${element.id}-part-${offset}`, top: y, height, content: replaceText(element, selected) });
        y += height + 8; offset += selected.length;
        if (offset < rows.length) { pages.push([]); y = top; }
      }
    }
    pages.forEach((elements, index) => {
      let id = slide.id;
      if (index) { id = `${slide.id.slice(0, 78)}-cont-${index + 1}`; let suffix = 2; while (used.has(id)) id = `${slide.id.slice(0, 78)}-cont-${index + 1}-${suffix++}`; used.add(id); }
      const titleText = slideText(title.content);
      const label = KIND_LABELS[slide.kind] || '课堂内容';
      const heading = generated || slideText(kind.content) === slide.kind ? label : slideText(kind.content);
      const header = { ...copy(kind), id: `${id}-kind`, top: 26, height: 44, content: replaceText(kind, [`${heading}${index ? ` · 续页 ${index + 1}` : ''}`]) };
      slides.push({ ...copy(slide), id, title: `${titleText}${index ? `（续 ${index + 1}）` : ''}`, content: { ...copy(slide.content), canvas: { ...copy(canvas), id: `canvas-${id}`, elements: [header, { ...copy(title), id: `${id}-title`, top: 82, height: titleHeight }, ...elements.map(e => ({ ...e, id: `${id}-${e.id}` })), ...(refs ? [{ ...copy(refs), id: `${id}-references`, top: 530 - refsHeight, height: refsHeight, content: replaceText(refs, lines(slideText(refs.content), 13, 856)) }] : [])] } } });
    });
    changedPages.push({ page: originalIndex + 1, title: slideText(title.content), pages: pages.length });
  }
  return { slides: slides.map((slide, index) => ({ ...slide, order: index + 1 })), report: { before: inputSlides.length, after: slides.length, protectedPages, changedPages } };
}
