import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evidenceShelfKey,
  evidenceShelfForLesson,
  mergeEvidenceShelf,
  normalizeShelfItem,
  removeEvidenceShelfItem
} from './evidence-shelf.js';

function shelfItem(documentId, pdfPage, text = '') {
  return { documentId, pdfPage, text };
}

test('依据夹按账号和草稿隔离，并拒绝无效页码', () => {
  assert.equal(evidenceShelfKey('user-a', 'draft-1'), 'huojiaocan.evidence-shelf.v1.user-a.draft-1');
  assert.notEqual(evidenceShelfKey('user-a', 'draft-1'), evidenceShelfKey('user-a', 'draft-2'));

  for (const pdfPage of [0, -1, 1.5, 'not-a-page']) {
    assert.equal(normalizeShelfItem(shelfItem('teacher-guide', pdfPage)), null);
  }

  assert.equal(normalizeShelfItem(shelfItem('teacher-guide', 3)).pdfPage, 3);
});

test('旧依据夹只保留本课教材页和当前草稿已核验页', () => {
  const filtered = evidenceShelfForLesson([
    { documentId: 'teacher-guide', pdfPage: 100, sectionPath: ['第一单元', '1 沁园春·雪'] },
    { documentId: 'teacher-guide', pdfPage: 224, sectionPath: ['第三单元', '11 岳阳楼记'] },
    { documentId: 'textbook', pdfPage: 57, sectionPath: [] },
    { documentId: 'curriculum-standard', pdfPage: 21, sectionPath: ['第四学段'] }
  ], {
    lessonTitle: '《岳阳楼记》',
    citations: [{ documentId: 'textbook', pdfPage: 57 }]
  });

  assert.deepEqual(filtered.map(item => `${item.documentId}:${item.pdfPage}`), [
    'teacher-guide:224',
    'textbook:57',
    'curriculum-standard:21'
  ]);
});

test('依据夹按 documentId 和 pdfPage 去重', () => {
  const merged = mergeEvidenceShelf(
    [shelfItem('teacher-guide', 56, '旧片段')],
    [
      shelfItem('teacher-guide', 56, '重复片段'),
      shelfItem('textbook', 14, '教材依据')
    ]
  );

  assert.deepEqual(
    merged.map(item => `${item.documentId}:${item.pdfPage}`),
    ['teacher-guide:56', 'textbook:14']
  );
});

test('依据夹最多保留 12 条条目', () => {
  const merged = mergeEvidenceShelf(
    [],
    Array.from({ length: 15 }, (_, index) => shelfItem('teacher-guide', index + 1))
  );

  assert.equal(merged.length, 12);
  assert.deepEqual(merged.map(item => item.pdfPage), Array.from({ length: 12 }, (_, index) => index + 1));
});

test('依据夹 remove 后保留其他条目', () => {
  const current = [
    shelfItem('teacher-guide', 56),
    shelfItem('textbook', 14),
    shelfItem('teacher-guide', 57)
  ];

  const remaining = removeEvidenceShelfItem(current, 'textbook', 14);

  assert.deepEqual(
    remaining.map(item => `${item.documentId}:${item.pdfPage}`),
    ['teacher-guide:56', 'teacher-guide:57']
  );
});

test('依据夹忽略没有物理页码的结果', () => {
  assert.deepEqual(mergeEvidenceShelf([], [{ documentId: 'teacher-guide', text: 'no page' }]), []);
});
