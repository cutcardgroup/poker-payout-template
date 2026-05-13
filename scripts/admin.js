const KNOWN_THEMES = ['default', 'spt', 'matchroom', 'riverlandpoker', 'stackedpoker'];

// Default payout table — loaded from themes/default.json (single source of truth)
let DEFAULT_PT = null;

function buildChips() {
  ['chips','known-chips'].forEach(id => {
    const container = document.getElementById(id);
    KNOWN_THEMES.forEach(name => {
      const el = document.createElement('button');
      el.className = 'chip';
      el.textContent = name;
      el.onclick = () => selectChip(name);
      container.appendChild(el);
    });
  });
}

function selectChip(name) {
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.textContent === name));
  document.getElementById('club-input').value = name;
  loadPreview();
}

function sanitizeClub(s) {
  return /^[a-z0-9_-]{1,32}$/i.test(s) ? s : null;
}

async function loadPreview() {
  const raw = document.getElementById('club-input').value.trim();
  if (!raw) return;
  const club = sanitizeClub(raw);
  if (!club) {
    document.getElementById('info-status').textContent = '✗ Invalid club name (a–z, 0–9, _-, max 32)';
    return;
  }

  const previewUrl = `index.html?club=${encodeURIComponent(club)}`;
  const themeFile  = `themes/${encodeURIComponent(club)}.json`;

  document.getElementById('info-url').textContent  = previewUrl;
  document.getElementById('info-file').textContent = themeFile;
  document.getElementById('info-status').textContent = 'Loading…';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('preview-frame').src = previewUrl;
  document.getElementById('pt-club').textContent = club;

  try {
    const res = await fetch(themeFile);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const theme = await res.json();
    document.getElementById('info-status').textContent = '✓ Theme found';
    renderPayoutPanel(theme, club);
  } catch(e) {
    document.getElementById('info-status').textContent =
      e.message.startsWith('HTTP') ? `⚠ ${e.message} — falling back to default` : '✗ Fetch failed — need a local server (npx serve .)';
    renderPayoutPanel(null, club);
  }
}

function isSafeLogoUrl(u) {
  if (typeof u !== 'string' || u.length > 512) return false;
  // Only same-origin relative paths under logos/ or themes/. Reject schemes,
  // protocol-relative, and path traversal.
  if (/^[a-z]+:/i.test(u)) return false;
  if (u.startsWith('//') || u.startsWith('/')) return false;
  if (u.includes('..')) return false;
  return /^(logos|themes)\//.test(u);
}

function isSafeColor(v) {
  // Hex, rgb()/rgba(), hsl()/hsla(), or a small set of CSS named colors.
  if (typeof v !== 'string' || v.length > 64) return false;
  return /^#[0-9a-f]{3,8}$/i.test(v)
      || /^rgba?\([\d\s.,%/-]+\)$/i.test(v)
      || /^hsla?\([\d\s.,%/-]+\)$/i.test(v)
      || /^[a-z]{3,20}$/i.test(v);
}

function renderPayoutPanel(theme, club) {
  const body     = document.getElementById('pt-body');
  const swatches = document.getElementById('pt-swatches');
  swatches.replaceChildren();

  // ── Logo ─────────────────────────────────────────────────
  if (theme && theme.logo && isSafeLogoUrl(theme.logo)) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:8px 14px;border-bottom:1px solid #1a2e22;background:#111a14;';
    const img = document.createElement('img');
    img.src = theme.logo;
    img.alt = (theme.name || club) + '';
    img.style.cssText = 'max-height:44px;max-width:220px;object-fit:contain;display:block;';
    wrap.appendChild(img);
    swatches.appendChild(wrap);
  }

  // ── Colour swatches ──────────────────────────────────────
  if (theme && theme.colors && Object.keys(theme.colors).length) {
    const row = document.createElement('div');
    row.className = 'swatches';
    Object.entries(theme.colors).forEach(([k,v]) => {
      const wrap = document.createElement('div');
      wrap.className = 'swatch-wrap';
      wrap.title = k + ': ' + v;
      const sw = document.createElement('div');
      sw.className = 'swatch';
      if (isSafeColor(v)) sw.style.background = v;
      const lbl = document.createElement('div');
      lbl.className = 'swatch-lbl';
      lbl.textContent = k;
      wrap.append(sw, lbl);
      row.appendChild(wrap);
    });
    swatches.appendChild(row);
  }

  // ── Payout table ─────────────────────────────────────────
  let brackets;
  let usingDefault = false;

  if (!theme) {
    brackets = DEFAULT_PT;
    usingDefault = true;
  } else if (!theme.payoutTable) {
    brackets = DEFAULT_PT;
    usingDefault = true;
  } else {
    brackets = theme.payoutTable;
  }
  body.replaceChildren();

  if (usingDefault) {
    const notice = document.createElement('div');
    notice.className = 'default-notice';
    notice.style.cssText = 'padding:8px 12px;margin-bottom:8px;border-radius:5px;border:1px solid #1a2e22;text-align:left;font-size:.7rem;color:#4a6050;';
    notice.append('♠ Showing built-in default table');
    if (theme) {
      notice.append(' — ');
      const em = document.createElement('em');
      em.textContent = theme.name || club;
      notice.appendChild(em);
      notice.append(' has no custom payoutTable');
    }
    body.appendChild(notice);
  }

  brackets.forEach((b, bi) => {
    const places = b.rows.reduce((s, r) => s + r[2], 0);
    const totalPct = b.rows.reduce((s, r) => s + r[1] * r[2], 0);
    const pctOk = Math.abs(totalPct - 100) < 0.1;

    const rangeLabel = b.places !== undefined
      ? `${b.places} place${b.places !== 1 ? 's' : ''}`
      : b.max >= 9999
        ? `${b.min}+ players`
        : `${b.min}–${b.max} players`;

    const bracket = document.createElement('div');
    bracket.className = 'bracket open';

    const hdr = document.createElement('div');
    hdr.className = 'bracket-hdr';
    hdr.addEventListener('click', () => bracket.classList.toggle('open'));

    const hdrLeft = document.createElement('div');
    const range = document.createElement('span');
    range.className = 'bracket-range';
    range.textContent = rangeLabel;
    const chip = document.createElement('span');
    chip.className = 'pct-chip' + (pctOk ? '' : ' bad');
    chip.textContent = totalPct.toFixed(2) + '%';
    hdrLeft.append(range, ' ', chip);

    const hdrRight = document.createElement('div');
    hdrRight.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const placesEl = document.createElement('span');
    placesEl.className = 'bracket-places';
    placesEl.textContent = places + ' place' + (places !== 1 ? 's' : '');
    const chevron = document.createElement('span');
    chevron.className = 'bracket-chevron';
    chevron.textContent = '▲';
    hdrRight.append(placesEl, chevron);

    hdr.append(hdrLeft, hdrRight);

    const rows = document.createElement('div');
    rows.className = 'bracket-rows';
    const tbl = document.createElement('table');
    tbl.className = 'pt-tbl';
    const tbody = document.createElement('tbody');
    b.rows.forEach(r => {
      const [label, pct, count] = r;
      const tr = document.createElement('tr');
      const tdPlace = document.createElement('td');
      tdPlace.className = 'place';
      tdPlace.textContent = label + '';
      const tdPct = document.createElement('td');
      tdPct.className = 'pct';
      tdPct.textContent = (count === 1) ? (pct + '%') : (pct + '% each');
      const tdCount = document.createElement('td');
      tdCount.className = 'count';
      tdCount.textContent = (count === 1) ? '' : ('×' + count);
      tr.append(tdPlace, tdPct, tdCount);
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    rows.appendChild(tbl);

    bracket.append(hdr, rows);
    body.appendChild(bracket);
  });
}

function openNew() {
  const raw = document.getElementById('club-input').value.trim() || 'default';
  const club = sanitizeClub(raw) || 'default';
  window.open(`index.html?club=${encodeURIComponent(club)}`, '_blank');
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load default PT from single source of truth before building UI
  try {
    const r = await fetch('themes/default.json');
    if (r.ok) DEFAULT_PT = (await r.json()).payoutTable || null;
  } catch(_) {}

  buildChips();
  document.getElementById('club-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadPreview();
  });
  document.getElementById('btn-preview').addEventListener('click', loadPreview);
  document.getElementById('btn-open-new').addEventListener('click', openNew);
});
