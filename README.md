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
