function text(value, max = 600) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonical(value[key]);
    return result;
  }, {});
  return value;
}

function citationIdentity(item = {}) {
  return [
    text(item.id || item.citationId, 120),
    text(item.documentId || item.document_id, 120),
    Number(item.pdfPage ?? item.pageNumber ?? item.page) || 0,
    text(item.quote || item.text, 180)
  ];
}

export function teachingDeliberationSourceKey(draft = {}) {
  const answer = draft.answer || {};
  const source = JSON.stringify(canonical({
    schemaVersion: 1,
    title: text(draft.title, 160),
    question: text(draft.question, 600),
    lessonContext: draft.lesson_context || draft.lessonContext || {},
    lessonIdentity: { title: text(answer.lesson?.title, 160), coreQuestion: text(answer.lesson?.coreQuestion, 600) },
    plan: {
      summary: answer.summary || '',
      objectives: answer.objectives || [],
      keyPoints: answer.keyPoints || [],
      lessonPlan: answer.lessonPlan || [],
      questionChain: answer.questionChain || [],
      homework: answer.homework || [],
      assessment: answer.assessment || []
    },
    priorLearning: answer.previousLessonLearningEvidence || null,
    priorHomeworkReview: answer.previousLessonHomeworkReview || null,
    priorReflection: answer.previousLessonReflection || null,
    citations: (Array.isArray(draft.citations) ? draft.citations : []).map(citationIdentity)
  }));
  return `td1:${stableHash(source)}${stableHash(source.split('').reverse().join(''))}`;
}

export function emptyTeachingDeliberation() {
  return {
    version: 1,
    promptVersion: 1,
    sourceDraftVersion: null,
    status: 'draft',
    sourceKey: '',
    decisions: [],
    generatedAt: null,
    updatedAt: null,
    confirmedAt: null,
    confirmedBy: ''
  };
}

export function normalizeTeachingDeliberation(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const decisions = (Array.isArray(value.decisions) ? value.decisions : []).slice(0, 4).map((decision, decisionIndex) => {
    const options = (Array.isArray(decision?.options) ? decision.options : []).slice(0, 3).map((option, optionIndex) => ({
      id: text(option?.id || `option-${optionIndex + 1}`, 100),
      label: text(option?.label, 80),
      approach: text(option?.approach || option?.description, 500),
      tradeoff: text(option?.tradeoff || option?.cost, 360),
      evidenceRefs: (Array.isArray(option?.evidenceRefs) ? option.evidenceRefs : []).map(id => text(id, 120)).filter(Boolean).slice(0, 4)
    })).filter(option => option.label && option.approach);
    return {
      id: text(decision?.id || `decision-${decisionIndex + 1}`, 100),
      question: text(decision?.question || decision?.title, 240),
      whyItMatters: text(decision?.whyItMatters || decision?.reason, 420),
      options,
      recommendedOptionId: text(decision?.recommendedOptionId, 100),
      selectedOptionId: text(decision?.selectedOptionId, 100)
    };
  }).filter(decision => decision.question && decision.options.length >= 2);
  return {
    ...emptyTeachingDeliberation(),
    promptVersion: Number.isInteger(Number(value.promptVersion)) ? Number(value.promptVersion) : 1,
    sourceDraftVersion: Number.isInteger(Number(value.sourceDraftVersion)) ? Number(value.sourceDraftVersion) : null,
    status: value.status === 'confirmed' ? 'confirmed' : 'draft',
    sourceKey: text(value.sourceKey, 100),
    decisions,
    generatedAt: value.generatedAt || null,
    updatedAt: value.updatedAt || null,
    confirmedAt: value.status === 'confirmed' ? value.confirmedAt || null : null,
    confirmedBy: value.status === 'confirmed' ? text(value.confirmedBy, 120) : ''
  };
}

export function teachingDeliberationIsStale(draft = {}) {
  const value = normalizeTeachingDeliberation(draft.answer?.teachingDeliberation || {});
  return Boolean(value.decisions.length && value.sourceKey !== teachingDeliberationSourceKey(draft));
}

export function mergeTeachingDeliberation(currentValue, submittedValue, { confirm = false, confirmedBy = '', now = new Date().toISOString() } = {}) {
  const current = normalizeTeachingDeliberation(currentValue);
  if (current.status === 'confirmed') throw Object.assign(new Error('deliberation_confirmed'), { code: 'deliberation_confirmed', status: 409 });
  const submitted = normalizeTeachingDeliberation(submittedValue);
  const selected = new Map(submitted.decisions.map(item => [item.id, item.selectedOptionId]));
  const decisions = current.decisions.map(decision => {
    const selectedOptionId = selected.get(decision.id) || '';
    return { ...decision, selectedOptionId: decision.options.some(option => option.id === selectedOptionId) ? selectedOptionId : '' };
  });
  if (confirm && (!decisions.length || decisions.some(decision => !decision.selectedOptionId))) {
    throw Object.assign(new Error('deliberation_incomplete'), { code: 'deliberation_incomplete', status: 422 });
  }
  return normalizeTeachingDeliberation({
    ...current,
    status: confirm ? 'confirmed' : 'draft',
    decisions,
    updatedAt: now,
    confirmedAt: confirm ? now : null,
    confirmedBy: confirm ? confirmedBy : ''
  });
}

export function teachingDeliberationContext(value = {}) {
  const current = normalizeTeachingDeliberation(value);
  if (current.status !== 'confirmed') return null;
  return {
    decisions: current.decisions.map((decision, index) => {
      const option = decision.options.find(item => item.id === decision.selectedOptionId);
      return option ? {
        id: `D${index + 1}`,
        question: decision.question,
        choice: option.label,
        approach: option.approach,
        acceptedTradeoff: option.tradeoff,
        evidenceRefs: option.evidenceRefs
      } : null;
    }).filter(Boolean)
  };
}

export function teachingDeliberationContextForDraft(draft = {}) {
  if (teachingDeliberationIsStale(draft)) return null;
  return teachingDeliberationContext(draft.answer?.teachingDeliberation);
}
