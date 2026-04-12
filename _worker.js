/**
 * Cloudflare Pages Function (_worker.js)
 *
 * Maps hostnames → club theme keys by appending ?club= to the URL.
 * Update HOSTNAME_MAP with your own domains.
 */

const HOSTNAME_MAP = {
  // 'payouts.yourdomain.com': 'default',
  // 'spt.yourdomain.com':     'spt',
};

const STATIC_EXT = /\.(json|png|svg|jpg|jpeg|gif|webp|css|js|ico|txt|xml|woff|woff2|ttf)$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
