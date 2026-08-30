import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPreviousLessonCarryover,
  classroomMomentSourceKey,
  classroomMomentTriageIsStale,
  defaultClassroomMomentTriage,
  mergeClassroomMomentTriage,
  normalizeClassroomMomentTriage,
  normalizePreviousLessonCarryover,
  updatePreviousLessonCarryover
} from './classroom-carryover.js';

const run = { moments: [
  { id: 'b1', type: 'breakthrough', stage: 2, text: '学生主动连起意象与情感', elapsedMinutes: 12 },
  { id: 'q1', type: 'question', stage: 3, text: '学生追问结尾语气', elapsedMinutes: 20 },
  { id: 'c1', type: 'confusion', stage: 3, text: '仍混淆作者与抒情主人公', elapsedMinutes: 24 },
  { id: 't1', type: 'timing', stage: 4, text: '讨论多用了三分钟', elapsedMinutes: 35 }
] };

test('classroom moment source key is stable and changes with source moments', () => {
  assert.equal(classroomMomentSourceKey(run), classroomMomentSourceKey({ ...run }));
  assert.notEqual(classroomMomentSourceKey(run), classroomMomentSourceKey({ moments: [...run.moments, { id: 'new', type: 'question', text: '新问题' }] }));
});

test('default triage sends each moment type to its factual reflection field', () => {
  const triage = defaultClassroomMomentTriage(run);
  assert.equal(triage.status, 'draft');
  assert.deepEqual(triage.items.map(item => [item.sourceMomentId, item.reflectionField, item.resolution]), [
    ['b1', 'observedLearning', 'reflection'],
    ['q1', 'observedLearning', 'reflection'],
    ['c1', 'unresolvedLearning', 'reflection'],
    ['t1', 'pacingNotes', 'reflection']
  ]);
});

test('normalization trusts run facts, bounds strings, de-duplicates ids and limits decisions', () => {
  const veryLong = '跟'.repeat(300);
  const normalized = normalizeClassroomMomentTriage({
    sourceKey: classroomMomentSourceKey(run),
    items: [
      { sourceMomentId: 'c1', resolution: 'carryover', carryoverText: veryLong },
      { sourceMomentId: 'c1', resolution: 'dismissed', carryoverText: '不应覆盖' },
      { sourceMomentId: 'forged', resolution: 'carryover', carryoverText: '伪造事项' }
    ]
  }, run);
  assert.equal(normalized.items.length, 4);
  assert.equal(normalized.items.find(item => item.sourceMomentId === 'c1').resolution, 'carryover');
  assert.equal(Array.from(normalized.items.find(item => item.sourceMomentId === 'c1').carryoverText).length, 240);
  assert.equal(normalized.items.some(item => item.sourceMomentId === 'forged'), false);
});

test('merge validates carryover text, detects stale sources and locks confirmation', () => {
  const base = defaultClassroomMomentTriage(run);
  assert.throws(() => mergeClassroomMomentTriage(base, { items: [{ sourceMomentId: 'c1', resolution: 'carryover', carryoverText: '三字不' }] }, run, { confirm: true }), {
    code: 'classroom_moment_triage_incomplete', status: 422
  });
  const confirmed = mergeClassroomMomentTriage(base, { items: [{ sourceMomentId: 'c1', resolution: 'carryover', carryoverText: '下节先回看人称关系' }] }, run, { confirm: true, now: '2026-08-27T08:00:00Z' });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.confirmedAt, '2026-08-27T08:00:00Z');
  assert.throws(() => mergeClassroomMomentTriage(confirmed, confirmed, run), { code: 'classroom_moment_triage_confirmed', status: 409 });
  const changedRun = { moments: [...run.moments, { id: 'new', type: 'question', text: '又有新问题' }] };
  assert.equal(classroomMomentTriageIsStale({ answer: { classroomMomentTriage: confirmed, classroomRun: changedRun } }), true);
  assert.throws(() => mergeClassroomMomentTriage(base, base, changedRun), { code: 'classroom_moment_triage_stale', status: 409 });
});

test('carryover copies only selected work with the narrow item contract', () => {
  const triage = mergeClassroomMomentTriage(defaultClassroomMomentTriage(run), { items: [
    { sourceMomentId: 'b1', resolution: 'dismissed' },
    { sourceMomentId: 'c1', resolution: 'carryover', carryoverText: '下节先回看人称关系' }
  ] }, run, { confirm: true, now: 'confirmed-time' });
  const carryover = buildPreviousLessonCarryover(triage, run, { sourceDraftId: 'draft-1', sourceVersion: 7, now: 'copied-time' });
  assert.deepEqual(carryover.items, [{ sourceMomentId: 'c1', text: '下节先回看人称关系', status: 'todo', completedAt: null }]);
  assert.equal(carryover.sourceDraftId, 'draft-1');
  assert.equal(carryover.sourceVersion, 7);
  assert.equal(carryover.status, 'active');
});

test('previous lesson carryover is bounded, de-duplicated and derives overall status', () => {
  const normalized = normalizePreviousLessonCarryover({ items: [
    { sourceMomentId: 'same', text: '保留的文字', status: 'done', completedAt: 'done-time' },
    { sourceMomentId: 'same', text: '不应覆盖', status: 'todo' },
    { sourceMomentId: '', text: '无效', status: 'done' }
  ], status: 'active' });
  assert.deepEqual(normalized.items, [{ sourceMomentId: 'same', text: '保留的文字', status: 'done', completedAt: 'done-time' }]);
  assert.equal(normalized.status, 'completed');
});

test('carryover updates only todo/done state, preserves text and updates the aggregate', () => {
  const value = normalizePreviousLessonCarryover({ items: [
    { sourceMomentId: 'c1', text: '原文不能改', status: 'todo' },
    { sourceMomentId: 'q1', text: '另一个任务', status: 'done', completedAt: 'earlier' }
  ] });
  const completed = updatePreviousLessonCarryover(value, 'c1', 'done', { now: 'now' });
  assert.equal(completed.items[0].text, '原文不能改');
  assert.equal(completed.items[0].completedAt, 'now');
  assert.equal(completed.status, 'completed');
  const active = updatePreviousLessonCarryover(completed, 'q1', 'todo', { now: 'later' });
  assert.equal(active.items[1].completedAt, null);
  assert.equal(active.status, 'active');
  assert.throws(() => updatePreviousLessonCarryover(active, 'c1', 'deleted'), { code: 'classroom_carryover_status_invalid', status: 422 });
  assert.throws(() => updatePreviousLessonCarryover(active, 'missing', 'done'), { code: 'classroom_carryover_not_found', status: 404 });
});
