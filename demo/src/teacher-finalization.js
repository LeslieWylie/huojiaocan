const CACHE_PREFIX = 'huojiaocan.draft.recovery.v2';

function cleanId(value) {
  return String(value || '').trim();
}

export function draftRecoveryKey(userId, draftId) {
  const owner = cleanId(userId);
  const id = cleanId(draftId);
  return owner && id ? `${CACHE_PREFIX}.${encodeURIComponent(owner)}.${encodeURIComponent(id)}` : '';
}

export function writeDraftRecovery(storage, userId, draftId, draft, cards = draft?.cards, now = new Date()) {
  const key = draftRecoveryKey(userId, draftId);
  if (!key || !storage || !draft) return false;
  const payload = {
    ownerUserId: cleanId(userId),
    draft: { ...draft, cards: undefined },
    cards: Array.isArray(cards) ? cards : [],
    savedAt: now.toISOString()
  };
  storage.setItem(key, JSON.stringify(payload));
  return true;
}

export function readDraftRecovery(storage, userId, draftId) {
  const key = draftRecoveryKey(userId, draftId);
  if (!key || !storage) return null;
  try {
    const value = JSON.parse(storage.getItem(key) || 'null');
    if (cleanId(value?.ownerUserId) !== cleanId(userId) || !value?.draft || !Array.isArray(value.cards)) return null;
    return { ...value, draft: { ...value.draft, cards: value.cards } };
  } catch {
    return null;
  }
}

// Ask responses may contain model suggestions for preview. They are not
// teacher-approved classroom cards. Only preserve cards that already belong
// to an older/saved draft; a new draft starts with no final cards.
export function cardsForAskDraft(existingDraft) {
  return Array.isArray(existingDraft?.cards) ? existingDraft.cards : [];
}

function textList(value) {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.map(item => typeof item === 'string' ? item : item?.text || item?.title || item?.question || '').filter(Boolean).join('\n');
}

function firstList(...values) {
  for (const value of values) {
    const result = textList(value);
    if (result) return result;
  }
  return '';
}

function usefulSummary(draft, answer) {
  const source = String(answer.summary || answer.reply || '').trim();
  if (source && !/围绕[“”"']?(?:这篇|本篇|当前篇目).{0,10}(?:怎么|如何|怎样)?备课/u.test(source)) return source;
  const lesson = String(answer.lesson?.title || draft.title || '').trim();
  const steps = (Array.isArray(answer.lessonPlan) ? answer.lessonPlan : [])
    .map(item => String(item?.title || '').trim()).filter(Boolean).slice(0, 4);
  if (lesson && steps.length) return `${lesson}围绕“${steps.join('—')}”组织课堂，具体内容请结合下方教材依据核对。`;
  return source;
}

function parseTextList(value) {
  return String(value || '').split(/\n+/u).map(item => item.replace(/^\s*[-•]\s*/u, '').trim()).filter(Boolean);
}

export function planFormFromDraft(draft = {}) {
  const answer = draft.answer && typeof draft.answer === 'object' ? draft.answer : {};
  const context = draft.lesson_context || draft.lessonContext || {};
  return {
    title: String(draft.title || answer.lesson?.title || ''),
    summary: usefulSummary(draft, answer),
    objectives: firstList(answer.objectives, answer.teachingObjectives, answer.goals),
    keyPoints: firstList(answer.keyPoints, answer.keyDifficulties, answer.difficulties),
    periods: String(context.periods || 1),
    className: String(context.className || ''),
    classLevel: String(context.classLevel || '普通'),
    teachingGoal: String(context.teachingGoal || ''),
    teachingMode: String(context.teachingMode || '探究')
  };
}

export function applyPlanForm(draft = {}, form = {}) {
  const answer = draft.answer && typeof draft.answer === 'object' ? draft.answer : {};
  const context = draft.lesson_context || draft.lessonContext || {};
  return {
    title: String(form.title || '').trim() || draft.title || '未命名备课',
    answer: {
      ...answer,
      summary: String(form.summary || '').trim(),
      objectives: parseTextList(form.objectives),
      keyPoints: parseTextList(form.keyPoints)
    },
    lessonContext: {
      ...context,
      periods: Math.max(1, Number.parseInt(form.periods, 10) || 1),
      className: String(form.className || '').trim().slice(0, 40),
      classLevel: String(form.classLevel || '').trim() || '普通',
      teachingGoal: String(form.teachingGoal || '').trim(),
      teachingMode: String(form.teachingMode || '').trim() || '探究'
    }
  };
}

export function isTeacherConfirmed(draft = {}) {
  const answer = draft?.answer && typeof draft.answer === 'object' ? draft.answer : {};
  const marker = answer.planApproval || answer.teacherFinalization || answer.planConfirmation || draft?.teacher_finalization;
  return marker === true || (marker?.status === 'confirmed' && marker?.hasUnconfirmedChanges !== true)
    || Boolean((marker?.confirmedAt || marker?.confirmed_at) && marker?.hasUnconfirmedChanges !== true);
}

export function deriveTeacherDraftState({ draft, cards, dirty = false } = {}) {
  const list = Array.isArray(cards) ? cards : Array.isArray(draft?.cards) ? draft.cards : [];
  const cardsGenerated = list.length > 0;
  const cardLocked = list.some(card => card?.status === 'locked');
  const hasApprovalContract = Boolean(draft?.answer?.planApproval);
  const copiedEditableVersion = Boolean(draft?.answer?.assetMeta?.copiedFrom);
  const teacherConfirmed = isTeacherConfirmed(draft)
    || (!hasApprovalContract && cardsGenerated && !copiedEditableVersion);
  return {
    planDraft: Boolean(draft) && !teacherConfirmed,
    unsavedChanges: Boolean(dirty),
    teacherConfirmed,
    cardsGenerated,
    cardLocked
  };
}
