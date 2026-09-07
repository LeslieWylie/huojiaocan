import test from 'node:test';
import assert from 'node:assert/strict';
import { readInterruptedAsk, markAskInFlight, clearAskInFlight } from './ask-interruption.js';
test('in-flight handoff is isolated by owner and draft and conditional on attempt', t => {
  const values = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'sessionStorage', original); else delete globalThis.sessionStorage; });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  const first = markAskInFlight('a', 'draft', '追问');
  assert.equal(readInterruptedAsk('b', 'draft'), null);
  assert.equal(readInterruptedAsk('a', 'other'), null);
  const second = markAskInFlight('a', 'draft', '下一次');
  clearAskInFlight(first);
  assert.equal(readInterruptedAsk('a', 'draft').question, '下一次');
  clearAskInFlight(second);
  assert.equal(readInterruptedAsk('a', 'draft'), null);
});
