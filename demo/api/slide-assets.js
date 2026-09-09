import { createAssetHttpHandler } from '@openmaic/storage/server';
import { requireUser, safeAuthResponse } from '../serverless/auth.js';
import { json } from '../serverless/shared.js';
import { createSlideAssetStore } from '../serverless/slide-asset-store.js';

let route;
let store;

function assetStore() {
  if (!store) store = createSlideAssetStore();
  return store;
}

function assetRoute() {
  if (!route) {
    route = createAssetHttpHandler(assetStore(), {
      authenticate: async req => {
        try { return { key: (await requireUser(req)).id }; } catch { return undefined; }
      },
      renderableTypes: ['image/png', 'image/jpeg', 'image/webp'],
      maxRequestBytes: 13 * 1024 * 1024,
      maxAssetBytes: 12 * 1024 * 1024
    });
  }
  return route;
}

export default function handler(req, res) {
  if (req.query?.path !== undefined) req.url = `/${String(req.query.path).replace(/^\/+/, '')}`;
  if (req.url === '/library') {
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method_not_allowed' });
    return requireUser(req).then(user => assetStore().list({ key: user.id }, req.query?.limit)).then(assets => json(res, 200, { assets })).catch(error => safeAuthResponse(res, error));
  }
  return assetRoute()(req, res);
}
