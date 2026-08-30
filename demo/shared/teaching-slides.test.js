import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTeachingSlideDeck, mergeTeachingSlideDeck, teachingSlideDeckHtml, teachingSlideDeckIsStale } from './teaching-slides.js';

function draftFixture() {
  return {
    id: 'draft-1', version: 8, title: '《岳阳楼记》', question: '如何理解先忧后乐？',
    answer: {
      lesson: { title: '《岳阳楼记》', coreQuestion: '作者如何由写景走向价值判断？' },
      objectives: ['比较阴晴两景', '引用原文说明判断'], keyPoints: ['景—情—志关系'],
      planApproval: { status: 'confirmed', hasUnconfirmedChanges: false, confirmedAt: '2026-08-27T08:00:00Z' }
    },
    citations: [
      { id: 'E1', documentId: 'textbook', pdfPage: 56, quote: '先天下之忧而忧' },
      { id: 'E2', documentId: 'teacher-guide', pdfPage: 224, quote: '教师参考答案，不应进入投屏文件' }
    ],
    cards: [
      { id: 'b', type: 'board', items: [{ id: 'b1', text: '阴景—悲；晴景—喜；古仁人—不以物喜', citationIds: ['E1', 'E2'] }] },
      { id: 'q', type: 'question', items: [{ id: 'q1', text: '迁客骚人与古仁人的情感依据有什么不同？', citationIds: ['E1', 'E2'] }] },
      { id: 'a', type: 'assessment', items: [{ id: 'a1', text: '用一句原文说明古仁人之心。', citationIds: ['E1', 'E2'] }] }
    ]
  };
}

test('builds a seven-slide classroom deck from confirmed cards and separates student and teacher references', () => {
  const deck = buildTeachingSlideDeck(draftFixture());
  assert.equal(deck.slides.length, 7);
  assert.equal(deck.slides[0].title, '《岳阳楼记》');
  const evidence = deck.slides.find(item => item.id === 'text');
  assert.deepEqual(evidence.citationIds, ['E1']);
  assert.deepEqual(evidence.teacherCitationIds, ['E2']);
  assert.ok(evidence.teacherNotes.some(item => /教师用书 PDF 第 224 页/u.test(item)));
});

test('projector export contains only student-facing slides and never embeds teacher notes or teacher-guide answers', () => {
  const deck = buildTeachingSlideDeck(draftFixture());
  const html = teachingSlideDeckHtml(deck);
  assert.match(html, /课堂投屏稿/u);
  assert.match(html, /用一句原文说明古仁人之心/u);
  assert.doesNotMatch(html, /教师用书 PDF 第 224 页|教师参考答案|teacherNotes|teacherCitationIds/u);
});

test('teacher edits cannot replace server-bound citation identity and confirmation freezes the deck', () => {
  const deck = buildTeachingSlideDeck(draftFixture());
  const edited = mergeTeachingSlideDeck(deck, { slides: deck.slides.map(item => ({ ...item, title: item.id === 'questions' ? '教师修改的问题链' : item.title, citationIds: ['evil'], teacherCitationIds: ['evil'] })) }, { confirm: true, confirmedBy: 'teacher-1' });
  assert.equal(edited.status, 'confirmed');
  assert.equal(edited.slides.find(item => item.id === 'questions').title, '教师修改的问题链');
  assert.deepEqual(edited.slides.find(item => item.id === 'questions').citationIds, ['E1']);
  assert.throws(() => mergeTeachingSlideDeck(edited, {}), error => error.code === 'teaching_slides_confirmed');
});

test('deck becomes stale when a confirmed card changes', () => {
  const draft = draftFixture();
  draft.answer.teachingSlides = buildTeachingSlideDeck(draft);
  assert.equal(teachingSlideDeckIsStale(draft), false);
  draft.cards[0].items[0].text = '新的板书内容';
  assert.equal(teachingSlideDeckIsStale(draft), true);
});

test('refuses to produce classroom slides before teacher confirmation or card generation', () => {
  const unconfirmed = draftFixture(); unconfirmed.answer.planApproval.status = 'draft';
  assert.throws(() => buildTeachingSlideDeck(unconfirmed), error => error.code === 'teaching_slides_require_confirmed_plan');
  const noCards = draftFixture(); noCards.cards = [];
  assert.throws(() => buildTeachingSlideDeck(noCards), error => error.code === 'teaching_slides_require_cards');
});
