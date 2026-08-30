const OUTCOMES = new Set(['reached', 'partial', 'silent']);

function text(value, max = 600) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function unique(list, max = 8) {
  return [...new Set((Array.isArray(list) ? list : []).map(item => text(item, 120)).filter(Boolean))].slice(0, max);
}

function parseQuestion(value) {
  const source = text(value, 1200);
  const part = label => text(source.match(new RegExp(`${label}[：:]([^｜|]+)`, 'u'))?.[1], 500);
  return {
    question: part('主问') || source,
    followUp: part('追问'),
    expected: part('预期(?:学生)?(?:回应|回答)')
  };
}

export function emptyQuestionRehearsal() {
  return { version: 1, status: 'draft', currentStep: 0, sourceDraftVersion: 0, sourceKey: '', steps: [], confirmedAt: null, generatedAt: null, updatedAt: null };
}

export function questionRehearsalSourceKey(draft = {}) {
  const card = (Array.isArray(draft.cards) ? draft.cards : []).find(item => item?.type === 'question');
  const citations = new Map((Array.isArray(draft.citations) ? draft.citations : []).map(item => [String(item?.id || ''), item]).filter(([id]) => id));
  const fallbackRefs = [...citations.keys()].slice(0, 2);
  const source = questionItems(card).map(item => {
    const refs = (unique(item?.citationIds, 8).length ? unique(item?.citationIds, 8) : fallbackRefs).filter(id => citations.has(id)).sort();
    const evidence = refs.map(id => {
      const citation = citations.get(id) || {};
      return [id, text(citation.documentId, 120), text(citation.documentType, 80), Number(citation.pdfPage ?? citation.pageNumber ?? citation.page) || 0, text(citation.quote || citation.text, 240)].join(':');
    }).join(',');
    return [text(item?.id, 100), text(item?.text, 1200), evidence].join('|');
  }).join('\n');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return source ? `qv1-${(hash >>> 0).toString(16).padStart(8, '0')}` : '';
}

function questionItems(card = {}) {
  const source = Array.isArray(card?.items) ? card.items : Array.isArray(card?.content) ? card.content : [];
  const fallbackRefs = unique(card?.citationIds || card?.evidenceRefs, 8);
  return source.map((item, index) => typeof item === 'string'
    ? { id: `${card?.id || 'question'}-legacy-${index}`, text: item, citationIds: fallbackRefs }
    : { ...(item || {}), id: item?.id || `${card?.id || 'question'}-legacy-${index}`, text: item?.text || item?.content || item?.question || '', citationIds: item?.citationIds || item?.evidenceRefs || fallbackRefs });
}

export function normalizeQuestionRehearsal(value = {}) {
  const steps = (Array.isArray(value.steps) ? value.steps : []).slice(0, 8).map((item, index) => ({
    id: text(item?.id, 100) || `question-${index + 1}`,
    question: text(item?.question, 600),
    expectedAction: text(item?.expectedAction, 600),
    estimatedMinutes: Math.max(1, Math.min(12, Number(item?.estimatedMinutes) || 4)),
    citationIds: unique(item?.citationIds, 4),
    branches: {
      reached: text(item?.branches?.reached, 600),
      partial: text(item?.branches?.partial, 600),
      silent: text(item?.branches?.silent, 600)
    },
    selectedOutcome: OUTCOMES.has(item?.selectedOutcome) ? item.selectedOutcome : '',
    teacherNote: text(item?.teacherNote, 300)
  })).filter(item => item.question);
  return {
    ...emptyQuestionRehearsal(),
    status: value.status === 'confirmed' ? 'confirmed' : 'draft',
    currentStep: Math.max(0, Math.min(Math.max(0, steps.length - 1), Number(value.currentStep) || 0)),
    sourceDraftVersion: Math.max(0, Number(value.sourceDraftVersion) || 0),
    sourceKey: text(value.sourceKey, 80),
    steps,
    confirmedAt: value.status === 'confirmed' ? text(value.confirmedAt, 80) || null : null,
    generatedAt: text(value.generatedAt, 80) || null,
    updatedAt: text(value.updatedAt, 80) || null
  };
}

export function buildQuestionRehearsal(draft = {}, now = new Date().toISOString()) {
  const questionCard = (Array.isArray(draft.cards) ? draft.cards : []).find(card => card?.type === 'question');
  const validCitationIds = new Set((Array.isArray(draft.citations) ? draft.citations : []).map(item => String(item?.id || '')).filter(Boolean));
  const fallbackCitationIds = [...validCitationIds].slice(0, 2);
  const items = questionItems(questionCard).map(item => ({ ...item, citationIds: unique(item.citationIds, 4).length ? item.citationIds : fallbackCitationIds }));
  const steps = items.slice(0, 8).map((item, index) => {
    const parsed = parseQuestion(item?.text);
    const citationIds = unique(item?.citationIds, 4).filter(id => validCitationIds.has(id));
    return {
      id: text(item?.id, 100) || `question-${index + 1}`,
      question: parsed.question,
      expectedAction: parsed.expected || '让学生回到原文，找出词句并说明判断。',
      estimatedMinutes: index === items.length - 1 ? 5 : 4,
      citationIds,
      branches: {
        reached: '请学生补充一处文本依据，再用一句话收束这一问。',
        partial: parsed.followUp || '先追问“你的判断依据是哪一个词句”，再请学生说明词句与观点的关系。',
        silent: '把问题拆成“先找原文—再比较差异—最后说出判断”三步，并先给学生静读时间。'
      },
      selectedOutcome: '',
      teacherNote: ''
    };
  }).filter(item => item.question && item.citationIds.length);
  if (!steps.length) {
    const error = new Error('rehearsal_evidence_required');
    error.code = 'rehearsal_evidence_required';
    error.status = 422;
    throw error;
  }
  return normalizeQuestionRehearsal({ status: 'draft', currentStep: 0, sourceDraftVersion: Number(draft.version || 1), sourceKey: questionRehearsalSourceKey(draft), steps, generatedAt: now, updatedAt: now });
}

export function questionRehearsalIsStale(draft = {}) {
  const rehearsal = normalizeQuestionRehearsal(draft?.answer?.questionRehearsal || {});
  return Boolean(rehearsal.steps.length && rehearsal.sourceKey !== questionRehearsalSourceKey(draft));
}

export function mergeQuestionRehearsal(existingValue, submittedValue, { confirm = false, now = new Date().toISOString() } = {}) {
  const existing = normalizeQuestionRehearsal(existingValue);
  if (existing.status === 'confirmed') {
    const error = new Error('rehearsal_confirmed');
    error.code = 'rehearsal_confirmed';
    error.status = 409;
    throw error;
  }
  const submitted = normalizeQuestionRehearsal(submittedValue);
  const submittedById = new Map(submitted.steps.map(item => [item.id, item]));
  const steps = existing.steps.map(item => {
    const update = submittedById.get(item.id);
    return update ? { ...item, selectedOutcome: update.selectedOutcome, teacherNote: update.teacherNote } : item;
  });
  if (confirm && (!steps.length || steps.some(item => !item.selectedOutcome))) {
    const error = new Error('rehearsal_incomplete');
    error.code = 'rehearsal_incomplete';
    error.status = 422;
    throw error;
  }
  return normalizeQuestionRehearsal({ ...existing, status: confirm ? 'confirmed' : 'draft', currentStep: submitted.currentStep, steps, updatedAt: now, confirmedAt: confirm ? now : null });
}

export function rehearsalProgress(value) {
  const rehearsal = normalizeQuestionRehearsal(value);
  const decided = rehearsal.steps.filter(item => item.selectedOutcome).length;
  return { total: rehearsal.steps.length, decided, complete: rehearsal.steps.length > 0 && decided === rehearsal.steps.length };
}
