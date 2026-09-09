import { createAssetHttpHandler } from '@openmaic/storage/server';
import { requireUser } from '../serverless/auth.js';
import { createSlideAssetStore } from '../serverless/slide-asset-store.js';

let route;

function assetRoute() {
  if (!route) {
    route = createAssetHttpHandler(createSlideAssetStore(), {
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
  return assetRoute()(req, res);
}
