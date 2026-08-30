import assert from 'node:assert/strict';
import test from 'node:test';
import { authOwnersConflict, canPersistAuthOwner, clearAuthRecovery, readAuthRecovery, safeAuthReturnPath, saveAuthRecovery } from './auth.js';

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

test('登录返回地址只允许站内绝对路径', () => {
  assert.equal(safeAuthReturnPath('/ask/?draftId=1'), '/ask/?draftId=1');
  assert.equal(safeAuthReturnPath('https://evil.example'), '/ask/');
  assert.equal(safeAuthReturnPath('//evil.example'), '/ask/');
  assert.equal(safeAuthReturnPath('/\\evil.example'), '/ask/');
});

test('账号恢复载荷不会交给另一个已登录账号', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
  try {
    saveAuthRecovery({
      ownerUserId: 'teacher-a',
      question: '怎样备课《岳阳楼记》？',
      next: '/ask/?draftId=a'
    });
    assert.equal(readAuthRecovery('teacher-a')?.question, '怎样备课《岳阳楼记》？');
    assert.equal(readAuthRecovery('teacher-b'), null);
    assert.equal(readAuthRecovery(''), null);
    // 身份尚未确定时的拒绝不能消费载荷；A 完成识别后仍能恢复。
    assert.equal(readAuthRecovery('teacher-a')?.question, '怎样备课《岳阳楼记》？');
    clearAuthRecovery();
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
  }
});

test('匿名登录交接仍可被首次账号恢复', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
  try {
    saveAuthRecovery({ question: '怎样备课《我爱这土地》？', next: '/ask/' });
    assert.equal(readAuthRecovery()?.anonymousHandoff, true);
    assert.equal(readAuthRecovery('teacher-first')?.question, '怎样备课《我爱这土地》？');
    clearAuthRecovery();
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
  }
});

test('没有明确匿名标记的旧载荷不会被当作登录交接', () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  globalThis.localStorage = storage();
  globalThis.sessionStorage = storage();
  try {
    sessionStorage.setItem('huojiaocan.auth.recovery', JSON.stringify({
      question: '旧浏览器残留',
      next: '/ask/',
      savedAt: new Date().toISOString()
    }));
    assert.equal(readAuthRecovery('teacher-first'), null);
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
  }
});

test('账号 A 切换到 B 时进入持久化隔离边界', () => {
  assert.equal(authOwnersConflict('teacher-a', 'teacher-b'), true);
  assert.equal(canPersistAuthOwner('teacher-a', 'teacher-b'), false);
  assert.equal(canPersistAuthOwner('teacher-b', 'teacher-b', true), false);
  assert.equal(canPersistAuthOwner('teacher-b', 'teacher-b'), true);
  assert.equal(authOwnersConflict('teacher-a', 'teacher-a'), false);
  assert.equal(authOwnersConflict('', 'teacher-first'), false);
});
