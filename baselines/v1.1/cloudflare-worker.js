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
    "connect-src 'self'",
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
  const target = new URL(`${incoming.pathname}${incoming.search}`, ORIGIN);
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set('Host', target.host);
  requestHeaders.set('X-Forwarded-Host', incoming.host);
  requestHeaders.set('X-Forwarded-Proto', 'https');

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
    init.body = request.body;
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

  if (incoming.pathname.startsWith('/api/')) {
    responseHeaders.set('Cache-Control', 'no-store, max-age=0');
    responseHeaders.set('CDN-Cache-Control', 'no-store');
    responseHeaders.set('Cloudflare-CDN-Cache-Control', 'no-store');
  }

  rewriteOriginRedirect(responseHeaders, incoming);

  return new Response(originResponse.body, {
    status: originResponse.status,
    statusText: originResponse.statusText,
    headers: responseHeaders,
  });
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
