function text(value, max = 500) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function lines(value, maxItems = 8, maxLength = 220) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/u) : [];
  return values.map(item => text(typeof item === 'object' ? item.text || item.title || item.question || item.content : item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function escapeHtml(value) {
  return text(value, 6000).replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value || '')) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function documentId(citation = {}) {
  const value = text(citation.documentId || citation.document_id || citation.documentType || citation.document_type, 80).toLowerCase().replaceAll('_', '-');
  if (['student-textbook', 'student-book'].includes(value)) return 'textbook';
  if (['teacher-guidebook', 'teacher-guide', 'guide'].includes(value)) return 'teacher-guide';
  return value;
}

function citationsById(draft = {}) {
  return new Map((Array.isArray(draft.citations) ? draft.citations : []).filter(item => item?.id).map(item => [String(item.id), item]));
}

function card(draft, type) {
  return (Array.isArray(draft?.cards) ? draft.cards : []).find(item => item?.type === type) || {};
}

function items(value, limit = 6) {
  const source = Array.isArray(value?.items) ? value.items : Array.isArray(value?.content) ? value.content : [];
  return source.map((item, index) => ({
    id: text(item?.id || `${value?.type || 'item'}-${index + 1}`, 100),
    text: text(item?.text || item?.content || item, 260),
    citationIds: [...new Set((Array.isArray(item?.citationIds) ? item.citationIds : []).map(String).filter(Boolean))].slice(0, 6)
  })).filter(item => item.text).slice(0, limit);
}

function refsFor(cardItems, citationMap, wanted) {
  return [...new Set(cardItems.flatMap(item => item.citationIds))].filter(id => citationMap.has(id) && wanted(documentId(citationMap.get(id))));
}

function notesFor(cardItems, citationMap, fallback) {
  const pages = refsFor(cardItems, citationMap, id => id === 'teacher-guide').map(id => {
    const item = citationMap.get(id);
    const page = Number(item.pdfPage ?? item.pdf_page ?? item.page);
    return Number.isInteger(page) && page > 0 ? `备课时核对教师用书 PDF 第 ${page} 页。` : '';
  }).filter(Boolean);
  return [...new Set([...pages, ...lines(fallback, 3, 260)])].slice(0, 4);
}

function slide(id, kind, title, body, { prompt = '', citationIds = [], teacherCitationIds = [], teacherNotes = [] } = {}) {
  return { id, kind, title: text(title, 100), body: lines(body, 7, 260), prompt: text(prompt, 260), citationIds, teacherCitationIds, teacherNotes: lines(teacherNotes, 5, 360) };
}

export function teachingSlidesSourceKey(draft = {}) {
  const approval = draft.answer?.planApproval || {};
  const identity = {
    confirmedAt: approval.confirmedAt || approval.confirmedVersion || '',
    lesson: draft.answer?.lesson || {},
    cards: (Array.isArray(draft.cards) ? draft.cards : []).map(item => ({ type: item?.type, items: items(item).map(entry => ({ text: entry.text, citationIds: entry.citationIds })) })),
    citations: (Array.isArray(draft.citations) ? draft.citations : []).map(item => [item?.id, documentId(item), Number(item?.pdfPage ?? item?.pdf_page ?? item?.page) || 0])
  };
  return `slides1:${hash(JSON.stringify(identity))}`;
}

export function buildTeachingSlideDeck(draft = {}) {
  const approval = draft.answer?.planApproval;
  if (approval?.status !== 'confirmed' || approval?.hasUnconfirmedChanges === true) {
    throw Object.assign(new Error('teaching_slides_require_confirmed_plan'), { code: 'teaching_slides_require_confirmed_plan', status: 409 });
  }
  if (!Array.isArray(draft.cards) || !draft.cards.length) {
    throw Object.assign(new Error('teaching_slides_require_cards'), { code: 'teaching_slides_require_cards', status: 409 });
  }
  const answer = draft.answer || {};
  const title = text(answer.lesson?.title || draft.title || draft.question, 120) || '课堂课件';
  const coreQuestion = text(answer.lesson?.coreQuestion || draft.question, 240) || `围绕${title}，学生最终要说清什么？`;
  const boardItems = items(card(draft, 'board'));
  const questionItems = items(card(draft, 'question'));
  const assessmentItems = items(card(draft, 'assessment'));
  const citationMap = citationsById(draft);
  const studentRefs = list => refsFor(list, citationMap, id => id === 'textbook');
  const teacherRefs = list => refsFor(list, citationMap, id => id === 'teacher-guide');
  const objectives = lines(answer.objectives || answer.teachingObjectives || answer.goals, 4, 180);
  const route = lines(answer.lessonPlan || answer.flow || answer.teachingProcess, 5, 180);
  const keyPoints = lines(answer.keyPoints || answer.difficulties || answer.focus, 3, 220);
  const slides = [
    slide('cover', 'cover', title, [coreQuestion], { prompt: '先让学生看见本节课唯一需要解决的核心问题。' }),
    slide('route', 'route', '这节课怎么走', objectives.length ? objectives : route.length ? route : ['回到原文', '形成判断', '用依据表达'], { teacherNotes: keyPoints }),
    slide('text', 'evidence', '先回到原文', boardItems.slice(0, 3).map(item => item.text), {
      prompt: '圈画最能支撑判断的词句，不急着给结论。', citationIds: studentRefs(boardItems), teacherCitationIds: teacherRefs(boardItems), teacherNotes: notesFor(boardItems, citationMap, keyPoints)
    }),
    slide('questions', 'questions', '沿着问题往下读', questionItems.map(item => item.text), {
      prompt: '每次回答都要指出教材中的具体依据。', citationIds: studentRefs(questionItems), teacherCitationIds: teacherRefs(questionItems), teacherNotes: notesFor(questionItems, citationMap, answer.questionChain)
    }),
    slide('reasoning', 'activity', '把依据说完整', ['我发现了什么', '哪一句原文支持', '它怎样回答核心问题'], {
      prompt: '先独立写，再同桌互证，最后全班修正。', citationIds: studentRefs([...boardItems, ...questionItems]), teacherCitationIds: teacherRefs([...boardItems, ...questionItems]), teacherNotes: ['只追问“依据在哪里、关系是什么”，不要提前替学生概括。']
    }),
    slide('conclusion', 'board', '课堂生成：我们现在能说清什么', boardItems.map(item => item.text), {
      prompt: '先保留空白，学生表达后再逐条出现。', citationIds: studentRefs(boardItems), teacherCitationIds: teacherRefs(boardItems), teacherNotes: notesFor(boardItems, citationMap, keyPoints)
    }),
    slide('exit', 'assessment', '离开课堂前完成', assessmentItems.map(item => item.text), {
      prompt: '独立完成，用一句原文或一个文本细节支撑判断。', citationIds: studentRefs(assessmentItems), teacherCitationIds: teacherRefs(assessmentItems), teacherNotes: notesFor(assessmentItems, citationMap, answer.assessment)
    })
  ].map((item, index) => ({ ...item, order: index + 1 }));
  return {
    version: 1,
    sourceKey: teachingSlidesSourceKey(draft),
    status: 'draft',
    lessonTitle: title,
    slides,
    references: [...citationMap.values()].map(item => ({
      id: String(item.id), documentId: documentId(item),
      pdfPage: Number(item.pdfPage ?? item.pdf_page ?? item.page) || 0,
      printedPage: text(item.printedPage || item.printed_page, 30)
    })).filter(item => item.pdfPage > 0),
    updatedAt: new Date().toISOString(),
    confirmedAt: null,
    confirmedBy: null
  };
}

export function normalizeTeachingSlideDeck(value = {}) {
  const slides = (Array.isArray(value.slides) ? value.slides : []).slice(0, 12).map((item, index) => ({
    id: text(item?.id || `slide-${index + 1}`, 100), kind: text(item?.kind || 'content', 40), title: text(item?.title, 100),
    body: lines(item?.body, 7, 260), prompt: text(item?.prompt, 260),
    citationIds: [...new Set((Array.isArray(item?.citationIds) ? item.citationIds : []).map(String).filter(Boolean))].slice(0, 8),
    teacherCitationIds: [...new Set((Array.isArray(item?.teacherCitationIds) ? item.teacherCitationIds : []).map(String).filter(Boolean))].slice(0, 8),
    teacherNotes: lines(item?.teacherNotes, 5, 360), order: index + 1
  }));
  return {
    version: 1, sourceKey: text(value.sourceKey, 120), status: value.status === 'confirmed' ? 'confirmed' : 'draft',
    lessonTitle: text(value.lessonTitle, 120), slides,
    references: (Array.isArray(value.references) ? value.references : []).map(item => ({ id: text(item?.id, 100), documentId: documentId(item), pdfPage: Math.floor(Number(item?.pdfPage || 0)), printedPage: text(item?.printedPage, 30) })).filter(item => item.id && item.pdfPage > 0).slice(0, 30),
    updatedAt: value.updatedAt || null,
    confirmedAt: value.confirmedAt || null, confirmedBy: text(value.confirmedBy, 120) || null
  };
}

export function teachingSlideDeckIsStale(draft = {}) {
  const deck = normalizeTeachingSlideDeck(draft.answer?.teachingSlides || {});
  return Boolean(deck.sourceKey && deck.sourceKey !== teachingSlidesSourceKey(draft));
}

export function mergeTeachingSlideDeck(baseValue, input = {}, { confirm = false, confirmedBy = '' } = {}) {
  const base = normalizeTeachingSlideDeck(baseValue);
  if (base.status === 'confirmed') throw Object.assign(new Error('teaching_slides_confirmed'), { code: 'teaching_slides_confirmed', status: 409 });
  const submitted = new Map((Array.isArray(input.slides) ? input.slides : []).map(item => [String(item?.id || ''), item]));
  const slides = base.slides.map(item => {
    const next = submitted.get(item.id) || {};
    return { ...item, title: text(next.title ?? item.title, 100), body: lines(next.body ?? item.body, 7, 260), prompt: text(next.prompt ?? item.prompt, 260), teacherNotes: lines(next.teacherNotes ?? item.teacherNotes, 5, 360) };
  });
  if (confirm && slides.some(item => !item.title || !item.body.length)) {
    throw Object.assign(new Error('teaching_slides_incomplete'), { code: 'teaching_slides_incomplete', status: 422 });
  }
  const now = new Date().toISOString();
  return { ...base, slides, status: confirm ? 'confirmed' : 'draft', updatedAt: now, confirmedAt: confirm ? now : null, confirmedBy: confirm ? text(confirmedBy, 120) || null : null };
}

export function teachingSlideDeckHtml(value = {}) {
  const deck = normalizeTeachingSlideDeck(value);
  const referenceMap = new Map(deck.references.filter(item => item.documentId === 'textbook').map(item => [item.id, item]));
  const slides = deck.slides.map((item, index) => { const refs = item.citationIds.map(id => referenceMap.get(id)).filter(Boolean); return `<section class="slide ${index === 0 ? 'active' : ''}" data-index="${index}"><div class="counter">${String(index + 1).padStart(2, '0')} / ${String(deck.slides.length).padStart(2, '0')}</div><span>${escapeHtml(item.kind)}</span><h1>${escapeHtml(item.title)}</h1><ul>${item.body.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>${item.prompt ? `<p>${escapeHtml(item.prompt)}</p>` : ''}${refs.length ? `<footer>${refs.map(ref => `学生教材 PDF 第 ${ref.pdfPage} 页`).join(' · ')}</footer>` : ''}</section>` }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(deck.lessonTitle)} · 课堂投屏稿</title><style>*{box-sizing:border-box}body{margin:0;background:#122f29;color:#f7f2e4;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.slide{display:none;min-height:100vh;padding:8vh 9vw;background:radial-gradient(circle at 85% 10%,#315e50 0,transparent 32%),#173d34}.slide.active{display:flex;flex-direction:column;justify-content:center}.slide>span{color:#e6c56f;font-size:14px;font-weight:800;letter-spacing:.14em}.slide h1{max-width:1100px;margin:18px 0 28px;font-family:STSong,SimSun,serif;font-size:clamp(42px,6vw,82px);line-height:1.15}.slide ul{display:grid;gap:18px;max-width:1180px;margin:0;padding-left:1.2em;font-size:clamp(24px,3vw,42px);line-height:1.45}.slide p{max-width:1050px;margin:35px 0 0;padding:18px 22px;border-left:5px solid #e6c56f;background:#ffffff0d;font-size:clamp(18px,2vw,28px);line-height:1.6}.slide footer{margin-top:30px;color:#b9cec6;font-size:15px}.counter{position:fixed;right:32px;top:25px;color:#b9cec6;font:700 14px Georgia,serif}.help{position:fixed;left:24px;bottom:18px;color:#a9c0b7;font-size:12px}@media print{.slide{display:flex!important;min-height:100vh;page-break-after:always}.help{display:none}}</style></head><body>${slides}<div class="help">← → 翻页　F 全屏　Esc 退出</div><script>(()=>{let i=0;const s=[...document.querySelectorAll('.slide')];const show=n=>{i=Math.max(0,Math.min(s.length-1,n));s.forEach((el,j)=>el.classList.toggle('active',j===i))};addEventListener('keydown',e=>{if(['ArrowRight','PageDown',' '].includes(e.key))show(i+1);if(['ArrowLeft','PageUp'].includes(e.key))show(i-1);if(e.key.toLowerCase()==='f')document.documentElement.requestFullscreen?.()});show(0)})()</script></body></html>`;
}
