import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from './shared.js';

test('readJson parses JSON bodies buffered by an upstream proxy', async () => {
  const expected = { draftId: 'draft-1', periods: 2 };
  assert.deepEqual(await readJson({ body: Buffer.from(JSON.stringify(expected)) }), expected);
  assert.deepEqual(await readJson({ body: new Uint8Array(Buffer.from(JSON.stringify(expected))) }), expected);
});

