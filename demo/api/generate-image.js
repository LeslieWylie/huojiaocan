import { allowMethod, gatewayConfig, json, readJson } from '../serverless/shared.js';

export default async function handler(req, res) {
  if (!allowMethod(req, res, 'POST')) return;
  const config = gatewayConfig();
  if (!config.apiKey || !config.imageModel || !config.imageEndpoint || (!config.imageEndpoint.startsWith('http') && !config.baseUrl)) {
    return json(res, 400, { error: '图片网关尚未完整配置' });
  }

  const input = await readJson(req);
  const prompt = String(input.prompt || '九年级语文诗歌课堂，象征性的飞鸟掠过辽阔土地，克制的教材插画风格，无文字').trim().slice(0, 1000);
  const endpoint = config.imageEndpoint.startsWith('http')
    ? config.imageEndpoint
    : `${config.baseUrl}${config.imageEndpoint.startsWith('/') ? '' : '/'}${config.imageEndpoint}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.imageModel, prompt, size: '1024x1024', n: 1 })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return json(res, response.status, { error: '图片网关返回错误' });
    const image = body.data?.[0];
    return json(res, 200, { imageUrl: image?.url || null, imageBase64: image?.b64_json || null });
  } catch {
    return json(res, 502, { error: '图片网关调用失败，请稍后重试' });
  }
}
