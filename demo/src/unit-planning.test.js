import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnitTrack, lessonKey, matchLessonAsset, matchLessonDraft, stableNodeId, unitLessonNodes, unitNodes, unitTrackInsights } from './unit-planning.js';

const tree = [{ id: 'u1', documentId: 'textbook', title: '第一单元 · 活动探究', startPage: 7, endPage: 26, children: [
  { id: 'u1-n1', title: '活动任务单', startPage: 7, endPage: 8 },
  { id: 'u1-n2', title: '1 沁园春·雪', startPage: 9, endPage: 10 },
  { id: 'u1-n3', title: '2 周总理，你在哪里', startPage: 11, endPage: 13 }
]}];

test('unit planning derives units and lesson identities only from the server tree', () => {
  const [unit] = unitNodes(tree);
  const lessons = unitLessonNodes(unit);
  assert.equal(unit.id, 'u1');
  assert.deepEqual(lessons.map(item => [item.title, item.startPage, item.kind]), [
    ['沁园春·雪', 9, 'lesson'], ['周总理，你在哪里', 11, 'lesson']
  ]);
});

test('existing assets attach to the correct lesson without page guessing', () => {
  const assets = [{ draftId: 'd1', lessonKey: '《沁园春·雪》', title: '《沁园春·雪》两课时备课方案' }];
  assert.equal(lessonKey('《沁园春·雪》两课时备课方案'), '沁园春雪');
  assert.equal(matchLessonAsset({ title: '沁园春·雪' }, assets)?.draftId, 'd1');
  assert.equal(matchLessonAsset({ title: '周总理，你在哪里' }, assets), null);
});

test('unit track binds drafts by stable node id and reports the next lesson', () => {
  const drafts = [{ id: 'd1', title: '《沁园春·雪》', lesson_context: { lessonRef: { nodeId: 'u1-n2' } } }];
  const assets = [{ draftId: 'd1', lessonKey: '沁园春·雪', hasReflection: true, cardsGenerated: true }];
  assert.equal(matchLessonDraft({ nodeId: 'u1-n2', title: '沁园春·雪' }, drafts)?.id, 'd1');
  const track = buildUnitTrack(tree[0], drafts, assets);
  const insight = unitTrackInsights(track);
  assert.equal(insight.ready, 1);
  assert.equal(insight.reflected, 1);
  assert.equal(insight.current.title, '周总理，你在哪里');
});

test('seed-prefixed provider ids stay compatible with older stable lesson refs', () => {
  assert.equal(stableNodeId('seed-textbook-u3-n1'), 'textbook-u3-n1');
  const unit = { children: [{ id: 'seed-textbook-u3-n1', title: '11 岳阳楼记', startPage: 56, endPage: 58 }] };
  const drafts = [{ id: 'legacy', title: '《岳阳楼记》', lesson_context: { lessonRef: { nodeId: 'textbook-u3-n1' } } }];
  assert.equal(buildUnitTrack(unit, drafts, [])[0].draft.id, 'legacy');
});

test('a saved classroom record pauses the unit track at post-class reflection', () => {
  const drafts = [{ id: 'd1', lesson_context: { lessonRef: { nodeId: 'u1-n2' } } }];
  const assets = [{ draftId: 'd1', hasClassroomRecord: true, cardsGenerated: true }];
  const track = buildUnitTrack(tree[0], drafts, assets);
  assert.equal(track[0].status, 'recorded');
  assert.equal(unitTrackInsights(track).current.nodeId, 'u1-n2');
});

test('confirmed aggregate learning evidence completes the lesson even without a free-form reflection', () => {
  const unit = { children: [{ id: 'lesson-1', title: '1 我爱这土地', startPage: 14 }] };
  const drafts = [{ id: 'draft-1', title: '《我爱这土地》', lesson_context: { lessonRef: { nodeId: 'lesson-1' } } }];
  const assets = [{ draftId: 'draft-1', title: '《我爱这土地》', learningEvidenceStatus: 'confirmed', hasReflection: false }];
  assert.equal(buildUnitTrack(unit, drafts, assets)[0].status, 'reflected');
});

test('an in-progress classroom remains the current lesson and still counts as prepared', () => {
  const unit = { children: [{ id: 'lesson-1', title: '1 第一课', startPage: 10 }, { id: 'lesson-2', title: '2 第二课', startPage: 20 }] };
  const drafts = [{ id: 'draft-1', title: '第一课', lesson_context: { lessonRef: { nodeId: 'lesson-1' } } }];
  const assets = [{ draftId: 'draft-1', title: '第一课', cardsGenerated: true, hasClassroomRecord: true, classroomStatus: 'in_progress' }];
  const track = buildUnitTrack(unit, drafts, assets);
  const insight = unitTrackInsights(track);
  assert.equal(track[0].status, 'in_class');
  assert.equal(insight.current?.nodeId, 'lesson-1');
  assert.equal(insight.ready, 1);
});
