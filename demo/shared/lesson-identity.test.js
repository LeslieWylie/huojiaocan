import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonTitleForDraft, resolveLessonIdentity } from './lesson-identity.js';

test('教材目录身份优先于被口语污染的标题', () => {
  assert.deepEqual(resolveLessonIdentity({ lessonRef: { title: '11 岳阳楼记' }, title: '我岳阳楼记', answerTitle: '我岳阳楼记', question: '我岳阳楼记' }), { title: '《岳阳楼记》', source: 'lesson_ref' });
});

test('依据路径可修复旧草稿但不会误删我爱这土地的我', () => {
  assert.equal(lessonTitleForDraft({ title: '我岳阳楼记', question: '我岳阳楼记', answer: { lesson: { title: '我岳阳楼记' } }, citations: [{ title: '教学建议', sectionPath: ['第四单元', '11 岳阳楼记', '教学建议'] }] }), '《岳阳楼记》');
  assert.equal(lessonTitleForDraft({ title: '我爱这土地', answer: { lesson: { title: '我爱这土地' } }, citations: [{ sectionPath: ['第一单元', '2 我爱这土地'] }] }), '《我爱这土地》');
});

test('明确书名号优先且普通教师自定义标题保持原样', () => {
  assert.equal(resolveLessonIdentity({ question: '怎样备课《孔乙己》？', title: '临时标题' }).title, '《孔乙己》');
  assert.equal(resolveLessonIdentity({ title: '单元整合阅读课' }).title, '单元整合阅读课');
});
