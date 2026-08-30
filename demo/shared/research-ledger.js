import { lessonStudyIsStale, normalizeLessonStudy } from './lesson-study.js';
import { normalizeLessonIdentity, normalizeSameLessonComparison, sameLessonComparisonIsStale } from './same-lesson-comparison.js';

function text(value, max = 500) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function lessonTitle(draft = {}) {
  return text(draft.answer?.lesson?.title || draft.answer?.assetMeta?.lessonKey || draft.title || draft.question, 180);
}

function classLabel(draft = {}, fallback = '课堂实践') {
  const context = draft.lesson_context || draft.lessonContext || {};
  return text(context.classLevel || context.class_level || context.level || context.grade || fallback, 100);
}

function href(path, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value));
  return `${path}${query.size ? `?${query}` : ''}`;
}

function sampleFromDraft(draft) {
  const study = normalizeLessonStudy(draft.answer?.lessonStudy || {});
  return {
    draftId: text(draft.id, 120),
    title: lessonTitle(draft),
    label: classLabel(draft),
    finding: study.conclusion.finding.slice(0, 320),
    nextTrial: study.conclusion.nextTrial.slice(0, 320),
    decision: study.conclusion.decision,
    confirmedAt: study.confirmedAt,
    updatedAt: draft.updated_at || draft.updatedAt || null
  };
}

function pairKey(leftId, rightId) {
  return [String(leftId), String(rightId)].sort().join('::');
}

function comparisonFromValue(value, leftDraft, rightDraft) {
  const comparison = normalizeSameLessonComparison(value);
  let stale = true;
  try { stale = !rightDraft || sameLessonComparisonIsStale(comparison, leftDraft, rightDraft); } catch { stale = true; }
  return {
    key: pairKey(leftDraft.id, comparison.right?.draftId),
    leftId: text(leftDraft.id, 120),
    rightId: text(comparison.right?.draftId, 120),
    rightAvailable: Boolean(rightDraft),
    status: comparison.status,
    stale,
    decision: comparison.synthesis.decision,
    transferableFinding: comparison.synthesis.transferableFinding.slice(0, 420),
    nextExperiment: comparison.synthesis.nextExperiment.slice(0, 420),
    contextBoundary: comparison.synthesis.contextBoundary.slice(0, 300),
    confirmedAt: comparison.confirmedAt,
    updatedAt: comparison.updatedAt
  };
}

function nextActionFor(group) {
  const stale = group.comparisons.find(item => item.stale);
  if (stale) return stale.rightAvailable
    ? { type: 'refresh_comparison', label: '按最新课堂重新对照', note: '其中一次课堂事实已经变化，旧命题不能继续作为当前结论。', href: href('/compare/', { left: stale.leftId, right: stale.rightId }) }
    : { type: 'refresh_comparison', label: '重新选择课堂样本', note: '原对照中的一份课堂记录已经不存在，需要从教研资产中重新选择。', href: '/assets/' };
  const draft = group.comparisons.find(item => item.status === 'draft');
  if (draft) return { type: 'finish_comparison', label: '继续完成同课对照', note: '两次课堂已经并列，仍等待教师写清适用边界和下一次验证。', href: href('/compare/', { left: draft.leftId, right: draft.rightId }) };
  const needsMore = group.comparisons.find(item => item.status === 'confirmed' && item.decision === 'needs_more');
  if (needsMore) return { type: 'continue_validation', label: '查看待验证命题', note: needsMore.nextExperiment || '按已确认的变量设计下一次课堂。', href: href('/compare/', { left: needsMore.leftId, right: needsMore.rightId }) };
  if (group.readyPair) return { type: 'start_comparison', label: '开始同课对照', note: '已有两次同篇目课堂，可以比较差异并形成教研命题。', href: href('/compare/', { left: group.readyPair.leftId, right: group.readyPair.rightId }) };
  const confirmed = group.comparisons.find(item => item.status === 'confirmed');
  if (confirmed) return { type: 'review_hypothesis', label: '查看已确认命题', note: confirmed.transferableFinding || '这篇课文已经形成教师确认的跨课堂判断。', href: href('/compare/', { left: confirmed.leftId, right: confirmed.rightId }) };
  const sample = group.samples[0];
  return { type: 'collect_second_sample', label: '准备下一次课堂实践', note: '目前只有一次确认记录；下一次保持观察指标一致，才有条件进行对照。', href: sample ? href('/study/', { draftId: sample.draftId }) : '/assets/' };
}

export function buildResearchLedger(drafts = []) {
  const owned = (Array.isArray(drafts) ? drafts : []).filter(draft => draft?.id);
  const byId = new Map(owned.map(draft => [String(draft.id), draft]));
  const groups = new Map();
  for (const draft of owned) {
    const study = normalizeLessonStudy(draft.answer?.lessonStudy || {});
    if (study.status !== 'confirmed' || lessonStudyIsStale(draft)) continue;
    const title = lessonTitle(draft);
    const identity = normalizeLessonIdentity(title);
    if (!identity) continue;
    if (!groups.has(identity)) groups.set(identity, { lessonIdentity: identity, lessonTitle: title, samples: [], comparisons: [], readyPair: null, nextAction: null, updatedAt: null });
    const group = groups.get(identity);
    group.samples.push(sampleFromDraft(draft));
    const comparisons = Array.isArray(draft.answer?.sameLessonComparisons) ? draft.answer.sameLessonComparisons : [];
    for (const value of comparisons) {
      const rightId = normalizeSameLessonComparison(value).right?.draftId;
      const right = byId.get(String(rightId));
      if (right && normalizeLessonIdentity(lessonTitle(right)) !== identity) continue;
      group.comparisons.push(comparisonFromValue(value, draft, right));
    }
  }

  for (const group of groups.values()) {
    group.samples.sort((left, right) => String(right.confirmedAt || right.updatedAt || '').localeCompare(String(left.confirmedAt || left.updatedAt || '')));
    const uniqueComparisons = new Map();
    for (const comparison of group.comparisons) uniqueComparisons.set(comparison.key, comparison);
    group.comparisons = [...uniqueComparisons.values()].sort((left, right) => String(right.confirmedAt || right.updatedAt || '').localeCompare(String(left.confirmedAt || left.updatedAt || '')));
    const comparedPairs = new Set(group.comparisons.map(item => item.key));
    outer: for (let leftIndex = 0; leftIndex < group.samples.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.samples.length; rightIndex += 1) {
        const leftId = group.samples[leftIndex].draftId;
        const rightId = group.samples[rightIndex].draftId;
        if (!comparedPairs.has(pairKey(leftId, rightId))) {
          group.readyPair = { leftId, rightId };
          break outer;
        }
      }
    }
    group.updatedAt = [
      ...group.samples.map(item => item.confirmedAt || item.updatedAt),
      ...group.comparisons.map(item => item.confirmedAt || item.updatedAt)
    ].filter(Boolean).sort().at(-1) || null;
    group.nextAction = nextActionFor(group);
  }

  const items = [...groups.values()].sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  return {
    version: 1,
    items,
    summary: {
      lessonCount: items.length,
      sampleCount: items.reduce((sum, item) => sum + item.samples.length, 0),
      confirmedHypothesisCount: items.reduce((sum, item) => sum + item.comparisons.filter(comparison => comparison.status === 'confirmed' && !comparison.stale).length, 0),
      readyToCompareCount: items.filter(item => item.nextAction?.type === 'start_comparison').length,
      needsValidationCount: items.filter(item => ['continue_validation', 'refresh_comparison', 'finish_comparison'].includes(item.nextAction?.type)).length
    }
  };
}
