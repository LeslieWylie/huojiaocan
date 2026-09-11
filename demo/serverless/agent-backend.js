import crypto from 'node:crypto';
import { executeOwnedAsk } from '../api/index.js';
import { supabaseRest } from './auth.js';
import { mergeFollowUpCitations } from '../src/citation-merge.js';

function codeError(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

function required(value, code, max = 500) {
  const text = String(value || '').trim();
  if (!text) throw codeError(code);
  return text.slice(0, max);
}

function safeSecretEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requireAgentBackendSecret(req, env = process.env) {
  const configured = String(env.AGENT_INTERNAL_SECRET || '');
  const supplied = String(req?.headers?.['x-agent-internal-secret'] || req?.headers?.get?.('x-agent-internal-secret') || '');
  if (!safeSecretEqual(configured, supplied)) throw codeError('agent_backend_forbidden', 403);
}

function requestInput(payload = {}) {
  const snapshot = payload.inputSnapshot && typeof payload.inputSnapshot === 'object' ? payload.inputSnapshot : {};
  return {
    ownerId: required(payload.ownerId, 'owner_id_required', 120),
    requestId: required(payload.requestId, 'request_id_required', 120),
    draftId: required(payload.draftId, 'draft_id_required', 120),
    draftVersion: Number(payload.draftVersion),
    connectionId: required(payload.connectionId, 'connection_id_required', 120),
    question: required(payload.question, 'question_required', 1800),
    deadlineAt: Number(payload.deadlineAt),
    snapshot
  };
}

async function ownedDraft(ownerId, draftId, env) {
  const rows = await supabaseRest('lesson_drafts', {
    env,
    query: {
      select: 'id,title,question,scope,lesson_context,answer,citations,cards,version,updated_at,created_at',
      user_id: `eq.${ownerId}`,
      id: `eq.${draftId}`,
      limit: '1'
    }
  });
  const draft = Array.isArray(rows) ? rows[0] : null;
  if (!draft) throw codeError('draft_not_found', 404);
  return draft;
}

function boundedHistory(value = []) {
  return (Array.isArray(value) ? value : [])
    .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map(item => ({ role: item.role, content: item.content.trim().slice(0, 1800) }))
    .filter(item => item.content)
    .slice(-8);
}

export async function executeAgentTeaching(payload, env = process.env) {
  const input = requestInput(payload);
  if (!(input.draftVersion > 0)) throw codeError('draft_version_required');
  const draft = await ownedDraft(input.ownerId, input.draftId, env);
  if (Number(draft.version) !== input.draftVersion) throw codeError('edit_conflict', 409);
  const response = await executeOwnedAsk({
    user: { id: input.ownerId, email: '', token: '' },
    env,
    body: {
      draftId: input.draftId,
      question: input.question,
      keyId: input.connectionId,
      retrievalQuery: input.snapshot.retrievalQuery,
      teachingFocus: input.snapshot.teachingFocus,
      scope: input.snapshot.scope,
      limit: 8,
      lessonContext: input.snapshot.lessonContext,
      lessonIdentity: input.snapshot.lessonIdentity,
      followUpInstruction: input.snapshot.followUpInstruction,
      operation: input.snapshot.operation,
      retrievalMode: input.snapshot.retrievalMode,
      deadlineAt: input.deadlineAt
    }
  });
  return { response };
}

export async function saveAgentTeaching(payload, env = process.env) {
  const input = requestInput(payload);
  if (!(input.draftVersion > 0)) throw codeError('draft_version_required');
  const draft = await ownedDraft(input.ownerId, input.draftId, env);
  if (draft.answer?.agentSaveReceipt?.requestId === input.requestId) {
    return { draftId: draft.id, draftVersion: draft.version, reused: true };
  }
  if (Number(draft.version) !== input.draftVersion) throw codeError('edit_conflict', 409);
  const rawResponse = payload.result?.response;
  if (!rawResponse || typeof rawResponse !== 'object') throw codeError('agent_result_required');
  if (rawResponse.evidenceSufficient === false || rawResponse.generation === 'blocked-no-evidence') throw codeError('agent_evidence_insufficient', 422);

  const merged = mergeFollowUpCitations(draft.citations, rawResponse);
  const response = merged.response;
  const priorAnswer = draft.answer && typeof draft.answer === 'object' ? draft.answer : {};
  const reply = String(response.answer?.reply || response.answer?.summary || '').trim();
  const conversationHistory = [
    ...boundedHistory(priorAnswer.conversationHistory),
    { role: 'user', content: input.question },
    ...(reply ? [{ role: 'assistant', content: reply.slice(0, 1800) }] : [])
  ].slice(-10);
  const conversationTurns = [
    ...(Array.isArray(priorAnswer.conversationTurns) ? priorAnswer.conversationTurns : []),
    {
      role: 'user',
      question: input.question,
      operationLabel: String(input.snapshot.operationLabel || input.snapshot.followUpInstruction || '').slice(0, 260),
      response
    }
  ].slice(-12);
  const nextAnswer = {
    ...priorAnswer,
    ...(response.answer && typeof response.answer === 'object' ? response.answer : {}),
    ...(priorAnswer.planApproval ? { planApproval: { ...priorAnswer.planApproval, hasUnconfirmedChanges: true } } : {}),
    sourceCoverage: response.sourceCoverage || response.answer?.sourceCoverage,
    conversationHistory,
    conversationTurns,
    agentSaveReceipt: { requestId: input.requestId, baseVersion: input.draftVersion },
    evidenceShelf: Array.isArray(payload.materialSnapshot) ? payload.materialSnapshot : (priorAnswer.evidenceShelf || [])
  };
  const nextVersion = Number(draft.version) + 1;
  const rows = await supabaseRest('lesson_drafts', {
    method: 'PATCH',
    env,
    body: {
      title: String(response.answer?.lesson?.title || draft.title || '未命名备课').slice(0, 160),
      question: String(input.snapshot.identityQuestion || draft.question || '').slice(0, 1800),
      scope: Array.isArray(input.snapshot.scope) ? input.snapshot.scope : draft.scope,
      lesson_context: {
        ...(draft.lesson_context && typeof draft.lesson_context === 'object' ? draft.lesson_context : {}),
        ...(input.snapshot.lessonContext && typeof input.snapshot.lessonContext === 'object' ? input.snapshot.lessonContext : {}),
        ...(input.snapshot.lessonRef && typeof input.snapshot.lessonRef === 'object' ? { lessonRef: input.snapshot.lessonRef } : {})
      },
      answer: nextAnswer,
      citations: merged.citations,
      version: nextVersion,
      updated_at: new Date().toISOString()
    },
    query: {
      user_id: `eq.${input.ownerId}`,
      id: `eq.${input.draftId}`,
      version: `eq.${input.draftVersion}`
    }
  });
  const saved = Array.isArray(rows) ? rows[0] : null;
  if (!saved) throw codeError('edit_conflict', 409);
  return { draftId: saved.id, draftVersion: saved.version };
}
