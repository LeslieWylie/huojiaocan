/**
 * Generate classroom cards from the teacher-confirmed plan snapshot.
 *
 * The browser may request a focus, but it never supplies card content,
 * citations, page numbers, document ids or viewer URLs. Those are rebuilt
 * from the provider response here and persisted with the draft.
 */

import { generateGroundedAnswer } from './grounded-answer.js';
import { confirmedDraftContext } from './draft-revisions.js';

const CARD_TYPES = ['board', 'question', 'assessment'];
const CARD_TITLES = { board: '板书卡', question: '提问卡', assessment: '评价卡' };

function citationKey(value) {
  const documentId = String(value?.documentId || '').trim();
  const page = Number(value?.pdfPage ?? value?.pageNumber ?? value?.page);
  return documentId && Number.isInteger(page) && page > 0 ? `${documentId}:${page}` : '';
}

function normalizeCitations(list = []) {
  const output = [];
  const byKey = new Map();
  const oldIdMap = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const key = citationKey(item);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      if (item.id) oldIdMap.set(String(item.id), existing.id);
      continue;
    }
    const id = `citation-${output.length + 1}`;
    const normalized = { ...item, id };
    byKey.set(key, normalized);
    if (item.id) oldIdMap.set(String(item.id), id);
    output.push(normalized);
  }
  return { output, byKey, oldIdMap };
}

function sourceType(citations) {
  const types = new Set((citations || []).map(item => {
    const value = String(item.documentType || '').replaceAll('_', '-');
    return value === 'teacher-guide' || value === 'guide' ? 'teacher_guide' : value;
  }));
  if (types.has('textbook') && types.has('teacher_guide')) return 'combined';
  if (types.has('textbook')) return 'textbook';
  if (types.has('teacher_guide')) return 'teacher-guide';
  return citations?.length ? 'suggestion' : 'insufficient';
}

function generationError(code, status = 422) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

const OPERATION_INSTRUCTION = /(?:换成|调整为|改为|拆分为|拆成|合并为).{0,10}(?:一|两|三|四|五|六|七|八|九|十|\d+)课时|(?:重新)?生成(?:一课)?三卡|(?:重新)?生成(?:板书|提问|评价)卡|只(?:重新)?生成(?:本)?卡|保持当前篇目(?:与核心问题)?/gu;
const MODEL_REFERENCE_NOISE = [
  /https?:\/\/[^\s，。；、|）)】]+/giu,
  /(?:文档\s*(?:ID|编号)|document\s*id)\s*[:：#]?\s*[A-Za-z0-9_-]+/giu,
  /(?:PDF\s*)?(?:第\s*)?\d{1,4}\s*(?:页|page)/giu,
  /\bpage\s*\d{1,4}\b/giu,
  /[\[（(]\s*E\d+\s*[\]）)]/giu,
  /\bE\d+\b/giu,
  /(?:引用|证据)\s*[:：]?\s*E\d+(?:\s*[,，、]\s*E\d+)*/giu
];

function cleanCardText(value, type) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  for (const pattern of MODEL_REFERENCE_NOISE) text = text.replace(pattern, '');
  text = text.replace(OPERATION_INSTRUCTION, '');
  text = text.replace(/(?:板书|提问|评价)卡?\s*[:：]/gu, '');
  if (type === 'board') {
    // Teacher moves belong in the lesson plan. A board card must remain
    // writable as-is, rather than describing what the teacher should do.
    text = text.replace(/(?:教师(?:先|再|要|应)?(?:板书|补写|书写|引导|追问)|请(?:教师)?(?:板书|补写|书写|引导|追问))[^；。|]*/gu, '');
  }
  return text
    .replace(/\s*([；，。|])\s*/g, '$1')
    .replace(/[；，、|]{2,}/gu, '；')
    .replace(/[；，、|]+$/gu, '')
    .replace(/^[；，、|]+/gu, '')
    .trim();
}

function isUsableCardText(text, type) {
  if (!text) return false;
  if (type === 'board') {
    return text.length >= 2 && text.length <= 24
      && !/(?:教师|学生(?:完成|回答)|课堂活动|教学(?:步骤|说明)|任务[:：])/u.test(text);
  }
  if (type === 'question') {
    return /追问/u.test(text) && /预期(?:学生)?(?:回应|回答)/u.test(text);
  }
  if (type === 'assessment') {
    return /可观察(?:表现)?|学生(?:能够|表现)/u.test(text)
      && /判断标准|达成标准|达成[:：]|标准[:：]/u.test(text);
  }
  return true;
}

function cleanSuggestions(suggestions, type) {
  return (Array.isArray(suggestions) ? suggestions : []).map(item => {
    const isStructured = item && typeof item === 'object';
    const text = cleanCardText(isStructured ? item.text : item, type);
    if (!isUsableCardText(text, type)) return null;
    return isStructured ? { ...item, text } : text;
  }).filter(Boolean);
}

function confirmedChoicesPrompt(value) {
  const decisions = Array.isArray(value?.decisions) ? value.decisions : [];
  if (!decisions.length) return '';
  return `教师已经确认以下备课取舍，生成内容必须逐项遵守；这些决定不是教材原文：\n${decisions.slice(0, 4).map(item => `- ${item.question}：${item.choice}；课堂落实：${item.approach}；已接受的代价：${item.acceptedTradeoff || '未填写'}`).join('\n')}`;
}

function cardPrompt(types, confirmedChoices, focus = '') {
  const requested = [...new Set((Array.isArray(types) ? types : []).filter(type => CARD_TYPES.includes(type)))];
  const titles = requested.map(type => CARD_TITLES[type]).join('、') || '课堂卡';
  const formats = [];
  if (requested.includes('board')) formats.push('板书卡生成 3—6 条。它是真实黑板上的落笔内容，不是课件提纲：按“文本抓手 → 结构或情感关系 → 课堂生成结论”逐步出现；单条 4—16 个汉字，可用箭头、对照或“____”留白。只写关键词、短语或关系，不写教师动作、讲解句、页码或来源说明。');
  if (requested.includes('question')) formats.push('提问卡生成 3—5 条递进问题。每条严格写成“主问：……｜追问：……｜预期学生回应：……”。主问先让学生朗读、圈画、比较或概括具体原文；追问承接学生可能的回答继续追究“为什么、怎样证明、与前文有什么关系”；预期回应写可接受回答的边界，至少包含词句依据和关系或判断，不替学生背标准答案。');
  if (requested.includes('assessment')) formats.push('评价卡生成 3—5 条当堂可执行任务。每条严格写成“任务：……｜可观察表现：……｜判断标准：……”。任务必须回到学生教材原文或助学任务；可观察表现写学生实际说出、圈画、比较、朗读或完成的内容；判断标准写清达成、部分达成与需要支架的可辨别边界。');
  return [
    requested.length === 1 ? `请只重新生成${titles}，不要改动其他卡片。` : `请根据教师已经确认的方案，一次生成${titles}。`,
    '篇目身份、课题与服务端引用绑定已经固定；“换成两课时”“生成三卡”等操作要求只影响节奏，绝不能写入课题、板书、问题或评价内容。',
    '先读教师用书确定本课教学重点、课堂顺序、问题链、作业和评价，再回到学生教材锁定原文、助学任务以及学生必须引用的词句。两类材料作用不同，不能互相冒充。',
    '课堂推进遵循中国语文课堂的真实节奏：必要的诵读或疏通先于语言品味与主旨探究；每一步都要让学生先对文本做动作，再由教师根据学生回答追问，最后用可观察任务收束。教师用书另有明确顺序时以教师用书为准。',
    '不得生成或转写页码、PDF页、文档ID、URL、E编号、引用标记或来源说明；它们只能由服务端绑定。',
    focus ? `本次教师希望重点调整：${String(focus).replace(/\s+/g, ' ').trim().slice(0, 240)}。这只影响课堂处理，不改变篇目身份。` : '',
    confirmedChoicesPrompt(confirmedChoices),
    ...formats,
    '每条必须返回一个 evidenceRefs 数组，只能选择本轮 evidence 中真实存在的 E 编号。没有直接依据的条目不要生成。'
  ].filter(Boolean).join('\n');
}

function lessonIdentityFromDraft(draft) {
  const answerLesson = draft?.answer?.lesson || {};
  const title = String(answerLesson.title || draft?.title || '').trim();
  const coreQuestion = String(answerLesson.coreQuestion || draft?.question || '').trim();
  return {
    title: title || '当前篇目',
    coreQuestion: coreQuestion || '学生读完这篇课文后应理解什么、说明什么？'
  };
}

function draftFromConfirmation(draft) {
  const confirmation = confirmedDraftContext(draft);
  const { plan, conditions, citations } = confirmation.snapshot;
  return {
    confirmation,
    source: {
      title: conditions.title || draft.title,
      question: conditions.question || conditions.title || draft.question || draft.title,
      scope: Array.isArray(conditions.scope) ? conditions.scope : [],
      lesson_context: conditions.lessonContext && typeof conditions.lessonContext === 'object' ? conditions.lessonContext : {},
      answer: plan,
      citations
    }
  };
}

function responseSuggestions(response, type) {
  const detailedCandidate = response?.cardSuggestionItems?.[type]
    || response?.threeCardSuggestionItems?.[type]
    || null;
  const detailedSuggestions = Array.isArray(detailedCandidate)
    && detailedCandidate.some(item => item && typeof item === 'object')
    ? detailedCandidate
    : null;
  return detailedSuggestions
    || response?.cardSuggestions?.[type]
    || response?.threeCardSuggestions?.[type]
    || [];
}

function cardCountRange(type) {
  return type === 'board' ? [3, 6] : [3, 5];
}

async function generateCardsForTypes({ draft, targetCards, deepseek, focus = '' } = {}) {
  if (!draft || !Array.isArray(targetCards) || !targetCards.length) throw generationError('card_generation_failed', 500);
  if (targetCards.some(card => card?.status === 'locked')) throw generationError('card_locked', 409);
  const { confirmation, source } = draftFromConfirmation(draft);
  if (!Array.isArray(source.citations) || !source.citations.length) throw generationError('evidence_insufficient', 422);
  const lessonIdentity = lessonIdentityFromDraft(source);
  const requestedTypes = [...new Set(targetCards.map(card => card.type).filter(type => CARD_TYPES.includes(type)))];
  const response = await generateGroundedAnswer({
    question: source.question || source.title || '当前课文',
    scope: source.scope,
    evidence: source.citations,
    history: [{ role: 'user', content: cardPrompt(requestedTypes, source.answer?.confirmedTeachingChoices, focus) }],
    deepseek,
    lessonContext: source.lesson_context,
    lessonIdentity,
    followUpInstruction: '',
    expectedCardTypes: requestedTypes
  });

  const fresh = Array.isArray(response?.citations) ? response.citations : [];
  if (!response?.evidenceSufficient || !fresh.length) throw generationError('evidence_insufficient', 422);

  const normalized = normalizeCitations(source.citations);
  // E numbers belong to the reordered evidence list returned by
  // generateGroundedAnswer, not necessarily to the original confirmation
  // order.  Bind E1/E2 through document+page identity before mapping back to
  // the immutable confirmation snapshot.
  const responseRefMap = new Map(fresh.map(item => [
    String(item?.id || ''),
    normalized.byKey.get(citationKey(item))?.id || ''
  ]).filter(([, id]) => id));
  const resolveRefs = refs => (Array.isArray(refs) ? refs : [])
    .map(ref => responseRefMap.get(String(ref)) || normalized.oldIdMap.get(String(ref)) || '')
    .filter(ref => normalized.output.some(citation => citation.id === ref));
  const cards = (Array.isArray(draft.cards) ? draft.cards : []).map(item => ({ ...item }));
  for (const targetCard of targetCards) {
    const index = cards.findIndex(item => String(item.id) === String(targetCard.id));
    if (index < 0) throw generationError('card_not_found', 404);
    const suggestions = responseSuggestions(response, targetCard.type);
    const cleanedSuggestions = cleanSuggestions(suggestions, targetCard.type);
    const [minimum, maximum] = cardCountRange(targetCard.type);
    if (cleanedSuggestions.length < minimum) throw generationError('card_generation_failed', 422);
    const items = cleanedSuggestions.slice(0, maximum).map((item, itemIndex) => {
      const isStructured = item && typeof item === 'object';
      const text = isStructured ? String(item.text || '').trim() : String(item || '').trim();
      const citationIds = isStructured ? resolveRefs(item.citationIds || item.evidenceRefs || item.refs) : [];
      if (!text || !citationIds.length) return null;
      return {
        id: `${targetCard.id}-item-${Date.now()}-${itemIndex}`,
        text,
        sourceType: sourceType(citationIds.map(ref => normalized.output.find(citation => citation.id === ref)).filter(Boolean)),
        citationIds
      };
    }).filter(Boolean);
    if (items.length < minimum) throw generationError('evidence_insufficient', 422);
    cards[index] = {
      ...cards[index],
      status: 'draft',
      updatedAt: new Date().toISOString(),
      sourceConfirmedVersion: confirmation.confirmedVersion,
      sourceConfirmedAt: confirmation.confirmedAt,
      items
    };
  }

  return {
    cards,
    citations: normalized.output,
    generation: response.generation,
    model: response.model || null,
    generationTrace: Array.isArray(response.generationTrace) ? response.generationTrace : [],
    generationRounds: Number(response.generationRounds) || 1,
    qualityIssues: Array.isArray(response.teachingPlanIssues) ? response.teachingPlanIssues : []
  };
}

export async function regenerateDraftCard({ draft, card, deepseek, focus = '' } = {}) {
  if (!draft || !card) throw generationError('card_generation_failed', 500);
  if (card.status === 'locked') throw generationError('card_locked', 409);
  return generateCardsForTypes({ draft, targetCards: [card], deepseek, focus });
}

export async function generateDraftCards({ draft, deepseek } = {}) {
  if (!draft) throw generationError('card_generation_failed', 500);
  confirmedDraftContext(draft);
  const working = {
    ...draft,
    cards: Array.isArray(draft.cards) ? draft.cards.map(card => ({ ...card })) : []
  };

  for (const type of CARD_TYPES) {
    let card = working.cards.find(item => item?.type === type);
    if (card?.status === 'locked') continue;
    if (!card) {
      card = { id: `${type}-1`, type, title: CARD_TITLES[type], status: 'draft', items: [] };
      working.cards.push(card);
    }
  }
  const targetCards = working.cards.filter(card => CARD_TYPES.includes(card?.type) && card.status !== 'locked');
  if (!targetCards.length) return { cards: working.cards, citations: working.citations || [], generations: [] };
  const generated = await generateCardsForTypes({ draft: working, targetCards, deepseek });
  const generations = targetCards.map(card => ({
    type: card.type,
    generation: generated.generation,
    model: generated.model,
    generationRounds: generated.generationRounds,
    generationTrace: generated.generationTrace,
    qualityIssues: generated.qualityIssues
  }));
  return { cards: generated.cards, citations: generated.citations, generations };
}
