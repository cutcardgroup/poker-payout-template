// ─────────────────────────────────────────────────────────
// PAYOUT TABLE  (pct = per-place %)
// ─────────────────────────────────────────────────────────
// PT is loaded from themes/default.json in loadTheme() — do not hardcode here
let PT=[], PT_PCT=0;  // PT_PCT>0 → per-placing mode (ceil(entries×PT_PCT/100))

// ─────────────────────────────────────────────────────────
// ENGINE BINDINGS — pure functions come from scripts/payout-engine.js
// (loaded above). State-coupled helpers (getStruct, snapDisplay) are
// thin wrappers that close over module-level state.
// ─────────────────────────────────────────────────────────
const _E = window.PayoutEngine;
const ordinal           = _E.ordinal;
const snapRound         = _E.snapRound;
const maxSameAuto       = _E.maxSameAuto;
const applyOverride     = _E.applyOverride;
const expandRows        = _E.expandRows;
const buildStandardNew  = _E.buildStandardNew;
const scaleUnlocked     = _E.scaleUnlocked;
const distributeCounts  = _E.distributeCounts;
const mbSnap            = _E.mbSnap;
const buildTiered       = _E.buildTiered;
const buildFlat         = _E.buildFlat;
const buildCustom       = _E.buildCustom;
function getStruct(n){ return _E.getStruct(n, PT, PT_PCT); }
function snapDisplay(rows, to){ return _E.snapDisplay(rows, to, POOL); }

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
let ROWS=[], POOL=0, MINCASH=0, ENTRIES=0, GFIRST=0, SNAP=0, MIN_FIRST_PCT=0, FT_SIZE=0;
let PAYOUT_MODE='standard';
let MAX_SAME=3;
let THEME={};

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────
const $=id=>document.getElementById(id);
const fmt=n=>'$'+n.toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});

// Grand totals using SNAP rounding (with gap-monotonicity enforcement)
function grandTotal(){ const sv=snapDisplay(ROWS,SNAP); return ROWS.reduce((s,r,i)=>s+sv[i]*r.count,0); }
function grandPct(){   return ROWS.reduce((s,r)=>s+(r.prize/POOL)*100*r.count,0); }
// When rounding is active use rounded prizes for % — reflects what actually gets paid
function displayPct(){ if(!SNAP) return grandPct(); const sv=snapDisplay(ROWS,SNAP); return ROWS.reduce((s,r,i)=>s+(sv[i]/POOL)*100*r.count,0); }

// ─────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────
function toggleG(){
  const t=$('f-gtype').value;
  $('g-field').style.display=t==='none'?'none':'block';
  $('g-lbl').textContent=t==='dollar'?'Amount ($)':'Percentage (%)';
  $('f-gval').placeholder=t==='dollar'?'e.g. 17500':'e.g. 30';
}

function setRound(v,el){
  SNAP=v;
  document.querySelectorAll('.rtog').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('custom-round-input').style.display='none';
  if(ROWS.length) go();
}

function toggleCustomRound(btn){
  const inp=document.getElementById('custom-round-input');
  const visible=inp.style.display!=='none';
  if(visible){ inp.style.display='none'; return; }
  inp.style.display='inline-block';
  inp.value='';
  inp.focus();
}

function applyCustomRound(inp){
  const v=parseInt(inp.value,10);
  if(!v||v<1){ inp.style.display='none'; return; }
  SNAP=v;
  document.querySelectorAll('.rtog').forEach(b=>b.classList.remove('active'));
  document.getElementById('rtog-custom').classList.add('active');
  document.getElementById('rtog-custom').textContent='$'+v;
  inp.style.display='none';
  if(ROWS.length) go();
}

function toggleMaxSame(){
  const f=document.getElementById('maxsame-fields');
  const open=f.style.display!=='none';
  f.style.display=open?'none':'block';
  document.getElementById('maxsame-summary').querySelector('span:last-child').textContent=open?'▾ adjust':'▴ adjust';
}

function updateMaxSameDisplay(){
  const entries=parseInt($('f-entries').value)||0;
  const auto=maxSameAuto(entries);
  const inp=document.getElementById('f-maxsame');
  if(!inp.dataset.manual) inp.value=auto;
  MAX_SAME=parseInt(inp.value)||auto;
  document.getElementById('maxsame-display').textContent=MAX_SAME;
}

function toggleRatios(){
  const f=document.getElementById('ratio-fields');
  const open=f.style.display!=='none';
  f.style.display=open?'none':'block';
  const s=document.getElementById('ratio-summary');
  s.querySelector('span:last-child').textContent=open?'▾ adjust':'▴ adjust';
}

function updateRatioDisplay(){
  const c12=parseFloat(document.getElementById('f-cap12').value)||1.45;
  const c23=parseFloat(document.getElementById('f-cap23').value)||1.30;
  const dc=parseFloat(document.getElementById('f-decay').value)||0.82;
  document.getElementById('ratio-display').textContent=c12.toFixed(2)+'× / '+c23.toFixed(2)+'× / '+dc.toFixed(2);
}

function setPayoutMode(mode){
  PAYOUT_MODE=mode;
  document.querySelectorAll('.ptog').forEach(b=>b.classList.remove('active'));
  document.getElementById('ptog-standard').classList.add('active');
  document.getElementById('stdnew-params').style.display='block';
}


// ─────────────────────────────────────────────────────────
// CALCULATE
// ─────────────────────────────────────────────────────────
// Thin DOM wrapper. All math is in scripts/payout-engine.js
// (PayoutEngine.calculatePayouts). The pass-by-pass implementation that
// used to live inline here moved to engine.js and is documented there;
// each named pass function in the engine corresponds to one of the
// `Pass N` comment blocks the old go() carried.
function go(){
  const entries=parseInt($('f-entries').value);
  const pool=parseFloat($('f-pool').value);
  const mc=parseFloat($('f-mincash').value)||0;
  if(!entries||entries<1||!pool||pool<1){alert('Please enter valid Entries and Prize Pool.');return;}

  const gtype=$('f-gtype').value;
  const gval=parseFloat($('f-gval').value)||0;
  const op=parseInt($('f-places').value)||0;

  let gfirst=0;
  if(gtype==='dollar'&&gval>0) gfirst=gval;
  if(gtype==='pct'&&gval>0) gfirst=(gval/100)*pool;

  const minFirstPct=parseFloat($('f-min-first-pct').value)||0;
  const ftSize=parseInt($('f-ft-size').value)||0;
  POOL=pool; MINCASH=mc; ENTRIES=entries; GFIRST=gfirst; MIN_FIRST_PCT=minFirstPct; FT_SIZE=ftSize;
  updateMaxSameDisplay();

  const cap12=parseFloat($('f-cap12').value)||1.45;
  const cap23=parseFloat($('f-cap23').value)||1.30;
  const decay=parseFloat($('f-decay').value)||0.82;

  const { rows } = _E.calculatePayouts({
    entries, pool, PT, PT_PCT,
    minCash: mc, guaranteedFirst: gfirst, minFirstPct, ftSize,
    snap: SNAP, maxSame: MAX_SAME,
    placesOverride: op,
    cap12, cap23, decay,
  });

  ROWS=rows;
  render(); renderFB(); updateStatus();
}

// ─────────────────────────────────────────────────────────
// LOCK BADGE — tooltip explains why a row is locked
// ─────────────────────────────────────────────────────────
function lockBadge(rowIdx, r){
  let tip;
  if(rowIdx===0 && GFIRST>0 && r.prize>=GFIRST-0.01){
    tip=`Guaranteed 1st place minimum of ${fmt(GFIRST)}`;
  } else if(rowIdx===0 && MIN_FIRST_PCT>0 && GFIRST===0 && r.prize>=(MIN_FIRST_PCT/100)*POOL-0.01){
    tip=`Min 1st place floor of ${MIN_FIRST_PCT}% (${fmt((MIN_FIRST_PCT/100)*POOL)})`;
  } else if(MINCASH>0 && r.prize<=MINCASH+0.01){
    tip=`Min cash floor — prize locked at ${fmt(MINCASH)}`;
  } else {
    tip='Manually locked';
  }
  return ` <span title="${tip}" style="cursor:help;font-size:.8em;">🔒</span>`;
}

function floorBadge(rawPrize){
  const tip=`At min cash via rounding — raw prize was ${fmt(rawPrize)}, which the $${SNAP} snap rounded down to ${fmt(MINCASH)}. Not locked — editing is unrestricted.`;
  return ` <span title="${tip}" style="cursor:help;font-size:.8em;">🔽</span>`;
}

// ─────────────────────────────────────────────────────────
// RENDER TABLE
// ─────────────────────────────────────────────────────────
function render(){
  const expand=$('f-expand').checked;
  const displayRows=expand ? expandRows(ROWS) : ROWS;

  // Pre-compute monotone-enforced snap values (indexed by ROWS)
  const snapVals=snapDisplay(ROWS,SNAP);
  // Helper: map a displayRows index back to its ROWS index
  function snapOf(i){
    if(!expand) return snapVals[i];
    let pos=0;
    for(let ri=0;ri<ROWS.length;ri++){
      if(i<pos+ROWS[ri].count) return snapVals[ri];
      pos+=ROWS[ri].count;
    }
    return snapVals[snapVals.length-1];
  }

  const tot=grandTotal();
  const totp=displayPct();
  const pOk=Math.abs(totp-100)<0.01;
  const exactPool=ROWS.reduce((s,r)=>s+r.prize*r.count,0);
  const roundedTotal=ROWS.reduce((s,r,i)=>s+snapVals[i]*r.count,0);
  const drift=roundedTotal-POOL;
  const driftOk=Math.abs(drift)<0.01;

  // Pre-compute jumps (difference in per-player prize from row below)
  const jumps=displayRows.map((r,i)=>{
    if(i>=displayRows.length-1) return null;
    const thisP=SNAP?snapOf(i):r.prize;
    const nextP=SNAP?snapOf(i+1):displayRows[i+1].prize;
    return thisP-nextP;
  });
  // Check each jump: unlocked gaps should decrease going down, locked gaps should increase going up
  const jumpOk=jumps.map((j,i)=>{
    if(j===null) return null;
    if(j<-0.01) return false; // inversion — prize below is higher
    if(i>=jumps.length-1||jumps[i+1]===null) return true; // bottom-most gap, nothing to compare
    const nextJ=jumps[i+1];
    if(nextJ===null) return true;
    return j>nextJ-0.01; // this gap should be >= gap below (strictly for unlocked, or equal OK at boundary)
  });

  let h=`<table><thead><tr>
    <th>Position</th>
    <th class="r">% each</th>
    <th class="r">Prize each</th>
    <th class="r">Row total</th>
    <th class="r">Jump</th>
  </tr></thead><tbody>`;

  displayRows.forEach((r,i)=>{
    // Map display row index back to ROWS bracket index + position within bracket
    let editIdx=i, withinIdx=0;
    if(expand){
      let pos=0;
      for(let ri=0;ri<ROWS.length;ri++){
        if(i<pos+ROWS[ri].count){ editIdx=ri; withinIdx=i-pos; break; }
        pos+=ROWS[ri].count;
      }
    }
    // When a bracket has multiple places in expanded view, the change handler
    // splits the bracket via editPctAt/editPrizeAt; otherwise it edits the
    // bracket directly via editPct/editPrize. Event delegation on #tbl-inner
    // reads these data-* attributes (see setupEventHandlers).
    const needSplit=expand&&ROWS[editIdx].count>1;
    const splitAttr=needSplit?` data-split="1" data-within="${withinIdx}"`:'';

    const rawPrize=r.prize;
    const dispPrize=SNAP?snapOf(i):rawPrize;
    const isPinned=SNAP&&ROWS[editIdx].pinSnap;
    const pEach=(rawPrize/POOL*100).toFixed(3);
    const low=(MINCASH>0&&rawPrize<MINCASH-0.01)
      ?'<span style="background:var(--red);color:#fff;font-size:.55rem;padding:1px 4px;border-radius:3px;margin-left:3px;">LOW</span>':'';
    const atSnappedFloor=!r.locked&&MINCASH>0&&SNAP>0&&Math.abs(dispPrize-MINCASH)<0.01&&rawPrize>MINCASH-0.01;

    h+=`<tr>
      <td class="pos">${r.label}${r.locked?lockBadge(editIdx,r):atSnappedFloor?floorBadge(rawPrize):''}</td>
      <td class="r"><input class="w75" type="number" step="0.001" value="${pEach}" data-edit="pct" data-idx="${editIdx}"${splitAttr}></td>
      <td class="r"><input class="w100" type="number" step="${isPinned?1:(SNAP||1)}" value="${dispPrize%1?dispPrize.toFixed(2):dispPrize.toFixed(0)}" data-edit="prize" data-idx="${editIdx}"${splitAttr}>${low}</td>
      <td class="r rt">${fmt(dispPrize*r.count)}${r.count>1?`<br><span style="font-size:.65rem;color:var(--dim);">×${r.count}</span>`:''}</td>
      <td class="r" style="font-size:.75rem;color:var(--dim);">${jumps[i]===null?'—':`${fmt(jumps[i])} ${jumpOk[i]?'<span style="color:var(--green3);">✓</span>':'<span style="color:var(--red);">✗</span>'}`}</td>
    </tr>`;
  });

  const mOk=Math.abs(tot-POOL)<1;
  h+=`</tbody><tfoot><tr>
    <td style="color:var(--dim);font-size:.75rem;">TOTALS</td>
    <td class="r" style="color:${pOk?'var(--green3)':'var(--red)'};">${totp.toFixed(2)}%</td>
    <td class="r" style="color:${pOk?'var(--green3)':'var(--red)'};">${pOk?'✓ 100%':'⚠ ≠ 100%'}</td>
    <td class="r" style="color:${mOk?'var(--green3)':'var(--amber)'};">${fmt(tot)} ${mOk?'✓':'⚠'}</td>
    <td></td>
  </tr></tfoot></table>`;


  $('tbl-inner').innerHTML=h;
}

function editPct(i,v){
  const p=parseFloat(v); if(isNaN(p)||p<0)return;
  ROWS[i].prize=(p/100)*POOL; ROWS[i].locked=false; ROWS[i].pinSnap=!!SNAP;
  render(); renderFB(); updateStatus();
}
function editPrize(i,v){
  const p=parseFloat(v); if(isNaN(p)||p<0)return;
  ROWS[i].prize=p; ROWS[i].locked=false; ROWS[i].pinSnap=!!SNAP;
  render(); renderFB(); updateStatus();
}

// Edit a specific place within a grouped bracket (expanded view).
// Splits the bracket into up to 3 slices: before / edited / after.
function editPrizeAt(bracketIdx,withinIdx,val){
  const p=parseFloat(val); if(isNaN(p)||p<0)return;
  const b=ROWS[bracketIdx];
  if(b.count===1){ b.prize=p; b.locked=false; b.pinSnap=!!SNAP; }
  else {
    // 1-indexed position of the first place in this bracket
    let startPos=1;
    for(let x=0;x<bracketIdx;x++) startPos+=ROWS[x].count;
    const split=[];
    // Slice before the edited place
    if(withinIdx>0){
      const s=startPos, e=startPos+withinIdx-1;
      split.push({label:withinIdx===1?ordinal(s):`${ordinal(s)}-${ordinal(e)}`,count:withinIdx,prize:b.prize,locked:b.locked});
    }
    // The individually edited place
    split.push({label:ordinal(startPos+withinIdx),count:1,prize:p,locked:false,pinSnap:!!SNAP});
    // Slice after the edited place
    const afterCount=b.count-withinIdx-1;
    if(afterCount>0){
      const s=startPos+withinIdx+1, e=startPos+b.count-1;
      split.push({label:afterCount===1?ordinal(s):`${ordinal(s)}-${ordinal(e)}`,count:afterCount,prize:b.prize,locked:b.locked});
    }
    ROWS.splice(bracketIdx,1,...split);
  }
  render(); renderFB(); updateStatus();
}
function editPctAt(bracketIdx,withinIdx,val){
  const p=parseFloat(val); if(isNaN(p)||p<0)return;
  editPrizeAt(bracketIdx,withinIdx,(p/100)*POOL);
}

// ─────────────────────────────────────────────────────────
// STATUS BAR
// ─────────────────────────────────────────────────────────
function updateStatus(){
  $('status-bar').style.display='block';
  const places=ROWS.reduce((s,r)=>s+r.count,0);
  const totp=displayPct();
  const tot=grandTotal();
  const pOk=Math.abs(totp-100)<0.01;
  const mOk=Math.abs(tot-POOL)<1;

  $('s-places').textContent=places;
  $('s-field').textContent=ENTRIES>0?(places/ENTRIES*100).toFixed(1)+'%':'—';
  $('s-pct').textContent=(pOk?'✓ ':'⚠ ')+totp.toFixed(2)+'%';
  $('s-pct').className='sv '+(pOk?'ok':'bad');
  $('s-prize').textContent=(mOk?'✓ ':'⚠ ')+fmt(tot);
  $('s-prize').className='sv '+(mOk?'ok':'warn');

  const last=ROWS[ROWS.length-1];
  if(!MINCASH){$('s-min').textContent='Not set';$('s-min').className='sv';}
  else{
    const allLocked=ROWS.every(r=>r.locked);
    if(allLocked){
      const places=ROWS.reduce((s,r)=>s+r.count,0);
      const maxMC=Math.floor(POOL/places);
      $('s-min').textContent=`⚠ Too high — reduce below ${fmt(maxMC)}`;
      $('s-min').className='sv bad';
    } else {
      const ok=last.prize>=MINCASH-0.01;
      $('s-min').textContent=(ok?'✓ ':'⚠ ')+fmt(snapRound(last.prize,SNAP));
      $('s-min').className='sv '+(ok?'ok':'bad');
    }
  }

  if(GFIRST>0){
    $('s-g-wrap').style.display='flex';
    const ok=ROWS[0].prize>=GFIRST-0.01;
    $('s-g').textContent=(ok?'✓ ':'⚠ ')+fmt(snapRound(ROWS[0].prize,SNAP));
    $('s-g').className='sv '+(ok?'ok':'bad');
  } else {
    $('s-g-wrap').style.display='none';
  }

  $('s-mode').textContent='Standard';

  if(SNAP){
    const sv=snapDisplay(ROWS,SNAP);
    const drift=ROWS.reduce((s,r,i)=>s+sv[i]*r.count,0)-POOL;
    $('s-round-wrap').style.display='flex';
    const dOk=Math.abs(drift)<0.01;
    const sign=drift>=0?'+':'';
    $('s-round').textContent=(dOk?'✓ ':'⚠ ')+sign+fmt(drift);
    $('s-round').className='sv '+(Math.abs(drift)<0.01?'ok':'warn');
  } else {
    $('s-round-wrap').style.display='none';
  }
}

// ─────────────────────────────────────────────────────────
// FACEBOOK
// ─────────────────────────────────────────────────────────
function renderFB(){
  const expand=$('f-expand').checked;
  const displayRows=expand ? expandRows(ROWS) : ROWS;
  const snapVals=snapDisplay(ROWS,SNAP);
  function fbSnapOf(i){
    if(!expand) return snapVals[i];
    let pos=0;
    for(let ri=0;ri<ROWS.length;ri++){
      if(i<pos+ROWS[ri].count) return snapVals[ri];
      pos+=ROWS[ri].count;
    }
    return snapVals[snapVals.length-1];
  }
  const fbHeader=THEME.fbHeader||'🃏 TOURNAMENT PAYOUT STRUCTURE 🃏';
  const fbFooter=THEME.fbFooter||'Good luck at the tables! 🎰';
  const lines=[
    fbHeader,
    `Entries: ${ENTRIES}  |  Prize Pool: ${fmt(POOL)}`,
    `Structure: Standard`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  ];
  displayRows.forEach((r,i)=>lines.push(`${r.label.padEnd(16)}${fmt(fbSnapOf(i))}`));
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(fbFooter);
  $('fb-out').textContent=lines.join('\n');
}

function copyFB(){
  navigator.clipboard.writeText($('fb-out').textContent).then(()=>{
    $('toast').style.display='inline-block';
    setTimeout(()=>{$('toast').style.display='none';},2000);
  });
}

// ─────────────────────────────────────────────────────────
// THEME SYSTEM
// ─────────────────────────────────────────────────────────
async function loadTheme(){
  const params=new URLSearchParams(window.location.search);
  const raw=params.get('club')||'default';
  // Whitelist: lowercase alnum, dash, underscore, max 32 chars. Blocks path
  // traversal and protocol-relative payloads via fetch URL templating.
  const club=(raw.match(/^[a-z0-9_-]{1,32}$/i)?raw:'default');

  // Fetch both themes in parallel so they can be applied back-to-back
  // with no intermediate repaint (eliminates flash of default branding).
  const fetchJson=async url=>{try{const r=await fetch(url);return r.ok?await r.json():null;}catch(_){return null;}};
  const [defaultTheme,clubTheme]=await Promise.all([
    fetchJson('themes/default.json'),
    club!=='default'?fetchJson(`themes/${club}.json`):Promise.resolve(null)
  ]);

  if(defaultTheme) applyTheme(defaultTheme);
  if(clubTheme)    applyTheme(clubTheme);
}

function applyTheme(theme){
  THEME=theme;
  const root=document.documentElement;

  // Colors: each key maps directly to --key CSS variable
  Object.entries(theme.colors||{}).forEach(([k,v])=>{
    root.style.setProperty(`--${k}`,v);
  });

  // Logo — only accept same-origin relative paths under logos/ or themes/.
  // Blocks javascript:, data:, http(s):, protocol-relative, and traversal.
  if(theme.logo && typeof theme.logo==='string' && theme.logo.length<=512
     && !/^[a-z]+:/i.test(theme.logo)
     && !theme.logo.startsWith('//') && !theme.logo.startsWith('/')
     && !theme.logo.includes('..')
     && /^(logos|themes)\//.test(theme.logo)){
    const img=$('hdr-logo');
    img.src=theme.logo;
    img.alt=theme.name||'';
    img.style.display='block';
    $('hdr-suit').style.display='none';
  }

  // Operator name
  if(theme.name){
    $('hdr-title').textContent=theme.name;
    document.title=theme.name+' — Payout Calculator';
  }

  // Example placeholders + default snap
  if(theme.fontFamily){
    const existing=document.getElementById('theme-font-link');
    if(existing) existing.remove();
    const link=document.createElement('link');
    link.id='theme-font-link';
    link.rel='stylesheet';
    link.href='https://fonts.googleapis.com/css2?family='+encodeURIComponent(theme.fontFamily)+':wght@300;400;500;700&display=swap';
    document.head.appendChild(link);
    document.documentElement.style.setProperty('--font-body',`'${theme.fontFamily}'`);
    document.documentElement.style.setProperty('--font-display',`'${theme.fontFamily}'`);
  }

  if(theme.examples){
    const ex=theme.examples;
    if(ex.entries)  $('f-entries').placeholder='e.g. '+ex.entries;
    if(ex.pool)     $('f-pool').placeholder='e.g. '+ex.pool;
    if(ex.minCash)  $('f-mincash').placeholder='e.g. '+ex.minCash;
    if(ex.ftSize!=null) $('f-ft-size').value=ex.ftSize;
    if(ex.minFirstPct!=null) $('f-min-first-pct').value=ex.minFirstPct;
    if(ex.cap12!=null){ $('f-cap12').value=ex.cap12; updateRatioDisplay(); }
    if(ex.cap23!=null){ $('f-cap23').value=ex.cap23; updateRatioDisplay(); }
    if(ex.decay!=null){ $('f-decay').value=ex.decay; updateRatioDisplay(); }
    if(ex.snap!=null){
      const btn=document.querySelector('.rtog[data-v="'+ex.snap+'"]');
      if(btn) setRound(ex.snap,btn);
      else { SNAP=ex.snap; document.querySelectorAll('.rtog').forEach(b=>b.classList.remove('active')); const cb=document.getElementById('rtog-custom'); cb.classList.add('active'); cb.textContent='$'+ex.snap; }
    }
  }

  // Custom payout table — two formats:
  //   range-based:    [{min, max, rows}]  → range lookup by entry count
  //   per-placing:    [{places, rows}]    → lookup by ceil(entries × payoutPct/100)
  if(Array.isArray(theme.payoutTable)){
    if(theme.payoutPct && theme.payoutTable[0]?.places!==undefined){
      PT_PCT=theme.payoutPct;
      PT=theme.payoutTable.map(b=>[b.places,b.rows]);
    }else{
      PT_PCT=0;
      PT=theme.payoutTable.map(b=>[b.min,b.max,b.rows]);
    }
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  loadTheme();
  initMB();
  setupEventHandlers();
});

// ─────────────────────────────────────────────────────────
// EVENT WIRING
// All static elements get id- or selector-targeted listeners here.
// Dynamic elements (rendered into #tbl-inner, #mb-results, #mb-tier-rows,
// #mb-custom-rows) use event delegation reading data-* attributes set by
// the corresponding render functions.
// ─────────────────────────────────────────────────────────
function setupEventHandlers(){
  // — Tab strip —
  document.querySelector('.tab-strip').addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (btn) switchTab(btn.dataset.tab);
  });

  // — Top setup inputs —
  $('f-entries').addEventListener('change', updateMaxSameDisplay);

  // — Payout structure (Standard is the only mode now) —
  $('ptog-standard').addEventListener('click', () => setPayoutMode('standard'));

  // — Ratio summary + inputs —
  $('ratio-summary').addEventListener('click', toggleRatios);
  ['f-cap12','f-cap23','f-decay'].forEach(id => {
    $(id).addEventListener('change', () => {
      updateRatioDisplay();
      if (ROWS.length) go();
    });
  });

  // — Max same toggle + input —
  $('maxsame-summary').addEventListener('click', toggleMaxSame);
  $('f-maxsame').addEventListener('change', function(){
    this.dataset.manual = '1';
    updateMaxSameDisplay();
    if (ROWS.length) go();
  });

  // — Guaranteed-first type selector —
  $('f-gtype').addEventListener('change', toggleG);

  // — Rounding toggles —
  $('rtog-row').addEventListener('click', e => {
    const btn = e.target.closest('button.rtog');
    if (!btn) return;
    if (btn.id === 'rtog-custom') { toggleCustomRound(btn); return; }
    setRound(parseInt(btn.dataset.v, 10) || 0, btn);
  });
  const customRoundInput = $('custom-round-input');
  customRoundInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') applyCustomRound(customRoundInput);
  });
  customRoundInput.addEventListener('blur', () => applyCustomRound(customRoundInput));

  // — Expand checkbox —
  $('f-expand').addEventListener('change', () => {
    if (ROWS.length) { render(); renderFB(); updateStatus(); }
  });

  // — Action buttons —
  $('btn-calculate').addEventListener('click', go);
  $('btn-reset').addEventListener('click', go);
  $('btn-copy-fb').addEventListener('click', copyFB);

  // — Payout table inputs (dynamic, in #tbl-inner) —
  $('tbl-inner').addEventListener('change', e => {
    const inp = e.target.closest('input[data-edit]');
    if (!inp) return;
    const idx = parseInt(inp.dataset.idx, 10);
    const field = inp.dataset.edit;
    const split = inp.dataset.split === '1';
    const within = split ? parseInt(inp.dataset.within, 10) : 0;
    if (field === 'pct') {
      if (split) editPctAt(idx, within, inp.value);
      else       editPct(idx, inp.value);
    } else if (field === 'prize') {
      if (split) editPrizeAt(idx, within, inp.value);
      else       editPrize(idx, inp.value);
    }
  });

  // — Mystery bounty top-level inputs —
  ['mb-pool','mb-n','mb-min','mb-zeros'].forEach(id => {
    $(id).addEventListener('input', calcMB);
  });
  $('mb-top').addEventListener('input', () => { renderTierControls(); calcMB(); });

  // — MB snap toggles —
  $('mb-snap-row').addEventListener('click', e => {
    const btn = e.target.closest('button[data-mbsnap]');
    if (btn) setMBSnap(parseInt(btn.dataset.mbsnap, 10), btn);
  });

  // — MB mode toggles —
  $('mb-mode-row').addEventListener('click', e => {
    const btn = e.target.closest('button[data-mbmode]');
    if (btn) setMBMode(btn.dataset.mbmode);
  });

  // — MB tier rows (dynamic, in #mb-tier-rows) —
  const tierRows = $('mb-tier-rows');
  tierRows.addEventListener('input', e => {
    const inp = e.target.closest('input[data-tier-idx]');
    if (!inp) return;
    const i = parseInt(inp.dataset.tierIdx, 10);
    MB_TIERS[i][inp.dataset.tierField] = +inp.value;
    calcMB();
  });
  tierRows.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'add-mb-tier') addMBTier();
    else if (btn.dataset.action === 'remove-mb-tier') removeMBTier(parseInt(btn.dataset.tierIdx, 10));
  });

  // — MB custom rows (dynamic, in #mb-custom-rows) —
  const customRows = $('mb-custom-rows');
  customRows.addEventListener('input', e => {
    const inp = e.target.closest('input[data-custom-idx]');
    if (!inp) return;
    const i = parseInt(inp.dataset.customIdx, 10);
    MB_CUSTOM[i][inp.dataset.customField] = +inp.value;
    calcMB();
  });
  customRows.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action="remove-mb-custom"]');
    if (btn) removeMBCustomRow(parseInt(btn.dataset.customIdx, 10));
  });
  $('btn-add-mb-custom').addEventListener('click', addMBCustomRow);

  // — MB results table inputs (dynamic, in #mb-results) —
  $('mb-results').addEventListener('change', e => {
    const inp = e.target.closest('input[data-mb-idx]');
    if (!inp) return;
    const i = parseInt(inp.dataset.mbIdx, 10);
    if (inp.dataset.mbField === 'count')      editMBCount(i, +inp.value);
    else if (inp.dataset.mbField === 'prize') editMBPrize(i, +inp.value);
  });
}

// ─────────────────────────────────────────────────────────
// TAB SWITCHING
// ─────────────────────────────────────────────────────────
function switchTab(tab){
  document.getElementById('tab-payout').style.display=tab==='payout'?'':'none';
  document.getElementById('tab-bounty').style.display=tab==='bounty'?'':'none';
  document.querySelectorAll('.tab-btn').forEach((b,i)=>b.classList.toggle('active',(tab==='payout'&&i===0)||(tab==='bounty'&&i===1)));
}

// ─────────────────────────────────────────────────────────
// MYSTERY BOUNTY STATE
// ─────────────────────────────────────────────────────────
let MB_SNAP=50;
let MB_MODE='tiered';
const MB_TIER_LABELS=['Top Bounty','Tier 2','Tier 3','Tier 4'];
let MB_TIERS=[
  {pct:10,mult:30},
  {pct:15,mult:12},
  {pct:25,mult:4},
  {pct:50,mult:1},
];
let MB_CUSTOM=[];
let MB_POOL=0,MB_N=0,MB_ROWS=[],MB_CONFIG={};

function setMBSnap(v,btn){
  MB_SNAP=v;
  document.querySelectorAll('[data-mbsnap]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  calcMB();
}

function setMBMode(mode){
  MB_MODE=mode;
  document.querySelectorAll('.mb-mode-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('mb-mode-'+mode).classList.add('active');
  document.getElementById('mb-tiered-settings').style.display=mode==='tiered'?'':'none';
  document.getElementById('mb-custom-settings').style.display=mode==='custom'?'':'none';
  calcMB();
}

// ─────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────
function initMB(){
  renderTierControls();
  if(MB_CUSTOM.length===0) MB_CUSTOM=[{count:'',value:''},{count:'',value:''}];
  renderCustomControls();
}

function renderTierControls(){
  const container=document.getElementById('mb-tier-rows');
  const lShift=(parseFloat(document.getElementById('mb-top')?.value)||0)>0?1:0;
  container.innerHTML=MB_TIERS.map((t,i)=>`
    <div class="mb-tier-row">
      <span class="mb-tier-lbl">${MB_TIER_LABELS[i+lShift]||'Tier '+(i+1+lShift)}</span>
      <div><label class="lbl" style="font-size:.6rem;">Weight</label>
        <input type="number" min="1" max="99" value="${t.pct}" data-tier-idx="${i}" data-tier-field="pct"></div>
      <div><label class="lbl" style="font-size:.6rem;">Multiplier ×</label>
        <input type="number" min="0.1" step="0.5" value="${t.mult}" data-tier-idx="${i}" data-tier-field="mult"></div>
      <div style="padding-top:18px;">${MB_TIERS.length>2?`<button class="btn btn-ghost" style="padding:4px 8px;font-size:.7rem;" data-action="remove-mb-tier" data-tier-idx="${i}">✕</button>`:''}</div>
    </div>`).join('')+
    `<button class="btn btn-ghost" style="font-size:.8rem;padding:6px 12px;margin-top:4px;" data-action="add-mb-tier">+ Add Tier</button>`;
}

function addMBTier(){
  // Add a new smallest tier at the bottom (half the current bottom's multiplier, min 0.5)
  MB_TIERS.push({pct:10,mult:Math.max(0.5,MB_TIERS[MB_TIERS.length-1].mult/2)});
  renderTierControls();calcMB();
}
function removeMBTier(i){MB_TIERS.splice(i,1);renderTierControls();calcMB();}

function renderCustomControls(){
  const container=document.getElementById('mb-custom-rows');
  container.innerHTML=MB_CUSTOM.map((r,i)=>`
    <div class="mb-custom-row">
      <div><label class="lbl" style="font-size:.6rem;">Count</label>
        <input type="number" min="1" value="${r.count}" placeholder="e.g. 10" data-custom-idx="${i}" data-custom-field="count"></div>
      <div><label class="lbl" style="font-size:.6rem;">Prize ($)</label>
        <input type="number" min="0" value="${r.value}" placeholder="e.g. 100" data-custom-idx="${i}" data-custom-field="value"></div>
      <div style="padding-top:18px;">${MB_CUSTOM.length>1?`<button class="btn btn-ghost" style="padding:4px 8px;font-size:.7rem;" data-action="remove-mb-custom" data-custom-idx="${i}">✕</button>`:''}</div>
    </div>`).join('');
}
function addMBCustomRow(){MB_CUSTOM.push({count:'',value:''});renderCustomControls();calcMB();}
function removeMBCustomRow(i){MB_CUSTOM.splice(i,1);renderCustomControls();calcMB();}

// ─────────────────────────────────────────────────────────
// CALCULATION
// ─────────────────────────────────────────────────────────
// Engine fns (mbSnap, distributeCounts, buildTiered, buildFlat, buildCustom)
// are bound at top of script from window.PayoutEngine. buildTiered() in the
// engine accepts an optional labels[] arg — pass MB_TIER_LABELS shifted by
// topBounty presence so result rows carry correct tierLabel strings.

function calcMB(){
  const pool=parseFloat(document.getElementById('mb-pool').value)||0;
  const n=parseInt(document.getElementById('mb-n').value)||0;
  const topBounty=parseFloat(document.getElementById('mb-top').value)||0;
  const minBounty=parseFloat(document.getElementById('mb-min').value)||0;
  const zeros=parseInt(document.getElementById('mb-zeros').value)||0;
  if(!pool||!n){document.getElementById('mb-results-wrap').style.display='none';return;}

  MB_CONFIG={mode:MB_MODE,snap:MB_SNAP,zeros,topBounty,minBounty,
    tierSettings:MB_MODE==='tiered'?MB_TIERS.map((t,i)=>{const ls=topBounty>0?1:0;return{...t,label:MB_TIER_LABELS[i+ls]||'Tier '+(i+1+ls)};}):null};

  let tiers=[];
  if(MB_MODE==='tiered'){
    const lShift=topBounty>0?1:0;
    const labels=MB_TIERS.map((_,i)=>MB_TIER_LABELS[i+lShift]||'Tier '+(i+1+lShift));
    tiers=buildTiered(pool,n,zeros,topBounty,MB_TIERS,MB_SNAP,minBounty,labels);
  } else if(MB_MODE==='flat') tiers=buildFlat(pool,n,zeros,topBounty,MB_SNAP,minBounty);
  else {renderMBCustomValidation(pool,n,zeros,topBounty);return;}

  MB_ROWS=tiers; MB_POOL=pool; MB_N=n;
  _renderMBResults();
}

function renderMBCustomValidation(pool,n,zeros,topBounty){
  MB_CONFIG={mode:'custom',snap:MB_SNAP,zeros,topBounty,minBounty:0,tierSettings:null};
  const cv=buildCustom(pool,n,zeros,topBounty,MB_CUSTOM);
  const el=document.getElementById('mb-custom-validation');
  const countOk=cv.totalCount===n;
  const valOk=Math.abs(cv.totalVal-pool)<1;
  el.innerHTML=`<span style="color:${countOk?'var(--green3)':'var(--red)'};">Envelopes: ${cv.totalCount} / ${n}</span>&nbsp;&nbsp;`+
    `<span style="color:${valOk?'var(--green3)':'var(--red)'};">Pool: ${fmtMB(cv.totalVal)} / ${fmtMB(pool)}</span>`;
  if(cv.valid){
    MB_ROWS=[...cv.rows.slice().reverse().map(r=>({count:r.count,value:r.value})),...(topBounty>0?[{count:1,value:topBounty,isTop:true}]:[]),...(zeros>0?[{count:zeros,value:0,isZero:true}]:[])];
    MB_POOL=pool; MB_N=n; _renderMBResults();
  } else document.getElementById('mb-results-wrap').style.display='none';
}

function fmtMB(n){return '$'+Math.round(n).toLocaleString('en-AU');}
function pct(v,total){return total>0?(v/total*100).toFixed(1)+'%':'—';}

function _renderMBResults(){
  const tiers=MB_ROWS,pool=MB_POOL,n=MB_N;
  const wrap=document.getElementById('mb-results-wrap');
  const el=document.getElementById('mb-results');
  if(!tiers||tiers.length===0){wrap.style.display='none';return;}
  wrap.style.display='';

  const totalCount=tiers.reduce((s,t)=>s+t.count,0);
  const totalVal=tiers.reduce((s,t)=>s+t.count*t.value,0);
  const poolOk=Math.abs(totalVal-pool)<1;
  const countOk=totalCount===n;
  const avgEV=pool/n;

  let h=`<div class="tbl-wrap"><table>
    <thead><tr>
      <th>Tier</th><th class="r">Count</th><th class="r">Prize each</th>
      <th class="r">Probability</th><th class="r">EV per elim</th>
    </tr></thead><tbody>`;

  tiers.forEach((t,i)=>{
    const label=t.isTop?'🏆 Top Bounty':t.isZero?'💀 Blank':t.tierLabel||'●';
    const prob=t.count/n;
    const ev=prob*t.value;
    const countCell=(t.isTop||t.isZero)
      ?t.count
      :`<input class="w75" type="number" min="0" step="1" value="${t.count}" data-mb-idx="${i}" data-mb-field="count">`;
    const prizeCell=t.isZero
      ?'<span style="color:var(--dim);">$0</span>'
      :`<input class="w100" type="number" step="${MB_SNAP||1}" value="${Math.round(t.value)}" data-mb-idx="${i}" data-mb-field="prize">`;
    h+=`<tr>
      <td><span class="mb-tier-label">${label}</span></td>
      <td class="r">${countCell}</td>
      <td class="r" style="font-family:'Source Code Pro',monospace;">${prizeCell}</td>
      <td id="mb-prob-${i}" class="r" style="color:var(--dim);font-family:'Source Code Pro',monospace;">${pct(t.count,n)}</td>
      <td id="mb-ev-${i}" class="r" style="font-family:'Source Code Pro',monospace;">${fmtMB(ev)}</td>
    </tr>`;
  });

  h+=`</tbody><tfoot><tr>
    <td>TOTAL</td>
    <td id="mb-fc" class="r" style="color:${countOk?'var(--green3)':'var(--red)'};">${totalCount} ${countOk?'✓':'✗'}</td>
    <td id="mb-fv" class="r" style="color:${poolOk?'var(--green3)':'var(--red)'};">${fmtMB(totalVal)} ${poolOk?'✓':'✗'}</td>
    <td class="r" style="color:var(--dim);">—</td>
    <td class="r" style="color:var(--gold2);font-family:'Source Code Pro',monospace;">avg ${fmtMB(avgEV)}</td>
  </tr></tfoot></table></div>`;

  h+=`<div id="mb-config-section">${_buildConfigHTML()}</div>`;
  el.innerHTML=h;
}

function _buildConfigHTML(){
  const c=MB_CONFIG;
  if(!c.mode) return '';
  const topRow=MB_ROWS.find(t=>t.isTop);
  const regularTiers=MB_ROWS.filter(t=>!t.isTop&&!t.isZero);
  if(!regularTiers.length&&!topRow) return '';

  const parts=[];
  if(c.snap) parts.push(`Snap ${fmtMB(c.snap)}`);
  if(c.minBounty) parts.push(`Min ${fmtMB(c.minBounty)}`);
  if(c.zeros) parts.push(`Blanks ${c.zeros}`);
  const meta=parts.length?` · ${parts.join(' · ')}`:'';

  // Back-calculate weight (= count) and multiplier (= prize / lowest prize)
  // so these values can be typed back into Tier Settings to reproduce this distribution.
  const prizes=regularTiers.map(t=>t.value).filter(v=>v>0);
  const basePrize=prizes.length?Math.min(...prizes):0;

  let h=`<div style="margin-top:16px;border-top:2px solid var(--border);padding-top:12px;">
    <div style="font-size:.6rem;text-transform:uppercase;letter-spacing:1.2px;color:var(--dim);margin-bottom:6px;">Distribution summary${meta}</div>
    <div class="tbl-wrap"><table style="width:auto;">
      <thead><tr>
        <th>Tier</th><th class="r">Weight</th><th class="r">Multiplier</th>
        <th class="r">Count</th><th class="r">Prize each</th>
      </tr></thead><tbody>`;

  if(topRow){
    h+=`<tr>
      <td><span class="mb-tier-label">🏆 Top Bounty</span></td>
      <td class="r" style="color:var(--dim);">—</td><td class="r" style="color:var(--dim);">—</td>
      <td class="r">1</td>
      <td class="r" style="font-family:'Source Code Pro',monospace;">${fmtMB(topRow.value)}</td>
    </tr>`;
  }

  regularTiers.forEach(t=>{
    const mult=basePrize>0?Math.round(t.value/basePrize*100)/100:0;
    h+=`<tr>
      <td><span class="mb-tier-label">${t.tierLabel||'●'}</span></td>
      <td class="r" style="color:var(--dim);">${t.count}</td>
      <td class="r" style="font-family:'Source Code Pro',monospace;">×${mult}</td>
      <td class="r">${t.count}</td>
      <td class="r" style="font-family:'Source Code Pro',monospace;">${fmtMB(t.value)}</td>
    </tr>`;
  });

  h+=`</tbody></table></div></div>`;
  return h;
}

function _updateMBStats(){
  const tiers=MB_ROWS,pool=MB_POOL,n=MB_N;
  const totalCount=tiers.reduce((s,t)=>s+t.count,0);
  const totalVal=tiers.reduce((s,t)=>s+t.count*t.value,0);
  const poolOk=Math.abs(totalVal-pool)<1;
  const countOk=totalCount===n;
  tiers.forEach((t,i)=>{
    const probEl=document.getElementById('mb-prob-'+i);
    const evEl=document.getElementById('mb-ev-'+i);
    if(probEl) probEl.textContent=pct(t.count,n);
    if(evEl) evEl.textContent=fmtMB(t.count/n*t.value);
  });
  const fc=document.getElementById('mb-fc');
  const fv=document.getElementById('mb-fv');
  if(fc){fc.style.color=countOk?'var(--green3)':'var(--red)';fc.textContent=`${totalCount} ${countOk?'✓':'✗'}`;}
  if(fv){fv.style.color=poolOk?'var(--green3)':'var(--red)';fv.textContent=`${fmtMB(totalVal)} ${poolOk?'✓':'✗'}`;}
  const cs=document.getElementById('mb-config-section');
  if(cs) cs.innerHTML=_buildConfigHTML();
}

function editMBPrize(i,val){
  const v=parseFloat(val);
  if(isNaN(v)||v<0)return;
  MB_ROWS[i].value=v;
  _updateMBStats();
}

function editMBCount(i,val){
  const v=parseInt(val);
  if(isNaN(v)||v<0)return;
  MB_ROWS[i].count=v;
  _updateMBStats();
}
