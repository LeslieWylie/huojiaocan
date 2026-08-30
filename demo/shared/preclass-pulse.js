const DECISIONS = new Set(['adopt', 'keep_original']);

function text(value, max = 800) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function count(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(number, 200) : 0;
}

function unique(list, max = 4) {
  return [...new Set((Array.isArray(list) ? list : []).map(item => text(item, 120)).filter(Boolean))].slice(0, max);
}

function cardItems(card = {}) {
  const source = Array.isArray(card.items) ? card.items : Array.isArray(card.content) ? card.content : [];
  const cardRefs = unique(card.citationIds || card.evidenceRefs, 4);
  return source.map((item, index) => typeof item === 'string'
    ? { id: `${card.id || 'question'}-legacy-${index}`, text: item, citationIds: cardRefs }
    : {
        id: text(item?.id || `${card.id || 'question'}-${index}`, 120),
        text: text(item?.text || item?.content || item?.question || item?.title, 600),
        citationIds: unique(item?.citationIds || item?.evidenceRefs || cardRefs, 4)
      });
}

function sourcePrompts(draft = {}) {
  const citations = Array.isArray(draft.citations) ? draft.citations : [];
  const validIds = new Set(citations.map((item, index) => String(item?.id || item?.citationId || `citation-${index}`)));
  const questionCard = (Array.isArray(draft.cards) ? draft.cards : []).find(card => card?.type === 'question');
  return cardItems(questionCard).map(item => ({
    ...item,
    citationIds: item.citationIds.filter(id => validIds.has(id))
  })).filter(item => item.text && item.citationIds.length).slice(0, 2);
}

function citationFingerprint(draft = {}, ids = []) {
  const citations = Array.isArray(draft.citations) ? draft.citations : [];
  const byId = new Map(citations.map((item, index) => [String(item?.id || item?.citationId || `citation-${index}`), item]));
  return ids.map(id => {
    const item = byId.get(id) || {};
    return [id, text(item.documentId || item.document_id, 120), Number(item.pdfPage || item.pdf_page || item.page) || 0, text(item.quote || item.text, 180)];
  });
}

export function emptyPreClassPulse() {
  return {
    version: 1,
    status: 'draft',
    sourceSchemaVersion: 1,
    sourceKey: '',
    prompts: [],
    presentCount: 0,
    respondedCount: 0,
    secureCount: 0,
    partialCount: 0,
    notYetCount: 0,
    observedPattern: '',
    teacherDecision: '',
    recommendation: null,
    generatedAt: null,
    updatedAt: null,
    confirmedAt: null
  };
}

export function normalizePreClassPulse(value = {}) {
  const prompts = (Array.isArray(value.prompts) ? value.prompts : []).slice(0, 2).map((item, index) => ({
    id: text(item?.id || `pulse-${index + 1}`, 120),
    questionId: text(item?.questionId || item?.id || `question-${index + 1}`, 120),
    prompt: text(item?.prompt || item?.question, 600),
    studentAction: text(item?.studentAction, 400) || '先在教材中找到对应词句，再用一句话说明词句与判断的关系。',
    observeFor: text(item?.observeFor, 400) || '观察学生能否指出具体词句，并把词句与判断连起来。',
    citationIds: unique(item?.citationIds, 4)
  })).filter(item => item.prompt && item.citationIds.length);
  const normalized = {
    ...emptyPreClassPulse(),
    status: value.status === 'confirmed' ? 'confirmed' : 'draft',
    sourceKey: text(value.sourceKey, 80),
    prompts,
    presentCount: count(value.presentCount),
    respondedCount: count(value.respondedCount),
    secureCount: count(value.secureCount),
    partialCount: count(value.partialCount),
    notYetCount: count(value.notYetCount),
    observedPattern: text(value.observedPattern, 360),
    teacherDecision: DECISIONS.has(value.teacherDecision) ? value.teacherDecision : '',
    generatedAt: text(value.generatedAt, 80) || null,
    updatedAt: text(value.updatedAt, 80) || null,
    confirmedAt: value.status === 'confirmed' ? text(value.confirmedAt, 80) || null : null
  };
  normalized.recommendation = derivePreClassRecommendation(normalized);
  return normalized;
}

export function preClassPulseSourceKey(draft = {}) {
  const source = sourcePrompts(draft).map(item => [item.id, item.text, citationFingerprint(draft, item.citationIds)]);
  const serialized = JSON.stringify(source);
  return source.length ? `pulse-v1-${stableHash(serialized)}${stableHash([...serialized].reverse().join(''))}` : '';
}

export function buildPreClassPulse(draft = {}, now = new Date().toISOString()) {
  const source = sourcePrompts(draft);
  if (!source.length) {
    const error = new Error('preclass_pulse_evidence_required');
    error.code = 'preclass_pulse_evidence_required';
    error.status = 422;
    throw error;
  }
  return normalizePreClassPulse({
    status: 'draft',
    sourceKey: preClassPulseSourceKey(draft),
    prompts: source.map((item, index) => ({
      id: `pulse-${index + 1}-${stableHash(item.id)}`,
      questionId: item.id,
      prompt: item.text,
      studentAction: index === 0
        ? '请学生先独立定位教材原句，再用一句话说出“我发现了什么”。'
        : '请学生比较两处已找到的词句，再说明它们怎样共同支持本课判断。',
      observeFor: index === 0
        ? '是否能找到具体词句，而不是只复述结论。'
        : '是否能把两处词句联系起来，形成完整解释。',
      citationIds: item.citationIds
    })),
    generatedAt: now,
    updatedAt: now
  });
}

export function preClassPulseProgress(value = {}) {
  const pulse = normalizePreClassPulse(value);
  const classified = pulse.secureCount + pulse.partialCount + pulse.notYetCount;
  const distributionValid = pulse.respondedCount > 0
    && pulse.presentCount >= pulse.respondedCount
    && classified === pulse.respondedCount;
  return {
    distributionValid,
    classified,
    ready: pulse.prompts.length > 0 && distributionValid,
    complete: pulse.prompts.length > 0 && distributionValid && Boolean(pulse.teacherDecision)
  };
}

export function derivePreClassRecommendation(value = {}) {
  const pulse = { ...emptyPreClassPulse(), ...value };
  const responded = count(pulse.respondedCount);
  if (!responded || !Array.isArray(pulse.prompts) || !pulse.prompts.length) return null;
  const secure = count(pulse.secureCount);
  const partial = count(pulse.partialCount);
  const notYet = count(pulse.notYetCount);
  if (secure + partial + notYet !== responded) return null;
  const prompt = pulse.prompts[0];
  const base = { sourceQuestionId: prompt.questionId, nextPrompt: prompt.prompt, citationIds: unique(prompt.citationIds, 4) };
  if (notYet / responded >= 0.35 || (partial + notYet) / responded >= 0.65) {
    return {
      ...base,
      level: 'scaffold',
      title: '先从教材原句起步',
      rationale: '较多学生还不能把判断落到具体词句，课堂起步应先降低表达门槛。',
      openingMove: '保留本课核心问题，先让学生在对应页面圈出关键句，再按“词句—发现—判断”三步表达。'
    };
  }
  if (secure / responded >= 0.7) {
    return {
      ...base,
      level: 'deepen',
      title: '可以直接进入比较与解释',
      rationale: '多数学生已经能找到并解释教材词句，可以减少重复识记，把时间用于关系判断。',
      openingMove: '略过重复识记，直接比较两处文本依据，并说明它们怎样共同支撑本课判断。'
    };
  }
  return {
    ...base,
    level: 'steady',
    title: '按原主线推进，预留一次追问',
    rationale: '班级已经具备基本起点，但仍有部分学生需要从结论回到教材依据。',
    openingMove: '先按原问题进入课堂；若学生只给结论，立即追问“教材中哪一句支持你的判断”。'
  };
}

function hasSensitiveIdentifiers(value) {
  const input = String(value || '');
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(input)
    || /(?:^|\D)1[3-9]\d{9}(?:\D|$)/u.test(input)
    || /(?:姓名|学号|手机号|身份证)\s*[：:]/u.test(input);
}

export function mergePreClassPulse(currentValue, submittedValue, { confirm = false, now = new Date().toISOString() } = {}) {
  const current = normalizePreClassPulse(currentValue);
  if (current.status === 'confirmed') {
    const error = new Error('preclass_pulse_confirmed');
    error.code = 'preclass_pulse_confirmed';
    error.status = 409;
    throw error;
  }
  const submitted = normalizePreClassPulse(submittedValue);
  if (hasSensitiveIdentifiers(submitted.observedPattern)) {
    const error = new Error('preclass_pulse_contains_identifier');
    error.code = 'preclass_pulse_contains_identifier';
    error.status = 422;
    throw error;
  }
  const next = normalizePreClassPulse({
    ...current,
    presentCount: submitted.presentCount,
    respondedCount: submitted.respondedCount,
    secureCount: submitted.secureCount,
    partialCount: submitted.partialCount,
    notYetCount: submitted.notYetCount,
    observedPattern: submitted.observedPattern,
    teacherDecision: submitted.teacherDecision,
    updatedAt: now
  });
  const progress = preClassPulseProgress(next);
  if ((next.presentCount || next.respondedCount || progress.classified) && !progress.distributionValid) {
    const error = new Error('preclass_pulse_counts_invalid');
    error.code = 'preclass_pulse_counts_invalid';
    error.status = 422;
    throw error;
  }
  if (confirm && !progress.complete) {
    const error = new Error('preclass_pulse_incomplete');
    error.code = 'preclass_pulse_incomplete';
    error.status = 422;
    throw error;
  }
  if (confirm) {
    next.status = 'confirmed';
    next.confirmedAt = now;
  }
  return next;
}

export function preClassPulseIsStale(draft = {}) {
  const pulse = normalizePreClassPulse(draft?.answer?.preClassPulse || {});
  return Boolean(pulse.prompts.length && pulse.sourceKey !== preClassPulseSourceKey(draft));
}

export function preClassPulseClassroomCue(draft = {}) {
  const pulse = normalizePreClassPulse(draft?.answer?.preClassPulse || {});
  if (pulse.status !== 'confirmed' || preClassPulseIsStale(draft) || !pulse.recommendation) return null;
  return {
    ...pulse.recommendation,
    teacherDecision: pulse.teacherDecision,
    observedPattern: pulse.observedPattern,
    counts: {
      present: pulse.presentCount,
      responded: pulse.respondedCount,
      secure: pulse.secureCount,
      partial: pulse.partialCount,
      notYet: pulse.notYetCount
    }
  };
}
