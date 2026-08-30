const MAX_SIGNAL_ITEMS = 6;
const MAX_SIGNAL_LENGTH = 720;
const MAX_CONTEXT_LENGTH = 3200;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value, max = 240) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return Array.from(String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[已移除个人信息]')
    .replace(/(?:^|\D)1[3-9]\d{9}(?=\D|$)/gu, match => match.replace(/\d{11}/u, '[已移除个人信息]'))
    .replace(/(?:^|\D)\d{17}[\dXx](?=\D|$)/gu, match => match.replace(/\d{17}[\dXx]/u, '[已移除个人信息]'))
    .replace(/\s+/gu, ' ')
    .trim()).slice(0, max).join('');
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function validTimestamp(value) {
  const input = text(value, 80);
  return input && Number.isFinite(Date.parse(input)) ? input : null;
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function draftId(draft) {
  return text(draft?.id ?? draft?.draftId, 120);
}

function updatedAt(draft) {
  return [draft?.updated_at, draft?.updatedAt, draft?.created_at, draft?.createdAt]
    .map(validTimestamp).find(Boolean) || null;
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), 'zh-CN');
}

function compareDrafts(left, right) {
  return timestamp(updatedAt(right)) - timestamp(updatedAt(left))
    || compareText(draftId(left), draftId(right))
    || compareText(text(left?.title, 120), text(right?.title, 120));
}

function confirmed(value) {
  return object(value).status === 'confirmed';
}

function teacherReflection(answer) {
  const raw = answer.lessonReflection ?? answer.teachingFeedback;
  const source = object(raw);
  if (source.status && source.status !== 'confirmed') return {};
  return object(source.feedback && typeof source.feedback === 'object' ? source.feedback : source);
}

function selectedHomeworkActions(review) {
  const selected = new Set(list(review.selectedActionIds).map(value => text(value, 80)).filter(Boolean));
  return list(review.nextActions).map((item, index) => {
    const source = typeof item === 'string' ? { id: `action-${index + 1}`, text: item } : object(item);
    return { id: text(source.id || `action-${index + 1}`, 80), text: text(source.text || source.label, 220) };
  }).filter(item => item.text && selected.has(item.id)).map(item => item.text);
}

function evidenceFocus(evidence) {
  const source = object(evidence.summary);
  const items = list(source.focus).length ? source.focus : list(evidence.entries);
  return items.map(item => object(item));
}

function triageSignals(triage) {
  if (!confirmed(triage)) return { observations: [], focus: [] };
  const observations = [];
  const focus = [];
  for (const rawItem of list(triage.items).slice(0, 24)) {
    const item = object(rawItem);
    if (item.resolution === 'dismissed') continue;
    if (item.resolution === 'carryover') {
      const value = text(item.carryoverText, 240);
      if (value) focus.push(value);
    } else if (item.resolution === 'reflection') {
      const value = text(item.text, 180);
      if (value) observations.push(value);
    }
  }
  return { observations, focus };
}

function lessonSignals(draft) {
  const answer = object(draft?.answer);
  const reflection = teacherReflection(answer);
  const review = confirmed(answer.homeworkReview) ? object(answer.homeworkReview) : {};
  const evidence = confirmed(answer.learningEvidence) ? object(answer.learningEvidence) : {};
  const triage = triageSignals(answer.classroomMomentTriage);
  const focus = evidenceFocus(evidence);
  const observations = [
    text(reflection.observedLearning ?? reflection.classResponse, 320),
    ...triage.observations,
    ...focus.map(item => text(item.observedPattern ?? item.misconception, 260)),
    ...list(review.patterns).map(item => text(item, 260))
  ];
  const next = [
    text(reflection.unresolvedLearning ?? reflection.unfinishedQuestions, 320),
    text(reflection.nextLessonAdjustment ?? reflection.nextStep, 320),
    ...triage.focus,
    ...focus.map(item => text(item.teacherAction ?? item.nextAction, 280)),
    ...selectedHomeworkActions(review),
    text(review.teacherNote, 320)
  ];
  return { observations, next, review };
}

function compact(values, { maxItems = MAX_SIGNAL_ITEMS, maxLength = MAX_SIGNAL_LENGTH } = {}) {
  const seen = new Set();
  const result = [];
  let length = 0;
  for (const value of values) {
    const item = text(value, 320);
    if (!item || seen.has(item)) continue;
    const remaining = maxLength - length - (result.length ? 1 : 0);
    if (remaining <= 0) break;
    const clipped = text(item, remaining);
    if (!clipped) break;
    result.push(clipped);
    seen.add(item);
    length += Array.from(clipped).length + (result.length > 1 ? 1 : 0);
    if (result.length >= maxItems) break;
  }
  return result.join('；');
}

function homeworkLine(review) {
  if (!confirmed(review)) return '';
  const count = Number(review.responseCount);
  const counts = object(review.counts);
  const parts = [];
  if (Number.isFinite(count) && count > 0) parts.push(`匿名汇总 ${Math.min(200, Math.floor(count))} 份`);
  const secure = Number(counts.secure);
  const partial = Number(counts.partial);
  const notYet = Number(counts.notYet ?? counts.not_yet);
  if ([secure, partial, notYet].some(Number.isFinite)) {
    parts.push(`已达成 ${Number.isFinite(secure) ? Math.max(0, Math.floor(secure)) : 0}，部分达成 ${Number.isFinite(partial) ? Math.max(0, Math.floor(partial)) : 0}，需要支持 ${Number.isFinite(notYet) ? Math.max(0, Math.floor(notYet)) : 0}`);
  }
  const patterns = compact(list(review.patterns), { maxItems: 2, maxLength: 260 });
  if (patterns) parts.push(`共性：${patterns}`);
  return text(parts.join('；'), 520);
}

function hrefFor(id) {
  return id ? `/ask/?draftId=${encodeURIComponent(id)}` : '';
}

/**
 * Build one privacy-minimized continuity profile per explicit class name.
 * The function reads only teacher reflection and confirmed class aggregates.
 */
export function deriveClassLearningProfiles(lessonDrafts = []) {
  const groups = new Map();
  for (const draft of list(lessonDrafts)) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) continue;
    const context = object(draft.lesson_context);
    const className = text(context.className, 80);
    if (!className) continue;
    if (!groups.has(className)) groups.set(className, []);
    groups.get(className).push(draft);
  }

  return [...groups.entries()].sort(([left], [right]) => compareText(left, right)).map(([className, drafts]) => {
    drafts.sort(compareDrafts);
    const latest = drafts[0] || {};
    const signals = drafts.flatMap(draft => {
      const value = lessonSignals(draft);
      return [{ type: 'observation', values: value.observations }, { type: 'focus', values: value.next }, { type: 'homework', review: value.review }];
    });
    const latestId = draftId(latest);
    return {
      className,
      classLevel: drafts.map(draft => text(object(draft.lesson_context).classLevel, 80)).find(Boolean) || '',
      lessonCount: drafts.length,
      latestLessonTitle: text(latest.title || latest.question, 120),
      latestDraftId: latestId,
      latestUpdatedAt: updatedAt(latest),
      confirmedObservation: compact(signals.filter(item => item.type === 'observation').flatMap(item => item.values)),
      nextFocus: compact(signals.filter(item => item.type === 'focus').flatMap(item => item.values)),
      homeworkSummary: compact(signals.filter(item => item.type === 'homework').map(item => homeworkLine(item.review)), { maxItems: 3, maxLength: 620 }),
      href: hrefFor(latestId)
    };
  });
}

/** Serialize confirmed history for one class for server-side model context. */
export function serializeClassLearningProfile(lessonDrafts, requestedClassName, { maxLength = MAX_CONTEXT_LENGTH } = {}) {
  const className = text(requestedClassName, 80);
  if (!className) return '';
  const profile = deriveClassLearningProfiles(lessonDrafts).find(item => item.className === className);
  if (!profile) return '';
  const lines = [
    `班级接续记忆：${profile.className}${profile.classLevel ? `（${profile.classLevel}）` : ''}`,
    '以下仅是教师确认的既往课堂与匿名班级聚合信息，不是教材依据；教材事实、原文和页码必须重新检索核对。',
    `既往课次：${profile.lessonCount}；最近一课：${profile.latestLessonTitle || '未命名课程'}`,
    profile.confirmedObservation && `已确认观察：${profile.confirmedObservation}`,
    profile.nextFocus && `后续关注：${profile.nextFocus}`,
    profile.homeworkSummary && `匿名作业汇总：${profile.homeworkSummary}`
  ].filter(Boolean);
  const limit = Number.isInteger(maxLength) ? Math.max(1, Math.min(MAX_CONTEXT_LENGTH, maxLength)) : MAX_CONTEXT_LENGTH;
  return text(lines.join('\n'), limit);
}

export const buildClassLearningProfiles = deriveClassLearningProfiles;
export const classLearningProfileContext = serializeClassLearningProfile;
export default deriveClassLearningProfiles;
