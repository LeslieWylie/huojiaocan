import { allowMethod, json, safeConfig } from '../serverless/shared.js';
import { authConfigStatus } from '../serverless/auth.js';
export default function handler(req, res) {
  if (!allowMethod(req, res, 'GET')) return;
  return json(res, 200, { ok: true, service: 'live-teacher-guide', ...safeConfig(), ...authConfigStatus() });
}
