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
