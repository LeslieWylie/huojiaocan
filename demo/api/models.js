import { GatewayError, gatewayErrorForStatus, gatewayModelsUrl, normalizeGatewayBaseUrl } from '../serverless/llm-gateway.js';
import { allowMethod, gatewayConfig, json } from '../serverless/shared.js';

const DEFAULT_MODELS_TIMEOUT_MS = 30_000;
const MAX_MODELS_TIMEOUT_MS = 120_000;

function parseTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MODELS_TIMEOUT_MS;
  return Math.min(Math.floor(parsed), MAX_MODELS_TIMEOUT_MS);
}

function publicHttpStatus(error) {
  switch (error?.code) {
    case 'gateway_not_configured':
      return 400;
    case 'gateway_invalid_url':
      return 500;
    case 'gateway_timeout':
      return 504;
    case 'gateway_rate_limited':
      return 429;
    case 'gateway_unavailable':
      return 503;
    case 'gateway_unauthorized':
    case 'gateway_forbidden':
    case 'gateway_invalid_request':
    case 'gateway_request_failed':
    case 'gateway_invalid_response':
    default:
      return 502;
  }
}

/**
 * Keep the models endpoint OpenAI-compatible while discarding every field
 * that is not needed by the application. In particular, never return the
 * complete upstream body because gateways may include diagnostics or secrets.
 */
export function normalizeModelList(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.data)) {
    throw new GatewayError('gateway_invalid_response');
  }

  const data = body.data.map(model => {
    if (!model || typeof model !== 'object' || typeof model.id !== 'string' || !model.id.trim()) return null;
    const result = {
      id: model.id,
      object: 'model'
    };
    if (typeof model.owned_by === 'string' && model.owned_by.trim()) result.owned_by = model.owned_by;
    return result;
  }).filter(Boolean);

  if (body.data.length > 0 && data.length === 0) throw new GatewayError('gateway_invalid_response');
  return { object: 'list', data };
}

function gatewayFailure(error) {
  if (error instanceof GatewayError) return error;
  return new GatewayError('gateway_request_failed', { retryable: true });
}

export function createModelsHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function modelsHandler(req, res) {
    if (!allowMethod(req, res, 'GET')) return;

    try {
      const config = gatewayConfig(env);
      if (!config.baseUrl || !config.apiKey) throw new GatewayError('gateway_not_configured');

      // Normalize here instead of concatenating `${baseUrl}/v1/models`; this
      // keeps roots and already-versioned gateway URLs on the same path.
      normalizeGatewayBaseUrl(config.baseUrl);
      const requestFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
      if (typeof requestFetch !== 'function') {
        throw new GatewayError('gateway_request_failed', { retryable: true });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), parseTimeout(env?.LLM_GATEWAY_TIMEOUT_MS));

      let response;
      try {
        response = await requestFetch(gatewayModelsUrl(config.baseUrl), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${config.apiKey}`
          },
          signal: controller.signal
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new GatewayError('gateway_timeout', { retryable: true });
        }
        throw new GatewayError('gateway_request_failed', { retryable: true });
      } finally {
        clearTimeout(timeout);
      }

      if (!response || !response.ok) throw gatewayErrorForStatus(Number(response?.status) || 0);

      let body;
      try {
        body = await response.json();
      } catch {
        throw new GatewayError('gateway_invalid_response');
      }
      return json(res, 200, normalizeModelList(body));
    } catch (error) {
      const safe = gatewayFailure(error);
      return json(res, publicHttpStatus(safe), { error: safe.code });
    }
  };
}

export default createModelsHandler();
