import assert from 'node:assert/strict';
import test from 'node:test';
import { isRetryableAskError, withAskRetry } from './ask-retry.js';

test('automatic ask recovery retries transient index failures once', async () => {
  let calls = 0;
  const result = await withAskRetry(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('pageindex_timeout'), { code: 'pageindex_timeout' });
    return { ok: true };
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test('automatic ask recovery does not retry invalid requests or auth failures', async () => {
  assert.equal(isRetryableAskError({ code: 'pageindex_invalid_request' }), false);
  assert.equal(isRetryableAskError({ code: 'auth_invalid' }), false);
  let calls = 0;
  await assert.rejects(
    withAskRetry(async () => {
      calls += 1;
      throw Object.assign(new Error('pageindex_invalid_request'), { code: 'pageindex_invalid_request' });
    }),
    error => error.code === 'pageindex_invalid_request'
  );
  assert.equal(calls, 1);
});

test('automatic ask recovery stops after the configured retry budget', async () => {
  let calls = 0;
  await assert.rejects(
    withAskRetry(async () => {
      calls += 1;
      throw Object.assign(new Error('gateway_timeout'), { code: 'gateway_timeout' });
    }, { maxRetries: 1 }),
    error => error.code === 'gateway_timeout'
  );
  assert.equal(calls, 2);
});
