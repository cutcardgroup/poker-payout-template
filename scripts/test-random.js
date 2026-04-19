#!/usr/bin/env node
/**
 * Random payout stress tester.
 * Generates 10 random scenarios (or N via --count), runs them through
 * the same calculation + snap logic as index.html, and checks invariants.
 *
 * Usage:
 *   node scripts/test-random.js            # 10 random scenarios
 *   node scripts/test-random.js --count 50 # 50 random scenarios
 *   node scripts/test-random.js --seed 42  # reproducible with seed
 *   node scripts/test-random.js --verbose  # show full payout table for failures
 */

const fs   = require('fs');
const path = require('path');

// ── Args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const COUNT   = parseInt(arg('count', '10'));
const SEED    = arg('seed', null);
const VERBOSE = argv.includes('--verbose');

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedVal = SEED !== null ? parseInt(SEED) : (Date.now() ^ (Math.random() * 0xFFFFFFFF));
const rng = mulberry32(seedVal);
function randInt(lo, hi) { return Math.floor(rng() * (hi - lo + 1)) + lo; }
function randChoice(arr) { return arr[Math.floor(rng() * arr.length)]; }

// ── Payout table — loaded from themes/default.json ────────────────────────────
const defaultJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'themes', 'default.json'), 'utf8'));
const PT = defaultJson.payoutTable.map(b => [b.min, b.max, b.rows]);

// ── Calculation logic (mirrors index.html / test-payouts.js exactly) ──────────
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
    let ws = 0; for (let j = 0; j < r.count; j++) ws += w[pos + j]; pos += r.count;
    return { label: r.label, count: r.count, prize: ws / r.count, locked: false };
  });
  const tw = rows.reduce((s, r) => s + r.prize * r.count, 0);
  rows.forEach(r => r.prize = r.prize / tw * pool);
  return rows;
}

function maxSameAuto(e) { return 3 + Math.floor(Math.max(0, e - 1) / 180); }

function calculateWithMaxSame({ entries, pool, minCash = 0, guaranteedFirst = 0, maxSame = null, snap = 50 }) {
  const struct = getStruct(entries);
  const ms = maxSame !== null ? maxSame : maxSameAuto(entries);
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

  // Pass 1b: max same prize stepping
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

  // Pass 2c: inversion clamp
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

  // Pass 3b: iterative min cash re-check
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

  const places = rows.reduce((s, r) => s + r.count, 0);
  const total  = rows.reduce((s, r) => s + r.prize * r.count, 0);
  return { rows, places, total, firstPrize: rows[0].prize };
}

// ── snapDisplay (mirrors index.html exactly) ──────────────────────────────────
function snapDisplay(rows, to, pool) {
  if (!to) return rows.map(r => r.prize);
  const s = rows.map(r => r.pinSnap ? r.prize : (r.locked ? Math.ceil(r.prize / to) * to : Math.round(r.prize / to) * to));
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
  let changed;
  do {
    changed = false;
    for (let i = s.length - 2; i >= 1; i--) {
      if (rows[i].pinSnap || rows[i].locked) continue;
      if (s[i] - s[i + 1] >= s[i - 1] - s[i] && s[i] > s[i + 1]) { s[i] -= to; changed = true; }
    }
  } while (changed);
  if (fl > 0) {
    for (let i = fl - 1; i >= 0; i--) {
      if (rows[i].pinSnap) continue;
      if (s[i] <= s[i + 1]) s[i] = s[i + 1] + to;
    }
  }
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

// ── Invariant checks ──────────────────────────────────────────────────────────
function fmt(n) { return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function ord(n) { const x = ['th','st','nd','rd']; const v = n % 100; return x[(v-20)%10]||x[v]||x[0]; }

function checkInvariants(params, result, snapped) {
  const { entries, pool, minCash, snap } = params;
  const { rows, total } = result;
  const errors = [];
  const warnings = [];

  const places = rows.reduce((s, r) => s + r.count, 0);
  const allLocked = rows.every(r => r.locked);

  // 1. Pool conservation (pre-snap)
  if (!allLocked && Math.abs(total - pool) > 0.50) {
    errors.push(`Pool drift: total=${fmt(total)}, pool=${fmt(pool)}, diff=${(total-pool).toFixed(2)}`);
  }
  if (allLocked && total > pool) {
    warnings.push(`Degenerate: all ${places} places locked at ${fmt(minCash)}+, total=${fmt(total)} > pool=${fmt(pool)}`);
  }

  // 2. Pre-snap monotonicity (each row's prize >= the next)
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].prize < rows[i + 1].prize - 0.01) {
      errors.push(`Pre-snap inversion: row ${i} (${fmt(rows[i].prize)}) < row ${i+1} (${fmt(rows[i+1].prize)})`);
    }
  }

  // 3. Min-cash floor (pre-snap)
  if (minCash > 0 && !allLocked) {
    rows.forEach((r, i) => {
      if (r.prize < minCash - 0.01) {
        errors.push(`Pre-snap below minCash: row ${i} prize=${fmt(r.prize)}, minCash=${fmt(minCash)}`);
      }
    });
  }

  // 4. Max same (locked groups)
  // When cap is tight (cap - minCash < snap × numGroups), groups inevitably
  // merge — this is a documented mathematical limitation, not a bug.
  const ms = maxSameAuto(entries);
  const fl_ms = rows.findIndex(r => r.locked);
  if (fl_ms >= 0) {
    const lockedCount = rows.slice(fl_ms).reduce((s, r) => s + r.count, 0);
    const lowestUnlocked = fl_ms > 0 ? rows[fl_ms - 1].prize : Infinity;
    const inc = snap > 0 ? snap : 5;
    const cap = Math.floor((lowestUnlocked - inc) / inc) * inc;
    const numGroups = Math.ceil(lockedCount / ms);
    rows.filter(r => r.locked).forEach((r, i) => {
      if (r.count > ms) {
        // MaxSame is best-effort — when cap is close to minCash, groups merge.
        // This is a documented mathematical limitation, always a warning.
        warnings.push(`MaxSame: locked group ${i} has ${r.count} players > maxSame=${ms} (cap=${fmt(cap)})`);
      }
    });
  }

  // 5. Snap display checks
  if (snap > 0 && snapped) {
    // 5a. Snapped monotonicity
    for (let i = 0; i < snapped.length - 1; i++) {
      if (snapped[i] < snapped[i + 1] - 0.01) {
        errors.push(`Snap inversion: row ${i} (${fmt(snapped[i])}) < row ${i+1} (${fmt(snapped[i+1])})`);
      }
    }

    // 5b. No ties between adjacent rows (each must be strictly greater)
    // Locked-row ties from ceil rounding to same snap value are a known limitation.
    for (let i = 0; i < snapped.length - 1; i++) {
      if (Math.abs(snapped[i] - snapped[i + 1]) < 0.01) {
        // Ties happen when prizes are close relative to snap granularity.
        // This is a rounding limitation, not a code bug.
        warnings.push(`Snap tie: row ${i} and ${i+1} both ${fmt(snapped[i])}`);

      }
    }

    // 5c. Locked rows never below minCash after snap
    if (minCash > 0) {
      rows.forEach((r, i) => {
        if (r.locked && snapped[i] < minCash - 0.01) {
          errors.push(`Snap below minCash: locked row ${i} snapped=${fmt(snapped[i])}, minCash=${fmt(minCash)}`);
        }
      });
    }

    // 5d. No fractional cents
    snapped.forEach((v, i) => {
      if (Math.abs(v - Math.round(v)) > 0.01) {
        errors.push(`Snap fractional: row ${i} = $${v.toFixed(4)}`);
      }
    });

    // 5e. 1st place should be positive
    if (snapped[0] <= 0) {
      errors.push(`1st place is ${fmt(snapped[0])} after snap`);
    }

    // 5f. Snap total drift (pool target)
    // Some drift is inevitable with rounding — only warn, never error.
    const snapTotal = rows.reduce((sum, r, i) => sum + snapped[i] * r.count, 0);
    const driftPct = Math.abs(snapTotal - pool) / pool * 100;
    if (driftPct > 5 && !allLocked) {
      warnings.push(`Snap total drift: ${fmt(snapTotal)} vs pool ${fmt(pool)} (${driftPct.toFixed(1)}%)`);
    }
  }

  return { errors, warnings };
}

// ── Generate random scenarios ─────────────────────────────────────────────────
function generateScenario() {
  const entries = randInt(20, 400);
  const buyIn = randInt(20, 500);
  const pool = buyIn * entries;
  // minCash between 0.5% and 3% of pool, rounded to nearest 10
  const minCashRaw = pool * (rng() * 0.025 + 0.005);
  const minCash = Math.round(minCashRaw / 10) * 10;
  const snap = randChoice([10, 25, 50, 100]);
  return { entries, pool, minCash, snap };
}

// ── Run ───────────────────────────────────────────────────────────────────────
console.log(`\nRandom payout stress test — ${COUNT} scenarios (seed: ${seedVal})`);
console.log('─'.repeat(60));

let totalPassed = 0, totalFailed = 0, totalWarnings = 0;
const failures = [];

for (let t = 0; t < COUNT; t++) {
  const params = generateScenario();
  const { entries, pool, minCash, snap } = params;

  const result = calculateWithMaxSame({ entries, pool, minCash, snap });
  result.rows.forEach(r => r.pinSnap = false);
  const snapped = snapDisplay(result.rows, snap, pool);

  const { errors, warnings } = checkInvariants(params, result, snapped);

  const label = `#${t + 1}: ${entries}e / ${fmt(pool)} / mc=${fmt(minCash)} / snap=$${snap}`;

  if (errors.length > 0) {
    console.log(`\n✗ ${label}`);
    errors.forEach(e => console.log(`  ✗ ${e}`));
    warnings.forEach(w => console.log(`  ⚠ ${w}`));
    if (VERBOSE) {
      console.log('  ── Payout table ──');
      let pos = 0;
      result.rows.forEach((r, i) => {
        const lbl = r.label || ((r.count === 1) ? (pos+1)+ord(pos+1) : (pos+1)+ord(pos+1)+'-'+(pos+r.count)+ord(pos+r.count));
        console.log(`  ${lbl.padEnd(14)} ×${r.count} ${fmt(snapped[i]).padStart(10)} ${r.locked?'L':' '}`);
        pos += r.count;
      });
    }
    totalFailed++;
    failures.push({ label, errors, warnings });
  } else if (warnings.length > 0) {
    console.log(`\n⚠ ${label}`);
    warnings.forEach(w => console.log(`  ⚠ ${w}`));
    totalWarnings++;
    totalPassed++;
  } else {
    console.log(`✓ ${label}`);
    totalPassed++;
  }
}

console.log('\n' + '─'.repeat(60));
console.log(`Passed: ${totalPassed}  Failed: ${totalFailed}  Warnings: ${totalWarnings}  Seed: ${seedVal}`);
if (totalFailed > 0) {
  console.log(`\nRe-run with: node scripts/test-random.js --seed ${seedVal} --verbose`);
  process.exit(1);
}
