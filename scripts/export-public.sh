#!/usr/bin/env bash
# scripts/export-public.sh
#
# Copies this private repo to a sanitised public template repo.
# Strips real operator themes/logos; inserts example placeholders.
#
# Usage:
#   ./scripts/export-public.sh <public-repo-url>
#   ./scripts/export-public.sh https://github.com/cutcardgroup/poker-payout-template.git
#
# The public repo must already exist on GitHub (can be empty).

set -euo pipefail

PRIVATE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_REPO="${1:-}"

if [[ -z "$PUBLIC_REPO" ]]; then
  echo "Usage: $0 <public-repo-url>"
  echo "  e.g.: $0 git@github.com:yourname/poker-payout-template.git"
  exit 1
fi

TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_WORK"' EXIT

echo "→ Cloning public repo to temp dir..."
git clone "$PUBLIC_REPO" "$TMPDIR_WORK/public"
PUBLIC_DIR="$TMPDIR_WORK/public"

# ── Static files (safe to copy verbatim) ───────────────────────────────────
echo "→ Copying static files..."
cp "$PRIVATE_DIR/index.html"  "$PUBLIC_DIR/index.html"
cp "$PRIVATE_DIR/admin.html"  "$PUBLIC_DIR/admin.html"
echo "→ Sanitising admin.html (KNOWN_THEMES stripped)..."
# Strip real operator names from admin preview — public repo gets example stubs only
sed -i "s/const KNOWN_THEMES = \[.*\];/const KNOWN_THEMES = ['default', 'example'];/" "$PUBLIC_DIR/admin.html"
cp "$PRIVATE_DIR/package.json" "$PUBLIC_DIR/package.json"
# README is generated below — never copy the private one
cp "$PRIVATE_DIR/.gitignore"  "$PUBLIC_DIR/.gitignore"

# ── Worker: strip real hostname mappings ────────────────────────────────────
echo "→ Generating sanitised _worker.js for public repo..."
cat > "$PUBLIC_DIR/_worker.js" << 'WORKER_EOF'
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
    // const WILDCARD_SUFFIX = '.payouts.yourdomain.com';
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
WORKER_EOF

# ── Public README (no real operator names or domains) ──────────────────────
echo "→ Writing sanitised README..."
cat > "$PUBLIC_DIR/README.md" << 'README_EOF'
# Poker Payout Calculator — Template

Cloudflare Pages deployment of a poker tournament payout calculator with per-operator theming.
Fork this repo, add your own themes, and deploy to Cloudflare Pages.

## Structure

```
poker-payout/
├── index.html                 # Calculator markup — loads scripts/payout-engine.js then scripts/app.js
├── admin.html                 # Admin preview (not linked publicly) — loads scripts/admin.js
├── _worker.js                 # Cloudflare Pages Function — hostname routing + CSP / security headers
├── themes/
│   ├── default.json           # Default green casino theme
│   └── example.json           # Example theme stub — copy and rename
├── logos/                     # Operator logos (PNG preferred; SVG placeholder included)
├── scripts/
│   ├── payout-engine.js       # Pure math engine (UMD) — shared by browser + Node tests
│   ├── app.js                 # Calculator runtime: theme loader, render fns, event handlers
│   ├── admin.js               # Admin preview runtime
│   ├── test-payouts.js        # Payout calculation tests (58 cases)
│   ├── test-bounty.js         # Mystery bounty calculation tests (63 cases)
│   ├── test-browser.js        # JSDOM end-to-end UI smoke (21 assertions)
│   ├── test-random.js         # Random scenario stress test
│   ├── show-payout.js         # CLI tool — display payout table
│   └── export-public.sh
└── package.json
```

## Quick start

```bash
# Install dev dependencies (jsdom + node-fetch for UI smoke; wrangler for deploy)
npm install

# Local dev (themes require an HTTP server)
npm run dev          # serves on http://localhost:3000

# With a theme:  http://localhost:3000?club=example
# Admin preview: http://localhost:3000/admin.html
```

## Adding an operator

1. Copy `themes/example.json` → `themes/yourclub.json` and edit it
2. Drop your logo PNG in `logos/`
3. Add your hostname to `_worker.js` → `HOSTNAME_MAP`
4. Deploy — done

## Theme JSON format — range-based

```json
{
  "name": "My Club",
  "logo": "logos/myclub.png",
  "fbHeader": "🃏 MY CLUB PAYOUT STRUCTURE 🃏",
  "fbFooter": "Good luck! ♠",
  "colors": {
    "green":  "#1a6b3a",
    "green2": "#22883f",
    "green3": "#2daf52",
    "felt":   "#0d4a27",
    "gold":   "#c8a84b",
    "gold2":  "#e8c86a",
    "dark":   "#0a0a0a",
    "card":   "#111a14",
    "card2":  "#0d1810",
    "border": "#2a4030"
  },
  "payoutTable": [
    { "min": 1,  "max": 9,  "rows": [["1st",80,1],["2nd",20,1]] },
    { "min": 10, "max": 30, "rows": [["1st",50,1],["2nd",30,1],["3rd",20,1]] }
  ]
}
```

## Theme JSON format — per-placing

Pay a fixed percentage of entries with an explicit table per placing count. `payoutPct` sets what percentage of entries are paid (e.g. `13` = top 13%).

```json
{
  "name": "My Club",
  "logo": "logos/myclub.png",
  "payoutPct": 13,
  "payoutTable": [
    { "places": 2, "rows": [["1st",80,1],["2nd",20,1]] },
    { "places": 3, "rows": [["1st",50,1],["2nd",30,1],["3rd",20,1]] }
  ]
}
```

`payoutTable` is optional in either format — omit it to use the built-in default table.
Each color key maps to the CSS variable `--<key>` on `:root`.

## Testing

Two suites. Both pull math from `scripts/payout-engine.js` — the single source of truth shared with `index.html`. No copy/paste mirrors.

```bash
npm test          # pure-math suites — run every commit (~1s)
npm run test:ui   # JSDOM end-to-end smoke — run when touching UI plumbing (~10s)
```

`test-payouts.js` — 58 tests: bracket selection, pool conservation, min-cash locking, guaranteed first, float precision, snap gap-inversion, Standard curve structure, max-same-prize stepping, FT 60% floor, min 1st place %, combined-feature scenarios, and theme JSON validation.

`test-bounty.js` — 63 tests: mystery bounty envelope distribution (`buildFlat`, `buildTiered`, `buildCustom`), monotonicity, min-bounty floor, waterfall remainder, and edge cases.

`test-browser.js` — 21 assertions across 9 cases: golden payout cases driven through the real DOM, rounding toggle, in-table prize edit via event delegation, tab switch, MB tiered calc, MB tier add/remove via `data-action`, admin button bindings. Self-spawns a dev server on :3100.

Run `npm run test:ui` when changes touch:
- `index.html` / `admin.html` markup (esp. `data-*` attrs, ids, `<script src>` paths)
- `scripts/app.js` / `scripts/admin.js` (handlers, render fns, `setupEventHandlers`)
- `_worker.js` CSP or static asset routing

Skip `test:ui` for math-only changes (covered by `npm test`).

## Deploy to Cloudflare Pages

1. Connect this repo to a Cloudflare Pages project (no build command needed)
2. `_worker.js` is detected automatically
3. **Set encrypted env vars in Pages → Settings → Environment variables:**
   - `ADMIN_USER` — username for Basic Auth on `/admin.html`
   - `ADMIN_PASSWORD` — password (strong, randomly generated)

   If these aren't set, `/admin.html` returns 401 for everyone (fail-closed).
4. Add your custom domains under **Custom domains** in the Pages dashboard

### Hardening already in place

- HTTP Basic Auth on `/admin.html` (env-var creds, constant-time compare)
- Content-Security-Policy (script-src `'self'` only — no `'unsafe-inline'`)
- HSTS, X-Frame-Options SAMEORIGIN, Permissions-Policy
- `?club=` URL param whitelisted to `[a-z0-9_-]{1,32}` client-side
- Theme `logo` URL restricted to same-origin `logos/`/`themes/` paths

For brute-force protection on `/admin*`, add a Cloudflare WAF rate-limit
rule (~10 req/min/IP). Not required by the code — it's an operational
hardening step.
README_EOF

# ── Themes: copy only default; add example stubs ───────────────────────────
echo "→ Generating example themes..."
rm -rf "$PUBLIC_DIR/themes"
mkdir -p "$PUBLIC_DIR/themes"

# Always copy default theme
cp "$PRIVATE_DIR/themes/default.json" "$PUBLIC_DIR/themes/default.json"

# Write a generic example theme stub
cat > "$PUBLIC_DIR/themes/example.json" << 'THEME_EOF'
{
  "name": "My Poker Club",
  "logo": "logos/example.svg",
  "fbHeader": "🃏 MY CLUB PAYOUT STRUCTURE 🃏",
  "fbFooter": "Good luck! My Poker Club ♠",
  "colors": {
    "green":  "#1a6b3a",
    "green2": "#22883f",
    "green3": "#2daf52",
    "felt":   "#0d4a27",
    "gold":   "#c8a84b",
    "gold2":  "#e8c86a",
    "dark":   "#0a0a0a",
    "card":   "#111a14",
    "card2":  "#0d1810",
    "text":   "#e8ead8",
    "dim":    "#8a9b80",
    "border": "#2a4030"
  },
  "payoutTable": [
    { "min": 1,   "max": 9,    "rows": [["1st",80,1],["2nd",20,1]] },
    { "min": 10,  "max": 30,   "rows": [["1st",50,1],["2nd",30,1],["3rd",20,1]] },
    { "min": 31,  "max": 9999, "rows": [["1st",40,1],["2nd",25,1],["3rd",15,1],["4th-5th",10,2]] }
  ]
}
THEME_EOF

touch "$PUBLIC_DIR/themes/.gitkeep"

# ── Logos: placeholder only ─────────────────────────────────────────────────
echo "→ Generating placeholder logos..."
rm -rf "$PUBLIC_DIR/logos"
mkdir -p "$PUBLIC_DIR/logos"

cat > "$PUBLIC_DIR/logos/example.svg" << 'LOGO_EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="44" viewBox="0 0 180 44">
  <rect width="180" height="44" rx="6" fill="#0d4a27"/>
  <text x="90" y="16" text-anchor="middle" font-family="Georgia,serif" font-size="10" fill="#c8a84b" letter-spacing="2">YOUR LOGO HERE</text>
  <text x="90" y="34" text-anchor="middle" font-family="Georgia,serif" font-size="12" fill="#e8c86a" letter-spacing="2">replace logos/example.svg</text>
</svg>
LOGO_EOF

touch "$PUBLIC_DIR/logos/.gitkeep"

# ── Scripts ─────────────────────────────────────────────────────────────────
mkdir -p "$PUBLIC_DIR/scripts"
cp "$PRIVATE_DIR/scripts/export-public.sh"  "$PUBLIC_DIR/scripts/export-public.sh"
cp "$PRIVATE_DIR/scripts/payout-engine.js"  "$PUBLIC_DIR/scripts/payout-engine.js"
cp "$PRIVATE_DIR/scripts/app.js"            "$PUBLIC_DIR/scripts/app.js"
cp "$PRIVATE_DIR/scripts/admin.js"          "$PUBLIC_DIR/scripts/admin.js"
cp "$PRIVATE_DIR/scripts/test-payouts.js"   "$PUBLIC_DIR/scripts/test-payouts.js"
cp "$PRIVATE_DIR/scripts/test-bounty.js"    "$PUBLIC_DIR/scripts/test-bounty.js"
cp "$PRIVATE_DIR/scripts/test-browser.js"   "$PUBLIC_DIR/scripts/test-browser.js"
cp "$PRIVATE_DIR/scripts/show-payout.js"    "$PUBLIC_DIR/scripts/show-payout.js"
cp "$PRIVATE_DIR/scripts/test-random.js"    "$PUBLIC_DIR/scripts/test-random.js"
chmod +x "$PUBLIC_DIR/scripts/export-public.sh"
# Lock file pins jsdom + node-fetch versions for test:ui
[ -f "$PRIVATE_DIR/package-lock.json" ] && cp "$PRIVATE_DIR/package-lock.json" "$PUBLIC_DIR/package-lock.json"
# Optional: SECURITY.md disclosure policy (if present)
[ -f "$PRIVATE_DIR/SECURITY.md" ] && cp "$PRIVATE_DIR/SECURITY.md" "$PUBLIC_DIR/SECURITY.md"

# ── Commit and push ─────────────────────────────────────────────────────────
echo "→ Committing..."
cd "$PUBLIC_DIR"
git add -A
git commit -m "chore: sync public template from private repo [$(date -u +%Y-%m-%dT%H:%M:%SZ)]"
git push

echo ""
echo "✓ Done! Public template updated at: $PUBLIC_REPO"
echo ""
echo "  Themes included : default, example"
echo "  Real themes     : EXCLUDED"
echo "  Real logos      : EXCLUDED"
echo "  Hostname map    : STRIPPED (see _worker.js)"
