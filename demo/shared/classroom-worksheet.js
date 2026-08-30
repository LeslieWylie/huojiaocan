const TYPE_LABELS = { textbook: '学生教材', 'teacher-guide': '教师教学用书', 'curriculum-standard': '课程标准' };

function clean(value, max = 800) {
  return String(value || '').replace(/\u0000/gu, '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function unique(list, max = 6) {
  return [...new Set((Array.isArray(list) ? list : []).map(item => clean(item, 120)).filter(Boolean))].slice(0, max);
}

function canonicalDocumentType(value) {
  const text = clean(value, 80).toLowerCase().replaceAll('_', '-');
  if (text === 'teacher-guide' || text.includes('teacher')) return 'teacher-guide';
  if (text === 'textbook' || text.includes('student')) return 'textbook';
  if (['curriculum-standard', 'curriculum', 'standard', 'course-standard'].includes(text)) return 'curriculum-standard';
  return text;
}

function normalizedCitations(citations = []) {
  const map = new Map();
  for (const [index, item] of (Array.isArray(citations) ? citations : []).entries()) {
    const id = clean(item?.id || item?.citationId || `citation-${index}`, 120);
    const pdfPage = Number(item?.pdfPage ?? item?.pdf_page ?? item?.page);
    const documentId = clean(item?.documentId || item?.document_id, 120);
    const type = canonicalDocumentType(item?.documentType || item?.document_type || documentId);
    if (!id || !documentId || !Number.isInteger(pdfPage) || pdfPage < 1) continue;
    map.set(id, {
      id,
      documentId,
      documentType: type,
      documentTitle: clean(item?.documentTitle || item?.document_title, 100) || TYPE_LABELS[type] || documentId,
      pdfPage,
      printedPage: clean(item?.printedPage || item?.printed_page, 20)
    });
  }
  return map;
}

function cardItems(cards = [], type) {
  const card = (Array.isArray(cards) ? cards : []).find(item => item?.type === type);
  const source = Array.isArray(card?.items) ? card.items : Array.isArray(card?.content) ? card.content : [];
  const cardRefs = unique(card?.citationIds || card?.evidenceRefs, 6);
  return source.map((item, index) => typeof item === 'string'
    ? { id: `${type}-${index + 1}`, text: clean(item, 600), citationIds: cardRefs }
    : {
        id: clean(item?.id || `${type}-${index + 1}`, 120),
        text: clean(item?.text || item?.content || item?.question || item?.title, 600),
        citationIds: unique(item?.citationIds || item?.evidenceRefs || cardRefs, 6)
      }).filter(item => item.text);
}

function citationsFor(ids, citationMap, type = '') {
  return unique(ids, 6).map(id => citationMap.get(id)).filter(item => item && (!type || item.documentType === type));
}

function task(id, level, title, source, action, observeFor, citationMap, blankLines) {
  const studentCitations = citationsFor(source.citationIds, citationMap, 'textbook');
  if (!studentCitations.length) return null;
  return {
    id,
    level,
    title,
    prompt: source.text,
    studentAction: action,
    observeFor,
    blankLines,
    studentCitations,
    teacherCitations: citationsFor(source.citationIds, citationMap)
  };
}

export function buildClassroomWorksheet({ title, coreQuestion, cards = [], citations = [] } = {}) {
  const citationMap = normalizedCitations(citations);
  const questions = cardItems(cards, 'question').filter(item => citationsFor(item.citationIds, citationMap, 'textbook').length);
  const assessments = cardItems(cards, 'assessment').filter(item => citationsFor(item.citationIds, citationMap, 'textbook').length);
  const board = cardItems(cards, 'board').filter(item => citationsFor(item.citationIds, citationMap, 'textbook').length);
  const primary = questions[0] || board[0] || null;
  const secondary = questions[1] || questions[0] || board[1] || board[0] || null;
  const assessment = assessments[0] || null;
  const tasks = [
    primary && task('task-locate', 'A', '圈画关键依据', primary, '在学生教材对应页面圈出能够支持回答的词句，并抄写两个最关键的词语。', '能否准确定位具体词句，而不是只复述结论。', citationMap, 3),
    secondary && task('task-explain', 'B', '解释词句关系', secondary, '按“词句—发现—判断”的顺序写出完整解释，回答中至少使用一处教材词句。', '能否说明词句特征怎样支撑文本判断。', citationMap, 5),
    assessment && task('task-transfer', 'C', '完成独立表达', assessment, '根据评价要求完成一段独立表达，写完后检查是否引用教材、解释关系并形成结论。', '是否同时做到引用准确、解释完整、表达清楚。', citationMap, 6)
  ].filter(Boolean);
  const usedTeacherGuide = tasks.flatMap(item => item.teacherCitations).some(item => item.documentType === 'teacher-guide');
  const usedCitationCount = new Set(tasks.flatMap(item => item.teacherCitations.map(citation => citation.id))).size;
  const warnings = [];
  if (!tasks.length) warnings.push('当前三卡没有绑定学生教材原页，暂不能生成学生任务单。');
  if (tasks.length < 3) warnings.push('当前只生成了有学生教材依据的任务；缺少的层级不会用无来源内容补齐。');
  if (!usedTeacherGuide) warnings.push('当前任务没有绑定教师用书页，教师观察单只呈现学生教材依据。');
  return {
    version: 1,
    title: clean(title, 120) || '课堂任务单',
    coreQuestion: clean(coreQuestion, 220),
    status: tasks.length >= 2 ? 'ready' : tasks.length ? 'partial' : 'blocked',
    tasks,
    usedCitationCount,
    warnings
  };
}

function escapeHtml(value) {
  return clean(value, 5000).replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function filenamePart(value) {
  return clean(value, 60).replace(/[\\/:*?"<>|\s]+/gu, '-').replace(/^-+|-+$/gu, '') || '课堂任务单';
}

function citationLabel(item) {
  return `${item.documentTitle} · PDF 第 ${item.pdfPage} 页${item.printedPage ? `（印刷页 ${item.printedPage}）` : ''}`;
}

function studentTaskHtml(item) {
  return `<article class="task"><header><span>${escapeHtml(item.level)}</span><div><small>${escapeHtml(item.title)}</small><h2>${escapeHtml(item.prompt)}</h2></div></header><p class="action">${escapeHtml(item.studentAction)}</p><p class="page-ref">教材位置：${item.studentCitations.map(citationLabel).map(escapeHtml).join('；')}</p><div class="writing-lines">${Array.from({ length: item.blankLines }, () => '<i></i>').join('')}</div></article>`;
}

function teacherTaskHtml(item) {
  return `<article class="teacher-task"><header><span>${escapeHtml(item.level)}</span><div><small>${escapeHtml(item.title)}</small><h2>${escapeHtml(item.prompt)}</h2></div></header><dl><div><dt>学生任务</dt><dd>${escapeHtml(item.studentAction)}</dd></div><div><dt>教师观察</dt><dd>${escapeHtml(item.observeFor)}</dd></div><div><dt>教材依据</dt><dd>${item.teacherCitations.map(citationLabel).map(escapeHtml).join('；')}</dd></div></dl><div class="teacher-note"><b>课堂记录</b><i></i><i></i></div></article>`;
}

export function buildClassroomWorksheetHtml(worksheet = {}) {
  const sheet = worksheet?.version === 1 ? worksheet : buildClassroomWorksheet(worksheet);
  const safeTitle = escapeHtml(sheet.title || '课堂任务单');
  const studentTasks = sheet.tasks.map(studentTaskHtml).join('');
  const teacherTasks = sheet.tasks.map(teacherTaskHtml).join('');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} · 双页课堂任务单</title><style>
  *{box-sizing:border-box}body{margin:0;background:#e9efec;color:#183f39;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}.toolbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 22px;background:#173f38;color:#fff}.toolbar b{font-family:STSong,SimSun,serif;font-size:20px}.toolbar div{display:flex;gap:8px}.toolbar button{border:1px solid #ffffff3d;border-radius:8px;background:#ffffff10;color:#fff;padding:8px 11px;font:inherit;font-weight:700}.pages{display:grid;gap:24px;max-width:960px;margin:24px auto;padding:0 18px}.page{width:210mm;min-height:297mm;margin:auto;background:#fffdf8;padding:15mm 16mm;box-shadow:0 18px 50px #153c3323;page-break-after:always}.page:last-child{page-break-after:auto}.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;border-bottom:3px solid #c49645;padding-bottom:10px}.page-head span{color:#9a6b28;font-size:11px;font-weight:900;letter-spacing:.1em}.page-head h1{margin:5px 0 3px;font-family:STSong,SimSun,serif;font-size:25px}.page-head p{margin:0;color:#64766f;font-size:12px}.identity{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:12px;color:#556b64;font-size:12px}.identity i{display:inline-block;width:70%;border-bottom:1px solid #789087}.core{margin:14px 0;border-left:4px solid #3f7e70;background:#eef6f2;padding:10px 12px}.core b{font-size:12px}.core p{margin:4px 0 0;font-family:STSong,SimSun,serif;font-size:16px}.task,.teacher-task{margin-top:13px;border:1px solid #d8e3de;border-radius:9px;padding:12px 14px;break-inside:avoid}.task header,.teacher-task header{display:grid;grid-template-columns:30px 1fr;gap:10px}.task header>span,.teacher-task header>span{display:grid;place-items:center;width:29px;height:29px;border-radius:50%;background:#ba8737;color:#fff;font-weight:900}.task small,.teacher-task small{color:#9a6b2c;font-size:10px;font-weight:900}.task h2,.teacher-task h2{margin:3px 0;font-family:STSong,SimSun,serif;font-size:16px;line-height:1.45}.action{margin:8px 0;color:#405b54;font-size:12px;line-height:1.55}.page-ref{margin:7px 0;color:#71837d;font-size:10px}.writing-lines{display:grid;gap:9px;margin-top:10px}.writing-lines i,.teacher-note i{height:12px;border-bottom:1px solid #cbd8d2}.self-check{display:flex;gap:18px;margin-top:14px;border-top:1px dashed #b9c9c2;padding-top:10px;color:#4e655e;font-size:11px}.self-check span:before{content:"□";margin-right:5px}.teacher-intro{margin:14px 0 4px;color:#576b65;font-size:12px;line-height:1.6}.teacher-task dl{display:grid;gap:6px;margin:9px 0 0}.teacher-task dl>div{display:grid;grid-template-columns:68px 1fr;gap:8px}.teacher-task dt{color:#9a6b2c;font-size:11px;font-weight:900}.teacher-task dd{margin:0;color:#3e5750;font-size:11px;line-height:1.55}.teacher-note{display:grid;grid-template-columns:68px 1fr;gap:5px 8px;margin-top:9px}.teacher-note b{grid-row:1/3;color:#9a6b2c;font-size:11px}.page-foot{display:flex;justify-content:space-between;margin-top:14px;border-top:1px solid #dce5e1;padding-top:8px;color:#788983;font-size:9px}@media(max-width:850px){.page{width:100%;min-height:0;padding:24px}.toolbar{align-items:flex-start;flex-direction:column}.pages{padding:0 8px}.identity{grid-template-columns:1fr}.teacher-task dl>div{grid-template-columns:1fr}.teacher-note{grid-template-columns:1fr}}@media print{@page{size:A4;margin:0}body{background:#fff}.toolbar{display:none}.pages{display:block;margin:0;padding:0}.page{width:210mm;height:297mm;min-height:297mm;margin:0;padding:15mm 16mm;box-shadow:none;overflow:hidden}}
  </style></head><body><header class="toolbar"><b>${safeTitle} · 双页课堂任务单</b><div><button type="button" data-print="student">只打印学生页</button><button type="button" data-print="teacher">只打印教师页</button><button type="button" data-print="all">打印两页</button></div></header><main class="pages"><section class="page student-page"><header class="page-head"><div><span>学生课堂任务单</span><h1>${safeTitle}</h1><p>所有回答都要回到学生教材原文。</p></div><b>第 1 页</b></header><div class="identity"><span>班级：<i></i></span><span>姓名：<i></i></span><span>日期：<i></i></span></div>${sheet.coreQuestion ? `<div class="core"><b>本课核心问题</b><p>${escapeHtml(sheet.coreQuestion)}</p></div>` : ''}${studentTasks || '<p>当前没有绑定学生教材原页的任务。</p>'}<div class="self-check"><span>我引用了教材词句</span><span>我解释了词句与判断的关系</span><span>我写出了完整结论</span></div><footer class="page-foot"><span>学生页不包含教师用书内容或参考提示</span><span>原始教材 PDF 是唯一可核验依据</span></footer></section><section class="page teacher-page"><header class="page-head"><div><span>教师观察单</span><h1>${safeTitle}</h1><p>用于看学生怎样使用教材依据，不是标准答案。</p></div><b>第 2 页</b></header><p class="teacher-intro">先看学生能否定位，再看能否解释关系，最后看能否形成独立表达。教师用书只出现在本页，学生页不会带出。</p>${teacherTasks || '<p>当前没有可用的课堂任务。</p>'}<footer class="page-foot"><span>共使用 ${Number(sheet.usedCitationCount) || 0} 个已核验教材页面</span><span>请回到原始 PDF 核验具体内容</span></footer></section></main><script>(()=>{const pages=[...document.querySelectorAll('.page')];document.querySelectorAll('[data-print]').forEach(button=>button.addEventListener('click',()=>{const mode=button.dataset.print;pages.forEach(page=>page.style.display=mode==='all'||page.classList.contains(mode+'-page')?'block':'none');window.print();pages.forEach(page=>page.style.display='block');}));})();</script></body></html>`;
  return { filename: `活教参-${filenamePart(sheet.title)}-双页课堂任务单.html`, html, pageCount: 2, taskCount: sheet.tasks.length, citationCount: Number(sheet.usedCitationCount) || 0 };
}
