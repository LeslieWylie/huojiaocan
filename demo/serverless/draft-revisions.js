import { teachingDeliberationContextForDraft } from '../shared/teaching-deliberation.js';

const MAX_REVISIONS = 20;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function requestError(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

const PRIVATE_OR_HISTORICAL_KEY = /(?:^|_)(?:revisions?|history|conversation|messages?|turns?|api[-_]?key|secret|token|password|credential)(?:$|_)/iu;

function privateOrHistoricalKey(key) {
  const normalized = String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return PRIVATE_OR_HISTORICAL_KEY.test(normalized);
}

function safeSnapshotValue(value) {
  if (Array.isArray(value)) return value.map(safeSnapshotValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'planApproval' && !privateOrHistoricalKey(key))
    .map(([key, item]) => [key, safeSnapshotValue(item)]));
}

function usefulText(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!value || typeof value !== 'object') return false;
  return ['text', 'title', 'question', 'content', 'task', 'standard'].some(key => String(value[key] || '').trim());
}

function validPlanCitation(value) {
  const type = String(value?.documentType || value?.sourceType || value?.type || '')
    .trim().toLowerCase().replaceAll('_', '-');
  const page = Number(value?.pdfPage ?? value?.pageNumber ?? value?.page);
  return ['textbook', 'student-textbook', 'student-book', 'teacher-guide', 'teacher-guidebook', 'guide', 'curriculum-standard', 'curriculum', 'standard', 'course-standard'].includes(type)
    && String(value?.documentId || '').trim().length > 0
    && Number.isInteger(page) && page > 0
    && String(value?.quote || value?.text || '').trim().length > 0;
}

export function requireDraftVersion(value) {
  if (value === undefined || value === null || value === '') throw requestError('version_required', 400);
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw requestError('version_required', 400);
  return version;
}

export function assertConfirmableDraft(draft) {
  const answer = draft?.answer && typeof draft.answer === 'object' ? draft.answer : {};
  const complete = String(answer.summary || '').trim()
    && Array.isArray(answer.lessonPlan) && answer.lessonPlan.some(usefulText)
    && Array.isArray(answer.questionChain) && answer.questionChain.some(usefulText)
    && Array.isArray(answer.assessment) && answer.assessment.some(usefulText);
  if (!complete) throw requestError('plan_incomplete', 422);
  const citations = (Array.isArray(draft?.citations) ? draft.citations : []).filter(validPlanCitation);
  if (!citations.length) throw requestError('evidence_insufficient', 422);
  return citations;
}

export function confirmDraftPlan(draft, { confirmedBy, confirmedAt = new Date().toISOString() } = {}) {
  const citations = assertConfirmableDraft(draft);
  const answer = clone(draft.answer);
  const revisions = Array.isArray(answer.revisions) ? answer.revisions : [];
  const plan = safeSnapshotValue(answer);
  const confirmedTeachingChoices = teachingDeliberationContextForDraft(draft);
  delete plan.revisions;
  delete plan.planApproval;
  delete plan.questionRehearsal;
  delete plan.questionRehearsalHistory;
  delete plan.learningEvidence;
  delete plan.learningEvidenceHistory;
  delete plan.teachingDeliberation;
  delete plan.teachingDeliberationHistory;
  if (confirmedTeachingChoices) plan.confirmedTeachingChoices = safeSnapshotValue(confirmedTeachingChoices);
  answer.revisions = revisions;
  answer.planApproval = {
    status: 'confirmed',
    hasUnconfirmedChanges: false,
    confirmedSnapshot: {
      plan,
      conditions: safeSnapshotValue({
        title: draft?.title || '',
        question: draft?.question || '',
        scope: clone(draft?.scope || []),
        lessonContext: clone(draft?.lesson_context || draft?.lessonContext || {})
      }),
      citations: safeSnapshotValue(citations)
    },
    confirmedVersion: Number(draft?.version || 1),
    confirmedAt,
    confirmedBy: String(confirmedBy || '')
  };
  return answer;
}

export function confirmedDraftContext(draft) {
  const approval = draft?.answer?.planApproval;
  const snapshot = approval?.confirmedSnapshot;
  if (!snapshot || !snapshot.plan || !snapshot.conditions || !Array.isArray(snapshot.citations) || !snapshot.citations.some(validPlanCitation)) {
    throw requestError('plan_confirmation_required', 409);
  }
  return {
    snapshot: clone(snapshot),
    confirmedVersion: Number(approval.confirmedVersion),
    confirmedAt: String(approval.confirmedAt || ''),
    confirmedBy: String(approval.confirmedBy || '')
  };
}

export function answerWithCurrentRevision(current, nextAnswer, reason = '保存方案', { planChanged = false } = {}) {
  const answer = nextAnswer && typeof nextAnswer === 'object' ? clone(nextAnswer) : {};
  const history = appendRevision(current, reason);
  answer.revisions = history.revisions;
  const approval = current?.answer?.planApproval;
  if (approval?.confirmedSnapshot) {
    answer.planApproval = clone(approval);
    if (planChanged) {
      answer.planApproval.status = 'changes_pending';
      answer.planApproval.hasUnconfirmedChanges = true;
    }
  } else {
    delete answer.planApproval;
  }
  return answer;
}

function revisionId() {
  return `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Keep version history inside the existing lesson_drafts.answer JSON. */
export function appendRevision(draft, reason = '保存方案') {
  const answer = draft?.answer && typeof draft.answer === 'object' ? clone(draft.answer) : {};
  const revisions = Array.isArray(answer.revisions) ? answer.revisions.filter(item => item && item.snapshot) : [];
  const snapshot = {
    snapshot: true,
    id: revisionId(),
    reason,
    createdAt: new Date().toISOString(),
    version: Number(draft?.version || 1),
    title: draft?.title || '',
    question: draft?.question || '',
    scope: clone(draft?.scope || []),
    lessonContext: clone(draft?.lesson_context || draft?.lessonContext || {}),
    answer: (() => { const next = clone(answer); delete next.revisions; delete next.classroomRun; delete next.classroomMomentTriage; delete next.previousLessonCarryover; delete next.questionRehearsal; delete next.questionRehearsalHistory; delete next.learningEvidence; delete next.learningEvidenceHistory; delete next.teachingDeliberation; delete next.teachingDeliberationHistory; return next; })(),
    citations: clone(draft?.citations || []),
    cards: clone(draft?.cards || [])
  };
  answer.revisions = [snapshot, ...revisions].slice(0, MAX_REVISIONS);
  return answer;
}

export function listRevisions(draft) {
  return Array.isArray(draft?.answer?.revisions)
    ? draft.answer.revisions.map(({ answer, cards, citations, scope, lessonContext, snapshot, ...item }) => item)
    : [];
}

function valueAt(source, path) {
  return String(path || '').split('.').reduce((value, key) => value == null ? undefined : value[key], source);
}

function compactValue(value, { max = 120 } = {}) {
  if (value == null || value === '') return '未填写';
  if (Array.isArray(value)) {
    const count = value.length;
    const sample = value.slice(0, 2).map(item => typeof item === 'string' ? item : item?.title || item?.text || item?.question || '').filter(Boolean).join('；');
    return `${count} 项${sample ? `：${sample.slice(0, max)}` : ''}`;
  }
  if (typeof value === 'object') return JSON.stringify(value).slice(0, max);
  return String(value).slice(0, max);
}

function changedValue(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/** Return a safe, compact comparison; never expose full revision JSON by default. */
export function compareRevision(draft, id) {
  const revision = Array.isArray(draft?.answer?.revisions)
    ? draft.answer.revisions.find(item => String(item?.id) === String(id))
    : null;
  if (!revision) throw Object.assign(new Error('revision_not_found'), { code: 'revision_not_found', status: 404 });
  const current = {
    title: draft?.title || '',
    lessonContext: draft?.lesson_context || draft?.lessonContext || {},
    answer: draft?.answer && typeof draft.answer === 'object' ? draft.answer : {},
    cards: Array.isArray(draft?.cards) ? draft.cards : []
  };
  const historical = {
    title: revision.title || '',
    lessonContext: revision.lessonContext || {},
    answer: revision.answer && typeof revision.answer === 'object' ? revision.answer : {},
    cards: Array.isArray(revision.cards) ? revision.cards : []
  };
  const fields = [
    ['title', '方案标题'],
    ['lessonContext.periods', '课时'],
    ['lessonContext.className', '任教班级'],
    ['lessonContext.classLevel', '班级水平'],
    ['lessonContext.teachingGoal', '教学目标'],
    ['lessonContext.teachingMode', '教学方式'],
    ['answer.summary', '方案概述'],
    ['answer.objectives', '教学目标内容'],
    ['answer.keyPoints', '重点与难点'],
    ['answer.lessonPlan', '课堂流程'],
    ['answer.questionChain', '问题链'],
    ['answer.homework', '课后延伸'],
    ['answer.assessment', '课堂评价'],
    ['cards', '一课三卡']
  ];
  const changes = fields.filter(([path]) => changedValue(valueAt(historical, path), valueAt(current, path))).map(([path, label]) => ({
    field: path,
    label,
    before: compactValue(valueAt(historical, path)),
    after: compactValue(valueAt(current, path))
  }));
  return {
    revision: { id: revision.id, version: revision.version, reason: revision.reason, createdAt: revision.createdAt },
    current: { version: Number(draft?.version || 1), title: draft?.title || '' },
    changed: changes.length > 0,
    changes
  };
}

export function restoreRevision(draft, id) {
  const revision = Array.isArray(draft?.answer?.revisions)
    ? draft.answer.revisions.find(item => String(item?.id) === String(id))
    : null;
  if (!revision) throw Object.assign(new Error('revision_not_found'), { code: 'revision_not_found', status: 404 });
  const locked = (Array.isArray(draft.cards) ? draft.cards : []).filter(card => card?.status === 'locked');
  const restoredCards = clone(revision.cards || []);
  for (const card of locked) {
    const index = restoredCards.findIndex(item => String(item?.id) === String(card.id));
    // A historical snapshot is allowed to predate a lock. Restoring it must
    // never erase the teacher's confirmed card, so the current locked value
    // wins while the other cards return to the selected snapshot.
    if (index < 0) restoredCards.push(clone(card));
    else restoredCards[index] = clone(card);
  }
  return {
    title: revision.title,
    question: revision.question,
    scope: revision.scope || [],
    lesson_context: revision.lessonContext || {},
    answer: revision.answer || {},
    citations: revision.citations || [],
    cards: restoredCards
  };
}
