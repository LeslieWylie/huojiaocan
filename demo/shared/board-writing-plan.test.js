import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBoardWritingPlan, chalkCharacterCount } from './board-writing-plan.js';

test('板书落笔排练给出五个真实书写阶段和可写量', () => {
  const plan = buildBoardWritingPlan({
    title: '《岳阳楼记》',
    coreQuestion: '景、情、理如何逐层推进？',
    items: [
      { id: 'a', text: '阴景 → 悲' },
      { id: 'b', text: '晴景 → 喜' },
      { id: 'c', text: '不以物喜，不以己悲' },
      { id: 'd', text: '先忧后乐' }
    ]
  });
  assert.equal(plan.steps.length, 5);
  assert.equal(plan.itemCount, 4);
  assert.equal(plan.itemOrder[0].order, 1);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.estimatedSeconds > 0, true);
  assert.equal(plan.steps[2].leave.includes('学生已经说出'), true);
});

test('长问题只口头完整提出，长板书会提示教师收缩', () => {
  const plan = buildBoardWritingPlan({
    title: '《岳阳楼记》',
    coreQuestion: '作者为什么先写两种不同景色以及迁客骚人的不同感受最后才提出自己的政治理想？',
    items: [
      { text: '这是一条不适合直接抄写到黑板上的完整教学解释句' },
      { text: '第二条同样非常长而且包含很多课堂说明与教师动作' }
    ]
  });
  assert.equal(plan.status, 'review');
  assert.equal(plan.longItemCount, 2);
  assert.equal(plan.steps[0].write[1], '核心问题：________');
  assert.equal(plan.issues.some(item => item.includes('口头提出')), true);
});

test('粉笔字符统计忽略标点、箭头和留白线', () => {
  assert.equal(chalkCharacterCount('阴景 → 悲；________'), 3);
});
