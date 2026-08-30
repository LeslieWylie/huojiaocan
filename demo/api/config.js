import { allowMethod, json, safeConfig } from '../serverless/shared.js';
import { authConfigStatus } from '../serverless/auth.js';
import authProxy from '../serverless/auth-proxy.js';
export default function handler(req, res) {
  if (req.method === 'POST' && String(req.query?.auth || '') === '1') return authProxy(req, res);
  if (!allowMethod(req, res, 'GET')) return;
  return json(res, 200, { ...safeConfig(), ...authConfigStatus() });
}
