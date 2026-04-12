#!/usr/bin/env bash
# scripts/export-public.sh
#
# Copies this private repo to a sanitised public template repo.
# Strips real operator themes/logos; inserts example placeholders.
#
# Usage:
#   ./scripts/export-public.sh <public-repo-url>
#   ./scripts/export-public.sh git@github.com:yourname/poker-payout-template.git
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
├── index.html          # Calculator — loads theme from ?club= URL param
├── admin.html          # Admin preview (not linked publicly)
├── _worker.js          # Cloudflare Pages Function — maps hostnames → club
├── themes/
│   ├── default.json    # Default green casino theme
│   └── example.json    # Example theme stub — copy and rename
├── logos/              # Operator logos (PNG preferred; SVG placeholder included)
├── scripts/
│   └── export-public.sh
└── package.json
```

## Quick start

```bash
# Local dev (themes require an HTTP server)
npx serve . -p 3000

# With a theme:  http://localhost:3000?club=example
# Admin preview: http://localhost:3000/admin.html
```

## Adding an operator

1. Copy `themes/example.json` → `themes/yourclub.json` and edit it
2. Drop your logo PNG in `logos/`
3. Add your hostname to `_worker.js` → `HOSTNAME_MAP`
4. Deploy — done

## Theme JSON format

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

`payoutTable` is optional — omit it to use the built-in default table.
Each color key maps to the CSS variable `--<key>` on `:root`.

## Deploy to Cloudflare Pages

1. Connect this repo to a Cloudflare Pages project (no build command needed)
2. `_worker.js` is detected automatically
3. Add your custom domains under **Custom domains** in the Pages dashboard
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
    "border": "#2a4030"
  },
  "payoutTable": [
    { "min": 1,  "max": 9,  "rows": [["1st",80,1],["2nd",20,1]] },
    { "min": 10, "max": 30, "rows": [["1st",50,1],["2nd",30,1],["3rd",20,1]] }
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
cp "$PRIVATE_DIR/scripts/export-public.sh" "$PUBLIC_DIR/scripts/export-public.sh"
chmod +x "$PUBLIC_DIR/scripts/export-public.sh"

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
