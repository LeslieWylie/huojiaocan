import { lessonStudyIsStale, normalizeLessonStudy } from './lesson-study.js';

const DECISIONS = new Set(['undecided', 'local_only', 'transferable', 'needs_more']);

function text(value, max = 1200) {
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

export function normalizeLessonIdentity(value) {
  return text(value, 180)
    .normalize('NFKC')
    .replace(/[《》〈〉\s·•，,。.!！?？:：;；“”"'‘’—_-]/gu, '')
    .replace(/[（(](?:复备|副本|复制|第\s*\d+\s*版)[）)]$/u, '')
    .toLowerCase();
}

function lessonTitle(draft = {}) {
  return text(draft.answer?.lesson?.title || draft.answer?.assetMeta?.lessonKey || draft.title || draft.question, 180);
}

function classLabel(draft = {}, fallback) {
  const context = draft.lesson_context || draft.lessonContext || {};
  const values = [context.classLevel || context.class_level || context.level, context.duration || context.hours]
    .map(value => text(value, 80)).filter(Boolean);
  return values.length ? values.join(' · ') : fallback;
}

function learningProfile(study) {
  const summary = study.evidence.learningSummary;
  if (!summary?.itemCount) return null;
  const total = summary.counts.secure + summary.counts.partial + summary.counts.notYet;
  return {
    submittedCount: summary.submittedCount,
    secure: summary.counts.secure,
    partial: summary.counts.partial,
    notYet: summary.counts.notYet,
    secureRate: total ? Math.round((summary.counts.secure / total) * 100) : null,
    focus: summary.focus.slice(0, 3)
  };
}

function sourceProfile(draft, label) {
  const study = normalizeLessonStudy(draft.answer?.lessonStudy || {});
  return {
    draftId: text(draft.id, 120),
    draftVersion: Number(draft.version || 1),
    label: classLabel(draft, label),
    title: lessonTitle(draft),
    studySourceKey: study.sourceKey,
    confirmedAt: study.confirmedAt,
    decision: study.conclusion.decision,
    finding: study.conclusion.finding,
    nextTrial: study.conclusion.nextTrial,
    classroomFacts: study.evidence.classroomFacts.slice(0, 4),
    reflectionFacts: study.evidence.reflectionFacts.slice(0, 4),
    learning: learningProfile(study)
  };
}

export function sameLessonComparisonSourceKey(left, right) {
  const { draftVersion: _leftVersion, ...leftSource } = sourceProfile(left, '实践 A');
  const { draftVersion: _rightVersion, ...rightSource } = sourceProfile(right, '实践 B');
  const value = JSON.stringify({ left: leftSource, right: rightSource });
  return `slc1:${stableHash(value)}${stableHash([...value].reverse().join(''))}`;
}

export function emptySameLessonComparison() {
  return {
    version: 1,
    status: 'draft',
    sourceKey: '',
    lessonIdentity: '',
    lessonTitle: '',
    left: null,
    right: null,
    observations: [],
    synthesis: {
      decision: 'undecided',
      transferableFinding: '',
      contextBoundary: '本结论只基于两次课堂实践，不代表所有班级，也不替代教材与教师用书。',
      nextExperiment: ''
    },
    generatedAt: null,
    updatedAt: null,
    confirmedAt: null,
    confirmedBy: ''
  };
}

function normalizeProfile(value) {
  if (!value || typeof value !== 'object') return null;
  const learning = value.learning && typeof value.learning === 'object' ? value.learning : null;
  return {
    draftId: text(value.draftId, 120),
    draftVersion: Number(value.draftVersion || 1),
    label: text(value.label, 120),
    title: text(value.title, 180),
    studySourceKey: text(value.studySourceKey, 120),
    confirmedAt: value.confirmedAt || null,
    decision: text(value.decision, 40),
    finding: text(value.finding),
    nextTrial: text(value.nextTrial),
    classroomFacts: (Array.isArray(value.classroomFacts) ? value.classroomFacts : []).map(item => text(item, 360)).filter(Boolean).slice(0, 4),
    reflectionFacts: (Array.isArray(value.reflectionFacts) ? value.reflectionFacts : []).map(item => text(item, 360)).filter(Boolean).slice(0, 4),
    learning: learning ? {
      submittedCount: Math.max(0, Number(learning.submittedCount) || 0),
      secure: Math.max(0, Number(learning.secure) || 0),
      partial: Math.max(0, Number(learning.partial) || 0),
      notYet: Math.max(0, Number(learning.notYet) || 0),
      secureRate: Number.isFinite(Number(learning.secureRate)) ? Math.max(0, Math.min(100, Number(learning.secureRate))) : null,
      focus: (Array.isArray(learning.focus) ? learning.focus : []).map(item => text(item, 360)).filter(Boolean).slice(0, 3)
    } : null
  };
}

export function normalizeSameLessonComparison(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const synthesis = source.synthesis && typeof source.synthesis === 'object' ? source.synthesis : {};
  const status = source.status === 'confirmed' ? 'confirmed' : 'draft';
  return {
    ...emptySameLessonComparison(),
    sourceKey: text(source.sourceKey, 120),
    lessonIdentity: text(source.lessonIdentity, 200),
    lessonTitle: text(source.lessonTitle, 180),
    left: normalizeProfile(source.left),
    right: normalizeProfile(source.right),
    observations: (Array.isArray(source.observations) ? source.observations : []).map(item => text(item, 500)).filter(Boolean).slice(0, 6),
    status,
    synthesis: {
      decision: DECISIONS.has(synthesis.decision) ? synthesis.decision : 'undecided',
      transferableFinding: text(synthesis.transferableFinding),
      contextBoundary: text(synthesis.contextBoundary, 500) || emptySameLessonComparison().synthesis.contextBoundary,
      nextExperiment: text(synthesis.nextExperiment)
    },
    generatedAt: source.generatedAt || null,
    updatedAt: source.updatedAt || null,
    confirmedAt: status === 'confirmed' ? source.confirmedAt || null : null,
    confirmedBy: status === 'confirmed' ? text(source.confirmedBy, 120) : ''
  };
}

function assertComparable(left, right) {
  if (!left?.id || !right?.id || String(left.id) === String(right.id)) {
    throw Object.assign(new Error('same_lesson_distinct_drafts_required'), { code: 'same_lesson_distinct_drafts_required', status: 422 });
  }
  const leftIdentity = normalizeLessonIdentity(lessonTitle(left));
  const rightIdentity = normalizeLessonIdentity(lessonTitle(right));
  if (!leftIdentity || leftIdentity !== rightIdentity) {
    throw Object.assign(new Error('same_lesson_identity_mismatch'), { code: 'same_lesson_identity_mismatch', status: 422 });
  }
  for (const draft of [left, right]) {
    const study = normalizeLessonStudy(draft.answer?.lessonStudy || {});
    if (study.status !== 'confirmed' || lessonStudyIsStale(draft)) {
      throw Object.assign(new Error('same_lesson_confirmed_studies_required'), { code: 'same_lesson_confirmed_studies_required', status: 409 });
    }
  }
  return leftIdentity;
}

export function buildSameLessonComparison(left, right, now = new Date().toISOString()) {
  const lessonIdentity = assertComparable(left, right);
  const leftProfile = sourceProfile(left, '实践 A');
  const rightProfile = sourceProfile(right, '实践 B');
  const observations = [];
  if (leftProfile.decision === rightProfile.decision) observations.push(`两次实践的教师判断均为“${({ retain: '保留', adjust: '调整', replace: '更换' })[leftProfile.decision] || leftProfile.decision}”。`);
  else observations.push('两次实践形成了不同的教师判断，需要结合班级条件解释差异。');
  if (leftProfile.learning?.secureRate != null && rightProfile.learning?.secureRate != null) {
    observations.push(`两次作业完整达成比例分别为 ${leftProfile.learning.secureRate}% 与 ${rightProfile.learning.secureRate}%；这只是课堂结果差异，不自动证明因果。`);
  }
  if (leftProfile.nextTrial && rightProfile.nextTrial) observations.push('两次实践都留下了下一轮调整方向，可继续用同一观察指标验证。');
  return normalizeSameLessonComparison({
    status: 'draft',
    sourceKey: sameLessonComparisonSourceKey(left, right),
    lessonIdentity,
    lessonTitle: leftProfile.title,
    left: leftProfile,
    right: rightProfile,
    observations,
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

export function mergeSameLessonComparison(currentValue, submittedValue, { confirm = false, confirmedBy = '', now = new Date().toISOString() } = {}) {
  const current = normalizeSameLessonComparison(currentValue);
  if (current.status === 'confirmed') throw Object.assign(new Error('same_lesson_comparison_confirmed'), { code: 'same_lesson_comparison_confirmed', status: 409 });
  const submitted = normalizeSameLessonComparison(submittedValue);
  const synthesis = {
    ...current.synthesis,
    decision: submitted.synthesis.decision,
    transferableFinding: submitted.synthesis.transferableFinding,
    contextBoundary: submitted.synthesis.contextBoundary,
    nextExperiment: submitted.synthesis.nextExperiment
  };
  if ([synthesis.transferableFinding, synthesis.contextBoundary, synthesis.nextExperiment].some(containsSensitiveIdentifier)) {
    throw Object.assign(new Error('same_lesson_comparison_contains_student_identifier'), { code: 'same_lesson_comparison_contains_student_identifier', status: 422 });
  }
  if (confirm && (synthesis.decision === 'undecided' || !synthesis.transferableFinding || !synthesis.contextBoundary || !synthesis.nextExperiment)) {
    throw Object.assign(new Error('same_lesson_comparison_incomplete'), { code: 'same_lesson_comparison_incomplete', status: 422 });
  }
  return normalizeSameLessonComparison({
    ...current,
    status: confirm ? 'confirmed' : 'draft',
    synthesis,
    updatedAt: now,
    confirmedAt: confirm ? now : null,
    confirmedBy: confirm ? confirmedBy : ''
  });
}

export function sameLessonComparisonIsStale(value, left, right) {
  const comparison = normalizeSameLessonComparison(value);
  return Boolean(comparison.sourceKey && comparison.sourceKey !== sameLessonComparisonSourceKey(left, right));
}
