/**
 * Payout + Mystery Bounty engine — single source of truth.
 *
 * UMD: works as `<script src>` in the browser (exposes window.PayoutEngine)
 * and as a CommonJS module in Node (require('./payout-engine.js')).
 *
 * All functions are pure: take inputs, return outputs. The few that mutate
 * (scaleUnlocked) only touch their argument and are documented at the call
 * site. No module-level mutable state.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.PayoutEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── Formatting / misc ───────────────────────────────────────────────────
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function snapRound(n, to) {
    if (!to) return n;
    return Math.round(n / to) * to;
  }

  function maxSameAuto(e) { return 3 + Math.floor(Math.max(0, e - 1) / 180); }

  // ─── Structure lookup ────────────────────────────────────────────────────
  // PT shape: range-based  = [[lo, hi, rows], ...]
  //           per-placing  = [[places, rows], ...]   (use PT_PCT > 0 mode)
  // rows entries: [label, pct, count]
  function getStruct(n, PT, PT_PCT, tailDecay) {
    if (PT_PCT > 0) {
      const places = Math.ceil(n * PT_PCT / 100);
      const b = PT.find(e => e[0] >= places);
      if (b) {
        const rows = b[1].map(r => ({ label: r[0], pct: r[1], count: r[2] }));
        return applyOverride(rows, places);
      }
      // places > largest defined bracket — extend tail via geometric decay
      const last = PT[PT.length - 1];
      const lastMax = last[0];
      const rows = last[1].map(r => ({ label: r[0], pct: r[1], count: r[2] }));
      const td = tailDecay !== undefined ? tailDecay : 0.85;
      let prev = last[1][last[1].length - 1][1];
      for (let k = lastMax + 1; k <= places; k++) {
        prev = prev * td;
        rows.push({ label: ordinal(k), pct: Math.round(prev * 100) / 100, count: 1 });
      }
      return rows;
    }
    for (const [lo, hi, rows] of PT) {
      if (n >= lo && n <= hi) return rows.map(r => ({ label: r[0], pct: r[1], count: r[2] }));
    }
    return PT[PT.length - 1][2].map(r => ({ label: r[0], pct: r[1], count: r[2] }));
  }

  // Override the number of paid places. Trims or extends and re-labels
  // brackets when their position range is partially affected.
  function applyOverride(rows, target) {
    const cur = rows.reduce((s, r) => s + r.count, 0);
    if (target === cur) return rows;
    if (target < cur) {
      const res = []; let used = 0;
      for (const r of rows) {
        if (used >= target) break;
        const take = Math.min(r.count, target - used);
        let label = r.label;
        if (take < r.count) {
          const start = used + 1, end = used + take;
          label = start === end ? ordinal(start) : `${ordinal(start)}-${ordinal(end)}`;
        }
        res.push({ ...r, label, count: take });
        used += take;
      }
      return res;
    }
    const extra = target - cur, last = rows[rows.length - 1];
    const start = cur + 1, end = target;
    const newLabel = start === end ? ordinal(start) : `${ordinal(start)}-${ordinal(end)}`;
    return [...rows, { label: newLabel, pct: last.pct, count: extra }];
  }

  // Expand grouped bands ({label:'1st-3rd', count:3}) into individual placing rows.
  function expandRows(rows) {
    const out = []; let pos = 0;
    for (const r of rows) {
      if (r.count === 1) { pos++; out.push({ ...r }); }
      else {
        for (let j = 0; j < r.count; j++) {
          pos++;
          out.push({ label: ordinal(pos), count: 1, prize: r.prize, locked: r.locked });
        }
      }
    }
    return out;
  }

  // ─── Standard (geometric decay + top ratios) ─────────────────────────────
  // 1st = 2nd × CAP12, 2nd = 3rd × CAP23, 3rd+ = DECAY geometric decay.
  // Brackets with count>1 use the average weight across their constituent positions.
  function buildStandardNew(struct, pool, cap12, cap23, decay) {
    const DECAY = decay || 0.82, CAP12 = cap12 || 1.45, CAP23 = cap23 || 1.30;
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
    rows.forEach(r => { r.prize = r.prize / tw * pool; });
    return rows;
  }

  // ─── Cliff curve (graduated-to-floor with a final-table wall) ─────────────
  // Opt-in via cfg.curve === 'cliff'. Unlike buildStandardNew (which feeds the
  // min-cash lock + max-same stepping passes and plateaus the tail), this builds
  // a smoothly graduated structure straight to the floor, with a deliberate jump
  // at the ftSize→ftSize+1 final-table bubble. Banding is algorithmic.

  // Algorithmic band layout: singles for the top, then growing groups capped at
  // maxSame. Returns [[startPlace, size], ...] covering 1..N.
  function autoBands(N, maxSame, ftSize) {
    const ms = maxSame > 0 ? maxSame : 10;
    const singles = Math.min(N, Math.max(10, ftSize || 0));
    const bands = [];
    let p = 1;
    for (; p <= singles; p++) bands.push([p, 1]);
    const grow = [2, 3, 3, 5, 8, 10];
    let gi = 0;
    while (p <= N) {
      let size = gi < grow.length ? grow[gi] : ms;
      gi++;
      size = Math.min(size, ms, N - p + 1);
      bands.push([p, size]);
      p += size;
    }
    return bands;
  }

  // Build banded rows for cliff mode. opts: minCash, guaranteedFirst, maxSame,
  // ftSize, cap1, cap2, ftDecay, cliff, snap.
  //
  // FT places 1..ftSize: geometric (ftDecay) with cap1/cap2 at the top — convex.
  // Cliff: the first tail band (place ftSize+1) sits at (ftSize value) / cliff.
  // Tail: band values are assigned DIRECTLY with non-increasing gaps (convex),
  // each gap ≥ `snap` so values stay distinct after rounding (no floor plateau,
  // honours max-same). Computing band values directly — rather than averaging a
  // per-place curve — is what keeps the gaps monotonic; averaging over growing
  // bands was producing gap inversions. Overall scale is bisected to hit the pool.
  function buildCliffCurve(N, pool, opts) {
    const o = opts || {};
    if (N <= 0) return [];
    const CAP1 = o.cap1 || 1.87, CAP2 = o.cap2 || 1.55;
    const DFT = o.ftDecay || 1.25, CLIFF = o.cliff || 1.30;
    const floor = o.minCash > 0 ? o.minCash : 0;
    const gFirst = o.guaranteedFirst > 0 ? o.guaranteedFirst : 0;
    const maxSame = o.maxSame > 0 ? o.maxSame : 10;
    const ftSize = Math.min(o.ftSize || 9, N);
    const gmin = o.snap > 0 ? o.snap : 50; // min band-to-band gap (keeps values distinct)

    const bands = autoBands(N, maxSame, ftSize);

    // FT relative weights, anchored so w[ftSize] = 1.
    const w = new Array(ftSize + 1).fill(0);
    for (let k = ftSize; k >= 3; k--) w[k] = Math.pow(DFT, ftSize - k);
    if (ftSize >= 3) { w[2] = w[3] * CAP2; w[1] = w[2] * CAP1; }
    else if (ftSize === 2) { w[1] = CAP1; w[2] = 1; }
    else { w[1] = 1; }

    const tailBands = bands.filter(b => b[0] > ftSize); // place ftSize+1 .. N
    const m = tailBands.length;
    const sizes = tailBands.map(b => b[1]);

    // Convex tail band values from v1 (cliff value) down to floor, gaps ≥ gmin.
    function tailValues(v1) {
      if (m === 0) return [];
      if (m === 1) return [Math.max(v1, floor)];
      const span = v1 - floor;
      const base = (m - 1) * gmin;
      const extra = span - base;                 // above the min-gap baseline
      const c = extra > 0 ? 2 * extra / ((m - 1) * m) : 0;
      const g = [];                              // gaps, largest at top, ≥ gmin
      for (let k = 1; k <= m - 1; k++) g.push(gmin + c * (m - k));
      const v = new Array(m); v[m - 1] = floor;
      for (let k = m - 2; k >= 0; k--) v[k] = v[k + 1] + g[k];
      return v;
    }

    const ftLo = gFirst > 0 ? 2 : 1;
    function totalFor(scale) {
      let t = gFirst > 0 ? gFirst : 0;
      for (let k = ftLo; k <= ftSize; k++) t += scale * w[k];
      tailValues(scale * w[ftSize] / CLIFF).forEach((val, i) => { t += val * sizes[i]; });
      return t;
    }
    // Bisect scale (totalFor is monotonic increasing in scale).
    let lo = 0, hi = Math.max(pool, 1);
    while (totalFor(hi) < pool && hi < 1e12) hi *= 2;
    for (let it = 0; it < 200; it++) { const mid = (lo + hi) / 2; if (totalFor(mid) > pool) hi = mid; else lo = mid; }
    const scale = (lo + hi) / 2;
    const tv = tailValues(scale * w[ftSize] / CLIFF);

    const rows = bands.map(([start, size]) => {
      const hi2 = start + size - 1;
      const label = start === hi2 ? ordinal(start) : `${ordinal(start)}-${ordinal(hi2)}`;
      let prize;
      if (start <= ftSize) prize = (gFirst > 0 && start === 1) ? gFirst : scale * w[start];
      else prize = tv[tailBands.findIndex(tb => tb[0] === start)];
      return { label, count: size, prize, locked: false };
    });

    if (floor > 0) rows.forEach(r => { if (r.prize < floor) r.prize = floor; });
    if (gFirst > 0 && rows.length) { rows[0].locked = true; rows[0].pinSnap = true; }
    // Reconcile any residual (from floor clamp) onto the richest non-pinned band.
    const tot = rows.reduce((s, r) => s + r.prize * r.count, 0);
    const diff = pool - tot;
    if (Math.abs(diff) > 0.005) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].pinSnap) continue;
        const per = diff / rows[i].count;
        if (rows[i].prize + per >= floor) { rows[i].prize += per; break; }
      }
    }
    return rows;
  }

  // MUTATES `rows`. Scales unlocked prizes so the pool sum is preserved.
  function scaleUnlocked(rows, pool) {
    const lk = rows.filter(r => r.locked).reduce((s, r) => s + r.prize * r.count, 0);
    const rem = pool - lk;
    const ft = rows.filter(r => !r.locked).reduce((s, r) => s + r.prize * r.count, 0);
    if (ft > 0) {
      const sc = Math.max(rem / ft, 0);
      rows.forEach(r => { if (!r.locked) r.prize *= sc; });
    }
  }

  // ─── snapDisplay (display-only rounding with gap monotonicity) ───────────
  // Pure: returns an array of snapped prizes indexed parallel to rows.
  // `pool` is optional; when omitted the raw row total is the drift target
  // (used by synthetic tests that have no pool concept).
  function snapDisplay(rows, to, pool, opts) {
    if (!to) return rows.map(r => r.prize);
    // preserveShape: skip the gap-convexity passes (which assume monotonically
    // increasing gaps — the normal payout shape). The cliff curve is deliberately
    // non-convex (large final-table gap, then small ones), so those passes would
    // flatten the wall and dump the deficit onto 1st. Just clamp inversions.
    const preserve = !!(opts && opts.preserveShape);
    const s = rows.map(r => r.pinSnap ? r.prize
      : (r.locked ? Math.ceil(r.prize / to) * to : Math.round(r.prize / to) * to));

    const fl = rows.findIndex(r => r.locked);
    if (preserve) {
      for (let i = 1; i < s.length; i++) {
        if (rows[i].pinSnap) continue;
        if (s[i] > s[i - 1]) s[i] = s[i - 1];
      }
    } else {
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
          if (s[i] - s[i + 1] >= s[i - 1] - s[i] && s[i] > s[i + 1]) {
            s[i] -= to; changed = true;
          }
        }
      } while (changed);
    }

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

  // ─── Pass functions (named, composable) ──────────────────────────────────
  // Each pass takes rows + config, MUTATES rows in place, returns rows for
  // chaining. Mutation matches the original go() body — there's no benefit
  // to immutability here since rows is freshly built per call.

  // Pass 1 + 3b + Pass-4-inner: iterative min-cash lock. Walk bottom-up;
  // any unlocked row below mc gets locked at mc, rescale, repeat until
  // stable. Three call sites in the original go() collapsed to one.
  function lockMinCash(rows, pool, mc) {
    if (mc <= 0) return rows;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (!rows[i].locked && rows[i].prize < mc) {
          rows[i].prize = mc; rows[i].locked = true; changed = true;
        }
      }
      if (changed) scaleUnlocked(rows, pool);
    }
    return rows;
  }

  // Pass 1b: stepped grouping of locked rows below the bubble. Builds groups
  // bottom-up with triangular-increment gaps capped at lowestUnlocked-inc;
  // reverses and merges equal-prize adjacents.
  function applyMaxSameStepping(rows, mc, snap, maxSame) {
    if (mc <= 0) return rows;
    const firstLocked = rows.findIndex(r => r.locked);
    if (firstLocked < 0) return rows;

    const lockedCount = rows.slice(firstLocked).reduce((s, r) => s + r.count, 0);
    const lowestUnlocked = firstLocked > 0 ? rows[firstLocked - 1].prize : Infinity;
    const inc = snap > 0 ? snap : 5;
    const numGroups = Math.ceil(lockedCount / maxSame);
    const baseSize = Math.floor(lockedCount / numGroups);
    const extraGroups = lockedCount % numGroups;
    const cap = Math.floor((lowestUnlocked - inc) / inc) * inc;
    const groups = [];
    for (let g = 0; g < numGroups; g++) {
      const chunkSize = g < extraGroups ? baseSize + 1 : baseSize;
      let prize;
      if (g === 0) prize = mc;
      else {
        prize = mc + g * (g + 1) / 2 * inc;
        prize = Math.min(prize, cap);
        if (groups[g - 1].prize >= prize) prize = groups[g - 1].prize + inc;
        prize = Math.min(prize, cap);
        prize = Math.max(prize, mc);
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
    // Splice the locked tail in place so callers can keep their `rows` reference
    // for downstream chaining (they typically do `rows = labelLockedRows(rows)`).
    rows.splice(firstLocked, rows.length - firstLocked, ...newLocked);
    return rows;
  }

  // Pass 1c: assign ordinal labels (e.g. "11th-13th") to locked rows based
  // on their current position in the array.
  function labelLockedRows(rows) {
    let p = 1;
    for (const r of rows) {
      if (r.locked) {
        const s = p, e = p + r.count - 1;
        r.label = s === e ? ordinal(s) : `${ordinal(s)}-${ordinal(e)}`;
      }
      p += r.count;
    }
    return rows;
  }

  // Pass 2c: clamp the top locked row if rescaling pushed it above the
  // adjacent unlocked row. Cascades downward so no locked row exceeds the
  // one above it. Rescales unlocked after.
  function clampStepInversion(rows, pool, snap, mc) {
    if (mc <= 0) return rows;
    const fl = rows.findIndex(r => r.locked);
    if (fl <= 0 || rows[fl].prize < rows[fl - 1].prize) return rows;
    const clampStep = snap > 0 ? snap : 50;
    rows[fl].prize = Math.max(rows[fl - 1].prize - clampStep, mc);
    for (let i = fl + 1; i < rows.length; i++) {
      if (rows[i].locked && rows[i].prize > rows[i - 1].prize) rows[i].prize = rows[i - 1].prize;
    }
    scaleUnlocked(rows, pool);
    return rows;
  }

  // Pass 3: hard-lock 1st place at the guaranteed minimum, rescale.
  function applyGuaranteedFirst(rows, pool, gfirst) {
    if (gfirst <= 0 || rows.length === 0 || rows[0].prize >= gfirst) return rows;
    rows[0].prize = gfirst; rows[0].locked = true;
    scaleUnlocked(rows, pool);
    return rows;
  }

  // Pass 4 (outer only): floor 1st place at minFirstPct% of pool. The follow-up
  // min-cash relock is the caller's responsibility (lockMinCash).
  function applyMinFirstFloor(rows, pool, minFirstPct) {
    if (minFirstPct <= 0 || rows.length === 0) return rows;
    const minFirst = (minFirstPct / 100) * pool;
    if (rows[0].prize >= minFirst - 0.01) return rows;
    rows[0].prize = minFirst; rows[0].locked = true;
    scaleUnlocked(rows, pool);
    return rows;
  }

  // Pass 5: ensure top ftSize places collectively receive at least 60% of pool.
  // Only unlocked FT rows are scaled up; locked rows (GFIRST, min cash) are
  // respected. Non-FT unlocked rows are scaled down to absorb the cost.
  function applyFtFloor(rows, pool, ftSize) {
    if (ftSize <= 0 || rows.length <= ftSize) return rows;
    const ftPlacesCount = rows.slice(0, ftSize).reduce((s, r) => s + r.count, 0);
    if (ftPlacesCount !== ftSize) return rows;

    const ftLocked = rows.slice(0, ftSize).filter(r => r.locked).reduce((s, r) => s + r.prize * r.count, 0);
    const ftUnlocked = rows.slice(0, ftSize).filter(r => !r.locked);
    const ftUnlockedCur = ftUnlocked.reduce((s, r) => s + r.prize * r.count, 0);
    const ftTotal = ftLocked + ftUnlockedCur;
    const nonFtLocked = rows.slice(ftSize).filter(r => r.locked).reduce((s, r) => s + r.prize * r.count, 0);
    const maxFtCanGet = pool - nonFtLocked;
    const ftTarget = Math.min(0.6 * pool, maxFtCanGet);
    if (ftTotal >= ftTarget - 0.01 || ftUnlockedCur <= 0) return rows;

    const deficit = ftTarget - ftTotal;
    const ftUnlockedScale = (ftUnlockedCur + deficit) / ftUnlockedCur;
    ftUnlocked.forEach(r => { r.prize *= ftUnlockedScale; });
    const nonFtUnlocked = rows.slice(ftSize).filter(r => !r.locked);
    const nonFtUnlockedCur = nonFtUnlocked.reduce((s, r) => s + r.prize * r.count, 0);
    const nonFtUnlockedTarget = pool - ftTarget - nonFtLocked;
    if (nonFtUnlocked.length > 0 && nonFtUnlockedCur > 0) {
      const sc = Math.max(nonFtUnlockedTarget / nonFtUnlockedCur, 0);
      nonFtUnlocked.forEach(r => { r.prize *= sc; });
    }
    return rows;
  }

  // ─── Top-level orchestration (production) ────────────────────────────────
  // Matches go() in index.html exactly. Tests with isolated orchestrations
  // (calculate / calculateNew / calculateWithMaxSame) compose the leaves
  // above directly instead of calling this.
  function calculatePayouts(cfg) {
    const {
      entries, pool, PT, PT_PCT = 0,
      minCash = 0, guaranteedFirst = 0, minFirstPct = 0,
      ftSize = 0, snap = 0, maxSame = null,
      placesOverride = 0,
      cap12 = 1.45, cap23 = 1.30, decay = 0.82,
      tailDecay = 0.85,
    } = cfg;
    const ms = maxSame !== null ? maxSame : maxSameAuto(entries);

    // Cliff mode: graduated-to-floor curve with a final-table wall. Bypasses the
    // standard build + min-cash/stepping passes entirely (those plateau the tail).
    if (cfg.curve === 'cliff') {
      const N = placesOverride > 0 ? placesOverride : Math.ceil(entries * PT_PCT / 100);
      const rows = buildCliffCurve(N, pool, {
        minCash, guaranteedFirst, maxSame: ms, ftSize: ftSize || 9, snap,
        cap1: cfg.cap1, cap2: cfg.cap2, ftDecay: cfg.ftDecay, cliff: cfg.cliff,
      });
      return { rows };
    }

    let struct = getStruct(entries, PT, PT_PCT, tailDecay);
    if (placesOverride > 0) struct = applyOverride(struct, placesOverride);
    let rows = buildStandardNew(struct, pool, cap12, cap23, decay);

    lockMinCash(rows, pool, minCash);            // Pass 1
    applyMaxSameStepping(rows, minCash, snap, ms); // Pass 1b
    labelLockedRows(rows);                       // Pass 1c
    scaleUnlocked(rows, pool);                   // Pass 2b
    clampStepInversion(rows, pool, snap, minCash); // Pass 2c
    applyGuaranteedFirst(rows, pool, guaranteedFirst); // Pass 3
    lockMinCash(rows, pool, minCash);            // Pass 3b

    if (guaranteedFirst === 0 && minFirstPct > 0) {
      const before = rows[0] && rows[0].prize;
      applyMinFirstFloor(rows, pool, minFirstPct); // Pass 4 outer
      if (rows[0] && rows[0].prize !== before) {
        lockMinCash(rows, pool, minCash);        // Pass 4 inner
      }
    }

    applyFtFloor(rows, pool, ftSize);            // Pass 5
    return { rows };
  }

  // ─── Mystery bounty ──────────────────────────────────────────────────────
  function mbSnap(v, to) {
    if (!to || to <= 0) return Math.round(v);
    return Math.round(v / to) * to;
  }

  function distributeCounts(pcts, n) {
    const total = pcts.reduce((a, b) => a + b, 0);
    const norm = pcts.map(p => p / total * n);
    const floors = norm.map(Math.floor);
    const deficit = n - floors.reduce((a, b) => a + b, 0);
    const rems = norm.map((v, i) => ({ i, r: v - floors[i] })).sort((a, b) => b.r - a.r);
    for (let k = 0; k < deficit; k++) floors[rems[k].i]++;
    return floors;
  }

  // Optional `labels` array of tier display names parallels `tiers`. Caller
  // typically passes MB_TIER_LABELS shifted by topBounty presence.
  function buildTiered(pool, n, zeros, topBounty, tiers, snap, minBounty = 0, labels) {
    const results = [];
    let activeN = n - zeros;
    let activePool = pool;

    if (topBounty > 0) { activeN = Math.max(0, activeN - 1); activePool = Math.max(0, activePool - topBounty); }
    if (activeN <= 0 || activePool <= 0) {
      const early = topBounty > 0 ? [{ count: 1, value: topBounty, isTop: true }] : [];
      if (zeros > 0) early.push({ count: zeros, value: 0, isZero: true });
      return early;
    }

    const counts = distributeCounts(tiers.map(t => t.pct), activeN);
    const weightedSum = counts.reduce((s, c, i) => s + c * tiers[i].mult, 0);
    if (weightedSum <= 0) return [];
    const base = activePool / weightedSum;
    const vals = tiers.map(t => mbSnap(base * t.mult, snap));

    for (let i = 1; i < tiers.length; i++) {
      if (vals[i] >= vals[i - 1] && snap > 0) vals[i] = Math.max(0, vals[i - 1] - snap);
    }

    const mbFloor = minBounty > 0 ? (snap > 0 ? Math.ceil(minBounty / snap) * snap : minBounty) : 0;
    const last = tiers.length - 1;
    if (mbFloor > 0 && vals[last] < mbFloor) {
      vals[last] = mbFloor;
      for (let i = last - 1; i >= 0; i--) {
        if (vals[i] <= vals[i + 1]) vals[i] = vals[i + 1] + (snap > 0 ? snap : 1);
      }
    }

    let snappedTotal = counts.reduce((s, c, i) => s + c * vals[i], 0);
    let rem = activePool - snappedTotal;
    for (let j = 0; j < vals.length && rem !== 0; j++) {
      const minV = j < last ? vals[j + 1] + (snap > 0 ? snap : 1) : mbFloor;
      const proposed = vals[j] + rem / counts[j];
      if (proposed >= minV) { vals[j] = proposed; rem = 0; }
      else { const canAbsorb = (vals[j] - minV) * counts[j]; rem += canAbsorb; vals[j] = minV; }
    }

    for (let i = 0; i < tiers.length; i++) {
      if (counts[i] > 0) {
        const tierLabel = labels ? labels[i] : undefined;
        results.push({ count: counts[i], value: vals[i], tierLabel });
      }
    }

    if (topBounty > 0) results.unshift({ count: 1, value: topBounty, isTop: true });
    if (zeros > 0) results.push({ count: zeros, value: 0, isZero: true });
    return results;
  }

  function buildFlat(pool, n, zeros, topBounty, snap, minBounty = 0) {
    const results = [];
    let activeN = n - zeros;
    let activePool = pool;
    if (topBounty > 0) { activeN = Math.max(0, activeN - 1); activePool = Math.max(0, activePool - topBounty); }
    if (activeN <= 0) {
      if (topBounty > 0) results.push({ count: 1, value: topBounty, isTop: true });
      if (zeros > 0) results.push({ count: zeros, value: 0, isZero: true });
      return results;
    }
    let base = mbSnap(activePool / activeN, snap);
    if (base * activeN > activePool) base -= snap > 0 ? snap : 1;
    if (minBounty > 0) {
      const floor = snap > 0 ? Math.ceil(minBounty / snap) * snap : minBounty;
      if (base < floor) base = floor;
    }
    const rem = activePool - base * activeN;
    const topVal = base + (snap > 0 ? Math.round(rem / snap) * snap : rem);
    if (topBounty > 0) results.push({ count: 1, value: topBounty, isTop: true });
    if (topVal !== base) results.push({ count: 1, value: topVal });
    results.push({ count: topVal !== base ? activeN - 1 : activeN, value: base });
    if (zeros > 0) results.push({ count: zeros, value: 0, isZero: true });
    return results.filter(r => r.count > 0);
  }

  function buildCustom(pool, n, zeros, topBounty, customTiers) {
    const rows = customTiers.filter(r => r.count > 0 && r.value >= 0);
    const totalCount = rows.reduce((s, r) => s + r.count, 0) + (topBounty > 0 ? 1 : 0) + zeros;
    const totalVal  = rows.reduce((s, r) => s + r.count * r.value, 0) + (topBounty > 0 ? topBounty : 0);
    return { rows, totalCount, totalVal, valid: Math.abs(totalVal - pool) < 1 && totalCount === n };
  }

  return {
    // payout leaves
    ordinal, snapRound, maxSameAuto,
    getStruct, applyOverride, expandRows,
    buildStandardNew, scaleUnlocked, snapDisplay,
    autoBands, buildCliffCurve,
    // payout orchestration
    calculatePayouts,
    // mystery bounty
    mbSnap, distributeCounts,
    buildTiered, buildFlat, buildCustom,
  };
}));
