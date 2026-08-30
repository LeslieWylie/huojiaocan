import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveTeachingTasks, TEACHING_TASK_PHASES } from './teaching-task-flow.js';

function draft(id, answer = {}, cards = [], updatedAt = '2026-08-27T08:00:00Z') {
  return { id, title: `课文 ${id}`, answer, cards, updated_at: updatedAt };
}

test('empty input has no invented task', () => {
  assert.deepEqual(deriveTeachingTasks(), []);
  assert.deepEqual(deriveTeachingTasks({ drafts: [], assets: [] }), []);
});

test('legacy drafts with persisted cards skip the newer approval contract', () => {
  const [task] = deriveTeachingTasks([draft('legacy', { summary: '旧版已保存方案' }, [{ type: 'question', status: 'draft' }])]);
  assert.equal(task.phase, TEACHING_TASK_PHASES.ENTER_CLASSROOM);
  assert.equal(task.title, '进入课堂');
  assert.equal(task.draftId, 'legacy');
  assert.equal(task.lessonTitle, '课文 legacy');
  assert.equal(task.updatedAt, '2026-08-27T08:00:00Z');
  assert.equal(task.href, '/cards/?draftId=legacy&classroom=1');
});

test('locked classroom cards are ready to enter class', () => {
  const [task] = deriveTeachingTasks([draft('locked', {
    planApproval: { status: 'confirmed', hasUnconfirmedChanges: false }
  }, [{ type: 'board', status: 'locked' }])]);
  assert.equal(task.phase, TEACHING_TASK_PHASES.ENTER_CLASSROOM);
  assert.match(task.description, /教师锁定/u);
  assert.equal(task.actionLabel, '进入课堂');
});

test('a classroom waiting for review blocks other downstream work', () => {
  const [task] = deriveTeachingTasks([draft('classroom', {
    planApproval: { status: 'changes_pending', hasUnconfirmedChanges: true },
    classroomRun: { status: 'pending_review', endedAt: '2026-08-27T07:00:00Z' },
    layeredHomework: { status: 'confirmed', tasks: [{ id: 'A' }] }
  }, [{ type: 'board', status: 'locked' }])]);
  assert.equal(task.phase, TEACHING_TASK_PHASES.CONFIRM_REFLECTION);
  assert.equal(task.href, '/reflection/?draftId=classroom');
});

test('unfinished carryover stays visible before ordinary preparation and sorts as a blocker', () => {
  const tasks = deriveTeachingTasks([
    draft('ordinary', {}, [], '2026-08-27T10:00:00Z'),
    draft('relay', { previousLessonCarryover: {
      status: 'active',
      items: [{ sourceMomentId: 'm1', text: '先画关系图', status: 'todo' }]
    } }, [], '2026-08-26T08:00:00Z')
  ]);
  assert.deepEqual(tasks.map(item => item.draftId), ['relay', 'ordinary']);
  assert.equal(tasks[0].phase, TEACHING_TASK_PHASES.CONTINUE_PREPARATION);
  assert.equal(tasks[0].actionLabel, '处理接力事项');
});

test('all workflow phases derive only from persisted draft fields', () => {
  const confirmed = { planApproval: { status: 'confirmed', hasUnconfirmedChanges: false } };
  const reflected = { classroomRun: { status: 'confirmed' }, lessonReflection: { observedLearning: '学生能引用原文' } };
  const source = draft('source', { ...reflected, homeworkReview: { status: 'confirmed', responseCount: 20 } }, [{ status: 'locked' }]);
  const successor = draft('successor', { unitContinuity: { sourceDraftId: 'source', nextLessonTitle: '第三课' } });
  const tasks = deriveTeachingTasks([
    draft('preparation'),
    draft('approval', { planApproval: { status: 'changes_pending', hasUnconfirmedChanges: true } }),
    draft('cards', confirmed),
    draft('class', confirmed, [{ status: 'locked' }]),
    draft('reflection', { classroomRun: { status: 'pending_review' } }, [{ status: 'locked' }]),
    draft('homework', { ...reflected, layeredHomework: { status: 'confirmed', tasks: [{ id: 'A' }] } }, [{ status: 'locked' }]),
    draft('next', reflected, [{ status: 'locked' }]),
    source,
    successor
  ]);
  const byId = new Map(tasks.map(item => [item.draftId, item]));
  assert.equal(byId.get('preparation').phase, TEACHING_TASK_PHASES.CONTINUE_PREPARATION);
  assert.equal(byId.get('approval').phase, TEACHING_TASK_PHASES.CONFIRM_PLAN);
  assert.equal(byId.get('cards').phase, TEACHING_TASK_PHASES.GENERATE_CARDS);
  assert.equal(byId.get('class').phase, TEACHING_TASK_PHASES.ENTER_CLASSROOM);
  assert.equal(byId.get('reflection').phase, TEACHING_TASK_PHASES.CONFIRM_REFLECTION);
  assert.equal(byId.get('homework').phase, TEACHING_TASK_PHASES.PROCESS_HOMEWORK_RETURN);
  assert.equal(byId.get('next').phase, TEACHING_TASK_PHASES.CONTINUE_NEXT_LESSON);
  assert.equal(byId.get('source').phase, TEACHING_TASK_PHASES.COMPLETED);
});

test('same-priority tasks use updated_at descending and optional assets fill absent status', () => {
  const tasks = deriveTeachingTasks({
    drafts: [draft('old'), draft('new', {}, [], '2026-08-27T09:00:00Z')],
    assets: [{ draftId: 'old', updatedAt: '2026-08-27T10:00:00Z' }, {
      draftId: 'asset-only', title: '资产课', teacherConfirmed: true, cardsGenerated: true,
      lockedCardsCount: 1, updatedAt: '2026-08-27T11:00:00Z'
    }]
  });
  assert.deepEqual(tasks.filter(item => item.phase === TEACHING_TASK_PHASES.CONTINUE_PREPARATION).map(item => item.draftId), ['new', 'old']);
  assert.equal(tasks.find(item => item.draftId === 'asset-only').phase, TEACHING_TASK_PHASES.ENTER_CLASSROOM);
  assert.ok(tasks.findIndex(item => item.draftId === 'asset-only') < tasks.findIndex(item => item.draftId === 'new'));
});
