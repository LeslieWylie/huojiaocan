import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeHomeworkResponses, normalizeAnonymousResponses } from './homework-marking.js';
import { buildLayeredHomework } from '../shared/layered-homework.js';

function fixture() {
  const draft = { version: 8, title: '《岳阳楼记》', question: '怎样理解忧乐观？', answer: { lesson: { title: '《岳阳楼记》', coreQuestion: '作者怎样由写景走向价值判断？' }, planApproval: { status: 'confirmed', hasUnconfirmedChanges: false, confirmedAt: '2026-08-27' } }, citations: [{ id: 'E1', documentId: 'textbook', pdfPage: 56, quote: '不以物喜，不以己悲' }, { id: 'E2', documentId: 'teacher-guide', pdfPage: 224, quote: '引导学生建立景情关系' }], cards: [{ type: 'question', items: [{ id: 'q1', text: '景物怎样推动情感变化？', citationIds: ['E1', 'E2'] }] }, { type: 'board', items: [{ id: 'b1', text: '景—情—志', citationIds: ['E1', 'E2'] }] }, { type: 'assessment', items: [{ id: 'a1', text: '引用原文说明古仁人之心。', citationIds: ['E1', 'E2'] }] }] };
  draft.answer.layeredHomework = buildLayeredHomework(draft); draft.answer.layeredHomework.status = 'confirmed';
  return draft;
}

test('anonymous marking returns feedback and stores only aggregate review', async () => {
  const draft = fixture(), task = draft.answer.layeredHomework.tasks[0];
  const result = await analyzeHomeworkResponses({ draft, taskId: task.id, responses: ['找到了相关词句，但解释还不完整。', '能够结合原文概括景物特点。'], complete: async () => JSON.stringify({ results: [{ index: 1, score: 2, strengths: ['能够定位原文'], nextStep: '补充景物特点和情感之间的关系。', issueTags: ['meaning'] }, { index: 2, score: 4, strengths: ['依据准确'], nextStep: '再说明关键词的表达作用。', issueTags: [] }], commonPatterns: ['能够定位词句，但解释作用不足'], nextActions: ['用“词句—特点—情感”关系图集中讲评'] }) });
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.review.counts, { secure: 1, partial: 1, notYet: 0 });
  assert.equal(JSON.stringify(result.review).includes('找到了相关词句'), false);
});

test('identifiers are rejected before model work', () => {
  assert.throws(() => normalizeAnonymousResponses(['姓名：张三，我认为……']), error => error.code === 'homework_marking_contains_identifier');
  assert.throws(() => normalizeAnonymousResponses(['电话 13800138000']), error => error.code === 'homework_marking_contains_identifier');
});

test('model cannot mint indexes, scores or rubric tags outside the server task', async () => {
  const draft = fixture(), task = draft.answer.layeredHomework.tasks[0];
  await assert.rejects(() => analyzeHomeworkResponses({ draft, taskId: task.id, responses: ['这是一份匿名作答。'], complete: async () => JSON.stringify({ results: [{ index: 2, score: 999, strengths: [], nextStep: '继续修改', issueTags: ['forged'] }], commonPatterns: ['问题'], nextActions: ['讲评'] }) }), error => error.code === 'homework_marking_invalid_response');
});
