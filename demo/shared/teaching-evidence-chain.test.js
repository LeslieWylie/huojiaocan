import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTeachingEvidenceChain } from './teaching-evidence-chain.js';

test('教学证据链按真实原页聚合板书、问题与学习表现', () => {
  const chain = buildTeachingEvidenceChain({
    title: '岳阳楼记',
    citations: [
      { id: 't56', documentId: 'textbook', pdfPage: 56, printedPage: '50' },
      { id: 'g224', documentId: 'teacher-guide', pdfPage: 224, printedPage: '212' }
    ],
    cards: [
      { type: 'board', title: '板书卡', items: [{ text: '古仁人：不以物喜，不以己悲', citationIds: ['t56'] }] },
      { type: 'question', title: '提问卡', items: [{ text: '古仁人与迁客骚人有什么不同？', citationIds: ['t56', 'g224'] }] },
      { type: 'assessment', title: '评价卡', items: [{ text: '能引用原文说明两者区别。', citationIds: ['t56'] }] }
    ]
  });
  assert.equal(chain.totalItems, 3);
  assert.equal(chain.linkedPercent, 100);
  assert.equal(chain.completePaths, 1);
  assert.equal(chain.paths[0].source.pdfPage, 56);
  assert.equal(chain.paths[0].complete, true);
  assert.match(chain.markdown, /学生教材 PDF 第 56 页/u);
  assert.match(chain.markdown, /共享同一页不等于它们已建立因果关系/u);
});

test('未绑定原页的卡片内容进入待补清单', () => {
  const chain = buildTeachingEvidenceChain({
    cards: [{ type: 'question', title: '提问卡', items: [{ text: '这个问题还没有教材依据。', citationIds: ['missing'] }] }],
    citations: []
  });
  assert.equal(chain.status, 'needs-evidence');
  assert.equal(chain.linkedPercent, 0);
  assert.equal(chain.missingItems.length, 1);
  assert.match(chain.markdown, /待补依据/u);
});

test('课程标准原页保持独立来源身份', () => {
  const chain = buildTeachingEvidenceChain({
    citations: [{ id: 's21', documentId: 'curriculum-standard', documentType: 'curriculum_standard', pdfPage: 21 }],
    cards: [{ type: 'question', items: [{ text: '核对第四学段阅读要求。', citationIds: ['s21'] }] }]
  });
  assert.equal(chain.paths[0].source.documentId, 'curriculum-standard');
  assert.match(chain.markdown, /课程标准 PDF 第 21 页/u);
});
