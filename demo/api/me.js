import { json } from '../serverless/shared.js';
import { requireUser, safeAuthResponse } from '../serverless/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  try {
    const user = await requireUser(req);
    return json(res, 200, { user: { id: user.id, email: user.email } });
  } catch (error) {
    return safeAuthResponse(res, error);
  }
}
