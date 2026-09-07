import test from 'node:test';
import assert from 'node:assert/strict';
import { readAiConnectionSelection, writeAiConnectionSelection } from './ai-connection-selection.js';
test('connection selection persists per account including explicit system choice', t => {
  const previous = globalThis.localStorage; const values = new Map();
  globalThis.localStorage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  t.after(() => { globalThis.localStorage = previous; });
  writeAiConnectionSelection('a', 'key-a');
  assert.equal(readAiConnectionSelection('a'), 'key-a');
  assert.equal(readAiConnectionSelection('b'), null);
  writeAiConnectionSelection('b', '');
  assert.equal(readAiConnectionSelection('b'), '');
  assert.equal(readAiConnectionSelection('a'), 'key-a');
  assert.equal(readAiConnectionSelection(''), null);
});
