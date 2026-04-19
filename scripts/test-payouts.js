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
  if (ft > 0) { const sc = Math.max(rem / ft, 0); rows.forEach(r => { if (!r.locked) r.prize *= sc; }); }
}

function calculate({ entries, pool, minCash = 0, guaranteedFirst = 0 }) {
  const struct = getStruct(entries);

  let rows = struct.map(r => ({ label: r.label, count: r.count, prize: (r.pct / 100) * pool, locked: false }));

  // Pass 1: iterative min-cash lock
  if (minCash > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (!rows[i].locked && rows[i].prize < minCash) {
          rows[i].prize = minCash; rows[i].locked = true; changed = true;
        }
      }
      if (changed) scaleUnlocked(rows, pool);
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
function snapDisplay(rows, to, pool) {
  if (!to) return rows.map(r => r.prize);
  const s = rows.map(r => r.pinSnap ? r.prize : (r.locked ? Math.ceil(r.prize / to) * to : Math.round(r.prize / to) * to));
  // Boundary gap: unlocked rows above locked groups must continue the
  // accelerating gap pattern upward until natural gaps are large enough.
  const fl = rows.findIndex(r => r.locked);
  if (fl > 0) {
    const lockedGaps = [];
    for (let i = fl; i < rows.length - 1; i++) {
      if (rows[i].locked && rows[i + 1].locked) lockedGaps.push(s[i] - s[i + 1]);
    }
    if (lockedGaps.length > 0) {
      let reqGap = Math.max(...lockedGaps) + to;
      for (let i = fl - 1; i >= 0; i--) {
        if (rows[i].pinSnap) break;
        const curGap = s[i] - s[i + 1];
        if (curGap >= reqGap) break;
        const needed = Math.ceil((reqGap - curGap) / to) * to;
        s[i] += needed;
        reqGap += to;
      }
    }
  }
  // Strict gap enforcement
  let changed;
  do {
    changed = false;
    for (let i = s.length - 2; i >= 1; i--) {
      if (rows[i].pinSnap || rows[i].locked) continue;
      if (s[i] - s[i+1] >= s[i-1] - s[i] && s[i] > s[i+1]) { s[i] -= to; changed = true; }
    }
  } while (changed);
  // Monotonicity: ensure no unlocked row ties or inverts with the row below
  if (fl > 0) {
    for (let i = fl - 1; i >= 0; i--) {
      if (rows[i].pinSnap) continue;
      if (s[i] <= s[i + 1]) s[i] = s[i + 1] + to;
    }
  }
  // Drift target: use pool if provided, otherwise raw total (synthetic tests)
  const target = pool !== undefined ? pool : rows.reduce((sum, r) => sum + r.prize * r.count, 0);
  const snapTot = rows.reduce((sum, r, i) => sum + s[i] * r.count, 0);
  let rem = target - snapTot;
  if (rem !== 0) {
    for (let i = 0; i < s.length && rem !== 0; i++) {
      if (rows[i].pinSnap || rows[i].locked) continue;
      const floor = i < s.length - 1 ? s[i + 1] + to : 0;
      if (rem < 0) {
        const canAbsorb = (s[i] - floor) * rows[i].count;
        if (canAbsorb <= 0) continue;
        if (Math.abs(rem) > canAbsorb) { rem += canAbsorb; s[i] = floor; }
        else { s[i] += rem / rows[i].count; rem = 0; }
      } else { s[i] += rem / rows[i].count; rem = 0; }
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
//   Fix:    nudge 3rd down $50 → $400; drift $50 to 1st → $1,050
//   Final:  $1,050 / $650 / $400 / $250   gaps: $400 / $250 / $150 ✓
testSnap('Test 21 — snap gap inversion: nudge-down corrects inversion, drift to 1st', errors => {
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
  assert(errors, Math.abs(s[2] -  400) < 0.01, `3rd should be nudged to $400; got $${s[2]}`);
  assert(errors, Math.abs(s[3] -  250) < 0.01, `4th should be unchanged at $250; got $${s[3]}`);

  // gaps strictly decreasing (each gap must be less than the gap above)
  for (let i = 1; i < s.length - 1; i++) {
    const gapAbove = s[i-1] - s[i];
    const gapBelow = s[i]   - s[i+1];
    assert(errors, gapBelow < gapAbove, `Equal/inverted gap at position ${i+1}: gap below ($${gapBelow}) >= gap above ($${gapAbove})`);
  }

  // snap total preserved (equals raw total — pool target)
  const rawTot = rows.reduce((a,r)=>a+r.prize*r.count,0);
  assert(errors, Math.abs(snapTotal - rawTot) < 0.01, `Snap total should equal raw total $${rawTot}; got $${snapTotal}`);
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

// $100 snap — engineered inversion: 3rd rounds up to $2,400, creating gap 3rd→4th ($900)
// larger than gap 2nd→3rd ($700). Enforcement nudges 3rd down twice to $2,200.
// $100 drift redistributed to 1st → $5,100. Gaps: $2,000 / $900 / $700 / $600 ✓
testSnap('Test 23 — $100 snap: inversion corrected, drift to 1st, gaps strictly decreasing', errors => {
  const rows = [
    { prize: 5000, count: 1, pinSnap: false },
    { prize: 3100, count: 1, pinSnap: false },
    { prize: 2350, count: 1, pinSnap: false },
    { prize: 1450, count: 1, pinSnap: false },
    { prize:  900, count: 1, pinSnap: false },
  ];
  const s = snapDisplay(rows, 100);

  assert(errors, Math.abs(s[0] - 5100) < 0.01, `1st should receive drift → $5,100; got $${s[0]}`);
  assert(errors, Math.abs(s[1] - 3100) < 0.01, `2nd should be $3,100; got $${s[1]}`);
  assert(errors, Math.abs(s[2] - 2200) < 0.01, `3rd should be $2,200; got $${s[2]}`);
  assert(errors, Math.abs(s[3] - 1500) < 0.01, `4th should be $1,500; got $${s[3]}`);
  assert(errors, Math.abs(s[4] -  900) < 0.01, `5th should be $900; got $${s[4]}`);

  for (let i = 1; i < s.length - 1; i++) {
    const gapAbove = s[i-1] - s[i], gapBelow = s[i] - s[i+1];
    assert(errors, gapBelow < gapAbove, `Equal/inverted gap at position ${i+1}: below=$${gapBelow} above=$${gapAbove}`);
  }
  const rawTot = rows.reduce((a,r)=>a+r.prize*r.count,0);
  assert(errors, Math.abs(s.reduce((a,v)=>a+v,0) - rawTot) < 0.01, `Snap total should equal raw total $${rawTot}`);
});

// $66 snap (custom unit) — engineered inversion: 3rd rounds to $1,320, creating gap
// 3rd→4th ($528) larger than gap 2nd→3rd ($462). Nudged to $1,254. $152 drift to 1st.
// Gaps: $1,340 / $528 / $462 ✓  (also verifies non-standard snap units work correctly)
testSnap('Test 24 — $66 custom snap: non-standard unit enforces strict gaps, drift to 1st', errors => {
  const rows = [
    { prize: 3000, count: 1, pinSnap: false },
    { prize: 1800, count: 1, pinSnap: false },
    { prize: 1350, count: 1, pinSnap: false },
    { prize:  800, count: 1, pinSnap: false },
  ];
  const s = snapDisplay(rows, 66);

  assert(errors, Math.abs(s[0] - 3122) < 0.01, `1st should receive drift → $3,122; got $${s[0]}`);
  assert(errors, Math.abs(s[1] - 1782) < 0.01, `2nd should be $1,782; got $${s[1]}`);
  assert(errors, Math.abs(s[2] - 1254) < 0.01, `3rd should be nudged to $1,254; got $${s[2]}`);
  assert(errors, Math.abs(s[3] -  792) < 0.01, `4th should be $792; got $${s[3]}`);

  for (let i = 1; i < s.length - 1; i++) {
    const gapAbove = s[i-1] - s[i], gapBelow = s[i] - s[i+1];
    assert(errors, gapBelow < gapAbove, `Equal/inverted gap at position ${i+1}: below=$${gapBelow} above=$${gapAbove}`);
  }
  const rawTot = rows.reduce((a,r)=>a+r.prize*r.count,0);
  assert(errors, Math.abs(s.reduce((a,v)=>a+v,0) - rawTot) < 0.01, `Snap total should equal raw total $${rawTot}`);
});

// ── Category E: Standard structure ─────────────────────────────────────
// Mirrors buildStandardNew() from index.html exactly.
// 1st = 2nd × 1.45, 2nd = 3rd × 1.30, 3rd+ = 82% geometric decay.
// Brackets with count>1 use average weight of their constituent positions.
function buildStandardNew(struct, pool) {
  const DECAY = 0.82, CAP12 = 1.45, CAP23 = 1.30;
  const n = struct.reduce((s, r) => s + r.count, 0);
  if (!n) return [];
  const w = new Array(n).fill(1.0);
  for (let i = n - 2; i >= 2; i--) w[i] = w[i + 1] / DECAY;
  if (n >= 3) { w[1] = w[2] * CAP23; w[0] = w[1] * CAP12; }
  else if (n === 2) { w[0] = w[1] * CAP12; }
  let pos = 0;
  const rows = struct.map(r => {
    let ws = 0;
    for (let j = 0; j < r.count; j++) ws += w[pos + j];
    pos += r.count;
    return { label: r.label, count: r.count, prize: ws / r.count, locked: false };
  });
  const tw = rows.reduce((s, r) => s + r.prize * r.count, 0);
  rows.forEach(r => r.prize = r.prize / tw * pool);
  return rows;
}

function calculateNew({ entries, pool, minCash = 0, guaranteedFirst = 0 }) {
  const struct = getStruct(entries);
  let rows = buildStandardNew(struct, pool);

  // Pass 1: iterative min-cash lock
  if (minCash > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (!rows[i].locked && rows[i].prize < minCash) {
          rows[i].prize = minCash; rows[i].locked = true; changed = true;
        }
      }
      if (changed) scaleUnlocked(rows, pool);
    }
  }
  scaleUnlocked(rows, pool);

  if (guaranteedFirst > 0 && rows[0].prize < guaranteedFirst) {
    rows[0].prize = guaranteedFirst; rows[0].locked = true;
    scaleUnlocked(rows, pool);
  }

  const places = rows.reduce((s, r) => s + r.count, 0);
  const total  = rows.reduce((s, r) => s + r.prize * r.count, 0);
  return { rows, places, total, firstPrize: rows[0].prize };
}

function testNew(name, fn) {
  const errors = [];
  try { fn(errors); } catch(e) { errors.push(`Threw: ${e.message}`); }
  const ok = errors.length === 0;
  console.log(`\n${ok?'✓':'✗'} ${name}`);
  errors.forEach(e => console.log(`  ✗ ${e}`));
  if (ok) { passed++; console.log('  ✓ all assertions passed'); }
  else failed++;
}

testNew('Test 25 — Standard: pool conserved, same places as Standard (old) (100 entries)', errors => {
  const standard = calculate({ entries: 100, pool: 20000 });
  const newCalc  = calculateNew({ entries: 100, pool: 20000 });
  assert(errors, newCalc.places === standard.places,
    `Places should match Standard (${standard.places}); got ${newCalc.places}`);
  assert(errors, Math.abs(newCalc.total - 20000) < 0.01,
    `Total should be $20,000; got ${fmt(newCalc.total)}`);
});

testNew('Test 26 — Standard: ratio caps exactly 1.45/1.30, monotone decay from 3rd (100 entries, all count=1)', errors => {
  const { rows } = calculateNew({ entries: 100, pool: 20000 });
  // All rows in this bracket are count=1, so individual ratios are exact
  const ratio12 = rows[0].prize / rows[1].prize;
  const ratio23 = rows[1].prize / rows[2].prize;
  assert(errors, Math.abs(ratio12 - 1.45) < 0.0001,
    `1st/2nd ratio should be 1.45; got ${ratio12.toFixed(4)}`);
  assert(errors, Math.abs(ratio23 - 1.30) < 0.0001,
    `2nd/3rd ratio should be 1.30; got ${ratio23.toFixed(4)}`);
  // 3rd onwards: each consecutive count=1 pair should have ratio 1/0.82
  const expectedDecay = 1 / 0.82;
  for (let i = 2; i < rows.length - 1; i++) {
    if (rows[i].count === 1 && rows[i + 1].count === 1) {
      const ratio = rows[i].prize / rows[i + 1].prize;
      assert(errors, Math.abs(ratio - expectedDecay) < 0.0001,
        `${rows[i].label}/${rows[i+1].label} ratio should be ${expectedDecay.toFixed(4)}; got ${ratio.toFixed(4)}`);
    }
  }
  // Prizes strictly decreasing
  for (let i = 0; i < rows.length - 1; i++) {
    assert(errors, rows[i].prize > rows[i + 1].prize,
      `${rows[i].label} ($${rows[i].prize.toFixed(2)}) should exceed ${rows[i+1].label} ($${rows[i+1].prize.toFixed(2)})`);
  }
});

testNew('Test 27 — Standard grouped brackets: pool conserved, top caps hold (250 entries)', errors => {
  // 250-entry bracket has 11th-15th×5, 16th-20th×5, 21st-30th×10 (grouped rows)
  const { rows, total, places } = calculateNew({ entries: 250, pool: 50000 });
  assert(errors, places === 30, `Places should be 30; got ${places}`);
  assert(errors, Math.abs(total - 50000) < 0.01, `Total should be $50,000; got ${fmt(total)}`);
  // Ratio caps still hold at the top (count=1 rows)
  const ratio12 = rows[0].prize / rows[1].prize;
  const ratio23 = rows[1].prize / rows[2].prize;
  assert(errors, Math.abs(ratio12 - 1.45) < 0.0001, `1st/2nd ratio: ${ratio12.toFixed(4)}`);
  assert(errors, Math.abs(ratio23 - 1.30) < 0.0001, `2nd/3rd ratio: ${ratio23.toFixed(4)}`);
});

testNew('Test 28 — Standard + min-cash: pool conserved after locking', errors => {
  const { total, places } = calculateNew({ entries: 100, pool: 20000, minCash: 500 });
  assert(errors, Math.abs(total - 20000) < 0.01, `Total should be $20,000; got ${fmt(total)}`);
  assert(errors, places === 10, `Places should be 10; got ${places}`);
});

// ── Category F: Max same prize / identical prizes limit ───────────────────────
// Mirrors maxSameAuto(), Pass 1b (max same expansion + stepped gaps),
// and Pass 3b (second min cash check after guarantee) from index.html.

function maxSameAuto(e) { return 3 + Math.floor(Math.max(0, e - 1) / 180); }

function calculateWithMaxSame({ entries, pool, minCash = 0, guaranteedFirst = 0, maxSame = null, snap = 50 }) {
  const struct = getStruct(entries);
  const ms = maxSame !== null ? maxSame : maxSameAuto(entries);

  let rows = buildStandardNew(struct, pool);

  // Pass 1: iterative min-cash lock — repeat until no unlocked row falls below mc
  if (minCash > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (!rows[i].locked && rows[i].prize < minCash) {
          rows[i].prize = minCash; rows[i].locked = true; changed = true;
        }
      }
      if (changed) scaleUnlocked(rows, pool);
    }
  }

  // Pass 1b: max same prize stepping (uses post-scale lowestUnlocked for accurate cap)
  if (minCash > 0) {
    const firstLocked = rows.findIndex(r => r.locked);
    if (firstLocked >= 0) {
      const lockedCount = rows.slice(firstLocked).reduce((s, r) => s + r.count, 0);
      const lowestUnlocked = firstLocked > 0 ? rows[firstLocked - 1].prize : Infinity;
      const inc = snap > 0 ? snap : 5;
      const numGroups = Math.ceil(lockedCount / ms);
      const baseSize = Math.floor(lockedCount / numGroups);
      const extraGroups = lockedCount % numGroups;

      const cap = Math.floor((lowestUnlocked - inc) / inc) * inc;
      const groups = [];
      for (let g = 0; g < numGroups; g++) {
        const chunkSize = g < extraGroups ? baseSize + 1 : baseSize;
        let prize;
        if (g === 0) { prize = minCash; }
        else {
          prize = minCash + g * (g + 1) / 2 * inc;
          prize = Math.min(prize, cap);
          if (groups[g - 1].prize >= prize) prize = groups[g - 1].prize + inc;
          prize = Math.min(prize, cap);
          prize = Math.max(prize, minCash);
        }
        groups.push({ count: chunkSize, prize });
      }

      groups.reverse();
      const newLocked = [];
      for (const grp of groups) {
        const last = newLocked[newLocked.length - 1];
        if (last && last.prize === grp.prize) last.count += grp.count;
        else newLocked.push({ label: '', count: grp.count, prize: grp.prize, locked: true });
      }
      rows = [...rows.slice(0, firstLocked), ...newLocked];
    }
  }

  // Pass 2b: re-scale after stepping
  scaleUnlocked(rows, pool);

  // Pass 2c: inversion clamp — top locked group must not exceed adjacent unlocked row.
  // Cascade downward so no locked row exceeds the one above it.
  if (minCash > 0) {
    const fl = rows.findIndex(r => r.locked);
    if (fl > 0 && rows[fl].prize >= rows[fl - 1].prize) {
      const clampStep = snap > 0 ? snap : 50;
      rows[fl].prize = Math.max(rows[fl - 1].prize - clampStep, minCash);
      for (let i = fl + 1; i < rows.length; i++) {
        if (rows[i].locked && rows[i].prize > rows[i - 1].prize) rows[i].prize = rows[i - 1].prize;
      }
      scaleUnlocked(rows, pool);
    }
  }

  // Pass 3: guaranteed first
  if (guaranteedFirst > 0 && rows[0].prize < guaranteedFirst) {
    rows[0].prize = guaranteedFirst; rows[0].locked = true;
    scaleUnlocked(rows, pool);
  }

  // Pass 3b: iterative min cash re-check after guarantee rescaling
  if (minCash > 0) {
    let changed3b = true;
    while (changed3b) {
      changed3b = false;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (!rows[i].locked && rows[i].prize < minCash) {
          rows[i].prize = minCash; rows[i].locked = true; changed3b = true;
        }
      }
      if (changed3b) scaleUnlocked(rows, pool);
    }
  }

  const places = rows.reduce((s, r) => s + r.count, 0);
  const total  = rows.reduce((s, r) => s + r.prize * r.count, 0);
  return { rows, places, total, firstPrize: rows[0].prize };
}

function testMaxSame(name, fn) {
  const errors = [];
  try { fn(errors); } catch(e) { errors.push(`Threw: ${e.message}`); }
  const ok = errors.length === 0;
  console.log(`\n${ok?'✓':'✗'} ${name}`);
  errors.forEach(e => console.log(`  ✗ ${e}`));
  if (ok) { passed++; console.log('  ✓ all assertions passed'); }
  else failed++;
}

testMaxSame('Test 29 — maxSameAuto: correct thresholds at boundary entries', errors => {
  const cases = [
    [1,   3], [180, 3],
    [181, 4], [360, 4],
    [361, 5], [540, 5],
    [541, 6],
  ];
  cases.forEach(([e, expected]) => {
    const got = maxSameAuto(e);
    assert(errors, got === expected, `entries=${e}: expected ${expected}, got ${got}`);
  });
});

testMaxSame('Test 30 — max same basic: no locked (min-cash) prize shared by more than maxSame players', errors => {
  // 154 entries, Standard mode, minCash=$2,000, gFirst=$33,000, maxSame=3
  const { rows } = calculateWithMaxSame({ entries: 154, pool: 148610, minCash: 2000, guaranteedFirst: 33000, maxSame: 3, snap: 50 });

  // Count players at each locked prize value — maxSame only constrains min-cash locked rows
  const lockedPrizeMap = new Map();
  rows.filter(r => r.locked && r.prize <= 2000 * 3).forEach(r =>
    lockedPrizeMap.set(r.prize, (lockedPrizeMap.get(r.prize) || 0) + r.count)
  );

  lockedPrizeMap.forEach((count, prize) => {
    assert(errors, count <= 3, `Locked prize $${prize} shared by ${count} players — exceeds maxSame=3`);
  });

  // Verify at least one locked group exists (test is meaningful)
  assert(errors, lockedPrizeMap.size > 0, 'Expected at least one locked prize group');
});

testMaxSame('Test 31 — stepped gaps: locked group gaps grow going up', errors => {
  // 227 entries, $65,725 pool, $700 min cash, maxSame=3, snap=0
  // The 201-300 bracket has 30 places; with Standard curve many bottom rows fall below
  // $700, producing enough locked places to create 3+ groups of 3.
  const snap = 0;
  const ms = 3;
  const { rows } = calculateWithMaxSame({ entries: 227, pool: 65725, minCash: 700, guaranteedFirst: 0, maxSame: ms, snap });

  const lockedRows = rows.filter(r => r.locked);
  assert(errors, lockedRows.length >= 3,
    `Expected at least 3 locked groups; got ${lockedRows.length}`);
  if (lockedRows.length < 2) return;

  // Collect locked group prizes bottom-first
  const lockedPrizes = lockedRows.map(r => r.prize).reverse();

  // Gaps between consecutive locked groups (bottom-up)
  const gaps = [];
  for (let i = 1; i < lockedPrizes.length; i++) {
    gaps.push(lockedPrizes[i] - lockedPrizes[i - 1]);
  }

  // All gaps must be positive (prizes strictly increasing going up)
  gaps.forEach((g, i) => assert(errors, g > 0, `Gap ${i + 1} is not positive: $${g}`));

  // Each gap must be larger than the one below (accelerating gaps).
  // Top gap may be smaller due to lowestUnlocked cap — only check interior.
  for (let i = 1; i < gaps.length - 1; i++) {
    assert(errors, gaps[i] > gaps[i - 1] - 0.01,
      `Gap ${i + 1} ($${gaps[i].toFixed(2)}) should be larger than gap ${i} ($${gaps[i - 1].toFixed(2)})`);
  }

  // No locked group exceeds maxSame players
  lockedRows.forEach(r => {
    assert(errors, r.count <= ms,
      `Locked group has ${r.count} players — exceeds maxSame=${ms}`);
  });
});

testMaxSame('Test 32 — second min cash pass: guarantee rescaling never leaves a place below min cash', errors => {
  // 60 entries, $58,000 pool — guarantee ($33,000) is 57% of pool, rescaling pushes bottom places low
  const { rows } = calculateWithMaxSame({ entries: 60, pool: 58000, minCash: 2000, guaranteedFirst: 33000, maxSame: 3, snap: 50 });

  rows.forEach(r => {
    assert(errors, r.prize >= 2000 - 0.01,
      `${r.label || '(locked)'} prize $${r.prize.toFixed(2)} is below min cash $2,000`);
  });
});

testMaxSame('Test 33 — cap at lowest unlocked: top locked group never exceeds the unlocked row above it', errors => {
  const { rows } = calculateWithMaxSame({ entries: 154, pool: 148610, minCash: 2000, guaranteedFirst: 33000, maxSame: 3, snap: 50 });

  const firstLockedIdx = rows.findIndex(r => r.locked);
  if (firstLockedIdx <= 0) return; // no unlocked rows above — skip

  const lowestUnlocked = rows[firstLockedIdx - 1].prize;
  const highestLocked  = rows[firstLockedIdx].prize;

  assert(errors, highestLocked < lowestUnlocked,
    `Top locked group ($${highestLocked}) should be below lowest unlocked row ($${lowestUnlocked.toFixed(2)})`);
});

testMaxSame('Test 34 — snap display: 1st place stays round, no cents in any row', errors => {
  // With snap active, all displayed values should be clean (no fractional cents).
  // Locked rows participate in snap rounding (they're already multiples of inc=snap).
  // Drift from enforcement goes to 1st place as a whole snap multiple.
  const pool = 166240;
  const snap = 25;
  const { rows } = calculateWithMaxSame({ entries: 336, pool, minCash: 1150, guaranteedFirst: 0, maxSame: 4, snap });

  const sv = snapDisplay(rows, snap, pool);

  // No row should show fractional cents
  sv.forEach((v, i) => {
    assert(errors, Math.abs(v - Math.round(v)) < 0.01,
      `Row ${i} prize $${v.toFixed(4)} has fractional cents`);
  });

  // 1st place should be a round number (no cents from drift)
  assert(errors, Math.abs(sv[0] % 1) < 0.01,
    `1st place $${sv[0].toFixed(2)} should be a whole dollar amount`);
});

testMaxSame('Test 35 — tight ceiling: triangle fallback to linear prevents group merging', errors => {
  // SPT-like scenario: 336 entries, $166,240 pool, $1,150 min cash, $25 snap.
  // Many locked rows with a low lowestUnlocked creates a tight ceiling.
  // Triangle formula overshoots the cap at g=3, so groups must fall back to
  // linear spacing (prev+inc). Without the fix, groups merge and exceed maxSame.
  const { rows } = calculateWithMaxSame({ entries: 336, pool: 166240, minCash: 1150, guaranteedFirst: 0, maxSame: 4, snap: 25 });

  const lockedRows = rows.filter(r => r.locked);

  // Every locked group must respect maxSame
  lockedRows.forEach(r => {
    assert(errors, r.count <= 4,
      `Locked group at $${r.prize.toFixed(0)} has ${r.count} players — exceeds maxSame=4`);
  });

  // All locked groups must have distinct prizes (no merging)
  const prizes = lockedRows.map(r => r.prize);
  const unique = new Set(prizes);
  assert(errors, unique.size === prizes.length,
    `Expected ${prizes.length} distinct locked prizes, got ${unique.size} — groups merged`);

  // All gaps between locked groups must be positive
  for (let i = 0; i < lockedRows.length - 1; i++) {
    const gap = lockedRows[i].prize - lockedRows[i + 1].prize;
    assert(errors, gap > 0,
      `Gap between locked rows ${i} and ${i+1} is $${gap.toFixed(0)} — not positive`);
  }
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

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
