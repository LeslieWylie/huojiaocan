import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { ensureAgentSessionSchema } from '@openmaic/storage/agent-session/pg';
import { AgentRuntime } from '../src/runtime.js';
import { handleAgentRequest } from '../src/http.js';
import { ensureTeachingAgentRequestSchema } from '../src/request-store.js';

test('HTTP 会话、幂等消息、状态和 Last-Event-ID 重放形成闭环', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await ensureAgentSessionSchema(db);
  await ensureTeachingAgentRequestSchema(db);
  const queue = { messages: [], async send(value) { this.messages.push(value); } };
  const runtime = new AgentRuntime({
    queryable: db,
    withTransaction: body => db.transaction(tx => body(tx)),
    queue,
    execute: async (_request, control) => { await control.checking(); return { answer: { summary: '方案' } }; }
  });
  const user = { id: 'teacher-a' };
  const createdResponse = await handleAgentRequest(new Request('https://app.test/api/agent/sessions', {
    method: 'POST', body: JSON.stringify({ draftId: 'draft-a', title: '课文' })
  }), { runtime, user });
  assert.equal(createdResponse.status, 201);
  const sessionId = (await createdResponse.json()).session.id;

  const messageResponse = await handleAgentRequest(new Request(`https://app.test/api/agent/sessions/${sessionId}/messages`, {
    method: 'POST', body: JSON.stringify({
      clientRequestId: 'request-a', draftId: 'draft-a', draftVersion: 1,
      connectionId: 'key-a', question: '怎样备课？'
    })
  }), { runtime, user });
  assert.equal(messageResponse.status, 202);
  assert.equal((await messageResponse.json()).reused, false);
  await runtime.processSession(sessionId, 'worker-a');

  const stateResponse = await handleAgentRequest(new Request(`https://app.test/api/agent/sessions/${sessionId}`), { runtime, user });
  const state = await stateResponse.json();
  assert.equal(state.session.requests[0].status, 'ready_to_save');
  assert.deepEqual(state.session.requests[0].result, { answer: { summary: '方案' } });

  const firstEvents = await handleAgentRequest(new Request(`https://app.test/api/agent/sessions/${sessionId}/events?format=json`), { runtime, user });
  const replay = await firstEvents.json();
  assert.ok(replay.events.length >= 5);
  const cursor = replay.events.at(-2).id;
  const tailResponse = await handleAgentRequest(new Request(`https://app.test/api/agent/sessions/${sessionId}/events`, {
    headers: { 'Last-Event-ID': String(cursor) }
  }), { runtime, user });
  const tail = await tailResponse.text();
  assert.match(tail, new RegExp(`id: ${replay.events.at(-1).id}`));
  assert.doesNotMatch(tail, new RegExp(`id: ${cursor}\\n`));
});

test('取消接口终止尚未完成的请求', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await ensureAgentSessionSchema(db);
  await ensureTeachingAgentRequestSchema(db);
  const runtime = new AgentRuntime({
    queryable: db,
    withTransaction: body => db.transaction(tx => body(tx)),
    queue: { send: async () => {} }
  });
  const user = { id: 'teacher-a' };
  const session = await runtime.createSession(user.id, { draftId: 'draft-a' });
  const posted = await runtime.postMessage(user.id, session.id, {
    clientRequestId: 'cancel-me', draftId: 'draft-a', draftVersion: 1,
    connectionId: 'key-a', question: '取消这一轮'
  });
  const response = await handleAgentRequest(new Request(`https://app.test/api/agent/sessions/${session.id}/cancel`, { method: 'POST' }), { runtime, user });
  assert.equal(response.status, 202);
  assert.deepEqual((await response.json()).cancelledRequestIds, [posted.request.id]);
  assert.equal((await runtime.requests.getOwned(posted.request.id, user.id)).status, 'cancelled');
  assert.equal((await runtime.processSession(session.id, 'worker-a')).status, 'not_claimed');
  assert.equal((await runtime.sessions.getSession(session.id)).status, 'cancelled');
});
