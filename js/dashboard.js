// ===== UI: rendering and control flow =====
const $ = s => document.querySelector(s);
const stage = $('#stage');
const PHASE = {
  explore: { label: 'Explore', note: 'Many patterns still live: choose the test that shrinks uncertainty over all of them.' },
  exploit: { label: 'Exploit', note: 'A short list remains: choose the test that best splits the top two.' },
  confirm: { label: 'Confirm', note: 'The leader is ahead but rests on too few tests: seek an independent sightline.' },
  converged: { label: 'Converged', note: 'Leader above 90% and corroborated by two independent tests.' },
  narrow: { label: 'Single-line', note: 'Leader is near-certain, but only one test separates it from the runner-up.' },
  exhausted: { label: 'Unresolved', note: 'Stopped without triangulation. Treat the leader as a best guess.' },
};

let S, D, truth, rng, timer = null, selStep = null, liveToken = 0, liveStart = 0, clockTimer = null;

function fmtZ(z) { return `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}`; }
function pctile(z) { const p = phi(z) * 100; return p < 1 ? '<1' : p > 99 ? '>99' : Math.round(p); }
function chip(kind, text) { return `<span class="chip chip-${kind}">${text || PHASE[kind].label}</span>`; }
const phaseKind = d => d.stop ? d.stop.kind : d.phase;

// ---------- engine panels ----------
function renderPost(d) {
  const lead = d.idx[0], run = d.idx[1];
  $('#post').innerHTML = HYPS.map((h, i) => {
    const p = d.P[i], role = i === lead ? 'lead' : i === run ? 'run' : '';
    return `<div class="prow ${role}" title="${esc(h.desc)}"><span class="pname">${h.name}${role === 'lead' ? ' <em>leader</em>' : role === 'run' ? ' <em>runner-up</em>' : ''}</span><span class="ptrack"><span class="pfill" style="width:${(p * 100).toFixed(1)}%"></span></span><span class="pval">${p < 0.005 ? '<1' : Math.round(p * 100)}%</span></div>`;
  }).join('');
  // posterior trajectory
  const hist = S.hist, n = hist.length - 1, W = 300, H = 90;
  const x = i => n ? (i / n) * W : 0, y = p => H - p * H;
  const lines = HYPS.map((h, j) => {
    const role = j === lead ? 'lead' : j === run ? 'run' : 'other';
    const pts = hist.map((P, i) => `${x(i).toFixed(1)},${y(P[j]).toFixed(1)}`).join(' ');
    return { role, svg: `<polyline class="evo-${role}" points="${n ? pts : `0,${y(hist[0][j])} ${W},${y(hist[0][j])}`}" vector-effect="non-scaling-stroke"/>` };
  });
  const order = ['other', 'run', 'lead'];
  lines.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  $('#evo').innerHTML = `<div class="evo-plot"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Posterior probability of each pattern after each test"><line class="evo-grid" x1="0" x2="${W}" y1="${y(P_STOP)}" y2="${y(P_STOP)}" vector-effect="non-scaling-stroke"/><line class="evo-axis" x1="0" x2="${W}" y1="${H}" y2="${H}" vector-effect="non-scaling-stroke"/>${lines.map(l => l.svg).join('')}</svg><span class="evo-tick" style="top:${(1 - P_STOP) * 100}%">0.90 stop</span></div><div class="evo-x"><span>prior</span><span>${n ? `after test ${n}` : 'no tests yet'}</span></div>`;
}

function renderPolicy(d) {
  const kind = phaseKind(d);
  const lead = d.lead, run = d.run;
  const lines = d.conv.lines.map(l => {
    const bf = Math.exp(l.llr);
    const bfTxt = bf >= 100 ? '>100' : bf < 0.01 ? '<0.01' : bf >= 10 ? bf.toFixed(0) : bf.toFixed(1);
    return `<li class="line line-${l.state}"><span class="ldot"></span><span class="lname">${l.t.name}</span><span class="lbf">BF ${bfTxt}</span></li>`;
  }).join('');
  $('#policy').innerHTML = `
    <div class="pol-head">${chip(kind)}<p>${PHASE[kind].note}</p></div>
    <div class="gauge-wrap">
      <div class="gauge-labels"><span>Exploit · top two</span><span>Explore · all eight</span></div>
      <div class="gauge"><span class="gauge-mark" style="left:${(d.w * 100).toFixed(1)}%"></span><span class="gauge-cut" style="left:40%"></span></div>
      <dl class="stats">
        <div><dt>Explore weight w</dt><dd>${d.w.toFixed(2)}</dd></div>
        <div><dt>Entropy</dt><dd>${d.H.toFixed(2)} / 3.00 bits</dd></div>
        <div><dt>Effective patterns</dt><dd>${d.nEff.toFixed(1)}</dd></div>
        <div><dt>P(leader)</dt><dd>${(d.pLead).toFixed(2)}</dd></div>
      </dl>
    </div>
    <div class="tri">
      <p class="tri-head"><b>Triangulation</b> · ${lead.name} vs ${run.name}: <span class="tri-k">${d.k} of ${K_STOP}</span> independent tests at BF ≥ 3</p>
      ${lines ? `<ul class="lines">${lines}</ul>` : '<p class="muted">No tests completed yet.</p>'}
    </div>`;
}

function renderCands(d, stepIdx) {
  $('#candTitle').textContent = stepIdx != null ? `Ranking at step ${stepIdx + 1}` : 'Next-test ranking';
  $('#candBack').hidden = stepIdx == null;
  if (stepIdx == null && d.stop) {
    $('#cands').innerHTML = `<p class="stop-note">${chip(d.stop.kind)} ${d.stop.text}</p>`;
    return;
  }
  const chosenId = stepIdx != null ? S.trace[stepIdx].t.id : d.choice && d.choice.t.id;
  const rows = d.cands.map(c => `<tr class="${c.t.id === chosenId ? 'chosen' : ''}">
      <td class="tname">${c.t.name}${d.phase === 'confirm' && c.independent ? ' <span class="tag">independent</span>' : ''}</td>
      <td class="num">${c.min.toFixed(1)}</td><td class="num">${c.e.toFixed(2)}</td><td class="num">${c.d.toFixed(2)}</td>
      <td class="ubar"><span class="utrack"><span class="ufill" style="width:${(c.un * 100).toFixed(0)}%"></span></span></td></tr>`).join('');
  $('#cands').innerHTML = `<p class="cand-note">${chip(d.phase)} utility = [w·EIG + (1−w)·D] / minutes, each term scaled to its best candidate. w = ${d.w.toFixed(2)}.</p>
    <div class="tbl-wrap"><table class="cands"><thead><tr><th>Test</th><th class="num">min</th><th class="num">EIG bits</th><th class="num">D nats</th><th>Utility</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderTrace() {
  const ol = $('#trace');
  if (!S.trace.length) { ol.innerHTML = '<li class="trace-empty">No tests yet. The first choice is always the one with the most information per minute against a flat prior.</li>'; return; }
  ol.innerHTML = S.trace.map((e, i) => {
    const res = e.skipped ? '<span class="muted">skipped</span>' : e.t.meas.map(m => `<span>${MEAS[m].label}: <b>${MEAS[m].fmt(e.raw[m])}</b> <i>z ${fmtZ(e.z[m])}</i></span>`).join('');
    const li = e.Pafter.indexOf(Math.max(...e.Pafter));
    return `<li class="${selStep === i ? 'sel' : ''}"><button class="trace-btn" data-step="${i}" aria-label="Show ranking at step ${i + 1}">
      <span class="tnum">${String(i + 1).padStart(2, '0')}</span>
      <span class="tbody"><span class="ttitle">${e.t.name} ${chip(e.phase)}</span><span class="treason">${e.reason}</span><span class="tres">${res}</span><span class="tafter">After: ${HYPS[li].name} ${Math.round(e.Pafter[li] * 100)}%</span></span></button></li>`;
  }).join('');
  ol.querySelectorAll('.trace-btn').forEach(b => b.onclick = () => { selStep = +b.dataset.step === selStep ? null : +b.dataset.step; renderAll(); });
}

function renderProfile(d) {
  const lo = -4, hi = 2, X = z => ((Math.max(lo, Math.min(hi, z)) - lo) / (hi - lo)) * 100;
  const ticks = [-4, -3, -2, -1, 0, 1, 2].map(t => `<span style="left:${X(t)}%">${t > 0 ? '+' + t : t === 0 ? '0' : '−' + Math.abs(t)}</span>`).join('');
  let html = `<div class="prof-row prof-axis"><span></span><span class="axis">${ticks}</span><span class="pvalh">Score · z · %ile</span></div>`;
  for (const dom of DOM_ORDER) {
    html += `<div class="prof-dom">${DOM[dom]}</div>`;
    for (const m of ORDER.filter(k => MEAS[k].dom === dom)) {
      const has = m in S.obs, z = S.obs[m];
      html += `<div class="prof-row ${has ? '' : 'untested'}"><span class="plabel">${MEAS[m].label}</span>
        <span class="ptrack2"><span class="bands"></span>
          <span class="ptick run" style="left:${X(d.run.mu[m])}%" title="${d.run.name} expects ${fmtZ(d.run.mu[m])}"></span>
          <span class="ptick lead" style="left:${X(d.lead.mu[m])}%" title="${d.lead.name} expects ${fmtZ(d.lead.mu[m])}"></span>
          ${has ? `<span class="pdot" style="left:${X(z)}%"></span>` : ''}</span>
        <span class="pv">${has ? `${MEAS[m].fmt(S.raw[m])} · ${fmtZ(z)} · ${pctile(z)}<br><i>${aacn(z)}</i>` : '<span class="muted">not given</span>'}</span></div>`;
    }
  }
  $('#profile').innerHTML = html;
  $('#profLegend').innerHTML = `<span><i class="lg-dot"></i>Obtained</span><span><i class="lg-lead"></i>${d.lead.name} expects</span><span><i class="lg-run"></i>${d.run.name} expects</span>
    <span class="lg-bands"><i class="b-el"></i>Exceptionally low &lt;2 · <i class="b-ba"></i>Below average 2–8 · <i class="b-la"></i>Low average 9–24 · <i class="b-av"></i>Average 25–75 (AACN labels, percentile)</span>`;
}

function renderAll() {
  const d = D;
  renderPost(d); renderPolicy(d);
  renderCands(selStep != null ? S.trace[selStep].d : d, selStep);
  renderTrace(); renderProfile(d);
  const mins = S.minutes;
  if (S.mode === 'sim') $('#screenClock').textContent = `${S.trace.length} tests · ≈${mins.toFixed(1)} min`;
}

// ---------- stimulus monitor (sim) ----------
function stageStep(e) {
  const rows = e.t.meas.map(m => `<tr><td>${MEAS[m].label}</td><td class="num">${MEAS[m].fmt(e.raw[m])}</td><td class="num">${fmtZ(e.z[m])}</td><td>${aacn(e.z[m])}</td></tr>`).join('');
  stage.innerHTML = `<div class="st-card"><p class="st-eyebrow">Step ${S.trace.length} · simulated · ${PHASE[e.phase].label}</p><h3 class="st-title">${e.t.name}</h3><p class="st-why">${e.reason}</p><div class="st-tbl-wrap"><table class="st-tbl"><tbody>${rows}</tbody></table></div></div>`;
}
function stageVerdict() {
  const d = D, kind = d.stop ? d.stop.kind : 'exhausted';
  let truthLine = '';
  if (S.mode === 'sim') {
    const hit = truth.id === d.lead.id;
    truthLine = `<p class="st-truth ${hit ? 'ok' : 'miss'}">True profile: <b>${truth.name}</b>. ${truth.id === 'mixed' ? 'No single pattern is correct; a good engine should refuse to converge.' : hit ? 'The leader matches.' : 'The leader does not match.'}</p>`;
  }
  const head = kind === 'converged' ? `Converged on ${d.lead.name}` : kind === 'narrow' ? `${d.lead.name}, on a single line of evidence` : `Unresolved · best guess ${d.lead.name}`;
  stage.innerHTML = `<div class="st-card verdict"><p class="st-eyebrow">${PHASE[kind].label} · ${S.trace.filter(e => !e.skipped).length} tests · ≈${S.minutes.toFixed(1)} min</p><h3 class="st-title">${head}</h3><p class="st-why">${d.stop ? d.stop.text : 'Session ended by examiner.'}</p>
    <p class="st-dim">${d.lead.desc}</p>${truthLine}
    ${S.mode === 'live' ? '<p class="st-dim">Placeholder norms and illustrative pattern models. This is a demonstration of adaptive test selection, not a clinical result.</p>' : ''}</div>`;
}
function stageSimIdle() {
  stage.innerHTML = `<div class="st-card"><p class="st-eyebrow">Simulated patient · ${truth.name}</p><h3 class="st-title">Ready</h3><p class="st-why">Each step draws z-scores from the true profile with SD ${SIGMA}. The engine sees only the scores. Press Step to watch one decision, or Run to play the session.</p></div>`;
}

// ---------- simulation control ----------
function simReset() {
  stopTimer(); liveToken++;
  const seed = Math.max(1, +$('#seed').value || 1);
  rng = mulberry32(seed * 131 + 7);
  truth = truthProfile($('#truth').value, rng);
  S = newSession('sim'); D = decide(S); selStep = null;
  renderAll(); stageSimIdle();
}
function advance() {
  if (D.stop) return false;
  const c = D.choice; const { z, raw } = simulateTest(c.t, truth, rng);
  applyResult(S, D, c, z, raw);
  D = decide(S);
  if (D.stop) S.status = D.stop.kind;
  selStep = null; renderAll();
  if (D.stop) stageVerdict(); else stageStep(S.trace[S.trace.length - 1]);
  return !D.stop;
}
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } $('#btnRun').textContent = 'Run'; }
function toggleRun() {
  if (timer) { stopTimer(); return; }
  if (D.stop) simReset();
  $('#btnRun').textContent = 'Pause';
  if (!advance()) { stopTimer(); return; }
  timer = setInterval(() => { if (!advance()) stopTimer(); }, 900);
}

// ---------- live session ----------
function nextCard(d) {
  return new Promise(res => {
    const c = d.choice;
    stage.innerHTML = `<div class="st-card"><p class="st-eyebrow">Next · ${PHASE[d.phase].label} · step ${S.trace.length + 1}</p><h3 class="st-title">${c.t.name}</h3><p class="st-why">${reasonFor(d, c)}</p><p class="st-dim">About ${c.t.min} min · ${DOM[c.dom]}</p><div class="st-actions"><button class="st-btn" id="stGo">Begin</button><button class="st-btn ghost" id="stSkip">Skip this test</button></div></div>`;
    stage.querySelector('#stGo').focus({ preventScroll: true });
    stage.querySelector('#stGo').onclick = () => res('go');
    stage.querySelector('#stSkip').onclick = () => res('skip');
  });
}
async function liveSession() {
  stopTimer();
  const token = ++liveToken;
  S = newSession('live'); D = decide(S); selStep = null; renderAll();
  liveStart = performance.now();
  clearInterval(clockTimer);
  clockTimer = setInterval(() => { if (liveToken !== token) return clearInterval(clockTimer); const s = Math.round((performance.now() - liveStart) / 1000); $('#screenClock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} elapsed`; }, 1000);
  $('#btnEnd').disabled = false; $('#btnLive').disabled = true;
  while (liveToken === token) {
    if (D.stop) { S.status = D.stop.kind; stageVerdict(); break; }
    const go = await nextCard(D);
    if (liveToken !== token) return;
    const c = D.choice;
    if (go === 'skip') applyResult(S, D, c, {}, {}, true);
    else {
      let raw;
      try { raw = await RUNNERS[c.t.id](stage); } catch (err) { console.error(err); raw = null; }
      if (liveToken !== token) return;
      if (!raw) applyResult(S, D, c, {}, {}, true);
      else { const z = {}; for (const m in raw) z[m] = rawToZ(m, raw[m]); applyResult(S, D, c, z, raw); }
    }
    D = decide(S); renderAll();
  }
  clearInterval(clockTimer);
  $('#btnEnd').disabled = true; $('#btnLive').disabled = false;
}
function endLive() {
  if (S.mode !== 'live') return;
  liveToken++; clearInterval(clockTimer);
  $('#btnEnd').disabled = true; $('#btnLive').disabled = false;
  D = decide(S); renderAll(); stageVerdict();
}

// ---------- mode switching ----------
function setMode(m) {
  $('#modeSim').setAttribute('aria-pressed', m === 'sim'); $('#modeLive').setAttribute('aria-pressed', m === 'live');
  $('#simCtl').hidden = m !== 'sim'; $('#liveCtl').hidden = m !== 'live';
  $('#screenLabel').textContent = m === 'sim' ? 'Stimulus monitor · simulation' : 'Stimulus monitor · live';
  if (m === 'sim') { simReset(); }
  else {
    stopTimer(); liveToken++;
    S = newSession('live'); D = decide(S); selStep = null; renderAll();
    $('#screenClock').textContent = '';
    $('#btnEnd').disabled = true; $('#btnLive').disabled = false;
    stage.innerHTML = `<div class="st-card"><p class="st-eyebrow">Live session</p><h3 class="st-title">Ready when you are</h3><p class="st-why">Eleven short tasks are available. The engine picks each one from your previous scores and stops as soon as a pattern is triangulated, usually after five to eight tasks.</p><p class="st-dim">Sit at a keyboard if you can, in a quiet room. Scores are compared with placeholder norms, so the result demonstrates the method; it is not a clinical finding.</p><div class="st-actions"><button class="st-btn" id="stBegin">Start session</button></div></div>`;
    stage.querySelector('#stBegin').onclick = liveSession;
  }
}

// ---------- boot ----------
$('#truth').innerHTML = HYPS.map(h => `<option value="${h.id}">${h.name}</option>`).join('') + '<option value="mixed">Mixed (amnestic + slowing)</option><option value="random">Random pattern</option>';
$('#truth').value = 'amn'; $('#seed').value = 2;
$('#modeSim').onclick = () => setMode('sim');
$('#modeLive').onclick = () => setMode('live');
$('#btnRun').onclick = toggleRun;
$('#btnStep').onclick = () => { stopTimer(); if (D.stop) simReset(); else advance(); };
$('#btnReset').onclick = simReset;
$('#truth').onchange = simReset; $('#seed').onchange = simReset;
$('#btnLive').onclick = liveSession; $('#btnEnd').onclick = endLive;
$('#candBack').onclick = () => { selStep = null; renderAll(); };

// Open on a completed example run so every panel shows real output
simReset();
while (advance()) { /* run to the end */ }
