/**
 * “活教参”公网防护入口。
 *
 * 固定代理到 Vercel 生产别名，避免成为开放代理。模型网关、模型名称和密钥
 * 均不在此处配置；它们只能存在于 Vercel 服务端环境变量中。
 */
addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

const ORIGIN = 'https://live-teacher-guide-roy-leos-projects.vercel.app';
const MATERIAL_ORIGIN = 'https://huojiaocan-materials.pages.dev';
const MATERIAL_PATHS = {
  '九年级语文上册-教师用书.pdf': '/九年级语文上册-教师教学用书.pdf',
};
// The curriculum-standard PDF ships with the Vercel application.  The older
// textbook files remain on the dedicated material origin.  Keep this routing
// explicit so the public worker never asks the material origin for a file it
// does not host.
const VERCEL_MATERIALS = new Set(['义务教育语文课程标准2022.pdf']);

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self' https://*.supabase.co",
    'upgrade-insecure-requests',
  ].join('; '),
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

async function handleRequest(request) {
  const incoming = new URL(request.url);
  const isMaterialPdf = incoming.pathname.startsWith('/materials/') && incoming.pathname.toLowerCase().endsWith('.pdf');
  const materialName = isMaterialPdf ? decodeURIComponent(incoming.pathname.replace(/^\/materials\//, '')) : '';
  const materialOnVercel = isMaterialPdf && VERCEL_MATERIALS.has(materialName);
  const targetPath = isMaterialPdf && !materialOnVercel ? (MATERIAL_PATHS[materialName] || `/${materialName}`) : incoming.pathname;
  const target = new URL(`${targetPath}${incoming.search}`, isMaterialPdf && !materialOnVercel ? MATERIAL_ORIGIN : ORIGIN);
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set('Host', target.host);
  requestHeaders.set('X-Forwarded-Host', incoming.host);
  requestHeaders.set('X-Forwarded-Proto', 'https');
  // The Pages static origin serves the full PDF but does not understand the
  // browser's Range header consistently. Fetch once, then slice below so the
  // public same-origin endpoint still behaves like a proper PDF range server.
  if (isMaterialPdf && request.headers.get('Range')) requestHeaders.delete('Range');

  for (const name of ['CF-Connecting-IP', 'CF-IPCountry', 'CF-Ray', 'CF-Visitor']) {
    requestHeaders.delete(name);
  }

  const init = {
    method: request.method,
    headers: requestHeaders,
    redirect: 'manual',
    cf: incoming.pathname.startsWith('/api/')
      ? { cacheEverything: false, cacheTtl: 0 }
      : { cacheEverything: false },
  };

  if (!['GET', 'HEAD'].includes(request.method)) {
    // Buffer JSON bodies before forwarding. Vercel's Node runtime can leave a
    // streamed cross-provider request open when Cloudflare passes the original
    // ReadableStream, which makes /api/ask wait until the edge times out. PDF
    // uploads keep the stream path to avoid an unnecessary Worker memory copy.
    if ((request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      init.body = await request.arrayBuffer();
      requestHeaders.delete('Content-Length');
    } else {
      init.body = request.body;
    }
  }

  let originResponse;
  try {
    originResponse = await fetch(target.toString(), init);
  } catch {
    return createUpstreamErrorResponse();
  }

  const responseHeaders = new Headers(originResponse.headers);
  for (const name of [
    'server',
    'x-vercel-id',
    'x-vercel-cache',
    'x-matched-path',
    'x-powered-by',
    'access-control-allow-origin',
  ]) {
    responseHeaders.delete(name);
  }

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    responseHeaders.set(name, value);
  }

  let responseBody = originResponse.body;
  let responseStatus = originResponse.status;
  if (isMaterialPdf && request.method === 'GET' && request.headers.get('Range') && originResponse.ok && originResponse.status === 200) {
    const bytes = new Uint8Array(await originResponse.arrayBuffer());
    const range = parseRange(request.headers.get('Range'), bytes.byteLength);
    if (range) {
      responseBody = bytes.slice(range.start, range.end + 1);
      responseStatus = 206;
      responseHeaders.set('Content-Length', String(range.end - range.start + 1));
      responseHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
      responseHeaders.set('Accept-Ranges', 'bytes');
    }
  }
  if (isMaterialPdf) {
    // Original PDFs are rendered by the same-origin evidence workbench. Preserve
    // origin status/body (including 206 Range responses) and narrowly relax framing.
    responseHeaders.set('X-Frame-Options', 'SAMEORIGIN');
    responseHeaders.set('Content-Security-Policy', [
      "default-src 'none'",
      "base-uri 'none'",
      "object-src 'self'",
      "frame-ancestors 'self'",
    ].join('; '));
    if (originResponse.status >= 400) {
      responseHeaders.set('Cache-Control', 'no-store, max-age=0');
      responseHeaders.set('CDN-Cache-Control', 'no-store');
      responseHeaders.set('Cloudflare-CDN-Cache-Control', 'no-store');
    }
  }

  if (incoming.pathname.startsWith('/api/')) {
    responseHeaders.set('Cache-Control', 'no-store, max-age=0');
    responseHeaders.set('CDN-Cache-Control', 'no-store');
    responseHeaders.set('Cloudflare-CDN-Cache-Control', 'no-store');
  }

  // HTML is the manifest for hashed Vite assets.  Keeping an old HTML shell
  // at the edge after a deployment makes the fixed public URL load an older
  // JavaScript bundle until a cache-busting query is added manually.  Assets
  // remain cacheable by their content hash; only the HTML shell is uncached.
  const contentType = responseHeaders.get('Content-Type') || '';
  if (contentType.toLowerCase().includes('text/html')) {
    responseHeaders.set('Cache-Control', 'no-store, max-age=0');
    responseHeaders.set('CDN-Cache-Control', 'no-store');
    responseHeaders.set('Cloudflare-CDN-Cache-Control', 'no-store');
  }

  rewriteOriginRedirect(responseHeaders, incoming);

  return new Response(responseBody, {
    status: responseStatus,
    statusText: originResponse.statusText,
    headers: responseHeaders,
  });
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value || '').trim());
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2] || 0));
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function createUpstreamErrorResponse() {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(JSON.stringify({ ok: false, error: 'upstream_unavailable' }), {
    status: 502,
    headers,
  });
}

function rewriteOriginRedirect(headers, incoming) {
  const location = headers.get('Location');
  if (!location) return;

  try {
    const redirectUrl = new URL(location, ORIGIN);
    if (redirectUrl.origin !== ORIGIN) return;

    redirectUrl.protocol = incoming.protocol;
    redirectUrl.host = incoming.host;
    headers.set('Location', redirectUrl.toString());
  } catch {
    // 非法 Location 交由浏览器按原响应处理，不扩大代理范围。
  }
}
