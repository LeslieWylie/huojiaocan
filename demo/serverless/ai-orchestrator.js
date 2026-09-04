import { createDeepSeekClient, DeepSeekError } from './deepseek.js';
import { callGatewayChatCompletion, GatewayError } from './llm-gateway.js';
import { gatewayConfig } from './shared.js';

const MAX_ATTEMPTS = 2;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const MIN_RETRY_WINDOW_MS = 5_000;
const DEFAULT_WORKFLOW_TIMEOUT_MS = 55_000;
const DEFAULT_RETRY_DELAY_MS = 180;

function gatewayMaxTokens(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 256) return null;
  return Math.min(16_000, Math.floor(parsed));
}

function workflowTimeoutMs(env = process.env) {
  const requested = Number(env.AI_WORKFLOW_TIMEOUT_MS);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_WORKFLOW_TIMEOUT_MS;
  return Math.min(110_000, Math.max(20_000, requested));
}

export function parseStructuredJson(content) {
  const raw = String(content || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const candidates = [raw];
  const firstObject = raw.indexOf('{');
  const lastObject = raw.lastIndexOf('}');
  // Recover an object wrapped in prose, but never reinterpret a top-level
  // array as an object by slicing out its first and last braces.
  if (!raw.startsWith('[') && firstObject >= 0 && lastObject > firstObject) candidates.push(raw.slice(firstObject, lastObject + 1));
  for (const source of candidates) {
    try {
      const parsed = JSON.parse(source);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // The caller receives one stable invalid-response error. Provider output
      // is deliberately not copied into logs or browser responses.
    }
  }
  return null;
}

function retryDelayMs(env = process.env) {
  const requested = Number(env.AI_RETRY_DELAY_MS);
  if (!Number.isFinite(requested) || requested < 0) return DEFAULT_RETRY_DELAY_MS;
  return Math.min(1_500, Math.floor(requested));
}

async function withBoundedRetry(call, remainingMs, baseDelayMs = DEFAULT_RETRY_DELAY_MS) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (!error?.retryable || attempt === MAX_ATTEMPTS || remainingMs() < MIN_RETRY_WINDOW_MS) throw error;
      // Provider overloads should not be hit again in the same event-loop tick.
      // Keep the pause small and inside the shared workflow deadline.
      const delay = Math.min(baseDelayMs * attempt, Math.max(0, remainingMs() - MIN_RETRY_WINDOW_MS));
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new GatewayError('gateway_request_failed');
}

/**
 * One server-only model seam for both the account's DeepSeek key and the
 * configured OpenAI-compatible system gateway. Retrieval, prompts and product
 * state never need to know which transport is active.
 */
export function createStructuredModel({ env = process.env, deepseek, deadlineAt } = {}) {
  const config = gatewayConfig(env);
  const usePersonalDeepSeek = Boolean(deepseek?.apiKey && deepseek?.model);
  const gatewayReady = Boolean(config.baseUrl && config.apiKey && (config.gatewayModel || config.textModel));
  // All calls in one retrieval -> draft -> review workflow share one deadline.
  // This prevents a retry or optional review round from outliving the request
  // after earlier provider calls have already consumed most of its budget.
  const deadline = Number(deadlineAt) > Date.now() ? Number(deadlineAt) : Date.now() + workflowTimeoutMs(env);
  const remainingMs = () => Math.max(0, deadline - Date.now());

  return {
    configured: usePersonalDeepSeek || gatewayReady,
    source: usePersonalDeepSeek ? 'personal-deepseek' : 'system-gateway',
    remainingMs,
    async completeJson({ messages, maxTokens = 4200, temperature = 0.2 } = {}) {
      if (!Array.isArray(messages) || !messages.length) throw new GatewayError('gateway_invalid_request');
      if (!usePersonalDeepSeek && !gatewayReady) throw new GatewayError('gateway_not_configured');
      const completion = await withBoundedRetry(() => {
        // Recompute the timeout for every retry. A second attempt receives
        // only the time that is still available, never a fresh full budget.
        const callTimeoutMs = Math.min(
          Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : DEFAULT_CALL_TIMEOUT_MS,
          Number(deepseek?.timeoutMs) > 0 ? Number(deepseek.timeoutMs) : DEFAULT_CALL_TIMEOUT_MS,
          remainingMs()
        );
        if (callTimeoutMs < 1_000) throw new GatewayError('gateway_timeout', { retryable: true });
        const requestedMaxTokens = !usePersonalDeepSeek && gatewayMaxTokens(config.maxTokens)
          ? Math.min(maxTokens, gatewayMaxTokens(config.maxTokens))
          : maxTokens;
        return usePersonalDeepSeek
          ? createDeepSeekClient({
              apiKey: deepseek.apiKey,
              model: deepseek.model,
              timeout: callTimeoutMs
            }).chat({ messages, responseFormat: true, maxTokens: requestedMaxTokens })
          : callGatewayChatCompletion(
              {
                messages,
                temperature,
                maxTokens: requestedMaxTokens,
                stream: false,
                thinking: { type: 'disabled' },
                response_format: { type: 'json_object' }
              },
              { env, model: config.gatewayModel || config.textModel, timeoutMs: callTimeoutMs }
            );
      }, remainingMs, retryDelayMs(env));

      const value = parseStructuredJson(completion.content);
      if (!value) {
        if (usePersonalDeepSeek) throw new DeepSeekError('deepseek_invalid_response');
        throw new GatewayError('gateway_invalid_response');
      }
      return { completion, value };
    }
  };
}

/**
 * Run an observable, bounded draft -> review -> targeted-repair workflow.
 * It never exposes chain-of-thought; the trace records only stage, round,
 * status and deterministic issue count for UI progress and tests.
 */
export async function runStructuredReviewLoop({
  model,
  initialMessages,
  reviewMessages,
  detectIssues = () => [],
  maxRounds = 3,
  maxTokens = 4200,
  stageNames = ['grounded_draft', 'evidence_review', 'pedagogy_revision']
} = {}) {
  if (!model?.configured) throw new GatewayError('gateway_not_configured');
  const first = await model.completeJson({ messages: initialMessages, maxTokens });
  let completion = first.completion;
  let value = first.value;
  let issues = [...new Set(detectIssues(value) || [])].slice(0, 10);
  const trace = [{ round: 1, stage: stageNames[0] || 'draft', status: 'completed', issues: issues.length }];

  for (let round = 2; round <= Math.min(Math.max(1, maxRounds), 3); round += 1) {
    if (typeof model.remainingMs === 'function' && model.remainingMs() < MIN_RETRY_WINDOW_MS) {
      trace.push({ round, stage: stageNames[round - 1] || `review_${round}`, status: 'skipped_deadline' });
      break;
    }
    if (round >= 3 && !issues.length) break;
    const messages = reviewMessages?.({ value, round, issues });
    if (!Array.isArray(messages) || !messages.length) break;
    const stage = stageNames[round - 1] || `review_${round}`;
    try {
      const next = await model.completeJson({ messages, maxTokens });
      const nextIssues = [...new Set(detectIssues(next.value) || [])].slice(0, 10);
      // A prose reviewer is allowed to improve wording, but it cannot replace a
      // usable draft with a structurally worse plan. Keep the best complete
      // candidate seen so far and expose only bounded quality metadata.
      if (nextIssues.length > issues.length) {
        trace.push({ round, stage, status: 'rejected_regression', issuesBefore: issues.length, issuesAfter: nextIssues.length });
        continue;
      }
      completion = next.completion;
      value = next.value;
      trace.push({ round, stage, status: 'completed', issuesBefore: issues.length, issuesAfter: nextIssues.length });
      issues = nextIssues;
    } catch {
      // A later review round may improve a valid result but must never erase it.
      trace.push({ round, stage, status: round === 2 ? 'fallback_to_draft' : 'fallback_to_reviewed', ...(issues.length ? { issues: issues.length } : {}) });
    }
  }

  return { completion, value, trace };
}
