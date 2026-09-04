import fs from 'node:fs';

export const fixture = JSON.parse(
  fs.readFileSync(new URL('../data/demo-case.json', import.meta.url), 'utf8')
);

export function gatewayConfig(env = process.env) {
  const source = env || {};
  const value = key => typeof source[key] === 'string' ? source[key].trim() : '';
  return {
    baseUrl: value('LLM_GATEWAY_BASE_URL').replace(/\/+$/, ''),
    apiKey: value('LLM_GATEWAY_API_KEY'),
    gatewayModel: value('LLM_GATEWAY_MODEL'),
    textModel: value('LLM_TEXT_MODEL'),
    imageModel: value('LLM_IMAGE_MODEL'),
    imageEndpoint: value('LLM_IMAGE_ENDPOINT'),
    timeoutMs: value('LLM_GATEWAY_TIMEOUT_MS'),
    maxTokens: value('LLM_GATEWAY_MAX_TOKENS'),
    answerMode: value('LLM_ANSWER_MODE') || 'auto',
    allowIndexProviderFallback: value('ALLOW_INDEX_PROVIDER_FALLBACK').toLowerCase() === 'true'
  };
}

export function safeConfig(env = process.env) {
  const config = gatewayConfig(env);
  const textModel = config.gatewayModel || config.textModel;
  return {
    mode: config.baseUrl && config.apiKey && textModel ? 'gateway-ready' : 'fixture',
    gatewayConfigured: Boolean(config.baseUrl && config.apiKey),
    textModelConfigured: Boolean(textModel),
    imageModelConfigured: Boolean(config.imageModel && config.imageEndpoint && (config.imageEndpoint.startsWith('http') || config.baseUrl))
  };
}

export function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

export function allowMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader('Allow', method);
  json(res, 405, { error: 'method_not_allowed' });
  return false;
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && !ArrayBuffer.isView(req.body) && !(req.body instanceof ArrayBuffer)) {
    return req.body;
  }
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body) || ArrayBuffer.isView(req.body) || req.body instanceof ArrayBuffer) {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
        ? req.body
        : Buffer.from(req.body.buffer || req.body, req.body.byteOffset || 0, req.body.byteLength).toString('utf8');
    try { return JSON.parse(rawBody); } catch { return {}; }
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
