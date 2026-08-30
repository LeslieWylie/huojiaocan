import assert from 'node:assert/strict';
import test from 'node:test';
import { CLASSROOM_MOMENT_TYPES, addClassroomMoment, classroomRunHasContent, classroomRunToReflectionSeed, normalizeClassroomRun, removeClassroomMoment, resolveClassroomRecovery, setClassroomStageOutcome } from './classroom-run.js';

test('classroom run keeps only three short keywords and valid stage outcomes', () => {
  const run = normalizeClassroomRun({
    status: 'in_progress', currentStage: 9,
    stages: [{ stage: 2, outcome: 'reached' }, { stage: 2, outcome: 'needs_followup' }, { stage: 3, outcome: 'forged' }],
    keywords: [{ id: 'k1', stage: 2, text: '土地、河流、黎明超过十六个字会截断' }, { id: 'k2', stage: 3, text: '象征关系' }, { id: 'k3', stage: 4, text: '直抒胸臆' }, { id: 'k4', stage: 5, text: '第四条' }],
    usedCards: ['板书卡', '提问卡', '伪造卡片', '板书卡']
  });
  assert.equal(run.currentStage, 5);
  assert.deepEqual(run.usedCards, ['板书卡', '提问卡']);
  assert.deepEqual(run.stages, [{ stage: 2, outcome: 'needs_followup' }]);
  assert.equal(run.keywords.length, 3);
  assert.ok(Array.from(run.keywords[0].text).length <= 16);
  assert.equal(classroomRunHasContent(run), true);
});

test('classroom run keeps only a supported classroom pace signal', () => {
  assert.equal(normalizeClassroomRun({ paceSignal: 'students_stuck' }).paceSignal, 'students_stuck');
  assert.equal(normalizeClassroomRun({ paceSignal: 'invented' }).paceSignal, 'on_track');
  assert.equal(normalizeClassroomRun({ paceSignal: 'invented' }, { paceSignal: 'time_short' }).paceSignal, 'time_short');
});

test('each classroom stage keeps only its latest outcome', () => {
  const reached = setClassroomStageOutcome({}, 3, 'reached');
  const changed = setClassroomStageOutcome(reached, 3, 'needs_followup');
  assert.deepEqual(changed.stages, [{ stage: 3, outcome: 'needs_followup' }]);
});

test('a teacher-confirmed classroom run cannot be reopened by an ordinary save', () => {
  const confirmed = normalizeClassroomRun({ status: 'confirmed', currentStage: 5, confirmedAt: 'server-time', moments: [{ id: 'kept', type: 'confusion', stage: 2, text: '保留原记录', elapsedMinutes: 12 }] });
  const run = normalizeClassroomRun({ status: 'in_progress', currentStage: 2, moments: [] }, confirmed);
  assert.equal(run.status, 'confirmed');
  assert.equal(run.confirmedAt, 'server-time');
  assert.equal(run.moments[0].text, '保留原记录');
  assert.throws(() => addClassroomMoment(confirmed, { type: 'question', text: '不能新增' }), { code: 'classroom_run_confirmed', status: 409 });
  assert.throws(() => removeClassroomMoment(confirmed, 'kept'), { code: 'classroom_run_confirmed', status: 409 });
  assert.throws(() => setClassroomStageOutcome(confirmed, 2, 'reached'), { code: 'classroom_run_confirmed', status: 409 });
});

test('classroom moments are normalized, bounded, unique and limited to 24', () => {
  assert.deepEqual(CLASSROOM_MOMENT_TYPES, ['breakthrough', 'confusion', 'question', 'timing']);
  const moments = Array.from({ length: 26 }, (_, index) => ({
    id: 'same', type: CLASSROOM_MOMENT_TYPES[index % 4], stage: index === 0 ? -4 : 99,
    text: index === 0 ? `${'课'.repeat(79)}🙂🙂` : `观察${index}`,
    elapsedMinutes: index === 0 ? -2.8 : 999.9, createdAt: index === 0 ? { unsafe: true } : `time-${index}`
  }));
  moments.splice(4, 0, { id: 'invalid', type: 'praise', text: '无效类型' });
  const run = normalizeClassroomRun({ moments });
  assert.equal(run.moments.length, 24);
  assert.equal(new Set(run.moments.map(item => item.id)).size, 24);
  assert.equal(Array.from(run.moments[0].text).length, 80);
  assert.deepEqual(run.moments[0], { id: 'same', type: 'breakthrough', stage: 1, text: `${'课'.repeat(79)}🙂`, elapsedMinutes: 0, createdAt: null });
  assert.equal(run.moments[1].stage, 5);
  assert.equal(run.moments[1].elapsedMinutes, 180);
  assert.equal(classroomRunHasContent({ moments: [moments[1]] }), true);
  assert.deepEqual(normalizeClassroomRun({ status: 'in_progress' }).moments, []);
});

test('classroom moments can be added and removed with server-normalized ids', () => {
  const first = addClassroomMoment({}, { id: ' no\nte ', type: 'question', stage: 3, text: ' 为什么这里转折？ ', elapsedMinutes: 17.9, createdAt: ' no\tw ' });
  const second = addClassroomMoment(first, { id: 'note', type: 'timing', stage: 4, text: '讨论多用了两分钟', elapsedMinutes: 181 });
  assert.equal(first.moments[0].id, 'note');
  assert.equal(second.moments[1].id, 'note-2');
  assert.equal(second.moments[0].elapsedMinutes, 17);
  assert.equal(second.moments[0].createdAt, 'now');
  assert.deepEqual(removeClassroomMoment(second, 'note').moments.map(item => item.id), ['note-2']);
});

test('classroom facts seed reflection without pretending to be textbook evidence', () => {
  const reflection = classroomRunToReflectionSeed({
    stages: [{ stage: 2, outcome: 'reached' }, { stage: 3, outcome: 'needs_followup' }, { stage: 4, outcome: 'not_used' }],
    keywords: [{ id: 'k1', stage: 2, text: '土地、黎明' }], usedCards: ['提问卡']
  });
  assert.match(reflection.observedLearning, /展开课堂主线/u);
  assert.match(reflection.observedLearning, /土地、黎明/u);
  assert.match(reflection.unresolvedLearning, /补充关键依据/u);
  assert.match(reflection.pacingNotes, /归纳课堂结论/u);
  assert.deepEqual(reflection.cardUsage, ['提问卡']);
  assert.match(reflection.nextLessonAdjustment, /下一课优先/u);
});

test('classroom moments seed reflection explicitly as teacher observations', () => {
  const reflection = classroomRunToReflectionSeed({ moments: [
    { id: 'm1', type: 'breakthrough', stage: 2, text: '学生主动连起意象与情感', elapsedMinutes: 12 },
    { id: 'm2', type: 'question', stage: 3, text: '学生追问结尾语气', elapsedMinutes: 20 },
    { id: 'm3', type: 'confusion', stage: 3, text: '仍混淆作者与抒情主人公', elapsedMinutes: 24 },
    { id: 'm4', type: 'confusion', stage: 4, text: '第二个困惑', elapsedMinutes: 28 },
    { id: 'm5', type: 'timing', stage: 4, text: '同伴讨论比预期多三分钟', elapsedMinutes: 35 }
  ] });
  assert.match(reflection.observedLearning, /教师课堂观察.*主动连起.*学生追问/u);
  assert.match(reflection.unresolvedLearning, /教师课堂观察到的困惑.*仍混淆/u);
  assert.match(reflection.pacingNotes, /教师课堂观察到的节奏.*多三分钟/u);
  assert.match(reflection.nextLessonAdjustment, /教师课堂观察.*仍混淆作者与抒情主人公/u);
  assert.doesNotMatch(reflection.nextLessonAdjustment, /第二个困惑/u);
});

test('classroom pace becomes a factual reflection note', () => {
  const short = classroomRunToReflectionSeed({ paceSignal: 'time_short' });
  assert.match(short.pacingNotes, /时间不足/u);
  const stuck = classroomRunToReflectionSeed({ paceSignal: 'students_stuck' });
  assert.match(stuck.unresolvedLearning, /分步追问/u);
  const ahead = classroomRunToReflectionSeed({ paceSignal: 'ahead' });
  assert.match(ahead.pacingNotes, /迁移检验/u);
});

test('invalid stages are ignored and duplicate keyword ids become unique', () => {
  const run = normalizeClassroomRun({
    currentStage: 99,
    stages: [{ stage: 0, outcome: 'reached' }, { stage: 2, outcome: 'reached' }],
    keywords: [{ id: 'same', stage: 99, text: '甲' }, { id: 'same', stage: 2, text: '乙' }]
  });
  assert.equal(run.currentStage, 5);
  assert.deepEqual(run.stages, [{ stage: 2, outcome: 'reached' }]);
  assert.equal(run.keywords[0].stage, 1);
  assert.notEqual(run.keywords[0].id, run.keywords[1].id);
});

test('stale local classroom facts are recoverable when the server classroom has not changed', () => {
  const baseRun = normalizeClassroomRun({ status: 'in_progress', currentStage: 2, keywords: [] });
  const localRun = normalizeClassroomRun({ ...baseRun, currentStage: 3, keywords: [{ id: 'k1', stage: 3, text: '学生关键词' }] }, baseRun);
  const recovered = resolveClassroomRecovery(baseRun, 9, { baseVersion: 8, baseRun, classroomRun: localRun });
  assert.equal(recovered.dirty, true);
  assert.equal(recovered.recoveredAcrossVersion, true);
  assert.equal(recovered.classroomRun.keywords[0].text, '学生关键词');
});

test('different server and local classroom facts are preserved as an explicit conflict', () => {
  const baseRun = normalizeClassroomRun({ status: 'in_progress', currentStage: 1 });
  const serverRun = normalizeClassroomRun({ ...baseRun, currentStage: 2, stages: [{ stage: 2, outcome: 'reached' }] }, baseRun);
  const localRun = normalizeClassroomRun({ ...baseRun, currentStage: 3, keywords: [{ id: 'k1', stage: 3, text: '本机记录' }] }, baseRun);
  const recovered = resolveClassroomRecovery(serverRun, 10, { baseVersion: 8, baseRun, classroomRun: localRun });
  assert.equal(recovered.dirty, false);
  assert.equal(recovered.classroomRun.currentStage, 2);
  assert.equal(recovered.conflictRun.keywords[0].text, '本机记录');
});
