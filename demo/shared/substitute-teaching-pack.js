const CARD_LIMITS = { board: 6, question: 6, assessment: 6 };
const CARD_TEXT_LIMITS = { board: 36, question: 140, assessment: 140 };

function text(value, limit = 240) {
  if (!['string', 'number'].includes(typeof value)) return '';
  return Array.from(String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()).slice(0, limit).join('');
}

function escapeHtml(value) {
  return text(value, 4000).replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function escapeMarkdown(value) {
  return text(value, 1000)
    .replace(/\\/gu, '\\\\')
    .replace(/([`*_[\]#])/gu, '\\$1')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

function filenamePart(value) {
  return text(value, 60)
    .replace(/[《》\\/:*?"<>|\s]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || '当前篇目';
}

function firstText(...values) {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return '';
}

function itemText(value, limit = 240) {
  if (typeof value === 'string' || typeof value === 'number') return text(value, limit);
  if (!value || typeof value !== 'object') return '';
  return text(value.text ?? value.title ?? value.question ?? value.prompt ?? value.content ?? value.description, limit);
}

function list(value, { limit = 6, textLimit = 240 } = {}) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map(item => itemText(item, textLimit)).filter(Boolean).slice(0, limit);
}

function cardItems(cards, type) {
  const results = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    if (card?.type !== type) continue;
    const values = Array.isArray(card.items) ? card.items : Array.isArray(card.content) ? card.content : [];
    for (const value of values) {
      const result = itemText(value, CARD_TEXT_LIMITS[type]);
      if (result) results.push(result);
      if (results.length >= CARD_LIMITS[type]) return results;
    }
  }
  return results;
}

function sourceType(value = {}) {
  const candidates = [value.documentType, value.document_type, value.sourceType, value.source_type, value.documentId, value.document_id];
  for (const candidate of candidates) {
    const normalized = text(candidate, 80).toLowerCase().replace(/[\s_]+/gu, '-');
    if (['textbook', 'student-textbook', '学生教材', '教材'].includes(normalized)) return 'textbook';
    if (['teacher-guide', 'teacher-guide-book', 'guide', '教师用书', '教师教学用书', '教学用书'].includes(normalized)) return 'teacher-guide';
  }
  return '';
}

function citations(value) {
  const seen = new Set();
  const results = [];
  for (const citation of Array.isArray(value) ? value : []) {
    const type = sourceType(citation);
    const pdfPage = Number(citation?.pdfPage ?? citation?.pdf_page ?? citation?.pageNumber ?? citation?.page_number ?? citation?.page);
    if (!type || !Number.isInteger(pdfPage) || pdfPage < 1 || pdfPage > 100000) continue;
    const key = `${type}:${pdfPage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ type, pdfPage });
  }
  return results.sort((a, b) => (a.type === b.type ? a.pdfPage - b.pdfPage : a.type === 'textbook' ? -1 : 1));
}

function periodText(value) {
  const periods = Number(value);
  return Number.isInteger(periods) && periods >= 1 && periods <= 8 ? `${periods} 课时` : '待填写';
}

function flowItems(value) {
  const values = Array.isArray(value) ? value : [];
  return values.map(item => {
    if (typeof item === 'string' || typeof item === 'number') return text(item, 260);
    if (!item || typeof item !== 'object') return '';
    const title = text(item.title ?? item.name ?? item.stage, 70);
    const content = text(item.content ?? item.teacherAction ?? item.teacher_action ?? item.description, 220);
    const duration = text(item.duration ?? item.time, 24);
    const body = title && content && title !== content ? `${title}：${content}` : title || content;
    return body ? `${body}${duration ? `（${duration}）` : ''}` : '';
  }).filter(Boolean).slice(0, 8);
}

function sourceLabel(source) {
  return `${source.type === 'textbook' ? '学生教材' : '教师用书'} PDF 第 ${source.pdfPage} 页`;
}

function section(id, title, content, kind = 'list') {
  return { id, title, content, kind };
}

function markdownSection(value) {
  const heading = `## ${escapeMarkdown(value.title)}`;
  if (value.kind === 'pairs') {
    return [heading, ...value.content.map(item => `- **${escapeMarkdown(item.label)}：** ${escapeMarkdown(item.value)}`)].join('\n');
  }
  if (value.kind === 'blanks') {
    return [heading, ...value.content.map((item, index) => `${index + 1}. ${escapeMarkdown(item)}：____________________________`)].join('\n');
  }
  return [heading, ...value.content.map(item => `- ${escapeMarkdown(item)}`)].join('\n');
}

function htmlSection(value) {
  if (value.kind === 'pairs') {
    return `<section><h2>${escapeHtml(value.title)}</h2><dl>${value.content.map(item => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join('')}</dl></section>`;
  }
  if (value.kind === 'blanks') {
    return `<section class="feedback"><h2>${escapeHtml(value.title)}</h2><p class="hint">课后只回填以下三项，不记录学生姓名或原始回答。</p><ol>${value.content.map(item => `<li><b>${escapeHtml(item)}</b><span aria-hidden="true"></span></li>`).join('')}</ol></section>`;
  }
  return `<section><h2>${escapeHtml(value.title)}</h2><ul>${value.content.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`;
}

export function buildSubstituteTeachingPack({ draft = {}, cards } = {}) {
  const safeDraft = draft && typeof draft === 'object' ? draft : {};
  const answer = safeDraft.answer && typeof safeDraft.answer === 'object' ? safeDraft.answer : {};
  const lesson = answer.lesson && typeof answer.lesson === 'object' ? answer.lesson : {};
  const context = safeDraft.lesson_context && typeof safeDraft.lesson_context === 'object'
    ? safeDraft.lesson_context
    : safeDraft.lessonContext && typeof safeDraft.lessonContext === 'object' ? safeDraft.lessonContext : {};
  const selectedCards = Array.isArray(cards) ? cards : safeDraft.cards;
  const lessonTitle = firstText(lesson.title, answer.lessonTitle, safeDraft.lesson_title, safeDraft.title) || '当前篇目';
  const packTitle = `${lessonTitle} · 教学接棒单`;
  const className = firstText(context.className, context.class_name, safeDraft.className, safeDraft.class_name) || '待填写';
  const coreQuestion = firstText(lesson.coreQuestion, answer.coreQuestion, safeDraft.coreQuestion, safeDraft.question) || '待确认本课核心问题';
  const objectives = list(answer.objectives ?? answer.goals, { limit: 5, textLimit: 180 });
  const methods = list(answer.teachingMethods ?? answer.teachingMethod ?? answer.methods ?? answer.method ?? context.teachingMethod ?? context.method, { limit: 4, textLimit: 100 });
  const summary = firstText(answer.summary, answer.planSummary, answer.teachingExplanation) || '待代课前与原任课教师确认方案概述。';
  const flow = flowItems(answer.lessonPlan ?? answer.flow ?? answer.steps);
  const board = cardItems(selectedCards, 'board');
  const questions = cardItems(selectedCards, 'question');
  const assessments = cardItems(selectedCards, 'assessment');
  const sources = citations(safeDraft.citations ?? answer.citations);

  const sections = [
    section('handoff', '接棒信息', [
      { label: '篇目', value: lessonTitle },
      { label: '任教班级', value: className },
      { label: '课时', value: periodText(context.periods ?? context.period_count ?? answer.periods) }
    ], 'pairs'),
    section('objectives', '教学目标与方式', [
      ...objectives.map(item => `目标：${item}`),
      ...(objectives.length ? [] : ['目标：待确认']),
      ...methods.map(item => `方式：${item}`),
      ...(methods.length ? [] : ['方式：待确认'])
    ]),
    section('question', '核心问题', [coreQuestion]),
    section('summary', '方案概述', [text(summary, 600)]),
    section('flow', '课堂流程', flow.length ? flow : ['待确认课堂流程。']),
    section('board', '板书短语', board.length ? board : ['待确认板书短语。']),
    section('questions', '课堂提问', questions.length ? questions : ['待确认课堂提问。']),
    section('assessment', '课堂评价', assessments.length ? assessments : ['待确认课堂评价。']),
    section('sources', '教材依据（仅来源类型与真实 PDF 页码）', sources.length ? sources.map(sourceLabel) : ['尚未提供可核验的学生教材或教师用书 PDF 页码。']),
    section('feedback', '课后回填', ['实际完成到哪一步', '学生最卡住的问题', '下一位教师需要接着做的事'], 'blanks')
  ];

  const markdown = [
    `# ${escapeMarkdown(packTitle)}`,
    '',
    '> 给代课老师的可打印交接单。只含已确认的教学方案、三类课堂卡和 PDF 页码。',
    '',
    ...sections.flatMap(value => [markdownSection(value), ''])
  ].join('\n').trimEnd();

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(packTitle)}</title><style>
  :root{color-scheme:light;--ink:#202722;--muted:#66706a;--line:#cfd6d1;--paper:#fff;--wash:#f3f6f4;--accent:#1f5b48}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.65}.page{width:min(900px,calc(100% - 28px));margin:24px auto;background:var(--paper);padding:44px 52px;box-shadow:0 10px 30px #1d382a17}header{border-bottom:3px solid var(--accent);padding-bottom:18px;margin-bottom:24px}header p{margin:5px 0 0;color:var(--muted);font-size:14px}h1{margin:0;font-family:STSong,SimSun,serif;font-size:30px;line-height:1.3}h2{margin:0 0 10px;color:var(--accent);font-size:19px}section{padding:17px 0;border-bottom:1px solid var(--line);break-inside:avoid}ul,ol{margin:0;padding-left:24px}li+li{margin-top:6px}dl{margin:0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}dl div{background:var(--wash);padding:10px 12px}dt{color:var(--muted);font-size:12px}dd{margin:2px 0 0;font-weight:700;overflow-wrap:anywhere}.hint{margin:-4px 0 10px;color:var(--muted);font-size:13px}.feedback li{padding-bottom:28px}.feedback li span{display:block;border-bottom:1px solid #6f7772;margin-top:18px}footer{padding-top:18px;color:var(--muted);font-size:12px}@media(max-width:620px){.page{width:100%;margin:0;padding:24px 18px;box-shadow:none}h1{font-size:25px}dl{grid-template-columns:1fr}section{padding:15px 0}}@media print{@page{size:A4;margin:14mm}body{background:#fff}.page{width:auto;margin:0;padding:0;box-shadow:none}header{margin-bottom:14px}section{padding:11px 0}.feedback li{padding-bottom:20px}}
  </style></head><body><main class="page"><header><h1>${escapeHtml(packTitle)}</h1><p>临时请假或调课时使用 · 可直接打印 · 不含学生个人信息与课堂历史</p></header>${sections.map(htmlSection).join('')}<footer>引用只标注来源类型与 PDF 页码；请以原始 PDF 为唯一核验依据。</footer></main></body></html>`;

  return {
    title: packTitle,
    filename: `活教参-${filenamePart(lessonTitle)}-教学接棒单.html`,
    markdown,
    html,
    citationCount: sources.length,
    sectionCount: sections.length
  };
}

export default buildSubstituteTeachingPack;
