import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTeachingSlideDeckV2, createTeachingSlideDeckV2Revision, normalizeTeachingSlideDeckV2, teachingSlideDeckV1ToV2, teachingSlideDeckV2Html, updateTeachingSlideDeckV2 } from './teaching-slides-v2.js';
import { buildTeachingSlideDeck } from './teaching-slides.js';

function draftFixture() {
  return {
    title: '《岳阳楼记》', question: '如何理解先忧后乐？',
    answer: { lesson: { title: '《岳阳楼记》', coreQuestion: '作者如何由写景走向价值判断？' }, objectives: ['比较阴晴两景'], planApproval: { status: 'confirmed', hasUnconfirmedChanges: false, confirmedAt: '2026-09-08T00:00:00Z' } },
    citations: [{ id: 'E1', documentId: 'textbook', pdfPage: 56 }, { id: 'E2', documentId: 'teacher-guide', pdfPage: 224 }],
    cards: [
      { type: 'board', items: [{ text: '景—情—志', citationIds: ['E1', 'E2'] }] },
      { type: 'question', items: [{ text: '两种景怎样影响情感？', citationIds: ['E1', 'E2'] }] },
      { type: 'assessment', items: [{ text: '引用原文说明古仁人之心。', citationIds: ['E1', 'E2'] }] }
    ]
  };
}

test('deterministically converts the legacy seven-page deck into OpenMAIC slide content', () => {
  const legacy = buildTeachingSlideDeck(draftFixture());
  const first = teachingSlideDeckV1ToV2(legacy), second = teachingSlideDeckV1ToV2(legacy);
  assert.deepEqual(first, second);
  assert.equal(first.version, 2);
  assert.equal(first.slides.length, 7);
  assert.equal(first.slides[0].content.type, 'slide');
  assert.ok(first.slides.every(slide => slide.content.canvas.elements.every(element => ['text', 'line', 'table', 'latex'].includes(element.type))));
});

test('applies an OpenMAIC editor transaction while keeping evidence identity server-owned', () => {
  const deck = buildTeachingSlideDeckV2(draftFixture());
  const slide = deck.slides.find(item => item.id === 'text');
  const updated = updateTeachingSlideDeckV2(deck, {
    slideId: slide.id,
    transaction: { origin: 'canvas', history: 'record', operations: [{ type: 'text.updateContent', elementId: 'text-title', content: '<p>教师修改：回到原文</p>' }] },
    metadataPatch: { teacherNotes: ['新的备课提示'], citationIds: ['forged'], teacherCitationIds: ['forged'] }
  });
  const next = updated.slides.find(item => item.id === 'text');
  assert.match(next.content.canvas.elements.find(item => item.id === 'text-title').content, /教师修改/u);
  assert.deepEqual(next.metadata.citationIds, ['E1']);
  assert.deepEqual(next.metadata.teacherCitationIds, ['E2']);
  assert.deepEqual(next.metadata.teacherNotes, ['新的备课提示']);
});

test('rejects disallowed canvas elements and freezes a confirmed revision', () => {
  const deck = buildTeachingSlideDeckV2(draftFixture());
  assert.throws(() => updateTeachingSlideDeckV2(deck, {
    slideId: 'cover', transaction: { origin: 'canvas', history: 'record', operations: [{ type: 'element.add', element: { id: 'image-1', type: 'image', left: 0, top: 0, width: 20, height: 20, rotate: 0, fixedRatio: true, src: 'x' } }] }
  }), error => error.code === 'teaching_slides_element_not_allowed');
  const confirmed = updateTeachingSlideDeckV2(deck, { confirm: true, confirmedBy: 'teacher-1' });
  assert.equal(confirmed.status, 'confirmed');
  assert.throws(() => updateTeachingSlideDeckV2(normalizeTeachingSlideDeckV2(confirmed), {}), error => error.code === 'teaching_slides_confirmed');
  const revision = createTeachingSlideDeckV2Revision(confirmed);
  assert.equal(revision.status, 'draft');
  assert.equal(revision.confirmedAt, null);
  assert.deepEqual(revision.slides, confirmed.slides);
});

test('offline projector HTML embeds only rendered student PNGs, never teacher metadata', () => {
  const deck = buildTeachingSlideDeckV2(draftFixture());
  deck.slides[0].metadata.teacherNotes = ['绝不能进入学生投屏'];
  const html = teachingSlideDeckV2Html(deck, deck.slides.map((_, index) => `data:image/png;base64,page${index}`));
  assert.match(html, /课堂投屏稿/u);
  assert.match(html, /data:image\/png;base64,page0/u);
  assert.doesNotMatch(html, /绝不能进入学生投屏|teacherNotes|teacherCitationIds|教师用书/u);
});
