import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingDraftSave, canRetryDraftSave, unsafeSaveRetry, writePendingDraft } from './ask-save-retry.js';

const context = { ownerUserId: 'owner', draftId: 'draft', version: 3 };
const payload = () => ({ title: '课文', answer: { summary: '已生成回答', conversationTurns: [{ question: '追问', response: { answer: { summary: '已生成回答' } } }] }, citations: [{ id: 'evidence' }], cards: [{ id: 'locked', status: 'locked', content: '教师确认' }] });

test('retry sends the exact captured payload, original version and locked cards, without a model call', async () => {
  const original = payload();
  const pending = pendingDraftSave({ ...context, payload: original });
  original.cards[0].content = 'later edit';
  original.answer.summary = 'later answer';
  const calls = [];
  const draft = await writePendingDraft(pending, async (path, options) => {
    calls.push({ path, ...options });
    return { draft: { id: 'draft', version: 4 } };
  });
  assert.equal(draft.version, 4);
  assert.deepEqual(calls, [{ path: '/api/drafts/draft', method: 'PATCH', body: { ...payload(), version: 3 } }]);
});

test('missing payload/owner/version cannot become a retry from recovered text', () => {
  assert.equal(pendingDraftSave({ ...context }), null);
  assert.equal(pendingDraftSave({ ...context, ownerUserId: '', payload: payload() }), null);
  assert.equal(pendingDraftSave({ ...context, version: undefined, payload: payload() }), null);
  assert.equal(canRetryDraftSave(null, context), false);
});

test('account, target, version and quarantine must still match', () => {
  const pending = pendingDraftSave({ ...context, payload: payload() });
  assert.equal(canRetryDraftSave(pending, context), true);
  for (const patch of [{ ownerUserId: '' }, { ownerUserId: 'other' }, { draftId: 'other' }, { version: 4 }, { transitioning: true }]) {
    assert.equal(canRetryDraftSave(pending, { ...context, ...patch }), false);
  }
});

test('transient failure keeps the same answer and request for an explicit second attempt', async () => {
  const pending = pendingDraftSave({ ...context, payload: payload() });
  const before = JSON.stringify(pending);
  let calls = 0;
  await assert.rejects(writePendingDraft(pending, async () => { calls++; throw Object.assign(new Error('save_failed'), { status: 500 }); }));
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(pending), before);
  assert.equal(unsafeSaveRetry({ status: 500 }), false);
  await writePendingDraft(pending, async () => { calls++; return { draft: { id: 'draft' } }; });
  assert.equal(calls, 2);
});

test('conflicts, locked cards, auth and ambiguous success are not blindly retried', async () => {
  for (const error of [{ status: 409 }, { code: 'edit_conflict' }, { code: 'card_locked' }, { status: 401 }, { code: 'auth_owner_changed' }]) assert.equal(unsafeSaveRetry(error), true);
  const pending = pendingDraftSave({ ownerUserId: 'owner', payload: payload() });
  assert.equal(canRetryDraftSave(pending, { ownerUserId: 'owner' }), true);
  let calls = 0;
  await assert.rejects(writePendingDraft(pending, async (path, options) => {
    calls++;
    assert.equal(path, '/api/drafts');
    assert.equal(options.method, 'POST');
    assert.equal('version' in options.body, false);
    return {};
  }), error => unsafeSaveRetry(error));
  assert.equal(calls, 1);
});

test('a lost create response cannot be replayed as a second POST', async () => {
  const pending = pendingDraftSave({ ownerUserId: 'owner', payload: payload() });
  let calls = 0;
  const request = async () => { calls++; throw new Error('network_lost'); };
  await assert.rejects(writePendingDraft(pending, request));
  assert.equal(canRetryDraftSave(pending, { ownerUserId: 'owner' }), false);
  await assert.rejects(writePendingDraft(pending, request), error => error.code === 'save_result_unknown');
  assert.equal(calls, 1);
});
