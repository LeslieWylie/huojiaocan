const ANSWER_STATE_KEYS = new Set([
  'assetMeta',
  'classAdaptation',
  'conversationHistory',
  'conversationTurns',
  'evidenceShelf',
  'planApproval',
  'planConfirmation',
  'teacherFinalization',
  'revisions',
  'previousLessonCarryover',
  'questionRehearsal',
  'questionRehearsalHistory',
  'preClassPulse',
  'preClassPulseHistory',
  'teachingDeliberation',
  'teachingDeliberationHistory',
  'lessonStudy',
  'lessonStudyHistory',
  'sameLessonComparisons',
  'sameLessonComparisonHistory',
  'teachingSlides',
  'layeredHomework',
  'teachingFeedback',
  'previousLessonReflection',
  'previousLessonLearningEvidence',
  'previousLessonHomeworkReview'
]);

const ROOT_IDENTITY_KEYS = new Set([
  'id',
  'user_id',
  'userId',
  'created_at',
  'updated_at',
  'createdAt',
  'updatedAt'
]);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function sourceClassStateKey(key) {
  const normalized = String(key).replace(/[^a-z0-9]/giu, '').toLowerCase();
  return normalized.startsWith('classroom')
    || normalized === 'conversationhistory'
    || normalized === 'conversationturns'
    || normalized === 'evidenceshelf'
    || normalized === 'planapproval'
    || normalized === 'revisions'
    || normalized.includes('reflection')
    || normalized === 'homework'
    || normalized === 'assignments'
    || normalized.startsWith('homework')
    || normalized.includes('learningevidence')
    || normalized.includes('classlearning')
    || normalized.includes('classprofile')
    || normalized.includes('classsituation')
    || normalized.includes('classstate')
    || normalized.includes('classhistory')
    || normalized.includes('classaggregate')
    || normalized.includes('classevidence')
    || normalized.includes('classrecord')
    || normalized.includes('studentprofile')
    || normalized.includes('studentsituation')
    || normalized.includes('studentstate')
    || normalized.includes('studenthistory')
    || normalized.includes('studentaggregate')
    || normalized.includes('studentevidence')
    || normalized.includes('studentrecord')
    || normalized.includes('studentdata')
    || normalized.includes('learningsituation');
}

function stripSourceClassState(value, explicitKeys = new Set()) {
  const result = value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
  for (const key of Object.keys(result)) {
    if (explicitKeys.has(key) || sourceClassStateKey(key)) delete result[key];
  }
  return result;
}

function targetLessonContext(sourceDraft, targetClassProfile) {
  const source = sourceDraft?.lesson_context || sourceDraft?.lessonContext || {};
  const context = stripSourceClassState(source);
  context.className = String(targetClassProfile?.className ?? '').trim();
  context.classLevel = String(targetClassProfile?.classLevel ?? '').trim();
  return context;
}

function editableCards(value) {
  return (Array.isArray(value) ? value : []).map(card => {
    const next = clone(card && typeof card === 'object' ? card : {});
    const removeLockMetadata = item => {
      if (Array.isArray(item)) {
        for (const child of item) removeLockMetadata(child);
        return;
      }
      if (!item || typeof item !== 'object') return;
      for (const key of Object.keys(item)) {
        if (/^(?:lock|locked|sourceConfirmed)/iu.test(key)) delete item[key];
        else removeLockMetadata(item[key]);
      }
    };
    removeLockMetadata(next);
    next.status = 'draft';
    return next;
  });
}

function createdAt(options) {
  const supplied = typeof options?.now === 'function' ? options.now() : options?.now;
  return supplied == null ? new Date().toISOString() : String(supplied);
}

/**
 * Starts an editable draft for another class while carrying over only the
 * lesson design and its source-backed evidence.
 */
export function buildClassAdaptedDraft(sourceDraft, targetClassProfile, options = {}) {
  const source = sourceDraft && typeof sourceDraft === 'object' ? sourceDraft : {};
  const draft = stripSourceClassState(source, ROOT_IDENTITY_KEYS);
  const answer = stripSourceClassState(source.answer, ANSWER_STATE_KEYS);
  const sourceContext = source.lesson_context || source.lessonContext || {};

  delete draft.lessonContext;
  draft.version = 1;
  draft.scope = clone(source.scope || []);
  draft.lesson_context = targetLessonContext(source, targetClassProfile);
  draft.answer = answer;
  draft.citations = clone(Array.isArray(source.citations) ? source.citations : []);
  draft.cards = editableCards(source.cards);
  draft.answer.classAdaptation = {
    sourceDraftId: source.id == null ? null : String(source.id),
    sourceVersion: Number.isFinite(Number(source.version)) ? Number(source.version) : 1,
    sourceClassName: String(sourceContext?.className ?? '').trim(),
    targetClassName: String(targetClassProfile?.className ?? '').trim(),
    ...(options?.operationId ? { operationId: String(options.operationId).trim().slice(0, 120) } : {}),
    createdAt: createdAt(options)
  };
  return draft;
}
