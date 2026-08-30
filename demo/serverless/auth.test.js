import assert from 'node:assert/strict';
import test from 'node:test';
import { authConfigStatus, decryptSecret, encryptSecret, supabaseConfig } from './auth.js';
import { clearAuthRecovery, normalizeAuthErrorCode, readAuthRecovery, saveAuthRecovery, sessionExpired } from '../src/auth.js';

test('production auth config never falls back to source-embedded credentials', () => {
  const config = supabaseConfig({});
  assert.deepEqual(config, { url: '', serviceKey: '', anonKey: '', encryptionSecret: '' });
  assert.deepEqual(authConfigStatus({}), {
    supabaseConfigured: false,
    databaseConfigured: false,
    keyEncryptionConfigured: false
  });
});

test('AES-GCM user key encryption round-trips with the configured secret', () => {
  const secret = 'test-encryption-secret-32-bytes-minimum';
  const value = 'sk-test-only-not-a-real-provider-key';
  const encrypted = encryptSecret(value, secret);
  assert.notEqual(encrypted.ciphertext, value);
  assert.equal(decryptSecret({
    key_ciphertext: encrypted.ciphertext,
    key_iv: encrypted.iv,
    key_tag: encrypted.tag
  }, secret), value);
  assert.throws(() => decryptSecret({
    key_ciphertext: encrypted.ciphertext,
    key_iv: encrypted.iv,
    key_tag: encrypted.tag
  }, 'wrong-secret'), /key_decrypt_failed/);
});

test('browser session expiry is detected before protected requests', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(sessionExpired({ expires_at: now - 1 }, 0), true);
  assert.equal(sessionExpired({ expires_at: now + 3600 }, 0), false);
  assert.equal(sessionExpired(null), false);
});

test('Supabase auth error aliases become stable teacher-facing codes', () => {
  assert.equal(normalizeAuthErrorCode('invalid_grant'), 'auth_invalid');
  assert.equal(normalizeAuthErrorCode('invalid_login_credentials'), 'auth_invalid');
  assert.equal(normalizeAuthErrorCode('email_exists'), 'user_already_exists');
  assert.equal(normalizeAuthErrorCode('over_email_send_rate_limit'), 'auth_rate_limited');
  assert.equal(normalizeAuthErrorCode('otp_expired'), 'otp_expired');
});

test('auth recovery survives the login redirect until the target page consumes it', () => {
  const createStorage = () => {
    const values = new Map();
    return {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key)
    };
  };
  const previousSession = global.sessionStorage;
  const previousLocal = global.localStorage;
  global.sessionStorage = createStorage();
  global.localStorage = createStorage();
  try {
    saveAuthRecovery({ next: '/ask/?doc=teacher-guide&page=220', question: '怎样备课《岳阳楼记》？', messages: [{ response: { answer: {} } }] });
    const recovered = readAuthRecovery();
    assert.equal(recovered.next, '/ask/?doc=teacher-guide&page=220');
    assert.equal(recovered.question, '怎样备课《岳阳楼记》？');
    assert.equal(recovered.messages.length, 1);
    clearAuthRecovery();
    assert.equal(readAuthRecovery(), null);
  } finally {
    global.sessionStorage = previousSession;
    global.localStorage = previousLocal;
  }
});
