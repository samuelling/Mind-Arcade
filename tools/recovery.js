#!/usr/bin/env node
// Parameter recovery: simulate data from known parameters, fit, compare. Reports bias, RMSE,
// mean posterior SD, and 80% interval coverage per parameter (z units).
const E = require('../js/engine.js');
const N = +process.argv[2] || 150, r = E.mulberry32(42);
const stats = {};
const add = (m, truth, z, se) => { const s = stats[m] || (stats[m] = { n: 0, b: 0, sq: 0, se: 0, cov: 0, tt: [], ee: [] }); s.n++; s.b += z - truth; s.sq += (z - truth) ** 2; s.se += se; s.cov += Math.abs(z - truth) <= 1.2816 * se ? 1 : 0; s.tt.push(truth); s.ee.push(z); };
const corr = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n; let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb); };
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const z = {}; for (const m of E.ORDER) z[m] = -1.5 + 2.5 * r() ; // spread over the clinically relevant range
  const nat = m => E.zToNat(m, z[m]);
  // memory
  const e = nat('mem_e'), rr = nat('mem_r'), f = nat('mem_f'), g = 0.02 + 0.13 * r(), D = 4 + 4 * r();
  const L = { ks: Array.from({ length: E.MEM_TRIALS }, (_, j) => E.binom(E.MEMN, E.storeAfter(e, j + 1) * rr, r)) };
  const p = E.memProbs(e, rr, f, g, D);
  const Dl = { kd: E.binom(E.MEMN, p.pd, r), hits: E.binom(E.MEMN, p.hit, r), fas: E.binom(E.MEMN, p.fa, r), delayMin: D };
  const fm = E.fitMemory(L, Dl);
  for (const m of ['mem_e', 'mem_r', 'mem_f']) add(m, z[m], fm.z[m], fm.se[m]);
  // fluency
  const fs = E.fitFluency(E.simFluency(nat('fs_N'), nat('fs_tau'), r), 'fs_N', 'fs_tau');
  for (const m of ['fs_N', 'fs_tau']) add(m, z[m], fs.z[m], fs.se[m]);
  // rotation
  if (i < Math.min(N, 80)) {
    const fr = E.fitRotation(E.simRotation(nat('rot_w'), nat('rot_v'), 1.4 * Math.exp(0.15 * E.gauss(r)), 0.42 + 0.08 * r(), r));
    for (const m of ['rot_w', 'rot_v']) add(m, z[m], fr.z[m], fr.se[m]);
  }
}
console.log('param    n   bias   rmse  meanSE  cover80  r(true,est)');
for (const m in stats) { const s = stats[m]; console.log(`${m.padEnd(7)} ${String(s.n).padStart(3)} ${(s.b / s.n).toFixed(2).padStart(6)} ${Math.sqrt(s.sq / s.n).toFixed(2).padStart(6)} ${(s.se / s.n).toFixed(2).padStart(7)} ${(s.cov / s.n).toFixed(2).padStart(8)} ${corr(s.tt, s.ee).toFixed(2).padStart(11)}`); }
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
