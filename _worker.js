/**
 * Cloudflare Pages Function (_worker.js)
 *
 * Maps hostnames → club theme keys by appending ?club= to the URL.
 * Update HOSTNAME_MAP with your own domains.
 *
 * /admin.html is protected by HTTP Basic Auth.
 * Set ADMIN_USER and ADMIN_PASSWORD in Cloudflare Pages → Settings →
 * Environment variables (encrypted). If unset, /admin.html returns 401
 * for everyone (fail-closed).
 */

// ── Admin Basic Auth ────────────────────────────────────────────────────────
const ADMIN_PATHS = ['/admin.html', '/admin'];

function requiresAuth(pathname) {
  return ADMIN_PATHS.some(p => pathname === p || pathname.startsWith(p + '?'));
}

function constEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthorized(request, env) {
  const expectedUser = env.ADMIN_USER;
  const expectedPass = env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPass) return false;
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Basic ')) return false;
  try {
    const decoded = atob(auth.slice(6));
    const colon   = decoded.indexOf(':');
    if (colon === -1) return false;
    const user = decoded.slice(0, colon);
    const pass = decoded.slice(colon + 1);
    return constEq(user, expectedUser) && constEq(pass, expectedPass);
  } catch { return false; }
}

function authChallenge() {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Admin Preview", charset="UTF-8"' },
  });
}
// ────────────────────────────────────────────────────────────────────────────

const HOSTNAME_MAP = {
  // 'payouts.yourdomain.com': 'default',
  // 'spt.yourdomain.com':     'spt',
};

const STATIC_EXT = /\.(json|png|svg|jpg|jpeg|gif|webp|css|js|ico|txt|xml|woff|woff2|ttf)$/i;

// Apply cache + security headers to HTML responses. Static assets pass
// through unchanged so they can be cached by CF edge.
function withSecurityHeaders(response, env) {
  const sha = (env.CF_PAGES_COMMIT_SHA || 'dev').slice(0, 7);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-cache');
  headers.set('ETag', `"${sha}"`);
  headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // static.cloudflareinsights.com hosts the optional Web Analytics beacon.
    "script-src 'self' https://static.cloudflareinsights.com",
    "connect-src 'self' https://cloudflareinsights.com",
    // 'self' allows admin.html to iframe index.html for theme preview.
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '));
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=(), ' +
    'payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 0. Guard admin page with Basic Auth
    if (requiresAuth(url.pathname)) {
      if (!isAuthorized(request, env)) return authChallenge();
    }

    // 1. Pass static assets straight through (cached by CF edge)
    if (STATIC_EXT.test(url.pathname)) return env.ASSETS.fetch(request);

    // 2. If ?club= is already present, serve HTML with security headers
    if (url.searchParams.has('club')) {
      return withSecurityHeaders(await env.ASSETS.fetch(request), env);
    }

    // 3. Determine club from hostname
    const hostname = url.hostname;
    let club = HOSTNAME_MAP[hostname] ?? null;

    // Wildcard *.yourdomain.com → subdomain becomes club key
    // Uncomment and update the suffix below:
    // const WILDCARD_SUFFIX = '.pokerpayouts.au';
    // if (!club && hostname.endsWith(WILDCARD_SUFFIX)) {
    //   club = hostname.slice(0, -WILDCARD_SUFFIX.length).split('.').pop() || null;
    // }

    if (club && club !== 'default') {
      const redirectUrl = new URL(url.toString());
      redirectUrl.searchParams.set('club', club);
      return Response.redirect(redirectUrl.toString(), 302);
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request), env);
  },
};
