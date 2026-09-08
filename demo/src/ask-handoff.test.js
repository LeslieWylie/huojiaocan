import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAskHandoff, submissionHandoff, LOCAL_SAVE_FAILURE, localBackupFailureMatters, recoveredTurnsAreAhead } from './ask-handoff.js';
import { saveConversationSnapshot, readConversationSnapshot } from './conversation-recovery.js';

for (const question of ['请增加朗读训练，还没发送', '']) {
  test(`login-only handoff wins over old local composer and answered turns: ${JSON.stringify(question)}`, () => {
    assert.deepEqual(resolveAskHandoff({
      recovery: { question, messages: [{ response: {} }] },
      canResumeLocal: true, localConversation: { composerText: '旧缓存' }, hasMessages: true,
      urlQuestion: '已消费的旧问题'
    }), { composerText: question, autoSubmit: '' });
  });
}

test('explicitly submitted text resumes even with prior answers', () => {
  const recovery = submissionHandoff('请增加朗读训练');
  assert.deepEqual(resolveAskHandoff({ recovery, hasMessages: true }), {
    composerText: '请增加朗读训练', autoSubmit: '请增加朗读训练'
  });
});

test('explicit structured action retains its operation without stringification', () => {
  const action = { prompt: '改成两课时', lessonContextPatch: { periods: 2 } };
  const recovery = submissionHandoff(action.prompt, action);
  assert.equal(resolveAskHandoff({ recovery }).autoSubmit, action);
});

test('answered-but-unsaved action clears composer and both auto-send sources', () => {
  const action = { prompt: '改成两课时' };
  const recovery = submissionHandoff(action.prompt, action, true);
  assert.equal(recovery.pendingAction, null);
  assert.equal(recovery.resumeSubmittedQuestion, false);
  assert.deepEqual(resolveAskHandoff({ recovery, urlQuestion: action.prompt, hasMessages: true }), {
    composerText: '', autoSubmit: ''
  });
  assert.equal(resolveAskHandoff({ recovery: { ...recovery, resumeSubmittedQuestion: true } }).autoSubmit, '');
});

test('local recovery never submits; preserves blank and unsent composers', () => {
  for (const composerText of ['', '尚未提交']) {
    assert.deepEqual(resolveAskHandoff({ canResumeLocal: true, localConversation: { composerText }, hasMessages: true }), { composerText, autoSubmit: '' });
  }
  assert.equal(resolveAskHandoff({ canResumeLocal: true, localConversation: { question: '已回答问题' }, hasMessages: true }).composerText, '');
});

test('explicit URL action remains supported, adaptation never auto-submits', () => {
  assert.equal(resolveAskHandoff({ urlQuestion: '开始备课' }).autoSubmit, '开始备课');
  assert.equal(resolveAskHandoff({ recovery: submissionHandoff('继续'), urlQuestion: '开始备课', isClassAdaptation: true }).autoSubmit, '');
});

test('failed storage really returns false; answered snapshot restores an empty composer', () => {
  const original = globalThis.localStorage;
  const values = new Map();
  let fail = true;
  globalThis.localStorage = {
    getItem: key => values.get(key) || null,
    removeItem: key => values.delete(key),
    setItem(key, value) { if (fail) throw new Error('quota'); values.set(key, value); }
  };
  try {
    const snapshot = { question: '已回答问题', composerText: '', messages: [{ question: '已回答问题', response: { answer: {} } }] };
    assert.equal(saveConversationSnapshot(snapshot, 'test'), false);
    assert.match(LOCAL_SAVE_FAILURE, /本机保存失败/);
    assert.doesNotMatch(LOCAL_SAVE_FAILURE, /已保存|已保留/);
    fail = false;
    assert.equal(saveConversationSnapshot(snapshot, 'test'), true);
    assert.deepEqual(resolveAskHandoff({ canResumeLocal: true, localConversation: readConversationSnapshot('test'), hasMessages: true }), { composerText: '', autoSubmit: '' });
  } finally { globalThis.localStorage = original; }
});

test('local quota failure is not a data-loss warning after the account draft is durable', () => {
  assert.equal(localBackupFailureMatters({
    localSaveFailed: true,
    agentRuntimeEnabled: true,
    accountSaveFailed: false,
    draftId: 'draft-1'
  }), false);
  assert.equal(localBackupFailureMatters({
    localSaveFailed: true,
    agentRuntimeEnabled: true,
    accountSaveFailed: true,
    draftId: 'draft-1'
  }), true);
});


test('unsaved local tail survives a shorter or equally capped account transcript', () => {
  const turns = Array.from({ length: 13 }, (_, i) => ({ question: `q${i}`, response: { answer: { summary: `answer${i}` }, citations: [] } }));
  assert.equal(recoveredTurnsAreAhead(turns.slice(0, 2), turns.slice(0, 1)), true);
  assert.equal(recoveredTurnsAreAhead(turns.slice(1), turns.slice(0, 12)), true);
  assert.equal(recoveredTurnsAreAhead(turns.slice(0, 12), turns.slice(1)), false);
  assert.equal(recoveredTurnsAreAhead(turns.slice(1), turns.slice(1)), false);
  assert.equal(recoveredTurnsAreAhead([], turns), false);
  assert.equal(recoveredTurnsAreAhead(turns, []), true);
});
