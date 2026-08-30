import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClassLearningProfiles,
  classLearningProfileContext,
  deriveClassLearningProfiles,
  serializeClassLearningProfile
} from './class-learning-profile.js';

function draft(id, className, updatedAt, answer = {}, extra = {}) {
  return {
    id,
    title: `课文 ${id}`,
    updated_at: updatedAt,
    lesson_context: { className, classLevel: '九年级', ...extra.lesson_context },
    answer,
    ...extra
  };
}

test('groups only drafts with an explicit class name and returns a compact stable shape', () => {
  const profiles = deriveClassLearningProfiles([
    draft('b-old', '九（2）班', '2026-08-26T08:00:00Z'),
    draft('a-new', '九（1）班', '2026-08-27T08:00:00Z'),
    draft('b-new', '九（2）班', '2026-08-27T09:00:00Z', {}, { title: '《岳阳楼记》' }),
    draft('missing', '', '2026-08-27T10:00:00Z'),
    { id: 'no-context', title: '不应进入' }
  ]);

  assert.deepEqual(profiles.map(item => item.className), ['九（1）班', '九（2）班']);
  assert.equal(profiles[1].lessonCount, 2);
  assert.equal(profiles[1].latestLessonTitle, '《岳阳楼记》');
  assert.equal(profiles[1].latestDraftId, 'b-new');
  assert.equal(profiles[1].latestUpdatedAt, '2026-08-27T09:00:00Z');
  assert.equal(profiles[1].href, '/ask/?draftId=b-new');
  assert.deepEqual(Object.keys(profiles[1]), [
    'className', 'classLevel', 'lessonCount', 'latestLessonTitle', 'latestDraftId', 'latestUpdatedAt',
    'confirmedObservation', 'nextFocus', 'homeworkSummary', 'href'
  ]);
  assert.deepEqual(buildClassLearningProfiles([]), []);
});

test('uses teacher reflection including the legacy feedback shape but rejects an explicit draft status', () => {
  const [profile] = deriveClassLearningProfiles([
    draft('new', '九（1）班', '2026-08-27T08:00:00Z', {
      lessonReflection: { observedLearning: '能比较两种景物', unresolvedLearning: '价值归纳仍需追问', nextLessonAdjustment: '先画景情关系图' }
    }),
    draft('legacy', '九（1）班', '2026-08-26T08:00:00Z', {
      teachingFeedback: { feedback: { classResponse: '能定位关键句', nextStep: '补充作用分析' } }
    }),
    draft('unconfirmed', '九（1）班', '2026-08-25T08:00:00Z', {
      lessonReflection: { status: 'draft', observedLearning: '尚未确认的观察' }
    })
  ]);
  assert.match(profile.confirmedObservation, /能比较两种景物/u);
  assert.match(profile.confirmedObservation, /能定位关键句/u);
  assert.doesNotMatch(profile.confirmedObservation, /尚未确认/u);
  assert.match(profile.nextFocus, /价值归纳仍需追问/u);
  assert.match(profile.nextFocus, /先画景情关系图/u);
  assert.match(profile.nextFocus, /补充作用分析/u);
});

test('accepts only confirmed homework, learning evidence, and classroom triage', () => {
  const [profile] = deriveClassLearningProfiles([
    draft('confirmed', '九（1）班', '2026-08-27T08:00:00Z', {
      homeworkReview: {
        status: 'confirmed', responseCount: 30, counts: { secure: 12, partial: 15, notYet: 3 },
        patterns: ['景与情的关系说明不足'],
        nextActions: [{ id: 'a1', text: '下节课先用关系图复盘' }, { id: 'a2', text: '不采用' }], selectedActionIds: ['a1'],
        teacherNote: '先补关系，再进入价值判断'
      },
      learningEvidence: { status: 'confirmed', entries: [{ observedPattern: '能找出意象但联系不足', teacherAction: '增加意象串联支架' }] },
      classroomMomentTriage: { status: 'confirmed', items: [
        { resolution: 'reflection', text: '学生说出了象征意义' },
        { resolution: 'carryover', text: '原始时刻', carryoverText: '继续辨析景与情' },
        { resolution: 'dismissed', text: '无需采纳' }
      ] }
    }),
    draft('draft-signals', '九（1）班', '2026-08-26T08:00:00Z', {
      homeworkReview: { status: 'draft', responseCount: 99, patterns: ['未确认作业'] },
      learningEvidence: { status: 'draft', entries: [{ observedPattern: '未确认学情' }] },
      classroomMomentTriage: { status: 'draft', items: [{ resolution: 'reflection', text: '未确认时刻' }] }
    })
  ]);

  assert.match(profile.confirmedObservation, /学生说出了象征意义/u);
  assert.match(profile.confirmedObservation, /能找出意象但联系不足/u);
  assert.match(profile.confirmedObservation, /景与情的关系说明不足/u);
  assert.match(profile.nextFocus, /继续辨析景与情/u);
  assert.match(profile.nextFocus, /增加意象串联支架/u);
  assert.match(profile.nextFocus, /下节课先用关系图复盘/u);
  assert.doesNotMatch(JSON.stringify(profile), /不采用|无需采纳|未确认/u);
  assert.match(profile.homeworkSummary, /匿名汇总 30 份/u);
  assert.match(profile.homeworkSummary, /已达成 12/u);
});

test('never reads student records and sanitizes dirty aggregate text', () => {
  const [profile] = deriveClassLearningProfiles([draft('safe', ' 九（1）班\u0000 ', 'bad-date', {
    lessonReflection: { observedLearning: '联系 13800138000\nstudent@example.com 后处理' },
    homeworkReview: {
      status: 'confirmed', responseCount: 2, patterns: ['共性问题\u0007'],
      studentAnswers: [{ name: '张三', answer: '学生原始答案' }],
      rawResponses: ['隐私原文']
    },
    learningEvidence: { status: 'confirmed', students: [{ name: '李四' }] }
  })]);

  const serialized = JSON.stringify(profile);
  assert.equal(profile.className, '九（1）班');
  assert.equal(profile.latestUpdatedAt, null);
  assert.doesNotMatch(serialized, /13800138000|student@example\.com|张三|李四|学生原始答案|隐私原文/u);
  assert.doesNotMatch(serialized, /[\u0000-\u001f\u007f]/u);
  assert.match(profile.confirmedObservation, /已移除个人信息/u);
});

test('sorting and tie breaking are deterministic regardless of input order', () => {
  const values = [
    draft('z', '同一班', '2026-08-27T08:00:00Z', { lessonReflection: { observedLearning: 'Z 观察' } }),
    draft('a', '同一班', '2026-08-27T08:00:00Z', { lessonReflection: { observedLearning: 'A 观察' } })
  ];
  const forward = deriveClassLearningProfiles(values);
  const reverse = deriveClassLearningProfiles([...values].reverse());
  assert.deepEqual(forward, reverse);
  assert.equal(forward[0].latestDraftId, 'a');
  assert.match(forward[0].confirmedObservation, /^A 观察；Z 观察$/u);
});

test('counts every lesson and falls back from invalid update and empty latest level safely', () => {
  const drafts = Array.from({ length: 205 }, (_, index) => draft(
    `lesson-${String(index).padStart(3, '0')}`,
    '大班',
    index === 204 ? 'invalid' : `2026-08-${String((index % 26) + 1).padStart(2, '0')}T08:00:00Z`,
    {},
    index === 204
      ? { created_at: '2026-08-27T10:00:00Z', lesson_context: { className: '大班', classLevel: '' } }
      : {}
  ));
  const [profile] = deriveClassLearningProfiles(drafts);
  assert.equal(profile.lessonCount, 205);
  assert.equal(profile.latestDraftId, 'lesson-204');
  assert.equal(profile.latestUpdatedAt, '2026-08-27T10:00:00Z');
  assert.equal(profile.classLevel, '九年级');
});

test('serializes only the requested class with an explicit non-textbook warning and a hard limit', () => {
  const drafts = [
    draft('one', '九（1）班', '2026-08-27T08:00:00Z', { lessonReflection: { observedLearning: '能引用原文说明判断', nextLessonAdjustment: '继续追问证据' } }),
    draft('two', '九（2）班', '2026-08-27T09:00:00Z', { lessonReflection: { observedLearning: '另一个班的信息' } })
  ];
  const context = serializeClassLearningProfile(drafts, '九（1）班');
  assert.match(context, /班级接续记忆：九（1）班/u);
  assert.match(context, /不是教材依据/u);
  assert.match(context, /教材事实、原文和页码必须重新检索核对/u);
  assert.match(context, /能引用原文说明判断/u);
  assert.doesNotMatch(context, /另一个班的信息/u);
  assert.equal(classLearningProfileContext(drafts, '不存在'), '');
  assert.equal(serializeClassLearningProfile(drafts, ''), '');

  const long = serializeClassLearningProfile([
    draft('long', '九（1）班', '2026-08-27T08:00:00Z', { lessonReflection: { observedLearning: '观察'.repeat(500) } })
  ], '九（1）班', { maxLength: 240 });
  assert.ok(Array.from(long).length <= 240);
});
