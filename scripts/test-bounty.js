#!/usr/bin/env node
/**
 * Test suite for mystery bounty calculator logic.
 * Mirrors buildTiered, buildFlat, buildCustom, distributeCounts, mbSnap
 * from index.html. Keep in sync whenever those functions change.
 *
 * Usage: node scripts/test-bounty.js
 */

// ── Mirrored logic ────────────────────────────────────────────────────────────

function mbSnap(v,to){if(!to||to<=0)return Math.round(v);return Math.round(v/to)*to;}

function distributeCounts(pcts,n){
  const total=pcts.reduce((a,b)=>a+b,0);
  const norm=pcts.map(p=>p/total*n);
  const floors=norm.map(Math.floor);
  const deficit=n-floors.reduce((a,b)=>a+b,0);
  const rems=norm.map((v,i)=>({i,r:v-floors[i]})).sort((a,b)=>b.r-a.r);
  for(let k=0;k<deficit;k++) floors[rems[k].i]++;
  return floors;
}

function buildTiered(pool,n,zeros,topBounty,tiers,snap,minBounty=0){
  const results=[];
  let activeN=n-zeros;
  let activePool=pool;

  if(topBounty>0){activeN=Math.max(0,activeN-1);activePool=Math.max(0,activePool-topBounty);}
  if(activeN<=0||activePool<=0){
    const early=topBounty>0?[{count:1,value:topBounty,isTop:true}]:[];
    if(zeros>0) early.push({count:zeros,value:0,isZero:true});
    return early;
  }

  const counts=distributeCounts(tiers.map(t=>t.pct),activeN);
  // tiers stored highest-first: tiers[0]=Top, tiers[last]=Small
  const weightedSum=counts.reduce((s,c,i)=>s+c*tiers[i].mult,0);
  if(weightedSum<=0) return [];
  const base=activePool/weightedSum;

  const vals=tiers.map(t=>mbSnap(base*t.mult,snap));

  // Enforce strictly decreasing from index 0 downward
  for(let i=1;i<tiers.length;i++) if(vals[i]>=vals[i-1]&&snap>0) vals[i]=Math.max(0,vals[i-1]-snap);

  // Apply min bounty floor to bottom tier, then push higher tiers up
  const mbFloor=minBounty>0?(snap>0?Math.ceil(minBounty/snap)*snap:minBounty):0;
  const last=tiers.length-1;
  if(mbFloor>0&&vals[last]<mbFloor){
    vals[last]=mbFloor;
    for(let i=last-1;i>=0;i--) if(vals[i]<=vals[i+1]) vals[i]=vals[i+1]+(snap>0?snap:1);
  }

  // Distribute remainder top-down, preserving descending monotonicity
  let snappedTotal=counts.reduce((s,c,i)=>s+c*vals[i],0);
  let rem=activePool-snappedTotal;
  for(let j=0;j<vals.length&&rem!==0;j++){
    const minV=j<last?vals[j+1]+(snap>0?snap:1):mbFloor;
    const proposed=vals[j]+rem/counts[j];
    if(proposed>=minV){vals[j]=proposed;rem=0;}
    else{const canAbsorb=(vals[j]-minV)*counts[j];rem+=canAbsorb;vals[j]=minV;}
  }

  for(let i=0;i<tiers.length;i++){
    if(counts[i]>0) results.push({count:counts[i],value:vals[i]});
  }

  if(topBounty>0) results.unshift({count:1,value:topBounty,isTop:true});
  if(zeros>0) results.push({count:zeros,value:0,isZero:true});
  return results;
}

function buildFlat(pool,n,zeros,topBounty,snap,minBounty=0){
  const results=[];
  let activeN=n-zeros;
  let activePool=pool;
  if(topBounty>0){activeN=Math.max(0,activeN-1);activePool=Math.max(0,activePool-topBounty);}
  if(activeN<=0){
    if(topBounty>0) results.push({count:1,value:topBounty,isTop:true});
    if(zeros>0) results.push({count:zeros,value:0,isZero:true});
    return results;
  }
  let base=mbSnap(activePool/activeN,snap);
  if(snap>0&&base*activeN>activePool) base-=snap;
  if(minBounty>0){
    const floor=snap>0?Math.ceil(minBounty/snap)*snap:minBounty;
    if(base<floor) base=floor;
  }
  const rem=activePool-base*activeN;
  const topVal=base+(snap>0?Math.round(rem/snap)*snap:rem);
  if(topBounty>0) results.push({count:1,value:topBounty,isTop:true});
  if(topVal!==base) results.push({count:1,value:topVal});
  results.push({count:topVal!==base?activeN-1:activeN,value:base});
  if(zeros>0) results.push({count:zeros,value:0,isZero:true});
  return results.filter(r=>r.count>0);
}

function buildCustom(pool,n,zeros,topBounty,customTiers){
  const rows=customTiers.filter(r=>r.count>0&&r.value>=0);
  const totalCount=rows.reduce((s,r)=>s+r.count,0)+(topBounty>0?1:0)+zeros;
  const totalVal=rows.reduce((s,r)=>s+r.count*r.value,0)+(topBounty>0?topBounty:0);
  return {rows,totalCount,totalVal,valid:Math.abs(totalVal-pool)<1&&totalCount===n};
}

// ── Test harness ──────────────────────────────────────────────────────────────

let passed=0, failed=0;

function assert(cond, msg){
  if(cond){ passed++; }
  else { failed++; console.error('  FAIL: '+msg); }
}

function totalCount(tiers){ return tiers.reduce((s,t)=>s+t.count,0); }
function totalVal(tiers){ return tiers.reduce((s,t)=>s+t.count*t.value,0); }

function runTest(name, fn){
  process.stdout.write(name+'\n');
  fn();
}

// Default tier set used by the UI (highest-first: Top Bounty → Tier 2 → Tier 3 → Tier 4)
const DEFAULT_TIERS=[
  {pct:10,mult:30},
  {pct:15,mult:12},
  {pct:25,mult:4},
  {pct:50,mult:1},
];

// ── distributeCounts ──────────────────────────────────────────────────────────

runTest('distributeCounts — sums to n', ()=>{
  for(const n of [1,5,10,20,79,100]){
    const counts=distributeCounts([50,25,15,10],n);
    assert(counts.reduce((a,b)=>a+b,0)===n, `n=${n} counts sum to ${counts.reduce((a,b)=>a+b,0)}`);
  }
});

runTest('distributeCounts — no negatives', ()=>{
  const counts=distributeCounts([50,25,15,10],3);
  assert(counts.every(c=>c>=0), 'all counts >= 0');
});

// ── buildFlat ─────────────────────────────────────────────────────────────────

runTest('buildFlat — count conservation (20 envelopes, no zeros, no top)', ()=>{
  const t=buildFlat(2000,20,0,0,50);
  assert(totalCount(t)===20, `count=${totalCount(t)}, want 20`);
});

runTest('buildFlat — pool conservation ($2000, 20 envelopes)', ()=>{
  const t=buildFlat(2000,20,0,0,50);
  const tot=totalVal(t);
  assert(Math.abs(tot-2000)<1, `total=${tot}, want ~2000`);
});

runTest('buildFlat — with zeros: count and pool conserved', ()=>{
  const t=buildFlat(2000,20,5,0,50);
  assert(totalCount(t)===20, `count=${totalCount(t)}`);
  const tot=totalVal(t);
  assert(Math.abs(tot-2000)<1, `total=${tot}, want ~2000`);
});

runTest('buildFlat — zero envelopes have value=0', ()=>{
  const t=buildFlat(2000,20,5,0,50);
  const zeros=t.filter(r=>r.isZero);
  assert(zeros.length===1, 'one zero row');
  assert(zeros[0].value===0, 'zero value');
  assert(zeros[0].count===5, `zero count=${zeros[0].count}`);
});

runTest('buildFlat — top bounty respected', ()=>{
  const t=buildFlat(2000,20,0,500,50);
  const top=t.find(r=>r.isTop);
  assert(top&&top.value===500, `top=${top&&top.value}`);
  assert(totalCount(t)===20, `count=${totalCount(t)}`);
  const tot=totalVal(t);
  assert(Math.abs(tot-2000)<1, `total=${tot}`);
});

runTest('buildFlat — base is snap-aligned (snap=50)', ()=>{
  const t=buildFlat(2000,20,0,0,50);
  const nonTop=t.filter(r=>!r.isTop&&!r.isZero);
  nonTop.forEach(r=>assert(r.value%50===0||r.value===0, `value ${r.value} not snap-aligned`));
});

runTest('buildFlat — min bounty floor: base never below minBounty', ()=>{
  // pool=5000, n=20, snap=100, minBounty=200
  // raw base = mbSnap(250,100)=300; floor=200; 300 >= 200 so no clamping, but values still >= minBounty
  const t=buildFlat(5000,20,0,0,100,200);
  const nonZero=t.filter(r=>!r.isZero&&!r.isTop);
  nonZero.forEach(r=>assert(r.value>=200, `value ${r.value} below minBounty 200`));
});

runTest('buildFlat — min bounty=0 unchanged', ()=>{
  const a=buildFlat(2000,20,0,0,50,0);
  const b=buildFlat(2000,20,0,0,50);
  assert(JSON.stringify(a)===JSON.stringify(b), 'minBounty=0 gives same result as omitted');
});

runTest('buildFlat — single active envelope after zeros+top', ()=>{
  // n=3, zeros=1, top=500 → activeN=1
  const t=buildFlat(1000,3,1,500,50);
  assert(totalCount(t)===3, `count=${totalCount(t)}`);
  const tot=totalVal(t);
  assert(Math.abs(tot-1000)<1, `total=${tot}`);
});

// ── buildTiered ───────────────────────────────────────────────────────────────

runTest('buildTiered — count conservation (30 envelopes)', ()=>{
  const t=buildTiered(3000,30,0,0,DEFAULT_TIERS,50);
  assert(totalCount(t)===30, `count=${totalCount(t)}`);
});

runTest('buildTiered — pool conservation ($3000, 30 envelopes)', ()=>{
  const t=buildTiered(3000,30,0,0,DEFAULT_TIERS,50);
  const tot=totalVal(t);
  assert(Math.abs(tot-3000)<1, `total=${tot}`);
});

runTest('buildTiered — monotone descending (higher tiers have higher values)', ()=>{
  const t=buildTiered(5000,50,0,0,DEFAULT_TIERS,50);
  const vals=t.filter(r=>!r.isZero).map(r=>r.value);
  for(let i=0;i<vals.length-1;i++)
    assert(vals[i]>=vals[i+1], `row ${i} value ${vals[i]} < row ${i+1} value ${vals[i+1]}`);
});

runTest('buildTiered — monotone descending with top bounty (inversion regression)', ()=>{
  // Top bounty removes a large chunk; remainder waterfall must not invert the tier order
  const t=buildTiered(13500,19,0,5000,DEFAULT_TIERS,50);
  const nonSpecial=t.filter(r=>!r.isTop&&!r.isZero).map(r=>r.value);
  for(let i=0;i<nonSpecial.length-1;i++)
    assert(nonSpecial[i]>=nonSpecial[i+1], `inversion at row ${i}: ${nonSpecial[i]} < ${nonSpecial[i+1]}`);
});

runTest('buildTiered — top bounty respected and at top row', ()=>{
  const t=buildTiered(5000,50,0,1000,DEFAULT_TIERS,50);
  assert(t[0].isTop&&t[0].value===1000, `top=${t[0].value}`);
  assert(totalCount(t)===50, `count=${totalCount(t)}`);
  const tot=totalVal(t);
  assert(Math.abs(tot-5000)<1, `total=${tot}`);
});

runTest('buildTiered — zero envelopes included at bottom with value=0', ()=>{
  const t=buildTiered(3000,30,10,0,DEFAULT_TIERS,50);
  const zRow=t.find(r=>r.isZero);
  assert(zRow&&zRow.count===10&&zRow.value===0, `zero row: ${JSON.stringify(zRow)}`);
  assert(totalCount(t)===30, `count=${totalCount(t)}`);
  const tot=totalVal(t);
  assert(Math.abs(tot-3000)<1, `total=${tot}`);
});

runTest('buildTiered — min bounty floor: bottom tier >= minBounty', ()=>{
  // pool=5000, n=20: base≈39.7, small tier snaps to $50; minBounty=100 clamps it to $100
  const t=buildTiered(5000,20,0,0,DEFAULT_TIERS,50,100);
  const nonZero=t.filter(r=>!r.isZero&&!r.isTop);
  const bottom=nonZero[nonZero.length-1];
  assert(bottom&&bottom.value>=100, `bottom tier value ${bottom&&bottom.value} < minBounty 100`);
});

runTest('buildTiered — min bounty snap-aligned (snap=50)', ()=>{
  // minBounty=75 → ceil(75/50)*50 = 100; same scenario as above, floor becomes $100
  const t=buildTiered(5000,20,0,0,DEFAULT_TIERS,50,75);
  const nonZero=t.filter(r=>!r.isZero&&!r.isTop);
  const bottom=nonZero[nonZero.length-1];
  assert(bottom&&bottom.value>=100, `bottom=${bottom&&bottom.value}, want >=100`);
});

runTest('buildTiered — min bounty survives monotonicity pass (5-tier regression)', ()=>{
  // 5 tiers: adding a 5th tier drives base down so vals[0] and vals[1] both snap to $100;
  // monotonicity would reduce vals[0] to $50 — floor must survive.
  const fiveTiers=[{pct:5,mult:90},{pct:10,mult:30},{pct:15,mult:12},{pct:25,mult:4},{pct:50,mult:1}];
  const t=buildTiered(5000,20,0,0,fiveTiers,50,100);
  const nonZero=t.filter(r=>!r.isZero&&!r.isTop);
  const bottom=nonZero[nonZero.length-1];
  assert(bottom&&bottom.value>=100, `bottom=${bottom&&bottom.value}, want >=100`);
});

runTest('buildTiered — min bounty=0 unchanged', ()=>{
  const a=buildTiered(3000,30,0,0,DEFAULT_TIERS,50,0);
  const b=buildTiered(3000,30,0,0,DEFAULT_TIERS,50);
  assert(JSON.stringify(a)===JSON.stringify(b), 'minBounty=0 gives same result');
});

runTest('buildTiered — two tiers only', ()=>{
  const tiers=[{pct:30,mult:5},{pct:70,mult:1}];
  const t=buildTiered(2000,20,0,0,tiers,50);
  assert(totalCount(t)===20, `count=${totalCount(t)}`);
  const tot=totalVal(t);
  assert(Math.abs(tot-2000)<1, `total=${tot}`);
  assert(t[0].value>=t[1].value, 'top tier >= bottom tier');
});

runTest('buildTiered — no snap (snap=0): pool conserved', ()=>{
  const t=buildTiered(3333,30,0,0,DEFAULT_TIERS,0);
  const tot=totalVal(t);
  assert(Math.abs(tot-3333)<1, `total=${tot}`);
});

runTest('buildTiered — all zeros (zeros=n): returns empty non-zero rows', ()=>{
  const t=buildTiered(3000,10,10,0,DEFAULT_TIERS,50);
  const nonZero=t.filter(r=>!r.isZero);
  assert(nonZero.length===0, `nonZero rows=${nonZero.length}`);
  assert(totalCount(t)===10, `count=${totalCount(t)}`);
});

runTest('buildTiered — pool conserved with top+zeros', ()=>{
  const t=buildTiered(5000,40,8,1500,DEFAULT_TIERS,50);
  const tot=totalVal(t);
  assert(Math.abs(tot-5000)<1, `total=${tot}`);
  assert(totalCount(t)===40, `count=${totalCount(t)}`);
});

// ── buildCustom ───────────────────────────────────────────────────────────────

runTest('buildCustom — valid when count and value match', ()=>{
  const cv=buildCustom(1000,10,0,0,[{count:5,value:100},{count:5,value:100}]);
  assert(cv.valid, `valid=${cv.valid}, totalCount=${cv.totalCount}, totalVal=${cv.totalVal}`);
});

runTest('buildCustom — invalid when count mismatch', ()=>{
  const cv=buildCustom(1000,10,0,0,[{count:4,value:100},{count:5,value:100}]);
  assert(!cv.valid, 'should be invalid (count mismatch)');
});

runTest('buildCustom — invalid when value mismatch', ()=>{
  const cv=buildCustom(1000,10,0,0,[{count:5,value:90},{count:5,value:100}]);
  assert(!cv.valid, 'should be invalid (value mismatch)');
});

runTest('buildCustom — top bounty included in totalCount and totalVal', ()=>{
  const cv=buildCustom(1500,6,0,500,[{count:5,value:200}]);
  assert(cv.totalCount===6, `count=${cv.totalCount}`);
  assert(Math.abs(cv.totalVal-1500)<1, `val=${cv.totalVal}`);
  assert(cv.valid, 'should be valid');
});

runTest('buildCustom — zeros included in totalCount', ()=>{
  const cv=buildCustom(500,10,5,0,[{count:5,value:100}]);
  assert(cv.totalCount===10, `count=${cv.totalCount}`);
  assert(cv.valid, 'should be valid');
});

// ── Edge cases ────────────────────────────────────────────────────────────────

runTest('buildFlat — only top bounty (zeros=n-1, topBounty set)', ()=>{
  // n=5, zeros=4, topBounty=1000 → only top + zeros
  const t=buildFlat(1000,5,4,1000,50);
  assert(totalCount(t)===5, `count=${totalCount(t)}`);
  assert(t.some(r=>r.isTop&&r.value===1000), 'top bounty present');
});

runTest('buildTiered — large tournament: 100 envelopes, $10000 pool', ()=>{
  const t=buildTiered(10000,100,20,2000,DEFAULT_TIERS,50);
  const tot=totalVal(t);
  assert(Math.abs(tot-10000)<1, `total=${tot}`);
  assert(totalCount(t)===100, `count=${totalCount(t)}`);
});

runTest('buildFlat — large tournament: 150 envelopes, $15000 pool', ()=>{
  const t=buildFlat(15000,150,30,3000,50);
  const tot=totalVal(t);
  assert(Math.abs(tot-15000)<1, `total=${tot}`);
  assert(totalCount(t)===150, `count=${totalCount(t)}`);
});

// ── Report ────────────────────────────────────────────────────────────────────

console.log('\n'+'─'.repeat(40));
console.log(`Passed: ${passed}  Failed: ${failed}`);
if(failed>0) process.exit(1);
