# Security Policy

## Reporting a vulnerability

Email **security@cutcardgroup.au** with:

- A clear description of the issue
- Steps to reproduce (PoC, request/response, screenshots if helpful)
- Affected URL(s) and any account / theme / club context
- Your name and PGP key if you want encrypted replies

We aim to acknowledge within **2 business days** and ship a fix or
mitigation within **14 days** for high-severity issues.

Please do **not** open a public GitHub issue for security reports.

## Scope

In scope:

- `payouts.cutcardgroup.au` and `*.payouts.cutcardgroup.au` (Cloudflare Pages deployment of this repo)
- `_worker.js` Pages Function
- Static assets served from this repo (`index.html`, `admin.html`, theme JSON, logos)

Out of scope:

- Social engineering of staff or operators
- Physical attacks
- Denial of service (volumetric / network-layer)
- Reports against third-party services we link to (Google Fonts, Cloudflare infrastructure itself)
- Findings that require a compromised end-user device or browser

## Safe harbor

Good-faith research that follows this policy will not result in legal
action from Cut Card Group. Don't exfiltrate data, don't pivot, don't
keep access longer than needed to demonstrate the issue.

## Hardening already in place

- HTTP Basic Auth on `/admin.html`
- Content-Security-Policy, X-Frame-Options DENY, HSTS, Permissions-Policy
- `?club=` parameter is whitelisted to `[a-z0-9_-]{1,32}`
- Theme `logo` URL is validated to same-origin `logos/` or `themes/` paths
- Public template export strips real operator data and credentials
