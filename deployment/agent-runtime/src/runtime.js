import { randomUUID } from 'node:crypto';
import { AGENT_SESSION_LIFECYCLE } from '@openmaic/storage';
import { createAgentSessionStore } from './database.js';
import { DEFAULT_RUNTIME_LIMITS, PUBLIC_PHASE_COPY } from './constants.js';
import { postIdempotentTeachingRequest, TeachingRequestStore } from './request-store.js';

function publicEventData(status, extra = {}) {
  return { status, label: PUBLIC_PHASE_COPY[status] || status, ...extra };
}

export class AgentRuntime {
  constructor({ queryable, withTransaction, queue, execute, save, limits = {}, now = Date.now }) {
    this.queryable = queryable;
    this.withTransaction = withTransaction;
    this.queue = queue;
    this.execute = execute;
    this.save = save;
    this.now = now;
    this.limits = { ...DEFAULT_RUNTIME_LIMITS, ...limits };
    this.sessions = createAgentSessionStore(queryable, { withTransaction, now });
    this.requests = new TeachingRequestStore(queryable, withTransaction);
  }

  async createSession(ownerId, input) {
    const id = String(input.sessionId || randomUUID());
    return this.sessions.createSession({
      id,
      ownerId,
      prompt: String(input.prompt || input.title || '活教参备课会话').slice(0, 500),
      stageId: String(input.draftId || `teaching-${id}`),
      origin: 'huojiaocan',
      existingCourse: Boolean(input.draftId)
    });
  }

  async ownedSession(ownerId, sessionId) {
    const session = await this.sessions.getSession(sessionId);
    return session?.ownerId === ownerId ? session : null;
  }

  async postMessage(ownerId, sessionId, input) {
    if (!await this.ownedSession(ownerId, sessionId)) return null;
    const posted = await postIdempotentTeachingRequest({
      queryable: this.queryable,
      withTransaction: this.withTransaction,
      ownerId,
      sessionId,
      input
    });
    if (!posted.reused) await this.queue?.send?.({ sessionId, requestId: posted.request.id, action: 'run' });
    return posted;
  }

  async appendPhase(session, workerId, status, extra = {}) {
    return this.sessions.appendRunEvent(session.id, workerId, {
      ts: this.now(),
      attempt: session.attempt,
      type: 'teaching_phase',
      data: publicEventData(status, extra)
    });
  }

  async finish(session, workerId, status, error) {
    await this.sessions.appendRunEvent(session.id, workerId, {
      ts: this.now(),
      attempt: session.attempt,
      type: status === 'succeeded' ? AGENT_SESSION_LIFECYCLE.sessionEnd : AGENT_SESSION_LIFECYCLE.sessionInterrupted,
      data: { status, ...(error ? { reason: error } : {}) }
    });
    return this.sessions.finishSession(session.id, workerId, {
      status,
      ...(error ? { error } : {}),
      expectedAttempt: session.attempt,
      resetAttempt: status === 'succeeded' || status === 'cancelled'
    });
  }

  async saveReadyRequest(session, workerId, request) {
    if (!this.save) {
      await this.appendPhase(session, workerId, 'ready_to_save', { requestId: request.id });
      return { status: 'ready_to_save', request };
    }
    try {
      await this.save(request);
      const saved = await this.requests.markSaved(request.id);
      await this.appendPhase(session, workerId, 'saved', { requestId: request.id });
      return { status: 'saved', request: saved };
    } catch (error) {
      const pending = await this.requests.setPhase(request.id, 'ready_to_save', { expected: 'ready_to_save', errorCode: String(error?.code || 'save_failed') });
      await this.appendPhase(session, workerId, 'ready_to_save', {
        requestId: request.id,
        reason: String(error?.code || 'save_failed')
      });
      return { status: 'ready_to_save', request: pending || request };
    }
  }

  async processSession(sessionId, workerId = `worker-${randomUUID()}`) {
    const session = await this.sessions.claimNextSession(workerId, 0, {
      sessionId,
      leaseTtlMs: this.limits.leaseTtlMs,
      maxAttempts: this.limits.maxAttempts
    });
    if (!session) return { status: 'not_claimed' };

    let activeRequest = null;
    const heartbeat = setInterval(() => {
      this.sessions.heartbeat(session.id, workerId).catch(() => {});
    }, this.limits.heartbeatMs);
    try {
      // OpenMAIC deliberately keeps stale-running rows claimable so a host can
      // decide how to settle them. This product allows the initial claim plus
      // at most `maxAttempts` abandoned-lease takeovers.
      if (session.attempt > this.limits.maxAttempts + 1) {
        const request = await this.requests.claimQueued(session.id, session.attempt);
        if (request) await this.requests.setPhase(request.id, 'failed', {
          expected: 'retrieving', attempt: session.attempt, errorCode: 'max_takeovers_exceeded'
        });
        await this.appendPhase(session, workerId, 'failed', { reason: 'max_takeovers_exceeded' });
        await this.finish(session, workerId, 'failed', 'max_takeovers_exceeded');
        return { status: 'failed', reason: 'max_takeovers_exceeded' };
      }
      if (await this.sessions.isCancelRequested(session.id)) {
        const request = await this.requests.claimQueued(session.id, session.attempt);
        if (request) await this.requests.setPhase(request.id, 'cancelled', { expected: 'retrieving', attempt: session.attempt });
        await this.appendPhase(session, workerId, 'cancelled', request ? { requestId: request.id } : {});
        await this.finish(session, workerId, 'cancelled');
        return { status: 'cancelled', request };
      }

      let request = await this.requests.claimQueued(session.id, session.attempt);
      activeRequest = request;
      if (!request) {
        const recoverable = await this.requests.findRecoverable(session.id);
        if (recoverable?.status === 'ready_to_save') {
          const result = await this.saveReadyRequest(session, workerId, recoverable);
          await this.finish(session, workerId, 'succeeded');
          return result;
        }
        if (recoverable) {
          const interrupted = await this.requests.markInterrupted(recoverable.id);
          await this.appendPhase(session, workerId, 'interrupted', { requestId: recoverable.id });
          await this.finish(session, workerId, 'failed', 'execution_result_unknown');
          return { status: 'interrupted', request: interrupted };
        }
        await this.finish(session, workerId, 'succeeded');
        return { status: 'empty' };
      }

      await this.appendPhase(session, workerId, 'retrieving', { requestId: request.id });
      if (!this.execute) {
        await this.requests.setPhase(request.id, 'failed', { expected: 'retrieving', attempt: session.attempt, errorCode: 'agent_executor_not_configured' });
        await this.appendPhase(session, workerId, 'failed', { requestId: request.id, reason: 'agent_executor_not_configured' });
        await this.finish(session, workerId, 'failed', 'agent_executor_not_configured');
        return { status: 'failed', requestId: request.id };
      }

      request = await this.requests.markModelStarted(request.id, session.attempt);
      activeRequest = request;
      if (!request) throw Object.assign(new Error('request_lease_lost'), { code: 'request_lease_lost' });
      await this.appendPhase(session, workerId, 'composing', { requestId: request.id });
      const deadlineAt = this.now() + this.limits.deadlineMs;
      const result = await this.execute(request, {
        deadlineAt,
        isCancelled: () => this.sessions.isCancelRequested(session.id),
        checking: async () => {
          await this.requests.setPhase(request.id, 'checking', { expected: 'composing', attempt: session.attempt });
          await this.appendPhase(session, workerId, 'checking', { requestId: request.id });
        }
      });
      if (await this.sessions.isCancelRequested(session.id)) {
        const cancelled = await this.requests.setPhase(request.id, 'cancelled', { expected: ['composing', 'checking'], attempt: session.attempt });
        await this.appendPhase(session, workerId, 'cancelled', { requestId: request.id });
        await this.finish(session, workerId, 'cancelled');
        return { status: 'cancelled', request: cancelled };
      }
      if (result?.response?.evidenceSufficient === false || result?.response?.generation === 'blocked-no-evidence') {
        request = await this.requests.markResultReady(request.id, session.attempt, result);
        if (!request) throw Object.assign(new Error('request_lease_lost'), { code: 'request_lease_lost' });
        const blocked = await this.requests.setPhase(request.id, 'needs_evidence', { expected: 'ready_to_save' });
        await this.appendPhase(session, workerId, 'needs_evidence', { requestId: request.id });
        await this.finish(session, workerId, 'succeeded');
        return { status: 'needs_evidence', request: blocked };
      }
      request = await this.requests.markResultReady(request.id, session.attempt, result);
      activeRequest = request;
      if (!request) throw Object.assign(new Error('request_lease_lost'), { code: 'request_lease_lost' });
      await this.sessions.markUserMessageDelivered(session.id, workerId, session.attempt, request.messageSeq);
      const saved = await this.saveReadyRequest(session, workerId, request);
      await this.finish(session, workerId, 'succeeded');
      if (await this.requests.hasQueued(session.id)) {
        await this.sessions.requeueSession(session.id);
        await this.queue?.send?.({ sessionId: session.id, action: 'run' });
      }
      return saved;
    } catch (error) {
      const reason = String(error?.code || 'agent_run_failed');
      if (activeRequest) {
        await this.requests.setPhase(activeRequest.id, 'failed', {
          expected: ['retrieving', 'composing', 'checking'],
          attempt: session.attempt,
          errorCode: reason
        }).catch(() => {});
        await this.appendPhase(session, workerId, 'failed', { requestId: activeRequest.id, reason }).catch(() => {});
      }
      await this.finish(session, workerId, 'failed', reason).catch(() => {});
      return { status: 'failed', reason, requestId: activeRequest?.id };
    } finally {
      clearInterval(heartbeat);
    }
  }
}
