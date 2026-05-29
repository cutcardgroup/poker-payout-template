#!/usr/bin/env node
/**
 * End-to-end UI smoke test via JSDOM.
 *
 * Self-spawns a local static server on PORT (default 3100), loads
 * index.html and admin.html, simulates clicks/inputs, asserts on the
 * resulting DOM. Catches regressions that the pure-function suites in
 * test-payouts.js / test-bounty.js can't see — handler wiring, event
 * delegation, asset paths, CSP-incompatible patterns.
 *
 * Usage:
 *   npm run test:ui
 *
 * Requires devDependencies: jsdom, node-fetch@2.
 */

const { spawn } = require('child_process');
const path = require('path');
const { JSDOM } = require('jsdom');
const nodeFetch = require('node-fetch');

const PORT   = parseInt(process.env.PORT || '3100', 10);
const SERVER = `http://localhost:${PORT}`;
const ROOT   = path.join(__dirname, '..');

let failures = 0;
const log = (ok, name, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// ── Server lifecycle ─────────────────────────────────────────────────────────
// Spawn npx with detached:true so we get a process group. npx spawns
// node→serve as a child; signalling npx alone won't reach it. Killing
// the whole group via -proc.pid takes everyone down.
function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['serve', '.', '-p', String(PORT), '-L'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    let settled = false;
    const settle = (err) => { if (settled) return; settled = true; err ? reject(err) : resolve(proc); };
    proc.on('error', settle);
    proc.on('exit', code => {
      if (!settled) settle(new Error(`serve exited prematurely with code ${code}`));
    });
    // Poll until port responds; serve banner format isn't stable across versions.
    const deadline = Date.now() + 15000;
    (async function poll() {
      while (!settled && Date.now() < deadline) {
        try {
          const res = await nodeFetch(SERVER + '/').catch(() => null);
          if (res && res.status >= 200) { settle(); return; }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 200));
      }
      if (!settled) settle(new Error('server failed to start within 15s'));
    })();
  });
}

function killServer(proc) {
  if (!proc || proc.killed) return;
  try { process.kill(-proc.pid, 'SIGTERM'); } catch (_) {}
  // Force-kill any stragglers after a grace period.
  setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch (_) {} }, 1500).unref();
}

// Best-effort cleanup if the script crashes / is interrupted.
let _serverProc = null;
const _cleanup = () => killServer(_serverProc);
process.on('exit',     _cleanup);
process.on('SIGINT',  () => { _cleanup(); process.exit(130); });
process.on('SIGTERM', () => { _cleanup(); process.exit(143); });
process.on('uncaughtException', e => { console.error(e); _cleanup(); process.exit(2); });

// ── Page helpers ─────────────────────────────────────────────────────────────
async function loadPage(p) {
  const dom = await JSDOM.fromURL(`${SERVER}${p}`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    // JSDOM ships no fetch; the page uses it for loadTheme(). Inject before
    // <script> tags execute via beforeParse.
    beforeParse(window) {
      window.fetch = (url, opts) => {
        const abs = url.startsWith('http') ? url
          : SERVER + (url.startsWith('/') ? url : '/' + url);
        return nodeFetch(abs, opts);
      };
    },
  });
  dom.window.console.error = (...a) => console.error('[page]', ...a);
  await new Promise(r => {
    if (dom.window.document.readyState === 'complete') return r();
    dom.window.addEventListener('load', () => setTimeout(r, 100));
  });
  // Wait for async theme load: applyTheme() sets document.title with em-dash;
  // admin builds chip elements in #chips.
  const isAdmin = p.endsWith('admin.html');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (isAdmin) {
      if (dom.window.document.querySelectorAll('#chips .chip').length > 0) return dom;
    } else {
      if (dom.window.document.title.includes('—')) return dom;
    }
    await new Promise(r => setTimeout(r, 50));
  }
  return dom;
}

function setVal(input, val) {
  input.value = String(val);
  const w = input.ownerDocument.defaultView;
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  input.dispatchEvent(new w.Event('input',  { bubbles: true }));
}

function tblTotals(doc) {
  const tfootTds = doc.querySelectorAll('#tbl-inner tfoot td');
  if (tfootTds.length < 4) return { rows: 0, total: NaN };
  const trs = doc.querySelectorAll('#tbl-inner tbody tr');
  const totalMatch = tfootTds[3].textContent.match(/\$([\d,]+\.\d+)/);
  return {
    rows: trs.length,
    total: totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : NaN,
  };
}

// ── Test cases ───────────────────────────────────────────────────────────────
async function runTests() {
  // Case 1: 227 / $65,725 / $700 — CLAUDE.md golden case
  {
    const dom = await loadPage('/');
    const d = dom.window.document;
    setVal(d.getElementById('f-entries'), 227);
    setVal(d.getElementById('f-pool'),    65725);
    setVal(d.getElementById('f-mincash'), 700);
    d.getElementById('btn-calculate').click();
    await new Promise(r => setTimeout(r, 100));
    const { rows, total } = tblTotals(d);
    log(rows > 0, 'Case 1 table rendered', `${rows} rows`);
    log(Math.abs(total - 65725) < 0.5, 'Case 1 total=$65,725', `got $${total}`);
    log(d.querySelector('#tbl-inner tbody tr:first-child input[data-edit="prize"]') !== null,
      'Case 1 prize input uses data-edit attribute');
    dom.window.close();
  }

  // Case 2: + $17,500 guaranteed first
  {
    const dom = await loadPage('/');
    const w = dom.window, d = w.document;
    setVal(d.getElementById('f-entries'), 227);
    setVal(d.getElementById('f-pool'),    65725);
    setVal(d.getElementById('f-mincash'), 700);
    const gtype = d.getElementById('f-gtype');
    gtype.value = 'dollar';
    gtype.dispatchEvent(new w.Event('change', { bubbles: true }));
    setVal(d.getElementById('f-gval'), 17500);
    d.getElementById('btn-calculate').click();
    await new Promise(r => setTimeout(r, 100));
    const { total } = tblTotals(d);
    const firstVal = parseFloat(d.querySelector(
      '#tbl-inner tbody tr:first-child input[data-edit="prize"]'
    )?.value || '0');
    log(Math.abs(firstVal - 17500) < 0.5, 'Case 2 first=$17,500', `got $${firstVal}`);
    log(Math.abs(total   - 65725) < 0.5, 'Case 2 total=$65,725', `got $${total}`);
    dom.window.close();
  }

  // Case 3: 85 / $10,000 / $200
  {
    const dom = await loadPage('/');
    const d = dom.window.document;
    setVal(d.getElementById('f-entries'), 85);
    setVal(d.getElementById('f-pool'),    10000);
    setVal(d.getElementById('f-mincash'), 200);
    d.getElementById('btn-calculate').click();
    await new Promise(r => setTimeout(r, 100));
    const { rows, total } = tblTotals(d);
    log(rows >= 1, 'Case 3 table rendered', `${rows} rows`);
    log(Math.abs(total - 10000) < 0.5, 'Case 3 total=$10,000', `got $${total}`);
    dom.window.close();
  }

  // Case 4: rounding toggle
  {
    const dom = await loadPage('/');
    const d = dom.window.document;
    setVal(d.getElementById('f-entries'), 227);
    setVal(d.getElementById('f-pool'),    65725);
    setVal(d.getElementById('f-mincash'), 700);
    d.getElementById('btn-calculate').click();
    await new Promise(r => setTimeout(r, 100));
    const r50 = d.querySelector('button.rtog[data-v="50"]');
    r50.click();
    await new Promise(r => setTimeout(r, 100));
    log(r50.classList.contains('active'), 'Case 4 $50 button active after click');
    log(Math.abs(tblTotals(d).total - 65725) < 5, 'Case 4 total ≈ $65,725 after snap');
    dom.window.close();
  }

  // Case 5: edit prize via event delegation
  {
    const dom = await loadPage('/');
    const w = dom.window, d = w.document;
    setVal(d.getElementById('f-entries'), 227);
    setVal(d.getElementById('f-pool'),    65725);
    setVal(d.getElementById('f-mincash'), 700);
    d.getElementById('btn-calculate').click();
    await new Promise(r => setTimeout(r, 100));
    const input = d.querySelector('#tbl-inner tbody tr:first-child input[data-edit="prize"]');
    log(input !== null, 'Case 5 prize input found');
    if (input) {
      input.value = '20000';
      input.dispatchEvent(new w.Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      const after = d.querySelector('#tbl-inner tbody tr:first-child input[data-edit="prize"]');
      log(parseFloat(after.value) >= 19999,
        'Case 5 first prize updated to $20,000', `got $${after.value}`);
    }
    dom.window.close();
  }

  // Case 6: tab switch via data-tab
  {
    const dom = await loadPage('/');
    const d = dom.window.document;
    d.querySelector('[data-tab="bounty"]').click();
    await new Promise(r => setTimeout(r, 50));
    log(d.getElementById('tab-bounty').style.display !== 'none',
      'Case 6 bounty tab visible after data-tab click');
    dom.window.close();
  }

  // Case 7: MB tiered calculation
  {
    const dom = await loadPage('/');
    const d = dom.window.document;
    d.querySelector('[data-tab="bounty"]').click();
    await new Promise(r => setTimeout(r, 50));
    setVal(d.getElementById('mb-pool'), 5000);
    setVal(d.getElementById('mb-n'),    20);
    await new Promise(r => setTimeout(r, 200));
    const mainTable = d.querySelector('#mb-results > .tbl-wrap table');
    log(mainTable !== null, 'Case 7 main MB table rendered');
    const rows = mainTable ? mainTable.querySelectorAll('tbody tr') : [];
    log(rows.length > 0, 'Case 7 MB rows present', `${rows.length} rows`);
    let totalCount = 0;
    rows.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      const cv = tds[1]?.querySelector('input')?.value ?? tds[1]?.textContent;
      const n = parseInt(cv, 10);
      if (!isNaN(n)) totalCount += n;
    });
    log(totalCount === 20, 'Case 7 MB envelope count=20', `got ${totalCount}`);
    dom.window.close();
  }

  // Case 8: MB tier add/remove via delegated [data-action]
  {
    const dom = await loadPage('/');
    const d = dom.window.document;
    d.querySelector('[data-tab="bounty"]').click();
    await new Promise(r => setTimeout(r, 50));
    const before = d.querySelectorAll('#mb-tier-rows .mb-tier-row').length;
    const addBtn = d.querySelector('[data-action="add-mb-tier"]');
    log(addBtn !== null, 'Case 8 add-tier button exposed via data-action');
    if (addBtn) {
      addBtn.click();
      await new Promise(r => setTimeout(r, 100));
      log(d.querySelectorAll('#mb-tier-rows .mb-tier-row').length === before + 1,
        'Case 8 tier added');
      const removeBtn = d.querySelector('[data-action="remove-mb-tier"]');
      if (removeBtn) {
        removeBtn.click();
        await new Promise(r => setTimeout(r, 100));
        log(d.querySelectorAll('#mb-tier-rows .mb-tier-row').length === before,
          'Case 8 tier removed');
      }
    }
    dom.window.close();
  }

  // Case 9: admin.html bindings
  {
    const dom = await loadPage('/admin.html');
    const d = dom.window.document;
    log(d.getElementById('btn-preview')  !== null, 'Case 9 btn-preview exists');
    log(d.getElementById('btn-open-new') !== null, 'Case 9 btn-open-new exists');
    log(d.querySelectorAll('#chips .chip').length > 0, 'Case 9 chips rendered');
    dom.window.close();
  }

  // Case 10: stackedpoker cliff curve mode end-to-end (theme load → go → render)
  {
    const dom = await loadPage('/?club=stackedpoker');
    const d = dom.window.document;
    log(d.title.includes('Stacked'), 'Case 10 stackedpoker theme loaded', d.title);
    setVal(d.getElementById('f-entries'), 487);
    setVal(d.getElementById('f-pool'),    128160);
    setVal(d.getElementById('f-mincash'), 700);
    setVal(d.getElementById('f-places'),  ''); // clear override → auto 59 places (the case that showed ✗)
    d.getElementById('btn-calculate').click();
    await new Promise(r => setTimeout(r, 100));
    const { rows, total } = tblTotals(d);
    log(rows >= 12 && rows <= 22, 'Case 10 banded table rendered', `${rows} bands`);
    log(Math.abs(total - 128160) < 0.5, 'Case 10 total=$128,160 (full pool)', `got $${total}`);
    // 9→10 final-table wall: prizes are singles for places 1..10
    const prizes = [...d.querySelectorAll('#tbl-inner tbody tr input[data-edit="prize"]')]
      .map(i => parseFloat(i.value));
    const p9 = prizes[8], p10 = prizes[9], p8 = prizes[7];
    const wall = p9 / p10, inner = p8 / p9;
    log(wall > 1.20 && wall < 1.45, 'Case 10 9→10 wall present', `9/10=${wall.toFixed(3)}`);
    log(wall > inner, 'Case 10 9→10 jump bigger than 8→9', `${wall.toFixed(3)} > ${inner.toFixed(3)}`);
    // No ✗ in the Jump column — the gap-inversion bug surfaced here
    const xMarks = (d.getElementById('tbl-inner').textContent.match(/✗/g) || []).length;
    log(xMarks === 0, 'Case 10 no ✗ (gap inversions) in Jump column', `${xMarks} ✗`);
    // Setup panel reflects cliff params, not standard defaults
    log(d.getElementById('maxsame-display').textContent.trim() === '10', 'Case 10 identical-prizes shows 10 (cliff maxSame)', d.getElementById('maxsame-display').textContent);
    log(d.getElementById('s-mode').textContent.trim() === 'Cliff', 'Case 10 mode = Cliff', d.getElementById('s-mode').textContent);
    dom.window.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Starting dev server on :${PORT}…`);
  _serverProc = await startServer();
  console.log(`Server up. Running browser smoke tests.\n`);
  try {
    await runTests();
  } finally {
    killServer(_serverProc);
  }
  console.log('');
  if (failures === 0) {
    console.log('All UI smoke tests PASSED.');
  } else {
    console.log(`${failures} UI test(s) FAILED.`);
    process.exit(1);
  }
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
