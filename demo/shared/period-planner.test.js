import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPeriodPlan, reorderPeriodActivity, repairPeriodSequence, serializePeriodPlan, updatePeriodActivity } from './period-planner.js';

test('两课时编排不修改篇目与教学内容', () => {
  const plan = buildPeriodPlan({
    periods: 2,
    lessonPlan: [
      { title: '朗读写景段', teacherAction: '引导学生辨认景物特点' },
      { title: '比较两种览物之情' },
      { title: '追问古仁人之心' },
      { title: '用先忧后乐收束' }
    ]
  });
  assert.equal(plan.periods, 2);
  assert.equal(plan.activities.length, 4);
  assert.deepEqual([...new Set(plan.activities.map(item => item.period))], [1, 2]);
  assert.equal(plan.activities[0].title, '朗读写景段');
  assert.doesNotMatch(JSON.stringify(plan), /换成两课时/u);
});

test('课堂环节可跨课时移动并调整时长', () => {
  const original = buildPeriodPlan({ periods: 2, lessonPlan: ['朗读', '比较', '归纳'] });
  const activity = original.activities[0];
  const updated = updatePeriodActivity(original, activity.id, { period: 2, minutes: 18 });
  assert.equal(updated.activities.find(item => item.id === activity.id).period, 2);
  assert.equal(updated.activities.find(item => item.id === activity.id).minutes, 18);
  assert.equal(updated.periodSummaries[1].usedMinutes >= 18, true);
});

test('已保存编排只在课时与流程来源一致时恢复', () => {
  const first = buildPeriodPlan({ periods: 2, lessonPlan: ['环节一', '环节二'] });
  const saved = serializePeriodPlan(updatePeriodActivity(first, first.activities[0].id, { minutes: 22 }));
  const restored = buildPeriodPlan({ periods: 2, lessonPlan: ['环节一', '环节二'], existing: saved });
  const changed = buildPeriodPlan({ periods: 2, lessonPlan: ['新环节'], existing: saved });
  assert.equal(restored.activities[0].minutes, 22);
  assert.equal(changed.activities.length, 1);
  assert.notEqual(changed.sourceKey, saved.sourceKey);
});

test('先疏通文意再进入语言品味，生成的课时保持连续教学顺序', () => {
  const plan = buildPeriodPlan({ periods: 2, lessonPlan: [
    { title: '导入：回顾文体', duration: '5分钟' },
    { title: '品味语言，体悟情感', duration: '18分钟' },
    { title: '课堂小结与作业布置', duration: '5分钟' },
    { title: '诵读课文，疏通文意', duration: '18分钟' },
    { title: '结合背景，探究主旨', duration: '18分钟' }
  ] });
  assert.deepEqual(plan.activities.map(item => item.title), [
    '导入：回顾文体', '诵读课文，疏通文意', '品味语言，体悟情感', '结合背景，探究主旨', '课堂小结与作业布置'
  ]);
  assert.equal(plan.sequenceIssues.length, 0);
  assert.deepEqual([...plan.activities].sort((a, b) => a.order - b.order).map(item => item.period), [1, 1, 2, 2, 2]);
});

test('主要活动用时会保留课堂机动，不再把空余时间都误报为缺少内容', () => {
  const plan = buildPeriodPlan({ periods: 1, lessonPlan: [{ title: '诵读课文', duration: '36分钟' }] });
  assert.equal(plan.periodSummaries[0].status, 'balanced');
  assert.equal(plan.periodSummaries[0].remainingMinutes, 9);

  const sparse = buildPeriodPlan({ periods: 1, lessonPlan: [{ title: '导入课文', duration: '28分钟' }] });
  assert.equal(sparse.periodSummaries[0].status, 'sparse');
  const tight = buildPeriodPlan({ periods: 1, lessonPlan: [{ title: '研读课文', duration: '43分钟' }] });
  assert.equal(tight.periodSummaries[0].status, 'tight');
});

test('已手工保存的倒置顺序会明确提示', () => {

  const saved = buildPeriodPlan({ periods: 1, lessonPlan: ['品味语言', '疏通文意'] });
  const reversed = serializePeriodPlan(saved);
  reversed.activities = [
    { ...reversed.activities.find(item => /品味/u.test(item.title)), order: 1 },
    { ...reversed.activities.find(item => /疏通/u.test(item.title)), order: 2 }
  ];
  const preserved = buildPeriodPlan({
    periods: 1,
    lessonPlan: ['品味语言', '疏通文意'],
    existing: { ...reversed, updatedAt: '2026-08-27T00:00:00.000Z' }
  });
  assert.equal(preserved.status, 'sequence');
  assert.equal(preserved.sequenceIssues.length, 1);
  assert.deepEqual(repairPeriodSequence(preserved).activities.map(item => item.title), ['疏通文意', '品味语言']);
});

test('非 45 分钟课时会按实际课长计算建议范围并持久化', () => {
  const plan = buildPeriodPlan({ periods: 1, periodMinutes: 40, lessonPlan: [{ title: '课堂主线', duration: '30分钟' }] });
  assert.equal(plan.periodMinutes, 40);
  assert.equal(plan.periodSummaries[0].status, 'balanced');
  assert.equal(plan.periodSummaries[0].remainingMinutes, 10);
  assert.equal(serializePeriodPlan(plan).periodMinutes, 40);
});

test('同一课时可以调整环节先后，不依赖只有图标的左右移动', () => {
  const original = buildPeriodPlan({ periods: 1, lessonPlan: ['朗读', '比较', '归纳'] });
  const moved = reorderPeriodActivity(original, original.activities[1].id, 'up');
  assert.deepEqual(moved.activities.map(item => item.title), ['比较', '朗读', '归纳']);
  assert.equal(moved.sequenceIssues.length, 1);
  assert.deepEqual(repairPeriodSequence(moved).activities.map(item => item.title), ['朗读', '比较', '归纳']);
});
