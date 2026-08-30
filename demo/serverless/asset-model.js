import { classroomRunHasContent, normalizeClassroomRun } from '../shared/classroom-run.js';
import { questionRehearsalIsStale } from '../shared/question-rehearsal.js';
import { learningEvidenceContext, learningEvidenceIsStale, learningEvidenceSummary } from '../shared/learning-evidence.js';
import { teachingDeliberationIsStale } from '../shared/teaching-deliberation.js';
import { lessonStudyIsStale, normalizeLessonStudy } from '../shared/lesson-study.js';
import { homeworkReviewContext, homeworkReviewIsStale } from '../shared/homework-review.js';

function stripConfirmedSnapshots(value) {
  if (Array.isArray(value)) {
    for (const item of value) stripConfirmedSnapshots(item);
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  delete value.confirmedSnapshot;
  for (const item of Object.values(value)) stripConfirmedSnapshots(item);
  return value;
}

export function assetFromDraft(draft = {}) {
  const meta = draft.answer?.assetMeta || {};
  const approval = draft.answer?.planApproval && typeof draft.answer.planApproval === 'object'
    ? draft.answer.planApproval
    : null;
  const cards = Array.isArray(draft.cards) ? draft.cards : [];
  const hasUnconfirmedChanges = Boolean(approval?.hasUnconfirmedChanges);
  const teacherConfirmed = Boolean(
    approval?.status === 'confirmed'
    && approval?.confirmedSnapshot
    && !hasUnconfirmedChanges
  );
  const cardsGenerated = cards.length > 0;
  const lockedCardsCount = cards.filter(card => card?.status === 'locked').length;
  const workflowStatus = hasUnconfirmedChanges
    ? 'changes_pending'
    : lockedCardsCount > 0
      ? 'cards_locked'
      : cardsGenerated
        ? 'cards_generated'
        : teacherConfirmed
          ? 'teacher_confirmed'
          : 'draft';
  // Asset list/detail responses only need confirmation state. Complete
  // teacher-confirmed snapshots, including historical nested copies, remain
  // available only from the owned draft/version endpoints.
  const answer = stripConfirmedSnapshots(clone(draft.answer || {}));
  delete answer.classroomRun;
  delete answer.questionRehearsal;
  delete answer.questionRehearsalHistory;
  delete answer.learningEvidence;
  delete answer.learningEvidenceHistory;
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
  const feedbackSource = draft.answer?.lessonReflection || draft.answer?.teachingFeedback;
  const feedback = feedbackSource && typeof feedbackSource === 'object'
    ? clone(feedbackSource)
    : null;
  const hasReflection = Boolean(feedback && [
    feedback.unresolvedLearning ?? feedback.unfinishedQuestions,
    feedback.pacingNotes ?? feedback.timeManagement,
    feedback.observedLearning ?? feedback.classResponse,
    feedback.nextLessonAdjustment ?? feedback.nextStep,
    ...(Array.isArray(feedback.cardUsage) ? feedback.cardUsage : Array.isArray(feedback.usedCards) ? feedback.usedCards : [])
  ].some(value => String(value || '').trim()));
  const classroomRun = normalizeClassroomRun(draft.answer?.classroomRun || {});
  const hasClassroomRecord = classroomRunHasContent(classroomRun) || ['pending_review', 'confirmed'].includes(classroomRun.status);
  const learningEvidence = draft.answer?.learningEvidence;
  const learningSummary = learningEvidence ? learningEvidenceSummary(learningEvidence) : null;
  const lessonStudy = normalizeLessonStudy(draft.answer?.lessonStudy || {});
  const hasLessonStudy = Boolean(lessonStudy.sourceKey);
  return {
    id: `draft:${draft.id}`,
    assetKey: meta.assetKey || draft.id,
    draftId: draft.id,
    title: draft.title || draft.question || '未命名备课',
    lessonKey: meta.lessonKey || draft.answer?.lesson?.title || draft.title || '',
    // The row version is the CAS token. assetMeta.version is retained only as
    // a legacy fallback for older records that do not expose a row version.
    version: Number(draft.version || meta.version || 1),
    status: meta.status || 'draft',
    favorite: Boolean(meta.favorite),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    updatedAt: draft.updated_at || draft.updatedAt || null,
    createdAt: draft.created_at || draft.createdAt || null,
    sourceCoverage: draft.answer?.sourceCoverage || null,
    citationsCount: Array.isArray(draft.citations) ? draft.citations.length : 0,
    teacherConfirmed,
    hasUnconfirmedChanges,
    cardsGenerated,
    lockedCardsCount,
    workflowStatus,
    hasReflection,
    hasClassroomRecord,
    rehearsalStatus: draft.answer?.questionRehearsal?.status || 'none',
    rehearsalStale: questionRehearsalIsStale(draft),
    learningEvidenceStatus: learningEvidence?.status || 'none',
    learningEvidenceStale: learningEvidenceIsStale(draft),
    learningEvidenceSummary: learningSummary && learningSummary.itemCount ? learningSummary : null,
    deliberationStatus: draft.answer?.teachingDeliberation?.status || 'none',
    deliberationStale: teachingDeliberationIsStale(draft),
    lessonStudyStatus: hasLessonStudy ? lessonStudy.status : 'none',
    lessonStudyStale: hasLessonStudy ? lessonStudyIsStale(draft) : false,
    lessonStudySummary: hasLessonStudy ? {
      decision: lessonStudy.conclusion.decision,
      finding: lessonStudy.conclusion.finding.slice(0, 240),
      nextTrial: lessonStudy.conclusion.nextTrial.slice(0, 240),
      confirmedAt: lessonStudy.confirmedAt
    } : null,
    sameLessonComparisonCount: (Array.isArray(draft.answer?.sameLessonComparisons) ? draft.answer.sameLessonComparisons : [])
      .filter(item => item?.status === 'confirmed').length,
    classroomStatus: classroomRun.status,
    classroomRecord: hasClassroomRecord ? {
      currentStage: classroomRun.currentStage,
      stagesCount: classroomRun.stages.length,
      keywordsCount: classroomRun.keywords.length,
      usedCards: classroomRun.usedCards,
      endedAt: classroomRun.endedAt
    } : null,
    reflection: hasReflection ? {
      unresolvedLearning: String(feedback.unresolvedLearning ?? feedback.unfinishedQuestions ?? '').slice(0, 240),
      pacingNotes: String(feedback.pacingNotes ?? feedback.timeManagement ?? '').slice(0, 240),
      observedLearning: String(feedback.observedLearning ?? feedback.classResponse ?? '').slice(0, 240),
      nextLessonAdjustment: String(feedback.nextLessonAdjustment ?? feedback.nextStep ?? '').slice(0, 240),
      cardUsage: (Array.isArray(feedback.cardUsage) ? feedback.cardUsage : Array.isArray(feedback.usedCards) ? feedback.usedCards : []).map(item => String(item || '').slice(0, 80)).filter(Boolean).slice(0, 6)
    } : null,
    content: { answer, cards, citations: draft.citations || [] }
  };
}

export function filterAssets(items, { query = '', favorite = false, tag = '' } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  return (Array.isArray(items) ? items : []).filter(item => {
    if (favorite && !item.favorite) return false;
    if (tag && !(item.tags || []).includes(tag)) return false;
    if (!needle) return true;
    return [item.title, item.lessonKey, ...(item.tags || [])].some(value => String(value || '').toLowerCase().includes(needle));
  });
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

/** Prepare an owned draft as a new editable asset without copying history or lock state. */
export function copyDraftForReuse(draft, { title, useFeedback = false } = {}) {
  const sourceAnswer = draft?.answer && typeof draft.answer === 'object' ? clone(draft.answer) : {};
  delete sourceAnswer.revisions;
  // A copied plan is a reusable teaching asset, not a continuation of the
  // old private conversation. Keep the verified citations, but start a clean
  // thread so old prompts cannot leak into the next lesson.
  delete sourceAnswer.conversationHistory;
  delete sourceAnswer.conversationTurns;
  delete sourceAnswer.evidenceShelf;
  delete sourceAnswer.planApproval;
  const reflectionSource = sourceAnswer.lessonReflection || sourceAnswer.teachingFeedback;
  const teachingFeedback = reflectionSource && typeof reflectionSource === 'object'
    ? clone(reflectionSource)
    : null;
  delete sourceAnswer.teachingFeedback;
  delete sourceAnswer.lessonReflection;
  delete sourceAnswer.previousLessonReflection;
  delete sourceAnswer.classroomRun;
  delete sourceAnswer.classroomMomentTriage;
  delete sourceAnswer.previousLessonCarryover;
  delete sourceAnswer.questionRehearsal;
  delete sourceAnswer.questionRehearsalHistory;
  const learningContext = learningEvidenceIsStale(draft) ? null : learningEvidenceContext(sourceAnswer.learningEvidence);
  const reviewContext = homeworkReviewIsStale(draft) ? null : homeworkReviewContext(sourceAnswer.homeworkReview);
  delete sourceAnswer.learningEvidence;
  delete sourceAnswer.learningEvidenceHistory;
  delete sourceAnswer.previousLessonLearningEvidence;
  delete sourceAnswer.previousLessonHomeworkReview;
  delete sourceAnswer.teachingDeliberation;
  delete sourceAnswer.teachingDeliberationHistory;
  delete sourceAnswer.lessonStudy;
  delete sourceAnswer.lessonStudyHistory;
  delete sourceAnswer.sameLessonComparisons;
  delete sourceAnswer.sameLessonComparisonHistory;
  delete sourceAnswer.teachingSlides;
  delete sourceAnswer.layeredHomework;
  delete sourceAnswer.homeworkReview;
  delete sourceAnswer.homeworkReviewHistory;
  if (useFeedback && teachingFeedback) {
    sourceAnswer.previousLessonReflection = {
      sourceDraftId: draft?.id || null,
      sourceVersion: Number(draft?.version || 1),
      recordedAt: new Date().toISOString(),
      feedback: teachingFeedback
    };
  }
  if (useFeedback && learningContext) {
    sourceAnswer.previousLessonLearningEvidence = {
      sourceDraftId: draft?.id || null,
      sourceVersion: Number(draft?.version || 1),
      recordedAt: new Date().toISOString(),
      summary: learningContext
    };
  }
  if (useFeedback && reviewContext) {
    sourceAnswer.previousLessonHomeworkReview = {
      sourceDraftId: draft?.id || null,
      sourceVersion: Number(draft?.version || 1),
      recordedAt: new Date().toISOString(),
      summary: reviewContext
    };
  }
  const sourceMeta = sourceAnswer.assetMeta && typeof sourceAnswer.assetMeta === 'object' ? sourceAnswer.assetMeta : {};
  sourceAnswer.assetMeta = {
    ...sourceMeta,
    status: 'draft',
    favorite: false,
    tags: [],
    version: 1,
    copiedFrom: draft?.id || null,
    copiedAt: new Date().toISOString()
  };
  delete sourceAnswer.assetMeta.assetKey;
  const cards = (Array.isArray(draft?.cards) ? draft.cards : []).map(card => {
    const next = clone(card) || {};
    next.status = 'draft';
    for (const key of Object.keys(next)) {
      if (/^sourceConfirmed/u.test(key) || /^(?:locked|lock)(?:At|By|Version|Reason)?$/u.test(key)) delete next[key];
    }
    return next;
  });
  return {
    title: String(title || '').trim() || `${draft?.title || draft?.question || '未命名备课'}${useFeedback ? '（复备）' : '（副本）'}`,
    question: draft?.question || '',
    scope: clone(draft?.scope || []),
    lesson_context: clone(draft?.lesson_context || draft?.lessonContext || {}),
    answer: sourceAnswer,
    citations: clone(draft?.citations || []),
    cards,
    version: 1
  };
}
