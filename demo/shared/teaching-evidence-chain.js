function compact(value, limit = 500) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function validPage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 0;
}

function docType(value) {
  const id = String(value || '').trim();
  if (id === 'textbook') return 'textbook';
  if (['teacher-guide', 'teacher_guide', 'guide'].includes(id)) return 'teacher-guide';
  if (['curriculum-standard', 'curriculum_standard', 'curriculum', 'standard', 'course-standard'].includes(id)) return 'curriculum-standard';
  return id || 'other';
}

function normalizeCitations(citations = []) {
  const byId = new Map();
  const byPage = new Map();
  for (const value of Array.isArray(citations) ? citations : []) {
    const documentId = docType(value?.documentId || value?.document_id || value?.documentType || value?.document_type);
    const pdfPage = validPage(value?.pdfPage ?? value?.pdf_page ?? value?.pageNumber ?? value?.page);
    if (!documentId || !pdfPage) continue;
    const pageKey = `${documentId}:${pdfPage}`;
    if (byPage.has(pageKey)) continue;
    const source = {
      id: compact(value?.id || value?.citationId || value?.citation_id || pageKey, 120),
      pageKey,
      documentId,
      pdfPage,
      printedPage: compact(value?.printedPage ?? value?.printed_page, 30),
      title: compact(value?.title || value?.pageTitle || value?.page_title, 120),
      sectionPath: Array.isArray(value?.sectionPath || value?.section_path)
        ? (value.sectionPath || value.section_path).map(item => compact(item, 80)).filter(Boolean)
        : []
    };
    byPage.set(pageKey, source);
    if (source.id) byId.set(source.id, source);
    byId.set(pageKey, source);
  }
  return { byId, sources: [...byPage.values()] };
}

function normalizeItems(cards = [], byId = new Map()) {
  const items = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    const type = ['board', 'question', 'assessment'].includes(card?.type) ? card.type : 'other';
    for (const value of Array.isArray(card?.items) ? card.items : []) {
      const text = compact(typeof value === 'string' ? value : value?.text || value?.content, 500);
      if (!text) continue;
      const refs = [...new Set((Array.isArray(value?.citationIds) ? value.citationIds : Array.isArray(value?.evidenceRefs) ? value.evidenceRefs : [])
        .map(ref => compact(typeof ref === 'string' ? ref : ref?.id || ref?.citationId || ref?.citation_id, 120))
        .filter(Boolean))];
      const sources = refs.map(ref => byId.get(ref)).filter(Boolean);
      items.push({
        id: compact(value?.id, 100) || `${type}-${items.length + 1}`,
        type,
        cardTitle: compact(card?.title, 100),
        text,
        sources: [...new Map(sources.map(source => [source.pageKey, source])).values()]
      });
    }
  }
  return items;
}

function uniqueTexts(items = []) {
  return [...new Map(items.map(item => [item.text, item.text])).values()];
}

function sourceName(source) {
  return source.documentId === 'textbook' ? '学生教材' : source.documentId === 'teacher-guide' ? '教师用书' : source.documentId === 'curriculum-standard' ? '课程标准' : '教学资料';
}

export function buildTeachingEvidenceChain({ title = '', cards = [], citations = [] } = {}) {
  const lessonTitle = compact(title, 100) || '当前篇目';
  const { byId, sources } = normalizeCitations(citations);
  const items = normalizeItems(cards, byId);
  const linkedItems = items.filter(item => item.sources.length > 0);
  const missingItems = items.filter(item => item.sources.length === 0);
  const paths = sources.map(source => {
    const related = linkedItems.filter(item => item.sources.some(itemSource => itemSource.pageKey === source.pageKey));
    if (!related.length) return null;
    return {
      id: source.pageKey,
      source,
      board: uniqueTexts(related.filter(item => item.type === 'board')),
      questions: uniqueTexts(related.filter(item => item.type === 'question')),
      assessments: uniqueTexts(related.filter(item => item.type === 'assessment')),
      itemCount: related.length,
      complete: related.some(item => item.type === 'question') && related.some(item => item.type === 'assessment')
    };
  }).filter(Boolean).sort((a, b) => Number(b.complete) - Number(a.complete) || b.itemCount - a.itemCount || a.source.pdfPage - b.source.pdfPage);
  const linkedPercent = items.length ? Math.round(linkedItems.length / items.length * 100) : 0;
  const completePaths = paths.filter(path => path.complete).length;
  const markdown = [
    `# ${lessonTitle} · 教学证据链`,
    '',
    `- 已绑定教材依据的课堂内容：${linkedItems.length} / ${items.length}（${linkedPercent}%）`,
    `- 同时连接“课堂问题”和“学习表现”的原页：${completePaths} 页`,
    '',
    ...paths.flatMap((path, index) => [
      `## ${index + 1}. ${sourceName(path.source)} PDF 第 ${path.source.pdfPage} 页${path.source.printedPage ? `（印刷页 ${path.source.printedPage}）` : ''}`,
      path.source.title ? `页面：${path.source.title}` : '',
      ...path.board.map(item => `- 板书落点：${item}`),
      ...path.questions.map(item => `- 课堂问题：${item}`),
      ...path.assessments.map(item => `- 学习表现：${item}`),
      path.complete ? '- 链路状态：已连接问题与可观察表现' : '- 链路状态：仍需补齐问题或可观察表现',
      ''
    ].filter(Boolean)),
    missingItems.length ? '## 待补依据的课堂内容' : '',
    ...missingItems.map(item => `- ${item.cardTitle || item.type}：${item.text}`),
    '',
    '> 本表只显示三卡中已经绑定的页级关系。共享同一页不等于它们已建立因果关系，仍需教师核对原始 PDF。'
  ].filter(Boolean).join('\n');
  return {
    version: 1,
    title: lessonTitle,
    paths,
    totalItems: items.length,
    linkedItems: linkedItems.length,
    linkedPercent,
    completePaths,
    missingItems,
    status: !items.length ? 'empty' : missingItems.length ? 'needs-evidence' : completePaths ? 'ready' : 'partial',
    markdown,
    filename: `${lessonTitle.replace(/[《》<>:"/\\|?*]/gu, '') || '当前篇目'}-教学证据链.md`
  };
}

export default buildTeachingEvidenceChain;
