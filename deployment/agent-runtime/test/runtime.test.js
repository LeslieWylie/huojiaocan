import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { ensureAgentSessionSchema } from '@openmaic/storage/agent-session/pg';
import { AgentRuntime } from '../src/runtime.js';
import { ensureTeachingAgentRequestSchema } from '../src/request-store.js';

async function harness({ execute, save, now } = {}) {
  const db = new PGlite();
  await ensureAgentSessionSchema(db);
  await ensureTeachingAgentRequestSchema(db);
  const queued = [];
  const queue = { send: async message => queued.push(message) };
  const withTransaction = body => db.transaction(tx => body(tx));
  const runtime = new AgentRuntime({ queryable: db, withTransaction, queue, execute, save, now });
  return { db, runtime, queued, close: () => db.close() };
}

async function sessionWithRequest(runtime, overrides = {}) {
  const session = await runtime.createSession('teacher-a', { draftId: 'draft-a', title: '《我爱这土地》' });
  const posted = await runtime.postMessage('teacher-a', session.id, {
    clientRequestId: 'client-1',
    draftId: 'draft-a',
    draftVersion: 3,
    connectionId: 'connection-a',
    question: '怎样设计主问题？',
    materialSnapshot: [{ documentId: 'textbook', page: 14 }],
    ...overrides
  });
  return { session, posted };
}

test('同一 clientRequestId 只写一条请求和一条用户事件', async t => {
  const h = await harness();
  t.after(h.close);
  const { session, posted } = await sessionWithRequest(h.runtime);
  const duplicate = await h.runtime.postMessage('teacher-a', session.id, {
    clientRequestId: 'client-1', draftId: 'draft-a', draftVersion: 3,
    connectionId: 'connection-a', question: '重复点击'
  });

  assert.equal(posted.reused, false);
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.request.id, posted.request.id);
  assert.equal(h.queued.length, 1);
  const requests = await h.runtime.requests.listForSession(session.id, 'teacher-a');
  const messages = await h.runtime.sessions.listUserMessages(session.id);
  assert.equal(requests.length, 1);
  assert.equal(messages.length, 1);
});

test('执行阶段按序落事件，结果先持久化再保存', async t => {
  const calls = [];
  const h = await harness({
    execute: async (request, control) => {
      calls.push(`execute:${request.id}`);
      await control.checking();
      return { answer: { summary: '完整方案' }, citations: [{ id: 'E1' }] };
    },
    save: async request => calls.push(`save:${request.status}:${Boolean(request.result)}`)
  });
  t.after(h.close);
  const { session, posted } = await sessionWithRequest(h.runtime);
  const outcome = await h.runtime.processSession(session.id, 'worker-a');

  assert.equal(outcome.status, 'saved');
  assert.deepEqual(calls, [`execute:${posted.request.id}`, 'save:ready_to_save:true']);
  const stored = await h.runtime.requests.getOwned(posted.request.id, 'teacher-a');
  assert.equal(stored.status, 'saved');
  assert.equal(stored.modelCallCount, 1);
  const events = await h.runtime.sessions.readEventsAfter(session.id, 0);
  assert.deepEqual(events.filter(event => event.type === 'teaching_phase').map(event => event.data.status), [
    'retrieving', 'composing', 'checking', 'saved'
  ]);
});

test('保存失败停在 ready_to_save，重试保存不再调用模型', async t => {
  let executions = 0;
  let saves = 0;
  const h = await harness({
    execute: async (_request, control) => {
      executions += 1;
      await control.checking();
      return { answer: { summary: '已生成' } };
    },
    save: async () => { saves += 1; throw Object.assign(new Error('conflict'), { code: 'edit_conflict' }); }
  });
  t.after(h.close);
  const { session, posted } = await sessionWithRequest(h.runtime);
  const first = await h.runtime.processSession(session.id, 'worker-a');
  assert.equal(first.status, 'ready_to_save');
  assert.equal(executions, 1);

  h.runtime.save = async () => { saves += 1; };
  assert.equal(await h.runtime.sessions.requeueSession(session.id), true);
  const retry = await h.runtime.processSession(session.id, 'worker-b');
  assert.equal(retry.status, 'saved');
  assert.equal(executions, 1);
  assert.equal(saves, 2);
  assert.equal((await h.runtime.requests.getOwned(posted.request.id, 'teacher-a')).modelCallCount, 1);
});

test('租约过期接管不会盲目重跑已开始但结果未知的模型', async t => {
  let executions = 0;
  const h = await harness({ execute: async () => { executions += 1; return { answer: {} }; } });
  t.after(h.close);
  const { session, posted } = await sessionWithRequest(h.runtime);
  const firstClaim = await h.runtime.sessions.claimNextSession('dead-worker', 0, {
    sessionId: session.id, leaseTtlMs: 90_000, maxAttempts: 3
  });
  await h.runtime.requests.claimQueued(session.id, firstClaim.attempt);
  await h.runtime.requests.markModelStarted(posted.request.id, firstClaim.attempt);
  await h.db.query('UPDATE agent_sessions SET lease_heartbeat_at = 0 WHERE id = $1', [session.id]);

  const outcome = await h.runtime.processSession(session.id, 'replacement-worker');
  assert.equal(outcome.status, 'interrupted');
  assert.equal(executions, 0);
  const stored = await h.runtime.requests.getOwned(posted.request.id, 'teacher-a');
  assert.equal(stored.status, 'interrupted');
  assert.equal(stored.errorCode, 'execution_result_unknown');
});

test('账号不能读取或追加另一账号的会话', async t => {
  const h = await harness();
  t.after(h.close);
  const session = await h.runtime.createSession('teacher-a', { draftId: 'draft-a' });
  assert.equal(await h.runtime.ownedSession('teacher-b', session.id), null);
  assert.equal(await h.runtime.postMessage('teacher-b', session.id, {
    clientRequestId: 'foreign', draftId: 'draft-a', draftVersion: 1,
    connectionId: 'connection-b', question: '越权问题'
  }), null);
  assert.equal((await h.runtime.requests.listForSession(session.id, 'teacher-a')).length, 0);
});

test('并发 consumer 只能有一个取得同一会话租约', async t => {
  const h = await harness();
  t.after(h.close);
  const { session } = await sessionWithRequest(h.runtime);
  const claims = await Promise.all([
    h.runtime.sessions.claimNextSession('worker-a', 0, { sessionId: session.id, leaseTtlMs: 90_000, maxAttempts: 3 }),
    h.runtime.sessions.claimNextSession('worker-b', 0, { sessionId: session.id, leaseTtlMs: 90_000, maxAttempts: 3 })
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test('初次执行加三次过期接管后运行时停止模型执行', async t => {
  let executions = 0;
  const h = await harness({ execute: async () => { executions += 1; return {}; } });
  t.after(h.close);
  const { session } = await sessionWithRequest(h.runtime);
  const attempts = [];
  for (let index = 0; index < 4; index += 1) {
    const claim = await h.runtime.sessions.claimNextSession(`worker-${index}`, 0, {
      sessionId: session.id, leaseTtlMs: 90_000, maxAttempts: 3
    });
    attempts.push(claim?.attempt);
    await h.db.query('UPDATE agent_sessions SET lease_heartbeat_at = 0 WHERE id = $1', [session.id]);
  }
  const exhausted = await h.runtime.processSession(session.id, 'worker-4');
  assert.deepEqual(attempts, [1, 2, 3, 4]);
  assert.deepEqual(exhausted, { status: 'failed', reason: 'max_takeovers_exceeded' });
  assert.equal(executions, 0);
  assert.equal((await h.runtime.sessions.getSession(session.id)).status, 'failed');
});

test('已捕获的执行错误形成失败终态，不触发 Queue 重投或重复模型', async t => {
  let executions = 0;
  const h = await harness({
    execute: async () => {
      executions += 1;
      throw Object.assign(new Error('provider down'), { code: 'deepseek_unavailable' });
    }
  });
  t.after(h.close);
  const { session, posted } = await sessionWithRequest(h.runtime);
  const outcome = await h.runtime.processSession(session.id, 'worker-a');
  assert.deepEqual(outcome, { status: 'failed', reason: 'deepseek_unavailable', requestId: posted.request.id });
  assert.equal(executions, 1);
  assert.equal((await h.runtime.requests.getOwned(posted.request.id, 'teacher-a')).status, 'failed');
  assert.equal((await h.runtime.sessions.getSession(session.id)).status, 'failed');
});
