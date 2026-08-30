function text(value, max = 600) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function lines(value, maxItems = 8, maxLength = 260) {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/u) : [];
  return source.map(item => text(typeof item === 'object' ? item.text || item.content || item.title || item.question : item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function escapeHtml(value) {
  return text(value, 8000).replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value || '')) { result ^= character.codePointAt(0); result = Math.imul(result, 16777619); }
  return (result >>> 0).toString(36);
}

function documentId(citation = {}) {
  const id = text(citation.documentId || citation.document_id || citation.documentType || citation.document_type, 80).toLowerCase().replaceAll('_', '-');
  if (id.includes('teacher') || id === 'guide') return 'teacher-guide';
  if (id.includes('student') || id === 'textbook') return 'textbook';
  return id;
}

function cardItems(draft, type) {
  const card = (Array.isArray(draft?.cards) ? draft.cards : []).find(item => item?.type === type) || {};
  const source = Array.isArray(card.items) ? card.items : Array.isArray(card.content) ? card.content : [];
  return source.map((item, index) => ({ id: text(item?.id || `${type}-${index + 1}`, 100), text: text(item?.text || item?.content || item, 320), citationIds: [...new Set((Array.isArray(item?.citationIds) ? item.citationIds : []).map(String).filter(Boolean))].slice(0, 6) })).filter(item => item.text).slice(0, 8);
}

function citationMap(draft = {}) {
  return new Map((Array.isArray(draft.citations) ? draft.citations : []).filter(item => item?.id).map(item => [String(item.id), item]));
}

function refs(ids, citations, type) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter(id => citations.has(id) && documentId(citations.get(id)) === type);
}

function task(id, level, label, prompt, directions, sourceItem, citations, answerGuide, rubric) {
  const studentCitationIds = refs(sourceItem?.citationIds, citations, 'textbook');
  if (!studentCitationIds.length) return null;
  return {
    id, level, label, prompt: text(prompt, 360), directions: text(directions, 420), score: rubric.reduce((sum, item) => sum + item.points, 0),
    studentCitationIds, teacherCitationIds: refs(sourceItem?.citationIds, citations, 'teacher-guide'),
    answerGuide: lines(answerGuide, 5, 320), rubric
  };
}

function criterion(id, label, points, description) {
  return { id, label: text(label, 80), points: Math.max(1, Math.min(10, Number(points) || 1)), description: text(description, 260) };
}

export function layeredHomeworkSourceKey(draft = {}) {
  const identity = {
    confirmedAt: draft.answer?.planApproval?.confirmedAt || draft.answer?.planApproval?.confirmedVersion || '',
    lesson: draft.answer?.lesson || {}, homework: draft.answer?.homework || [],
    cards: (Array.isArray(draft.cards) ? draft.cards : []).map(card => [card?.type, cardItems(draft, card?.type).map(item => [item.text, item.citationIds])]),
    citations: (Array.isArray(draft.citations) ? draft.citations : []).map(item => [item?.id, documentId(item), Number(item?.pdfPage ?? item?.pdf_page ?? item?.page) || 0])
  };
  return `homework1:${hash(JSON.stringify(identity))}`;
}

export function buildLayeredHomework(draft = {}) {
  const approval = draft.answer?.planApproval;
  if (approval?.status !== 'confirmed' || approval?.hasUnconfirmedChanges === true) throw Object.assign(new Error('homework_requires_confirmed_plan'), { code: 'homework_requires_confirmed_plan', status: 409 });
  if (!Array.isArray(draft.cards) || !draft.cards.length) throw Object.assign(new Error('homework_requires_cards'), { code: 'homework_requires_cards', status: 409 });
  const citations = citationMap(draft);
  const board = cardItems(draft, 'board');
  const questions = cardItems(draft, 'question');
  const assessments = cardItems(draft, 'assessment');
  const grounded = [...questions, ...assessments, ...board].filter(item => refs(item.citationIds, citations, 'textbook').length);
  if (!grounded.length) throw Object.assign(new Error('homework_requires_textbook_evidence'), { code: 'homework_requires_textbook_evidence', status: 409 });
  const foundation = grounded[0], core = grounded[1] || grounded[0], extension = assessments[0] || grounded[2] || grounded[0];
  const boardGuide = board.slice(0, 3).map(item => item.text);
  const answerHomework = lines(draft.answer?.homework, 4, 320);
  const tasks = [
    task('foundation', 'A', '基础巩固', foundation.text, '在学生教材对应页面定位相关词句，摘录最关键的一处，并用一句话说明它写了什么。', foundation, citations, boardGuide.length ? boardGuide : ['答案必须包含准确的原文位置和基本内容说明。'], [criterion('locate', '原文定位准确', 2, '摘录或标明与问题直接相关的教材词句。'), criterion('meaning', '基本理解正确', 2, '能用自己的话说明词句的基本意思。')]),
    task('core', 'B', '核心理解', core.text, '按“原文依据—文本发现—形成判断”的顺序完成回答，不能只写结论。', core, citations, [...boardGuide, ...answerHomework].slice(0, 5), [criterion('evidence', '教材依据有效', 2, '引用内容能够直接支撑回答。'), criterion('relation', '关系解释完整', 3, '说清词句、表达特点与判断之间的关系。')]),
    task('extension', 'C', '迁移表达', extension.text, '完成一段 120—180 字的独立表达；可以采用不同观点，但必须引用教材并解释理由。', extension, citations, answerHomework.length ? answerHomework : ['开放表达不设唯一措辞；判断必须有教材依据，解释必须自洽。'], [criterion('claim', '观点明确', 2, '开头能够直接回应任务。'), criterion('support', '依据与解释充分', 4, '至少使用一处教材依据并解释它怎样支持观点。'), criterion('expression', '表达清楚', 2, '语句连贯，层次清晰。')])
  ].filter(Boolean);
  const references = [...citations.values()].map(item => ({ id: String(item.id), documentId: documentId(item), pdfPage: Math.floor(Number(item.pdfPage ?? item.pdf_page ?? item.page)), printedPage: text(item.printedPage || item.printed_page, 30) })).filter(item => item.pdfPage > 0);
  const now = new Date().toISOString();
  return { version: 1, sourceKey: layeredHomeworkSourceKey(draft), status: 'draft', lessonTitle: text(draft.answer?.lesson?.title || draft.title, 120), coreQuestion: text(draft.answer?.lesson?.coreQuestion || draft.question, 260), tasks, references, totalScore: tasks.reduce((sum, item) => sum + item.score, 0), updatedAt: now, confirmedAt: null, confirmedBy: null };
}

export function normalizeLayeredHomework(value = {}) {
  const tasks = (Array.isArray(value.tasks) ? value.tasks : []).slice(0, 6).map((item, index) => ({
    id: text(item?.id || `task-${index + 1}`, 100), level: ['A', 'B', 'C'].includes(item?.level) ? item.level : 'B', label: text(item?.label, 80), prompt: text(item?.prompt, 360), directions: text(item?.directions, 420), score: Math.max(0, Math.min(100, Number(item?.score) || 0)),
    studentCitationIds: [...new Set((Array.isArray(item?.studentCitationIds) ? item.studentCitationIds : []).map(String).filter(Boolean))].slice(0, 8), teacherCitationIds: [...new Set((Array.isArray(item?.teacherCitationIds) ? item.teacherCitationIds : []).map(String).filter(Boolean))].slice(0, 8), answerGuide: lines(item?.answerGuide, 5, 320),
    rubric: (Array.isArray(item?.rubric) ? item.rubric : []).slice(0, 5).map((criterion, criterionIndex) => ({ id: text(criterion?.id || `criterion-${criterionIndex + 1}`, 100), label: text(criterion?.label, 80), points: Math.max(1, Math.min(10, Number(criterion?.points) || 1)), description: text(criterion?.description, 260) }))
  }));
  return { version: 1, sourceKey: text(value.sourceKey, 120), status: value.status === 'confirmed' ? 'confirmed' : 'draft', lessonTitle: text(value.lessonTitle, 120), coreQuestion: text(value.coreQuestion, 260), tasks, references: (Array.isArray(value.references) ? value.references : []).map(item => ({ id: text(item?.id, 100), documentId: documentId(item), pdfPage: Math.floor(Number(item?.pdfPage || 0)), printedPage: text(item?.printedPage, 30) })).filter(item => item.id && item.pdfPage > 0).slice(0, 30), totalScore: tasks.reduce((sum, item) => sum + item.rubric.reduce((score, criterion) => score + criterion.points, 0), 0), updatedAt: value.updatedAt || null, confirmedAt: value.confirmedAt || null, confirmedBy: text(value.confirmedBy, 120) || null };
}

export function layeredHomeworkIsStale(draft = {}) {
  const value = normalizeLayeredHomework(draft.answer?.layeredHomework || {});
  return Boolean(value.sourceKey && value.sourceKey !== layeredHomeworkSourceKey(draft));
}

export function mergeLayeredHomework(baseValue, input = {}, { confirm = false, confirmedBy = '' } = {}) {
  const base = normalizeLayeredHomework(baseValue);
  if (base.status === 'confirmed') throw Object.assign(new Error('homework_confirmed'), { code: 'homework_confirmed', status: 409 });
  const submitted = new Map((Array.isArray(input.tasks) ? input.tasks : []).map(item => [String(item?.id || ''), item]));
  const tasks = base.tasks.map(item => {
    const next = submitted.get(item.id) || {};
    const rubricInput = new Map((Array.isArray(next.rubric) ? next.rubric : []).map(criterion => [String(criterion?.id || ''), criterion]));
    const rubric = item.rubric.map(criterion => { const edit = rubricInput.get(criterion.id) || {}; return { ...criterion, label: text(edit.label ?? criterion.label, 80), description: text(edit.description ?? criterion.description, 260), points: criterion.points }; });
    return { ...item, prompt: text(next.prompt ?? item.prompt, 360), directions: text(next.directions ?? item.directions, 420), answerGuide: lines(next.answerGuide ?? item.answerGuide, 5, 320), rubric, score: rubric.reduce((sum, criterion) => sum + criterion.points, 0) };
  });
  if (confirm && tasks.some(item => !item.prompt || !item.directions || !item.answerGuide.length || !item.rubric.length)) throw Object.assign(new Error('homework_incomplete'), { code: 'homework_incomplete', status: 422 });
  const now = new Date().toISOString();
  return { ...base, tasks, totalScore: tasks.reduce((sum, item) => sum + item.score, 0), status: confirm ? 'confirmed' : 'draft', updatedAt: now, confirmedAt: confirm ? now : null, confirmedBy: confirm ? text(confirmedBy, 120) || null : null };
}

function referenceMap(pack, type) {
  return new Map(pack.references.filter(item => item.documentId === type).map(item => [item.id, item]));
}

export function layeredHomeworkStudentHtml(value = {}) {
  const pack = normalizeLayeredHomework(value), refsMap = referenceMap(pack, 'textbook');
  const tasks = pack.tasks.map(item => `<article><header><span>${item.level}</span><div><small>${escapeHtml(item.label)} · ${item.score} 分</small><h2>${escapeHtml(item.prompt)}</h2></div></header><p>${escapeHtml(item.directions)}</p><div class="refs">${item.studentCitationIds.map(id => refsMap.get(id)).filter(Boolean).map(ref => `学生教材 PDF 第 ${ref.pdfPage} 页`).join(' · ')}</div><div class="lines">${Array.from({ length: item.level === 'C' ? 8 : item.level === 'B' ? 6 : 4 }, () => '<i></i>').join('')}</div></article>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(pack.lessonTitle)} · 分层作业</title><style>*{box-sizing:border-box}body{margin:0;background:#edf2ef;color:#213f36;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.page{width:210mm;min-height:297mm;margin:24px auto;padding:16mm;background:#fffdf7;box-shadow:0 20px 55px #183d3321}.head{display:flex;justify-content:space-between;gap:20px;padding-bottom:12px;border-bottom:4px solid #244f42}.head span{color:#a27a30;font-size:11px;font-weight:900}.head h1{margin:7px 0;font-family:STSong,SimSun,serif;font-size:28px}.head p{margin:0;color:#687870}.identity{display:flex;gap:30px;margin:14px 0;color:#566a62;font-size:12px}.identity i{display:inline-block;width:85px;border-bottom:1px solid #84968f}.core{padding:10px 13px;background:#edf4ef;border-left:4px solid #ba8a38}.core b{font-size:11px}.core p{margin:5px 0 0;font-family:STSong,SimSun,serif;font-size:16px}article{margin-top:14px;padding:13px 15px;border:1px solid #d9e1dc;break-inside:avoid}article header{display:grid;grid-template-columns:35px 1fr;gap:11px}article header>span{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#245344;color:#efd079;font-weight:900}article small{color:#99732e;font-weight:900}article h2{margin:4px 0;font-family:STSong,SimSun,serif;font-size:17px;line-height:1.5}article>p{margin:8px 0;color:#40574f;font-size:12px;line-height:1.6}.refs{color:#71837b;font-size:10px}.lines{display:grid;gap:10px;margin-top:10px}.lines i{height:14px;border-bottom:1px solid #c6d1cc}.foot{margin-top:16px;padding-top:9px;border-top:1px solid #dbe3df;color:#74847d;font-size:10px;text-align:center}@media(max-width:850px){.page{width:auto;min-height:0;margin:0;padding:24px}.identity{flex-direction:column;gap:10px}}@media print{@page{size:A4;margin:0}body{background:#fff}.page{width:210mm;min-height:297mm;margin:0;padding:16mm;box-shadow:none}}</style></head><body><main class="page"><header class="head"><div><span>学生分层作业</span><h1>${escapeHtml(pack.lessonTitle)}</h1><p>先完成 A，再根据教师要求完成 B 或 C。</p></div><b>${pack.totalScore} 分</b></header><div class="identity"><span>班级：<i></i></span><span>姓名：<i></i></span><span>日期：<i></i></span></div><section class="core"><b>本课核心问题</b><p>${escapeHtml(pack.coreQuestion)}</p></section>${tasks}<footer class="foot">本页只包含题目、作答区与学生教材页码 · 原始教材 PDF 是唯一可核验依据</footer></main></body></html>`;
}

export function layeredHomeworkTeacherMarkdown(value = {}) {
  const pack = normalizeLayeredHomework(value), refsMap = new Map(pack.references.map(item => [item.id, item]));
  return [`# ${pack.lessonTitle}｜分层作业参考批改单`, '', `核心问题：${pack.coreQuestion}`, '', ...pack.tasks.flatMap(item => [`## ${item.level} · ${item.label}（${item.score} 分）`, '', `**题目：** ${item.prompt}`, '', '**参考要点：**', ...item.answerGuide.map(line => `- ${line}`), '', '**评分量规：**', ...item.rubric.map(criterion => `- ${criterion.label}（${criterion.points} 分）：${criterion.description}`), '', '**核验页面：**', ...[...item.studentCitationIds, ...item.teacherCitationIds].map(id => refsMap.get(id)).filter(Boolean).map(ref => `- ${ref.documentId === 'teacher-guide' ? '教师用书' : '学生教材'} PDF 第 ${ref.pdfPage} 页`), '']), '> 参考要点用于提高批改一致性，不是要求学生使用唯一措辞。'].join('\n');
}
