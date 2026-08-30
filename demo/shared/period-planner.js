function compact(value, limit = 500) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function activityText(value) {
  if (typeof value === 'string') return { title: compact(value, 120), detail: '', minutes: null };
  const duration = String(value?.durationMinutes || value?.duration || value?.minutes || '').match(/\d{1,2}/u)?.[0];
  return {
    title: compact(value?.title || value?.name || value?.activity || value?.text || '课堂环节', 120),
    detail: compact(value?.teacherAction || value?.content || value?.description || value?.studentTask, 280),
    minutes: duration ? clamp(duration, 3, 45, 10) : null
  };
}

const PHASE_RULES = [
  { phase: 'opening', rank: 10, pattern: /导入|回顾|激趣|预习|学习目标/u },
  { phase: 'reading', rank: 20, pattern: /通读|诵读|朗读|初读|疏通|字词|文意|正音|停顿/u },
  { phase: 'structure', rank: 30, pattern: /整体感知|梳理|层次|结构|写景|概括/u },
  { phase: 'analysis', rank: 40, pattern: /品味|赏析|语言|比较|细读|情感|意象|迁客骚人/u },
  { phase: 'synthesis', rank: 50, pattern: /背景|主旨|探究|归纳|古仁人|先忧后乐|价值|情怀/u },
  { phase: 'closure', rank: 60, pattern: /小结|总结|作业|拓展|迁移|收束|评价|检测/u }
];

function phaseOf(value) {
  const text = `${value?.title || ''} ${value?.detail || ''}`;
  return PHASE_RULES.find(rule => rule.pattern.test(text)) || { phase: 'other', rank: 35 };
}

function defaultMinutes(value) {
  const phase = phaseOf(value).phase;
  if (phase === 'opening' || phase === 'closure') return 8;
  if (phase === 'reading') return 18;
  if (phase === 'synthesis') return 16;
  return 18;
}

function orderedActivities(values) {
  return values
    .map((item, index) => ({ ...item, originalIndex: index, phase: phaseOf(item) }))
    .sort((a, b) => a.phase.rank - b.phase.rank || a.originalIndex - b.originalIndex);
}

function assignContiguousPeriods(values, periodCount) {
  if (periodCount === 1) return values.map(item => ({ ...item, period: 1 }));
  const total = values.reduce((sum, item) => sum + item.minutes, 0);
  let cursor = 0;
  let elapsed = 0;
  return values.map((item, index) => {
    const remainingItems = values.length - index;
    const remainingPeriods = periodCount - cursor;
    const currentTarget = total * (cursor + 1) / periodCount;
    const canAdvance = cursor < periodCount - 1 && index > 0 && remainingItems >= remainingPeriods;
    const beforeDistance = Math.abs(currentTarget - elapsed);
    const afterDistance = Math.abs(currentTarget - elapsed - item.minutes);
    if (canAdvance && beforeDistance <= afterDistance) cursor += 1;
    elapsed += item.minutes;
    return { ...item, period: cursor + 1 };
  });
}

function sequenceIssues(activities) {
  const ordered = [...activities].sort((a, b) => a.period - b.period || a.order - b.order);
  const issues = [];
  let previous = null;
  for (const item of ordered) {
    const current = phaseOf(item);
    if (previous && current.rank + 5 < previous.phase.rank) {
      issues.push({
        before: previous.item.title,
        after: item.title,
        message: `“${item.title}”应安排在“${previous.item.title}”之前。`
      });
    }
    previous = { item, phase: current };
  }
  return issues;
}

function sourceKey(periods, lessonPlan, periodMinutes = 45) {
  const input = JSON.stringify({
    periods,
    activities: (Array.isArray(lessonPlan) ? lessonPlan : []).map(activityText),
    ...(periodMinutes === 45 ? {} : { periodMinutes })
  });
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `period-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function periodLabel(index, total) {
  if (total === 1) return '本课时';
  return `第 ${index + 1} 课时`;
}

function normalizeActivities(value = [], periods = 1) {
  return (Array.isArray(value) ? value : []).map((item, index) => ({
    id: compact(item?.id, 100) || `activity-${index + 1}`,
    title: compact(item?.title, 120) || `课堂环节 ${index + 1}`,
    detail: compact(item?.detail, 280),
    period: clamp(item?.period, 1, periods, 1),
    minutes: clamp(item?.minutes, 3, 45, 10),
    order: clamp(item?.order, 1, 999, index + 1)
  }));
}

function withSummaries(plan) {
  const periodCount = clamp(plan?.periods, 1, 4, 1);
  const periodMinutes = clamp(plan?.periodMinutes, 35, 60, 45);
  const recommendedMin = Math.max(20, periodMinutes - 13);
  const recommendedMax = Math.max(recommendedMin, periodMinutes - 3);
  const activities = normalizeActivities(plan?.activities, periodCount);
  const periods = Array.from({ length: periodCount }, (_, index) => {
    const number = index + 1;
    const items = activities.filter(item => item.period === number);
    const usedMinutes = items.reduce((sum, item) => sum + item.minutes, 0);
    return {
      number,
      label: periodLabel(index, periodCount),
      targetMinutes: periodMinutes,
      recommendedMin,
      recommendedMax,
      usedMinutes,
      remainingMinutes: periodMinutes - usedMinutes,
      status: usedMinutes > periodMinutes ? 'over' : usedMinutes > recommendedMax ? 'tight' : usedMinutes < recommendedMin ? 'sparse' : 'balanced',
      activities: items
    };
  });
  const orderingIssues = sequenceIssues(activities);
  return {
    version: 1,
    sourceKey: compact(plan?.sourceKey, 80),
    periods: periodCount,
    periodMinutes,
    targetMinutes: periodCount * periodMinutes,
    usedMinutes: activities.reduce((sum, item) => sum + item.minutes, 0),
    activities,
    periodSummaries: periods,
    sequenceIssues: orderingIssues,
    status: orderingIssues.length ? 'sequence' : periods.some(item => item.status === 'over') ? 'over' : periods.some(item => item.status === 'sparse') ? 'sparse' : periods.some(item => item.status === 'tight') ? 'tight' : 'balanced',
    updatedAt: compact(plan?.updatedAt, 60) || null
  };
}

export function buildPeriodPlan({ periods = 1, periodMinutes = 45, lessonPlan = [], existing = null } = {}) {
  const periodCount = clamp(periods, 1, 4, 1);
  const targetMinutes = clamp(periodMinutes, 35, 60, 45);
  const values = Array.isArray(lessonPlan) ? lessonPlan.map(activityText).filter(item => item.title) : [];
  const key = sourceKey(periodCount, values, targetMinutes);
  if (existing?.sourceKey === key && Array.isArray(existing?.activities)) {
    const restored = withSummaries({ ...existing, periods: periodCount, periodMinutes: targetMinutes, sourceKey: key });
    if (existing.updatedAt || !restored.sequenceIssues.length) return restored;
    const sorted = orderedActivities(restored.activities).map((item, index) => ({ ...item, order: index + 1 }));
    return withSummaries({ ...restored, activities: assignContiguousPeriods(sorted, periodCount), sourceKey: key });
  }
  const prepared = orderedActivities(values).map((item, index) => ({
    id: `activity-${item.originalIndex + 1}`,
    title: item.title,
    detail: item.detail,
    minutes: item.minutes || defaultMinutes(item),
    order: index + 1
  }));
  const activities = assignContiguousPeriods(prepared, periodCount);
  return withSummaries({ version: 1, sourceKey: key, periods: periodCount, periodMinutes: targetMinutes, activities, updatedAt: null });
}

export function updatePeriodActivity(plan, activityId, patch = {}) {
  const current = withSummaries(plan || {});
  const id = compact(activityId, 100);
  const activities = current.activities.map(item => item.id !== id ? item : {
    ...item,
    period: patch.period == null ? item.period : clamp(patch.period, 1, current.periods, item.period),
    minutes: patch.minutes == null ? item.minutes : clamp(patch.minutes, 3, 45, item.minutes)
  });
  return withSummaries({ ...current, activities, updatedAt: new Date().toISOString() });
}

export function reorderPeriodActivity(plan, activityId, direction = 'up') {
  const current = withSummaries(plan || {});
  const id = compact(activityId, 100);
  const index = current.activities.findIndex(item => item.id === id);
  if (index < 0) return current;
  const activity = current.activities[index];
  const peers = current.activities
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(entry => entry.item.period === activity.period)
    .sort((left, right) => left.item.order - right.item.order || left.itemIndex - right.itemIndex);
  const peerIndex = peers.findIndex(entry => entry.item.id === id);
  const target = direction === 'down' ? peers[peerIndex + 1] : peers[peerIndex - 1];
  if (!target) return current;
  const activities = [...current.activities];
  [activities[index], activities[target.itemIndex]] = [activities[target.itemIndex], activities[index]];
  return withSummaries({ ...current, activities: activities.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })), updatedAt: new Date().toISOString() });
}

export function repairPeriodSequence(plan) {
  const current = withSummaries(plan || {});
  const sorted = orderedActivities(current.activities).map((item, index) => ({
    id: item.id,
    title: item.title,
    detail: item.detail,
    minutes: item.minutes,
    order: index + 1
  }));
  return withSummaries({ ...current, activities: assignContiguousPeriods(sorted, current.periods), updatedAt: new Date().toISOString() });
}

export function serializePeriodPlan(plan) {
  const current = withSummaries(plan || {});
  return {
    version: 1,
    sourceKey: current.sourceKey,
    periods: current.periods,
    periodMinutes: current.periodMinutes,
    activities: current.activities.map(({ id, title, detail, period, minutes, order }) => ({ id, title, detail, period, minutes, order })),
    updatedAt: new Date().toISOString()
  };
}

export default buildPeriodPlan;
