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
│   ├── export-public.sh
│   ├── test-payouts.js     # Payout calculation tests
│   ├── test-random.js      # Random scenario stress test
│   └── show-payout.js      # CLI tool — display payout table
└── package.json
```

## Quick start

```bash
# Local dev (themes require an HTTP server)
npx serve . -p 3000

# With a theme:  http://localhost:3000?club=example
# Admin preview: http://localhost:3000/admin.html
```

## Payout modes

The calculator offers three payout structure modes, selectable via the button strip in the UI:

| Mode | Description |
|------|-------------|
| **Standard** | Geometric decay from 3rd place down (rate 0.82). 1st/2nd and 2nd/3rd ratios are fixed at the top (default 1.45× and 1.30×). Ratios are adjustable via the expand toggle. |
| **Standard (old)** | Classic bracket table lookup — uses the `payoutTable` percentages directly from the theme JSON (or built-in default). |
| **Curve** | Exponential curve with three presets: Gentle, Medium, Steep. |

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

The test script mirrors the calculation logic from `index.html` and must pass before every commit:

```bash
node scripts/test-payouts.js
```

Covers: bracket selection, pool conservation, min-cash locking, guaranteed first, float precision, snap gap-inversion correction, Standard curve structure (ratio caps, monotone decay, grouped brackets), and theme JSON validation. Run it any time you edit payout logic or theme files.

## Deploy to Cloudflare Pages

1. Connect this repo to a Cloudflare Pages project (no build command needed)
2. `_worker.js` is detected automatically
3. Add your custom domains under **Custom domains** in the Pages dashboard
