import { createHyperdrivePool, createTransactionHook } from './database.js';
import { AgentRuntime } from './runtime.js';
import { requireUser } from './auth.js';
import { errorResponse, handleAgentRequest } from './http.js';

let pool;

function database(env) {
  pool ||= createHyperdrivePool(env);
  return pool;
}

async function backendCall(env, path, request) {
  if (!env.TEACHING_BACKEND?.fetch) throw Object.assign(new Error('teaching_backend_not_configured'), { code: 'teaching_backend_not_configured' });
  const response = await env.TEACHING_BACKEND.fetch(`https://teaching-backend.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.error || 'teaching_backend_failed'), { code: data?.error || 'teaching_backend_failed' });
  return data;
}

function createRuntime(env) {
  const queryable = database(env);
  const withTransaction = createTransactionHook(queryable);
  return new AgentRuntime({
    queryable,
    withTransaction,
    queue: env.AGENT_QUEUE,
    execute: env.TEACHING_BACKEND ? async (request, control) => {
      const data = await backendCall(env, '/execute', {
        requestId: request.id,
        ownerId: request.ownerId,
        draftId: request.draftId,
        draftVersion: request.draftVersion,
        connectionId: request.connectionId,
        question: request.question,
        inputSnapshot: request.inputSnapshot,
        materialSnapshot: request.materialSnapshot,
        deadlineAt: control.deadlineAt
      });
      await control.checking();
      return data.result;
    } : null,
    save: env.TEACHING_BACKEND ? request => backendCall(env, '/save', {
      requestId: request.id,
      ownerId: request.ownerId,
      draftId: request.draftId,
      draftVersion: request.draftVersion,
      result: request.result
    }) : null
  });
}

async function reconcile(env) {
  const db = database(env);
  const staleBefore = Date.now() - 90_000;
  const result = await db.query(
    `SELECT id FROM agent_sessions
     WHERE deleted_at IS NULL AND (
       status = 'queued' OR
       (status = 'running' AND (lease_heartbeat_at IS NULL OR lease_heartbeat_at < $1))
     ) ORDER BY created_at LIMIT 50`,
    [staleBefore]
  );
  await Promise.all(result.rows.map(row => env.AGENT_QUEUE.send({ sessionId: row.id, action: 'run' })));
  return result.rows.length;
}

export default {
  async fetch(request, env) {
    try {
      const user = await requireUser(request, env);
      return await handleAgentRequest(request, { runtime: createRuntime(env), user });
    } catch (error) {
      return errorResponse(error);
    }
  },

  async queue(batch, env) {
    const runtime = createRuntime(env);
    for (const message of batch.messages) {
      try {
        if (message.body?.action === 'retry-save') await runtime.sessions.requeueSession(message.body.sessionId);
        await runtime.processSession(message.body?.sessionId);
        message.ack();
      } catch {
        message.retry({ delaySeconds: Math.min(60, 5 * Math.max(1, message.attempts || 1)) });
      }
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(reconcile(env));
  }
};

export { reconcile };
