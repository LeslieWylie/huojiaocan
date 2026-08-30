import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHomeworkReview, homeworkReviewContext, homeworkReviewCsv, homeworkReviewIsStale, mergeHomeworkReview } from './homework-review.js';

const pack = { sourceKey: 'homework1:abc', status: 'confirmed' };
const task = { id: 'core', level: 'B', label: '核心理解', prompt: '景物怎样推动情感变化？', score: 5 };
const results = [{ sequence: 1, status: 'secure', score: 5, maxScore: 5, strengths: ['依据准确'], nextStep: '补充作用分析' }, { sequence: 2, status: 'partial', score: 3, maxScore: 5, strengths: ['能够定位原文'], nextStep: '说清景情关系' }];

test('class review keeps aggregate facts without student response text', () => {
  const review = buildHomeworkReview({ pack, task, results, patterns: ['能够定位原文，但关系说明不足'], nextActions: ['下节课先用关系图复盘'] });
  assert.deepEqual(review.counts, { secure: 1, partial: 1, notYet: 0 });
  assert.equal(review.averageScore, 4);
  assert.equal(JSON.stringify(review).includes('学生原始答案'), false);
});

test('teacher can only select server actions and confirmation needs a note', () => {
  const base = buildHomeworkReview({ pack, task, results, nextActions: ['下节课先用关系图复盘'] });
  const saved = mergeHomeworkReview(base, { selectedActionIds: ['action-1', 'forged'], teacherNote: '先补关系，再进入价值判断。' }, { confirm: true });
  assert.equal(saved.status, 'confirmed');
  assert.deepEqual(saved.selectedActionIds, ['action-1']);
  assert.throws(() => mergeHomeworkReview(base, { selectedActionIds: ['action-1'] }, { confirm: true }), error => error.code === 'homework_review_incomplete');
});

test('review becomes stale after the homework source changes', () => {
  const review = buildHomeworkReview({ pack, task, results });
  assert.equal(homeworkReviewIsStale({ answer: { layeredHomework: pack, homeworkReview: review } }), false);
  assert.equal(homeworkReviewIsStale({ answer: { layeredHomework: { ...pack, sourceKey: 'new' }, homeworkReview: review } }), true);
});

test('CSV export contains feedback but never needs raw answers', () => {
  const csv = homeworkReviewCsv(results);
  assert.match(csv, /已达成/u);
  assert.match(csv, /补充作用分析/u);
  assert.doesNotMatch(csv, /学生原始答案/u);
});

test('only a confirmed class aggregate can enter the next lesson context', () => {
  const base = buildHomeworkReview({ pack, task, results, patterns: ['关系解释不足'], nextActions: ['先用关系图复盘'] });
  assert.equal(homeworkReviewContext(base), null);
  const confirmed = mergeHomeworkReview(base, { selectedActionIds: ['action-1'], teacherNote: '先补关系。' }, { confirm: true });
  const context = homeworkReviewContext(confirmed);
  assert.equal(context.responseCount, 2);
  assert.deepEqual(context.nextActions, ['先用关系图复盘']);
  assert.equal(JSON.stringify(context).includes('学生原文'), false);
});
