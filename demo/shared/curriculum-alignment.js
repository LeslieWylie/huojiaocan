const STANDARD_IDS = new Set(['curriculum-standard', 'curriculum_standard', 'curriculum', 'standard', 'course-standard']);

function text(value, max = 900) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function physicalPage(value) {
  const page = Number(value?.pdfPage ?? value?.pageNumber ?? value?.page ?? 0);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function standardSource(value) {
  const id = String(value?.documentId || value?.document_id || '').trim().toLowerCase();
  const type = String(value?.documentType || value?.document_type || '').trim().toLowerCase();
  return STANDARD_IDS.has(id) || STANDARD_IDS.has(type);
}

export function normalizeCurriculumCitation(value) {
  if (!value || typeof value !== 'object' || !standardSource(value)) return null;
  const pdfPage = physicalPage(value);
  if (!pdfPage) return null;
  return {
    id: text(value.id || `curriculum-standard-${pdfPage}`, 120),
    documentId: 'curriculum-standard',
    documentType: 'curriculum_standard',
    documentTitle: text(value.documentTitle || value.document_title || '义务教育语文课程标准（2022年版）', 160),
    title: text(value.title || value.pageTitle || value.page_title || '课程标准原页', 160),
    sectionPath: (Array.isArray(value.sectionPath) ? value.sectionPath : Array.isArray(value.section_path) ? value.section_path : [])
      .map(item => text(item, 100)).filter(Boolean).slice(0, 8),
    pdfPage,
    printedPage: text(value.printedPage || value.printed_page, 30),
    excerpt: text(value.text || value.quote || value.snippet || value.retrievalText, 900)
  };
}

function uniqueStandardSources(groups = {}) {
  const seen = new Set();
  const result = [];
  for (const items of Object.values(groups)) {
    for (const value of Array.isArray(items) ? items : []) {
      const item = normalizeCurriculumCitation(value);
      if (!item) continue;
      const key = `${item.documentId}:${item.pdfPage}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function score(item, patterns) {
  const haystack = `${item.title} ${item.sectionPath.join(' ')} ${item.excerpt}`;
  return patterns.reduce((total, pattern) => total + (pattern.test(haystack) ? 1 : 0), 0);
}

function best(items, patterns, preferred = []) {
  const pool = preferred.length ? preferred : items;
  return [...pool]
    .map(item => ({ item, score: score(item, patterns) }))
    .sort((left, right) => right.score - left.score || left.item.pdfPage - right.item.pdfPage)[0]?.item || null;
}

function directSection(id, title, purpose, source) {
  return {
    id,
    title,
    purpose,
    status: source ? 'direct' : 'missing',
    statusLabel: source ? '已找到原页' : '还缺原页',
    source,
    note: source
      ? '本项只说明课程标准的原文要求，不直接代表当前篇目已完成对齐。'
      : '没有课标原页时，不使用教师用书或系统推断填补。'
  };
}

export function inferCurriculumTaskGroup(value = '') {
  const context = text(value, 4000);
  if (/(议论|论证|观点|立场|思辨|批判|反讽|驳论|说理)/u.test(context)) return '思辨性阅读与表达';
  if (/(说明|新闻|消息|演讲|应用文|实用性|非连续性文本)/u.test(context)) return '实用性阅读与交流';
  if (/(诗歌|小说|散文|文学|意象|形象|抒情|文言|古诗)/u.test(context)) return '文学阅读与创意表达';
  return '';
}

export function curriculumSearchQueries({ lessonTitle = '', guideContext = '' } = {}) {
  const taskGroup = inferCurriculumTaskGroup(`${lessonTitle} ${guideContext}`);
  const taskQuery = taskGroup
    ? `第四学段 ${taskGroup} 学习任务群`
    : '第四学段 学习任务群 阅读 表达';
  const qualityQuery = taskGroup === '思辨性阅读与表达'
    ? '第四学段 学业质量 阅读简单议论性文章 区分观点与材料'
    : '第四学段 学业质量 阅读与鉴赏 表现手法 语言表达';
  return {
    taskGroup,
    searches: [
      ['stage', '第四学段 阅读与鉴赏 理清思路 理解分析主要内容'],
      ['taskGroup', taskQuery],
      ['quality', qualityQuery]
    ]
  };
}

/**
 * Build a teacher-verifiable three-step alignment report.  Direct standard
 * quotations and lesson-to-task-group mapping are deliberately separate:
 * the former can be direct evidence; the latter remains a candidate until a
 * teacher explicitly confirms it for the current lesson.
 */
export function buildCurriculumAlignment({ lessonTitle = '', resultGroups = {}, confirmedTaskGroup = '' } = {}) {
  const all = uniqueStandardSources(resultGroups);
  const taskGroupHint = text(resultGroups.taskGroupHint, 120);
  const stagePreferred = (resultGroups.stage || []).map(normalizeCurriculumCitation).filter(Boolean);
  const taskPreferred = (resultGroups.taskGroup || []).map(normalizeCurriculumCitation).filter(Boolean);
  const qualityPreferred = (resultGroups.quality || []).map(normalizeCurriculumCitation).filter(Boolean);
  const stage = best(all, [/第四学段/u, /7[\s—–-]*9年级/u, /阅读与鉴赏/u], stagePreferred);
  const task = best(all, [/学习任务群/u, /文学阅读与创意表达/u, /思辨性阅读与表达/u, /识别文本隐含的情感、观点、立场/u, /观点鲜明、证据充分/u], taskPreferred);
  const qualityPatterns = taskGroupHint === '思辨性阅读与表达'
    ? [/学业质量/u, /阅读简单议论性文章/u, /区分观点与材料/u, /观点与材料之间的联系/u]
    : [/学业质量/u, /分析作品表现手法/u, /总结不同类型文学作品的阅读经验/u, /评价建议/u];
  const quality = best(all, qualityPatterns, qualityPreferred);
  const confirmation = text(confirmedTaskGroup, 120);
  const taskStatus = task ? (confirmation ? 'confirmed' : 'candidate') : 'missing';
  const taskGroup = {
    id: 'task-group',
    title: '本课怎样组织学习',
    purpose: '教师根据课标任务群作出教学判断',
    status: taskStatus,
    statusLabel: taskStatus === 'confirmed' ? '教师已确认' : taskStatus === 'candidate' ? '等待选择' : '还缺原页',
    source: task,
    teacherDecision: confirmation,
    note: task
      ? (confirmation
        ? `教师已将本课的组织方式确认为“${confirmation}”。课标原页仍只是任务群依据，篇目关系来自教师决定。`
        : `课标中存在相关任务群，但“${text(lessonTitle || '当前篇目', 80)}应归入哪一群”是教学判断，不是课标原话。`)
      : '没有课标原页时，不根据篇名自动给出任务群。'
  };
  const sections = [
    directSection('stage', '本学段要发展什么能力', '先读课标原文，不直接套到某一篇课文', stage),
    taskGroup,
    directSection('quality', '课堂上怎样判断学生学会了', '把学业质量要求转成可观察的课堂表现', quality)
  ];
  return {
    version: 1,
    lessonTitle: text(lessonTitle, 120),
    status: sections.every(item => item.source) ? (confirmation ? 'confirmed' : 'review') : 'incomplete',
    sections,
    sourceCount: new Set(sections.map(item => item.source && `${item.source.documentId}:${item.source.pdfPage}`).filter(Boolean)).size,
    missing: sections.filter(item => !item.source).map(item => item.id),
    warning: '课标说明学生应发展什么能力；这篇课文怎样教，仍由教师结合教材与班情决定。'
  };
}
