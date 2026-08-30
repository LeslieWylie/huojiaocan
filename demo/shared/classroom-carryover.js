import { normalizeClassroomRun } from './classroom-run.js';

const RESOLUTIONS = new Set(['reflection', 'carryover', 'dismissed']);
const ITEM_STATUSES = new Set(['todo', 'done']);
const REFLECTION_FIELDS = Object.freeze({
  breakthrough: 'observedLearning',
  question: 'observedLearning',
  confusion: 'unresolvedLearning',
  timing: 'pacingNotes'
});

function text(value, max = 240) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return Array.from(String(value).replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim()).slice(0, max).join('');
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function error(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function sourceItems(run) {
  return normalizeClassroomRun(run).moments.map(moment => ({
    sourceMomentId: text(moment.id, 80),
    type: moment.type,
    stage: moment.stage,
    text: text(moment.text, 80),
    elapsedMinutes: moment.elapsedMinutes,
    reflectionField: REFLECTION_FIELDS[moment.type]
  }));
}

function submittedByMoment(value) {
  const result = new Map();
  for (const item of Array.isArray(value?.items) ? value.items : []) {
    const id = text(item?.sourceMomentId, 80);
    if (id && !result.has(id)) result.set(id, item);
  }
  return result;
}

export function classroomMomentSourceKey(run = {}) {
  const serialized = JSON.stringify(sourceItems(run).map(item => [
    item.sourceMomentId,
    item.type,
    item.stage,
    item.text,
    item.elapsedMinutes
  ]));
  return `cmt1:${stableHash(serialized)}${stableHash([...serialized].reverse().join(''))}`;
}

export function defaultClassroomMomentTriage(run = {}) {
  const sourceKey = classroomMomentSourceKey(run);
  return {
    version: 1,
    status: 'draft',
    sourceKey,
    items: sourceItems(run).map(item => ({
      ...item,
      resolution: 'reflection',
      carryoverText: ''
    })),
    updatedAt: null,
    confirmedAt: null
  };
}

export function normalizeClassroomMomentTriage(value = {}, run = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const submitted = submittedByMoment(source);
  const items = sourceItems(run).map(moment => {
    const input = submitted.get(moment.sourceMomentId) || {};
    return {
      ...moment,
      resolution: RESOLUTIONS.has(input.resolution) ? input.resolution : 'reflection',
      carryoverText: text(input.carryoverText, 240)
    };
  });
  const status = source.status === 'confirmed' ? 'confirmed' : 'draft';
  return {
    version: 1,
    status,
    sourceKey: text(source.sourceKey, 80) || classroomMomentSourceKey(run),
    items,
    updatedAt: text(source.updatedAt, 80) || null,
    confirmedAt: status === 'confirmed' ? text(source.confirmedAt, 80) || null : null
  };
}

export function classroomMomentTriageIsStale(value = {}, run) {
  if (value?.answer && run === undefined) {
    const triage = value.answer.classroomMomentTriage;
    const classroomRun = value.answer.classroomRun || {};
    return Boolean(triage && text(triage.sourceKey, 80) !== classroomMomentSourceKey(classroomRun));
  }
  return Boolean(value && text(value.sourceKey, 80) !== classroomMomentSourceKey(run || {}));
}

export function mergeClassroomMomentTriage(base, input, run = {}, { confirm = false, now = new Date().toISOString() } = {}) {
  const current = normalizeClassroomMomentTriage(base, run);
  if (current.status === 'confirmed') throw error('classroom_moment_triage_confirmed', 409);
  if (classroomMomentTriageIsStale(current, run)) throw error('classroom_moment_triage_stale', 409);

  const submitted = submittedByMoment(input);
  const items = current.items.map(item => {
    const update = submitted.get(item.sourceMomentId);
    if (!update) return item;
    return {
      ...item,
      resolution: RESOLUTIONS.has(update.resolution) ? update.resolution : item.resolution,
      carryoverText: text(update.carryoverText, 240)
    };
  });
  if (confirm && items.some(item => item.resolution === 'carryover' && Array.from(item.carryoverText).length < 4)) {
    throw error('classroom_moment_triage_incomplete', 422);
  }
  const timestamp = text(now, 80) || null;
  return normalizeClassroomMomentTriage({
    ...current,
    status: confirm ? 'confirmed' : 'draft',
    items,
    updatedAt: timestamp,
    confirmedAt: confirm ? timestamp : null
  }, run);
}

export function buildPreviousLessonCarryover(triage, run = {}, { sourceDraftId = '', sourceVersion = 1, now = new Date().toISOString() } = {}) {
  const normalized = normalizeClassroomMomentTriage(triage, run);
  const seenIds = new Set();
  const items = [];
  for (const item of normalized.items) {
    if (item.resolution !== 'carryover' || Array.from(item.carryoverText).length < 4 || seenIds.has(item.sourceMomentId)) continue;
    seenIds.add(item.sourceMomentId);
    items.push({ sourceMomentId: item.sourceMomentId, text: item.carryoverText, status: 'todo', completedAt: null });
  }
  const timestamp = text(now, 80) || null;
  return normalizePreviousLessonCarryover({
    version: 1,
    sourceDraftId: text(sourceDraftId, 120),
    sourceVersion,
    sourceKey: normalized.sourceKey,
    status: 'active',
    items,
    recordedAt: timestamp,
    updatedAt: timestamp
  });
}

export function normalizePreviousLessonCarryover(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const seenIds = new Set();
  const items = [];
  for (const item of Array.isArray(source.items) ? source.items : []) {
    const sourceMomentId = text(item?.sourceMomentId, 80);
    const itemText = text(item?.text, 240);
    if (!sourceMomentId || !itemText || seenIds.has(sourceMomentId)) continue;
    seenIds.add(sourceMomentId);
    const status = ITEM_STATUSES.has(item?.status) ? item.status : 'todo';
    items.push({
      sourceMomentId,
      text: itemText,
      status,
      completedAt: status === 'done' ? text(item?.completedAt, 80) || null : null
    });
    if (items.length >= 24) break;
  }
  return {
    version: 1,
    sourceDraftId: text(source.sourceDraftId, 120),
    sourceVersion: Number.isInteger(Number(source.sourceVersion)) && Number(source.sourceVersion) >= 0 ? Number(source.sourceVersion) : 1,
    sourceKey: text(source.sourceKey, 80),
    status: items.length > 0 && items.every(item => item.status === 'done') ? 'completed' : 'active',
    items,
    recordedAt: text(source.recordedAt, 80) || null,
    updatedAt: text(source.updatedAt, 80) || null
  };
}

export function updatePreviousLessonCarryover(value, sourceMomentId, status, { now = new Date().toISOString() } = {}) {
  const current = normalizePreviousLessonCarryover(value);
  if (!ITEM_STATUSES.has(status)) throw error('classroom_carryover_status_invalid', 422);
  const requestedId = text(sourceMomentId, 80);
  if (!current.items.some(item => item.sourceMomentId === requestedId)) throw error('classroom_carryover_not_found', 404);
  const timestamp = text(now, 80) || null;
  return normalizePreviousLessonCarryover({
    ...current,
    items: current.items.map(item => item.sourceMomentId !== requestedId ? item : {
      ...item,
      status,
      completedAt: status === 'done' ? item.completedAt || timestamp : null
    }),
    updatedAt: timestamp
  });
}
