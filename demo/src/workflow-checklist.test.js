import assert from 'node:assert/strict';
import test from 'node:test';
import { checklistProgress, deriveWorkflowChecklist } from './workflow-checklist.js';

test('备课清单根据对话中的三类材料依据推进', () => {
  const items = deriveWorkflowChecklist({
    messages: [{ question: '怎样备课《岳阳楼记》？', response: {
      answer: { summary: '先读教师用书，再回到原文。', lessonPlan: [{ title: '初读' }] },
      citations: [
        { documentType: 'curriculum_standard', documentId: 'curriculum-standard', pdfPage: 21 },
        { documentType: 'teacher_guide', pdfPage: 224 },
        { documentType: 'textbook', pdfPage: 56 }
      ]
    } }]
  });
  assert.deepEqual(items.map(item => item.done), [true, true, true, true, true, false]);
  assert.deepEqual(checklistProgress(items), { done: 5, total: 6, complete: false });
});

test('旧草稿没有数组字段时仍能显示可执行的起点', () => {
  const items = deriveWorkflowChecklist({ draft: { title: '《岳阳楼记》' } });
  assert.equal(items[0].done, true);
  assert.equal(items[1].done, false);
  assert.equal(items[2].done, false);
  assert.equal(items[3].done, false);
  assert.equal(items[4].done, false);
  assert.equal(items[5].done, false);
});

test('回答中的三卡建议不能冒充已经生成的课堂卡片', () => {
  const items = deriveWorkflowChecklist({
    messages: [{ question: '怎样备课《岳阳楼记》？', response: {
      answer: { summary: '先比较两类人的忧乐观。' },
      cardSuggestionItems: { board: ['忧乐对比'], question: ['何以忧乐？'] }
    } }],
    draft: { title: '《岳阳楼记》', cards: [] }
  });
  assert.equal(items.at(-1).done, false);
  assert.equal(items.at(-1).detail, '方案确认后再进入课堂设计');
});
