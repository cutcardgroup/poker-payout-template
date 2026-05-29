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
│   ├── example.json           # Example theme stub (range-based) — copy and rename
│   └── example-cliff.json     # Example cliff-curve theme (graduated + final-table wall)
├── logos/                     # Operator logos (PNG preferred; SVG placeholder included)
├── scripts/
│   ├── payout-engine.js       # Pure math engine (UMD) — shared by browser + Node tests
│   ├── app.js                 # Calculator runtime: theme loader, render fns, event handlers
│   ├── admin.js               # Admin preview runtime
│   ├── test-payouts.js        # Payout calculation tests (incl. cliff-curve mode)
│   ├── test-bounty.js         # Mystery bounty calculation tests (63 cases)
│   ├── test-browser.js        # JSDOM end-to-end UI smoke (incl. cliff theme)
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

## Theme JSON format — cliff curve (opt-in)

Set `"curve": "cliff"` on a per-placing theme to get a structure that **graduates smoothly all
the way to the min-cash floor** (no flat plateau at the bottom) with a deliberate jump at the
final-table bubble. Good when you want the whole pool distributed across many places while still
rewarding the final table. See `themes/example-cliff.json`.

```json
{
  "name": "My Club",
  "logo": "logos/myclub.png",
  "payoutPct": 12,
  "curve": "cliff",
  "cliff": 1.30,
  "ftDecay": 1.25,
  "cap1": 1.87,
  "cap2": 1.55,
  "maxSame": 10,
  "payoutTable": [
    { "places": 2, "rows": [["1st",60,1],["2nd",40,1]] },
    { "places": 3, "rows": [["1st",50,1],["2nd",30,1],["3rd",20,1]] }
  ]
}
```

| Key | Meaning |
|-----|---------|
| `cliff` | Ratio of the final-table wall — e.g. `1.30` means the last FT place pays 1.30× the next one down. |
| `ftDecay` | Geometric step between final-table places (places 3..ftSize). |
| `cap1` / `cap2` | 1st = 2nd × `cap1`; 2nd = 3rd × `cap2`. |
| `maxSame` | Largest band of equal prizes in the tail. |

Notes:
- **`ftSize` (entered per-event) positions the wall** at `ftSize → ftSize+1`. A 7-handed final
  table puts the jump at 7th→8th. Default 9.
- **Place count** comes from `payoutPct` (`ceil(entries × payoutPct%)`); set the per-event
  *Places* field to pin an exact count.
- `guaranteedFirst` works — it pins 1st in dollars and re-solves the rest, keeping the wall.
- The `payoutTable` percentages are **not** used for the cliff prize curve (the curve is computed
  from the keys above); the table is still required for the place-count brackets / legacy fallback.

## Testing

Two suites. Both pull math from `scripts/payout-engine.js` — the single source of truth shared with `index.html`. No copy/paste mirrors.

```bash
npm test          # pure-math suites — run every commit (~1s)
npm run test:ui   # JSDOM end-to-end smoke — run when touching UI plumbing (~10s)
```

`test-payouts.js` — bracket selection, pool conservation, min-cash locking, guaranteed first, float precision, snap gap-inversion, Standard curve structure, max-same-prize stepping, FT 60% floor, min 1st place %, per-placing (`payoutPct`) themes, **cliff-curve mode** (graduated-to-floor + final-table wall, `guaranteedFirst`, repositionable wall via `ftSize`), combined-feature scenarios, and theme JSON validation.

`test-bounty.js` — 63 tests: mystery bounty envelope distribution (`buildFlat`, `buildTiered`, `buildCustom`), monotonicity, min-bounty floor, waterfall remainder, and edge cases.

`test-browser.js` — golden payout cases driven through the real DOM, rounding toggle, in-table prize edit via event delegation, tab switch, MB tiered calc, MB tier add/remove via `data-action`, admin button bindings, and a cliff-theme end-to-end case (`?club=example-cliff` → full-pool render + final-table wall). Self-spawns a dev server on :3100.

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
