/**
 * Cloudflare Pages Function (_worker.js)
 *
 * Maps hostnames → club theme keys by appending ?club= to the URL.
 * Update HOSTNAME_MAP with your own domains.
 *
 * /admin.html is protected by HTTP Basic Auth — change these credentials.
 */

// ── Admin Basic Auth ────────────────────────────────────────────────────────
const ADMIN_USER = 'example';
const ADMIN_PASS = 'changeme';
const ADMIN_PATHS = ['/admin.html', '/admin'];

function requiresAuth(pathname) {
  return ADMIN_PATHS.some(p => pathname === p || pathname.startsWith(p + '?'));
}

function isAuthorized(request) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Basic ')) return false;
  try {
    const decoded = atob(auth.slice(6));
    const colon   = decoded.indexOf(':');
    if (colon === -1) return false;
    const user = decoded.slice(0, colon);
    const pass = decoded.slice(colon + 1);
    return user === ADMIN_USER && pass === ADMIN_PASS;
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 0. Guard admin page with Basic Auth
    if (requiresAuth(url.pathname)) {
      if (!isAuthorized(request)) return authChallenge();
    }

    if (STATIC_EXT.test(url.pathname)) return env.ASSETS.fetch(request);
    if (url.searchParams.has('club')) return env.ASSETS.fetch(request);

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

    return env.ASSETS.fetch(request);
  },
};
