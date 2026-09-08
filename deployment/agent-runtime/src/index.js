import { createHyperdrivePool, createTransactionHook } from './database.js';
import { AgentRuntime } from './runtime.js';
import { requireUser } from './auth.js';
import { errorResponse, handleAgentRequest } from './http.js';

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

function createRuntime(env, queryable) {
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
      connectionId: request.connectionId,
      question: request.question,
      inputSnapshot: request.inputSnapshot,
      materialSnapshot: request.materialSnapshot,
      result: request.result
    }) : null
  });
}

async function reconcile(env, db = createHyperdrivePool(env)) {
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

function logRuntimeError(scope, error) {
  console.error(scope, {
    name: String(error?.name || 'Error').slice(0, 80),
    code: String(error?.code || '').slice(0, 80),
    message: String(error?.message || 'agent_runtime_failed').slice(0, 300)
  });
}

export default {
  async fetch(request, env) {
    const db = createHyperdrivePool(env);
    try {
      const user = await requireUser(request, env);
      return await handleAgentRequest(request, { runtime: createRuntime(env, db), user });
    } catch (error) {
      logRuntimeError('agent_runtime_fetch_failed', error);
      return errorResponse(error);
    } finally {
      // A Worker request gets a short-lived client pool; Hyperdrive owns the
      // durable origin pool. Closing here prevents sub-second status polling
      // from accumulating idle client sockets inside one isolate.
      await db.end().catch(() => {});
    }
  },

  async queue(batch, env) {
    const db = createHyperdrivePool(env);
    try {
      const runtime = createRuntime(env, db);
      for (const message of batch.messages) {
        try {
          if (message.body?.action === 'retry-save') await runtime.sessions.requeueSession(message.body.sessionId);
          await runtime.processSession(message.body?.sessionId);
          message.ack();
        } catch (error) {
          logRuntimeError('agent_runtime_queue_failed', error);
          message.retry({ delaySeconds: Math.min(60, 5 * Math.max(1, message.attempts || 1)) });
        }
      }
    } finally {
      await db.end().catch(() => {});
    }
  },

  async scheduled(_controller, env, ctx) {
    const db = createHyperdrivePool(env);
    ctx.waitUntil(reconcile(env, db).finally(() => db.end()));
  }
};

export { reconcile };
