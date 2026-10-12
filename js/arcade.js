// ===== Mind Arcade: game front end over the same engine =====
const $ = s => document.querySelector(s);
const stage = $('#stage');
const LV = {
  dsf:    { name: 'Echo Chamber',    glyph: '739',  tint: 'sky',       blurb: 'Watch the digits, then say them back.' },
  dsb:    { name: 'Rewind',          glyph: '937',  tint: 'violet',    blurb: 'Same digits, played in reverse.' },
  gng:    { name: 'Dodge the X',     glyph: 'X',    tint: 'pink',      blurb: 'Smash every letter. Freeze on X.' },
  stroop: { name: 'Color Clash',     glyph: 'Aa',   tint: 'tangerine', blurb: 'Name the ink, ignore the word.' },
  trails: { name: 'Dot Dash',        glyph: '1·A',  tint: 'mint',      blurb: 'Connect the dots as fast as you can.' },
  wl:     { name: 'Word Vault',      glyph: 'abc',  tint: 'lemon',     blurb: 'Lock ten words in your memory.' },
  wld:    { name: 'Vault Return',    glyph: 'abc?', tint: 'lemon',     blurb: 'Open the vault. What is still inside?' },
  flus:   { name: 'Animal Stampede', glyph: 'zoo',  tint: 'mint',      blurb: 'Every animal you can think of, in a minute.' },
  flup:   { name: 'F-Frenzy',        glyph: 'F!',   tint: 'tangerine', blurb: 'Words that start with F, in a minute.' },
  nam:    { name: 'Riddle Me This',  glyph: '?',    tint: 'violet',    blurb: 'Read the clue, find the word.' },
  rot:    { name: 'Flip or Spin',    glyph: '↻',    tint: 'sky',       blurb: 'Same shape turned, or its mirror?' },
};
const ABBR = ['Ty', 'Am', 'Dx', 'At', 'Se', 'Vs', 'Sl', 'Mo'];
const ORB = ['sky', 'pink', 'tangerine', 'mint', 'lemon', 'violet', 'coral', 'teal'];
const MODE = {
  explore: { label: 'Scanning wide', line: 'This level tells me the most about every hunch at once.' },
  exploit: { label: 'Zeroing in', line: 'This level settles it between my top two hunches.' },
  confirm: { label: 'Double-checking', line: 'I have a strong hunch. Now I want a second, different kind of clue.' },
  converged: { label: 'Locked on', line: 'Two separate clues point the same way.' },
  narrow: { label: 'One good clue', line: 'Very sure, but it rests on a single level.' },
  exhausted: { label: 'Still a mystery', line: 'Every level played and no single pattern stood out.' },
};

let S, D, token = 0, demo = false, truth = null, rng = null, xp = 0, examiner = false, sound = true, startT = 0;

// ---------- sound ----------
let actx = null;
function beep(freqs, dur = 0.09, type = 'square', gap = 0.07) {
  if (!sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    freqs.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * gap;
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    });
  } catch (e) { /* audio unavailable */ }
}

// ---------- views ----------
function show(view) { for (const v of ['title', 'board', 'cabinet', 'finale']) $('#v-' + v).hidden = v !== view; $('#btnQuit2').hidden = view === 'title'; }

function renderBoard(nextId) {
  const pend = new Set((D && D.pending || []).map(t => t.id));
  $('#levels').innerHTML = TESTS.map(t => {
    const L = LV[t.id], played = S.completed.has(t.id), skipped = S.done.has(t.id) && !played;
    let state = played ? 'played' : skipped ? 'skipped' : '';
    let sub = `about ${t.min} min`;
    if (t.requires && !S.completed.has(t.requires) && !S.done.has(t.id)) { state += ' locked'; sub = `opens after ${LV[t.requires].name}`; }
    else if (pend.has(t.id)) { state += ' locked'; const left = t.gap - (S.order.length - S.order.indexOf(t.requires) - 1); sub = `opens in ${left} level${left === 1 ? '' : 's'}`; }
    if (t.id === nextId) state += ' next';
    return `<div class="lv t-${L.tint} ${state}" data-id="${t.id}"><span class="lv-glyph">${L.glyph}</span><span class="lv-name">${L.name}</span><span class="lv-sub">${played ? 'Cleared' : skipped ? 'Skipped' : sub}</span></div>`;
  }).join('');
}

function renderHUD() {
  const d = D, kind = d.stop ? d.stop.kind : d.phase;
  // orbs drift toward the center as their probability grows
  const svgOrbs = HYPS.map((h, i) => {
    const p = d.P[i], ang = (i / HYPS.length) * Math.PI * 2 - Math.PI / 2;
    const r = 78 * (1 - 0.95 * Math.pow(p, 0.6)), x = 100 + r * Math.cos(ang), y = 100 + r * Math.sin(ang);
    const s = 0.35 + 1.15 * Math.sqrt(p);
    const isLead = i === d.idx[0];
    return `<g class="orb o-${ORB[i]} ${isLead ? 'lead' : ''}" style="transform:translate(${x.toFixed(1)}px,${y.toFixed(1)}px)"><g style="transform:scale(${s.toFixed(3)})"><circle r="14"/><text dy="5">${examiner ? ABBR[i] : String.fromCharCode(65 + i)}</text></g></g>`;
  }).join('');
  const C = 2 * Math.PI * 92;
  $('#radar').innerHTML = `<circle class="rad-ring" cx="100" cy="100" r="78"/><circle class="rad-ring faint" cx="100" cy="100" r="44"/>
    <circle class="lock-track" cx="100" cy="100" r="92"/><circle class="lock-arc" cx="100" cy="100" r="92" style="stroke-dasharray:${(C * d.pLead).toFixed(1)} ${C.toFixed(1)}"/>
    <line class="cross" x1="100" y1="${d.k >= 1 ? 8 : 100}" x2="100" y2="${d.k >= 1 ? 192 : 100}"/><line class="cross" x1="${d.k >= 2 ? 8 : 100}" y1="100" x2="${d.k >= 2 ? 192 : 100}" y2="100"/>${svgOrbs}`;
  $('#lockPct').textContent = `${Math.round(d.pLead * 100)}%`;
  $('#modeBadge').textContent = MODE[kind].label; $('#modeBadge').className = `mode m-${kind}`;
  $('#clues').innerHTML = [0, 1].map(i => `<span class="clue ${d.k > i ? 'on' : ''}"></span>`).join('') + `<span>${d.k >= 2 ? 'Two clues agree' : d.k === 1 ? 'One clue so far' : 'No solid clue yet'}</span>`;
  $('#xp').textContent = xp;
  // examiner detail
  $('#exam').hidden = !examiner;
  if (examiner) {
    const rows = HYPS.map((h, i) => ({ h, p: d.P[i], i })).sort((a, b) => b.p - a.p)
      .map(({ h, p, i }) => `<li><span class="sw o-${ORB[i]}"></span><span>${h.name}</span><b>${p < 0.005 ? '<1' : Math.round(p * 100)}%</b></li>`).join('');
    $('#exam').innerHTML = `<ul class="exam-list">${rows}</ul><p class="exam-stats">Explore weight ${d.w.toFixed(2)} · entropy ${d.H.toFixed(2)} bits · ${d.lead.name} vs ${d.run.name}, ${d.k} of 2 tests at BF ≥ 3</p>`;
  }
}

function confetti(n = 36) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('#fx');
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.className = `cf o-${ORB[i % ORB.length]}`;
    s.style.left = `${40 + Math.random() * 20}%`;
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 520}px`);
    s.style.setProperty('--dy', `${-180 - Math.random() * 260}px`);
    s.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    s.style.animationDelay = `${Math.random() * 80}ms`;
    box.appendChild(s); setTimeout(() => s.remove(), 1500);
  }
}

// The engine has already chosen; the roulette is theater that lands on its pick.
async function pickAnim(tok) {
  const c = D.choice; const top = D.cands.slice(0, Math.min(5, D.cands.length)).map(x => x.t.id);
  renderBoard(null);
  $('#pickNote').innerHTML = `<b>${MODE[D.phase].label}…</b> choosing your next level`;
  $('#nextBar').hidden = true;
  const fast = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hops = fast ? 1 : 9;
  for (let i = 0; i < hops; i++) {
    if (tok !== token) return;
    const id = i === hops - 1 ? c.t.id : top[(i * 3 + 1) % top.length];
    document.querySelectorAll('.lv.hop').forEach(e => e.classList.remove('hop'));
    const el = document.querySelector(`.lv[data-id="${id}"]`); if (el) el.classList.add('hop');
    beep([340 + i * 40], 0.04, 'square');
    await sleep(70 + i * i * 7);
  }
  renderBoard(c.t.id); beep([660, 880], 0.1, 'triangle');
  const L = LV[c.t.id];
  $('#pickNote').innerHTML = `<b>${MODE[D.phase].label}.</b> ${MODE[D.phase].line}`;
  $('#nextName').textContent = L.name; $('#nextBlurb').textContent = L.blurb;
  $('#nextWhy').textContent = reasonFor(D, c); $('#nextWhy').hidden = !examiner;
  $('#nextBar').hidden = false;
  $('#btnPlay').hidden = demo; $('#btnSkip').hidden = demo;
  if (!demo) $('#btnPlay').focus({ preventScroll: true });
}
function waitNext() {
  return new Promise(res => { $('#btnPlay').onclick = () => res('go'); $('#btnSkip').onclick = () => res('skip'); });
}

async function cleared(t) {
  xp += 100;
  $('#clearName').textContent = LV[t.id].name;
  $('#clearCard').hidden = false; confetti(); beep([523, 659, 784, 1047], 0.12, 'triangle', 0.08);
  renderHUD();
  await sleep(demo ? 900 : 1400);
  $('#clearCard').hidden = true;
}

async function botPlay(t) {
  stage.innerHTML = `<div class="st-card bot"><p class="st-eyebrow">Demo bot</p><h3 class="st-title">${LV[t.id].name}</h3><div class="botbar"><span></span></div><p class="st-dim">The bot answers like a person with a hidden pattern. You'll see which one at the end.</p></div>`;
  await sleep(1100);
}

async function run(isDemo) {
  const tok = ++token; demo = isDemo; xp = 0; startT = performance.now();
  S = newSession(isDemo ? 'sim' : 'live'); D = decide(S);
  if (isDemo) { rng = mulberry32(Math.floor(Math.random() * 1e9)); truth = truthProfile('random', rng); }
  $('#who').textContent = isDemo ? 'Demo bot playing' : 'You are playing';
  show('board'); renderBoard(); renderHUD();
  while (tok === token) {
    if (D.stop) { finale(); return; }
    await pickAnim(tok); if (tok !== token) return;
    const act = isDemo ? (await sleep(900), 'go') : await waitNext();
    if (tok !== token) return;
    const c = D.choice;
    if (act === 'skip') applyResult(S, D, c, {}, {}, true);
    else {
      show('cabinet');
      $('#cabTitle').textContent = LV[c.t.id].name;
      $('#cabLevel').textContent = `Level ${S.trace.length + 1}`;
      let z = {}, raw = null;
      if (isDemo) { await botPlay(c.t); ({ z, raw } = simulateTest(c.t, truth, rng)); }
      else {
        try { raw = await RUNNERS[c.t.id](stage); } catch (e) { console.error(e); }
        if (raw) for (const m in raw) z[m] = rawToZ(m, raw[m]);
      }
      if (tok !== token) return;
      if (raw) applyResult(S, D, c, z, raw); else applyResult(S, D, c, {}, {}, true);
      D = decide(S);
      if (raw) await cleared(c.t);
      if (tok !== token) return;
    }
    D = decide(S);
    show('board'); renderBoard(); renderHUD();
  }
}

function finale() {
  const d = D, kind = d.stop ? d.stop.kind : 'exhausted';
  S.status = kind; const first = !S.bonus; if (first) { S.bonus = true; if (kind === 'converged') xp += 300; }
  show('finale'); renderHUD();
  const mins = (performance.now() - startT) / 60000;
  $('#finTitle').textContent = kind === 'converged' ? 'Profile locked' : kind === 'narrow' ? 'One good clue' : 'Still a mystery';
  $('#finLine').textContent = MODE[kind].line;
  const leadIdx = d.idx[0];
  let reveal = examiner
    ? `<p class="fin-pattern"><span class="sw o-${ORB[leadIdx]}"></span>Best match: <b>${d.lead.name}</b> at ${Math.round(d.pLead * 100)}%. ${d.lead.desc}</p>`
    : `<p class="fin-pattern"><span class="sw o-${ORB[leadIdx]}"></span>Orb ${String.fromCharCode(65 + leadIdx)} won at ${Math.round(d.pLead * 100)}%. Switch on Examiner view to see what it stands for.</p>`;
  if (demo) reveal += `<p class="fin-truth ${truth.id === d.lead.id ? 'ok' : 'miss'}">The bot was secretly playing as <b>${truth.name}</b>. ${truth.id === d.lead.id ? 'The engine found it.' : 'The engine did not pin it down this time.'}</p>`;
  $('#finReveal').innerHTML = reveal;
  $('#finStats').innerHTML = `<div><b>${S.completed.size}</b><span>levels played</span></div><div><b>${demo ? S.minutes.toFixed(1) : mins.toFixed(1)}</b><span>minutes${demo ? ' (simulated)' : ''}</span></div><div><b>${xp}</b><span>XP</span></div>`;
  $('#finPath').innerHTML = S.trace.map(e => `<li class="t-${LV[e.t.id].tint} ${e.skipped ? 'skipped' : ''}"><span>${LV[e.t.id].name}</span><em>${MODE[e.phase].label}</em></li>`).join('');
  if (first && kind === 'converged') { confetti(60); beep([523, 659, 784, 1047, 1319], 0.16, 'triangle', 0.1); }
}

function toTitle() { token++; show('title'); S = newSession('live'); D = decide(S); renderHUD(); }

// ---------- boot ----------
$('#btnStart').onclick = () => run(false);
$('#btnDemo').onclick = () => run(true);
$('#btnQuit2').onclick = toTitle;
$('#btnAgain').onclick = () => run(demo);
$('#btnHome').onclick = toTitle;
$('#examToggle').onchange = e => { examiner = e.target.checked; renderHUD(); if (!$('#v-finale').hidden) finale(); $('#nextWhy').hidden = !examiner; };
$('#soundToggle').onclick = () => { sound = !sound; $('#soundToggle').setAttribute('aria-pressed', sound); $('#soundToggle').textContent = sound ? 'Sound on' : 'Sound off'; };
S = newSession('live'); D = decide(S); renderHUD(); show('title');
