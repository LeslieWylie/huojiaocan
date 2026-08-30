import { questionRehearsalIsStale } from './question-rehearsal.js';

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function text(value, max = 800) {
  return String(value || '').trim().slice(0, max);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function count(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(number, 200) : 0;
}

function normalizeQuestionItems(card = {}) {
  const source = Array.isArray(card.items) ? card.items : Array.isArray(card.content) ? card.content : [];
  return source.map((item, index) => typeof item === 'string'
    ? { id: `${card.id || card.type || 'question'}-legacy-${index}`, text: item, citationIds: [] }
    : { ...item, id: item?.id || `${card.id || card.type || 'question'}-${index}` });
}

function sourceQuestions(draft = {}) {
  const validCitationIds = new Set((Array.isArray(draft.citations) ? draft.citations : []).map((item, index) => String(item?.id || item?.citationId || `citation-${index}`)));
  const citations = value => (Array.isArray(value) ? value : []).map(id => text(id, 120)).filter(id => id && validCitationIds.has(id)).slice(0, 4);
  const rehearsal = draft.answer?.questionRehearsal;
  if (rehearsal?.status === 'confirmed' && Array.isArray(rehearsal.steps) && rehearsal.steps.length && !questionRehearsalIsStale(draft)) {
    return rehearsal.steps.slice(0, 8).map((item, index) => ({
      id: text(item.id || `rehearsal-${index}`, 120),
      prompt: text(item.question, 500),
      citationIds: citations(item.citationIds)
    })).filter(item => item.prompt);
  }
  const questionCard = (Array.isArray(draft.cards) ? draft.cards : []).find(card => card?.type === 'question');
  return normalizeQuestionItems(questionCard).slice(0, 8).map((item, index) => ({
    id: text(item.id || `question-${index}`, 120),
    prompt: text(item.text || item.question || item.title, 500),
    citationIds: citations(item.citationIds)
  })).filter(item => item.prompt);
}

function citationFingerprint(draft, ids = []) {
  const citations = Array.isArray(draft.citations) ? draft.citations : [];
  const byId = new Map(citations.map((item, index) => [String(item.id || item.citationId || `citation-${index}`), item]));
  return ids.map(id => {
    const item = byId.get(String(id)) || {};
    return [
      id,
      item.documentId || item.document_id || item.documentType || '',
      item.pdfPage || item.pdf_page || item.page || '',
      text(item.quote || item.text, 180)
    ];
  });
}

export function learningEvidenceSourceKey(draft = {}) {
  const sources = sourceQuestions(draft).map(item => [item.id, item.prompt, citationFingerprint(draft, item.citationIds)]);
  const serialized = JSON.stringify(sources);
  return `v1:${stableHash(serialized)}${stableHash(serialized.split('').reverse().join(''))}`;
}

export function emptyLearningEvidence() {
  return { version: 1, status: 'draft', sourceSchemaVersion: 1, sourceKey: '', entries: [], updatedAt: null, confirmedAt: null };
}

export function normalizeLearningEvidence(value = {}) {
  const entries = (Array.isArray(value.entries) ? value.entries : []).slice(0, 8).map((item, index) => ({
    id: text(item?.id || `learning-${index}`, 120),
    questionId: text(item?.questionId || item?.sourceQuestionId || `question-${index}`, 120),
    prompt: text(item?.prompt || item?.question, 500),
    citationIds: Array.isArray(item?.citationIds) ? item.citationIds.map(id => text(id, 120)).filter(Boolean).slice(0, 4) : [],
    assignedCount: count(item?.assignedCount),
    submittedCount: count(item?.submittedCount),
    secureCount: count(item?.secureCount),
    partialCount: count(item?.partialCount),
    notYetCount: count(item?.notYetCount ?? item?.blockedCount),
    observedPattern: text(item?.observedPattern || item?.misconception, 320),
    teacherAction: text(item?.teacherAction || item?.nextAction, 400)
  })).filter(item => item.prompt);
  return {
    version: 1,
    status: value.status === 'confirmed' ? 'confirmed' : 'draft',
    sourceSchemaVersion: 1,
    sourceKey: text(value.sourceKey, 80),
    entries,
    updatedAt: value.updatedAt || null,
    confirmedAt: value.confirmedAt || null
  };
}

export function buildLearningEvidence(draft = {}, now = new Date().toISOString()) {
  const questions = sourceQuestions(draft);
  if (!questions.length) {
    const error = new Error('learning_evidence_questions_required');
    error.code = 'learning_evidence_questions_required';
    throw error;
  }
  return normalizeLearningEvidence({
    status: 'draft',
    sourceKey: learningEvidenceSourceKey(draft),
    updatedAt: now,
    entries: questions.map((item, index) => ({
      id: `learning-${index + 1}-${stableHash(item.id)}`,
      questionId: item.id,
      prompt: item.prompt,
      citationIds: item.citationIds
    }))
  });
}

function hasSensitiveIdentifiers(value) {
  const input = String(value || '');
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(input)
    || /(?:^|\D)1[3-9]\d{9}(?:\D|$)/u.test(input)
    || /(?:^|\D)\d{6,18}(?:\D|$)/u.test(input);
}

export function learningEvidenceProgress(value = {}) {
  const evidence = normalizeLearningEvidence(value);
  const completed = evidence.entries.filter(item => item.assignedCount > 0 && item.submittedCount > 0 && item.secureCount + item.partialCount + item.notYetCount === item.submittedCount).length;
  return { total: evidence.entries.length, completed, ready: completed > 0 };
}

function assertCounts(item) {
  const classified = item.secureCount + item.partialCount + item.notYetCount;
  if (item.assignedCount < item.submittedCount || item.submittedCount !== classified) {
    const error = new Error('learning_evidence_counts_invalid');
    error.code = 'learning_evidence_counts_invalid';
    throw error;
  }
}

export function mergeLearningEvidence(currentValue, submittedValue, { confirm = false, now = new Date().toISOString() } = {}) {
  const current = normalizeLearningEvidence(currentValue);
  if (current.status === 'confirmed') {
    const error = new Error('learning_evidence_confirmed');
    error.code = 'learning_evidence_confirmed';
    throw error;
  }
  const submitted = normalizeLearningEvidence(submittedValue);
  const byId = new Map(submitted.entries.map(item => [item.id, item]));
  const entries = current.entries.map(item => {
    const update = byId.get(item.id);
    if (!update) return item;
    if (hasSensitiveIdentifiers(update.observedPattern) || hasSensitiveIdentifiers(update.teacherAction)) {
      const error = new Error('student_sample_contains_contact');
      error.code = 'student_sample_contains_contact';
      throw error;
    }
    return {
      ...item,
      assignedCount: update.assignedCount,
      submittedCount: update.submittedCount,
      secureCount: update.secureCount,
      partialCount: update.partialCount,
      notYetCount: update.notYetCount,
      observedPattern: update.observedPattern,
      teacherAction: update.teacherAction
    };
  });
  for (const item of entries) {
    if (item.assignedCount || item.submittedCount || item.secureCount || item.partialCount || item.notYetCount) assertCounts(item);
  }
  const next = normalizeLearningEvidence({ ...current, entries, updatedAt: now });
  if (confirm && !learningEvidenceProgress(next).ready) {
    const error = new Error('learning_evidence_incomplete');
    error.code = 'learning_evidence_incomplete';
    throw error;
  }
  if (confirm) {
    next.status = 'confirmed';
    next.confirmedAt = now;
  }
  return next;
}

export function learningEvidenceIsStale(draft = {}) {
  const evidence = normalizeLearningEvidence(draft.answer?.learningEvidence || {});
  return Boolean(evidence.entries.length && evidence.sourceKey !== learningEvidenceSourceKey(draft));
}

export function learningEvidenceSummary(value = {}) {
  const evidence = normalizeLearningEvidence(value);
  const completed = evidence.entries.filter(item => item.assignedCount > 0 && item.submittedCount > 0 && item.secureCount + item.partialCount + item.notYetCount === item.submittedCount);
  const counts = { secure: 0, partial: 0, not_yet: 0 };
  for (const item of completed) {
    counts.secure += item.secureCount;
    counts.partial += item.partialCount;
    counts.not_yet += item.notYetCount;
  }
  return {
    itemCount: completed.length,
    // submittedCount is the largest per-task submission count, not a sum of
    // the same students across several questions. responseCount is the
    // explicitly labelled per-question total when that aggregate is useful.
    submittedCount: completed.length ? Math.max(...completed.map(item => item.submittedCount)) : 0,
    responseCount: completed.reduce((sum, item) => sum + item.submittedCount, 0),
    counts,
    focus: completed.filter(item => item.partialCount + item.notYetCount > 0).slice(0, 5).map(item => ({
      question: item.prompt,
      submittedCount: item.submittedCount,
      secureCount: item.secureCount,
      partialCount: item.partialCount,
      notYetCount: item.notYetCount,
      observedPattern: item.observedPattern,
      teacherAction: item.teacherAction
    }))
  };
}

export function learningEvidenceContext(value = {}) {
  const evidence = normalizeLearningEvidence(value);
  if (evidence.status !== 'confirmed') return null;
  return clone(learningEvidenceSummary(evidence));
}
