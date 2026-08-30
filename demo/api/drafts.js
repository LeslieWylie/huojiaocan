import crypto from 'node:crypto';
import { allowMethod, json, readJson } from '../serverless/shared.js';
import { requireUser, safeAuthResponse, supabaseRest } from '../serverless/auth.js';
import { getIndexProvider, getManifest, LocalFullTextIndexProvider } from '../serverless/index-provider.js';
import { resolveActiveDeepSeekKey } from './ai.js';
import { generateDraftCards, regenerateDraftCard } from '../serverless/card-generation.js';
import { normalizeClassroomRun } from '../shared/classroom-run.js';
import { buildPreviousLessonCarryover, classroomMomentTriageIsStale, defaultClassroomMomentTriage, mergeClassroomMomentTriage, normalizePreviousLessonCarryover, updatePreviousLessonCarryover } from '../shared/classroom-carryover.js';
import { buildQuestionRehearsal, mergeQuestionRehearsal, questionRehearsalIsStale } from '../shared/question-rehearsal.js';
import { buildLearningEvidence, learningEvidenceContext, learningEvidenceIsStale, mergeLearningEvidence } from '../shared/learning-evidence.js';
import { buildPreClassPulse, mergePreClassPulse, preClassPulseIsStale } from '../shared/preclass-pulse.js';
import { mergeTeachingDeliberation, teachingDeliberationIsStale } from '../shared/teaching-deliberation.js';
import { buildLessonStudy, lessonStudyIsStale, mergeLessonStudy } from '../shared/lesson-study.js';
import { buildTeachingSlideDeck, mergeTeachingSlideDeck, normalizeTeachingSlideDeck, teachingSlideDeckIsStale } from '../shared/teaching-slides.js';
import { buildLayeredHomework, layeredHomeworkIsStale, mergeLayeredHomework, normalizeLayeredHomework } from '../shared/layered-homework.js';
import { homeworkReviewContext, homeworkReviewIsStale, mergeHomeworkReview, normalizeHomeworkReview } from '../shared/homework-review.js';
import { deriveTeachingTasks } from '../shared/teaching-task-flow.js';
import { deriveClassLearningProfiles } from '../shared/class-learning-profile.js';
import { buildClassAdaptedDraft } from '../shared/class-lesson-adaptation.js';
import { resolveLessonIdentity } from '../shared/lesson-identity.js';
import { buildPeriodPlan, repairPeriodSequence, serializePeriodPlan } from '../shared/period-planner.js';
import { generateTeachingDeliberation } from '../serverless/teaching-deliberation.js';
import { analyzeHomeworkResponses } from '../serverless/homework-marking.js';
import {
  answerWithCurrentRevision,
  appendRevision,
  confirmDraftPlan,
  listRevisions,
  requireDraftVersion,
  restoreRevision
} from '../serverless/draft-revisions.js';

function routePath(req) {
  if (req.query?.path) return `/${String(req.query.path).replace(/^\/+/, '')}`;
  try { return new URL(req.url, 'http://local').pathname.replace(/^\/api\/drafts/, '') || '/'; } catch { return '/'; }
}

function routeParts(path) {
  return String(path).split('/').filter(Boolean).map(decodeURIComponent);
}

function query(userId, extra = {}) { return { user_id: `eq.${userId}`, ...extra }; }
function userRest(user, path, options = {}) { return supabaseRest(path, { ...options, authToken: user.token }); }

function requestVersion(req, body) {
  let urlVersion;
  try { urlVersion = new URL(req.url, 'http://local').searchParams.get('version'); } catch { /* no-op */ }
  const header = req?.headers?.['if-match'] || req?.headers?.['If-Match'];
  return requireDraftVersion(body?.version ?? req?.query?.version ?? urlVersion ?? String(header || '').replace(/^W\//, '').replaceAll('"', ''));
}

function assertCurrentVersion(current, expected) {
  if (Number(expected) !== Number(current?.version)) {
    throw Object.assign(new Error('edit_conflict'), { code: 'edit_conflict', status: 409 });
  }
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Confirmation, revision and publication markers are server-owned state.
 * A browser may edit the teaching plan, but it may never mint an approval or
 * make a draft look published by embedding those fields in `answer`.
 */
export function sanitizeClientAnswer(value, currentAnswer = null) {
  const answer = value && typeof value === 'object' ? clone(value) : {};
  delete answer.planApproval;
  delete answer.revisions;
  delete answer.assetMeta;
  // The source reflection attached by the server-side copy flow is provenance,
  // not editable lesson-plan content. Ordinary draft saves must neither forge
  // nor erase it.
  delete answer.previousLessonReflection;
  delete answer.classroomRun;
  delete answer.classroomMomentTriage;
  delete answer.previousLessonCarryover;
  delete answer.questionRehearsal;
  delete answer.questionRehearsalHistory;
  delete answer.learningEvidence;
  delete answer.learningEvidenceHistory;
  delete answer.previousLessonLearningEvidence;
  delete answer.previousLessonHomeworkReview;
  delete answer.preClassPulse;
  delete answer.preClassPulseHistory;
  delete answer.teachingDeliberation;
  delete answer.teachingDeliberationHistory;
  delete answer.lessonStudy;
  delete answer.lessonStudyHistory;
  delete answer.sameLessonComparisons;
  delete answer.sameLessonComparisonHistory;
  delete answer.teachingSlides;
  delete answer.layeredHomework;
  delete answer.homeworkReview;
  delete answer.homeworkReviewHistory;
  delete answer.classAdaptation;
  if (currentAnswer?.assetMeta) answer.assetMeta = clone(currentAnswer.assetMeta);
  if (currentAnswer?.previousLessonReflection) answer.previousLessonReflection = clone(currentAnswer.previousLessonReflection);
  if (currentAnswer?.classroomRun) answer.classroomRun = clone(currentAnswer.classroomRun);
  if (currentAnswer?.classroomMomentTriage) answer.classroomMomentTriage = clone(currentAnswer.classroomMomentTriage);
  if (currentAnswer?.previousLessonCarryover) answer.previousLessonCarryover = clone(currentAnswer.previousLessonCarryover);
  if (currentAnswer?.questionRehearsal) answer.questionRehearsal = clone(currentAnswer.questionRehearsal);
  if (currentAnswer?.questionRehearsalHistory) answer.questionRehearsalHistory = clone(currentAnswer.questionRehearsalHistory);
  if (currentAnswer?.learningEvidence) answer.learningEvidence = clone(currentAnswer.learningEvidence);
  if (currentAnswer?.learningEvidenceHistory) answer.learningEvidenceHistory = clone(currentAnswer.learningEvidenceHistory);
  if (currentAnswer?.previousLessonLearningEvidence) answer.previousLessonLearningEvidence = clone(currentAnswer.previousLessonLearningEvidence);
  if (currentAnswer?.previousLessonHomeworkReview) answer.previousLessonHomeworkReview = clone(currentAnswer.previousLessonHomeworkReview);
  if (currentAnswer?.preClassPulse) answer.preClassPulse = clone(currentAnswer.preClassPulse);
  if (currentAnswer?.preClassPulseHistory) answer.preClassPulseHistory = clone(currentAnswer.preClassPulseHistory);
  if (currentAnswer?.teachingDeliberation) answer.teachingDeliberation = clone(currentAnswer.teachingDeliberation);
  if (currentAnswer?.teachingDeliberationHistory) answer.teachingDeliberationHistory = clone(currentAnswer.teachingDeliberationHistory);
  if (currentAnswer?.lessonStudy) answer.lessonStudy = clone(currentAnswer.lessonStudy);
  if (currentAnswer?.lessonStudyHistory) answer.lessonStudyHistory = clone(currentAnswer.lessonStudyHistory);
  if (currentAnswer?.sameLessonComparisons) answer.sameLessonComparisons = clone(currentAnswer.sameLessonComparisons);
  if (currentAnswer?.sameLessonComparisonHistory) answer.sameLessonComparisonHistory = clone(currentAnswer.sameLessonComparisonHistory);
  if (currentAnswer?.teachingSlides) answer.teachingSlides = clone(currentAnswer.teachingSlides);
  if (currentAnswer?.layeredHomework) answer.layeredHomework = clone(currentAnswer.layeredHomework);
  if (currentAnswer?.homeworkReview) answer.homeworkReview = clone(currentAnswer.homeworkReview);
  if (currentAnswer?.homeworkReviewHistory) answer.homeworkReviewHistory = clone(currentAnswer.homeworkReviewHistory);
  if (currentAnswer?.classAdaptation) answer.classAdaptation = clone(currentAnswer.classAdaptation);
  return answer;
}

function serverOwnedCardKey(key) {
  return key === 'status' || /^sourceConfirmed/u.test(key) || /^(?:locked|lock)(?:At|By|Version|Reason)?$/u.test(key);
}

export function sanitizeClientCards(value, currentCards = []) {
  const currentById = new Map((Array.isArray(currentCards) ? currentCards : [])
    .filter(card => card?.id !== undefined)
    .map(card => [String(card.id), card]));
  return (Array.isArray(value) ? value : []).map(card => {
    const next = card && typeof card === 'object' ? clone(card) : {};
    const current = currentById.get(String(next.id));
    for (const key of Object.keys(next)) if (serverOwnedCardKey(key)) delete next[key];
    next.status = current?.status || 'draft';
    if (current) {
      for (const [key, item] of Object.entries(current)) {
        if (serverOwnedCardKey(key) && key !== 'status') next[key] = clone(item);
      }
    }
    return next;
  });
}

async function patchOwnedDraft(user, id, expectedVersion, body) {
  const rows = await userRest(user, 'lesson_drafts', {
    method: 'PATCH',
    body,
    query: query(user.id, { id: `eq.${id}`, version: `eq.${Number(expectedVersion)}` })
  });
  if (!Array.isArray(rows) || !rows[0]) throw Object.assign(new Error('edit_conflict'), { code: 'edit_conflict', status: 409 });
  return rows[0];
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function answerPlanContent(value) {
  const answer = value && typeof value === 'object' ? clone(value) : {};
  // These fields describe lifecycle, conversation recovery, or what happened
  // after class. Updating them must not invalidate a teacher-confirmed plan.
  for (const key of ['planApproval', 'revisions', 'assetMeta', 'conversationHistory', 'conversationTurns', 'evidenceShelf', 'teachingFeedback', 'lessonReflection', 'previousLessonReflection', 'classroomRun', 'classroomMomentTriage', 'previousLessonCarryover', 'questionRehearsal', 'questionRehearsalHistory', 'learningEvidence', 'learningEvidenceHistory', 'previousLessonLearningEvidence', 'previousLessonHomeworkReview', 'preClassPulse', 'preClassPulseHistory', 'teachingDeliberation', 'teachingDeliberationHistory', 'lessonStudy', 'lessonStudyHistory', 'sameLessonComparisons', 'sameLessonComparisonHistory', 'teachingSlides', 'layeredHomework', 'homeworkReview', 'homeworkReviewHistory', 'classAdaptation']) delete answer[key];
  return answer;
}

export function hasTeachingPlanAnswerChanged(currentAnswer, nextAnswer) {
  return !sameValue(answerPlanContent(currentAnswer), answerPlanContent(nextAnswer));
}

function reflectionText(value, max = 1600) {
  return String(value || '').trim().slice(0, max);
}

export function normalizeLessonReflection(value = {}) {
  const cardUsage = Array.isArray(value.cardUsage)
    ? value.cardUsage
    : Array.isArray(value.usedCards)
      ? value.usedCards
      : typeof value.usedCards === 'string'
        ? value.usedCards.split(/\r?\n/u)
        : [];
  return {
    version: 1,
    observedLearning: reflectionText(value.observedLearning ?? value.classResponse),
    unresolvedLearning: reflectionText(value.unresolvedLearning ?? value.unfinishedQuestions),
    pacingNotes: reflectionText(value.pacingNotes ?? value.timeManagement),
    cardUsage: [...new Set(cardUsage.map(item => reflectionText(typeof item === 'object' ? item.type || item.label : item, 80)).filter(Boolean))].slice(0, 8),
    nextLessonAdjustment: reflectionText(value.nextLessonAdjustment ?? value.nextStep),
    teacherNote: reflectionText(value.teacherNote)
  };
}

function comparableCard(card) {
  if (!card || typeof card !== 'object') return card;
  const items = Array.isArray(card.items) ? card.items : Array.isArray(card.content)
    ? card.content.map((item, index) => typeof item === 'string'
      ? { id: `${card.id || card.type || 'card'}-legacy-${index}`, text: item, citationIds: [] }
      : item)
    : [];
  return { ...card, items };
}

/**
 * A locked card is a teacher-approved classroom artifact, not merely a UI
 * state. Reject a stale or malicious full-draft save that changes, removes,
 * or replaces it. Unlocked cards can still be edited in the same request.
 */
export function assertLockedCardsUnchanged(currentCards = [], proposedCards = []) {
  const locked = (Array.isArray(currentCards) ? currentCards : [])
    .filter(card => card?.status === 'locked' && card?.id !== undefined)
    .map(card => [String(card.id), card]);
  const proposed = new Map((Array.isArray(proposedCards) ? proposedCards : []).map(card => [String(card?.id), card]));
  for (const [id, card] of locked) {
    if (!proposed.has(id) || !sameValue(comparableCard(proposed.get(id)), comparableCard(card))) {
      throw Object.assign(new Error('card_locked'), { code: 'card_locked', status: 409 });
    }
  }
  return true;
}

const OPERATION_WORDS = /(怎么|如何|怎样)?备课|(?:换成|改为|调整为|拆成|拆分为).{0,8}课时|生成.{0,8}(板书|三卡|方案)|展开.{0,8}(教师用书|依据)|只看.{0,8}(原文|依据)|重新生成|继续追问|切换.{0,8}(课时|教材)/u;

function cleanLessonTitle(value, fallback = '') {
  const text = String(value || '').trim();
  const quoted = text.match(/《([^》]{2,32})》/u);
  if (quoted?.[1]) return `《${quoted[1]}》`;
  const plain = text
    .replace(/^(怎样|如何|怎么)(备课|讲|设计)?/u, '')
    .replace(/(怎么备课|如何备课|备课方案|换成两课时(?:设计)?|生成(?:板书|一课三卡)|展开教师用书依据|只看原始依据)/gu, '')
    .trim();
  return plain && plain.length <= 24 && !OPERATION_WORDS.test(plain) ? plain : String(fallback || '').trim();
}

function safeCoreQuestion(value, lessonTitle) {
  const text = String(value || '').trim();
  if (text && text.length <= 80 && !OPERATION_WORDS.test(text)) return text;
  return lessonTitle ? `围绕${lessonTitle}，学生读完后能理解什么、说明什么？` : '学生读完后能理解什么、说明什么？';
}

function boardPlanFromItems(items, coreQuestion, previous = {}) {
  const names = ['文本发现', '关键依据', '课堂归纳'];
  const clean = (Array.isArray(items) ? items : [])
    .filter(item => String(item?.text || '').trim())
    .slice(0, 9);
  return {
    version: Number(previous.version) || 1,
    coreQuestion,
    branches: names.map((title, index) => ({
      id: `branch-${index + 1}`,
      title,
      nodes: clean.filter((_, itemIndex) => itemIndex % names.length === index)
        .map(item => ({ id: item.id, text: item.text, citationIds: Array.isArray(item.citationIds) ? item.citationIds : [] }))
    })),
    blankZones: Array.isArray(previous.blankZones) && previous.blankZones.length
      ? previous.blankZones.slice(0, 3)
      : ['学生关键词', '教师补写', '课堂生成结论'],
    stage: Math.min(5, Math.max(1, Number(previous.stage) || 1))
  };
}

/**
 * Old drafts could mistakenly use an interaction instruction (for example
 * "换成两课时设计") as the lesson title.  Repair only derived fields: never
 * overwrite a teacher's card items, and never touch locked cards.
 */
export function repairDraftForClassroom(draft) {
  if (!draft || typeof draft !== 'object') return { draft, changed: false };
  const resolvedIdentity = resolveLessonIdentity({
    lessonRef: draft.lesson_context?.lessonRef || draft.lessonContext?.lessonRef,
    title: draft.title,
    answerTitle: draft.answer?.lesson?.title,
    question: draft.question,
    citations: draft.citations
  });
  const sourceTitle = resolvedIdentity.title === '当前篇目'
    ? cleanLessonTitle(draft.question, cleanLessonTitle(draft.answer?.lesson?.title, cleanLessonTitle(draft.title)))
    : resolvedIdentity.title;
  if (!sourceTitle) return { draft, changed: false };
  let changed = false;
  const next = { ...draft };
  const answer = draft.answer && typeof draft.answer === 'object' ? { ...draft.answer } : {};
  const lesson = answer.lesson && typeof answer.lesson === 'object' ? { ...answer.lesson } : {};
  const lessonTitle = ['lesson_ref', 'citation'].includes(resolvedIdentity.source)
    ? sourceTitle
    : cleanLessonTitle(lesson.title, sourceTitle);
  const coreQuestion = safeCoreQuestion(lesson.coreQuestion, sourceTitle);

  if (String(lesson.title || '') !== lessonTitle || String(lesson.coreQuestion || '') !== coreQuestion) {
    answer.lesson = { ...lesson, title: lessonTitle, coreQuestion };
    next.answer = answer;
    changed = true;
  }
  const titleLooksLikeInstruction = OPERATION_WORDS.test(String(draft.title || '')) && !/《[^》]{2,32}》/u.test(String(draft.title || ''));
  const titleConflictsWithTrustedIdentity = ['lesson_ref', 'citation'].includes(resolvedIdentity.source)
    && String(draft.title || '') !== sourceTitle;
  if ((titleLooksLikeInstruction || titleConflictsWithTrustedIdentity) && String(draft.title || '') !== sourceTitle) {
    next.title = sourceTitle;
    changed = true;
  }

  const existingPeriodPlan = answer.periodPlan && typeof answer.periodPlan === 'object' ? answer.periodPlan : null;
  const lessonPlan = Array.isArray(answer.lessonPlan) ? answer.lessonPlan : [];
  if (existingPeriodPlan && lessonPlan.length) {
    const periods = Number(draft.lesson_context?.periods || draft.lessonContext?.periods || existingPeriodPlan.periods || 1);
    const checked = buildPeriodPlan({ periods, lessonPlan, existing: existingPeriodPlan });
    const derivedChanged = JSON.stringify(checked.activities) !== JSON.stringify(existingPeriodPlan.activities || []);
    const identityWasPolluted = titleLooksLikeInstruction || titleConflictsWithTrustedIdentity || OPERATION_WORDS.test(String(lesson.title || ''));
    if (identityWasPolluted && (checked.sequenceIssues.length || derivedChanged)) {
      const repairedPlan = checked.sequenceIssues.length ? repairPeriodSequence(checked) : checked;
      answer.periodPlan = { ...serializePeriodPlan(repairedPlan), repairKind: 'derived_sequence' };
      next.answer = answer;
      changed = true;
    }
  }

  if (Array.isArray(draft.cards)) {
    const cards = draft.cards.map(card => {
      const legacyItems = Array.isArray(card?.items) ? card.items : Array.isArray(card?.content) ? card.content : [];
      const normalizedCard = legacyItems.length && !Array.isArray(card?.items) ? { ...card, items: legacyItems.map((item, index) => typeof item === 'string' ? { id: `${card.id || card.type}-legacy-${index}`, text: item, citationIds: [] } : item) } : card;
      if (normalizedCard !== card) {
        // A locked card is immutable. The editor can normalize its legacy
        // `content` shape on read, but the server must not rewrite the
        // teacher-approved JSON while repairing derived fields.
        if (normalizedCard?.status === 'locked') return card;
        changed = true;
      }
      if (normalizedCard?.type !== 'board' || normalizedCard?.status === 'locked') return normalizedCard;
      const previous = normalizedCard.boardPlan && typeof normalizedCard.boardPlan === 'object' ? normalizedCard.boardPlan : {};
      const shouldRepair = !previous.coreQuestion || OPERATION_WORDS.test(String(previous.coreQuestion || ''))
        || !Array.isArray(previous.branches) || previous.branches.some(branch => OPERATION_WORDS.test(String(branch?.title || '')));
      if (!shouldRepair) return normalizedCard;
      changed = true;
      return { ...normalizedCard, boardPlan: boardPlanFromItems(normalizedCard.items, coreQuestion, previous) };
    });
    if (changed) next.cards = cards;
  }
  return { draft: next, changed };
}

async function getDraft(user, id) {
  const rows = await userRest(user, 'lesson_drafts', { query: query(user.id, { id: `eq.${id}`, limit: '1' }) });
  const draft = Array.isArray(rows) ? rows[0] : null;
  if (!draft) throw Object.assign(new Error('draft_not_found'), { code: 'draft_not_found', status: 404 });
  return draft;
}

function findManifestNode(documentId, nodeId) {
  const document = getManifest().documents.find(item => String(item.id) === String(documentId));
  const stack = [...(document?.tree || [])];
  const wanted = String(nodeId || '').replace(/^seed-/u, '');
  while (stack.length) {
    const node = stack.shift();
    if (String(node?.id) === String(nodeId) || String(node?.id || '').replace(/^seed-/u, '') === wanted) return { document, node };
    stack.push(...(Array.isArray(node?.children) ? node.children : []));
  }
  return null;
}

function lessonIdentityKey(context = {}) {
  const ref = context?.lessonRef || {};
  return [ref.documentId, String(ref.nodeId || '').replace(/^seed-/u, '')].filter(Boolean).join(':');
}

function normalizedLessonName(value) {
  return String(value || '').replace(/^\s*\d+\s*/u, '').replace(/[《》]/gu, '').trim();
}

function lessonCitationRanges(context = {}) {
  const title = normalizedLessonName(context?.lessonRef?.title);
  if (!title) return new Map();
  const ranges = new Map();
  for (const document of getManifest().documents || []) {
    const stack = [...(document.tree || [])];
    while (stack.length) {
      const node = stack.shift();
      if (normalizedLessonName(node?.title) === title && Number(node?.startPage) > 0) {
        ranges.set(String(document.id), [Number(node.startPage), Number(node.endPage || node.startPage)]);
        break;
      }
      stack.push(...(Array.isArray(node?.children) ? node.children : []));
    }
  }
  return ranges;
}

function assertCitationsBelongToLesson(citations, context) {
  if (!Array.isArray(citations) || !citations.length) return;
  const ranges = lessonCitationRanges(context);
  if (!ranges.size) return;
  for (const citation of citations) {
    const range = ranges.get(String(citation?.documentId || citation?.document_id || ''));
    if (!range) continue;
    const page = Number(citation?.pdfPage ?? citation?.pageNumber ?? citation?.page);
    if (!Number.isInteger(page) || page < range[0] || page > range[1]) {
      throw Object.assign(new Error('citation_outside_lesson'), { code: 'citation_outside_lesson', status: 422 });
    }
  }
}

async function assertCitationDocumentsAccessible(user, citations) {
  const items = Array.isArray(citations) ? citations : [];
  const publicIds = new Set((getManifest().documents || []).map(item => String(item.id)));
  const unknown = [...new Set(items.map(item => String(item?.documentId || item?.document_id || '')).filter(id => id && !publicIds.has(id)))];
  if (!unknown.length) return;
  const rows = await userRest(user, 'document_access', { query: { owner_id: `eq.${user.id}`, select: 'document_id' } });
  const owned = new Set((Array.isArray(rows) ? rows : []).map(item => String(item?.document_id || '')).filter(Boolean));
  if (unknown.some(id => !owned.has(id))) throw Object.assign(new Error('citation_document_forbidden'), { code: 'citation_document_forbidden', status: 422 });
}

function citationComparableText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function trustedPageText(value = {}) {
  const page = value.page && typeof value.page === 'object' ? value.page : value;
  return String(page.retrievalText || page.text || page.quote || '');
}

async function assertCitationTextMatchesSource(citations) {
  const items = Array.isArray(citations) ? citations : [];
  if (!items.length) return;
  const publicIds = new Set((getManifest().documents || []).map(item => String(item.id)));
  const local = new LocalFullTextIndexProvider();
  const remote = getIndexProvider().provider;
  await Promise.all(items.map(async citation => {
    const documentId = String(citation?.documentId || citation?.document_id || '');
    const pageNumber = Number(citation?.pdfPage ?? citation?.pageNumber ?? citation?.page);
    const quote = citationComparableText(citation?.quote || citation?.text);
    if (!documentId || !Number.isInteger(pageNumber) || pageNumber < 1 || quote.length < 4) {
      throw Object.assign(new Error('citation_text_mismatch'), { code: 'citation_text_mismatch', status: 422 });
    }
    let result;
    try {
      result = await (publicIds.has(documentId) ? local : remote).getPage(documentId, pageNumber);
    } catch {
      throw Object.assign(new Error('citation_text_mismatch'), { code: 'citation_text_mismatch', status: 422 });
    }
    const source = citationComparableText(trustedPageText(result));
    if (!source || !source.includes(quote)) {
      throw Object.assign(new Error('citation_text_mismatch'), { code: 'citation_text_mismatch', status: 422 });
    }
  }));
}

async function assertCitationsTrusted(user, citations, context) {
  await assertCitationDocumentsAccessible(user, citations);
  assertCitationsBelongToLesson(citations, context);
  await assertCitationTextMatchesSource(citations);
}

function lessonName(value) {
  return String(value || '').replace(/^\d+\s*/u, '').trim().slice(0, 120);
}

function hasReflectionContent(reflection) {
  return Boolean(reflection && [reflection.observedLearning, reflection.unresolvedLearning, reflection.pacingNotes, reflection.nextLessonAdjustment, ...(reflection.cardUsage || [])].some(value => String(value || '').trim()));
}

export function relayDraftId(userId, sourceDraftId, operationId) {
  const hex = crypto.createHash('sha256').update(`${userId}\0${sourceDraftId}\0${operationId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function classNameInput(value, max = 40) {
  return String(value || '').replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max);
}

async function adaptDraftToClass(user, source, body) {
  assertCurrentVersion(source, body.sourceVersion ?? body.version);
  const targetClassName = classNameInput(body.targetClassName);
  const targetClassLevel = classNameInput(body.targetClassLevel, 80);
  if (!targetClassName) throw Object.assign(new Error('target_class_required'), { code: 'target_class_required', status: 400 });
  if (targetClassName === classNameInput(source.lesson_context?.className)) throw Object.assign(new Error('target_class_same'), { code: 'target_class_same', status: 409 });
  const operationId = String(body.operationId || '').trim().slice(0, 120);
  if (!operationId) throw Object.assign(new Error('operation_id_required'), { code: 'operation_id_required', status: 400 });

  const rows = await userRest(user, 'lesson_drafts', {
    query: query(user.id, {
      select: 'id,title,question,scope,lesson_context,answer,citations,cards,version,updated_at,created_at',
      order: 'updated_at.desc',
      limit: '80'
    })
  });
  const existing = (Array.isArray(rows) ? rows : []).find(row => row.answer?.classAdaptation?.operationId === operationId && row.answer?.classAdaptation?.sourceDraftId === source.id);
  if (existing) return { draft: existing, reused: true };
  const profile = deriveClassLearningProfiles(rows || []).find(item => item.className === targetClassName) || {};
  const nextId = relayDraftId(user.id, source.id, `class:${operationId}`);
  const prepared = buildClassAdaptedDraft(source, {
    className: targetClassName,
    classLevel: targetClassLevel || profile.classLevel || ''
  }, { id: nextId, operationId, now: new Date().toISOString() });
  const createBody = { ...prepared, id: nextId, user_id: user.id, version: 1 };
  let createdRows;
  try {
    createdRows = await userRest(user, 'lesson_drafts', { method: 'POST', body: createBody });
  } catch (error) {
    if (error?.code !== 'database_request_failed') throw error;
    const raced = await getDraft(user, nextId).catch(() => null);
    if (raced?.answer?.classAdaptation?.operationId === operationId && raced?.answer?.classAdaptation?.sourceDraftId === source.id) return { draft: raced, reused: true };
    throw error;
  }
  return { draft: Array.isArray(createdRows) ? createdRows[0] : createdRows, reused: false };
}

async function continueToNextLesson(user, source, body) {
  assertCurrentVersion(source, body.sourceVersion ?? body.version);
  const unitRef = source.lesson_context?.unitRef;
  if (!unitRef?.documentId || !unitRef?.nodeId) throw Object.assign(new Error('unit_context_required'), { code: 'unit_context_required', status: 409 });
  const operationId = String(body.operationId || '').trim().slice(0, 120);
  if (!operationId) throw Object.assign(new Error('operation_id_required'), { code: 'operation_id_required', status: 400 });
  const existingRows = await userRest(user, 'lesson_drafts', { query: query(user.id, { select: 'id,title,question,lesson_context,answer,citations,cards,version,created_at,updated_at', order: 'updated_at.desc' }) });
  const existing = (existingRows || []).find(row => row.answer?.unitContinuity?.operationId === operationId && row.answer?.unitContinuity?.sourceDraftId === source.id);
  if (existing) return { draft: existing, reused: true };

  const verifiedUnit = findManifestNode(unitRef.documentId, unitRef.nodeId);
  if (!verifiedUnit?.node) throw Object.assign(new Error('unit_context_required'), { code: 'unit_context_required', status: 409 });
  const lessons = (verifiedUnit.node.children || []).filter(item => /^\s*\d+\s+\S/u.test(String(item?.title || '')) && Number(item?.startPage) > 0);
  const nodeKey = value => String(value || '').replace(/^seed-/u, '');
  const currentLessonIndex = lessons.findIndex(item => nodeKey(item.id) === nodeKey(source.lesson_context?.lessonRef?.nodeId));
  const lessonIndex = lessons.findIndex(item => nodeKey(item.id) === nodeKey(body.nextNodeId));
  if (lessonIndex < 0) throw Object.assign(new Error('unit_lesson_not_found'), { code: 'unit_lesson_not_found', status: 404 });
  if (currentLessonIndex < 0 || lessonIndex !== currentLessonIndex + 1) throw Object.assign(new Error('unit_lesson_not_next'), { code: 'unit_lesson_not_next', status: 409 });
  const target = lessons[lessonIndex];
  const verified = findManifestNode(unitRef.documentId, target.id);
  if (!verified?.node?.startPage) throw Object.assign(new Error('unit_lesson_not_found'), { code: 'unit_lesson_not_found', status: 404 });
  const reflection = normalizeLessonReflection(source.answer?.lessonReflection || source.answer?.teachingFeedback || {});
  const momentTriage = source.answer?.classroomMomentTriage || null;
  if (momentTriage?.status === 'confirmed' && classroomMomentTriageIsStale(source)) {
    throw Object.assign(new Error('classroom_moment_triage_stale'), { code: 'classroom_moment_triage_stale', status: 409 });
  }
  const carryover = momentTriage?.status === 'confirmed'
    ? buildPreviousLessonCarryover(momentTriage, normalizeClassroomRun(source.answer?.classroomRun || {}), {
      sourceDraftId: source.id,
      sourceVersion: Number(source.version || 1)
    })
    : null;
  if (source.answer?.learningEvidence?.status === 'confirmed' && learningEvidenceIsStale(source)) {
    throw Object.assign(new Error('learning_evidence_stale'), { code: 'learning_evidence_stale', status: 409 });
  }
  const learningContext = learningEvidenceContext(source.answer?.learningEvidence);
  if (source.answer?.homeworkReview?.status === 'confirmed' && homeworkReviewIsStale(source)) {
    throw Object.assign(new Error('homework_review_stale'), { code: 'homework_review_stale', status: 409 });
  }
  const reviewContext = homeworkReviewContext(source.answer?.homeworkReview);
  if (!hasReflectionContent(reflection) && !learningContext && !reviewContext) throw Object.assign(new Error('lesson_reflection_required'), { code: 'lesson_reflection_required', status: 409 });
  const title = lessonName(verified.node.title);
  const previous = lessons[lessonIndex - 1] || null;
  const following = lessons[lessonIndex + 1] || null;
  const nextDraftId = relayDraftId(user.id, source.id, operationId);
  const createBody = {
      id: nextDraftId,
      user_id: user.id,
      title: title ? `《${title}》` : '下一课',
      question: title ? `怎样让《${title}》承接上一课学情，并完成本课学习任务？` : '怎样承接上一课学情继续教学？',
      scope: ['textbook', 'teacher-guide'],
      lesson_context: {
        periods: 1,
        className: source.lesson_context?.className || '',
        classLevel: source.lesson_context?.classLevel || '普通',
        teachingGoal: '理解文本',
        teachingMode: source.lesson_context?.teachingMode || '探究',
        unitRef: {
          key: `${verified.document.id}:${verifiedUnit.node.id}`,
          documentId: verified.document.id,
          nodeId: verifiedUnit.node.id,
          title: verifiedUnit.node.title,
          pageRange: [Number(verifiedUnit.node.startPage), Number(verifiedUnit.node.endPage || verifiedUnit.node.startPage)]
        },
        lessonRef: {
          documentId: verified.document.id,
          nodeId: verified.node.id,
          title,
          lessonNumber: Number(String(verified.node.title).match(/^\s*(\d+)/u)?.[1] || 0) || null,
          lessonIndex,
          pageRange: [Number(verified.node.startPage), Number(verified.node.endPage || verified.node.startPage)],
          scope: 'both'
        }
      },
      answer: {
        ...(hasReflectionContent(reflection) ? { previousLessonReflection: {
          sourceDraftId: source.id,
          sourceVersion: Number(source.version || 1),
          recordedAt: new Date().toISOString(),
          feedback: reflection
        } } : {}),
        ...(learningContext ? {
          previousLessonLearningEvidence: {
            sourceDraftId: source.id,
            sourceVersion: Number(source.version || 1),
            recordedAt: new Date().toISOString(),
            summary: learningContext
          }
        } : {}),
        ...(reviewContext ? {
          previousLessonHomeworkReview: {
            sourceDraftId: source.id,
            sourceVersion: Number(source.version || 1),
            recordedAt: new Date().toISOString(),
            summary: reviewContext
          }
        } : {}),
        ...(carryover?.items?.length ? { previousLessonCarryover: carryover } : {}),
        unitContinuity: {
          version: 1,
          operationId,
          unitKey: `${verified.document.id}:${verifiedUnit.node.id}`,
          sourceDraftId: source.id,
          previousLessonTitle: source.title || lessonName(previous?.title),
          currentLessonTitle: title,
          nextLessonTitle: lessonName(following?.title),
          lessonIndex,
          totalLessons: lessons.length
        }
      },
      citations: [],
      cards: [],
      version: 1
  };
  let createdRows;
  try {
    createdRows = await userRest(user, 'lesson_drafts', { method: 'POST', body: createBody });
  } catch (error) {
    // The deterministic UUID closes the race between the read above and the
    // insert. A concurrent retry can only collide with the same owned draft.
    if (error?.code !== 'database_request_failed') throw error;
    const raced = await getDraft(user, nextDraftId).catch(() => null);
    if (raced?.answer?.unitContinuity?.operationId === operationId && raced?.answer?.unitContinuity?.sourceDraftId === source.id) {
      return { draft: raced, reused: true };
    }
    throw error;
  }
  const created = Array.isArray(createdRows) ? createdRows[0] : createdRows;
  return { draft: created, reused: false };
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    const parts = routeParts(routePath(req));
    if (!parts.length && req.method === 'GET') {
      const rows = await userRest(user, 'lesson_drafts', { query: query(user.id, { select: 'id,title,question,lesson_context,version,updated_at,created_at' , order: 'updated_at.desc' }) });
      return json(res, 200, { drafts: rows || [] });
    }
    if (!parts.length && req.method === 'POST') {
      const body = await readJson(req);
      // Normalize derived lesson identity before the first write as well as on
      // later reads. This prevents a follow-up instruction such as “改成两课时”
      // from being persisted as the board title in a newly-created draft.
      const prepared = repairDraftForClassroom({
        title: body.title || body.question || '未命名备课',
        question: body.question || '',
        answer: sanitizeClientAnswer(body.answer),
        cards: sanitizeClientCards(body.cards)
      }).draft;
      if (Array.isArray(body.citations) && body.citations.length) await assertCitationsTrusted(user, body.citations, body.lessonContext || {});
      const draft = await userRest(user, 'lesson_drafts', { method: 'POST', body: { user_id: user.id, title: prepared.title || body.title || body.question || '未命名备课', question: prepared.question || body.question || '', scope: body.scope || [], lesson_context: body.lessonContext || {}, answer: prepared.answer || body.answer || {}, citations: body.citations || [], cards: prepared.cards || body.cards || [], version: 1 } });
      return json(res, 201, { draft: Array.isArray(draft) ? draft[0] : draft });
    }
    if (parts.length === 1 && parts[0] === 'tasks' && req.method === 'GET') {
      const rows = await userRest(user, 'lesson_drafts', {
        query: query(user.id, {
          select: 'id,title,question,lesson_context,answer,cards,version,updated_at,created_at',
          order: 'updated_at.desc',
          limit: '50'
        })
      });
      return json(res, 200, { tasks: deriveTeachingTasks(rows || []) });
    }
    if (parts.length === 1 && parts[0] === 'class-profiles' && req.method === 'GET') {
      const rows = await userRest(user, 'lesson_drafts', {
        query: query(user.id, {
          select: 'id,title,question,lesson_context,answer,updated_at,created_at',
          order: 'updated_at.desc',
          limit: '80'
        })
      });
      return json(res, 200, { profiles: deriveClassLearningProfiles(rows || []) });
    }
    const id = parts[0];
    if (parts.length === 2 && parts[1] === 'adapt-class' && req.method === 'POST') {
      const source = await getDraft(user, id);
      const result = await adaptDraftToClass(user, source, await readJson(req));
      return json(res, result.reused ? 200 : 201, result);
    }
    if (parts.length === 1 && req.method === 'GET') {
      const repaired = repairDraftForClassroom(await getDraft(user, id));
      return json(res, 200, { draft: repaired.draft, repairNeeded: repaired.changed });
    }
    if (parts.length === 2 && parts[1] === 'slides' && req.method === 'GET') {
      const current = await getDraft(user, id);
      const stored = current.answer?.teachingSlides ? normalizeTeachingSlideDeck(current.answer.teachingSlides) : null;
      const stale = stored ? teachingSlideDeckIsStale(current) : false;
      const deck = stored && !stale ? stored : buildTeachingSlideDeck(current);
      return json(res, 200, { deck, stale, draftVersion: Number(current.version || 1) });
    }
    if (parts.length === 2 && parts[1] === 'slides' && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      const stored = current.answer?.teachingSlides ? normalizeTeachingSlideDeck(current.answer.teachingSlides) : null;
      const base = stored && !teachingSlideDeckIsStale(current) ? stored : buildTeachingSlideDeck(current);
      const deck = mergeTeachingSlideDeck(base, body.deck || body, { confirm: body.confirm === true, confirmedBy: user.id });
      const answer = clone(current.answer || {});
      answer.teachingSlides = deck;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: deck.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved, deck, draftVersion: Number(current.version || 1) + 1 });
    }
    if (parts.length === 2 && parts[1] === 'homework-pack' && req.method === 'GET') {
      const current = await getDraft(user, id);
      const stored = current.answer?.layeredHomework ? normalizeLayeredHomework(current.answer.layeredHomework) : null;
      const stale = stored ? layeredHomeworkIsStale(current) : false;
      const pack = stored && !stale ? stored : buildLayeredHomework(current);
      return json(res, 200, { pack, stale, draftVersion: Number(current.version || 1) });
    }
    if (parts.length === 2 && parts[1] === 'homework-pack' && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      const stored = current.answer?.layeredHomework ? normalizeLayeredHomework(current.answer.layeredHomework) : null;
      const base = stored && !layeredHomeworkIsStale(current) ? stored : buildLayeredHomework(current);
      const pack = mergeLayeredHomework(base, body.pack || body, { confirm: body.confirm === true, confirmedBy: user.id });
      const answer = clone(current.answer || {});
      answer.layeredHomework = pack;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: pack.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved, pack, draftVersion: Number(current.version || 1) + 1 });
    }
    if (parts.length === 2 && parts[1] === 'homework-review' && req.method === 'GET') {
      const current = await getDraft(user, id);
      const pack = normalizeLayeredHomework(current.answer?.layeredHomework || {});
      if (pack.status !== 'confirmed') throw Object.assign(new Error('homework_marking_requires_confirmed_pack'), { code: 'homework_marking_requires_confirmed_pack', status: 409 });
      if (layeredHomeworkIsStale(current)) throw Object.assign(new Error('homework_marking_pack_stale'), { code: 'homework_marking_pack_stale', status: 409 });
      const review = current.answer?.homeworkReview ? normalizeHomeworkReview(current.answer.homeworkReview) : null;
      return json(res, 200, { review, stale: review ? homeworkReviewIsStale(current) : false, draftVersion: Number(current.version || 1), tasks: pack.tasks.map(item => ({ id: item.id, level: item.level, label: item.label, prompt: item.prompt, score: item.score })) });
    }
    if (parts.length === 3 && parts[1] === 'homework-review' && parts[2] === 'analyze' && req.method === 'POST') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      let deepseek = null;
      if (typeof body.keyId === 'string' && body.keyId.trim()) deepseek = await resolveActiveDeepSeekKey(user, body.keyId.trim());
      const analysis = await analyzeHomeworkResponses({ draft: current, taskId: body.taskId, responses: body.responses, deepseek });
      const answer = clone(current.answer || {});
      if (answer.homeworkReview) answer.homeworkReviewHistory = [clone(answer.homeworkReview), ...(Array.isArray(answer.homeworkReviewHistory) ? answer.homeworkReviewHistory : [])].slice(0, 8);
      answer.homeworkReview = analysis.review;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: analysis.review.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { review: analysis.review, results: analysis.results, draftVersion: Number(current.version || 1) + 1, draft: saved });
    }
    if (parts.length === 2 && parts[1] === 'homework-review' && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      if (!current.answer?.homeworkReview) throw Object.assign(new Error('homework_review_not_found'), { code: 'homework_review_not_found', status: 404 });
      if (homeworkReviewIsStale(current)) throw Object.assign(new Error('homework_review_stale'), { code: 'homework_review_stale', status: 409 });
      const review = mergeHomeworkReview(current.answer.homeworkReview, body.review || body, { confirm: body.confirm === true });
      const answer = clone(current.answer || {}); answer.homeworkReview = review;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: review.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { review, draftVersion: Number(current.version || 1) + 1, draft: saved });
    }
    if (parts.length === 2 && parts[1] === 'continue-next' && req.method === 'POST') {
      const source = await getDraft(user, id);
      const result = await continueToNextLesson(user, source, await readJson(req));
      return json(res, result.reused ? 200 : 201, result);
    }
    if (parts.length === 2 && parts[1] === 'classroom-run' && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      const previous = current.answer?.classroomRun || {};
      if (previous.status === 'confirmed') throw Object.assign(new Error('classroom_run_confirmed'), { code: 'classroom_run_confirmed', status: 409 });
      const requested = body.classroomRun || body;
      const classroomRun = normalizeClassroomRun({
        ...requested,
        status: requested.status === 'pending_review' ? 'pending_review' : previous.status === 'pending_review' ? 'pending_review' : 'in_progress'
      }, previous);
      const now = new Date().toISOString();
      classroomRun.startedAt = previous.startedAt || now;
      classroomRun.updatedAt = now;
      classroomRun.endedAt = classroomRun.status === 'pending_review' ? previous.endedAt || now : null;
      classroomRun.confirmedAt = previous.confirmedAt || null;
      const answer = clone(current.answer || {});
      answer.classroomRun = classroomRun;
      const saved = await patchOwnedDraft(user, id, current.version || 1, {
        // Classroom notes are operational state, not a new teaching-plan
        // version. Keep the existing revision ledger without adding a nearly
        // identical plan snapshot for every in-class save.
        answer,
        updated_at: now,
        version: Number(current.version || 1) + 1
      });
      return json(res, 200, { draft: saved, classroomRun: saved.answer?.classroomRun || classroomRun });
    }
    if (parts.length === 3 && parts[1] === 'rehearsal' && parts[2] === 'generate' && req.method === 'POST') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      if (current.answer?.planApproval?.status !== 'confirmed' || current.answer?.planApproval?.hasUnconfirmedChanges === true) {
        throw Object.assign(new Error('plan_confirmation_required'), { code: 'plan_confirmation_required', status: 409 });
      }
      if (current.answer?.questionRehearsal?.status === 'confirmed' && !questionRehearsalIsStale(current)) {
        throw Object.assign(new Error('rehearsal_confirmed'), { code: 'rehearsal_confirmed', status: 409 });
      }
      const rehearsal = buildQuestionRehearsal(current);
      const answer = clone(current.answer || {});
      if (current.answer?.questionRehearsal?.status === 'confirmed') {
        answer.questionRehearsalHistory = [clone(current.answer.questionRehearsal), ...(Array.isArray(current.answer.questionRehearsalHistory) ? current.answer.questionRehearsalHistory : [])].slice(0, 8);
      }
      answer.questionRehearsal = rehearsal;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: rehearsal.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved, rehearsal });
    }
    if (parts.length === 2 && parts[1] === 'rehearsal' && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      if (!current.answer?.questionRehearsal) throw Object.assign(new Error('rehearsal_not_found'), { code: 'rehearsal_not_found', status: 404 });
      if (questionRehearsalIsStale(current)) throw Object.assign(new Error('rehearsal_stale'), { code: 'rehearsal_stale', status: 409 });
      const rehearsal = mergeQuestionRehearsal(current.answer.questionRehearsal, body.rehearsal || body, { confirm: body.confirm === true });
      const answer = clone(current.answer || {});
      answer.questionRehearsal = rehearsal;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: rehearsal.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved, rehearsal });
    }
    if (parts.length === 3 && parts[1] === 'preclass-pulse' && parts[2] === 'generate' && req.method === 'POST') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      if (current.answer?.planApproval?.status !== 'confirmed' || current.answer?.planApproval?.hasUnconfirmedChanges === true) {
        throw Object.assign(new Error('plan_confirmation_required'), { code: 'plan_confirmation_required', status: 409 });
      }
      if (current.answer?.preClassPulse?.status === 'confirmed' && !preClassPulseIsStale(current)) {
        throw Object.assign(new Error('preclass_pulse_confirmed'), { code: 'preclass_pulse_confirmed', status: 409 });
      }
      const pulse = buildPreClassPulse(current);
      const answer = clone(current.answer || {});
      if (current.answer?.preClassPulse?.status === 'confirmed') {
        answer.preClassPulseHistory = [clone(current.answer.preClassPulse), ...(Array.isArray(current.answer.preClassPulseHistory) ? current.answer.preClassPulseHistory : [])].slice(0, 8);
      }
      answer.preClassPulse = pulse;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: pulse.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved, preClassPulse: pulse });
    }
    if (parts.length === 2 && parts[1] === 'preclass-pulse' && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      if (!current.answer?.preClassPulse) throw Object.assign(new Error('preclass_pulse_not_found'), { code: 'preclass_pulse_not_found', status: 404 });
      if (preClassPulseIsStale(current)) throw Object.assign(new Error('preclass_pulse_stale'), { code: 'preclass_pulse_stale', status: 409 });
      const pulse = mergePreClassPulse(current.answer.preClassPulse, body.preClassPulse || body, { confirm: body.confirm === true });
      const answer = clone(current.answer || {});
      answer.preClassPulse = pulse;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: pulse.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved, preClassPulse: pulse });
    }
    if (parts.length === 3 && parts[1] === 'learning-evidence' && parts[2] === 'generate' && req.method === 'POST') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      if (current.answer?.learningEvidence?.status === 'confirmed' && !learningEvidenceIsStale(current)) {
        throw Object.assign(new Error('learning_evidence_confirmed'), { code: 'learning_evidence_confirmed', status: 409 });
      }
      const evidence = buildLearningEvidence(current);
      const answer = clone(current.answer || {});
      if (current.answer?.learningEvidence?.status === 'confirmed') {
        answer.learningEvidenceHistory = [clone(current.answer.learningEvidence), ...(Array.isArray(current.answer.learningEvidenceHistory) ? current.answer.learningEvidenceHistory : [])].slice(0, 8);
      }
      answer.learningEvidence = evidence;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: evidence.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved, learningEvidence: evidence });
    }
    if (parts.length === 2 && parts[1] === 'learning-evidence' && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      if (!current.answer?.learningEvidence) throw Object.assign(new Error('learning_evidence_not_found'), { code: 'learning_evidence_not_found', status: 404 });
      if (learningEvidenceIsStale(current)) throw Object.assign(new Error('learning_evidence_stale'), { code: 'learning_evidence_stale', status: 409 });
      const evidence = mergeLearningEvidence(current.answer.learningEvidence, body.learningEvidence || body, { confirm: body.confirm === true });
      const answer = clone(current.answer || {});
      answer.learningEvidence = evidence;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: evidence.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved, learningEvidence: evidence });
    }
    if (parts.length === 3 && parts[1] === 'deliberation' && parts[2] === 'generate' && req.method === 'POST') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      await assertCitationsTrusted(user, current.citations, current.lesson_context);
      if (current.answer?.teachingDeliberation?.status === 'confirmed' && !teachingDeliberationIsStale(current)) {
        throw Object.assign(new Error('deliberation_confirmed'), { code: 'deliberation_confirmed', status: 409 });
      }
      let deepseek = null;
      if (typeof body.keyId === 'string' && body.keyId.trim()) deepseek = await resolveActiveDeepSeekKey(user, body.keyId.trim());
      const deliberation = await generateTeachingDeliberation({ draft: current, deepseek });
      const answer = clone(current.answer || {});
      if (answer.teachingDeliberation?.status === 'confirmed') {
        answer.teachingDeliberationHistory = [clone(answer.teachingDeliberation), ...(Array.isArray(answer.teachingDeliberationHistory) ? answer.teachingDeliberationHistory : [])].slice(0, 8);
      }
      answer.teachingDeliberation = deliberation;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: deliberation.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved, deliberation });
    }
    if (parts.length === 2 && parts[1] === 'deliberation' && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      if (!current.answer?.teachingDeliberation) throw Object.assign(new Error('deliberation_not_found'), { code: 'deliberation_not_found', status: 404 });
      if (teachingDeliberationIsStale(current)) throw Object.assign(new Error('deliberation_stale'), { code: 'deliberation_stale', status: 409 });
      const confirm = body.confirm === true;
      const deliberation = mergeTeachingDeliberation(current.answer.teachingDeliberation, body.deliberation || body, {
        confirm,
        confirmedBy: user.id
      });
      const answer = clone(current.answer || {});
      answer.teachingDeliberation = deliberation;
      // A newly confirmed classroom choice changes the approved teaching plan.
      // Preserve the old approval snapshot, but require the teacher to review
      // and confirm the regenerated plan before cards can be generated.
      if (confirm && answer.planApproval?.confirmedSnapshot) {
        answer.planApproval.status = 'changes_pending';
        answer.planApproval.hasUnconfirmedChanges = true;
      }
      const saved = await patchOwnedDraft(user, id, current.version || 1, { answer, updated_at: deliberation.updatedAt, version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved, deliberation });
    }
    if (parts.length === 3 && parts[1] === 'lesson-study' && parts[2] === 'generate' && req.method === 'POST') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      if (current.answer?.lessonStudy?.status === 'confirmed' && !lessonStudyIsStale(current)) {
        throw Object.assign(new Error('lesson_study_confirmed'), { code: 'lesson_study_confirmed', status: 409 });
      }
      const study = buildLessonStudy(current);
      const answer = clone(current.answer || {});
      if (answer.lessonStudy?.status === 'confirmed') {
        answer.lessonStudyHistory = [clone(answer.lessonStudy), ...(Array.isArray(answer.lessonStudyHistory) ? answer.lessonStudyHistory : [])].slice(0, 8);
      }
      answer.lessonStudy = study;
      const saved = await patchOwnedDraft(user, id, current.version || 1, {
        answer,
        updated_at: study.updatedAt,
        version: Number(current.version || 1) + 1
      });
      return json(res, 200, { draft: saved, lessonStudy: study });
    }
    if (parts.length === 2 && parts[1] === 'lesson-study' && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      if (!current.answer?.lessonStudy) throw Object.assign(new Error('lesson_study_not_found'), { code: 'lesson_study_not_found', status: 404 });
      if (lessonStudyIsStale(current)) throw Object.assign(new Error('lesson_study_stale'), { code: 'lesson_study_stale', status: 409 });
      const study = mergeLessonStudy(current.answer.lessonStudy, body.lessonStudy || body, {
        confirm: body.confirm === true,
        confirmedBy: user.id
      });
      const answer = clone(current.answer || {});
      answer.lessonStudy = study;
      const saved = await patchOwnedDraft(user, id, current.version || 1, {
        answer,
        updated_at: study.updatedAt,
        version: Number(current.version || 1) + 1
      });
      return json(res, 200, { draft: saved, lessonStudy: study });
    }
    if (parts.length === 2 && parts[1] === 'feedback' && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      const answer = clone(current.answer || {});
      answer.lessonReflection = normalizeLessonReflection(body.reflection || body.feedback || {});
      delete answer.teachingFeedback;
      const classroomRun = normalizeClassroomRun(answer.classroomRun || {});
      if (classroomRun.moments.length) {
        const baseline = answer.classroomMomentTriage || defaultClassroomMomentTriage(classroomRun);
        answer.classroomMomentTriage = baseline.status === 'confirmed'
          ? baseline
          : mergeClassroomMomentTriage(
            baseline,
            body.momentTriage || baseline,
            classroomRun,
            { confirm: true }
          );
      }
      if (answer.classroomRun?.status === 'pending_review') {
        answer.classroomRun = normalizeClassroomRun({ ...answer.classroomRun, status: 'confirmed' }, answer.classroomRun);
        answer.classroomRun.status = 'confirmed';
        answer.classroomRun.confirmedAt = new Date().toISOString();
        answer.classroomRun.updatedAt = answer.classroomRun.confirmedAt;
      }
      const nextAnswer = answerWithCurrentRevision(current, answer, '保存课后复盘', { planChanged: false });
      const saved = await patchOwnedDraft(user, id, current.version || 1, {
        answer: nextAnswer,
        updated_at: new Date().toISOString(),
        version: Number(current.version || 1) + 1
      });
      return json(res, 200, { draft: saved, reflection: saved.answer?.lessonReflection || null });
    }
    if (parts.length === 3 && parts[1] === 'carryover' && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      if (!current.answer?.previousLessonCarryover) throw Object.assign(new Error('classroom_carryover_not_found'), { code: 'classroom_carryover_not_found', status: 404 });
      const carryover = updatePreviousLessonCarryover(
        normalizePreviousLessonCarryover(current.answer.previousLessonCarryover),
        parts[2],
        body.status
      );
      const answer = clone(current.answer || {});
      answer.previousLessonCarryover = carryover;
      const saved = await patchOwnedDraft(user, id, current.version || 1, {
        answer,
        updated_at: new Date().toISOString(),
        version: Number(current.version || 1) + 1
      });
      return json(res, 200, { draft: saved, carryover, draftVersion: Number(current.version || 1) + 1 });
    }
    if (parts.length === 1 && req.method === 'PATCH') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      const update = {};
      for (const key of ['title', 'question', 'scope', 'answer', 'citations', 'cards']) if (Object.prototype.hasOwnProperty.call(body, key)) update[key] = body[key];
      if (Object.prototype.hasOwnProperty.call(update, 'answer')) update.answer = sanitizeClientAnswer(update.answer, current.answer);
      if (Array.isArray(update.cards) && Array.isArray(current.cards)) {
        assertLockedCardsUnchanged(current.cards, update.cards);
        update.cards = sanitizeClientCards(update.cards, current.cards);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'lessonContext')) update.lesson_context = body.lessonContext;
      if (Object.prototype.hasOwnProperty.call(body, 'lesson_context')) update.lesson_context = body.lesson_context;
      const lessonChanged = Object.prototype.hasOwnProperty.call(update, 'lesson_context')
        && lessonIdentityKey(current.lesson_context) !== lessonIdentityKey(update.lesson_context)
        && Boolean(lessonIdentityKey(current.lesson_context) || lessonIdentityKey(update.lesson_context));
      if (lessonChanged) {
        if ((current.cards || []).some(card => card?.status === 'locked')) {
          throw Object.assign(new Error('lesson_change_requires_new_draft'), { code: 'lesson_change_requires_new_draft', status: 409 });
        }
        update.citations = [];
        update.cards = [];
        const answer = clone(update.answer || current.answer || {});
        for (const key of ['questionRehearsal', 'questionRehearsalHistory', 'learningEvidence', 'learningEvidenceHistory', 'teachingDeliberation', 'teachingDeliberationHistory', 'teachingSlides', 'layeredHomework', 'homeworkReview', 'homeworkReviewHistory']) delete answer[key];
        update.answer = answer;
      } else if (Object.prototype.hasOwnProperty.call(update, 'citations')) {
        await assertCitationsTrusted(user, update.citations, update.lesson_context || current.lesson_context);
      }
      if (Object.keys(update).some(key => ['title', 'question', 'answer', 'cards'].includes(key))) {
        const prepared = repairDraftForClassroom({ ...current, ...update }).draft;
        for (const key of ['title', 'question', 'answer', 'cards']) {
          if (Object.prototype.hasOwnProperty.call(update, key)) update[key] = prepared[key];
        }
      }
      if (Object.keys(update).some(key => ['title', 'question', 'answer', 'cards', 'citations', 'scope', 'lesson_context'].includes(key))) {
        const planChanged = Object.keys(update).some(key => ['title', 'question', 'citations', 'scope', 'lesson_context'].includes(key))
          || (Object.prototype.hasOwnProperty.call(update, 'answer') && hasTeachingPlanAnswerChanged(current.answer, update.answer));
        update.answer = answerWithCurrentRevision(current, update.answer || current.answer, '保存方案', { planChanged });
      }
      update.updated_at = new Date().toISOString();
      update.version = Number(current.version || 1) + 1;
      const saved = await patchOwnedDraft(user, id, current.version || 1, update);
      return json(res, 200, { draft: saved });
    }
    if (parts.length === 2 && parts[1] === 'history' && req.method === 'GET') {
      const current = await getDraft(user, id);
      return json(res, 200, { revisions: listRevisions(current), currentVersion: Number(current.version || 1) });
    }
    if (parts.length === 2 && parts[1] === 'restore' && req.method === 'POST') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      const restored = restoreRevision(current, body.revisionId);
      const history = appendRevision(current, '恢复历史版本');
      const approval = current.answer?.planApproval;
      const answer = { ...restored.answer, revisions: history.revisions };
      if (current.answer?.classroomRun) answer.classroomRun = clone(current.answer.classroomRun);
      if (current.answer?.classroomMomentTriage) answer.classroomMomentTriage = clone(current.answer.classroomMomentTriage);
      if (current.answer?.previousLessonCarryover) answer.previousLessonCarryover = clone(current.answer.previousLessonCarryover);
      if (current.answer?.questionRehearsal) answer.questionRehearsal = clone(current.answer.questionRehearsal);
      if (current.answer?.questionRehearsalHistory) answer.questionRehearsalHistory = clone(current.answer.questionRehearsalHistory);
      if (current.answer?.learningEvidence) answer.learningEvidence = clone(current.answer.learningEvidence);
      if (current.answer?.learningEvidenceHistory) answer.learningEvidenceHistory = clone(current.answer.learningEvidenceHistory);
      if (current.answer?.previousLessonHomeworkReview) answer.previousLessonHomeworkReview = clone(current.answer.previousLessonHomeworkReview);
      if (current.answer?.teachingDeliberation) answer.teachingDeliberation = clone(current.answer.teachingDeliberation);
      if (current.answer?.teachingDeliberationHistory) answer.teachingDeliberationHistory = clone(current.answer.teachingDeliberationHistory);
      if (current.answer?.teachingSlides) answer.teachingSlides = clone(current.answer.teachingSlides);
      if (current.answer?.layeredHomework) answer.layeredHomework = clone(current.answer.layeredHomework);
      if (current.answer?.homeworkReview) answer.homeworkReview = clone(current.answer.homeworkReview);
      if (current.answer?.homeworkReviewHistory) answer.homeworkReviewHistory = clone(current.answer.homeworkReviewHistory);
      if (approval?.confirmedSnapshot) answer.planApproval = { ...approval, status: 'changes_pending', hasUnconfirmedChanges: true };
      const saved = await patchOwnedDraft(user, id, current.version || 1, { ...restored, answer, updated_at: new Date().toISOString(), version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved });
    }
    if (parts.length === 1 && req.method === 'DELETE') {
      const current = await getDraft(user, id);
      assertCurrentVersion(current, requestVersion(req));
      const deleted = await userRest(user, 'lesson_drafts', { method: 'DELETE', query: query(user.id, { id: `eq.${id}`, version: `eq.${Number(current.version || 1)}` }) });
      if (!Array.isArray(deleted) || !deleted[0]) throw Object.assign(new Error('edit_conflict'), { code: 'edit_conflict', status: 409 });
      return json(res, 200, { ok: true, deleted: id });
    }
    if (parts.length === 2 && parts[1] === 'confirm' && req.method === 'POST') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      await assertCitationsTrusted(user, current.citations, current.lesson_context);
      const answer = confirmDraftPlan(current, { confirmedBy: user.id });
      answer.revisions = appendRevision(current, '确认教学方案').revisions;
      const saved = await patchOwnedDraft(user, id, current.version || 1, {
        answer,
        updated_at: new Date().toISOString(),
        version: Number(current.version || 1) + 1
      });
      return json(res, 200, { draft: saved });
    }
    if (parts[1] === 'cards' && parts.length === 2 && req.method === 'POST') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      const proposedCards = Array.isArray(body.cards) ? body.cards : [];
      assertLockedCardsUnchanged(current.cards, proposedCards);
      const cards = sanitizeClientCards(proposedCards, current.cards);
      const prepared = repairDraftForClassroom({ ...current, cards }).draft;
      const nextCards = prepared.cards || cards;
      const nextAnswer = answerWithCurrentRevision(current, current.answer, '保存课堂卡片');
      const saved = await patchOwnedDraft(user, id, current.version || 1, { cards: nextCards, answer: nextAnswer, updated_at: new Date().toISOString(), version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved });
    }
    if (parts[1] === 'cards' && parts[2] === 'generate' && parts.length === 3 && req.method === 'POST') {
      const current = await getDraft(user, id);
      const body = await readJson(req);
      assertCurrentVersion(current, requestVersion(req, body));
      await assertCitationsTrusted(user, current.citations, current.lesson_context);
      let deepseek = null;
      if (typeof body.keyId === 'string' && body.keyId.trim()) deepseek = await resolveActiveDeepSeekKey(user, body.keyId.trim());
      const generated = await generateDraftCards({ draft: current, deepseek });
      const saved = await patchOwnedDraft(user, id, current.version || 1, {
        cards: generated.cards,
        citations: generated.citations,
        answer: answerWithCurrentRevision(current, current.answer, '生成一课三卡'),
        updated_at: new Date().toISOString(),
        version: Number(current.version || 1) + 1
      });
      return json(res, 200, { draft: saved, generations: generated.generations });
    }
    if (parts[1] === 'cards' && parts[2] && parts.length >= 3) {
      const current = await getDraft(user, id);
      const body = req.method === 'PATCH' || req.method === 'POST' ? await readJson(req) : {};
      if (req.method === 'PATCH' || req.method === 'POST') assertCurrentVersion(current, requestVersion(req, body));
      const cardId = parts[2];
      const cards = Array.isArray(current.cards) ? current.cards.map(card => ({ ...card })) : [];
      const index = cards.findIndex(card => String(card?.id) === cardId);
      if (index < 0) throw Object.assign(new Error('card_not_found'), { code: 'card_not_found', status: 404 });
      const card = cards[index];
      if (card.status === 'locked' && !(req.method === 'POST' && parts[3] === 'lock')) throw Object.assign(new Error('card_locked'), { code: 'card_locked', status: 409 });
      if (req.method === 'POST' && parts[3] === 'lock') {
        cards[index] = { ...card, status: 'locked', updatedAt: new Date().toISOString() };
      } else if (req.method === 'POST' && parts[3] === 'regenerate') {
        await assertCitationsTrusted(user, current.citations, current.lesson_context);
        let deepseek = null;
        if (typeof body.keyId === 'string' && body.keyId.trim()) {
          deepseek = await resolveActiveDeepSeekKey(user, body.keyId.trim());
        }
        const generated = await regenerateDraftCard({
          draft: current,
          card,
          deepseek,
          focus: typeof body.focus === 'string' ? body.focus.trim().slice(0, 240) : ''
        });
        const saved = await patchOwnedDraft(user, id, current.version || 1, {
          cards: generated.cards,
          citations: generated.citations,
          answer: answerWithCurrentRevision(current, current.answer, '重新生成课堂卡'),
          updated_at: new Date().toISOString(),
          version: Number(current.version || 1) + 1
        });
        return json(res, 200, {
          draft: saved,
          generation: generated.generation,
          model: generated.model,
          generationRounds: generated.generationRounds,
          generationTrace: generated.generationTrace,
          qualityIssues: generated.qualityIssues
        });
      } else if (req.method === 'PATCH' && !parts[3]) {
        const { version: _version, ...cardUpdate } = body;
        cards[index] = {
          ...sanitizeClientCards([{ ...card, ...cardUpdate, id: card.id }], [card])[0],
          updatedAt: new Date().toISOString()
        };
      } else {
        res.setHeader('Allow', 'PATCH, POST');
        return json(res, 405, { ok: false, error: 'method_not_allowed' });
      }
      const prepared = repairDraftForClassroom({ ...current, cards }).draft;
      const nextCards = prepared.cards || cards;
      const saved = await patchOwnedDraft(user, id, current.version || 1, { cards: nextCards, answer: answerWithCurrentRevision(current, current.answer, parts[3] === 'lock' ? '锁定课堂卡片' : '保存课堂卡片'), updated_at: new Date().toISOString(), version: Number(current.version || 1) + 1 });
      return json(res, 200, { draft: saved });
    }
    return json(res, 404, { ok: false, error: 'route_not_found' });
  } catch (error) {
    return safeAuthResponse(res, error);
  }
}
