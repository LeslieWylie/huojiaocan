import { createDeepSeekClient, DeepSeekError } from './deepseek.js';
import { callGatewayChatCompletion, GatewayError } from './llm-gateway.js';
import { gatewayConfig } from './shared.js';
import { parseJsonResponse, withGenerationRetry } from '@openmaic/generation';

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
  // OpenMAIC owns extraction and repair of common model JSON defects. Keep our
  // product contract narrower: a teaching result must still be one object,
  // never a top-level array, primitive, or raw model response.
  const parsed = parseJsonResponse(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function retryDelayMs(env = process.env) {
  const requested = Number(env.AI_RETRY_DELAY_MS);
  if (!Number.isFinite(requested) || requested < 0) return DEFAULT_RETRY_DELAY_MS;
  return Math.min(1_500, Math.floor(requested));
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
  const deadline = Number.isFinite(Number(deadlineAt)) && deadlineAt != null
    ? Number(deadlineAt)
    : Date.now() + workflowTimeoutMs(env);
  const remainingMs = () => Math.max(0, deadline - Date.now());

  return {
    configured: usePersonalDeepSeek || gatewayReady,
    source: usePersonalDeepSeek ? 'personal-deepseek' : 'system-gateway',
    remainingMs,
    async completeJson({ messages, maxTokens = 4200, temperature = 0.2 } = {}) {
      if (!Array.isArray(messages) || !messages.length) throw new GatewayError('gateway_invalid_request');
      if (!usePersonalDeepSeek && !gatewayReady) throw new GatewayError('gateway_not_configured');
      let repairFormat = false;
      return withGenerationRetry(async () => {
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
        const effectiveMessages = repairFormat ? [...messages, { role: 'user', content: '上一份输出未形成完整可解析的 JSON。本次重新输出一个完整 JSON 对象；不续写、不加代码块，压缩重复说明以保证闭合。保留教材依据、核心课堂任务和全部必需字段，sourceChecks最多3条；不要添加材料外信息。' }] : messages;
        const completion = await (usePersonalDeepSeek
          ? createDeepSeekClient({
              apiKey: deepseek.apiKey,
              model: deepseek.model,
              timeout: callTimeoutMs
            }).chat({ messages: effectiveMessages, responseFormat: true, maxTokens: requestedMaxTokens })
          : callGatewayChatCompletion(
              {
                messages: effectiveMessages,
                temperature,
                maxTokens: requestedMaxTokens,
                stream: false,
                thinking: { type: 'disabled' },
                response_format: { type: 'json_object' }
              },
              { env, model: config.gatewayModel || config.textModel, timeoutMs: callTimeoutMs }
            ));
        const value = parseStructuredJson(completion.content);
        if (!value || completion.finishReason === 'length') {
          // Diagnostic shape only: never log the prompt, raw answer or credential.
          console.warn('ai_structured_output_incomplete', { source: usePersonalDeepSeek ? 'personal' : 'system', finishReason: completion.finishReason || 'unknown', contentChars: String(completion.content || '').length, repairAttempt: repairFormat });
          repairFormat = true;
          const error = usePersonalDeepSeek ? new DeepSeekError('deepseek_invalid_response') : new GatewayError('gateway_invalid_response');
          error.retryable = true;
          error.isRetryable = true;
          throw error;
        }
        return { completion, value };
      }, {
        label: 'huojiaocan-structured-generation',
        maxRetries: 1,
        baseDelayMs: retryDelayMs(env),
        maxDelayMs: 1_500,
        // Keep retry timing deterministic and bounded by the one request's
        // shared deadline. OpenMAIC supplies the retry state machine; this
        // host adapter supplies the remaining Vercel request budget.
        random: () => 0,
        sleep: async delay => {
          const available = remainingMs() - MIN_RETRY_WINDOW_MS;
          if (available <= 0) throw new GatewayError('gateway_timeout', { retryable: true });
          await new Promise(resolve => setTimeout(resolve, Math.min(delay, available)));
        }
      });
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
  let pendingReviewIssues = [];
  const trace = [{ round: 1, stage: stageNames[0] || 'draft', status: 'completed', issues: issues.length }];

  for (let round = 2; round <= Math.min(Math.max(1, maxRounds), 3); round += 1) {
    // A clean second review needs no optional repair, even at the deadline.
    if (round >= 3 && !issues.length && !pendingReviewIssues.length) break;
    if (typeof model.remainingMs === 'function' && model.remainingMs() < MIN_RETRY_WINDOW_MS) {
      trace.push({ round, stage: stageNames[round - 1] || `review_${round}`, status: 'skipped_deadline' });
      break;
    }
    const messages = reviewMessages?.({ value, round, issues: [...new Set([...issues, ...pendingReviewIssues])].slice(0, 10) });
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
        pendingReviewIssues = [...new Set([...pendingReviewIssues, ...nextIssues])].slice(0, 10);
        continue;
      }
      pendingReviewIssues = [];
      completion = next.completion;
      value = next.value;
      trace.push({ round, stage, status: 'completed', issuesBefore: issues.length, issuesAfter: nextIssues.length });
      issues = nextIssues;
    } catch {
      // A later review round may improve a valid result but must never erase it.
      trace.push({ round, stage, status: round === 2 ? 'fallback_to_draft' : 'fallback_to_reviewed', ...(issues.length ? { issues: issues.length } : {}) });
    }
  }

  return { completion, value, trace, unresolvedIssues: pendingReviewIssues };
}
