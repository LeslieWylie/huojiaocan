import { allowMethod, json, readJson } from '../serverless/shared.js';
import { executeAgentTeaching, requireAgentBackendSecret, saveAgentTeaching } from '../serverless/agent-backend.js';

const publicCodes = new Set([
  'agent_backend_forbidden', 'owner_id_required', 'request_id_required', 'draft_id_required',
  'draft_version_required', 'connection_id_required', 'question_required', 'draft_not_found',
  'edit_conflict', 'agent_result_required', 'key_not_found', 'key_decrypt_failed',
  'deepseek_unauthorized', 'deepseek_forbidden', 'deepseek_rate_limited', 'deepseek_timeout',
  'deepseek_unavailable', 'deepseek_invalid_response', 'deepseek_invalid_request',
  'deepseek_request_failed', 'pageindex_unavailable', 'pageindex_timeout',
  'pageindex_rate_limited', 'pageindex_invalid_response', 'pageindex_request_failed'
]);

export default async function handler(req, res) {
  if (!allowMethod(req, res, 'POST')) return;
  try {
    requireAgentBackendSecret(req);
    const body = await readJson(req);
    if (body.action === 'execute') return json(res, 200, { result: await executeAgentTeaching(body) });
    if (body.action === 'save') return json(res, 200, { result: await saveAgentTeaching(body) });
    return json(res, 404, { ok: false, error: 'route_not_found' });
  } catch (error) {
    const code = String(error?.code || error?.message || 'agent_backend_failed');
    const safe = publicCodes.has(code) ? code : 'agent_backend_failed';
    const status = Number(error?.status) || (safe === 'edit_conflict' ? 409 : safe.includes('required') ? 400 : safe === 'agent_backend_forbidden' ? 403 : safe === 'draft_not_found' ? 404 : 503);
    return json(res, status, { ok: false, error: safe });
  }
}
