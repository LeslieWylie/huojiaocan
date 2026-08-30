import { CLASSROOM_PACE_SIGNALS } from './classroom-adaptation.js';

export const CLASSROOM_STAGE_LABELS = ['课题与核心问题', '展开课堂主线', '补充关键依据', '归纳课堂结论', '保留现场生成'];
export const CLASSROOM_MOMENT_TYPES = ['breakthrough', 'confusion', 'question', 'timing'];
const OUTCOMES = new Set(['reached', 'needs_followup', 'not_used']);
const STATUSES = new Set(['idle', 'in_progress', 'pending_review', 'confirmed']);
const MOMENT_TYPES = new Set(CLASSROOM_MOMENT_TYPES);

function stageNumber(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : fallback;
}

function boundedStage(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(5, Math.max(1, Math.trunc(number))) : fallback;
}

function bounded(value, max = 80) {
  return String(value || '').replace(/\u0000/gu, '').trim().slice(0, max);
}

function boundedCharacters(value, max = 80) {
  return Array.from(String(value || '').replace(/\u0000/gu, '').trim()).slice(0, max).join('');
}

function safeShort(value, max = 80) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, max) : '';
}

function elapsedMinutes(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(180, Math.max(0, Math.trunc(number))) : 0;
}

function uniqueId(value, index, ids) {
  const requested = safeShort(value, 80) || `moment-${index + 1}`;
  let id = requested;
  let suffix = 2;
  while (ids.has(id)) {
    const ending = `-${suffix}`;
    id = `${requested.slice(0, 80 - ending.length)}${ending}`;
    suffix += 1;
  }
  ids.add(id);
  return id;
}

function normalizeMoments(value) {
  const ids = new Set();
  return (Array.isArray(value) ? value : []).map((item, index) => {
    if (!item || typeof item !== 'object' || !MOMENT_TYPES.has(item.type)) return null;
    const text = boundedCharacters(item.text, 80);
    if (!text) return null;
    return {
      id: uniqueId(item.id, index, ids),
      type: item.type,
      stage: boundedStage(item.stage),
      text,
      elapsedMinutes: elapsedMinutes(item.elapsedMinutes),
      createdAt: safeShort(item.createdAt, 80) || null
    };
  }).filter(Boolean).slice(0, 24);
}

function confirmedError() {
  return Object.assign(new Error('classroom_run_confirmed'), { code: 'classroom_run_confirmed', status: 409 });
}

export function emptyClassroomRun() {
  return { version: 1, status: 'idle', currentStage: 1, paceSignal: 'on_track', stages: [], keywords: [], usedCards: [], moments: [] };
}

export function normalizeClassroomRun(value = {}, current = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const previous = current && typeof current === 'object' ? current : {};
  if (previous.status === 'confirmed') return normalizeClassroomRun({ ...previous, status: 'confirmed' });
  const requestedStatus = STATUSES.has(source.status) ? source.status : previous.status || 'idle';
  const status = requestedStatus;
  const stageSource = Array.isArray(source.stages) ? source.stages : Array.isArray(previous.stages) ? previous.stages : [];
  const byStage = new Map();
  for (const item of stageSource) {
    const stage = stageNumber(item?.stage, 0);
    if (stage && OUTCOMES.has(item?.outcome)) byStage.set(stage, { stage, outcome: item.outcome });
  }
  const keywordSource = Array.isArray(source.keywords) ? source.keywords : Array.isArray(previous.keywords) ? previous.keywords : [];
  const keywordIds = new Set();
  const keywords = keywordSource.map((item, index) => {
    const requestedId = bounded(item?.id, 80) || `keyword-${index + 1}`;
    const id = keywordIds.has(requestedId) ? `${requestedId}-${index + 1}`.slice(0, 80) : requestedId;
    keywordIds.add(id);
    return { id, stage: stageNumber(item?.stage), text: bounded(item?.text, 16) };
  }).filter(item => item.text).slice(0, 3);
  const cardSource = Array.isArray(source.usedCards) ? source.usedCards : Array.isArray(previous.usedCards) ? previous.usedCards : [];
  const momentSource = Array.isArray(source.moments) ? source.moments : Array.isArray(previous.moments) ? previous.moments : [];
  return {
    version: 1,
    status,
    currentStage: boundedStage(source.currentStage ?? source.stage, boundedStage(previous.currentStage ?? previous.stage)),
    paceSignal: CLASSROOM_PACE_SIGNALS.includes(source.paceSignal)
      ? source.paceSignal
      : CLASSROOM_PACE_SIGNALS.includes(previous.paceSignal) ? previous.paceSignal : 'on_track',
    stages: [...byStage.values()].sort((a, b) => a.stage - b.stage),
    keywords,
    usedCards: [...new Set(cardSource.map(item => bounded(item, 80)).filter(item => ['板书卡', '提问卡', '评价卡'].includes(item)))].slice(0, 3),
    moments: normalizeMoments(momentSource),
    startedAt: bounded(previous.startedAt || source.startedAt) || null,
    updatedAt: bounded(previous.updatedAt || source.updatedAt) || null,
    endedAt: bounded(previous.endedAt || source.endedAt) || null,
    confirmedAt: bounded(previous.confirmedAt || source.confirmedAt) || null
  };
}

export function classroomRunHasContent(value = {}) {
  const run = normalizeClassroomRun(value);
  return Boolean(run.stages.length || run.keywords.length || run.usedCards.length || run.moments.length);
}

export function addClassroomMoment(value, input) {
  const run = normalizeClassroomRun(value);
  if (run.status === 'confirmed') throw confirmedError();
  if (run.moments.length >= 24) return run;
  const requestedId = safeShort(input?.id, 80) || `moment-${Date.now().toString(36)}`;
  return normalizeClassroomRun({
    ...run,
    moments: [...run.moments, { ...input, id: requestedId, createdAt: input?.createdAt ?? new Date().toISOString() }]
  });
}

export function removeClassroomMoment(value, id) {
  const run = normalizeClassroomRun(value);
  if (run.status === 'confirmed') throw confirmedError();
  const requestedId = bounded(id, 80);
  return normalizeClassroomRun({ ...run, moments: run.moments.filter(item => item.id !== requestedId) });
}

export function setClassroomStageOutcome(value, stage, outcome) {
  const run = normalizeClassroomRun(value);
  if (run.status === 'confirmed') throw confirmedError();
  const stages = run.stages.filter(item => item.stage !== stage);
  if (OUTCOMES.has(outcome)) stages.push({ stage, outcome });
  return normalizeClassroomRun({ ...run, stages });
}

export function classroomRunToReflectionSeed(value = {}) {
  const run = normalizeClassroomRun(value);
  const labels = outcome => run.stages.filter(item => item.outcome === outcome).map(item => CLASSROOM_STAGE_LABELS[item.stage - 1]);
  const reached = labels('reached');
  const follow = labels('needs_followup');
  const skipped = labels('not_used');
  const keywords = run.keywords.map(item => item.text);
  const paceNotes = {
    time_short: '课堂时间不足，现场已收束为核心问题和可观察结论。',
    students_stuck: '学生在当前问题上需要更多原文提示和分步追问。',
    ahead: '课堂推进快于预期，已在本篇课文内增加迁移检验。'
  };
  const unresolvedPace = run.paceSignal === 'students_stuck' ? paceNotes.students_stuck : '';
  const pacingNote = paceNotes[run.paceSignal] || '';
  const momentText = type => run.moments.filter(item => item.type === type).map(item => item.text);
  const breakthroughs = momentText('breakthrough');
  const questions = momentText('question');
  const confusions = momentText('confusion');
  const timings = momentText('timing');
  const observedMoments = [...breakthroughs, ...questions];
  return {
    version: 1,
    observedLearning: [reached.length || keywords.length ? `课堂中已推进：${reached.join('、') || '教师记录的现场回答'}` : '', keywords.length ? `学生留下关键词：${keywords.join('、')}` : '', observedMoments.length ? `教师课堂观察：${observedMoments.join('；')}` : ''].filter(Boolean).join('。'),
    unresolvedLearning: [follow.length ? `仍需继续追问：${follow.join('、')}` : '', unresolvedPace, confusions.length ? `教师课堂观察到的困惑：${confusions.join('；')}` : ''].filter(Boolean).join('。'),
    pacingNotes: [skipped.length ? `本节未展开：${skipped.join('、')}` : '', pacingNote, timings.length ? `教师课堂观察到的节奏：${timings.join('；')}` : ''].filter(Boolean).join('。'),
    cardUsage: run.usedCards,
    nextLessonAdjustment: confusions.length ? `下一课先根据教师课堂观察回看“${confusions[0]}”，再决定如何调整。` : follow.length ? `下一课优先回看“${follow[0]}”中的学生回答，再决定如何推进。` : ''
  };
}

export function resolveClassroomRecovery(serverValue = {}, serverVersion = 0, recovery = null) {
  const serverRun = normalizeClassroomRun(serverValue);
  if (!recovery || serverRun.status === 'confirmed') return { classroomRun: serverRun, dirty: false, conflictRun: null, recoveredAcrossVersion: false };
  const localRun = normalizeClassroomRun(recovery.classroomRun || {});
  const baseRun = normalizeClassroomRun(recovery.baseRun || {});
  const sameBase = JSON.stringify(baseRun) === JSON.stringify(serverRun);
  const canResume = Number(recovery.baseVersion) === Number(serverVersion) || sameBase;
  return canResume
    ? { classroomRun: localRun, dirty: JSON.stringify(localRun) !== JSON.stringify(serverRun), conflictRun: null, recoveredAcrossVersion: Number(recovery.baseVersion) !== Number(serverVersion) }
    : { classroomRun: serverRun, dirty: false, conflictRun: localRun, recoveredAcrossVersion: false };
}
