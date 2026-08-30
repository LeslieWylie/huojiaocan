import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLayeredHomework, layeredHomeworkIsStale, layeredHomeworkStudentHtml, layeredHomeworkTeacherMarkdown, mergeLayeredHomework } from './layered-homework.js';

function draftFixture() {
  return {
    id: 'draft-1', title: '《岳阳楼记》', question: '如何理解先忧后乐？',
    answer: { lesson: { title: '《岳阳楼记》', coreQuestion: '作者如何由写景走向价值判断？' }, homework: ['比较两种景物描写'], planApproval: { status: 'confirmed', hasUnconfirmedChanges: false, confirmedAt: '2026-08-27T08:00:00Z' } },
    citations: [{ id: 'E1', documentId: 'textbook', pdfPage: 56 }, { id: 'E2', documentId: 'teacher-guide', pdfPage: 224, quote: '参考答案不进入学生版' }],
    cards: [
      { type: 'board', items: [{ id: 'b1', text: '阴景—悲；晴景—喜；古仁人—不以物喜', citationIds: ['E1', 'E2'] }] },
      { type: 'question', items: [{ id: 'q1', text: '迁客骚人与古仁人的情感依据有什么不同？', citationIds: ['E1', 'E2'] }] },
      { type: 'assessment', items: [{ id: 'a1', text: '用一句原文说明古仁人之心。', citationIds: ['E1', 'E2'] }] }
    ]
  };
}

test('builds A B C homework tasks from confirmed grounded cards', () => {
  const pack = buildLayeredHomework(draftFixture());
  assert.deepEqual(pack.tasks.map(item => item.level), ['A', 'B', 'C']);
  assert.ok(pack.totalScore > 0);
  assert.deepEqual(pack.tasks[0].studentCitationIds, ['E1']);
  assert.deepEqual(pack.tasks[0].teacherCitationIds, ['E2']);
});

test('student export excludes answers rubrics and teacher-guide identity', () => {
  const html = layeredHomeworkStudentHtml(buildLayeredHomework(draftFixture()));
  assert.match(html, /学生分层作业/u);
  assert.match(html, /学生教材 PDF 第 56 页/u);
  assert.doesNotMatch(html, /参考答案|参考要点|评分量规|教师用书|PDF 第 224 页|answerGuide/u);
});

test('teacher marking guide keeps answer points rubrics and verified teacher-guide pages', () => {
  const markdown = layeredHomeworkTeacherMarkdown(buildLayeredHomework(draftFixture()));
  assert.match(markdown, /参考批改单/u);
  assert.match(markdown, /评分量规/u);
  assert.match(markdown, /教师用书 PDF 第 224 页/u);
});

test('teacher edits cannot forge scores or citation identity', () => {
  const pack = buildLayeredHomework(draftFixture());
  const submitted = structuredClone(pack);
  submitted.tasks[0].prompt = '教师修改后的基础题';
  submitted.tasks[0].score = 100;
  submitted.tasks[0].studentCitationIds = ['evil'];
  submitted.tasks[0].rubric[0].points = 99;
  const saved = mergeLayeredHomework(pack, submitted, { confirm: true, confirmedBy: 'teacher-1' });
  assert.equal(saved.tasks[0].prompt, '教师修改后的基础题');
  assert.notEqual(saved.tasks[0].score, 100);
  assert.deepEqual(saved.tasks[0].studentCitationIds, ['E1']);
  assert.notEqual(saved.tasks[0].rubric[0].points, 99);
});

test('homework becomes stale after a source card changes and requires confirmed textbook evidence', () => {
  const draft = draftFixture(); draft.answer.layeredHomework = buildLayeredHomework(draft);
  assert.equal(layeredHomeworkIsStale(draft), false);
  draft.cards[1].items[0].text = '新的问题';
  assert.equal(layeredHomeworkIsStale(draft), true);
  const noEvidence = draftFixture(); noEvidence.cards.forEach(card => card.items.forEach(item => { item.citationIds = ['E2']; }));
  assert.throws(() => buildLayeredHomework(noEvidence), error => error.code === 'homework_requires_textbook_evidence');
});
