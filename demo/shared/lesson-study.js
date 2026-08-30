import { normalizeClassroomRun } from './classroom-run.js';
import { learningEvidenceSummary, normalizeLearningEvidence } from './learning-evidence.js';
import { teachingDeliberationContextForDraft } from './teaching-deliberation.js';

const DECISIONS = new Set(['undecided', 'retain', 'adjust', 'replace']);

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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = canonical(value[key]);
    return result;
  }, {});
  return value;
}

function cardItems(draft, type) {
  const card = (Array.isArray(draft.cards) ? draft.cards : []).find(item => item?.type === type) || {};
  const values = Array.isArray(card.items) ? card.items : Array.isArray(card.content) ? card.content : [];
  return values.map((item, index) => typeof item === 'string'
    ? { id: `${type}-${index + 1}`, text: item, citationIds: [] }
    : { id: item?.id || `${type}-${index + 1}`, text: item?.text || item?.content || '', citationIds: item?.citationIds || [] });
}

function validCitationIds(draft) {
  return new Set((Array.isArray(draft.citations) ? draft.citations : []).map((item, index) => String(item?.id || item?.citationId || `citation-${index}`)));
}

function citationIdsFor(draft, values) {
  const valid = validCitationIds(draft);
  return [...new Set(values.flatMap(item => Array.isArray(item?.citationIds) ? item.citationIds : []).map(String).filter(id => valid.has(id)))].slice(0, 8);
}

function selectedChoices(draft) {
  return teachingDeliberationContextForDraft(draft)?.decisions || [];
}

function sourceSnapshot(draft = {}) {
  const answer = draft.answer || {};
  const run = normalizeClassroomRun(answer.classroomRun || {});
  const learning = normalizeLearningEvidence(answer.learningEvidence || {});
  return canonical({
    title: draft.title || answer.lesson?.title || '',
    coreQuestion: answer.lesson?.coreQuestion || draft.question || '',
    choices: selectedChoices(draft),
    assessment: cardItems(draft, 'assessment'),
    run,
    reflection: answer.lessonReflection || null,
    learning
  });
}

export function lessonStudySourceKey(draft = {}) {
  const serialized = JSON.stringify(sourceSnapshot(draft));
  return `ls1:${stableHash(serialized)}${stableHash(serialized.split('').reverse().join(''))}`;
}

export function emptyLessonStudy() {
  return {
    version: 1,
    status: 'draft',
    sourceKey: '',
    sourceDraftVersion: null,
    title: '',
    inquiryQuestion: '',
    hypothesis: '',
    plannedMove: '',
    expectedEvidence: '',
    citationIds: [],
    evidence: { classroomFacts: [], reflectionFacts: [], learningSummary: null },
    conclusion: { decision: 'undecided', finding: '', nextTrial: '', scopeBoundary: '本记录只说明本次课堂，不代表教材结论，也不推断个别学生。' },
    generatedAt: null,
    updatedAt: null,
    confirmedAt: null,
    confirmedBy: ''
  };
}

function normalizeFacts(values, max = 6) {
  return (Array.isArray(values) ? values : []).map(item => text(item, 360)).filter(Boolean).slice(0, max);
}

export function normalizeLessonStudy(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const evidence = source.evidence && typeof source.evidence === 'object' ? source.evidence : {};
  const summary = evidence.learningSummary && typeof evidence.learningSummary === 'object' ? evidence.learningSummary : null;
  const conclusion = source.conclusion && typeof source.conclusion === 'object' ? source.conclusion : {};
  const status = source.status === 'confirmed' ? 'confirmed' : 'draft';
  return {
    ...emptyLessonStudy(),
    sourceKey: text(source.sourceKey, 100),
    sourceDraftVersion: Number.isInteger(Number(source.sourceDraftVersion)) ? Number(source.sourceDraftVersion) : null,
    status,
    title: text(source.title, 160),
    inquiryQuestion: text(source.inquiryQuestion, 500),
    hypothesis: text(source.hypothesis, 800),
    plannedMove: text(source.plannedMove, 800),
    expectedEvidence: text(source.expectedEvidence, 800),
    citationIds: [...new Set((Array.isArray(source.citationIds) ? source.citationIds : []).map(id => text(id, 120)).filter(Boolean))].slice(0, 8),
    evidence: {
      classroomFacts: normalizeFacts(evidence.classroomFacts),
      reflectionFacts: normalizeFacts(evidence.reflectionFacts),
      learningSummary: summary ? {
        itemCount: Math.max(0, Number(summary.itemCount) || 0),
        submittedCount: Math.max(0, Number(summary.submittedCount) || 0),
        counts: {
          secure: Math.max(0, Number(summary.counts?.secure) || 0),
          partial: Math.max(0, Number(summary.counts?.partial) || 0),
          notYet: Math.max(0, Number(summary.counts?.notYet ?? summary.counts?.not_yet) || 0)
        },
        focus: normalizeFacts(summary.focus, 4)
      } : null
    },
    conclusion: {
      decision: DECISIONS.has(conclusion.decision) ? conclusion.decision : 'undecided',
      finding: text(conclusion.finding, 1200),
      nextTrial: text(conclusion.nextTrial, 1200),
      scopeBoundary: text(conclusion.scopeBoundary, 300) || emptyLessonStudy().conclusion.scopeBoundary
    },
    generatedAt: source.generatedAt || null,
    updatedAt: source.updatedAt || null,
    confirmedAt: status === 'confirmed' ? source.confirmedAt || null : null,
    confirmedBy: status === 'confirmed' ? text(source.confirmedBy, 120) : ''
  };
}

function observationFacts(draft) {
  const answer = draft.answer || {};
  const run = normalizeClassroomRun(answer.classroomRun || {});
  const reached = run.stages.filter(item => item.outcome === 'reached').map(item => `课堂第 ${item.stage} 步已经达成`);
  const follow = run.stages.filter(item => item.outcome === 'needs_followup').map(item => `课堂第 ${item.stage} 步仍需追问`);
  const keywords = run.keywords.length ? [`学生在课堂中留下关键词：${run.keywords.map(item => item.text).join('、')}`] : [];
  const pace = run.paceSignal !== 'on_track' ? [`课堂节奏标记：${({ time_short: '时间不足', students_stuck: '学生卡住', ahead: '提前完成' })[run.paceSignal] || run.paceSignal}`] : [];
  const reflection = answer.lessonReflection || {};
  return {
    classroomFacts: [...reached, ...follow, ...keywords, ...pace].slice(0, 6),
    reflectionFacts: [
      reflection.observedLearning && `教师观察：${reflection.observedLearning}`,
      reflection.unresolvedLearning && `尚未解决：${reflection.unresolvedLearning}`,
      reflection.pacingNotes && `节奏记录：${reflection.pacingNotes}`
    ].filter(Boolean).slice(0, 6)
  };
}

function learningSummaryFor(draft) {
  const value = learningEvidenceSummary(draft.answer?.learningEvidence || {});
  if (!value.itemCount) return null;
  return {
    itemCount: value.itemCount,
    submittedCount: value.submittedCount,
    counts: { secure: value.counts.secure, partial: value.counts.partial, notYet: value.counts.not_yet },
    focus: value.focus.map(item => [item.question, item.observedPattern, item.teacherAction].filter(Boolean).join('；')).filter(Boolean)
  };
}

function hasObservation(evidence) {
  return Boolean(evidence.classroomFacts.length || evidence.reflectionFacts.length || evidence.learningSummary?.itemCount);
}

export function buildLessonStudy(draft = {}, now = new Date().toISOString()) {
  const answer = draft.answer || {};
  const choices = selectedChoices(draft);
  const assessment = cardItems(draft, 'assessment');
  const evidence = { ...observationFacts(draft), learningSummary: learningSummaryFor(draft) };
  if (!hasObservation(evidence)) {
    throw Object.assign(new Error('lesson_study_observation_required'), { code: 'lesson_study_observation_required', status: 409 });
  }
  const title = text(draft.title || answer.lesson?.title || '当前课堂', 160);
  const inquiryQuestion = text(answer.lesson?.coreQuestion || draft.question || `怎样判断${title}的教学设计是否真正促进了学生理解？`, 500);
  const hypothesis = choices.length
    ? `如果采用“${choices.map(item => item.choice).join('、')}”的教学处理，学生将更有可能完成本课核心学习任务。`
    : text(answer.summary || `如果围绕“${inquiryQuestion}”组织课堂，学生将能用教材原文说明自己的判断。`, 800);
  const plannedMove = choices.length
    ? choices.map(item => `${item.question}：${item.approach}`).join('；')
    : text((answer.lessonPlan || []).map(item => typeof item === 'string' ? item : item?.title || item?.activity || '').filter(Boolean).slice(0, 3).join('；'), 800);
  const expectedEvidence = assessment.length
    ? assessment.map(item => text(item.text, 260)).filter(Boolean).slice(0, 3).join('；')
    : text((answer.assessment || []).map(item => typeof item === 'string' ? item : item?.criterion || item?.text || '').filter(Boolean).slice(0, 3).join('；'), 800);
  const observed = evidence.reflectionFacts[0] || evidence.classroomFacts[0] || '';
  const unresolved = evidence.reflectionFacts.find(item => item.startsWith('尚未解决：')) || evidence.learningSummary?.focus?.[0] || '';
  const nextTrial = text(answer.lessonReflection?.nextLessonAdjustment || evidence.learningSummary?.focus?.[0] || '下次保留有效课堂动作，并针对尚未达成的学习表现只调整一个关键环节。', 1200);
  const citationIds = citationIdsFor(draft, [
    ...assessment,
    ...choices.flatMap(item => [{ citationIds: item.evidenceRefs }])
  ]);
  return normalizeLessonStudy({
    status: 'draft',
    sourceKey: lessonStudySourceKey(draft),
    sourceDraftVersion: Number(draft.version) || null,
    title,
    inquiryQuestion,
    hypothesis,
    plannedMove: plannedMove || '围绕核心问题组织课堂活动，并让学生回到教材原文完成表达。',
    expectedEvidence: expectedEvidence || '学生能够引用教材原文，完成可观察的朗读、解释或表达任务。',
    citationIds,
    evidence,
    conclusion: {
      decision: 'undecided',
      finding: [observed, unresolved].filter(Boolean).join('；'),
      nextTrial,
      scopeBoundary: emptyLessonStudy().conclusion.scopeBoundary
    },
    generatedAt: now,
    updatedAt: now
  });
}

function containsSensitiveIdentifier(value) {
  const input = String(value || '');
  return /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(input)
    || /(?:^|\D)1[3-9]\d{9}(?:\D|$)/u.test(input)
    || /(?:姓名|学号|手机号)\s*[:：]\s*\S+/u.test(input);
}

export function mergeLessonStudy(currentValue, submittedValue, { confirm = false, confirmedBy = '', now = new Date().toISOString() } = {}) {
  const current = normalizeLessonStudy(currentValue);
  if (current.status === 'confirmed') throw Object.assign(new Error('lesson_study_confirmed'), { code: 'lesson_study_confirmed', status: 409 });
  const submitted = normalizeLessonStudy(submittedValue);
  const conclusion = {
    ...current.conclusion,
    decision: submitted.conclusion.decision,
    finding: submitted.conclusion.finding,
    nextTrial: submitted.conclusion.nextTrial
  };
  if (containsSensitiveIdentifier(conclusion.finding) || containsSensitiveIdentifier(conclusion.nextTrial)) {
    throw Object.assign(new Error('lesson_study_contains_student_identifier'), { code: 'lesson_study_contains_student_identifier', status: 422 });
  }
  if (confirm && (conclusion.decision === 'undecided' || !conclusion.finding || !conclusion.nextTrial)) {
    throw Object.assign(new Error('lesson_study_incomplete'), { code: 'lesson_study_incomplete', status: 422 });
  }
  return normalizeLessonStudy({
    ...current,
    status: confirm ? 'confirmed' : 'draft',
    conclusion,
    updatedAt: now,
    confirmedAt: confirm ? now : null,
    confirmedBy: confirm ? confirmedBy : ''
  });
}

export function lessonStudyIsStale(draft = {}) {
  const study = normalizeLessonStudy(draft.answer?.lessonStudy || {});
  return Boolean(study.sourceKey && study.sourceKey !== lessonStudySourceKey(draft));
}

export function lessonStudyReadiness(draft = {}) {
  const answer = draft.answer || {};
  const run = normalizeClassroomRun(answer.classroomRun || {});
  const learning = learningEvidenceSummary(answer.learningEvidence || {});
  return {
    hasPlan: Boolean(answer.summary || answer.lesson?.coreQuestion || (Array.isArray(draft.cards) && draft.cards.length)),
    hasClassroomFacts: Boolean(run.stages.length || run.keywords.length || run.usedCards.length),
    hasReflection: Boolean(answer.lessonReflection && Object.values(answer.lessonReflection).some(value => Array.isArray(value) ? value.length : String(value || '').trim())),
    hasLearningEvidence: Boolean(learning.itemCount)
  };
}
