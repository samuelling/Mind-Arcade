// ===== Engine: hypotheses, measures, Bayesian updating, test selection =====
const SIGMA = 0.7;            // within-pattern SD of z-scores
const LN3 = Math.log(3);      // Bayes factor 3 per domain counts as a converging line
const P_STOP = 0.90;          // posterior needed on the leader
const K_STOP = 2;             // independent tests that must each favor the leader (two sightlines fix a point)

const DOM = { attention: 'Attention', executive: 'Executive', speed: 'Speed', memory: 'Memory', language: 'Language', visuo: 'Visuospatial' };
const DOM_ORDER = ['attention', 'executive', 'speed', 'memory', 'language', 'visuo'];

// Placeholder adult norms for the browser versions of each task (z = dir * (x - mean) / sd)
const MEAS = {
  dsf:      { label: 'Digit span forward',      dom: 'attention', mean: 6.4,  sd: 1.2,  dir: 1,  lo: 0, hi: 9,  fmt: v => `${Math.round(v)} digits` },
  gng_comm: { label: 'Go/no-go commissions',    dom: 'attention', mean: 0.12, sd: 0.08, dir: -1, lo: 0, hi: 1,  fmt: v => `${Math.round(v * 100)}%` },
  gng_cv:   { label: 'Go RT variability (CV)',  dom: 'attention', mean: 0.20, sd: 0.06, dir: -1, lo: 0.04, hi: 1, fmt: v => v.toFixed(2) },
  dsb:      { label: 'Digit span backward',     dom: 'executive', mean: 4.8,  sd: 1.2,  dir: 1,  lo: 0, hi: 8,  fmt: v => `${Math.round(v)} digits` },
  stroop:   { label: 'Stroop interference',     dom: 'executive', mean: 100,  sd: 55,   dir: -1, lo: -100, hi: 900, fmt: v => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))} ms` },
  tmtBA:    { label: 'Trails B − A',            dom: 'executive', mean: 12,   sd: 7,    dir: -1, lo: -10, hi: 200, fmt: v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} s` },
  flu_pho:  { label: 'Letter fluency (F)',      dom: 'executive', mean: 12,   sd: 4,    dir: 1,  lo: 0, hi: 40, fmt: v => `${Math.round(v)} words` },
  tmtA:     { label: 'Trails A time',           dom: 'speed',     mean: 14,   sd: 4.5,  dir: -1, lo: 5, hi: 200, fmt: v => `${v.toFixed(1)} s` },
  wl_imm:   { label: 'List learning, 2 trials', dom: 'memory',    mean: 14,   sd: 2.8,  dir: 1,  lo: 0, hi: 20, fmt: v => `${Math.round(v)}/20` },
  wl_del:   { label: 'Delayed free recall',     dom: 'memory',    mean: 7,    sd: 1.8,  dir: 1,  lo: 0, hi: 10, fmt: v => `${Math.round(v)}/10` },
  wl_rec:   { label: 'Recognition (hits − FA)', dom: 'memory',    mean: 0.88, sd: 0.10, dir: 1,  lo: -1, hi: 1, fmt: v => v.toFixed(2) },
  flu_sem:  { label: 'Category fluency',        dom: 'language',  mean: 17,   sd: 5,    dir: 1,  lo: 0, hi: 50, fmt: v => `${Math.round(v)} words` },
  naming:   { label: 'Responsive naming',       dom: 'language',  mean: 10.5, sd: 1.2,  dir: 1,  lo: 0, hi: 12, fmt: v => `${Math.round(v)}/12` },
  rot:      { label: 'Mental rotation',         dom: 'visuo',     mean: 0.90, sd: 0.08, dir: 1,  lo: 0, hi: 1,  fmt: v => `${Math.round(v * 100)}%` },
};
const ORDER = Object.keys(MEAS);

const MU_KEYS = ['dsf', 'dsb', 'gng_comm', 'gng_cv', 'stroop', 'tmtA', 'tmtBA', 'wl_imm', 'wl_del', 'wl_rec', 'flu_sem', 'flu_pho', 'naming', 'rot'];
const HYP_DEF = [
  ['typ',  'Typical',             'No consistent deficit; scores scatter around the norm.',
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['amn',  'Amnestic',            'Poor learning and rapid forgetting that recognition does not rescue. Resembles AD-spectrum MCI.',
    [-0.2, -0.4, -0.2, -0.2, -0.4, -0.4, -0.5, -1.4, -2.2, -1.8, -1.3, -0.5, -0.7, -0.3]],
  ['dys',  'Dysexecutive',        'Weak set-shifting, inhibition and letter fluency with storage intact. Frontal-systems pattern.',
    [-0.3, -1.3, -1.1, -0.6, -1.5, -0.5, -1.8, -0.7, -0.6, -0.1, -0.8, -1.7, -0.2, -0.4]],
  ['att',  'Attentional',         'Commission errors and erratic response times, short span. ADHD-like pattern.',
    [-0.9, -0.8, -1.6, -1.9, -0.6, -0.5, -0.6, -0.6, -0.3, 0, -0.3, -0.4, 0, -0.3]],
  ['sem',  'Semantic',            'Loss of word knowledge: naming and category fluency fall first. Semantic-variant pattern.',
    [-0.1, -0.2, 0, 0, -0.2, -0.1, -0.2, -0.8, -0.9, -0.7, -2.2, -0.6, -2.4, 0]],
  ['vis',  'Visuospatial',        'Rotation and visual search impaired, verbal skills spared. Posterior-cortical pattern.',
    [-0.2, -0.5, -0.2, -0.3, -0.4, -1.5, -1.2, -0.3, -0.3, -0.2, -0.4, -0.2, -0.4, -2.2]],
  ['slow', 'Psychomotor slowing', 'Speed-dominant decline across every timed task. Subcortical / vascular pattern.',
    [-0.2, -0.6, -0.3, -1.0, -1.0, -1.9, -1.0, -0.7, -0.5, -0.1, -0.8, -1.0, -0.2, -0.6]],
  ['mood', 'Mood-related',        'Effortful retrieval weak but recognition spared. Depression-associated pattern.',
    [-0.3, -0.4, -0.2, -0.7, -0.5, -0.8, -0.5, -1.0, -0.9, -0.1, -0.7, -0.8, -0.2, -0.3]],
];
const HYPS = HYP_DEF.map(([id, name, desc, arr]) => ({ id, name, desc, mu: Object.fromEntries(MU_KEYS.map((k, i) => [k, arr[i]])) }));

const TESTS = [
  { id: 'dsf',    name: 'Digit Span Forward',           meas: ['dsf'],               min: 1.5 },
  { id: 'dsb',    name: 'Digit Span Backward',          meas: ['dsb'],               min: 1.5 },
  { id: 'gng',    name: 'Go / No-Go',                   meas: ['gng_comm', 'gng_cv'], min: 1.3 },
  { id: 'stroop', name: 'Color–Word Interference',      meas: ['stroop'],            min: 1.3 },
  { id: 'trails', name: 'Trail Making A & B',           meas: ['tmtA', 'tmtBA'],     min: 1.8 },
  { id: 'wl',     name: 'Word List Learning',           meas: ['wl_imm'],            min: 2.0, evalMeas: ['wl_imm', 'wl_del', 'wl_rec'], evalMin: 3.5 },
  { id: 'wld',    name: 'Delayed Recall & Recognition', meas: ['wl_del', 'wl_rec'],  min: 1.5, requires: 'wl', gap: 2 },
  { id: 'flus',   name: 'Category Fluency',             meas: ['flu_sem'],           min: 1.1 },
  { id: 'flup',   name: 'Letter Fluency',               meas: ['flu_pho'],           min: 1.1 },
  { id: 'nam',    name: 'Responsive Naming',            meas: ['naming'],            min: 2.0 },
  { id: 'rot',    name: 'Mental Rotation',              meas: ['rot'],               min: 1.5 },
];
const TEST_BY_ID = Object.fromEntries(TESTS.map(t => [t.id, t]));

// ---------- math ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0; while (u === 0) u = r(); const v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function normalize(lp) { const mx = Math.max(...lp); const e = lp.map(x => Math.exp(x - mx)); const s = e.reduce((a, b) => a + b, 0); return e.map(x => x / s); }
function entropy(P) { let H = 0; for (const p of P) if (p > 1e-12) H -= p * Math.log2(p); return H; }
const TWO_S2 = 2 * SIGMA * SIGMA;
function logLik(h, obs) { let s = 0; for (const m in obs) { const d = obs[m] - h.mu[m]; s -= d * d / TWO_S2; } return s; }
function posterior(obs) { return normalize(HYPS.map(h => logLik(h, obs))); }
function phi(z) { // standard normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
function aacn(z) { // AACN 2020 uniform labels by percentile
  if (z >= 2.05) return 'Exceptionally high'; if (z >= 1.34) return 'Above average'; if (z >= 0.67) return 'High average';
  if (z > -0.67) return 'Average'; if (z > -1.34) return 'Low average'; if (z > -2.05) return 'Below average'; return 'Exceptionally low';
}
function rawToZ(m, x) { const M = MEAS[m]; return Math.max(-4.5, Math.min(3, M.dir * (x - M.mean) / M.sd)); }
function zToRaw(m, z) { const M = MEAS[m]; return Math.max(M.lo, Math.min(M.hi, M.mean + M.dir * z * M.sd)); }

// Expected information gain (bits) of observing `meas`, stratified Monte Carlo over hypotheses
function eig(P, meas, seed) {
  const r = mulberry32(seed), K = 40, H0 = entropy(P);
  const logP = P.map(p => Math.log(Math.max(p, 1e-300)));
  let Hexp = 0, used = 0;
  for (let i = 0; i < HYPS.length; i++) {
    if (P[i] < 1e-4) continue;
    let acc = 0;
    for (let k = 0; k < K; k++) {
      const z = meas.map(m => HYPS[i].mu[m] + SIGMA * gauss(r));
      const lp = HYPS.map((h, j) => { let s = logP[j]; for (let q = 0; q < meas.length; q++) { const d = z[q] - h.mu[meas[q]]; s -= d * d / TWO_S2; } return s; });
      acc += entropy(normalize(lp));
    }
    Hexp += P[i] * acc / K; used += P[i];
  }
  return Math.max(0, H0 - Hexp / used);
}
// Expected log-likelihood ratio between two patterns for a set of measures (symmetric KL, nats)
function discrim(a, b, meas) { return meas.reduce((s, m) => s + (a.mu[m] - b.mu[m]) ** 2, 0) / TWO_S2; }

// Lines of evidence: each completed test is an independent sighting. A test "converges" when its
// own data favor the leader over the runner-up by a Bayes factor of 3 or more.
function convergence(S, a, b) {
  const lines = [];
  for (const id of S.order) {
    if (!S.completed.has(id)) continue;
    const t = TEST_BY_ID[id];
    let llr = 0;
    for (const m of t.meas) { const z = S.obs[m]; llr += ((z - b.mu[m]) ** 2 - (z - a.mu[m]) ** 2) / TWO_S2; }
    lines.push({ t, llr, dom: MEAS[t.meas[0]].dom, state: llr > LN3 ? 'for' : llr < -LN3 ? 'against' : 'neutral' });
  }
  const converging = lines.filter(l => l.state === 'for');
  return { lines, converging, convDoms: new Set(converging.map(l => l.dom)), against: lines.filter(l => l.state === 'against') };
}

function newSession(mode) {
  return { mode, obs: {}, raw: {}, done: new Set(), completed: new Set(), order: [], trace: [], hist: [posterior({})], status: 'running', minutes: 0 };
}
function eligible(S, t) {
  if (S.done.has(t.id)) return false;
  if (!t.requires) return true;
  if (!S.completed.has(t.requires)) return false;
  return S.order.length - S.order.indexOf(t.requires) - 1 >= t.gap;
}
function seedFor(S, t) { let h = 2166136261 ^ S.order.length; for (const c of t.id) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

function decide(S) {
  const P = posterior(S.obs);
  const idx = P.map((_, i) => i).sort((x, y) => P[y] - P[x]);
  const lead = HYPS[idx[0]], run = HYPS[idx[1]], pLead = P[idx[0]];
  const H = entropy(P), Hn = H / Math.log2(HYPS.length);
  const nEff = 2 ** H;                       // effective number of live patterns
  const w = (nEff - 1) / (HYPS.length - 1);  // explore weight: 1 when all 8 are equally live, 0 when one remains
  const conv = convergence(S, lead, run);
  const k = conv.converging.length;
  const alive = P.filter(p => p > 0.02).length;
  let phase = pLead >= P_STOP && k < K_STOP ? 'confirm' : (w > 0.4 ? 'explore' : 'exploit');

  // Tests waiting out a required delay (e.g. delayed recall) still count as future evidence
  const pending = TESTS.filter(t => !S.done.has(t.id) && t.requires && S.completed.has(t.requires) && !eligible(S, t));
  let pool = TESTS.filter(t => eligible(S, t));
  if (!pool.length) pool = pending.slice(); // nothing left to fill the delay with: waive it
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

  return { P, idx, lead, run, pLead, H, Hn, nEff, w, pending, conv, k, alive, phase, cands, choice: cands[0], stop };
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

function applyResult(S, d, c, z, raw, skipped) {
  const t = c.t;
  S.done.add(t.id); S.order.push(t.id);
  if (!skipped) { S.completed.add(t.id); Object.assign(S.obs, z); Object.assign(S.raw, raw); S.minutes += t.min; }
  const Pafter = posterior(S.obs);
  S.hist.push(Pafter);
  S.trace.push({ t, phase: d.phase, reason: skipped ? 'Skipped by examiner.' : reasonFor(d, c), skipped: !!skipped, z, raw, Pafter, d });
}

// ---------- simulation ----------
function truthProfile(key, r) {
  if (key === 'mixed') { const a = HYPS[1].mu, b = HYPS[6].mu; return { name: 'Mixed (amnestic + slowing)', mu: Object.fromEntries(MU_KEYS.map(k => [k, (a[k] + b[k]) / 2])), id: 'mixed' }; }
  if (key === 'random') { const h = HYPS[Math.floor(r() * HYPS.length)]; return { name: h.name, mu: h.mu, id: h.id }; }
  const h = HYPS.find(x => x.id === key); return { name: h.name, mu: h.mu, id: h.id };
}
function simulateTest(t, truth, r) {
  const z = {}, raw = {};
  for (const m of t.meas) {
    const x = zToRaw(m, truth.mu[m] + SIGMA * gauss(r));
    raw[m] = x; z[m] = rawToZ(m, x);
  }
  return { z, raw };
}
function simStep(S, truth, r) {
  const d = decide(S);
  if (d.stop) { S.status = d.stop.kind; S.final = d; return false; }
  const c = d.choice; const { z, raw } = simulateTest(c.t, truth, r);
  applyResult(S, d, c, z, raw);
  return true;
}

if (typeof module !== 'undefined') module.exports = { HYPS, TESTS, newSession, simStep, truthProfile, mulberry32, decide };
