import test from 'node:test';
import assert from 'node:assert/strict';
import { readCardEdits, writeCardEdits, clearCardEdits, recoverEditableCards } from './cards-edit-recovery.js';
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
test('unsaved card recovery is account/draft scoped, versioned and cleared after saving', () => {
  const store = storage();
  assert.equal(writeCardEdits(store, '', 'd', 1, []), false);
  assert.equal(writeCardEdits(store, 'a', 'd', 1, [{ id: 'b' }]), true);
  assert.equal(readCardEdits(store, 'b', 'd'), null);
  assert.equal(readCardEdits(store, 'a', 'other'), null);
  assert.equal(readCardEdits(store, 'a', 'd').version, 1);
  clearCardEdits(store, 'a', 'd');
  assert.equal(readCardEdits(store, 'a', 'd'), null);
});
test('recovery respects server locks and does not resurrect removed cards', () => {
  const server = [{ id: 'b', type: 'board', status: 'locked', items: [{ text: '锁定' }] }, { id: 'q', type: 'question', status: 'draft', items: [] }];
  const local = [{ id: 'b', type: 'board', items: [{ text: '旧内容' }] }, { id: 'q', type: 'question', status: 'locked', items: [{ text: '手改' }] }, { id: 'removed' }];
  const recovered = recoverEditableCards(server, local);
  assert.equal(recovered[0], server[0]);
  assert.equal(recovered[1].status, 'draft');
  assert.equal(recovered[1].items[0].text, '手改');
  assert.equal(recovered.length, 2);
});
test('storage denial or malformed data does not crash the editor', () => {
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); }, removeItem() { throw Error('denied'); } };
  assert.equal(readCardEdits(denied, 'a', 'd'), null);
  assert.equal(writeCardEdits(denied, 'a', 'd', 1, []), false);
  assert.doesNotThrow(() => clearCardEdits(denied, 'a', 'd'));
  assert.equal(readCardEdits({ getItem: () => '{' }, 'a', 'd'), null);
});
