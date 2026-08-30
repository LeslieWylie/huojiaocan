function compact(value, limit = 240) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function validPage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 0;
}

function sourceType(value) {
  const id = String(value || '').trim();
  if (id === 'textbook') return 'textbook';
  if (['teacher-guide', 'teacher_guide', 'guide'].includes(id)) return 'teacher-guide';
  return '';
}

export function focusedSnippet(value, focus = '', radius = 68) {
  const body = compact(value, 8000);
  const needle = compact(focus, 100);
  if (!body) return { text: '', directMatch: false };
  if (!needle) return { text: body.slice(0, radius * 2), directMatch: false };
  const index = body.indexOf(needle);
  // A page-level hit is useful for navigation, but its first paragraph is not
  // automatically evidence for the teacher's current focus. Hide the excerpt
  // when the requested words are absent instead of presenting unrelated text
  // as a teaching explanation.
  if (index < 0) return { text: '', directMatch: false };
  const start = Math.max(0, index - radius);
  const end = Math.min(body.length, index + needle.length + radius);
  return { text: `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`, directMatch: true };
}

function normalizeSource(value = {}) {
  const documentId = sourceType(value.documentId || value.documentType || value.document_type);
  const pdfPage = validPage(value.pdfPage ?? value.pdf_page ?? value.pageNumber ?? value.page);
  if (!documentId || !pdfPage) return null;
  return {
    documentId,
    pdfPage,
    printedPage: compact(value.printedPage ?? value.printed_page, 24),
    title: compact(value.title || value.pageTitle || value.page_title, 100),
    section: Array.isArray(value.sectionPath || value.section_path)
      ? (value.sectionPath || value.section_path).map(item => compact(item, 60)).filter(Boolean).join(' › ')
      : compact(value.sectionPath || value.section_path, 160),
    text: compact(value.text || value.retrievalText || value.retrieval_text || value.quote || value.snippet, 8000)
  };
}

function markdownQuote(value) {
  return compact(value, 320).replace(/^/gmu, '> ').replace(/[<>]/gu, '');
}

export function buildDualSourceTeachingCard({ lessonTitle = '', focus = '', sources = [] } = {}) {
  const lesson = compact(lessonTitle, 80) || '当前篇目';
  const question = compact(focus, 100);
  const normalized = (Array.isArray(sources) ? sources : []).map(normalizeSource).filter(Boolean);
  const textbook = normalized.find(item => item.documentId === 'textbook') || null;
  const teacherGuide = normalized.find(item => item.documentId === 'teacher-guide') || null;
  if (!question || !textbook || !teacherGuide) return null;
  const studentExcerpt = focusedSnippet(textbook.text, question);
  const guideExcerpt = focusedSnippet(teacherGuide.text, question);
  const status = studentExcerpt.directMatch && guideExcerpt.directMatch ? 'direct'
    : studentExcerpt.directMatch || guideExcerpt.directMatch ? 'partial' : 'located';
  const steps = [
    `先回到学生教材 PDF 第 ${textbook.pdfPage} 页，让学生圈画与“${question}”直接相关的词句。`,
    `再核对教师用书 PDF 第 ${teacherGuide.pdfPage} 页，确认教材编写者提供的教学处理、问题或参考说明。`,
    '最后由教师根据学生的实际回答决定怎样追问、归纳和落板；本卡不替学生预写结论。'
  ];
  const markdown = [
    `# ${lesson} · 句段讲解卡`,
    '',
    `**本次聚焦：** ${question}`,
    '',
    `## 学生教材 · PDF 第 ${textbook.pdfPage} 页${textbook.printedPage ? ` · 印刷页 ${textbook.printedPage}` : ''}`,
    textbook.section ? `章节：${textbook.section}` : '',
    studentExcerpt.text ? markdownQuote(studentExcerpt.text) : '> 请打开原始 PDF 核验。',
    '',
    `## 教师用书 · PDF 第 ${teacherGuide.pdfPage} 页${teacherGuide.printedPage ? ` · 印刷页 ${teacherGuide.printedPage}` : ''}`,
    teacherGuide.section ? `章节：${teacherGuide.section}` : '',
    guideExcerpt.text ? markdownQuote(guideExcerpt.text) : '> 请打开原始 PDF 核验。',
    '',
    '## 课堂使用顺序',
    ...steps.map((item, index) => `${index + 1}. ${item}`),
    '',
    '> 原始 PDF 是唯一可核验依据。本卡只整理已定位页面，不生成新的教材结论。'
  ].filter(value => value !== null && value !== undefined).join('\n');
  return {
    version: 1,
    lessonTitle: lesson,
    focus: question,
    status,
    textbook: { ...textbook, excerpt: studentExcerpt.text, directMatch: studentExcerpt.directMatch },
    teacherGuide: { ...teacherGuide, excerpt: guideExcerpt.text, directMatch: guideExcerpt.directMatch },
    steps,
    markdown,
    filename: `${lesson.replace(/[《》<>:"/\\|?*]/gu, '') || '当前篇目'}-${question.replace(/[<>:"/\\|?*]/gu, '').slice(0, 24) || '句段'}-讲解卡.md`
  };
}

export default buildDualSourceTeachingCard;
