// Keep automatic recovery narrow: a teacher can safely retry a read timeout,
// but malformed requests and authentication failures should be shown directly.
const RETRYABLE_ASK_CODES = new Set([
  'pageindex_unavailable',
  'pageindex_timeout',
  'pageindex_rate_limited',
  'pageindex_invalid_response',
  'pageindex_request_failed',
  'index_provider_error',
  'gateway_timeout',
  'gateway_rate_limited',
  'gateway_unavailable',
  'gateway_request_failed'
]);

export function askErrorCode(error) {
  return String(error?.code || error?.message || '').trim();
}

export function isRetryableAskError(error) {
  return RETRYABLE_ASK_CODES.has(askErrorCode(error));
}

export async function withAskRetry(task, { maxRetries = 1, onRetry } = {}) {
  if (typeof task !== 'function') throw new TypeError('task must be a function');
  const retries = Math.max(0, Number(maxRetries) || 0);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      if (attempt >= retries || !isRetryableAskError(error)) throw error;
      if (typeof onRetry === 'function') onRetry(error, attempt + 1);
      await new Promise(resolve => setTimeout(resolve, 180));
    }
  }
  throw new Error('ask_retry_exhausted');
}

export { RETRYABLE_ASK_CODES };
