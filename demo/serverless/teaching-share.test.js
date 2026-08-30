import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTeachingShareSnapshot, createShareToken, shareTokenHash } from './teaching-share.js';

function confirmedDraft() {
  const citations = [
    { id: 'E1', documentId: 'textbook', documentType: 'textbook', pdfPage: 56, printedPage: 52, quote: '不应公开的教材原文', pdfUrl: 'https://private.test/textbook.pdf' },
    { id: 'E2', documentId: 'private-upload', documentType: 'textbook', pdfPage: 4, quote: '私人文档原文' }
  ];
  return {
    id: 'draft-1', title: '《岳阳楼记》', question: '如何理解先忧后乐？', version: 8,
    answer: {
      planApproval: {
        status: 'confirmed', hasUnconfirmedChanges: false, confirmedAt: '2026-08-27T01:00:00Z', confirmedBy: 'teacher-1',
        confirmedSnapshot: {
          plan: { summary: '从写景进入价值判断。', objectives: ['结合原文说明观点'], lesson: { title: '《岳阳楼记》', coreQuestion: '何谓“先忧后乐”？' } },
          conditions: { title: '《岳阳楼记》', question: '如何理解先忧后乐？', lessonContext: { periods: 2, classLevel: '普通' } },
          citations
        }
      },
      conversationHistory: [{ role: 'user', content: '私密对话' }],
      revisions: [{ snapshot: true }],
      apiKey: 'sk-never-share'
    },
    citations,
    cards: [{ type: 'board', title: '板书卡', status: 'locked', items: [{ text: '景→情→志', citationIds: ['E1', 'E2'] }] }]
  };
}

test('share tokens are random capability values and only their hash is stored', () => {
  const first = createShareToken();
  const second = createShareToken();
  assert.match(first, /^[A-Za-z0-9_-]{32}$/u);
  assert.notEqual(first, second);
  assert.equal(shareTokenHash(first).length, 64);
  assert.equal(shareTokenHash(first), shareTokenHash(first));
});

test('teaching share snapshots exclude private text, identity and conversation history', () => {
  const snapshot = buildTeachingShareSnapshot(confirmedDraft(), { now: '2026-08-27T02:00:00Z' });
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.citations.length, 1);
  assert.equal(snapshot.citations[0].documentId, 'textbook');
  assert.equal(snapshot.citations[0].pdfPage, 56);
  assert.deepEqual(snapshot.cards[0].items[0].citationIds, ['S1']);
  for (const forbidden of ['不应公开的教材原文', '私人文档原文', 'private.test', 'teacher-1', '私密对话', 'sk-never-share', 'conversationHistory', 'revisions']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(snapshot.digest.length, 64);
});

test('sharing fails closed without public page evidence or classroom cards', () => {
  const noPublic = confirmedDraft();
  noPublic.answer.planApproval.confirmedSnapshot.citations = [{ id: 'P1', documentId: 'private-upload', documentType: 'textbook', pdfPage: 2, quote: '私人' }];
  assert.throws(() => buildTeachingShareSnapshot(noPublic), error => error.code === 'share_public_evidence_required');
  const noCards = confirmedDraft();
  noCards.cards = [];
  assert.throws(() => buildTeachingShareSnapshot(noCards), error => error.code === 'share_cards_required');
});
