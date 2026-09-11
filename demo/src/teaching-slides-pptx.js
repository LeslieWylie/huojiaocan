import pptxgen from 'pptxgenjs';
import { resolveTeachingSlideDeck } from './slide-assets.js';

const PX_PER_INCH = 75;
const DEFAULT_FONT = 'Microsoft YaHei';

function color(value, fallback = '000000') {
  const match = String(value || '').match(/#?([0-9a-f]{6})/iu);
  return match ? match[1].toUpperCase() : fallback;
}

function transparency(value) {
  const match = String(value || '').match(/#(?:[0-9a-f]{6})([0-9a-f]{2})/iu);
  return match ? Math.round((1 - parseInt(match[1], 16) / 255) * 100) : 0;
}

function htmlTextRuns(html, fallbackColor, fallbackFont) {
  const root = new DOMParser().parseFromString(`<body>${String(html || '')}</body>`, 'text/html').body;
  const runs = [];
  const visit = (node, inherited = {}) => {
    if (node.nodeType === 3) {
      if (node.textContent) runs.push({ text: node.textContent, options: { ...inherited } });
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.tagName === 'BR') runs.push({ text: '', options: { ...inherited, breakLine: true } });
    const style = node.style || {};
    const options = {
      ...inherited,
      ...(style.fontSize ? { fontSize: parseFloat(style.fontSize) * 0.96 } : {}),
      ...(style.fontFamily ? { fontFace: style.fontFamily.replace(/["']/gu, '').split(',')[0] } : {}),
      ...(style.color ? { color: color(style.color, fallbackColor) } : {}),
      ...(style.fontWeight && Number(style.fontWeight) >= 600 || node.tagName === 'STRONG' ? { bold: true } : {}),
      ...(style.fontStyle === 'italic' || node.tagName === 'EM' ? { italic: true } : {}),
      ...(style.textAlign ? { align: style.textAlign } : {})
    };
    const before = runs.length;
    for (const child of node.childNodes) visit(child, options);
    if (['DIV', 'P', 'LI'].includes(node.tagName) && runs.length > before) runs[runs.length - 1].options.breakLine = true;
  };
  for (const child of root.childNodes) visit(child, { color: color(fallbackColor), fontFace: fallbackFont || DEFAULT_FONT });
  if (runs.at(-1)?.options?.breakLine) delete runs.at(-1).options.breakLine;
  return runs.length ? runs : [{ text: '', options: { color: color(fallbackColor), fontFace: fallbackFont || DEFAULT_FONT } }];
}

async function embeddableImage(src) {
  if (/^data:image\/(?:png|jpeg);/u.test(src)) return src;
  // The asset store returns blob URLs. Decode through the permitted image
  // channel, not fetch (connect-src); PNG also works in older Office versions
  // that cannot display the WebP bytes used by our online material library.
  const image = await new Promise((resolve, reject) => {
    const value = new Image();
    value.crossOrigin = 'anonymous';
    value.onload = () => resolve(value);
    value.onerror = () => reject(new Error('slide_image_read_failed'));
    value.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function box(element) {
  return { x: element.left / PX_PER_INCH, y: element.top / PX_PER_INCH, w: element.width / PX_PER_INCH, h: element.height / PX_PER_INCH };
}

function tableRows(element) {
  const hidden = new Set();
  return element.data.map((row, rowIndex) => row.flatMap((cell, columnIndex) => {
    if (hidden.has(`${rowIndex}:${columnIndex}`)) return [];
    for (let y = rowIndex; y < rowIndex + (cell.rowspan || 1); y += 1) for (let x = columnIndex; x < columnIndex + (cell.colspan || 1); x += 1) {
      if (x !== columnIndex || y !== rowIndex) hidden.add(`${y}:${x}`);
    }
    return [{ text: cell.text || '', options: {
      colspan: cell.colspan || 1, rowspan: cell.rowspan || 1, valign: cell.vAlign || 'middle',
      bold: Boolean(cell.style?.bold), italic: Boolean(cell.style?.em), underline: cell.style?.underline ? { style: 'sng' } : undefined,
      align: cell.style?.align || 'left', color: color(cell.style?.color), fill: cell.style?.backcolor ? { color: color(cell.style.backcolor) } : undefined,
      fontFace: cell.style?.fontname || DEFAULT_FONT, fontSize: (parseFloat(cell.style?.fontsize) || 14) * 0.96
    } }];
  }));
}

export async function buildTeachingSlidesPptx(deck) {
  const resolved = await resolveTeachingSlideDeck(deck);
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = '活教参';
  pptx.subject = resolved.lessonTitle || '课堂课件';
  pptx.title = resolved.lessonTitle || '课堂课件';
  for (const item of resolved.slides) {
    const slide = pptx.addSlide();
    const canvas = item.content.canvas;
    if (canvas.background?.type === 'solid') slide.background = { color: color(canvas.background.color, '173D34'), transparency: transparency(canvas.background.color) };
    if (item.metadata?.teacherNotes?.length) slide.addNotes(item.metadata.teacherNotes.map(note => String(note)));
    for (const element of canvas.elements || []) {
      if (element.type === 'text') {
        slide.addText(htmlTextRuns(element.content, element.defaultColor, element.defaultFontName), {
          ...box(element), fontFace: element.defaultFontName || DEFAULT_FONT, color: color(element.defaultColor),
          margin: 0.08, valign: element.vAlign || 'top', rotate: element.rotate || 0,
          breakLine: false, autoFit: true,
          ...(element.fill ? { fill: { color: color(element.fill, 'FFFFFF'), transparency: transparency(element.fill) } } : {})
        });
      } else if (element.type === 'image') {
        slide.addImage({ data: await embeddableImage(element.src), ...box(element), rotate: element.rotate || 0, flipH: element.flipH, flipV: element.flipV,
          ...(element.filters?.opacity ? { transparency: 100 - Number.parseInt(element.filters.opacity, 10) } : {}) });
      } else if (element.type === 'line') {
        slide.addShape(pptx.ShapeType.line, {
          x: element.left / PX_PER_INCH, y: element.top / PX_PER_INCH,
          w: (element.end?.[0] || 0) / PX_PER_INCH, h: (element.end?.[1] || 0) / PX_PER_INCH,
          line: { color: color(element.color), width: Math.max(0.5, Number(element.width || 1) * 0.96), dash: element.style === 'dashed' ? 'dash' : element.style === 'dotted' ? 'dot' : 'solid', beginArrowType: element.points?.[0] ? 'arrow' : 'none', endArrowType: element.points?.[1] ? 'arrow' : 'none' }
        });
      } else if (element.type === 'table') {
        slide.addTable(tableRows(element), {
          ...box(element), colW: element.colWidths.map(width => element.width * width / PX_PER_INCH),
          border: element.outline?.width ? { type: element.outline.style === 'solid' ? 'solid' : 'dash', pt: element.outline.width * 0.96, color: color(element.outline.color) } : undefined,
          margin: 0.06, autoFit: false
        });
      } else if (element.type === 'latex') {
        slide.addText(element.latex || '', { ...box(element), fontFace: 'Cambria Math', fontSize: Math.max(10, element.height * 0.32), align: element.align || 'center', valign: 'mid', margin: 0.02, fit: 'shrink' });
      }
    }
  }
  return pptx.write({ outputType: 'blob' });
}

export async function downloadTeachingSlidesPptx(deck) {
  const blob = await buildTeachingSlidesPptx(deck);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${String(deck.lessonTitle || '课堂').replace(/[《》]/gu, '')}-可编辑课件.pptx`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
