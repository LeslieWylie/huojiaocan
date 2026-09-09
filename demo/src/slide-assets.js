import { HttpAssetStore } from '@openmaic/storage/asset/http';
import { accessToken, ensureSession, getSession, refreshSession, sessionExpired } from './auth.js';

let current = null;

function ownerFetch(owner) {
  return async (input, init = {}) => {
    const assertOwner = () => { if ((getSession()?.user?.id || '') !== owner) throw new Error('auth_owner_changed'); };
    assertOwner();
    if (sessionExpired()) await ensureSession();
    let token = accessToken();
    const send = currentToken => {
      assertOwner();
      const headers = new Headers(init.headers || {});
      if (currentToken) headers.set('Authorization', `Bearer ${currentToken}`);
      return fetch(input, { ...init, headers });
    };
    let response = await send(token);
    if (response.status === 401 && token) {
      const refreshed = await refreshSession(token);
      token = refreshed?.access_token || '';
      if (token) response = await send(token);
    }
    assertOwner();
    return response;
  };
}

function ownerContext() {
  const owner = getSession()?.user?.id || '';
  if (!owner) throw Object.assign(new Error('auth_required'), { code: 'auth_required' });
  return { owner, fetchImpl: ownerFetch(owner) };
}

function ownerAssetStore() {
  const { owner, fetchImpl } = ownerContext();
  if (current?.owner === owner) return current.store;
  if (current) void current.store.close();
  const store = new HttpAssetStore({
    baseUrl: '/api/slide-assets',
    fetch: fetchImpl
  });
  current = { owner, store };
  return store;
}

export async function listSlideAssets() {
  const { fetchImpl } = ownerContext();
  const response = await fetchImpl('/api/slide-assets/library', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || 'slide_asset_list_failed'), { code: payload.error || 'slide_asset_list_failed', status: response.status });
  return Promise.all((payload.assets || []).map(async asset => ({ ...asset, url: await resolveSlideAsset(asset.id) })));
}

export function isSlideAssetRef(value) {
  return /^ast_[0-9a-z]+$/u.test(String(value || ''));
}

export async function uploadSlideAsset(blob, metadata = {}) {
  return ownerAssetStore().put(blob, { ...metadata, contentType: blob.type || metadata.contentType || 'application/octet-stream' });
}

export async function resolveSlideAsset(ref) {
  if (!isSlideAssetRef(ref)) return String(ref || '');
  const url = await ownerAssetStore().resolve(ref);
  if (!url) throw Object.assign(new Error('slide_asset_not_found'), { code: 'slide_asset_not_found' });
  return url;
}

export async function resolveSlideCanvas(canvas = {}) {
  const copy = JSON.parse(JSON.stringify(canvas));
  copy.elements = await Promise.all((copy.elements || []).map(async element => element.type === 'image' && isSlideAssetRef(element.src)
    ? { ...element, src: await resolveSlideAsset(element.src) }
    : element));
  if (copy.background?.type === 'image' && isSlideAssetRef(copy.background.image?.src)) {
    copy.background.image.src = await resolveSlideAsset(copy.background.image.src);
  }
  return copy;
}

export async function resolveTeachingSlide(slide) {
  return { ...slide, content: { ...slide.content, canvas: await resolveSlideCanvas(slide.content.canvas) } };
}

export async function resolveTeachingSlideDeck(deck) {
  return { ...deck, slides: await Promise.all(deck.slides.map(resolveTeachingSlide)) };
}

export async function persistLegacyTeachingSlideAssets(deck, slideIds = []) {
  const copy = JSON.parse(JSON.stringify(deck));
  const selected = new Set(slideIds);
  for (const slide of copy.slides || []) {
    if (selected.size && !selected.has(slide.id)) continue;
    for (const element of slide.content?.canvas?.elements || []) {
      if (element.type !== 'image' || !/^data:image\/(?:png|jpeg|webp);base64,/iu.test(String(element.src || ''))) continue;
      const blob = await fetch(element.src).then(response => response.blob());
      element.src = await uploadSlideAsset(blob, { kind: 'legacy-slide-image', width: element.width, height: element.height });
    }
  }
  return copy;
}

function canvasToBlob(canvas, type = 'image/webp', quality = 0.86) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('image_encode_failed')), type, quality));
}

export async function textbookPageAsset(pageNumber) {
  const page = Number(pageNumber);
  if (!Number.isInteger(page) || page < 1) throw new Error('textbook_page_invalid');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  const loadingTask = pdfjs.getDocument('/materials/%E4%B9%9D%E5%B9%B4%E7%BA%A7%E8%AF%AD%E6%96%87%E4%B8%8A%E5%86%8C-%E5%AD%A6%E7%94%9F%E6%95%99%E6%9D%90.pdf');
  try {
    const pdf = await loadingTask.promise;
    const pdfPage = await pdf.getPage(page);
    const natural = pdfPage.getViewport({ scale: 1 });
    const viewport = pdfPage.getViewport({ scale: Math.min(2.4, 1500 / Math.max(natural.width, natural.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await pdfPage.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
    const blob = await canvasToBlob(canvas);
    const src = await uploadSlideAsset(blob, { kind: 'textbook-page', documentId: 'textbook', pdfPage: page, width: canvas.width, height: canvas.height });
    return { src, ext: 'webp', width: canvas.width, height: canvas.height };
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}
