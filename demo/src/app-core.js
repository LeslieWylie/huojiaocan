// app-core：从 App.jsx 抽出的纯工具函数与常量（无 JSX、无 React 状态）。
// 目标：App.jsx 只保留壳与路由，按页面的视图迁到 views/ 后从这里导入。
import { buildPdfPageUrl, buildReaderHref } from './reader-target.js';
import { errorCopy } from './copy.js';
import { useEffect, useState } from 'react';
import { accessToken, ensureSession, getSession, refreshSession, sessionExpired, subscribeAuth } from './auth.js';

export const API = '/api/index';

export const DOC_LABELS = { textbook: '学生教材', 'teacher-guide': '教师教学用书', 'curriculum-standard': '课程标准' };

export function queryParams() { return new URLSearchParams(location.search); }

export function canonicalDocumentId(value) {
  const raw = String(value || '').trim();
  const id = raw.toLowerCase();
  if (id === 'teacher_guide' || id === 'guide') return 'teacher-guide';
  if (['curriculum_standard', 'curriculum', 'standard', 'course-standard'].includes(id)) return 'curriculum-standard';
  return raw;
}

export function pdfPageUrl(value, page) { return buildPdfPageUrl(value, page); }

export function terminalJob(status) {
  return ['ready', 'partial', 'failed', 'completed', 'succeeded', 'cancelled'].includes(String(status || '').toLowerCase());
}

export function statusLabel(status) {
  return ({ queued: '等待处理', pending: '等待处理', running: '正在处理', processing: '正在处理', ready: '已准备好，可搜索', partial: '已准备好，少量页面待核对', failed: '处理失败', succeeded: '已完成', completed: '已完成', not_run: '尚未检查', unknown: '尚未检查' })[String(status || '').toLowerCase()] || '尚未检查';
}

export function pageText(page, source) {
  if (!page) return '';
  if (source === 'native') return page.nativeText || page.native_text || '';
  if (source === 'ocr') return page.ocrText || page.ocr_text || '';
  return page.retrievalText || page.retrieval_text || page.text || '';
}

export function pageTitle(page) {
  return page?.pageTitle || page?.page_title || page?.title || '正在读取页面';
}

export function routeId() { return document.body.dataset.route || 'dashboard'; }

export function currentPageReturn() { return `${location.pathname}${location.search}${location.hash}`; }

export function docName(id) { return DOC_LABELS[canonicalDocumentId(id)] || id || '教材'; }

export function citationPage(c) {
  const value = Number(c?.pdfPage ?? c?.pageNumber ?? c?.page ?? 0);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function citationText(c) { return c?.text || c?.quote || c?.snippet || ''; }

export function safeDownloadStem(value, fallback = '课堂设计') {
  const text = String(value || '').replace(/[《》]/gu, '').replace(/[\\/:*?"<>|]/gu, '-').replace(/\s+/gu, ' ').trim();
  return (text || fallback).slice(0, 48);
}

export function citationLink(c, returnTo = '') {
  const page = citationPage(c);
  if (!page || !c?.documentId) return '';
  return buildReaderHref({
    documentId: canonicalDocumentId(c.documentId),
    page,
    nodeId: c.nodeId || c.node_id,
    lessonTitle: c.lessonTitle || c.lesson_title || c.title,
    returnTo,
    scope: c.scope
  });
}

export function requestCode(error) { return String(error?.code || error?.message || '').trim(); }

export function isIndexRecoveryCode(code) {
  return ['pageindex_unavailable', 'pageindex_timeout', 'pageindex_rate_limited', 'pageindex_invalid_response', 'pageindex_request_failed', 'index_provider_error'].includes(code);
}

export function askErrorMessage(error) { return errorCopy(error); }

// ---- HTTP 请求层（原在 App.jsx） ----
export async function fetchJson(url, options = {}) {
  const original = { ...options };
  const isFormData = typeof FormData !== 'undefined' && original.body instanceof FormData;
  const isBinaryBody = typeof Blob !== 'undefined' && original.body instanceof Blob
    || typeof ArrayBuffer !== 'undefined' && (original.body instanceof ArrayBuffer || ArrayBuffer.isView(original.body));
  const body = original.body && !isFormData && !isBinaryBody && typeof original.body !== 'string' ? JSON.stringify(original.body) : original.body;
  const baseHeaders = { ...(isFormData || isBinaryBody ? {} : { 'Content-Type': 'application/json' }), ...(original.headers || {}) };
  let token = accessToken();
  if (token && sessionExpired()) {
    await ensureSession();
    token = accessToken();
  }
  const send = currentToken => {
    const headers = { ...baseHeaders };
    if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
    return fetch(url, { ...original, headers, body });
  };
  let response = await send(token);
  if (response.status === 401 && token) {
    const refreshed = await refreshSession();
    if (refreshed?.access_token) response = await send(refreshed.access_token);
  }
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || payload.detail || payload.message || `request_failed_${response.status}`);
    error.code = payload.error || payload.code || (response.status === 401 ? 'auth_invalid' : '');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function request(path, options = {}) { return fetchJson(`${API}${path}`, options); }
export async function rootRequest(path, options = {}) { return fetchJson(path, options); }
// ---- 卡片/板书/篇目身份工具（原在 App.jsx） ----
export const CARD_SUBTITLES = {
  board: '把课题、核心问题和关键发现排成课堂中可以逐步补写的主线',
  question: '让学生回到具体词句、意象或结构中，用原文完成有依据的回答',
  assessment: '把朗读、理解和表达写成可观察、可核对、可反馈的课堂表现'
};
export const CARD_GENERATION_STEPS = [
  '读取教师定稿与教材依据',
  '整理板书、提问和评价初稿',
  '按课堂节奏与原文依据逐项审校',
  '绑定原始页码并保存到当前方案'
];
export function lessonTitleFrom(value, fallback = '') {
  const text = String(value || '').trim();
  const quoted = text.match(/《([^》]{2,32})》/);
  if (quoted?.[1]) return `《${quoted[1]}》`;
  const plain = text
    .replace(/^(请|帮我|想要|我想)?(怎样|如何|怎么)(备课|讲|设计)?/u, '')
    .replace(/(怎么备课|如何备课|备课方案|(?:换成|改为|调整为|拆成|拆分为).{0,8}课时(?:设计)?|生成.{0,8}(板书|一课三卡)|展开.{0,8}教师用书依据|只看.{0,8}原始依据|重新生成|继续追问)/gu, '')
    .trim();
  return plain && plain.length <= 24 && !/(换成|生成|展开|追问|课时设计)/u.test(plain) ? plain : String(fallback || '').trim();
}
export function planIdentity(question, fallback = '') {
  const title = lessonTitleFrom(question, fallback);
  return title || '当前篇目';
}
export function lessonRefFromUrl(params, fallbackScope = 'both') {
  const documentId = canonicalDocumentId(params?.get('doc'));
  const page = Number(params?.get('page'));
  const title = String(params?.get('lesson') || '').trim();
  if (!documentId || !Number.isInteger(page) || page < 1 || !title) return null;
  return { documentId, nodeId: String(params.get('node') || ''), title, lessonIndex: Number(params.get('lessonIndex')) || 0, lessonTotal: Number(params.get('lessonTotal')) || 0, pageRange: [page, page], scope: fallbackScope };
}
export function sameLessonRef(left, right) {
  const key = value => [value?.documentId || '', String(value?.nodeId || '').replace(/^seed-/u, '')].join(':');
  const leftKey = key(left);
  const rightKey = key(right);
  return !leftKey || !rightKey || leftKey === rightKey;
}
export function unitRefFromUrl(params) {
  const documentId = canonicalDocumentId(params?.get('doc'));
  const nodeId = String(params?.get('unit') || '').trim();
  const title = String(params?.get('unitTitle') || '').trim();
  const start = Number(params?.get('unitStart'));
  const end = Number(params?.get('unitEnd'));
  if (!documentId || !nodeId || !title) return null;
  return { key: `${documentId}:${nodeId}`, documentId, nodeId, title, pageRange: [Number.isInteger(start) && start > 0 ? start : null, Number.isInteger(end) && end > 0 ? end : null] };
}
export function normalizeCards(source, citations = [], coreQuestion = '', previousCards = []) {
  const value = source && typeof source === 'object' ? source : {};
  const definitions = [['board','板书卡',CARD_SUBTITLES.board],['question','提问卡',CARD_SUBTITLES.question],['assessment','评价卡',CARD_SUBTITLES.assessment]];
  return definitions.map(([type,title,subtitle]) => {
    const previous = (Array.isArray(previousCards) ? previousCards : []).find(card => card?.type === type);
    // A locked card is a teacher-approved artifact. Follow-up questions may
    // change the plan, but they must not replace that card or its references.
    if (previous?.status === 'locked') return previous;
    // A normal follow-up may return only an explanation and omit the cards.
    // Preserve the teacher's editable draft in that case; only the explicit
    // single-card regeneration endpoint is allowed to replace a card with a
    // new result.
    if ((!Array.isArray(value[type]) || value[type].length === 0) && Array.isArray(previous?.items) && previous.items.length) {
      return { ...previous, title: previous.title || title, subtitle: previous.subtitle || subtitle };
    }
    const items = Array.isArray(value[type]) ? value[type] : [];
    const card = { id: previous?.id || `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, title, subtitle, status: 'draft', items: items.map((text,index) => { const item = text && typeof text === 'object' ? text : {}; return { id: item.id || `${type}-${index}`, text: typeof text === 'string' ? text : item.text || '', sourceType: item.sourceType || (Array.isArray(item.citationIds) && item.citationIds.length ? 'combined' : 'insufficient'), citationIds: Array.isArray(item.citationIds) ? item.citationIds : [] }; }) };
    if (type === 'board') card.boardPlan = makeBoardPlan(card.items, coreQuestion);
    return card;
  });
}
export function makeBoardPlan(items = [], coreQuestion = '') {
  const branches = ['文本结构', '语言证据', '情感主旨'];
  const nodes = (Array.isArray(items) ? items : [])
    .filter(item => String(item?.text || '').trim())
    .slice(0, 9)
    .map(item => ({
      ...item,
      label: boardLabelFromText(item.text)
    }))
    .filter(item => item.label);
  const rawQuestion = String(coreQuestion || '').trim();
  const cleanTitle = planIdentity(rawQuestion, '当前篇目');
  const safeQuestion = rawQuestion && !/(怎么备课|如何备课|怎样备课|(?:换成|改为|调整为|拆成|拆分为).{0,8}课时|生成.{0,8}(板书|三卡|方案)|重新生成)/u.test(rawQuestion)
    ? rawQuestion
    : `围绕${cleanTitle}，学生读完后能理解什么、说明什么？`;
  return {
    version: 1,
    coreQuestion: safeQuestion || '学生读完后要带走什么？',
    branches: branches.map((title, branchIndex) => ({
      id: `branch-${branchIndex + 1}`,
      title,
      nodes: nodes.filter((_, index) => index % branches.length === branchIndex).map(item => ({ id: item.id, text: item.text, label: item.label, citationIds: item.citationIds || [] }))
    })),
    blankZones: ['学生关键词', '教师补写', '课堂生成结论'],
    stage: 1
  };
}
export function boardLabelFromText(value, fallback = '') {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  text = text
    .replace(/^(板书(?:课题|要点)?|关键词|关键依据|文本发现|教师补写|学生补写)[:：]?/u, '')
    .replace(/^(任务|活动|课堂归纳)\s*\d*[:：]?/u, '')
    .trim();
  const parts = text.split(/[；;。.!！?？]/u).map(item => item.trim()).filter(Boolean);
  const preferred = parts.find(item => !/(教师|学生|回到|依据|教材|PDF|补写|引导|说明如何)/u.test(item)) || parts[0] || text;
  const cleaned = preferred
    .replace(/^(左侧书写|右侧书写|课堂中|学生回答后|教师补写)[:：]?/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return Array.from(cleaned).slice(0, 18).join('') + (Array.from(cleaned).length > 18 ? '…' : '');
}
export function boardQuestion(value, title) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || /学生读完后能理解什么、说明什么/u.test(text)) return `读完${title || '课文'}，你能说清什么？`;
  const concise = text.replace(/^核心问题[:：]?/u, '').trim();
  return Array.from(concise).slice(0, 22).join('') + (Array.from(concise).length > 22 ? '…' : '');
}
export function withBoardPlan(cards = [], question = '') {
  return (Array.isArray(cards) ? cards : []).map(card => {
    const legacyItems = Array.isArray(card?.items) ? card.items : Array.isArray(card?.content)
      ? card.content.map((item, index) => typeof item === 'string'
        ? { id: `${card.id || card.type || 'card'}-legacy-${index}`, text: item, citationIds: [] }
        : item)
      : [];
    const normalized = legacyItems.length && !Array.isArray(card?.items) ? { ...card, items: legacyItems } : card;
    if (normalized?.type !== 'board') return normalized;
    if (normalized?.status === 'locked') return normalized;
    const previous = normalized.boardPlan && typeof normalized.boardPlan === 'object' ? normalized.boardPlan : {};
    const cleanQuestion = planIdentity(question || previous.coreQuestion || '', '当前篇目');
    const previousCore = String(previous.coreQuestion || '').trim();
    const coreQuestion = previousCore && !/(?:换成|改为|调整为|拆成|拆分为).{0,8}课时|生成.{0,8}(板书|三卡)|怎么备课|如何备课|重新生成/u.test(previousCore)
      ? previousCore
      : `围绕${cleanQuestion}，学生读完后能理解什么、说明什么？`;
    const next = makeBoardPlan(normalized.items || [], coreQuestion);
    return {
      ...normalized,
      boardPlan: {
        ...next,
        version: Number(previous.version) || 1,
        blankZones: Array.isArray(previous.blankZones) && previous.blankZones.length ? previous.blankZones : next.blankZones,
        stage: Math.min(5, Math.max(1, Number(previous.stage) || 1))
      }
    };
  });
}
export function uniqueCitations(citations = [], refs = []) {
  const list = Array.isArray(citations) ? citations : [];
  const wanted = Array.isArray(refs) && refs.length ? refs : list.slice(0, 2).map(item => item.id);
  const seen = new Set();
  return wanted.map(ref => list.find(item => item.id === ref)).filter(item => {
    if (!item) return false;
    if (!citationPage(item)) return false;
    const key = `${item.documentId || ''}:${citationPage(item)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function normalizeFeedbackForm(value = {}) {
  const cardUsage = value.cardUsage ?? value.usedCards;
  return {
    unfinishedQuestions: String(value.unresolvedLearning ?? value.unfinishedQuestions ?? ''),
    timeManagement: String(value.pacingNotes ?? value.timeManagement ?? ''),
    usedCards: Array.isArray(cardUsage) ? cardUsage.map(item => String(typeof item === 'object' ? item.type || item.label : item || '').trim()).filter(Boolean) : typeof cardUsage === 'string' ? cardUsage.split(/\r?\n/).map(item => item.trim()).filter(Boolean) : [],
    classResponse: String(value.observedLearning ?? value.classResponse ?? ''),
    nextStep: String(value.nextLessonAdjustment ?? value.nextStep ?? '')
  };
}
export function feedbackAdviceFromForm(form = {}) {
  const result = [];
  const usedCards = Array.isArray(form.usedCards) ? form.usedCards : [];
  if (String(form.classResponse || '').trim().length) {
    result.push(`先保留课堂事实：${String(form.classResponse).trim().slice(0, 70)}。复备时先核对这项表现对应的原文或课堂任务。`);
  }
  if (String(form.unfinishedQuestions || '').trim().length) {
    result.push(`需要继续处理：围绕“${String(form.unfinishedQuestions).trim().slice(0, 70)}”回看教材与教师用书，再决定是拆分问题、补充朗读，还是增加比较。`);
  }
  if (String(form.timeManagement || '').trim().length) {
    result.push(`节奏调整：根据“${String(form.timeManagement).trim().slice(0, 70)}”确认具体受影响的环节，优先调整活动数量和过渡方式，不预设统一时长。`);
  }
  if (usedCards.length) {
    result.push(`本节实际使用了${usedCards.join('、')}。复备时保留有效条目，只重写没有推动学生回到原文或表达依据的部分。`);
  }
  if (String(form.nextStep || '').trim().length) {
    result.push(`教师已确定的下次调整：${String(form.nextStep).trim().slice(0, 90).replace(/[。！？；]+$/u, '')}。生成复备方案时应优先落实这项决定。`);
  }
  if (!result.length) result.push('目前记录还不足以形成教学建议。可补充：学生在哪个问题上停住、回读了哪一段、哪个环节用时与预期不同。');
  return result;
}

export function feedbackStorageValue(form = {}) {
  const normalized = normalizeFeedbackForm(form);
  return {
    version: 1,
    observedLearning: normalized.classResponse,
    unresolvedLearning: normalized.unfinishedQuestions,
    pacingNotes: normalized.timeManagement,
    cardUsage: normalized.usedCards,
    nextLessonAdjustment: normalized.nextStep
  };
}

export function cardEditGuidance(type) { return CARD_EDIT_GUIDANCE[type] || '把教材依据整理成课堂中可以直接使用的动作，并保留返回原始教材的依据。'; }
export function cardItemNeedsDetail(type, text) {
  const value = String(text || '').trim();
  if (value.length < 18) return true;
  if (type === 'assessment' && /^(能否|是否|可以吗|会不会)/.test(value)) return true;
  return type === 'question' && /^(为什么|能否|是否|怎样)/.test(value) && value.length < 28;
}
export function wrapSvgText(value, max = 13) {
  const text = String(value || '').trim();
  if (!text) return ['待补写'];
  const chars = Array.from(text);
  const lines = [];
  for (let index = 0; index < chars.length; index += max) lines.push(chars.slice(index, index + max).join(''));
  return lines.slice(0, 3);
}
export function sourceTypeLabel(type) {
  return ({ textbook: '学生教材支持', 'teacher-guide': '教师用书支持', teacher_guide: '教师用书支持', 'curriculum-standard': '课程标准支持', curriculum_standard: '课程标准支持', combined: '三类材料综合', suggestion: '系统教学建议', insufficient: '依据不足' }[type] || '教材依据');
}
export function classroomRecoveryKey(userId, draftId) { return `huojiaocan:classroom:${userId}:${draftId}`; }
export function readClassroomRecovery(userId, draftId) {
  if (!userId || !draftId) return null;
  try {
    const value = JSON.parse(localStorage.getItem(classroomRecoveryKey(userId, draftId)) || 'null');
    return value?.userId === userId && value?.draftId === draftId ? {
      baseVersion: Number(value.baseVersion || value.version || 0),
      baseRun: normalizeClassroomRun(value.baseRun || {}),
      classroomRun: normalizeClassroomRun(value.classroomRun || {})
    } : null;
  } catch { return null; }
}
export function writeClassroomRecovery(userId, draftId, version, classroomRun, baseRun = {}) {
  if (!userId || !draftId || !version) return;
  try { localStorage.setItem(classroomRecoveryKey(userId, draftId), JSON.stringify({ userId, draftId, baseVersion: version, baseRun: normalizeClassroomRun(baseRun), classroomRun: normalizeClassroomRun(classroomRun) })); } catch {}
}
export function clearClassroomRecovery(userId, draftId) {
  try { localStorage.removeItem(classroomRecoveryKey(userId, draftId)); } catch {}
}

// ---- 会话/树工具（原在 App.jsx） ----
export function firstPage(...values) {
  for (const value of values) {
    const page = pageNumber(value);
    if (page > 0) return page;
  }
  return 0;
}
export function nodePageRange(node = {}) {
  const range = node.pageRange ?? node.page_range ?? node.range;
  const rangeStart = Array.isArray(range) ? range[0] : range?.start ?? range?.from ?? range?.startPage ?? range?.start_page;
  const rangeEnd = Array.isArray(range) ? range[1] : range?.end ?? range?.to ?? range?.endPage ?? range?.end_page;
  const start = firstPage(
    node.startPdfPage, node.start_pdf_page, node.startPage, node.start_page,
    node.pdfPage, node.pdf_page, node.pageNumber, node.page, rangeStart
  );
  const end = firstPage(node.endPdfPage, node.end_pdf_page, node.endPage, node.end_page, rangeEnd) || start;
  return { start, end: Math.max(start, end) };
}
export function normalizeTree(payload) {
  const source = payload?.data ?? payload;
  const root = source?.tree ?? source?.root ?? source?.children ?? source?.nodes ?? source;
  if (!root) return [];
  const roots = Array.isArray(root) ? root : [root];
  const walk = (nodes, parentPath = []) => nodes.flatMap((node, index) => {
    if (!node || typeof node !== 'object') return [];
    const id = String(node.id || node.nodeId || `${parentPath.join('-') || 'root'}-${index}`);
    const title = String(node.title || node.name || node.label || '未命名节点');
    const rawChildren = node.children ?? node.nodes ?? [];
    const children = Array.isArray(rawChildren) ? walk(rawChildren, [...parentPath, id]) : [];
    const direct = nodePageRange(node);
    const descendantRanges = children.map(child => child.pageRange).filter(item => item?.start > 0);
    const start = direct.start || (descendantRanges.length ? Math.min(...descendantRanges.map(item => item.start)) : 0);
    const end = Math.max(direct.end || 0, ...(descendantRanges.length ? descendantRanges.map(item => item.end) : [start]));
    return [{
      ...node,
      id,
      title,
      level: Number.isFinite(Number(node.level)) ? Number(node.level) : parentPath.length + 1,
      startPage: start,
      endPage: Math.max(start, end),
      pageRange: { start, end: Math.max(start, end) },
      children
    }];
  });
  return walk(roots);
}
export function findTreeNode(nodes, page, preferredId = '') {
  let preferred = null;
  let best = null;
  const rank = (node, depth, range) => ({ node, depth, width: Math.max(0, range.end - range.start) });
  const isBetter = (candidate, current) => {
    if (!current) return true;
    if (candidate.depth !== current.depth) return candidate.depth > current.depth;
    if (candidate.width !== current.width) return candidate.width < current.width;
    return String(candidate.node.id || '').localeCompare(String(current.node.id || '')) < 0;
  };
  const visit = (list, depth = 0) => (list || []).forEach(node => {
    const range = node.pageRange || nodePageRange(node);
    if (range.start && page >= range.start && page <= range.end) {
      const candidate = rank(node, depth, range);
      if (preferredId && String(node.id) === String(preferredId)) preferred = candidate;
      if (isBetter(candidate, best)) best = candidate;
      visit(node.children, depth + 1);
    }
  });
  visit(nodes);
  // Keep the user's selected node only when it is as specific as the best
  // match. A parent node must not remain highlighted after the page moves into
  // one of its more specific child lessons.
  if (preferred && best && preferred.depth === best.depth && preferred.width === best.width) return preferred.node;
  return best?.node || null;
}
export function useAuthSession() {
  const [session, setSession] = useState(() => getSession());
  useEffect(() => subscribeAuth(setSession), []);
  return session;
}
export function pageNumber(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Math.floor(Number(value));
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}
export const CARD_EDIT_GUIDANCE = {
  board: '建议写成“关键词 → 关系或结论”，并标明教师先写什么、学生回答后再补什么，让板书可以边问边展开。',
  question: '建议写清“回到哪一处原文 + 观察什么 + 为什么追问”，问题要能直接带学生找到词句、意象或结构。',
  assessment: '建议写清“学生完成什么任务 + 使用哪处教材依据 + 达到什么可观察表现”，不要只停留在“能否……”的判断。'
};
export function questionState(result) {
  if (!result) return { label: '未运行', tone: 'neutral' };
  return result.passed ? { label: '已定位', tone: 'green' } : { label: '需检查', tone: 'orange' };
}
export function focusedCurriculumExcerpt(item) {
  const source = String(item?.source?.excerpt || '').replace(/\s+/gu, ' ').trim();
  if (!source) return '';
  const anchors = item?.id === 'stage'
    ? ['【阅读与鉴赏】', '在通读课文的基础上', '阅读与鉴赏']
    : item?.id === 'task-group'
      ? ['第四学段', '识别文本隐含的情感、观点、立场', '本学习任务群旨在']
      : ['阅读简单议论性文章', '区分观点与材料', '阅读与鉴赏类问题或任务'];
  const index = anchors.map(anchor => source.indexOf(anchor)).filter(value => value >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, index - (index ? 18 : 0));
  const excerpt = source.slice(start, start + 300);
  return `${start > 0 ? '…' : ''}${excerpt}${start + 300 < source.length ? '…' : ''}`;
}
export function searchResultDocumentId(result = {}) {
  result = result && typeof result === 'object' ? result : {};
  return canonicalDocumentId(result.documentId || result.document_id || result.docId || result.doc_id || result.viewer?.documentId || result.viewer?.document_id);
}
export function searchResultPage(result = {}) {
  result = result && typeof result === 'object' ? result : {};
  return pageNumber(result.pdfPage ?? result.pdf_page ?? result.pageNumber ?? result.page ?? result.viewer?.page ?? result.viewer?.page_number);
}

export function cacheDraftForRecovery(userId, id, draft, cards = draft?.cards) {
  try { writeDraftRecovery(localStorage, userId, id, draft, cards); } catch {}
}

export function rememberAuthReturn(extra = {}) {
  saveAuthRecovery({ next: `${location.pathname}${location.search}`, ...extra, savedAt: new Date().toISOString() });
  return `/login/?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
}
