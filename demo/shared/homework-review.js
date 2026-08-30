function text(value, max = 500) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function number(value, max = 200) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : 0;
}

function uniqueLines(value, maxItems = 6, maxLength = 240) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map(item => text(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

export function homeworkReviewSourceKey(pack = {}, taskId = '') {
  return `review1:${text(pack.sourceKey, 120)}:${text(taskId, 100)}`;
}

export function normalizeHomeworkReview(value = {}) {
  const nextActions = (Array.isArray(value.nextActions) ? value.nextActions : []).slice(0, 5).map((item, index) => ({
    id: text(item?.id || `action-${index + 1}`, 80),
    text: text(item?.text || item, 260)
  })).filter(item => item.text);
  const selected = new Set((Array.isArray(value.selectedActionIds) ? value.selectedActionIds : []).map(String));
  return {
    version: 1,
    status: value.status === 'confirmed' ? 'confirmed' : 'draft',
    sourceKey: text(value.sourceKey, 240),
    taskId: text(value.taskId, 100),
    level: ['A', 'B', 'C'].includes(value.level) ? value.level : 'B',
    label: text(value.label, 80),
    prompt: text(value.prompt, 420),
    responseCount: Math.floor(number(value.responseCount)),
    counts: {
      secure: Math.floor(number(value.counts?.secure)),
      partial: Math.floor(number(value.counts?.partial)),
      notYet: Math.floor(number(value.counts?.notYet))
    },
    averageScore: number(value.averageScore, 100),
    maxScore: number(value.maxScore, 100),
    patterns: uniqueLines(value.patterns, 5, 260),
    nextActions,
    selectedActionIds: nextActions.filter(item => selected.has(item.id)).map(item => item.id),
    teacherNote: text(value.teacherNote, 600),
    updatedAt: value.updatedAt || null,
    confirmedAt: value.confirmedAt || null
  };
}

export function buildHomeworkReview({ pack, task, results, patterns = [], nextActions = [], now = new Date().toISOString() } = {}) {
  const normalizedResults = Array.isArray(results) ? results : [];
  const counts = { secure: 0, partial: 0, notYet: 0 };
  for (const result of normalizedResults) {
    if (result?.status === 'secure') counts.secure += 1;
    else if (result?.status === 'partial') counts.partial += 1;
    else counts.notYet += 1;
  }
  const scoreSum = normalizedResults.reduce((sum, item) => sum + number(item?.score, 100), 0);
  return normalizeHomeworkReview({
    sourceKey: homeworkReviewSourceKey(pack, task?.id), taskId: task?.id, level: task?.level, label: task?.label, prompt: task?.prompt,
    responseCount: normalizedResults.length, counts,
    averageScore: normalizedResults.length ? Math.round(scoreSum * 10 / normalizedResults.length) / 10 : 0,
    maxScore: task?.score, patterns, nextActions: nextActions.map((item, index) => ({ id: `action-${index + 1}`, text: item })),
    updatedAt: now
  });
}

export function homeworkReviewIsStale(draft = {}) {
  const review = normalizeHomeworkReview(draft.answer?.homeworkReview || {});
  const pack = draft.answer?.layeredHomework || {};
  return Boolean(review.sourceKey && review.sourceKey !== homeworkReviewSourceKey(pack, review.taskId));
}

export function mergeHomeworkReview(baseValue, input = {}, { confirm = false, now = new Date().toISOString() } = {}) {
  const base = normalizeHomeworkReview(baseValue);
  if (base.status === 'confirmed') throw Object.assign(new Error('homework_review_confirmed'), { code: 'homework_review_confirmed', status: 409 });
  const validActionIds = new Set(base.nextActions.map(item => item.id));
  const selectedActionIds = [...new Set((Array.isArray(input.selectedActionIds) ? input.selectedActionIds : []).map(String))].filter(id => validActionIds.has(id));
  const next = normalizeHomeworkReview({ ...base, selectedActionIds, teacherNote: input.teacherNote, updatedAt: now });
  if (confirm && (!next.responseCount || !next.teacherNote || !next.selectedActionIds.length)) {
    throw Object.assign(new Error('homework_review_incomplete'), { code: 'homework_review_incomplete', status: 422 });
  }
  if (confirm) { next.status = 'confirmed'; next.confirmedAt = now; }
  return next;
}

export function homeworkReviewCsv(results = []) {
  const escape = value => `"${String(value || '').replaceAll('"', '""')}"`;
  const status = { secure: '已达成', partial: '部分达成', not_yet: '需要支持' };
  return ['序号,状态,得分,满分,已经做到,下一步建议', ...(Array.isArray(results) ? results : []).map(item => [item.sequence, status[item.status] || '需要支持', item.score, item.maxScore, (item.strengths || []).join('；'), item.nextStep].map(escape).join(','))].join('\n');
}

export function homeworkReviewContext(value = {}) {
  const review = normalizeHomeworkReview(value);
  if (review.status !== 'confirmed' || !review.responseCount) return null;
  const selected = new Set(review.selectedActionIds);
  return {
    task: { level: review.level, label: review.label, prompt: review.prompt, maxScore: review.maxScore },
    responseCount: review.responseCount,
    counts: review.counts,
    averageScore: review.averageScore,
    patterns: review.patterns,
    nextActions: review.nextActions.filter(item => selected.has(item.id)).map(item => item.text),
    teacherNote: review.teacherNote
  };
}
