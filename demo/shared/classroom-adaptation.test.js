import assert from 'node:assert/strict';
import test from 'node:test';
import { classroomAdaptationAdvice } from './classroom-adaptation.js';

const cards = [
  { type: 'board', items: [{ text: '写景 → 悲喜 → 忧乐观', citationIds: ['E1'] }] },
  { type: 'question', items: [{ text: '主问：两种景怎样推动情感变化？', citationIds: ['E1'] }, { text: '追问：先忧后乐怎样超越个人悲喜？', citationIds: ['E2'] }] },
  { type: 'assessment', items: [{ text: '任务：引用原文说明景、情、理关系', citationIds: ['E1', 'E2'] }] }
];

test('time-short adaptation keeps a grounded question and observable closing task', () => {
  const advice = classroomAdaptationAdvice({ signal: 'time_short', cards });
  assert.match(advice.primaryAction, /两种景/u);
  assert.match(advice.secondaryAction, /引用原文/u);
  assert.deepEqual(advice.citationIds, ['E1', 'E2']);
});

test('student-stuck adaptation uses the confirmed rehearsal branch instead of inventing an answer', () => {
  const advice = classroomAdaptationAdvice({
    signal: 'students_stuck', cards,
    rehearsalStep: { question: '主问', branches: { needs_followup: '先比较“阴”与“晴”的词语，再说明情感差异。' }, citationIds: ['E2'] }
  });
  assert.match(advice.primaryAction, /先比较/u);
  assert.match(advice.note, /不替学生补写答案/u);
  assert.deepEqual(advice.citationIds, ['E2', 'E1']);
});

test('ahead adaptation stays inside the current lesson and reuses card references', () => {
  const advice = classroomAdaptationAdvice({ signal: 'ahead', cards });
  assert.match(advice.title, /提前完成/u);
  assert.match(advice.note, /不提前讲下一课/u);
  assert.deepEqual(advice.citationIds, ['E2']);
  assert.equal(classroomAdaptationAdvice({ signal: 'on_track', cards }), null);
});
