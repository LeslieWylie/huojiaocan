function compact(value, limit = 500) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function itemText(value) {
  if (typeof value === 'string') return compact(value);
  return compact(value?.text || value?.title || value?.question || value?.content || value?.teacherAction || value?.description);
}

function list(value, limit = 4) {
  return (Array.isArray(value) ? value : []).map(itemText).filter(Boolean).slice(0, limit);
}

function cardItems(cards, type, limit = 4) {
  const card = (Array.isArray(cards) ? cards : []).find(item => item?.type === type);
  return list(card?.items, limit);
}

function validPage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 0;
}

function documentType(value) {
  const id = String(value || '').trim();
  if (id === 'textbook') return 'textbook';
  if (['teacher-guide', 'teacher_guide', 'guide'].includes(id)) return 'teacher-guide';
  if (['curriculum-standard', 'curriculum_standard', 'curriculum', 'standard', 'course-standard'].includes(id)) return 'curriculum-standard';
  return 'other';
}

function normalizeSources(citations = []) {
  const seen = new Set();
  return (Array.isArray(citations) ? citations : []).map(item => {
    const documentId = documentType(item?.documentId || item?.document_id || item?.documentType || item?.document_type);
    const pdfPage = validPage(item?.pdfPage ?? item?.pdf_page ?? item?.pageNumber ?? item?.page);
    if (!pdfPage) return null;
    const key = `${documentId}:${pdfPage}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      documentId,
      pdfPage,
      printedPage: compact(item?.printedPage ?? item?.printed_page, 30),
      title: compact(item?.title || item?.pageTitle || item?.page_title, 100)
    };
  }).filter(Boolean);
}

function segment(id, order, title, cue, lines, fallback) {
  const content = lines.filter(Boolean);
  return { id, order, title, cue, lines: content.length ? content : [fallback] };
}

function sourceLabel(source) {
  const name = source.documentId === 'textbook' ? '学生教材' : source.documentId === 'teacher-guide' ? '教师用书' : source.documentId === 'curriculum-standard' ? '课程标准' : '教学资料';
  return `${name} PDF 第 ${source.pdfPage} 页${source.printedPage ? `（印刷页 ${source.printedPage}）` : ''}`;
}

export function buildTeachingBrief({ title = '', coreQuestion = '', answer = {}, cards = [], citations = [], lessonContext = {} } = {}) {
  const lessonTitle = compact(title, 90) || '当前篇目';
  const question = compact(coreQuestion, 180) || '待教师确认本课核心问题';
  const sources = normalizeSources(citations);
  const textbookCount = sources.filter(item => item.documentId === 'textbook').length;
  const guideCount = sources.filter(item => item.documentId === 'teacher-guide').length;
  const standardCount = sources.filter(item => item.documentId === 'curriculum-standard').length;
  const objectives = list(answer?.objectives, 3);
  const keyPoints = list(answer?.keyPoints, 3);
  const workflow = list(answer?.lessonPlan, 4);
  const questions = cardItems(cards, 'question', 4).length ? cardItems(cards, 'question', 4) : list(answer?.questionChain, 4);
  const assessments = cardItems(cards, 'assessment', 4).length ? cardItems(cards, 'assessment', 4) : [...list(answer?.assessment, 3), ...list(answer?.homework, 2)].slice(0, 4);
  const summary = compact(answer?.summary, 700);
  const periods = Number(lessonContext?.periods || 1) || 1;
  const classLevel = compact(lessonContext?.classLevel, 100) || '待教师补充';

  const sections = [
    segment('intent', 1, '为什么这样定课', '先交代班级、课时和这节课要解决的真问题。', [
      `本课面向${classLevel}，按 ${periods} 课时组织。`,
      summary,
      ...objectives.map(item => `学生最终需要做到：${item}`),
      ...keyPoints.slice(0, 1).map(item => `本课最需要解决：${item}`)
    ], '方案中还没有完整的课情和目标，请教师先回到方案总览补充。'),
    segment('path', 2, '课堂怎样向前推进', `所有环节都围绕“${question}”展开。`, [
      ...workflow.map((item, index) => `第 ${index + 1} 步：${item}`),
      ...questions.slice(0, 2).map(item => `关键追问：${item}`)
    ], '当前方案还没有可说明的课堂流程，不建议直接进入说课。'),
    segment('evidence', 3, '怎样判断学生真的学会了', '不说空泛效果，只说课堂上能看见、能记录的学习表现。', assessments.map(item => `可观察的表现：${item}`), '评价卡还没有可观察的学习表现，请先补全并保存。'),
    segment('basis', 4, '哪些是材料依据，哪些由教师决定', '课标规定学段要求，学生教材锁定原文，教师用书提供教学处理，最后由教师结合班情取舍。', [
      standardCount ? `已核对 ${standardCount} 个课程标准原页。` : '尚未绑定课程标准原页。',
      textbookCount ? `已核对 ${textbookCount} 个学生教材原页。` : '尚未绑定学生教材原页。',
      guideCount ? `已核对 ${guideCount} 个教师用书原页。` : '尚未绑定教师用书原页。',
      '课堂中学生的具体回答、环节用时和最终落板内容，仍由教师现场决定。'
    ], '当前没有可核验页码，请先回到教材依据补齐原页。')
  ];

  const markdown = [
    `# ${lessonTitle} · 教研说课简报`,
    '',
    `**核心问题：** ${question}`,
    '',
    ...sections.flatMap(section => [`## ${section.order}. ${section.title}`, section.cue, ...section.lines.map(item => `- ${item}`), '']),
    '## 可核验的教材依据',
    ...(sources.length ? sources.map(source => `- ${sourceLabel(source)}`) : ['- 当前没有可核验的原页页码。']),
    '',
    '> 这份简报只整理已确认的方案、三卡和教材页码；学情判断与课堂取舍须由教师确认。'
  ].join('\n');
  const characterCount = sections.flatMap(item => item.lines).join('').replace(/\s/gu, '').length;
  return {
    version: 1,
    title: lessonTitle,
    coreQuestion: question,
    sections,
    sources,
    sourceCoverage: textbookCount && guideCount && standardCount ? 'three-source' : textbookCount && guideCount ? 'balanced' : textbookCount ? 'textbook-only' : guideCount ? 'guide-only' : standardCount ? 'standard-only' : 'missing',
    textbookCount,
    guideCount,
    standardCount,
    characterCount,
    estimatedMinutes: Math.max(1, Math.ceil(characterCount / 220)),
    markdown,
    filename: `${lessonTitle.replace(/[《》<>:"/\\|?*]/gu, '') || '当前篇目'}-教研说课简报.md`
  };
}

export default buildTeachingBrief;
