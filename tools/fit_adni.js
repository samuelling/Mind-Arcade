#!/usr/bin/env node
// Fit the Mind Arcade memory model to ADNI RAVLT data and learn diagnosis templates.
//
//   node tools/fit_adni.js --neurobat NEUROBAT.csv --dx ADNIMERGE.csv [--write-engine]
//   node tools/fit_adni.js --synthetic 1200            # pipeline check on simulated ADNI-shaped data
//
// What it does
//   1. Per participant (baseline visit): RAVLT trials 1-5 (15 words), 30-min delayed recall, and
//      recognition hits / false positives -> likelihood over the (encoding e, access r, forgetting f)
//      grid, guess bias marginalized. Same model the arcade uses; only the design differs.
//   2. Per diagnosis group: hierarchical EM for the group mean and spread of (e, r, f) in z units.
//   3. 5-fold cross-validated classification of diagnosis from memory data alone:
//        model   - exact marginal likelihood under each group's fitted template (what the engine does)
//        summary - LDA on classic RAVLT summary scores (immediate, learning, delayed, % forgetting, recognition)
//   4. Writes data/adni_fit.json, and with --write-engine, js/adni-fit.js so the pages load fitted norms.
//
// Column names (override with --map key=COLUMN): trials AVTOT1..AVTOT5, delayed AVDEL30MIN,
// recognition hits AVDELTOT, recognition false positives AVDELERR2, diagnosis DX_bl, id RID, visit VISCODE.
// Check these against the ADNI data dictionary for your download; the script prints ranges to help.

const fs = require('fs'), path = require('path');
const E = require('../js/engine.js');

const args = process.argv.slice(2), opt = {}, map = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--map') { const [k, v] = args[++i].split('='); map[k] = v; }
  else if (a.startsWith('--')) { const k = a.slice(2); opt[k] = (args[i + 1] && !args[i + 1].startsWith('--')) ? args[++i] : true; }
}
const COL = Object.assign({
  t1: 'AVTOT1', t2: 'AVTOT2', t3: 'AVTOT3', t4: 'AVTOT4', t5: 'AVTOT5', delayed: 'AVDEL30MIN', hits: 'AVDELTOT', fas: 'AVDELERR2',
  dx: 'DX_bl', id: 'RID', visit: 'VISCODE', baseline: 'bl',
}, map);
const DESIGN = { n: 15, nRec: 15, nFoil: 15, delayMin: 30 };
const GROUP_OF = { CN: 'CN', SMC: 'CN', EMCI: 'EMCI', LMCI: 'LMCI', MCI: 'LMCI', AD: 'AD', Dementia: 'AD' };

// ---------- CSV ----------
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map(h => h.trim());
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

// ---------- data ----------
function loadADNI() {
  const nb = parseCSV(fs.readFileSync(opt.neurobat, 'utf8')), dx = parseCSV(fs.readFileSync(opt.dx, 'utf8'));
  for (const k of ['t1', 't2', 't3', 't4', 't5', 'delayed', 'hits', 'fas', 'id']) if (!(COL[k] in nb[0])) throw new Error(`NEUROBAT has no column ${COL[k]} (for ${k}). Use --map ${k}=COLUMN.`);
  if (!(COL.dx in dx[0])) throw new Error(`Diagnosis file has no column ${COL.dx}. Use --map dx=COLUMN.`);
  const dxBy = {};
  for (const r of dx) { const g = GROUP_OF[r[COL.dx]]; if (g && !(r[COL.id] in dxBy)) dxBy[r[COL.id]] = g; }
  const isBase = r => !(COL.visit in r) || r[COL.visit] === COL.baseline || r.VISCODE2 === COL.baseline;
  const out = [], seen = new Set();
  for (const r of nb) {
    if (!isBase(r) || seen.has(r[COL.id]) || !dxBy[r[COL.id]]) continue;
    const ks = ['t1', 't2', 't3', 't4', 't5'].map(k => +r[COL[k]]);
    const kd = +r[COL.delayed], hits = +r[COL.hits], fas = +r[COL.fas];
    const vals = [...ks, kd, hits, fas];
    if (vals.some(v => !Number.isFinite(v) || v < 0)) continue;            // ADNI codes missing as -1/-4
    if (ks.some(k => k > 15) || kd > 15 || hits > 15 || fas > 15) continue;
    seen.add(r[COL.id]);
    out.push({ id: r[COL.id], group: dxBy[r[COL.id]], ks, kd, hits, fas });
  }
  // sanity print so column meanings can be checked
  const rng = k => { const v = out.map(x => k(x)); return `${Math.min(...v)}–${Math.max(...v)} (mean ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)})`; };
  console.log(`Loaded ${out.length} baseline participants with complete RAVLT and diagnosis.`);
  console.log(`  trial 1 ${rng(x => x.ks[0])} · trial 5 ${rng(x => x.ks[4])} · delayed ${rng(x => x.kd)} · recog hits ${rng(x => x.hits)} · recog FP ${rng(x => x.fas)}`);
  return out;
}
function synthetic(N) {
  const r = E.mulberry32(20261012);
  const truth = { CN: { mu: [0, 0, 0], n: .33 }, EMCI: { mu: [-0.5, -0.3, -0.8], n: .22 }, LMCI: { mu: [-1.0, -0.5, -1.8], n: .27 }, AD: { mu: [-1.7, -0.9, -2.8], n: .18 } };
  const out = []; let id = 0;
  for (const [g, T] of Object.entries(truth)) for (let i = 0; i < Math.round(N * T.n); i++) {
    const z = T.mu.map(m => m + 0.7 * E.gauss(r));
    const e = E.zToNat('mem_e', z[0]), rr = E.zToNat('mem_r', z[1]), f = E.zToNat('mem_f', z[2]), gb = 0.02 + 0.13 * r();
    const p = E.memProbs(e, rr, f, gb, DESIGN.delayMin, 5);
    out.push({ id: String(++id), group: g, ks: p.learn.map(q => E.binom(15, q, r)), kd: E.binom(15, p.pd, r), hits: E.binom(15, p.hit, r), fas: E.binom(15, p.fa, r), trueZ: z });
  }
  console.log(`Synthetic ADNI-shaped sample: ${out.length} participants. True group means (e, r, f): ` + Object.entries(truth).map(([g, T]) => `${g} [${T.mu.join(', ')}]`).join(' · '));
  return { data: out, truth };
}

// ---------- per-participant grids ----------
const NG = E.ZG3.length ** 3, THETA = Array.from({ length: NG }, (_, i) => { const p = E.gridPoint(i); return [p.ze, p.zr, p.zf]; });
function computeGrids(data) {
  const t0 = Date.now();
  data.forEach((d, j) => {
    const G = E.memGrid({ ks: d.ks }, { kd: d.kd, hits: d.hits, fas: d.fas, delayMin: DESIGN.delayMin }, DESIGN);
    d.ll = Float32Array.from(G.ll);
    // weak-prior posterior mean, for display and the LDA-on-parameters comparison
    let mx = -Infinity, W = 0; const m = [0, 0, 0];
    const lw = new Float64Array(NG); for (let i = 0; i < NG; i++) { lw[i] = d.ll[i] + THETA[i].reduce((s, z) => s + E.zPrior(z), 0); if (lw[i] > mx) mx = lw[i]; }
    for (let i = 0; i < NG; i++) { const w = Math.exp(lw[i] - mx); W += w; for (let k = 0; k < 3; k++) m[k] += w * THETA[i][k]; }
    d.post = m.map(x => x / W);
    if ((j + 1) % 200 === 0) process.stdout.write(`  fitted ${j + 1}/${data.length}\r`);
  });
  console.log(`Per-participant fits done in ${((Date.now() - t0) / 1000).toFixed(1)} s.          `);
}

// ---------- hierarchical EM for a group template ----------
function fitGroup(members, iters = 40) {
  let mu = [0, 0, 0], sd = [1, 1, 1];
  for (let it = 0; it < iters; it++) {
    const m1 = [0, 0, 0], m2 = [0, 0, 0];
    for (const d of members) {
      let mx = -Infinity; const lw = new Float64Array(NG);
      for (let i = 0; i < NG; i++) { let s = d.ll[i]; for (let k = 0; k < 3; k++) { const x = (THETA[i][k] - mu[k]) / sd[k]; s -= 0.5 * x * x; } lw[i] = s; if (s > mx) mx = s; }
      let W = 0; const a = [0, 0, 0], b = [0, 0, 0];
      for (let i = 0; i < NG; i++) { const w = Math.exp(lw[i] - mx); W += w; for (let k = 0; k < 3; k++) { a[k] += w * THETA[i][k]; b[k] += w * THETA[i][k] ** 2; } }
      for (let k = 0; k < 3; k++) { m1[k] += a[k] / W; m2[k] += b[k] / W; }
    }
    const n = members.length;
    mu = m1.map(x => x / n);
    sd = m2.map((x, k) => Math.max(0.25, Math.sqrt(Math.max(1e-6, x / n - mu[k] ** 2))));
  }
  return { mu, sd, n: members.length };
}
function groupLogLik(d, T) {
  let mx = -Infinity; const v = new Float64Array(NG);
  const norm = -Math.log(T.sd[0] * T.sd[1] * T.sd[2]);
  for (let i = 0; i < NG; i++) { let s = d.ll[i] + norm; for (let k = 0; k < 3; k++) { const x = (THETA[i][k] - T.mu[k]) / T.sd[k]; s -= 0.5 * x * x; } v[i] = s; if (s > mx) mx = s; }
  let acc = 0; for (let i = 0; i < NG; i++) acc += Math.exp(v[i] - mx);
  return mx + Math.log(acc);
}

// ---------- LDA baseline ----------
const summaryFeat = d => { const imm = d.ks.reduce((a, b) => a + b, 0); return [imm, d.ks[4] - d.ks[0], d.kd, d.ks[4] > 0 ? 100 * (d.ks[4] - d.kd) / d.ks[4] : 0, d.hits - d.fas]; };
function inv(A) { const n = A.length, M = A.map((r, i) => [...r, ...A.map((_, j) => +(i === j))]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
    const v = M[c][c] || 1e-9; for (let j = 0; j < 2 * n; j++) M[c][j] /= v;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; } }
  return M.map(r => r.slice(n)); }
function trainLDA(rows, groups, feat) {
  const X = rows.map(feat), p = X[0].length, cls = {};
  for (const g of groups) { const xs = X.filter((_, i) => rows[i].group === g); cls[g] = { n: xs.length, mu: Array.from({ length: p }, (_, k) => xs.reduce((s, x) => s + x[k], 0) / xs.length) }; }
  const C = Array.from({ length: p }, () => new Array(p).fill(0));
  X.forEach((x, i) => { const m = cls[rows[i].group].mu; for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) C[a][b] += (x[a] - m[a]) * (x[b] - m[b]); });
  for (let a = 0; a < p; a++) { for (let b = 0; b < p; b++) C[a][b] /= (X.length - groups.length); C[a][a] += 1e-6; }
  const Ci = inv(C);
  return x => Object.fromEntries(groups.map(g => { const m = cls[g].mu, d = x.map((v, k) => v - m[k]); let q = 0; for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) q += d[a] * Ci[a][b] * d[b]; return [g, -0.5 * q + Math.log(cls[g].n / rows.length)]; }));
}

// ---------- evaluation ----------
function softmax(o) { const ks = Object.keys(o), mx = Math.max(...ks.map(k => o[k])); const e = ks.map(k => Math.exp(o[k] - mx)), s = e.reduce((a, b) => a + b, 0); return Object.fromEntries(ks.map((k, i) => [k, e[i] / s])); }
function auc(pos, neg) { let s = 0; for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0; return s / (pos.length * neg.length); }
function evaluate(rows, P, groups) {
  let acc = 0, ll = 0; const per = {};
  rows.forEach((d, i) => { const p = P[i], best = groups.reduce((a, b) => p[a] >= p[b] ? a : b); acc += best === d.group; ll -= Math.log(Math.max(1e-12, p[d.group])); per[d.group] = per[d.group] || [0, 0]; per[d.group][0]++; per[d.group][1] += best === d.group; });
  const bal = groups.reduce((s, g) => s + per[g][1] / per[g][0], 0) / groups.length;
  const score = (i, a, b) => P[i][b] / (P[i][a] + P[i][b]);
  const pair = (a, b) => auc(rows.map((d, i) => d.group === b ? score(i, a, b) : null).filter(x => x != null), rows.map((d, i) => d.group === a ? score(i, a, b) : null).filter(x => x != null));
  return { acc: acc / rows.length, bal, logloss: ll / rows.length, aucCN_LMCI: pair('CN', 'LMCI'), aucCN_EMCI: groups.includes('EMCI') ? pair('CN', 'EMCI') : null, aucLMCI_AD: pair('LMCI', 'AD') };
}
function crossValidate(data, groups, K = 5) {
  const r = E.mulberry32(7), order = data.map((_, i) => i).sort(() => r() - 0.5);
  const Pm = new Array(data.length), Ps = new Array(data.length), Pp = new Array(data.length);
  for (let f = 0; f < K; f++) {
    const test = order.filter((_, i) => i % K === f), testSet = new Set(test), train = data.filter((_, i) => !testSet.has(i));
    const T = Object.fromEntries(groups.map(g => [g, fitGroup(train.filter(d => d.group === g), 25)]));
    const prior = Object.fromEntries(groups.map(g => [g, Math.log(T[g].n / train.length)]));
    const lda = trainLDA(train, groups, summaryFeat), ldaP = trainLDA(train, groups, d => d.post);
    for (const i of test) {
      Pm[i] = softmax(Object.fromEntries(groups.map(g => [g, groupLogLik(data[i], T[g]) + prior[g]])));
      Ps[i] = softmax(lda(summaryFeat(data[i]))); Pp[i] = softmax(ldaP(data[i].post));
    }
    process.stdout.write(`  fold ${f + 1}/${K}\r`);
  }
  return { model: evaluate(data, Pm, groups), params_lda: evaluate(data, Pp, groups), summary_lda: evaluate(data, Ps, groups) };
}

// ---------- main ----------
let data, truth = null;
if (opt.synthetic) ({ data, truth } = synthetic(+opt.synthetic || 1200));
else if (opt.neurobat && opt.dx) data = loadADNI();
else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 22).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(1); }

const groups = ['CN', 'EMCI', 'LMCI', 'AD'].filter(g => data.some(d => d.group === g));
console.log('Group sizes: ' + groups.map(g => `${g} ${data.filter(d => d.group === g).length}`).join(' · '));
computeGrids(data);

const T = Object.fromEntries(groups.map(g => [g, fitGroup(data.filter(d => d.group === g))]));
const names = ['encoding e', 'access r', 'forgetting f'], keys = ['mem_e', 'mem_r', 'mem_f'];
console.log('\nGroup templates (z on the engine\'s current scale; negative = worse)');
console.log('group     n    ' + names.map(n => n.padStart(20)).join(''));
for (const g of groups) console.log(`${g.padEnd(6)} ${String(T[g].n).padStart(4)}    ` + T[g].mu.map((m, k) => `${m.toFixed(2).padStart(6)} ± ${T[g].sd[k].toFixed(2)}`.padStart(20)).join('') + (truth ? `   true [${truth[g].mu.join(', ')}]` : ''));
const cn = T.CN;
console.log('\nCN in natural units: ' + keys.map((m, k) => `${names[k]} ${MEASfmt(m, E.zToNat(m, cn.mu[k]))}`).join(' · '));
function MEASfmt(m, v) { return E.MEAS[m].fmt(v); }

console.log('\n5-fold cross-validated diagnosis from RAVLT alone');
const cv = crossValidate(data, groups);
console.log('method                          acc   bal.acc  logloss  AUC CN-LMCI  AUC CN-EMCI  AUC LMCI-AD');
for (const [k, label] of [['model', 'Hierarchical memory model'], ['params_lda', 'LDA on fitted parameters'], ['summary_lda', 'LDA on summary scores']]) {
  const v = cv[k];
  console.log(`${label.padEnd(30)} ${v.acc.toFixed(3)}   ${v.bal.toFixed(3)}    ${v.logloss.toFixed(3)}     ${v.aucCN_LMCI.toFixed(3)}        ${v.aucCN_EMCI != null ? v.aucCN_EMCI.toFixed(3) : '  —  '}        ${v.aucLMCI_AD.toFixed(3)}`);
}

// Templates re-expressed relative to cognitively normal adults (CN -> mean 0, SD 1), for the engine
const rel = g => T[g].mu.map((m, k) => (m - cn.mu[k]) / cn.sd[k]);
const fit = {
  source: opt.synthetic ? 'synthetic' : 'ADNI', design: DESIGN, n: data.length, created: new Date().toISOString(),
  norms: Object.fromEntries(keys.map((m, k) => { const M = E.MEAS[m]; return [m, { mean: M.mean + M.dir * cn.mu[k] * M.sd, sd: cn.sd[k] * M.sd }]; })),
  templates: Object.fromEntries(groups.map(g => [g, Object.fromEntries(keys.map((m, k) => [m, +rel(g)[k].toFixed(3)]))])),
  spread: Object.fromEntries(groups.map(g => [g, Object.fromEntries(keys.map((m, k) => [m, +(T[g].sd[k] / cn.sd[k]).toFixed(3)]))])),
  cv,
};
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
const outJson = path.join(__dirname, '..', 'data', opt.synthetic ? 'adni_fit_synthetic.json' : 'adni_fit.json');
fs.writeFileSync(outJson, JSON.stringify(fit, null, 2));
console.log(`\nWrote ${path.relative(process.cwd(), outJson)}`);
if (opt['write-engine'] && !opt.synthetic) {
  const js = `// Generated by tools/fit_adni.js from ADNI on ${fit.created}. Loaded before engine.js.\nconst ADNI_FIT = ${JSON.stringify({ norms: fit.norms, templates: fit.templates, n: fit.n, design: fit.design })};\nif (typeof module !== 'undefined') module.exports = ADNI_FIT;\n`;
  fs.writeFileSync(path.join(__dirname, '..', 'js', 'adni-fit.js'), js);
  for (const page of ['index.html', 'dashboard.html']) {
    const p = path.join(__dirname, '..', page); let h = fs.readFileSync(p, 'utf8');
    if (!h.includes('js/adni-fit.js')) { h = h.replace('<script src="js/engine.js"></script>', '<script src="js/adni-fit.js"></script>\n<script src="js/engine.js"></script>'); fs.writeFileSync(p, h); }
  }
  console.log('Wrote js/adni-fit.js and linked it from both pages. The amnestic template now uses the LMCI fit.');
}
