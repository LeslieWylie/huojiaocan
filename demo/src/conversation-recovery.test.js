import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAskContext, buildConversationHistory } from './conversation-context.js';
import { TTL_MS } from './conversation-recovery.js';

test('conversation recovery keeps only bounded grounded turns and strips invalid entries', async () => {
  const source = await import('./conversation-recovery.js');
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    setItem(key, value) { values.set(key, String(value)); },
    getItem(key) { return values.get(key) || null; },
    removeItem(key) { values.delete(key); }
  };
  try {
    assert.equal(source.saveConversationSnapshot({
      draftId: 'draft-1',
      messages: [{ question: '有效', response: {} }, { question: '', response: {} }, ...Array.from({ length: 14 }, (_, i) => ({ question: `q${i}`, response: { answer: i } }))],
      conversationHistory: Array.from({ length: 14 }, (_, i) => ({ role: 'user', content: `h${i}` })),
      savedAt: new Date().toISOString()
    }, 'user-1'), true);
    const recovered = source.readConversationSnapshot('user-1');
    assert.equal(recovered.draftId, 'draft-1');
    assert.equal(recovered.messages.length, 12);
    assert.equal(recovered.messages.at(-1).question, 'q13');
    assert.equal(recovered.conversationHistory.length, 12);
    assert.equal(recovered.messages.some(item => !item.question || !item.response), false);
    assert.equal(source.TTL_MS, TTL_MS);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('expired conversation recovery is discarded', async () => {
  const source = await import('./conversation-recovery.js');
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    setItem(key, value) { values.set(key, String(value)); },
    getItem(key) { return values.get(key) || null; },
    removeItem(key) { values.delete(key); }
  };
  try {
    source.saveConversationSnapshot({ draftId: 'old', savedAt: new Date(Date.now() - TTL_MS - 1000).toISOString() }, 'user-2');
    assert.equal(source.readConversationSnapshot('user-2'), null);
    assert.equal(values.size, 0);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('authenticated recovery can consume an anonymous login hand-off', async () => {
  const source = await import('./conversation-recovery.js');
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    setItem(key, value) { values.set(key, String(value)); },
    getItem(key) { return values.get(key) || null; },
    removeItem(key) { values.delete(key); }
  };
  try {
    source.saveConversationSnapshot({ draftId: 'handoff', messages: [{ question: 'q', response: {} }], savedAt: new Date().toISOString() });
    assert.equal(source.readConversationSnapshot('user-3')?.draftId, 'handoff');
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('an anonymous login hand-off is consumed once and isolated from later accounts', async () => {
  const source = await import('./conversation-recovery.js');
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    setItem(key, value) { values.set(key, String(value)); },
    getItem(key) { return values.get(key) || null; },
    removeItem(key) { values.delete(key); }
  };
  try {
    source.saveConversationSnapshot({
      draftId: 'anonymous-draft',
      lessonRef: { title: '《岳阳楼记》' },
      messages: [{ question: '怎样备课《岳阳楼记》？', response: {} }]
    });

    const firstLogin = source.readConversationSnapshot('teacher-a');
    assert.equal(firstLogin?.draftId, 'anonymous-draft');
    assert.equal(values.has(source.conversationStorageKey()), false);

    source.saveConversationSnapshot(firstLogin, 'teacher-a');
    assert.equal(source.readConversationSnapshot('teacher-b'), null);
    assert.equal(source.readConversationSnapshot('teacher-a')?.draftId, 'anonymous-draft');
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('refresh recovery preserves enough context for the next continuous follow-up', async () => {
  const source = await import('./conversation-recovery.js');
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    setItem(key, value) { values.set(key, String(value)); },
    getItem(key) { return values.get(key) || null; },
    removeItem(key) { values.delete(key); }
  };
  try {
    const identityQuestion = '怎样备课《我爱这土地》？';
    const lessonRef = { documentId: 'teacher-guide', title: '《我爱这土地》', pageRange: [51, 57] };
    const messages = [{
      question: identityQuestion,
      response: { answer: { reply: '先从意象群进入，再落到献身之情。' } }
    }, {
      question: '第一节先抓哪些意象？',
      response: { answer: { reply: '先抓土地、河流、风和黎明。' } }
    }];
    const pendingFollowUp = '那第二节怎样从意象过渡到主旨？';
    const conversationHistory = buildConversationHistory(messages, [
      { role: 'user', content: pendingFollowUp }
    ]);

    source.saveConversationSnapshot({
      draftId: 'draft-refresh-follow-up',
      question: pendingFollowUp,
      planQuestion: identityQuestion,
      lessonRef,
      messages,
      conversationHistory,
      next: '/ask/?draftId=draft-refresh-follow-up'
    }, 'teacher-refresh');

    const restored = source.readConversationSnapshot('teacher-refresh');
    const nextQuestion = '评价任务怎样承接第二节？';
    const nextContext = buildAskContext({
      text: nextQuestion,
      identityQuestion: restored.planQuestion,
      lessonRef: restored.lessonRef
    });
    const nextHistory = buildConversationHistory(restored.messages, [
      ...restored.conversationHistory.slice(-1),
      { role: 'assistant', content: '第二节由意象关系归纳诗人的献身立场。' },
      { role: 'user', content: nextQuestion }
    ]);

    assert.equal(restored.question, pendingFollowUp);
    assert.equal(restored.conversationHistory.at(-1).content, pendingFollowUp);
    assert.equal(nextContext.identityTitle, '《我爱这土地》');
    assert.equal(nextContext.canonicalQuestion, identityQuestion);
    assert.equal(nextContext.retrievalQuery, `《我爱这土地》 ${nextQuestion}`);
    assert.equal(nextHistory.at(-3).content, pendingFollowUp);
    assert.match(nextHistory.at(-2).content, /意象关系归纳诗人的献身立场/u);
    assert.equal(nextHistory.at(-1).content, nextQuestion);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('recent lesson threads remain separately resumable on the same account', async () => {
  const source = await import('./conversation-recovery.js');
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    setItem(key, value) { values.set(key, String(value)); },
    getItem(key) { return values.get(key) || null; },
    removeItem(key) { values.delete(key); }
  };
  try {
    source.saveConversationSnapshot({
      question: '怎样备课《沁园春·雪》？',
      planQuestion: '怎样备课《沁园春·雪》？',
      lessonRef: { documentId: 'teacher-guide', nodeId: 'lesson-snow', title: '《沁园春·雪》' },
      messages: [{ question: '先抓哪些意象？', response: { answer: { reply: '先看上阕景物。' } } }]
    }, 'teacher-recent');
    const snow = source.readRecentConversationSnapshots('teacher-recent')[0];

    source.saveConversationSnapshot({
      question: '怎样备课《岳阳楼记》？',
      planQuestion: '怎样备课《岳阳楼记》？',
      lessonRef: { documentId: 'teacher-guide', nodeId: 'lesson-yueyang', title: '《岳阳楼记》' },
      messages: [{ question: '先处理哪一段？', response: { answer: { reply: '先梳理迁客骚人的情感变化。' } } }]
    }, 'teacher-recent');

    const recent = source.readRecentConversationSnapshots('teacher-recent');
    assert.equal(recent.length, 2);
    assert.equal(recent[0].lessonRef.title, '《岳阳楼记》');
    assert.equal(source.readConversationSnapshot('teacher-recent', snow.resumeId)?.lessonRef.title, '《沁园春·雪》');
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('recent lesson threads are isolated by account and bounded', async () => {
  const source = await import('./conversation-recovery.js');
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    setItem(key, value) { values.set(key, String(value)); },
    getItem(key) { return values.get(key) || null; },
    removeItem(key) { values.delete(key); }
  };
  try {
    for (let index = 0; index < source.MAX_RECENT + 3; index += 1) {
      source.saveConversationSnapshot({
        question: `问题 ${index}`,
        planQuestion: `怎样备课《篇目${index}》？`,
        lessonRef: { nodeId: `lesson-${index}`, title: `《篇目${index}》` },
        messages: [{ question: `问题 ${index}`, response: { answer: { reply: `回答 ${index}` } } }]
      }, 'teacher-a');
    }
    assert.equal(source.readRecentConversationSnapshots('teacher-a').length, source.MAX_RECENT);
    assert.equal(source.readRecentConversationSnapshots('teacher-b').length, 0);
    assert.equal(source.readRecentConversationSnapshots().length, 0);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});
