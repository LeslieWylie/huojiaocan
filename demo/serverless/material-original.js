import { requireUser, supabaseRest, safeAuthResponse } from './auth.js';
import { signOriginalPdf } from './upload-storage.js';

export function createMaterialOriginalHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    try {
      const user = await requireUser(req, { env, fetchImpl });
      const documentId = String(req.query?.documentId || '');
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(documentId)) return res.status(400).json({ error: 'invalid_document_id' });
      const rows = await supabaseRest('document_access', { env, fetchImpl, authToken: user.token, query: {
        select: 'document_id,owner_id,visibility,object_key', document_id: `eq.${documentId}`, owner_id: `eq.${user.id}`, visibility: 'eq.private', limit: '1'
      } });
      const row = Array.isArray(rows) && rows.find(r => r.document_id === documentId && r.owner_id === user.id && r.visibility === 'private');
      if (!row) return res.status(404).json({ error: 'material_not_found' });
      if (!row.object_key) return res.status(404).json({ error: 'original_not_found' });
      const result = await signOriginalPdf({ objectKey: row.object_key, env, fetchImpl });
      return res.status(200).json({ documentId, ...result });
    } catch (error) {
      if (['original_not_found', 'storage_not_configured', 'storage_configuration_incomplete', 'original_unavailable'].includes(error.code)) {
        return res.status(error.status || 503).json({ error: error.code });
      }
      return safeAuthResponse(res, error);
    }
  };
}
export default createMaterialOriginalHandler();
