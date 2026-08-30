import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLessonStudy,
  lessonStudyIsStale,
  lessonStudyReadiness,
  mergeLessonStudy,
  normalizeLessonStudy
} from './lesson-study.js';
import { teachingDeliberationSourceKey } from './teaching-deliberation.js';

function fixture() {
  const draft = {
    id: 'draft-1', version: 12, title: '《岳阳楼记》', question: '如何理解“先忧后乐”？',
    lesson_context: { periods: 2 },
    citations: [{ id: 'E1', documentId: 'textbook', pdfPage: 56, quote: '先天下之忧而忧' }],
    cards: [{ id: 'assessment-1', type: 'assessment', items: [{ id: 'a1', text: '能引用原文说明古仁人之心', citationIds: ['E1', 'evil'] }] }],
    answer: {
      lesson: { title: '《岳阳楼记》', coreQuestion: '作者如何由写景走向“先忧后乐”的价值判断？' },
      summary: '比较阴晴两景，再理解古仁人之心。',
      classroomRun: {
        status: 'confirmed', currentStage: 5, paceSignal: 'students_stuck',
        stages: [{ stage: 2, outcome: 'reached' }, { stage: 4, outcome: 'needs_followup' }],
        keywords: [{ id: 'k1', stage: 4, text: '不以物喜' }], usedCards: ['提问卡']
      },
      lessonReflection: {
        observedLearning: '学生能比较阴晴两景。',
        unresolvedLearning: '还不能把景情关系连到古仁人之心。',
        nextLessonAdjustment: '先画出景—情—志的关系，再完成价值判断。'
      },
      learningEvidence: {
        status: 'confirmed', sourceKey: 'learning-1', entries: [{
          id: 'L1', prompt: '景与情有什么关系？', assignedCount: 40, submittedCount: 38,
          secureCount: 12, partialCount: 20, notYetCount: 6,
          observedPattern: '能找景物，不能说明作用。', teacherAction: '增加景情关系支架。'
        }]
      }
    }
  };
  const deliberation = {
    status: 'confirmed', decisions: [{
      id: 'D1', question: '第一课时收在哪里？', selectedOptionId: 'A',
      options: [
        { id: 'A', label: '收在景情关系', approach: '先完成阴晴两景比较', tradeoff: '价值讨论后置', evidenceRefs: ['E1'] },
        { id: 'B', label: '推进价值判断', approach: '第一课时进入主旨', tradeoff: '朗读时间更少', evidenceRefs: ['E1'] }
      ]
    }]
  };
  draft.answer.teachingDeliberation = { ...deliberation, sourceKey: teachingDeliberationSourceKey(draft) };
  return draft;
}

test('buildLessonStudy turns plan, classroom facts and learning results into one bounded inquiry record', () => {
  const draft = fixture();
  const study = buildLessonStudy(draft, '2026-08-27T08:00:00.000Z');
  assert.equal(study.title, '《岳阳楼记》');
  assert.match(study.hypothesis, /收在景情关系/u);
  assert.match(study.plannedMove, /先完成阴晴两景比较/u);
  assert.match(study.expectedEvidence, /引用原文/u);
  assert.deepEqual(study.citationIds, ['E1']);
  assert.ok(study.evidence.classroomFacts.some(item => /仍需追问/u.test(item)));
  assert.equal(study.evidence.learningSummary.counts.partial, 20);
  assert.equal(study.conclusion.decision, 'undecided');
  assert.match(study.conclusion.nextTrial, /景—情—志/u);
  assert.equal(lessonStudyIsStale({ ...draft, answer: { ...draft.answer, lessonStudy: study } }), false);
});

test('lesson study becomes stale when a source observation changes', () => {
  const draft = fixture();
  const study = buildLessonStudy(draft);
  const changed = structuredClone(draft);
  changed.answer.lessonStudy = study;
  changed.answer.lessonReflection.unresolvedLearning = '新的课堂观察';
  assert.equal(lessonStudyIsStale(changed), true);
});

test('mergeLessonStudy only accepts teacher conclusion fields and requires a complete confirmation', () => {
  const current = buildLessonStudy(fixture());
  const forged = structuredClone(current);
  forged.title = '客户端伪造课题';
  forged.citationIds = ['evil'];
  forged.evidence.classroomFacts = ['伪造课堂事实'];
  forged.conclusion = { decision: 'adjust', finding: '比较任务有效，但价值归纳仍需支架。', nextTrial: '下一轮只调整归纳环节。' };
  const saved = mergeLessonStudy(current, forged, { confirm: true, confirmedBy: 'teacher-1', now: '2026-08-27T09:00:00.000Z' });
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.title, '《岳阳楼记》');
  assert.deepEqual(saved.citationIds, ['E1']);
  assert.notDeepEqual(saved.evidence.classroomFacts, ['伪造课堂事实']);
  assert.equal(saved.conclusion.decision, 'adjust');
  assert.equal(saved.confirmedBy, 'teacher-1');

  assert.throws(() => mergeLessonStudy(current, normalizeLessonStudy({ conclusion: { decision: 'undecided' } }), { confirm: true }), error => error.code === 'lesson_study_incomplete');
  assert.throws(() => mergeLessonStudy(current, normalizeLessonStudy({ conclusion: { decision: 'adjust', finding: '学生姓名：张三', nextTrial: '继续' } })), error => error.code === 'lesson_study_contains_student_identifier');
});

test('lessonStudyReadiness distinguishes planning from observed classroom evidence', () => {
  const draft = fixture();
  assert.deepEqual(lessonStudyReadiness(draft), { hasPlan: true, hasClassroomFacts: true, hasReflection: true, hasLearningEvidence: true });
  const planOnly = { title: '《岳阳楼记》', answer: { summary: '教学方案' }, cards: [] };
  assert.deepEqual(lessonStudyReadiness(planOnly), { hasPlan: true, hasClassroomFacts: false, hasReflection: false, hasLearningEvidence: false });
  assert.throws(() => buildLessonStudy(planOnly), error => error.code === 'lesson_study_observation_required');
});
