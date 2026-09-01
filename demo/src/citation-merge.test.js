import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFollowUpCitations } from './citation-merge.js';

test('follow-up citations keep stable page ids and remap every current response ref', () => {
  const previous = [
    { id: 'E1', documentId: 'teacher-guide', pdfPage: 31, quote: '旧教师用书片段' },
    { id: 'E2', documentId: 'textbook', pdfPage: 9, quote: '旧教材片段' }
  ];
  const response = {
    citations: [
      { id: 'E1', documentId: 'textbook', pdfPage: 9, quote: '本轮教材原文' },
      { id: 'E2', documentId: 'curriculum-standard', pdfPage: 12, quote: '本轮课标原文' },
      { id: 'E3', documentId: 'teacher-guide', pdfPage: 31, quote: '本轮教师用书原文' }
    ],
    answer: {
      evidenceRefs: ['E1', 'E2', 'E3'],
      sourceLayers: { textbook: { citationIds: ['E1'] } },
      lessonPlan: [{ evidenceRefs: ['E3'] }]
    },
    cardSuggestionItems: { board: [{ citationIds: ['E1', 'E3'] }] }
  };

  const result = mergeFollowUpCitations(previous, response);
  assert.deepEqual(result.citations.map(item => `${item.id}:${item.documentId}:${item.pdfPage}`), [
    'E1:teacher-guide:31',
    'E2:textbook:9',
    'E3:curriculum-standard:12'
  ]);
  assert.equal(result.citations[0].quote, '本轮教师用书原文');
  assert.equal(result.citations[1].quote, '本轮教材原文');
  assert.deepEqual(result.response.answer.evidenceRefs, ['E2', 'E3', 'E1']);
  assert.deepEqual(result.response.answer.sourceLayers.textbook.citationIds, ['E2']);
  assert.deepEqual(result.response.answer.lessonPlan[0].evidenceRefs, ['E1']);
  assert.deepEqual(result.response.cardSuggestionItems.board[0].citationIds, ['E2', 'E1']);
  assert.deepEqual(result.response.citations.map(item => item.id), ['E2', 'E3', 'E1']);
});

test('legacy duplicate ids and duplicate pages are normalized deterministically', () => {
  const previous = [
    { id: 'E1', documentId: 'curriculum-standard', pdfPage: 12 },
    { id: 'E1', documentId: 'curriculum-standard', pdfPage: 51 },
    { id: 'E2', documentId: 'curriculum-standard', pdfPage: 12 }
  ];
  const result = mergeFollowUpCitations(previous, { citations: [] });
  assert.deepEqual(result.citations.map(item => [item.id, item.pdfPage]), [['E1', 12], ['E2', 51]]);
});

