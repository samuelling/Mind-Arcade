#!/usr/bin/env node
// Monte Carlo check of the engine: completion time, stop type, and accuracy per true profile.
// Usage: node tools/simulate.js [sessionsPerProfile=100]
const E = require('../js/engine.js');
const N = +process.argv[2] || 100;
const keys = [...E.HYPS.map(h => h.id), 'mixed'];
const all = [];
console.log('profile  mean_min  median_min  converged  single-line  unresolved  correct');
for (const k of keys) {
  const mins = []; const st = { converged: 0, narrow: 0, exhausted: 0 }; let ok = 0;
  for (let s = 1; s <= N; s++) {
    const r = E.mulberry32(s * 131 + 7), truth = E.truthProfile(k, r), S = E.newSession('sim');
    while (E.simStep(S, truth, r));
    mins.push(S.minutes); st[S.status]++; if (S.final.lead.id === k) ok++;
  }
  mins.sort((a, b) => a - b); all.push(...mins);
  const mean = mins.reduce((a, b) => a + b, 0) / N;
  console.log(`${k.padEnd(8)} ${mean.toFixed(1).padStart(8)} ${mins[N >> 1].toFixed(1).padStart(11)} ${String(st.converged).padStart(10)} ${String(st.narrow).padStart(12)} ${String(st.exhausted).padStart(11)} ${String(ok).padStart(8)}`);
}
console.log(`\nall      ${(all.reduce((a, b) => a + b, 0) / all.length).toFixed(1).padStart(8)} min mean; full battery = ${E.TESTS.reduce((a, t) => a + t.min, 0).toFixed(1)} min`);
