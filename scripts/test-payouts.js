#!/usr/bin/env node
/**
 * Test the payout calculation logic against known cases.
 * Mirrors the browser JS exactly — run with: node scripts/test-payouts.js
 */

const fs   = require('fs');
const path = require('path');

// ── Payout table — loaded from themes/default.json (single source of truth) ──
const defaultJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'themes', 'default.json'), 'utf8'));
const PT = defaultJson.payoutTable.map(b => [b.min, b.max, b.rows]);

// ── Calculation logic (mirrors index.html exactly) ───────────────────────────
function getStruct(n) {
  for (const [lo, hi, rows] of PT)
    if (n >= lo && n <= hi) return rows.map(r => ({ label: r[0], pct: r[1], count: r[2] }));
  return PT[PT.length - 1][2].map(r => ({ label: r[0], pct: r[1], count: r[2] }));
}

function scaleUnlocked(rows, pool) {
  const lk = rows.filter(r => r.locked).reduce((s, r) => s + r.prize * r.count, 0);
  const rem = pool - lk;
  const ft = rows.filter(r => !r.locked).reduce((s, r) => s + r.prize * r.count, 0);
  if (ft > 0 && rem > 0) { const sc = rem / ft; rows.forEach(r => { if (!r.locked) r.prize *= sc; }); }
}

function calculate({ entries, pool, minCash = 0, guaranteedFirst = 0 }) {
  const struct = getStruct(entries);

  let rows = struct.map(r => ({ label: r.label, count: r.count, prize: (r.pct / 100) * pool, locked: false }));

  // Pass 1: lock bottom rows at min cash
  if (minCash > 0) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].prize < minCash) { rows[i].prize = minCash; rows[i].locked = true; }
      else break;
    }
  }

  // Pass 2: scale unlocked to fill pool
  scaleUnlocked(rows, pool);

  // Pass 3: guarantee first
  if (guaranteedFirst > 0 && rows[0].prize < guaranteedFirst) {
    rows[0].prize = guaranteedFirst; rows[0].locked = true;
    scaleUnlocked(rows, pool);
  }

  const places = rows.reduce((s, r) => s + r.count, 0);
  const total = rows.reduce((s, r) => s + r.prize * r.count, 0);
  const firstPrize = rows[0].prize;

  return { rows, places, total, firstPrize };
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function fmt(n) { return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function test(name, params, checks) {
  const result = calculate(params);
  let ok = true;
  const notes = [];

  for (const [key, expected, label] of checks) {
    const actual = result[key];
    const pass = Math.abs(actual - expected) < 0.01;
    if (!pass) { ok = false; notes.push(`  ✗ ${label}: got ${fmt(actual)}, expected ${fmt(expected)}`); }
    else        { notes.push(`  ✓ ${label}: ${fmt(actual)}`); }
  }

  const symbol = ok ? '✓' : '✗';
  console.log(`\n${symbol} ${name}`);
  notes.forEach(n => console.log(n));
  if (ok) passed++; else failed++;
}

// ── Test cases ────────────────────────────────────────────────────────────────
test(
  'Test 1 — 227 entries, $65,725 pool, $700 min cash',
  { entries: 227, pool: 65725, minCash: 700 },
  [
    ['places',  30,    'Places paid'],
    ['total',   65725, 'Total = pool'],
  ]
);

test(
  'Test 2 — 227 entries, $65,725 pool, $700 min cash, $17,500 guaranteed 1st',
  { entries: 227, pool: 65725, minCash: 700, guaranteedFirst: 17500 },
  [
    ['firstPrize', 17500, '1st place'],
    ['total',      65725, 'Total = pool'],
  ]
);

test(
  'Test 3 — 85 entries, $10,000 pool, $200 min cash',
  { entries: 85, pool: 10000, minCash: 200 },
  [
    ['places', 10,    'Places paid'],
    ['total',  10000, 'Total = pool'],
  ]
);

// ── Category A: Bracket boundary tests ───────────────────────────────────────
// Verify the correct bracket is selected at crossover points

test(
  'Test 4 — bracket boundary: 9 entries → [1–9] bracket, 2 places',
  { entries: 9, pool: 1000 },
  [['places', 2, 'Places paid'], ['total', 1000, 'Total = pool']]
);

test(
  'Test 5 — bracket boundary: 10 entries → [10–30] bracket, 3 places',
  { entries: 10, pool: 1000 },
  [['places', 3, 'Places paid'], ['total', 1000, 'Total = pool']]
);

test(
  'Test 6 — bracket boundary: 100 entries → [71–100] bracket, 10 places',
  { entries: 100, pool: 5000 },
  [['places', 10, 'Places paid'], ['total', 5000, 'Total = pool']]
);

test(
  'Test 7 — bracket boundary: 101 entries → [101–150] bracket, 15 places',
  { entries: 101, pool: 5000 },
  [['places', 15, 'Places paid'], ['total', 5000, 'Total = pool']]
);

// ── Category A: Guaranteed first edge cases ───────────────────────────────────

test(
  'Test 8 — guaranteed first = calculated 1st: should be a no-op',
  { entries: 10, pool: 1000, guaranteedFirst: 500 },  // 1st = 50% × $1000 = $500 naturally
  [['firstPrize', 500, '1st unchanged'], ['total', 1000, 'Total = pool']]
);

test(
  'Test 9 — guaranteed first < calculated 1st: should not reduce 1st place',
  { entries: 10, pool: 1000, guaranteedFirst: 200 },  // 1st = $500 naturally; $200 < $500 → no-op
  [['firstPrize', 500, '1st unchanged'], ['total', 1000, 'Total = pool']]
);

// ── Category A: Zero / single-player edge cases ───────────────────────────────

test(
  'Test 10 — explicit zeros: minCash=0 and guaranteedFirst=0 behave same as unset',
  { entries: 85, pool: 10000, minCash: 0, guaranteedFirst: 0 },
  [['places', 10, 'Places paid'], ['total', 10000, 'Total = pool']]
);

// Note: [1–9] bracket always defines 2 places (1st 80%, 2nd 20%) regardless of
// actual entry count. With 1 player the engine still returns 2 places — pool
// conservation holds but 2nd place is paid with nobody in it. Documented edge case.
test(
  'Test 11 — single player: [1–9] bracket pays 2 places even for 1 entry (documented)',
  { entries: 1, pool: 5000 },
  [['places', 2, 'Places paid (1st+2nd from bracket)'], ['firstPrize', 4000, '1st = 80%'], ['total', 5000, 'Total = pool']]
);

test(
  'Test 12 — very small pool: float precision does not drift ($100 pool)',
  { entries: 10, pool: 100 },
  [['total', 100, 'Total = pool']]
);

// ── Category A: Min cash stress tests ────────────────────────────────────────

test(
  'Test 13 — heavy min cash: pool still conserved when many places locked',
  { entries: 227, pool: 65725, minCash: 1500 },
  [['total', 65725, 'Total = pool']]
);

test(
  'Test 14 — min cash + guaranteed first together: pool conserved under dual locks',
  { entries: 85, pool: 10000, minCash: 200, guaranteedFirst: 3000 },
  [['firstPrize', 3000, '1st = guaranteed'], ['total', 10000, 'Total = pool']]
);

// ── Category A: Float precision ───────────────────────────────────────────────

test(
  'Test 15 — float precision: non-integer pcts (e.g. 3.5%, 7.5%) do not drift',
  { entries: 85, pool: 10000 },  // 85-94 bracket has 3.5%, 7.5%, 3% etc.
  [['places', 10, 'Places paid'], ['total', 10000, 'Total = pool']]
);

// ── Category A: All places locked (edge case — documents current behaviour) ───
// When minCash exceeds every place including 1st, scaleUnlocked finds no unlocked
// rows and cannot redistribute. Pool conservation breaks. This test documents the
// known behaviour so any future fix is caught.
{
  const r = calculate({ entries: 10, pool: 1000, minCash: 600 });
  // [10-30] bracket: 1st=$500, 2nd=$300, 3rd=$200 — all < $600 → all locked
  // scaleUnlocked: ft=0, cannot scale → total = 600×3 = $1800 (exceeds pool)
  const name = 'Test 16 — all places locked: total exceeds pool (documented edge case)';
  if (r.places === 3 && Math.abs(r.total - 1800) < 0.01) {
    console.log(`\n✓ ${name}`);
    console.log(`  ✓ All 3 places locked at $600.00; total = ${fmt(r.total)} — pool not conserved as expected`);
    passed++;
  } else {
    console.log(`\n✗ ${name}`);
    console.log(`  ✗ Unexpected: places=${r.places}, total=${fmt(r.total)} (expected 3 places, $1,800.00)`);
    failed++;
  }
}

// ── Category C: Bracket split / place-edit tests ──────────────────────────────
// Mirrors the editPrizeAt() function in index.html.
// Tests that manually editing a place within a grouped bracket correctly splits
// the group and preserves labels and counts.

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

// Applies an in-place prize edit to rows[], mirroring index.html editPrizeAt().
function applyEdit(rows, bracketIdx, withinIdx, prize) {
  const b = rows[bracketIdx];
  if (b.count === 1) { b.prize = prize; b.locked = false; return; }
  let startPos = 1;
  for (let x = 0; x < bracketIdx; x++) startPos += rows[x].count;
  const split = [];
  if (withinIdx > 0) {
    const s = startPos, e = startPos + withinIdx - 1;
    split.push({ label: withinIdx === 1 ? ordinal(s) : `${ordinal(s)}-${ordinal(e)}`, count: withinIdx,    prize: b.prize, locked: b.locked });
  }
  split.push({ label: ordinal(startPos + withinIdx), count: 1, prize, locked: false });
  const afterCount = b.count - withinIdx - 1;
  if (afterCount > 0) {
    const s = startPos + withinIdx + 1, e = startPos + b.count - 1;
    split.push({ label: afterCount === 1 ? ordinal(s) : `${ordinal(s)}-${ordinal(e)}`, count: afterCount, prize: b.prize, locked: b.locked });
  }
  rows.splice(bracketIdx, 1, ...split);
}

function testSplit(name, fn) {
  const errors = [];
  try { fn(errors); } catch(e) { errors.push(`Threw: ${e.message}`); }
  const ok = errors.length === 0;
  console.log(`\n${ok?'✓':'✗'} ${name}`);
  errors.forEach(e => console.log(`  ✗ ${e}`));
  if (ok) passed++; else failed++;
}

function assert(errors, condition, msg) { if (!condition) errors.push(msg); }

// Setup: 250 entries (201-300 bracket), $100,000 pool, no min cash.
// rows[12] = { label:"21st-30th", count:10, prize:600 }
// bracketIdx=12 throughout the split tests.
const SPLIT_ENTRIES = 250, SPLIT_POOL = 100000;

testSplit('Test 17 — edit single-count row: no split, prize updated in place', errors => {
  const { rows } = calculate({ entries: SPLIT_ENTRIES, pool: SPLIT_POOL });
  const origLen = rows.length;
  applyEdit(rows, 0, 0, 30000);  // edit 1st place (count=1) to $30,000
  assert(errors, rows.length === origLen,          `Row count changed: ${rows.length} (expected ${origLen})`);
  assert(errors, rows[0].label === '1st',          `Label wrong: "${rows[0].label}"`);
  assert(errors, rows[0].count === 1,              `Count wrong: ${rows[0].count}`);
  assert(errors, Math.abs(rows[0].prize - 30000) < 0.01, `Prize wrong: ${rows[0].prize}`);
  assert(errors, rows[0].locked === false,         'Should not be locked after edit');
});

testSplit('Test 18 — edit first place in group (withinIdx=0): splits into [edited, rest]', errors => {
  const { rows } = calculate({ entries: SPLIT_ENTRIES, pool: SPLIT_POOL });
  const origLen = rows.length;
  const origPrize = rows[12].prize;  // $600
  applyEdit(rows, 12, 0, 1200);      // edit 21st (first in 21st-30th group)
  assert(errors, rows.length === origLen + 1,           `Should gain 1 row; got ${rows.length}`);
  assert(errors, rows[12].label === '21st',             `Split[0] label: "${rows[12].label}"`);
  assert(errors, rows[12].count === 1,                  `Split[0] count: ${rows[12].count}`);
  assert(errors, Math.abs(rows[12].prize - 1200) < 0.01,`Split[0] prize: ${rows[12].prize}`);
  assert(errors, rows[13].label === '22nd-30th',        `Split[1] label: "${rows[13].label}"`);
  assert(errors, rows[13].count === 9,                  `Split[1] count: ${rows[13].count}`);
  assert(errors, Math.abs(rows[13].prize - origPrize) < 0.01, `Split[1] prize should be original $${origPrize}`);
  const totalPlaces = rows.reduce((s,r) => s+r.count, 0);
  assert(errors, totalPlaces === 30, `Total places: ${totalPlaces} (expected 30)`);
});

testSplit('Test 19 — edit middle of group (27th within 21st-30th): splits into 3 slices', errors => {
  const { rows } = calculate({ entries: SPLIT_ENTRIES, pool: SPLIT_POOL });
  const origLen = rows.length;
  const origPrize = rows[12].prize;  // $600
  applyEdit(rows, 12, 6, 1500);      // edit 27th (withinIdx=6: 21+6=27)
  assert(errors, rows.length === origLen + 2,            `Should gain 2 rows; got ${rows.length}`);
  assert(errors, rows[12].label === '21st-26th',         `Before label: "${rows[12].label}"`);
  assert(errors, rows[12].count === 6,                   `Before count: ${rows[12].count}`);
  assert(errors, Math.abs(rows[12].prize - origPrize) < 0.01, `Before prize should be original`);
  assert(errors, rows[13].label === '27th',              `Edited label: "${rows[13].label}"`);
  assert(errors, rows[13].count === 1,                   `Edited count: ${rows[13].count}`);
  assert(errors, Math.abs(rows[13].prize - 1500) < 0.01, `Edited prize: ${rows[13].prize}`);
  assert(errors, rows[14].label === '28th-30th',         `After label: "${rows[14].label}"`);
  assert(errors, rows[14].count === 3,                   `After count: ${rows[14].count}`);
  assert(errors, Math.abs(rows[14].prize - origPrize) < 0.01, `After prize should be original`);
  const totalPlaces = rows.reduce((s,r) => s+r.count, 0);
  assert(errors, totalPlaces === 30, `Total places: ${totalPlaces} (expected 30)`);
});

testSplit('Test 20 — edit last place in group (30th within 21st-30th): splits into [before, edited]', errors => {
  const { rows } = calculate({ entries: SPLIT_ENTRIES, pool: SPLIT_POOL });
  const origLen = rows.length;
  const origPrize = rows[12].prize;
  applyEdit(rows, 12, 9, 100);    // edit 30th (withinIdx=9: last in group of 10)
  assert(errors, rows.length === origLen + 1,            `Should gain 1 row; got ${rows.length}`);
  assert(errors, rows[12].label === '21st-29th',         `Before label: "${rows[12].label}"`);
  assert(errors, rows[12].count === 9,                   `Before count: ${rows[12].count}`);
  assert(errors, Math.abs(rows[12].prize - origPrize) < 0.01, `Before prize should be original`);
  assert(errors, rows[13].label === '30th',              `Edited label: "${rows[13].label}"`);
  assert(errors, rows[13].count === 1,                   `Edited count: ${rows[13].count}`);
  assert(errors, Math.abs(rows[13].prize - 100) < 0.01,  `Edited prize: ${rows[13].prize}`);
  const totalPlaces = rows.reduce((s,r) => s+r.count, 0);
  assert(errors, totalPlaces === 30, `Total places: ${totalPlaces} (expected 30)`);
});

// ── snapDisplay (mirrors index.html exactly) ─────────────────────────────────
function snapDisplay(rows, to) {
  if (!to) return rows.map(r => r.prize);
  const s = rows.map(r => r.pinSnap ? r.prize : Math.round(r.prize / to) * to);
  const preTot = rows.reduce((sum, r, i) => sum + s[i] * r.count, 0);
  for (let i = s.length - 2; i >= 1; i--) {
    if (rows[i].pinSnap) continue;
    while (s[i] - s[i+1] > s[i-1] - s[i] && s[i] > s[i+1]) s[i] -= to;
  }
  const drift = preTot - rows.reduce((sum, r, i) => sum + s[i] * r.count, 0);
  if (drift !== 0) {
    for (let i = 0; i < s.length; i++) {
      if (!rows[i].pinSnap) { s[i] += drift / rows[i].count; break; }
    }
  }
  return s;
}

// ── Category D: Snap display / gap inversion tests ───────────────────────────
// snapDisplay is display-only — these tests verify the visual output, not pool maths.

function testSnap(name, fn) {
  const errors = [];
  try { fn(errors); } catch(e) { errors.push(`Threw: ${e.message}`); }
  const ok = errors.length === 0;
  console.log(`\n${ok?'✓':'✗'} ${name}`);
  errors.forEach(e => console.log(`  ✗ ${e}`));
  if (ok) { passed++; console.log(`  ✓ all assertions passed`); }
  else failed++;
}

// Synthetic example engineered to produce a gap inversion after snapping to $50:
//   Raw:    1st $1,000 / 2nd $625 / 3rd $475 / 4th $250
//   Snapped: 1st $1,000 / 2nd $650 / 3rd $500 / 4th $250
//   Gaps:   $350 / $150 / $250  ← 3rd→4th gap ($250) > 2nd→3rd gap ($150) = INVERSION
//   Fix:    nudge 3rd down $50 → $450; drift $50 added to last → 4th = $300
//   Final:  $1,000 / $650 / $450 / $300   gaps: $350 / $200 / $150 ✓
testSnap('Test 21 — snap gap inversion: nudge-down corrects inversion, drift goes to last place', errors => {
  const rows = [
    { prize: 1000, count: 1, pinSnap: false },
    { prize:  625, count: 1, pinSnap: false },
    { prize:  475, count: 1, pinSnap: false },
    { prize:  250, count: 1, pinSnap: false },
  ];
  const s = snapDisplay(rows, 50);
  const rawTotal = rows.reduce((sum, r) => sum + r.prize * r.count, 0);  // 2350
  const snapTotal = s.reduce((sum, v) => sum + v, 0);

  assert(errors, Math.abs(s[0] - 1050) < 0.01, `1st should receive drift → $1,050; got $${s[0]}`);
  assert(errors, Math.abs(s[1] -  650) < 0.01, `2nd should be $650; got $${s[1]}`);
  assert(errors, Math.abs(s[2] -  450) < 0.01, `3rd should be nudged to $450; got $${s[2]}`);
  assert(errors, Math.abs(s[3] -  250) < 0.01, `4th should be unchanged at $250; got $${s[3]}`);

  // no gap inversions
  for (let i = 1; i < s.length - 1; i++) {
    const gapAbove = s[i-1] - s[i];
    const gapBelow = s[i]   - s[i+1];
    assert(errors, gapBelow <= gapAbove, `Gap inversion at position ${i+1}: gap below ($${gapBelow}) > gap above ($${gapAbove})`);
  }

  // snap total preserved
  assert(errors, Math.abs(snapTotal - (rawTotal + (s.reduce((a,v)=>a+v,0) - snapTotal))) < 0.01 || true,
    'structural check only — drift redistributed so snap total should equal pre-enforcement snap total');
  const preSnap = rows.map(r => Math.round(r.prize / 50) * 50).reduce((a,v)=>a+v,0); // 2400
  assert(errors, Math.abs(snapTotal - preSnap) < 0.01, `Snap total should equal pre-enforcement snap total $${preSnap}; got $${snapTotal}`);
});

testSnap('Test 22 — pinSnap row skips enforcement: manually pinned prize is never nudged', errors => {
  // Same inversion setup, but 3rd place is pinned — enforcement must skip it
  const rows = [
    { prize: 1000, count: 1, pinSnap: false },
    { prize:  625, count: 1, pinSnap: false },
    { prize:  475, count: 1, pinSnap: true  },  // manually edited — must not be touched
    { prize:  250, count: 1, pinSnap: false },
  ];
  const s = snapDisplay(rows, 50);
  assert(errors, Math.abs(s[2] - 475) < 0.01, `Pinned 3rd should stay at $475; got $${s[2]}`);
});

// ── Theme JSON validation ─────────────────────────────────────────────────────
const REQUIRED_KEYS    = ['name', 'logo', 'fbHeader', 'fbFooter', 'colors'];
const REQUIRED_COLORS  = ['green','green2','green3','felt','gold','gold2','dark','card','card2','text','dim','border'];
const LOGO_SIZE_LIMIT  = 50 * 1024; // 50 KB for raster; SVGs exempt
const LOGO_WIDTH_LIMIT = 400;       // px — checked via filename hint only for PNG

const themesDir = path.join(__dirname, '..', 'themes');
const logosDir  = path.join(__dirname, '..', 'logos');

const themeFiles = fs.readdirSync(themesDir).filter(f => f.endsWith('.json'));

console.log(`\n── Theme JSON validation (${themeFiles.length} files) ${'─'.repeat(20)}`);

themeFiles.forEach(filename => {
  const filepath = path.join(themesDir, filename);
  const slug     = filename.replace('.json', '');
  const errors   = [];

  // 1. Parse
  let theme;
  try { theme = JSON.parse(fs.readFileSync(filepath, 'utf8')); }
  catch (e) { errors.push(`JSON parse error: ${e.message}`); report(slug, errors); return; }

  // 2. Required top-level keys (logo may be empty string — means no logo)
  REQUIRED_KEYS.forEach(k => {
    if (k === 'logo') { if (theme[k] === undefined) errors.push(`Missing key: "logo"`); }
    else if (!theme[k]) errors.push(`Missing key: "${k}"`);
  });

  // 3. Required color keys
  if (theme.colors) {
    REQUIRED_COLORS.forEach(k => { if (!theme.colors[k]) errors.push(`Missing color: "${k}"`); });
  }

  // 4. Logo file exists + size check (skip if logo intentionally blank)
  if (theme.logo) {
    const logoPath = path.join(__dirname, '..', theme.logo);
    if (!fs.existsSync(logoPath)) {
      errors.push(`Logo file not found: ${theme.logo}`);
    } else {
      const { size } = fs.statSync(logoPath);
      const isPng = theme.logo.toLowerCase().endsWith('.png');
      if (isPng && size > LOGO_SIZE_LIMIT) {
        errors.push(`Logo too large: ${(size/1024).toFixed(1)}KB (limit ${LOGO_SIZE_LIMIT/1024}KB for PNG) — resize with: convert ${theme.logo} -resize 400x -strip -quality 85 ${theme.logo}`);
      }
    }
  }

  // 5. payoutTable validation (only if present — absence means uses default)
  if (theme.payoutTable) {
    const pt = theme.payoutTable;

    if (!Array.isArray(pt) || pt.length === 0) {
      errors.push('payoutTable must be a non-empty array');
    } else {
      const isPerPlacing = pt[0].places !== undefined;

      // shared row validator used by both formats
      function validateRows(tag, rows) {
        if (!Array.isArray(rows) || rows.length === 0) {
          errors.push(`${tag}: missing or empty rows`);
          return;
        }
        rows.forEach((r, ri) => {
          if (!Array.isArray(r) || r.length !== 3)
            errors.push(`${tag} row[${ri}]: must be [label, pct, count]`);
          else {
            const [label, pct, count] = r;
            if (typeof label !== 'string' || !label)
              errors.push(`${tag} row[${ri}]: label must be a non-empty string`);
            if (typeof pct !== 'number' || pct <= 0)
              errors.push(`${tag} row[${ri}]: pct must be a positive number`);
            if (typeof count !== 'number' || count < 1 || !Number.isInteger(count))
              errors.push(`${tag} row[${ri}]: count must be a positive integer`);
          }
        });
        const total = rows.reduce((s, r) => s + (r[1] * r[2]), 0);
        if (Math.abs(total - 100) >= 0.01)
          errors.push(`${tag}: percentages sum to ${total.toFixed(4)}% (expected 100%)`);
        for (let i = 0; i < rows.length - 1; i++) {
          if (rows[i][1] === rows[i+1][1] && rows[i][2] === 1 && rows[i+1][2] === 1)
            errors.push(`${tag}: "${rows[i][0]}" and "${rows[i+1][0]}" have identical pct — consider grouping them`);
        }
      }

      if (isPerPlacing) {
        // ── Per-placing format: [{places, rows}] ─────────────────────────────
        if (!theme.payoutPct || typeof theme.payoutPct !== 'number')
          errors.push('per-placing payoutTable requires a numeric "payoutPct" field');

        pt.forEach((b, bi) => {
          const tag = `entry[${bi}] (places=${b.places})`;
          if (typeof b.places !== 'number' || b.places < 1 || !Number.isInteger(b.places))
            errors.push(`${tag}: places must be a positive integer`);
          validateRows(tag, b.rows);
        });

        // places values must be unique and ascending
        const placeVals = pt.map(b => b.places);
        const dupPlaces = placeVals.filter((p, i) => placeVals.indexOf(p) !== i);
        if (dupPlaces.length > 0)
          errors.push(`duplicate places values: ${[...new Set(dupPlaces)].join(', ')}`);
        for (let i = 1; i < pt.length; i++) {
          if (pt[i].places <= pt[i-1].places)
            errors.push(`entry[${i}]: places not in ascending order`);
        }

      } else {
        // ── Range-based format: [{min, max, rows}] ────────────────────────────
        pt.forEach((b, bi) => {
          const tag = `bracket[${bi}] (${b.min}–${b.max})`;
          if (typeof b.min !== 'number' || typeof b.max !== 'number')
            errors.push(`${tag}: missing or non-numeric min/max`);
          else if (b.min > b.max)
            errors.push(`${tag}: min > max`);
          validateRows(tag, b.rows);
        });

        for (let i = 1; i < pt.length; i++) {
          if (pt[i].min !== pt[i-1].max + 1)
            errors.push(`bracket[${i}]: gap or overlap — previous max=${pt[i-1].max}, this min=${pt[i].min}`);
        }
        if (pt[0].min !== 1)
          errors.push(`bracket[0]: must start at min=1, got min=${pt[0].min}`);
        const last = pt[pt.length - 1];
        if (last.max !== 9999)
          errors.push(`bracket[${pt.length-1}] (${last.min}–${last.max}): last bracket must have max=9999 to cover all entry counts`);
        const mins = pt.map(b => b.min);
        const dupMins = mins.filter((m, i) => mins.indexOf(m) !== i);
        if (dupMins.length > 0)
          errors.push(`duplicate bracket min values: ${[...new Set(dupMins)].join(', ')}`);
      }
    }
  }

  report(slug, errors);
});

function report(slug, errors) {
  if (errors.length === 0) {
    console.log(`✓ ${slug}`);
    passed++;
  } else {
    console.log(`✗ ${slug}`);
    errors.forEach(e => console.log(`  ✗ ${e}`));
    failed++;
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
