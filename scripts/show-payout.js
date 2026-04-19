#!/usr/bin/env node
/**
 * Show a payout table. Uses the same calculation logic as test-payouts.js.
 *
 * Usage:
 *   node scripts/show-payout.js --entries 154 --pool 148610 --minCash 2000 --snap 50
 *   node scripts/show-payout.js --club matchroom
 *   node scripts/show-payout.js --club spt
 *   node scripts/show-payout.js --club spt --entries 200    # override theme examples
 */

const fs = require('fs');
const path = require('path');

// ── Parse args ──────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '');
  args[k] = process.argv[i + 1];
}

// ── Load theme ──────────────────────────────────────────────────────────────
const club = args.club || 'default';
const themeFile = path.join(__dirname, '..', 'themes', club + '.json');
if (!fs.existsSync(themeFile)) { console.error('Theme not found: ' + themeFile); process.exit(1); }
const theme = JSON.parse(fs.readFileSync(themeFile, 'utf8'));
const PT_PCT = theme.payoutPct || 0;
// SPT-style themes use { places, rows }, default uses { min, max, rows }
const PT = PT_PCT > 0
  ? theme.payoutTable.map(b => [b.places, b.rows])
  : theme.payoutTable.map(b => [b.min, b.max, b.rows]);

const ex = theme.examples || {};
const entries = parseInt(args.entries || ex.entries || 0);
const pool = parseFloat(args.pool || ex.pool || 0);
const minCash = parseFloat(args.minCash || ex.minCash || 0);
const snap = parseInt(args.snap || ex.snap || 50);
const gFirst = parseFloat(args.gFirst || 0);
const maxSame = args.maxSame ? parseInt(args.maxSame) : null;

if (!entries || !pool) { console.error('Need --entries and --pool (or --club with examples)'); process.exit(1); }

// ── Calculation logic (mirrors index.html / test-payouts.js) ────────────────
function getStruct(n) {
  if (PT_PCT > 0) {
    const places = Math.ceil(n * PT_PCT / 100);
    // Find bracket with enough rows, or use the largest
    const b = PT.find(e => e[0] >= places) || PT[PT.length - 1];
    return b[1].slice(0, places).map(r => ({ label: r[0], pct: r[1], count: r[2] }));
  }
  for (const [lo, hi, rows] of PT) if (n >= lo && n <= hi) return rows.map(r => ({ label: r[0], pct: r[1], count: r[2] }));
  return PT[PT.length - 1][2].map(r => ({ label: r[0], pct: r[1], count: r[2] }));
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

function scaleUnlocked(rows, pool) {
  const lk = rows.filter(r => r.locked).reduce((s, r) => s + r.prize * r.count, 0);
  const rem = pool - lk, ft = rows.filter(r => !r.locked).reduce((s, r) => s + r.prize * r.count, 0);
  if (ft > 0) { const sc = Math.max(rem / ft, 0); rows.forEach(r => { if (!r.locked) r.prize *= sc; }); }
}

function maxSameAuto(e) { return 3 + Math.floor(Math.max(0, e - 1) / 180); }

function calc() {
  const struct = getStruct(entries);
  const ms = maxSame !== null ? maxSame : maxSameAuto(entries);
  let rows = buildStandardNew(struct, pool);

  if (minCash > 0) {
    let ch = true;
    while (ch) { ch = false; for (let i = rows.length - 1; i >= 0; i--) { if (!rows[i].locked && rows[i].prize < minCash) { rows[i].prize = minCash; rows[i].locked = true; ch = true; } } if (ch) scaleUnlocked(rows, pool); }
  }

  if (minCash > 0) {
    const fl = rows.findIndex(r => r.locked);
    if (fl >= 0) {
      const lc = rows.slice(fl).reduce((s, r) => s + r.count, 0);
      const lu = fl > 0 ? rows[fl - 1].prize : Infinity;
      const inc = snap > 0 ? snap : 5;
      const ng = Math.ceil(lc / ms), bs = Math.floor(lc / ng), eg = lc % ng;
      const cap = Math.floor((lu - inc) / inc) * inc;
      const groups = [];
      for (let g = 0; g < ng; g++) {
        const cs = g < eg ? bs + 1 : bs;
        let prize;
        if (g === 0) prize = minCash;
        else { prize = minCash + g * (g + 1) / 2 * inc; prize = Math.min(prize, cap); if (groups[g - 1].prize >= prize) prize = groups[g - 1].prize + inc; prize = Math.min(prize, cap); prize = Math.max(prize, minCash); }
        groups.push({ count: cs, prize });
      }
      groups.reverse();
      const nl = [];
      for (const grp of groups) { const last = nl[nl.length - 1]; if (last && last.prize === grp.prize) last.count += grp.count; else nl.push({ label: '', count: grp.count, prize: grp.prize, locked: true }); }
      rows = [...rows.slice(0, fl), ...nl];
    }
  }
  scaleUnlocked(rows, pool);
  if (minCash > 0) { const fl = rows.findIndex(r => r.locked); if (fl > 0 && rows[fl].prize >= rows[fl - 1].prize) { const cs = snap > 0 ? snap : 50; rows[fl].prize = Math.max(rows[fl - 1].prize - cs, minCash); for (let i = fl + 1; i < rows.length; i++) { if (rows[i].locked && rows[i].prize > rows[i - 1].prize) rows[i].prize = rows[i - 1].prize; } scaleUnlocked(rows, pool); } }
  if (gFirst > 0 && rows[0].prize < gFirst) { rows[0].prize = gFirst; rows[0].locked = true; scaleUnlocked(rows, pool); }
  if (minCash > 0) { let ch = true; while (ch) { ch = false; for (let i = rows.length - 1; i >= 0; i--) { if (!rows[i].locked && rows[i].prize < minCash) { rows[i].prize = minCash; rows[i].locked = true; ch = true; } } if (ch) scaleUnlocked(rows, pool); } }
  return rows;
}

function snapDP(rows, to, pool) {
  if (!to) return rows.map(r => r.prize);
  const s = rows.map(r => r.locked ? Math.ceil(r.prize / to) * to : Math.round(r.prize / to) * to);
  const fl = rows.findIndex(r => r.locked);
  if (fl > 0) {
    const lg = []; for (let i = fl; i < rows.length - 1; i++) { if (rows[i].locked && rows[i + 1].locked) lg.push(s[i] - s[i + 1]); }
    if (lg.length > 0) { let rg = Math.max(...lg) + to; for (let i = fl - 1; i >= 0; i--) { const cg = s[i] - s[i + 1]; if (cg >= rg) break; const needed = Math.ceil((rg - cg) / to) * to; s[i] += needed; rg += to; } }
  }
  let ch; do { ch = false; for (let i = s.length - 2; i >= 1; i--) { if (rows[i].locked) continue; if (s[i] - s[i + 1] >= s[i - 1] - s[i] && s[i] > s[i + 1]) { s[i] -= to; ch = true; } } } while (ch);
  if (fl > 0) { for (let i = fl - 1; i >= 0; i--) { if (s[i] <= s[i + 1]) s[i] = s[i + 1] + to; } }
  const st = rows.reduce((sum, r, i) => sum + s[i] * r.count, 0);
  let rem = pool - st;
  if (rem !== 0) { for (let i = 0; i < s.length && rem !== 0; i++) { if (rows[i].locked) continue; const floor = i < s.length - 1 ? s[i + 1] + to : 0; if (rem < 0) { const ca = (s[i] - floor) * rows[i].count; if (ca <= 0) continue; if (Math.abs(rem) > ca) { rem += ca; s[i] = floor; } else { s[i] += rem / rows[i].count; rem = 0; } } else { s[i] += rem / rows[i].count; rem = 0; } } }
  return s;
}

// ── Output ──────────────────────────────────────────────────────────────────
function fmt(n) { return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function ord(n) { const x = ['th', 'st', 'nd', 'rd']; const v = n % 100; return x[(v - 20) % 10] || x[v] || x[0]; }

const rows = calc();
rows.forEach(r => r.pinSnap = false);
const s = snapDP(rows, snap, pool);
const tot = rows.reduce((sum, r, i) => sum + s[i] * r.count, 0);

console.log(`\n${theme.name || club.toUpperCase()} — ${entries} entries, ${fmt(pool)} pool, ${fmt(minCash)} min, $${snap} snap`);
console.log('Place'.padEnd(16) + 'Cnt'.padStart(4) + 'Prize'.padStart(12) + 'Jump'.padStart(10));
console.log('-'.repeat(42));

let pos = 0;
rows.forEach((r, i) => {
  const d = s[i], jump = i < rows.length - 1 ? (d - s[i + 1]) : '';
  let lbl = r.label;
  if (!lbl) { lbl = r.count === 1 ? (pos + 1) + ord(pos + 1) : (pos + 1) + ord(pos + 1) + '-' + (pos + r.count) + ord(pos + r.count); }
  pos += r.count;
  console.log(lbl.padEnd(16) + String(r.count).padStart(4) + fmt(d).padStart(12) + (jump !== '' ? fmt(jump).padStart(10) : ''));
});
console.log('-'.repeat(42));
console.log('TOTAL'.padEnd(16) + String(pos).padStart(4) + fmt(tot).padStart(12));
