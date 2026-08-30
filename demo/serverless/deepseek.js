const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_TIMEOUT_MS = 120_000;

export class DeepSeekError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'DeepSeekError';
    this.code = code;
    this.status = status;
    this.retryable = ['deepseek_timeout', 'deepseek_unavailable', 'deepseek_rate_limited', 'deepseek_request_failed'].includes(code);
  }
}

function timeoutMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(number, 180_000) : DEFAULT_TIMEOUT_MS;
}

function errorForStatus(status) {
  if (status === 401) return new DeepSeekError('deepseek_unauthorized', status);
  if (status === 403) return new DeepSeekError('deepseek_forbidden', status);
  if (status === 408 || status === 504) return new DeepSeekError('deepseek_timeout', status);
  if (status === 429) return new DeepSeekError('deepseek_rate_limited', status);
  if (status >= 500) return new DeepSeekError('deepseek_unavailable', status);
  return new DeepSeekError('deepseek_invalid_request', status);
}

function textContent(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('');
}

function normalize(body) {
  if (!body || !Array.isArray(body.choices) || !body.choices.length) throw new DeepSeekError('deepseek_invalid_response');
  const content = textContent(body.choices[0]?.message?.content);
  if (!content.trim()) throw new DeepSeekError('deepseek_invalid_response');
  return {
    id: typeof body.id === 'string' ? body.id : undefined,
    model: typeof body.model === 'string' ? body.model : undefined,
    content,
    finishReason: body.choices[0]?.finish_reason,
    usage: body.usage && typeof body.usage === 'object' ? body.usage : undefined
  };
}

export function createDeepSeekClient({ apiKey, model = 'deepseek-v4-flash', timeout = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  const key = String(apiKey || '').trim();
  return {
    async chat({ messages, responseFormat = false, maxTokens = 2600 } = {}) {
      if (!key) throw new DeepSeekError('deepseek_unauthorized', 401);
      if (!Array.isArray(messages) || !messages.length) throw new DeepSeekError('deepseek_invalid_request', 400);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs(timeout));
      try {
        let response;
        try {
          response = await fetchImpl(`${DEFAULT_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model,
              messages,
              stream: false,
              thinking: { type: 'disabled' },
              max_tokens: maxTokens,
              ...(responseFormat ? { response_format: { type: 'json_object' } } : {})
            }),
            signal: controller.signal
          });
        } catch (error) {
          if (error?.name === 'AbortError') throw new DeepSeekError('deepseek_timeout', 504);
          throw new DeepSeekError('deepseek_request_failed');
        }
        if (!response?.ok) throw errorForStatus(Number(response?.status) || 0);
        return normalize(await response.json().catch(() => null));
      } finally {
        clearTimeout(timer);
      }
    },
    async testKey() {
      const result = await this.chat({
        messages: [
          { role: 'system', content: '只返回严格 JSON，不要 Markdown。' },
          { role: 'user', content: '{"ok":true}' }
        ],
        responseFormat: true,
        maxTokens: 32
      });
      try {
        JSON.parse(result.content);
      } catch {
        throw new DeepSeekError('deepseek_invalid_response');
      }
      return { ok: true, model: result.model || model };
    }
  };
}
