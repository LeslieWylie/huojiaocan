import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBoardPresentation, normalizeBoardCards, resolveBoardQuestion } from './board-presentation.js';
import { boardLeafLayout, buildBoardWritingPlan } from './board-writing-plan.js';

const items = Array.from({ length: 9 }, (_, index) => ({ id: `item-${index}`, text: `真实条目${index}`, citationIds: [`E${index}`] }));

test('unclassified items stay in writing order, never round-robin semantic categories or last-item conclusions', () => {
  const board = buildBoardPresentation({ items });
  assert.deepEqual(board.branches.map(branch => branch.items.map(item => item.id)), [items.slice(0, 3), items.slice(3, 6), items.slice(6)].map(chunk => chunk.map(item => item.id)));
  assert.deepEqual(board.branches.map(branch => branch.title), ['落笔 1、2、3', '落笔 4、5、6', '落笔 7、8、9']);
  assert.equal(board.conclusion, '');
  assert.equal(board.coreQuestion, '核心问题待补充');
  assert.deepEqual(board.items.map(item => item.citationIds), items.map(item => item.citationIds));
  const writing = buildBoardWritingPlan({ items });
  assert.deepEqual(writing.steps[1].write, board.branches.map(branch => branch.title));
  assert.deepEqual(writing.steps[3].write, ['归纳：________']);
  assert.equal(writing.steps.length, 5);
});

test('existing plans win; use current item text and citation identity, not stale node copies', () => {
  const boardPlan = { coreQuestion: '阴晴两景如何衬托古仁人之心？', conclusion: { text: '超越个人悲喜' }, branches: [{ title: '景与情', nodes: [{ ...items[4], text: '旧文字', citationIds: ['wrong'] }, items[0]] }] };
  const card = { type: 'board', items, boardPlan };
  assert.strictEqual(normalizeBoardCards([card])[0], card);
  const board = buildBoardPresentation(card);
  assert.deepEqual(board.branches[0].items.map(item => [item.id, item.text, item.citationIds]), [items[4], items[0]].map(item => [item.id, item.text, item.citationIds]));
  assert.equal(board.branches[0].title, '景与情');
  assert.equal(board.conclusion, '超越个人悲喜');
  const writing = buildBoardWritingPlan({ items, boardPlan });
  assert.deepEqual(writing.steps[3].write, ['归纳：超越个人悲喜']);
  assert.equal(writing.steps[0].write[1], boardPlan.coreQuestion);
});

test('exact legacy generated plans are neutralized, while explicit categories remain usable', () => {
  const boardPlan = { version: 1, branches: ['文本结构', '语言证据', '情感主旨'].map((title, i) => ({ id: `branch-${i + 1}`, title, nodes: items.filter((_, index) => index % 3 === i) })) };
  assert.equal(buildBoardPresentation({ items, boardPlan }).branches[0].title, '落笔 1、2、3');
  const categorized = items.map(item => ({ ...item, category: '景物描写' }));
  assert.deepEqual(buildBoardPresentation({ items: categorized }).branches.map(branch => branch.title), ['景物描写', '景物描写（续）', '景物描写（续）']);
});

test('only unique exact text can bind a legacy node without an ID; no loss or duplication for stale nodes', () => {
  const boardPlan = { branches: [{ title: '已有分组', nodes: [{ text: items[2].text }, { id: 'missing', text: items[0].text }, items[2], { text: '已删除' }] }] };
  const board = buildBoardPresentation({ items, boardPlan });
  assert.deepEqual(board.branches[0].items.map(item => item.id), [items[2].id]);
  assert.equal(new Set(board.branches.flatMap(branch => branch.items.map(item => item.id))).size, 9);
  assert.equal(board.branches.flatMap(branch => branch.items).length, 9);
});

test('more than three explicit groups keep 320-wide vertical leaves and wrap without overlaps', () => {
  const boardPlan = { branches: items.map(item => ({ title: item.text, nodes: [item] })) };
  const board = buildBoardPresentation({ items, boardPlan });
  const boxes = board.branches.flatMap(branch => branch.items.map((_, index) => boardLeafLayout(branch, index)));
  for (const [i, box] of boxes.entries()) {
    assert.equal(box.width, 320);
    assert.ok(box.y - 25 + box.height < 635 + board.extraHeight);
    for (const other of boxes.slice(i + 1)) assert.ok(Math.abs(box.x - other.x) >= 336 || Math.abs(box.y - other.y) >= 74);
  }
  assert.equal(board.branches.length, 9);
});

test('prefer a specific classroom question to generated templates and authoring commands', () => {
  const actual = '作者为什么先写迁客骚人的悲喜，再写古仁人之心？';
  assert.equal(resolveBoardQuestion('围绕课文，学生读完后能理解什么、说明什么？', actual), actual);
  assert.equal(resolveBoardQuestion('换成两课时设计', actual), actual);
  assert.equal(resolveBoardQuestion('怎样备课'), '核心问题待补充');
  assert.deepEqual(normalizeBoardCards([{ type: 'board', content: ['旧板书'] }])[0].items[0], { id: 'board-legacy-0', text: '旧板书', citationIds: [] });
});
