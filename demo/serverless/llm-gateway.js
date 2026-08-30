/**
 * Small, server-only OpenAI-compatible gateway client.
 *
 * The public configuration contract accepts either a gateway origin or an
 * origin that already ends in /v1. Internally the client always stores the
 * normalized /v1 base and calls /v1/chat/completions exactly once.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export class GatewayError extends Error {
  constructor(code, { status = 0, retryable = false } = {}) {
    // Keep the message equal to a stable public-safe code. Never include the
    // upstream response body, URL, request headers, or provider diagnostics.
    super(code);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }

  toJSON() {
    return { error: this.code };
  }
}

function throwGateway(code, options) {
  throw new GatewayError(code, options);
}

function parseTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(parsed), MAX_TIMEOUT_MS);
}

/**
 * Normalize an absolute gateway URL to a base ending in exactly one /v1.
 *
 * Examples:
 *   https://gateway.example       -> https://gateway.example/v1
 *   https://gateway.example/      -> https://gateway.example/v1
 *   https://gateway.example/v1    -> https://gateway.example/v1
 *   https://gateway.example/v1/   -> https://gateway.example/v1
 */
export function normalizeGatewayBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throwGateway('gateway_not_configured');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throwGateway('gateway_invalid_url');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throwGateway('gateway_invalid_url');
  }

  // Remove any trailing /v1 segments first, then add one canonical /v1.
  // This also prevents accidental /v1/v1 when a caller supplies a prefixed
  // base URL and the client appends an endpoint path.
  const pathWithoutVersion = url.pathname
    .replace(/\/+$/g, '')
    .replace(/(?:\/v1)+$/gi, '');
  url.pathname = `${pathWithoutVersion || ''}/v1`;
  return url.toString().replace(/\/$/, '');
}

export function gatewayChatCompletionsUrl(baseUrl) {
  return `${normalizeGatewayBaseUrl(baseUrl)}/chat/completions`;
}

export function gatewayModelsUrl(baseUrl) {
  return `${normalizeGatewayBaseUrl(baseUrl)}/models`;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('');
}

function numberOrUndefined(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Project an OpenAI-compatible response to the small shape the application
 * needs. Unknown upstream fields are intentionally discarded.
 */
export function normalizeChatCompletion(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.choices) || !body.choices.length) {
    throwGateway('gateway_invalid_response');
  }

  const first = body.choices[0];
  const message = first && typeof first === 'object' ? first.message : null;
  const content = textFromContent(message?.content);
  if (!content) throwGateway('gateway_invalid_response');

  const usage = body.usage && typeof body.usage === 'object'
    ? {
        promptTokens: numberOrUndefined(body.usage.prompt_tokens),
        completionTokens: numberOrUndefined(body.usage.completion_tokens),
        totalTokens: numberOrUndefined(body.usage.total_tokens)
      }
    : undefined;

  return {
    id: typeof body.id === 'string' ? body.id : undefined,
    model: typeof body.model === 'string' ? body.model : undefined,
    content,
    finishReason: typeof first?.finish_reason === 'string' ? first.finish_reason : undefined,
    usage
  };
}

function codeForStatus(status) {
  if (status <= 0) return 'gateway_request_failed';
  if (status === 401) return 'gateway_unauthorized';
  if (status === 403) return 'gateway_forbidden';
  if (status === 408 || status === 504) return 'gateway_timeout';
  if (status === 429) return 'gateway_rate_limited';
  if (status >= 500 && status <= 599) return 'gateway_unavailable';
  return 'gateway_invalid_request';
}

/**
 * Convert an upstream HTTP status to a public-safe, stable GatewayError.
 * The upstream response body is deliberately never read by callers.
 */
export function gatewayErrorForStatus(status) {
  const numericStatus = Number(status);
  const safeStatus = Number.isInteger(numericStatus) && numericStatus >= 0 ? numericStatus : 0;
  const code = codeForStatus(safeStatus);
  return new GatewayError(code, {
    status: safeStatus,
    retryable: code === 'gateway_timeout'
      || code === 'gateway_request_failed'
      || code === 'gateway_rate_limited'
      || code === 'gateway_unavailable'
  });
}

function requestHeaders(apiKey) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
}

function configuredValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createGatewayClient(options = {}) {
  const env = options.env || globalThis.process?.env || {};
  const baseUrl = options.baseUrl ?? env.LLM_GATEWAY_BASE_URL;
  const apiKey = configuredValue(options.apiKey ?? env.LLM_GATEWAY_API_KEY);
  const defaultModel = configuredValue(
    options.model
      ?? options.textModel
      ?? env.LLM_GATEWAY_MODEL
      ?? env.LLM_TEXT_MODEL
  );
  const timeoutMs = parseTimeout(options.timeoutMs ?? env.LLM_GATEWAY_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    timeoutMs,
    get configured() {
      return Boolean(configuredValue(baseUrl) && apiKey && defaultModel);
    },
    async chatCompletions({ messages, model = defaultModel, temperature, maxTokens, signal, ...extra } = {}) {
      if (!configuredValue(baseUrl) || !apiKey || !configuredValue(model)) {
        throw new GatewayError('gateway_not_configured');
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new GatewayError('gateway_invalid_request');
      }
      if (typeof fetchImpl !== 'function') {
        throw new GatewayError('gateway_request_failed', { retryable: true });
      }

      const url = gatewayChatCompletionsUrl(baseUrl);
      const payload = {
        model: configuredValue(model),
        messages,
        ...extra
      };
      if (temperature !== undefined) payload.temperature = temperature;
      if (maxTokens !== undefined) payload.max_tokens = maxTokens;

      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      let removeAbortListener = () => {};
      if (signal) {
        if (signal.aborted) controller.abort();
        else {
          const onAbort = () => controller.abort();
          signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener('abort', onAbort);
        }
      }

      try {
        let response;
        try {
          response = await fetchImpl(url, {
            method: 'POST',
            headers: requestHeaders(apiKey),
            body: JSON.stringify(payload),
            signal: controller.signal
          });
        } catch (error) {
          if (timedOut || error?.name === 'AbortError') {
            throw new GatewayError('gateway_timeout', { retryable: true });
          }
          throw new GatewayError('gateway_request_failed', { retryable: true });
        }

        if (!response || !response.ok) {
          // Do not read or include the upstream body. It may contain secrets,
          // internal URLs, stack traces, or provider-specific diagnostics.
          throw gatewayErrorForStatus(Number(response?.status) || 0);
        }

        let body;
        try {
          body = await response.json();
        } catch {
          throw new GatewayError('gateway_invalid_response');
        }
        return normalizeChatCompletion(body);
      } finally {
        clearTimeout(timeout);
        removeAbortListener();
      }
    }
  };
}

export async function callGatewayChatCompletion(input, options = {}) {
  return createGatewayClient(options).chatCompletions(input);
}
