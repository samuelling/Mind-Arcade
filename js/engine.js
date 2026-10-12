// ===== Mind Arcade engine v2: generative task models + hierarchical pattern inference =====
//
// Two kinds of evidence feed the pattern posterior:
//   score measures — classic summary scores, z-scored against placeholder norms (se = 0)
//   param measures — parameters of a generative process model fit to trial-level data;
//                    each arrives with its own posterior SD, so noisy fits count for less
// Pattern k predicts z_m ~ N(mu_km, SIGMA^2); an estimate with error se has marginal
// likelihood N(zhat; mu_km, SIGMA^2 + se^2).

const SIGMA = 0.7;            // between-person spread within a pattern (z units)
const LN3 = Math.log(3);      // Bayes factor 3: one converging sightline
const P_STOP = 0.90;
const K_STOP = 2;

const DOM = { attention: 'Attention', executive: 'Executive', speed: 'Speed', memory: 'Memory', language: 'Language', visuo: 'Visuospatial' };
const DOM_ORDER = ['attention', 'executive', 'speed', 'memory', 'language', 'visuo'];

const TF = {
  id: { f: x => x, inv: y => y },
  log: { f: x => Math.log(x), inv: y => Math.exp(y) },
  logit: { f: x => Math.log(x / (1 - x)), inv: y => 1 / (1 + Math.exp(-y)) },
};

// Placeholder norms. Score measures: mean/sd of the raw score. Param measures: mean/sd on the
// transformed scale (tf). dir = +1 if higher is better. expSE = typical fit SD (z units) for planning.
const MEAS = {
  dsf:      { kind: 'score', label: 'Digit span forward',     dom: 'attention', mean: 6.4,  sd: 1.2,  dir: 1,  lo: 0, hi: 9,  fmt: v => `${Math.round(v)} digits` },
  gng_comm: { kind: 'score', label: 'Go/no-go commissions',   dom: 'attention', mean: 0.12, sd: 0.08, dir: -1, lo: 0, hi: 1,  fmt: v => `${Math.round(v * 100)}%` },
  gng_cv:   { kind: 'score', label: 'Go RT variability (CV)', dom: 'attention', mean: 0.20, sd: 0.06, dir: -1, lo: 0.04, hi: 1, fmt: v => v.toFixed(2) },
  dsb:      { kind: 'score', label: 'Digit span backward',    dom: 'executive', mean: 4.8,  sd: 1.2,  dir: 1,  lo: 0, hi: 8,  fmt: v => `${Math.round(v)} digits` },
  stroop:   { kind: 'score', label: 'Stroop interference',    dom: 'executive', mean: 100,  sd: 55,   dir: -1, lo: -100, hi: 900, fmt: v => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))} ms` },
  tmtBA:    { kind: 'score', label: 'Trails B − A',           dom: 'executive', mean: 12,   sd: 7,    dir: -1, lo: -10, hi: 200, fmt: v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} s` },
  fs_tau:   { kind: 'param', label: 'Animal search time constant', dom: 'executive', tf: 'log', mean: Math.log(40), sd: 0.45, dir: -1, expSE: 0.95, fmt: v => `τ ${Math.round(v)} s` },
  fp_tau:   { kind: 'param', label: 'F-word search time constant', dom: 'executive', tf: 'log', mean: Math.log(45), sd: 0.45, dir: -1, expSE: 0.95, fmt: v => `τ ${Math.round(v)} s` },
  tmtA:     { kind: 'score', label: 'Trails A time',          dom: 'speed',     mean: 14,   sd: 4.5,  dir: -1, lo: 5, hi: 200, fmt: v => `${v.toFixed(1)} s` },
  rot_v:    { kind: 'param', label: 'Decision drift (rotation)', dom: 'speed', tf: 'id', mean: 1.6, sd: 0.5, dir: 1, expSE: 0.75, fmt: v => `v ${v.toFixed(2)}` },
  mem_e:    { kind: 'param', label: 'Encoding rate',          dom: 'memory', tf: 'logit', mean: Math.log(0.65 / 0.35), sd: 0.6, dir: 1, expSE: 0.85, fmt: v => `${Math.round(v * 100)}% per study` },
  mem_r:    { kind: 'param', label: 'Retrieval efficiency',   dom: 'memory', tf: 'logit', mean: Math.log(0.85 / 0.15), sd: 0.7, dir: 1, expSE: 0.9, fmt: v => `${Math.round(v * 100)}% access` },
  mem_f:    { kind: 'param', label: 'Forgetting rate',        dom: 'memory', tf: 'log', mean: Math.log(0.01), sd: 1.0, dir: -1, expSE: 1.0, fmt: v => `${(v * 100).toFixed(1)}% / min` },
  fs_N:     { kind: 'param', label: 'Animal pool size',       dom: 'language', tf: 'log', mean: Math.log(24), sd: 0.35, dir: 1, expSE: 0.8, fmt: v => `${Math.round(v)} items` },
  fp_N:     { kind: 'param', label: 'F-word pool size',       dom: 'language', tf: 'log', mean: Math.log(17), sd: 0.35, dir: 1, expSE: 0.8, fmt: v => `${Math.round(v)} items` },
  naming:   { kind: 'score', label: 'Responsive naming',      dom: 'language', mean: 10.5, sd: 1.2,  dir: 1,  lo: 0, hi: 12, fmt: v => `${Math.round(v)}/12` },
  rot_w:    { kind: 'param', label: 'Mental rotation rate',   dom: 'visuo', tf: 'log', mean: Math.log(150), sd: 0.4, dir: 1, expSE: 0.25, fmt: v => `${Math.round(v)}°/s` },
};
const ORDER = Object.keys(MEAS);
const isParam = m => MEAS[m].kind === 'param';
function zToNat(m, z) { const M = MEAS[m]; return TF[M.tf].inv(M.mean + M.dir * z * M.sd); }
function natToZ(m, x) { const M = MEAS[m]; return M.dir * (TF[M.tf].f(x) - M.mean) / M.sd; }

const HYPS = [
  { id: 'typ', name: 'Typical', desc: 'Every parameter near the population center.', mu: {} },
  { id: 'amn', name: 'Amnestic', desc: 'Weak encoding and fast forgetting; recognition does not rescue recall. Resembles AD-spectrum MCI.',
    mu: { dsf: -.2, dsb: -.4, gng_comm: -.2, gng_cv: -.2, stroop: -.4, tmtA: -.4, tmtBA: -.5, naming: -.7, mem_e: -1.0, mem_r: -.4, mem_f: -2.5, fs_N: -1.3, fs_tau: -.5, fp_N: -.3, fp_tau: -.4, rot_w: -.3, rot_v: -.3 } },
  { id: 'dys', name: 'Dysexecutive', desc: 'Slow, effortful search and poor inhibition with storage intact. Frontal-systems pattern.',
    mu: { dsf: -.3, dsb: -1.3, gng_comm: -1.1, gng_cv: -.6, stroop: -1.5, tmtA: -.5, tmtBA: -1.8, naming: -.2, mem_e: -.5, mem_r: -1.0, mem_f: -.1, fs_N: -.4, fs_tau: -1.2, fp_N: -.6, fp_tau: -1.8, rot_w: -.4, rot_v: -.5 } },
  { id: 'att', name: 'Attentional', desc: 'Noisy evidence accumulation and commission errors. ADHD-like pattern.',
    mu: { dsf: -.9, dsb: -.8, gng_comm: -1.6, gng_cv: -1.9, stroop: -.6, tmtA: -.5, tmtBA: -.6, naming: 0, mem_e: -.8, mem_r: -.3, mem_f: 0, fs_N: -.2, fs_tau: -.4, fp_N: -.2, fp_tau: -.5, rot_w: -.2, rot_v: -.7 } },
  { id: 'sem', name: 'Semantic', desc: 'A shrunken semantic store: small category pool and lost names, search speed spared. Semantic-variant pattern.',
    mu: { dsf: -.1, dsb: -.2, stroop: -.2, tmtA: -.1, tmtBA: -.2, naming: -2.4, mem_e: -1.0, mem_r: -.5, mem_f: -.6, fs_N: -2.3, fs_tau: -.3, fp_N: -.7, fp_tau: -.3 } },
  { id: 'vis', name: 'Visuospatial', desc: 'Slow mental rotation and visual search; verbal parameters spared. Posterior-cortical pattern.',
    mu: { dsf: -.2, dsb: -.5, gng_comm: -.2, gng_cv: -.3, stroop: -.4, tmtA: -1.5, tmtBA: -1.2, naming: -.4, mem_e: -.2, mem_r: -.2, mem_f: -.2, fs_N: -.2, fs_tau: -.2, fp_N: -.1, fp_tau: -.2, rot_w: -2.0, rot_v: -1.4 } },
  { id: 'slow', name: 'Psychomotor slowing', desc: 'Every rate parameter shifted down together. Subcortical / vascular pattern.',
    mu: { dsf: -.2, dsb: -.6, gng_comm: -.3, gng_cv: -1.0, stroop: -1.0, tmtA: -1.9, tmtBA: -1.0, naming: -.2, mem_e: -.5, mem_r: -.6, mem_f: -.1, fs_N: -.3, fs_tau: -1.1, fp_N: -.3, fp_tau: -1.1, rot_w: -1.2, rot_v: -.6 } },
  { id: 'mood', name: 'Mood-related', desc: 'Retrieval access is weak while storage and forgetting are normal. Depression-associated pattern.',
    mu: { dsf: -.3, dsb: -.4, gng_comm: -.2, gng_cv: -.7, stroop: -.5, tmtA: -.8, tmtBA: -.5, naming: -.2, mem_e: -.3, mem_r: -1.6, mem_f: -.1, fs_N: -.2, fs_tau: -.9, fp_N: -.2, fp_tau: -.9, rot_w: -.4, rot_v: -.4 } },
];
for (const h of HYPS) for (const m of ORDER) if (!(m in h.mu)) h.mu[m] = 0;

const TESTS = [
  { id: 'dsf',    name: 'Digit Span Forward',           meas: ['dsf'],                     min: 1.5 },
  { id: 'dsb',    name: 'Digit Span Backward',          meas: ['dsb'],                     min: 1.5 },
  { id: 'gng',    name: 'Go / No-Go',                   meas: ['gng_comm', 'gng_cv'],      min: 1.3 },
  { id: 'stroop', name: 'Color–Word Interference',      meas: ['stroop'],                  min: 1.3 },
  { id: 'trails', name: 'Trail Making A & B',           meas: ['tmtA', 'tmtBA'],           min: 1.8 },
  { id: 'wl',     name: 'Word List Learning',           meas: ['mem_e', 'mem_r'],          min: 2.8, model: true, evalMeas: ['mem_e', 'mem_r', 'mem_f'], evalMin: 4.8 },
  { id: 'wld',    name: 'Delayed Recall & Recognition', meas: ['mem_e', 'mem_r', 'mem_f'], min: 2.0, model: true, requires: 'wl', gap: 2 },
  { id: 'flus',   name: 'Category Fluency',             meas: ['fs_N', 'fs_tau'],          min: 1.1, model: true },
  { id: 'flup',   name: 'Letter Fluency',               meas: ['fp_N', 'fp_tau'],          min: 1.1, model: true },
  { id: 'nam',    name: 'Responsive Naming',            meas: ['naming'],                  min: 2.0 },
  { id: 'rot',    name: 'Mental Rotation',              meas: ['rot_w', 'rot_v'],          min: 1.8, model: true },
];
const TEST_BY_ID = Object.fromEntries(TESTS.map(t => [t.id, t]));

// ---------- math ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0; while (u === 0) u = r(); const v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function normalize(lp) { const mx = Math.max(...lp); const e = lp.map(x => Math.exp(x - mx)); const s = e.reduce((a, b) => a + b, 0); return e.map(x => x / s); }
function entropy(P) { let H = 0; for (const p of P) if (p > 1e-12) H -= p * Math.log2(p); return H; }
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
function aacn(z) {
  if (z >= 2.05) return 'Exceptionally high'; if (z >= 1.34) return 'Above average'; if (z >= 0.67) return 'High average';
  if (z > -0.67) return 'Average'; if (z > -1.34) return 'Low average'; if (z > -2.05) return 'Below average'; return 'Exceptionally low';
}
function rawToZ(m, x) { const M = MEAS[m]; return Math.max(-4.5, Math.min(3, M.dir * (x - M.mean) / M.sd)); }
function zToRaw(m, z) { const M = MEAS[m]; return Math.max(M.lo, Math.min(M.hi, M.mean + M.dir * z * M.sd)); }
const varOf = (m, se) => SIGMA * SIGMA + (se || 0) ** 2;
const planVar = m => varOf(m, MEAS[m].expSE || 0);

// Model tests contribute exact pattern marginals p(data | pattern) integrated over their fitted grid.
// Word-list learning is superseded once delayed recall refits all memory data jointly.
const pllIds = S => Object.keys(S.pll).filter(id => !(id === 'wl' && S.pll.wld));
function logLik(h, i, S) {
  let s = 0;
  for (const m in S.obs) if (!isParam(m)) { const d = S.obs[m] - h.mu[m]; s -= d * d / (2 * varOf(m, S.se[m])); }
  for (const id of pllIds(S)) s += S.pll[id][i];
  return s;
}
function posterior(S) { return normalize(HYPS.map((h, i) => logLik(h, i, S))); }

// Expected information gain (bits), stratified Monte Carlo over hypotheses, using planned fit precision
function eig(P, meas, seed) {
  const r = mulberry32(seed), K = 40, H0 = entropy(P);
  const logP = P.map(p => Math.log(Math.max(p, 1e-300))), V = meas.map(planVar);
  let Hexp = 0, used = 0;
  for (let i = 0; i < HYPS.length; i++) {
    if (P[i] < 1e-4) continue;
    let acc = 0;
    for (let k = 0; k < K; k++) {
      const z = meas.map((m, q) => HYPS[i].mu[m] + Math.sqrt(V[q]) * gauss(r));
      const lp = HYPS.map((h, j) => { let s = logP[j]; for (let q = 0; q < meas.length; q++) { const d = z[q] - h.mu[meas[q]]; s -= d * d / (2 * V[q]); } return s; });
      acc += entropy(normalize(lp));
    }
    Hexp += P[i] * acc / K; used += P[i];
  }
  return Math.max(0, H0 - Hexp / used);
}
function discrim(a, b, meas) { return meas.reduce((s, m) => s + (a.mu[m] - b.mu[m]) ** 2 / (2 * planVar(m)), 0); }

// Sightlines: each completed test's own estimates (snapshotted when it ran) vs leader and runner-up
function convergence(S, a, b) {
  const lines = [];
  for (const id of S.order) {
    if (!S.completed.has(id)) continue;
    const t = TEST_BY_ID[id], snap = S.snap[id];
    let llr = 0;
    if (S.pll[id]) {
      const ia = HYPS.indexOf(a), ib = HYPS.indexOf(b);
      llr = S.pll[id][ia] - S.pll[id][ib];
      if (id === 'wld' && S.pll.wl) llr -= S.pll.wl[ia] - S.pll.wl[ib]; // only the evidence the delay added
    } else for (const m in snap.z) { const z = snap.z[m], v = varOf(m, snap.se[m]); llr += ((z - b.mu[m]) ** 2 - (z - a.mu[m]) ** 2) / (2 * v); }
    lines.push({ t, llr, dom: MEAS[t.meas[0]].dom, state: llr > LN3 ? 'for' : llr < -LN3 ? 'against' : 'neutral' });
  }
  const converging = lines.filter(l => l.state === 'for');
  return { lines, converging, convDoms: new Set(converging.map(l => l.dom)), against: lines.filter(l => l.state === 'against') };
}

// Posterior predictive for a measure before it is observed: mixture of Gaussians over patterns
function predictive(P, m) {
  const v = planVar(m), sd = Math.sqrt(v);
  const cdf = x => P.reduce((s, p, i) => s + p * phi((x - HYPS[i].mu[m]) / sd), 0);
  const q = target => { let lo = -6, hi = 4; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (cdf(mid) < target) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  const mean = P.reduce((s, p, i) => s + p * HYPS[i].mu[m], 0);
  const dens = x => P.reduce((s, p, i) => s + p * Math.exp(-((x - HYPS[i].mu[m]) ** 2) / (2 * v)) / Math.sqrt(2 * Math.PI * v), 0);
  return { mean, lo: q(0.1), hi: q(0.9), dens };
}

function newSession(mode) {
  return { mode, obs: {}, se: {}, pll: {}, raw: {}, snap: {}, fits: {}, data: {}, done: new Set(), completed: new Set(), order: [], trace: [], hist: [normalize(HYPS.map(() => 0))], status: 'running', minutes: 0, ledger: [] };
}
function eligible(S, t) {
  if (S.done.has(t.id)) return false;
  if (!t.requires) return true;
  if (!S.completed.has(t.requires)) return false;
  return S.order.length - S.order.indexOf(t.requires) - 1 >= t.gap;
}
function seedFor(S, t) { let h = 2166136261 ^ S.order.length; for (const c of t.id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

function decide(S) {
  const P = posterior(S);
  const idx = P.map((_, i) => i).sort((x, y) => P[y] - P[x]);
  const lead = HYPS[idx[0]], run = HYPS[idx[1]], pLead = P[idx[0]];
  const H = entropy(P), Hn = H / Math.log2(HYPS.length);
  const nEff = 2 ** H;
  const w = (nEff - 1) / (HYPS.length - 1);
  const conv = convergence(S, lead, run);
  const k = conv.converging.length;
  const alive = P.filter(p => p > 0.02).length;
  const phase = pLead >= P_STOP && k < K_STOP ? 'confirm' : (w > 0.4 ? 'explore' : 'exploit');

  const pending = TESTS.filter(t => !S.done.has(t.id) && t.requires && S.completed.has(t.requires) && !eligible(S, t));
  let pool = TESTS.filter(t => eligible(S, t));
  if (!pool.length) pool = pending.slice();
  const pendingConfirm = pending.some(t => !pool.includes(t) && discrim(lead, run, t.meas) >= 0.3);
  const cands = pool.map(t => {
    const ms = t.evalMeas || t.meas;
    const e = eig(P, ms, seedFor(S, t));
    const d = discrim(lead, run, ms);
    const dom = MEAS[t.meas[0]].dom;
    const canConfirm = discrim(lead, run, t.meas) >= 0.3;
    const independent = canConfirm && !conv.convDoms.has(dom);
    return { t, e, d, dom, canConfirm, independent, min: t.evalMin || t.min };
  });
  const maxE = Math.max(1e-9, ...cands.map(c => c.e)), maxD = Math.max(1e-9, ...cands.map(c => c.d));
  for (const c of cands) {
    c.en = c.e / maxE; c.dn = c.d / maxD;
    c.base = w * c.en + (1 - w) * c.dn;
    if (phase === 'confirm') c.base = c.dn * (c.independent ? 1 : c.canConfirm ? 0.5 : 0.1);
    c.u = c.base / c.min;
  }
  cands.sort((x, y) => y.u - x.u);
  const maxU = Math.max(1e-9, ...cands.map(c => c.u));
  for (const c of cands) c.un = c.u / maxU;

  let stop = null;
  if (pLead >= P_STOP && k >= K_STOP) stop = { kind: 'converged', text: `${lead.name} at ${pct(pLead)}, with ${k} independent tests each favoring it over ${run.name} by BF ≥ 3.` };
  else if (pLead >= 0.97 && k >= 1 && !cands.some(c => c.canConfirm) && !pendingConfirm) stop = { kind: 'narrow', text: `${lead.name} at ${pct(pLead)}, but it rests on a single test: nothing left in the battery separates it from ${run.name}.` };
  else if (!cands.length) stop = { kind: 'exhausted', text: 'Every test in the battery has been given.' };
  else if (maxE < 0.01 && phase !== 'confirm' && !pending.length) stop = { kind: 'exhausted', text: 'No remaining test is expected to carry even 0.01 bits.' };

  const d = { P, idx, lead, run, pLead, H, Hn, nEff, w, pending, conv, k, alive, phase, cands, choice: cands[0], stop };
  if (!stop && d.choice) {
    d.pred = {};
    for (const m of d.choice.t.meas) d.pred[m] = predictive(P, m);
    if (d.choice.t.id === 'wld' && S.data.wl) d.mech = predictDelayed(S, P, delayFor(S, 0.5));
  }
  return d;
}

function pct(p) { return `${Math.round(p * 100)}%`; }
function reasonFor(d, c) {
  const wait = d.pending && d.pending.length && !d.pending.includes(c.t) ? ` Also fills the delay before ${d.pending[0].name}.` : '';
  return reasonCore(d, c) + wait;
}
function reasonCore(d, c) {
  if (d.phase === 'explore') return `Largest expected information gain: ${c.e.toFixed(2)} bits across ${d.alive} live patterns (${(c.e / c.min).toFixed(2)} bits/min).`;
  if (d.phase === 'exploit') return `Best separates ${d.lead.name} from ${d.run.name}: expected log-likelihood ratio ${c.d.toFixed(2)} nats.`;
  const have = `${d.lead.name} leads at ${pct(d.pLead)} on ${d.k} converging test${d.k === 1 ? '' : 's'}`;
  if (c.independent) return `${have}. Seeking a second sightline from an independent ${DOM[c.dom].toLowerCase()} test.`;
  if (c.canConfirm) return `${have}. Seeking a second test against ${d.run.name} (same domain; no independent one left).`;
  return `${have}. Nothing left separates it from ${d.run.name}, so taking the best remaining test.`;
}

// res = { z, se, raw, data, fit, summary }
function applyResult(S, d, c, res, skipped) {
  const t = c.t;
  S.done.add(t.id); S.order.push(t.id);
  if (!skipped) {
    S.completed.add(t.id); S.minutes += t.min;
    S.snap[t.id] = { z: { ...res.z }, se: { ...res.se } };
    Object.assign(S.obs, res.z); Object.assign(S.se, res.se); Object.assign(S.raw, res.raw);
    if (res.fit) S.fits[t.id] = res.fit;
    if (res.pll) S.pll[t.id] = res.pll;
    if (res.data) S.data[t.id] = res.data;
    if (t.id === 'wl') { S.learnAt = S.minutes; S.learnAtMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
    // prediction ledger: how surprised was the model?
    if (d.pred) for (const m in d.pred) if (m in res.z) {
      const p = d.pred[m], z = res.z[m];
      S.ledger.push({ test: t.id, m, mean: p.mean, lo: p.lo, hi: p.hi, z, inside: z >= p.lo && z <= p.hi, logScore: Math.log(Math.max(1e-12, p.dens(z))) });
    }
    if (d.mech && res.data) S.mechLedger = { ...d.mech, observed: { kd: res.data.kd, hitRate: res.data.hits / MEMN, faRate: res.data.fas / MEMN } };
  }
  const Pafter = posterior(S);
  S.hist.push(Pafter);
  S.trace.push({ t, phase: d.phase, reason: skipped ? 'Skipped by examiner.' : reasonFor(d, c), skipped: !!skipped, z: res ? res.z : {}, se: res ? res.se : {}, raw: res ? res.raw : {}, summary: res ? res.summary : null, Pafter, d });
}

// ======================= Generative task models =======================
const clampP = p => Math.min(1 - 1e-9, Math.max(1e-9, p));
const binLL = (k, n, p) => { p = clampP(p); return k * Math.log(p) + (n - k) * Math.log(1 - p); };
const grid = (lo, hi, n) => Array.from({ length: n }, (_, i) => lo + (hi - lo) * i / (n - 1));
const ZPRIOR_SD = 1.5;
const zPrior = z => -z * z / (2 * ZPRIOR_SD * ZPRIOR_SD);
function binom(n, p, r) { let k = 0; for (let i = 0; i < n; i++) if (r() < p) k++; return k; }
function poisson(lam, r) { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }
// log p(data | pattern k) = log sum_grid p(data | theta) N(theta; mu_k, SIGMA^2)  (grid spacing is constant)
function patternLL(pts, dims) {
  const keys = Object.keys(dims), s2 = 2 * SIGMA * SIGMA;
  return HYPS.map(h => {
    let mx = -Infinity; const vals = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i++) { const p = pts[i]; let s = p.ll; for (const k of keys) { const d = p[k] - h.mu[dims[k]]; s -= d * d / s2; } vals[i] = s; if (s > mx) mx = s; }
    let acc = 0; for (let i = 0; i < vals.length; i++) acc += Math.exp(vals[i] - mx);
    return mx + Math.log(acc);
  });
}
// Weighted moments of a grid posterior. pts: [{lw, ...values}]
function moments(pts, keys) {
  let mx = -Infinity; for (const p of pts) if (p.lw > mx) mx = p.lw; let W = 0;
  const m1 = Object.fromEntries(keys.map(k => [k, 0])), m2 = Object.fromEntries(keys.map(k => [k, 0]));
  for (const p of pts) { const w = Math.exp(p.lw - mx); W += w; for (const k of keys) { m1[k] += w * p[k]; m2[k] += w * p[k] * p[k]; } }
  const out = {};
  for (const k of keys) { const mu = m1[k] / W; out[k] = { mean: mu, sd: Math.sqrt(Math.max(1e-6, m2[k] / W - mu * mu)) }; }
  return out;
}

// ---- Memory: encoding e (per study trial), retrieval access r, exponential forgetting f, guess bias g ----
// storage after n studies: s_n = 1 - (1-e)^n ; recall p = s * r ; after delay D: s_D = s_2 * exp(-f D)
// recognition (two-high-threshold): hit = s_D + (1 - s_D) g ; false alarm = g
const MEMN = 12, MEM_TRIALS = 3;
const storeAfter = (e, n) => 1 - (1 - e) ** n;
function memProbs(e, r, f, g, D) {
  const sT = storeAfter(e, MEM_TRIALS), sd = sT * Math.exp(-f * D);
  return { sT, sd, learn: Array.from({ length: MEM_TRIALS }, (_, i) => storeAfter(e, i + 1) * r), pd: sd * r, hit: sd + (1 - sd) * g, fa: g };
}
const learnLL = (ks, e, r) => ks.reduce((s, k, i) => s + binLL(k, MEMN, storeAfter(e, i + 1) * r), 0);
const ZG = grid(-4.5, 2.5, 29);
function fitLearn(data) {
  const pts = [];
  for (const ze of ZG) for (const zr of ZG) {
    const e = zToNat('mem_e', ze), r = zToNat('mem_r', zr);
    const ll = learnLL(data.ks, e, r);
    pts.push({ ll, lw: ll + zPrior(ze) + zPrior(zr), ze, zr });
  }
  const mo = moments(pts, ['ze', 'zr']);
  return { z: { mem_e: mo.ze.mean, mem_r: mo.zr.mean }, se: { mem_e: mo.ze.sd, mem_r: mo.zr.sd }, pll: patternLL(pts, { ze: 'mem_e', zr: 'mem_r' }) };
}
const ZG3 = grid(-4.5, 2.5, 21), GG = [0.01, 0.03, 0.06, 0.1, 0.15, 0.22, 0.3];
function fitMemory(learn, del) {
  const pts = [];
  for (const ze of ZG3) { const e = zToNat('mem_e', ze);
    for (const zr of ZG3) { const r = zToNat('mem_r', zr);
      const base = learnLL(learn.ks, e, r);
      for (const zf of ZG3) { const f = zToNat('mem_f', zf);
        for (const g of GG) {
          const p = memProbs(e, r, f, g, del.delayMin);
          const ll = base + binLL(del.kd, MEMN, p.pd) + binLL(del.hits, MEMN, p.hit) + binLL(del.fas, MEMN, p.fa);
          pts.push({ ll, lw: ll + zPrior(ze) + zPrior(zr) + zPrior(zf), ze, zr, zf, g });
        } } } }
  const mo = moments(pts, ['ze', 'zr', 'zf', 'g']);
  return { z: { mem_e: mo.ze.mean, mem_r: mo.zr.mean, mem_f: mo.zf.mean }, se: { mem_e: mo.ze.sd, mem_r: mo.zr.sd, mem_f: mo.zf.sd }, g: mo.g.mean, pll: patternLL(pts, { ze: 'mem_e', zr: 'mem_r', zf: 'mem_f' }) };
}
// Posterior predictive for delayed recall given learning data, by importance sampling over patterns
function predictDelayed(S, P, D) {
  const r = mulberry32(977 + S.order.length), L = S.data.wl, N = 3000;
  const draws = [];
  for (let i = 0; i < N; i++) {
    let u = r(), k = 0; while (k < P.length - 1 && u > P[k]) { u -= P[k]; k++; }
    const h = HYPS[k];
    const ze = h.mu.mem_e + SIGMA * gauss(r), zr = h.mu.mem_r + SIGMA * gauss(r), zf = h.mu.mem_f + SIGMA * gauss(r);
    const e = zToNat('mem_e', ze), rr = zToNat('mem_r', zr), f = zToNat('mem_f', zf), g = 0.02 + 0.13 * r();
    const p = memProbs(e, rr, f, g, D);
    draws.push({ lw: learnLL(L.ks, e, rr), kd: binom(MEMN, p.pd, r), hit: p.hit, fa: p.fa });
  }
  const mx = Math.max(...draws.map(d => d.lw)); let W = 0;
  const hist = new Array(MEMN + 1).fill(0); let hit = 0, fa = 0;
  for (const d of draws) { const w = Math.exp(d.lw - mx); W += w; hist[d.kd] += w; hit += w * d.hit; fa += w * d.fa; }
  const pmf = hist.map(x => x / W); let c = 0, lo = 0, hi = MEMN; const cdf = pmf.map(p => (c += p));
  lo = cdf.findIndex(x => x >= 0.1); hi = cdf.findIndex(x => x >= 0.9);
  return { delay: D, kdMean: pmf.reduce((s, p, i) => s + p * i, 0), kdLo: lo, kdHi: hi, pmf, hitRate: hit / W, faRate: fa / W };
}
function delayFor(S, extra) {
  if (S.mode === 'live' && S.learnAtMs != null) return (performance.now() - S.learnAtMs) / 60000 + extra;
  return (S.minutes - (S.learnAt || 0)) + extra;
}

// ---- Fluency: retrieval as depletion of a finite pool (Bousfield & Sedgewick; Wixted & Rohrer) ----
// Entries form a Poisson process with rate (N/tau) exp(-(t - t0)/tau) after a typing onset t0.
const FLU_T = 60, FLU_T0 = 1.0, FZ = grid(-4.5, 2.5, 36);
function fitFluency(times, keyN, keyTau) {
  const ts = times.map(t => Math.max(FLU_T0 + 0.05, Math.min(FLU_T, t)));
  const n = ts.length, sumT = ts.reduce((a, t) => a + (t - FLU_T0), 0);
  const pts = [];
  for (const zN of FZ) { const N = zToNat(keyN, zN);
    for (const zT of FZ) { const tau = zToNat(keyTau, zT);
      const ll = n * Math.log(N / tau) - sumT / tau - N * (1 - Math.exp(-(FLU_T - FLU_T0) / tau));
      pts.push({ ll, lw: ll + zPrior(zN) + zPrior(zT), zN, zT });
    } }
  const mo = moments(pts, ['zN', 'zT']);
  return { z: { [keyN]: mo.zN.mean, [keyTau]: mo.zT.mean }, se: { [keyN]: mo.zN.sd, [keyTau]: mo.zT.sd }, pll: patternLL(pts, { zN: keyN, zT: keyTau }) };
}
function simFluency(N, tau, r) {
  const L = FLU_T - FLU_T0, n = poisson(N * (1 - Math.exp(-L / tau)), r);
  const ts = []; for (let i = 0; i < n; i++) ts.push(FLU_T0 - tau * Math.log(1 - r() * (1 - Math.exp(-L / tau))));
  ts.sort((a, b) => a - b);
  for (let i = 1; i < ts.length; i++) if (ts[i] < ts[i - 1] + 0.9) ts[i] = ts[i - 1] + 0.9; // typing refractory
  return ts.filter(t => t <= FLU_T);
}
const fluCurve = (N, tau, t) => t <= FLU_T0 ? 0 : N * (1 - Math.exp(-(t - FLU_T0) / tau));

// ---- Mental rotation: RT = Ter + angle/omega + Wiener first-passage time (drift v, boundary a) ----
function wienerLower(t, v, a, w) { // Navarro & Fuss (2009) density at the lower boundary, unit diffusion
  const u = t / (a * a); if (u <= 0) return 0;
  let f;
  if (u < 1) { let s = 0; for (let k = -4; k <= 4; k++) { const x = w + 2 * k; s += x * Math.exp(-x * x / (2 * u)); } f = s / Math.sqrt(2 * Math.PI * u * u * u); }
  else { let s = 0; for (let k = 1; k <= 10; k++) s += k * Math.exp(-k * k * Math.PI * Math.PI * u / 2) * Math.sin(k * Math.PI * w); f = Math.PI * s; }
  return Math.max(f, 0) * Math.exp(-v * a * w - v * v * t / 2) / (a * a);
}
const ROT_DEADLINE = 7, RA = [0.8, 1.0, 1.25, 1.55, 1.9, 2.3], RT0 = [0.25, 0.35, 0.45, 0.55, 0.7], RZ = grid(-4.5, 2.5, 16);
function fitRotation(trials) {
  const tr = trials.filter(x => x.rt != null && x.rt < ROT_DEADLINE);
  const pts = [];
  for (const zw of RZ) { const om = zToNat('rot_w', zw);
    for (const zv of RZ) { const v = zToNat('rot_v', zv);
      for (const a of RA) for (const ter of RT0) {
        let ll = 0;
        for (const x of tr) {
          const dt = x.rt - ter - x.angle / om;
          const dens = dt > 0.01 ? (x.correct ? wienerLower(dt, -v, a, 0.5) : wienerLower(dt, v, a, 0.5)) : 0;
          ll += Math.log(0.96 * dens + 0.04 / ROT_DEADLINE); // contaminant mixture for lapses
        }
        pts.push({ ll, lw: ll + zPrior(zw) + zPrior(zv), zw, zv, a, ter });
      } } }
  const mo = moments(pts, ['zw', 'zv', 'a', 'ter']);
  return { z: { rot_w: mo.zw.mean, rot_v: mo.zv.mean }, se: { rot_w: mo.zw.sd, rot_v: mo.zv.sd }, a: mo.a.mean, ter: mo.ter.mean, pll: patternLL(pts, { zw: 'rot_w', zv: 'rot_v' }) };
}
function simDiffusion(v, a, r) { // Euler walk from midpoint; returns {t, upper}
  let x = a / 2, t = 0; const dt = 0.002, sq = Math.sqrt(dt);
  while (x > 0 && x < a && t < 10) { x += v * dt + sq * gauss(r); t += dt; }
  return { t, upper: x >= a };
}
const ROT_ANGLES = [40, 80, 120, 160];
function simRotation(om, v, a, ter, r) {
  const trials = [];
  for (let i = 0; i < 20; i++) {
    const angle = ROT_ANGLES[i % 4], d = simDiffusion(v, a, r);
    const rt = ter + angle / om + d.t;
    trials.push({ angle, correct: d.upper, rt: rt < ROT_DEADLINE ? rt : null });
  }
  return trials;
}
const ddmMeanDT = (v, a) => Math.abs(v) < 1e-6 ? a * a / 4 : (a / (2 * v)) * Math.tanh(a * v / 2);

// ---- test scoring: data -> {z, se, raw, fit, summary} ----
function scoreTest(S, t, data) {
  if (!t.model) { const z = {}, se = {}; for (const m in data) { z[m] = rawToZ(m, data[m]); se[m] = 0; } return { z, se, raw: { ...data }, data }; }
  let est, fit = {}, summary;
  if (t.id === 'wl') { est = fitLearn(data); summary = `Recalled ${data.ks.map(k => `${k}/${MEMN}`).join(', ')} across ${MEM_TRIALS} trials`; }
  else if (t.id === 'wld') {
    const del = { ...data, delayMin: data.delayMin != null ? data.delayMin : delayFor(S, 0.3) };
    est = fitMemory(S.data.wl || { ks: new Array(MEM_TRIALS).fill(0) }, del); data = del; fit.g = est.g;
    summary = `After ${del.delayMin.toFixed(1)} min: recalled ${del.kd}/${MEMN} · recognition ${del.hits} hits, ${del.fas} false alarms`;
  }
  else if (t.id === 'flus') { est = fitFluency(data.times, 'fs_N', 'fs_tau'); summary = `${data.times.length} animals in 60 s`; }
  else if (t.id === 'flup') { est = fitFluency(data.times, 'fp_N', 'fp_tau'); summary = `${data.times.length} F-words in 60 s`; }
  else if (t.id === 'rot') {
    est = fitRotation(data.trials); fit = { a: est.a, ter: est.ter };
    const ok = data.trials.filter(x => x.correct && x.rt != null);
    summary = `${ok.length}/${data.trials.length} correct · median RT ${ok.length ? (ok.map(x => x.rt).sort((a, b) => a - b)[ok.length >> 1]).toFixed(2) : '—'} s`;
  }
  const z = {}, se = {}, raw = {};
  for (const m in est.z) { z[m] = Math.max(-4.5, Math.min(2.5, est.z[m])); se[m] = est.se[m]; raw[m] = zToNat(m, z[m]); }
  return { z, se, raw, fit, data, summary, pll: est.pll };
}

// ---------- simulation ----------
function truthProfile(key, r) {
  if (key === 'mixed') { const a = HYPS[1].mu, b = HYPS[6].mu; return { name: 'Mixed (amnestic + slowing)', mu: Object.fromEntries(ORDER.map(k => [k, (a[k] + b[k]) / 2])), id: 'mixed' }; }
  if (key === 'random') { const h = HYPS[Math.floor(r() * HYPS.length)]; return { name: h.name, mu: h.mu, id: h.id }; }
  const h = HYPS.find(x => x.id === key); return { name: h.name, mu: h.mu, id: h.id };
}
function ensurePatient(S, truth, r) {
  if (S.patient) return S.patient;
  const z = {}; for (const m of ORDER) z[m] = truth.mu[m] + SIGMA * gauss(r);
  S.patient = { z, a: 1.4 * Math.exp(0.15 * gauss(r)), ter: 0.42 + 0.08 * r(), g: 0.02 + 0.13 * r() };
  return S.patient;
}
// Generate the raw data a simulated patient would produce on test t
function simulateData(S, t, truth, r) {
  const pt = ensurePatient(S, truth, r), nat = m => zToNat(m, pt.z[m]);
  if (!t.model) { const raw = {}; for (const m of t.meas) raw[m] = zToRaw(m, pt.z[m]); return raw; }
  if (t.id === 'wl') { const e = nat('mem_e'), rr = nat('mem_r'); return { ks: Array.from({ length: MEM_TRIALS }, (_, i) => binom(MEMN, storeAfter(e, i + 1) * rr, r)) }; }
  if (t.id === 'wld') {
    const D = delayFor(S, 0.3), p = memProbs(nat('mem_e'), nat('mem_r'), nat('mem_f'), pt.g, D);
    return { kd: binom(MEMN, p.pd, r), hits: binom(MEMN, p.hit, r), fas: binom(MEMN, p.fa, r), delayMin: D };
  }
  if (t.id === 'flus') return { times: simFluency(nat('fs_N'), nat('fs_tau'), r) };
  if (t.id === 'flup') return { times: simFluency(nat('fp_N'), nat('fp_tau'), r) };
  if (t.id === 'rot') return { trials: simRotation(nat('rot_w'), nat('rot_v'), pt.a, pt.ter, r) };
}
function simulateTest(S, t, truth, r) { return scoreTest(S, t, simulateData(S, t, truth, r)); }
function simStep(S, truth, r) {
  const d = decide(S);
  if (d.stop) { S.status = d.stop.kind; S.final = d; return false; }
  applyResult(S, d, d.choice, simulateTest(S, d.choice.t, truth, r));
  return true;
}

if (typeof module !== 'undefined') module.exports = {
  HYPS, TESTS, MEAS, ORDER, newSession, simStep, truthProfile, mulberry32, decide, zToNat, natToZ,
  fitLearn, fitMemory, MEMN, MEM_TRIALS, storeAfter, fitFluency, simFluency, fitRotation, simRotation, memProbs, binom, gauss, scoreTest, simulateData, ensurePatient,
};
