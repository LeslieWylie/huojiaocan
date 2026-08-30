import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSameLessonComparison,
  mergeSameLessonComparison,
  normalizeLessonIdentity,
  sameLessonComparisonIsStale
} from './same-lesson-comparison.js';

function draft(id, { title = '《岳阳楼记》', decision = 'adjust', secure = 14 } = {}) {
  const study = {
    status: 'confirmed', sourceKey: '', title, inquiryQuestion: '作者如何由写景走向价值判断？', confirmedAt: '2026-08-27T08:00:00.000Z',
    evidence: {
      classroomFacts: ['课堂第 2 步已经达成'],
      reflectionFacts: ['尚未解决：价值归纳缺少中间支架'],
      learningSummary: { itemCount: 1, submittedCount: 40, counts: { secure, partial: 20, notYet: 6 }, focus: ['景—情—志关系'] }
    },
    conclusion: { decision, finding: `实践 ${id} 的课堂发现`, nextTrial: `实践 ${id} 下一轮调整`, scopeBoundary: '只说明本次课堂。' }
  };
  const value = {
    id, version: 4, title, lesson_context: { classLevel: id === 'a' ? '基础班' : '提高班' },
    answer: { lesson: { title, coreQuestion: '作者如何由写景走向价值判断？' }, lessonStudy: study },
    cards: [], citations: []
  };
  // lesson-study staleness compares its source key with the complete draft.
  // Import lazily to keep the fixture explicit and grounded in the real source contract.
  return value;
}

async function comparableDrafts() {
  const { lessonStudySourceKey } = await import('./lesson-study.js');
  const left = draft('a', { secure: 14 });
  const right = draft('b', { secure: 22 });
  left.answer.lessonStudy.sourceKey = lessonStudySourceKey(left);
  right.answer.lessonStudy.sourceKey = lessonStudySourceKey(right);
  return [left, right];
}

test('normalizes the same lesson without treating a re-preparation suffix as a new text', () => {
  assert.equal(normalizeLessonIdentity('《岳阳楼记》（复备）'), normalizeLessonIdentity('岳阳楼记'));
});

test('builds a two-practice comparison from confirmed non-stale lesson studies', async () => {
  const [left, right] = await comparableDrafts();
  const comparison = buildSameLessonComparison(left, right, '2026-08-27T10:00:00.000Z');
  assert.equal(comparison.lessonTitle, '《岳阳楼记》');
  assert.equal(comparison.left.label, '基础班');
  assert.equal(comparison.right.label, '提高班');
  assert.equal(comparison.left.learning.secureRate, 35);
  assert.equal(comparison.right.learning.secureRate, 46);
  assert.match(comparison.observations.join(''), /不自动证明因果/u);
});

test('rejects different lessons and unfinished lesson studies', async () => {
  const [left, right] = await comparableDrafts();
  right.title = '《醉翁亭记》';
  right.answer.lesson.title = '《醉翁亭记》';
  assert.throws(() => buildSameLessonComparison(left, right), error => error.code === 'same_lesson_identity_mismatch');

  const [ready, unfinished] = await comparableDrafts();
  unfinished.answer.lessonStudy.status = 'draft';
  assert.throws(() => buildSameLessonComparison(ready, unfinished), error => error.code === 'same_lesson_confirmed_studies_required');
});

test('teacher synthesis cannot replace source facts and confirmation requires a bounded conclusion', async () => {
  const [left, right] = await comparableDrafts();
  const current = buildSameLessonComparison(left, right);
  const saved = mergeSameLessonComparison(current, {
    left: { finding: '伪造的课堂事实' },
    synthesis: {
      decision: 'transferable',
      transferableFinding: '两次课堂都需要先建立景与情的关系，再进入价值判断。',
      contextBoundary: '适用于已经完成文意疏通的班级。',
      nextExperiment: '下一次保持问题不变，只调整关系图出现的时机。'
    }
  }, { confirm: true, confirmedBy: 'teacher-1' });
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.left.finding, current.left.finding);
  assert.equal(saved.synthesis.decision, 'transferable');
  assert.throws(() => mergeSameLessonComparison(current, { synthesis: { decision: 'transferable' } }, { confirm: true }), error => error.code === 'same_lesson_comparison_incomplete');
});

test('comparison becomes stale when either confirmed study changes', async () => {
  const [left, right] = await comparableDrafts();
  const comparison = buildSameLessonComparison(left, right);
  assert.equal(sameLessonComparisonIsStale(comparison, left, right), false);
  left.version += 1;
  assert.equal(sameLessonComparisonIsStale(comparison, left, right), false, 'saving the comparison itself must not invalidate its source');
  right.answer.lessonStudy.conclusion.finding = '新的课堂判断';
  assert.equal(sameLessonComparisonIsStale(comparison, left, right), true);
});
