// ===== Live test implementations (render into the stimulus monitor) =====
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = n => Math.floor(Math.random() * n);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function lev(a, b) {
  const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function intro(stage, title, html, label = 'Start') {
  return new Promise(res => {
    stage.innerHTML = `<div class="st-card"><p class="st-eyebrow">${title}</p><div class="st-instr">${html}</div><div class="st-actions"><button class="st-btn" id="stGo">${label}</button></div></div>`;
    const b = stage.querySelector('#stGo'); b.focus({ preventScroll: true }); b.onclick = () => res();
  });
}
async function showBig(stage, text, on, off, cls = '') {
  stage.innerHTML = `<div class="st-center"><div class="st-big ${cls}">${esc(text)}</div></div>`;
  await sleep(on);
  stage.innerHTML = `<div class="st-center"><div class="st-big ${cls}"></div></div>`;
  await sleep(off);
}
function askText(stage, prompt, numeric) {
  return new Promise(res => {
    stage.innerHTML = `<div class="st-card"><p class="st-prompt">${prompt}</p><div class="st-entry-row"><input id="stIn" class="st-input" autocomplete="off" autocapitalize="off" spellcheck="false" ${numeric ? 'inputmode="numeric"' : ''}><button class="st-btn" id="stOk">Submit</button></div></div>`;
    const i = stage.querySelector('#stIn'), b = stage.querySelector('#stOk');
    i.focus({ preventScroll: true });
    const done = () => res(i.value);
    b.onclick = done; i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done(); } };
  });
}
// Chip-style word entry. With `seconds`, a countdown ends it; otherwise a Done button.
function wordEntry(stage, prompt, { seconds = 0, splitSpaces = false, timed = false } = {}) {
  return new Promise(res => {
    stage.innerHTML = `<div class="st-card st-entry"><p class="st-prompt">${prompt}</p>
      <div class="st-entry-row"><input id="stWord" class="st-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="type a word, press Enter"><button class="st-btn ghost" id="stAdd">Add</button></div>
      <div class="st-chips" id="stChips"></div>
      <div class="st-entry-foot">${seconds ? `<span class="st-clock" id="stClock">${seconds}</span><span class="st-dim">seconds left</span>` : '<span class="st-dim" id="stCount">0 words</span>'}${seconds ? '' : '<button class="st-btn" id="stDone">Done</button>'}</div></div>`;
    const inp = stage.querySelector('#stWord'), chips = stage.querySelector('#stChips');
    const words = [], stamps = []; let finished = false; const tStart = performance.now();
    const draw = () => { chips.innerHTML = words.map(w => `<span class="st-chip">${esc(w)}</span>`).join(''); const c = stage.querySelector('#stCount'); if (c) c.textContent = `${words.length} word${words.length === 1 ? '' : 's'}`; };
    const add = () => {
      const parts = inp.value.split(splitSpaces ? /[\s,;]+/ : /[,;]+/).map(x => x.trim()).filter(Boolean);
      const ts = (performance.now() - tStart) / 1000;
      for (const p of parts) { words.push(p); stamps.push({ w: p, t: ts }); }
      inp.value = ''; draw(); inp.focus({ preventScroll: true });
    };
    const finish = () => { if (finished) return; finished = true; add(); res(timed ? stamps : words); };
    inp.focus({ preventScroll: true });
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    stage.querySelector('#stAdd').onclick = add;
    const done = stage.querySelector('#stDone'); if (done) done.onclick = finish;
    if (seconds) {
      const t0 = performance.now(), clock = stage.querySelector('#stClock');
      const tick = () => { if (finished) return; const left = Math.max(0, seconds - (performance.now() - t0) / 1000); clock.textContent = Math.ceil(left); if (left <= 0) finish(); else setTimeout(tick, 200); };
      tick();
    }
  });
}
// Wait for one of several choices by button or key. Returns {i, rt}; i = -1 on timeout.
function choose(stage, keys, timeout) {
  return new Promise(res => {
    const t0 = performance.now(); let done = false;
    const btns = [...stage.querySelectorAll('[data-choice]')];
    const fin = i => { if (done) return; done = true; document.removeEventListener('keydown', kd); res({ i, rt: performance.now() - t0 }); };
    const kd = e => { const i = keys.indexOf(e.key.toLowerCase()); if (i >= 0) { e.preventDefault(); fin(i); } };
    document.addEventListener('keydown', kd);
    btns.forEach(b => b.onclick = () => fin(+b.dataset.choice));
    if (timeout) setTimeout(() => fin(-1), timeout);
  });
}
const median = a => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

// --- Digit span: two trials per length, stop when both fail (WAIS-style discontinue) ---
async function runDigitSpan(stage, backward) {
  await intro(stage, backward ? 'Digit span · backward' : 'Digit span · forward',
    `Digits will appear one at a time. When they stop, type them ${backward ? '<b>in reverse order</b>. If you see 3 8 2, type 2 8 3.' : '<b>in the same order</b>.'}<br>Sequences get longer as you go.`);
  const start = backward ? 2 : 3, max = backward ? 8 : 9;
  let span = start - 1;
  for (let len = start; len <= max; len++) {
    let ok = 0;
    for (let t = 0; t < 2; t++) {
      const seq = []; while (seq.length < len) { const d = rnd(10); if (d !== seq[seq.length - 1]) seq.push(d); }
      await showBig(stage, '·', 500, 200, 'dim');
      for (const d of seq) await showBig(stage, d, 800, 220);
      const ans = (await askText(stage, backward ? 'Type the digits <b>backward</b>' : 'Type the digits', true)).replace(/\D/g, '');
      const target = (backward ? seq.slice().reverse() : seq).join('');
      if (ans === target) ok++;
    }
    if (!ok) break;
    span = len;
  }
  return { [backward ? 'dsb' : 'dsf']: span };
}

// --- Go / No-Go ---
async function runGoNoGo(stage) {
  await intro(stage, 'Go / No-Go', `Letters will flash in the center. <b>Respond as fast as you can to every letter except X</b>: press <kbd>Space</kbd> or tap the pad.<br>When you see <b>X</b>, do nothing. About 55 seconds.`);
  const letters = 'ABCDEFHKLMNPRSTUVZ', n = 44, nNo = 10;
  let seq;
  do { seq = shuffle(Array.from({ length: n }, (_, i) => i < nNo ? 'X' : letters[rnd(letters.length)])); } while (seq[0] === 'X' || seq[1] === 'X');
  stage.innerHTML = `<div class="st-trial"><div class="st-center"><div class="st-big" id="gL"></div></div><button class="st-pad" id="gPad" aria-label="Respond">Tap</button></div>`;
  const L = stage.querySelector('#gL'), pad = stage.querySelector('#gPad');
  let cur = null;
  const resp = () => { if (cur && cur.rt == null) { cur.rt = performance.now() - cur.onset; pad.classList.add('hit'); setTimeout(() => pad.classList.remove('hit'), 120); } };
  const kd = e => { if (e.code === 'Space') { e.preventDefault(); resp(); } };
  document.addEventListener('keydown', kd);
  pad.addEventListener('pointerdown', e => { e.preventDefault(); resp(); });
  await sleep(900);
  const rec = [];
  for (const ch of seq) {
    cur = { onset: performance.now(), rt: null, ch }; L.textContent = ch;
    await sleep(300); L.textContent = '';
    await sleep(850 + Math.random() * 300);
    rec.push(cur);
  }
  cur = null; document.removeEventListener('keydown', kd);
  const nogo = rec.filter(r => r.ch === 'X');
  const comm = nogo.filter(r => r.rt != null).length / nogo.length;
  const hits = rec.filter(r => r.ch !== 'X' && r.rt != null && r.rt > 120).map(r => r.rt);
  let cv = 0.5;
  if (hits.length >= 5) { const m = hits.reduce((a, b) => a + b, 0) / hits.length; const sd = Math.sqrt(hits.reduce((a, b) => a + (b - m) ** 2, 0) / (hits.length - 1)); cv = sd / m; }
  return { gng_comm: comm, gng_cv: cv };
}

// --- Color–word interference (Stroop) ---
const SCOL = [{ n: 'RED', c: 'var(--st-red)', k: 'r' }, { n: 'GREEN', c: 'var(--st-green)', k: 'g' }, { n: 'BLUE', c: 'var(--st-blue)', k: 'b' }, { n: 'YELLOW', c: 'var(--st-yellow)', k: 'y' }];
async function runStroop(stage) {
  await intro(stage, 'Color–word interference', `A color word will appear. Respond to the <b>ink color</b>, not the word.<br>Keys: <kbd>R</kbd> red · <kbd>G</kbd> green · <kbd>B</kbd> blue · <kbd>Y</kbd> yellow, or tap the buttons. Go fast, but stay accurate.`);
  const trials = [];
  for (let i = 0; i < 16; i++) { const c = i % 4; trials.push({ w: c, c, cong: true }); }
  for (let i = 0; i < 16; i++) { const c = i % 4; let w; do { w = rnd(4); } while (w === c); trials.push({ w, c, cong: false }); }
  shuffle(trials);
  const btns = SCOL.map((s, i) => `<button class="st-btn ghost" data-choice="${i}">${s.n.toLowerCase()} <kbd>${s.k.toUpperCase()}</kbd></button>`).join('');
  const res = [];
  for (const t of trials) {
    stage.innerHTML = `<div class="st-trial"><div class="st-center"><div class="st-big">+</div></div><div class="st-choices">${btns}</div></div>`;
    await sleep(380);
    stage.querySelector('.st-big').outerHTML = `<div class="st-big st-word" style="color:${SCOL[t.c].c}">${SCOL[t.w].n}</div>`;
    const { i, rt } = await choose(stage, SCOL.map(s => s.k), 0);
    res.push({ ...t, rt, ok: i === t.c });
  }
  const rc = res.filter(r => r.cong && r.ok).map(r => r.rt), ri = res.filter(r => !r.cong && r.ok).map(r => r.rt);
  const errI = res.filter(r => !r.cong && !r.ok).length, errC = res.filter(r => r.cong && !r.ok).length;
  return { stroop: median(ri) - median(rc) + 80 * Math.max(0, errI - errC) };
}

// --- Trail Making A & B ---
function trailPart(stage, labels, title) {
  return new Promise(res => {
    stage.innerHTML = `<div class="st-trail-wrap"><p class="st-eyebrow">${title}</p><div class="st-trail"><svg class="st-trail-lines" aria-hidden="true"></svg></div></div>`;
    const box = stage.querySelector('.st-trail'), svg = box.querySelector('svg');
    const { width: W, height: H } = box.getBoundingClientRect();
    const R = 21, pad = R + 6; let minD = Math.min(W, H) * 0.17; const pts = [];
    for (let tries = 0; pts.length < labels.length; tries++) {
      if (tries > 3000) { minD *= 0.9; tries = 0; }
      const p = [pad + Math.random() * (W - 2 * pad), pad + Math.random() * (H - 2 * pad)];
      if (pts.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) >= minD)) pts.push(p);
    }
    let next = 0; const t0 = performance.now();
    labels.forEach((lab, i) => {
      const b = document.createElement('button');
      b.className = 'st-node'; b.textContent = lab;
      b.style.left = `${(pts[i][0] / W) * 100}%`; b.style.top = `${(pts[i][1] / H) * 100}%`;
      b.onclick = () => {
        if (i === next) {
          b.classList.add('done');
          if (i > 0) {
            const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            l.setAttribute('x1', `${(pts[i - 1][0] / W) * 100}%`); l.setAttribute('y1', `${(pts[i - 1][1] / H) * 100}%`);
            l.setAttribute('x2', `${(pts[i][0] / W) * 100}%`); l.setAttribute('y2', `${(pts[i][1] / H) * 100}%`);
            svg.appendChild(l);
          }
          next++;
          if (next === labels.length) { const t = (performance.now() - t0) / 1000; setTimeout(() => res(t), 350); }
        } else if (!b.classList.contains('done')) { b.classList.add('wrong'); setTimeout(() => b.classList.remove('wrong'), 350); }
      };
      box.appendChild(b);
    });
  });
}
async function runTrails(stage) {
  await intro(stage, 'Trail making · part A', `Tap the circles in order as fast as you can: <b>1 → 2 → 3 …</b> up to 16. A wrong tap flashes red; just carry on from where you were.`);
  const a = await trailPart(stage, Array.from({ length: 16 }, (_, i) => String(i + 1)), 'Part A · 1 → 16');
  await intro(stage, 'Trail making · part B', `Now alternate numbers and letters: <b>1 → A → 2 → B → 3 → C …</b> ending at <b>H</b>.`, 'Start part B');
  const lb = []; for (let i = 1; i <= 8; i++) lb.push(String(i), String.fromCharCode(64 + i));
  const b = await trailPart(stage, lb, 'Part B · 1 → A → 2 → B …');
  return { tmtA: a, tmtBA: b - a };
}

// --- Word list learning, delayed recall, recognition ---
const POOL = ['anchor', 'basket', 'candle', 'donkey', 'eagle', 'forest', 'guitar', 'harbor', 'island', 'jacket', 'kettle', 'lemon', 'mirror', 'needle', 'orchard', 'pencil', 'rabbit', 'saddle', 'tunnel', 'violin', 'wagon', 'blanket', 'cactus', 'feather', 'glacier', 'hammer', 'lantern', 'marble', 'pillow', 'ribbon', 'spoon', 'tiger', 'walnut', 'canyon'];
let WL = null;
function scoreRecall(words, targets) {
  const got = new Set();
  for (let w of words) {
    w = w.toLowerCase().replace(/[^a-z]/g, ''); if (!w) continue;
    const hit = targets.find(t => t === w || t === w.replace(/s$/, '') || (t.length >= 5 && lev(t, w) <= 1));
    if (hit) got.add(hit);
  }
  return got.size;
}
async function runWordLearn(stage) {
  const pool = shuffle(POOL.slice()); WL = { targets: pool.slice(0, MEMN), foils: pool.slice(MEMN, 2 * MEMN) };
  await intro(stage, 'Word list learning', `${MEMN} words will appear one at a time. Afterwards, type every word you remember, in any order. We will do this <b>${MEM_TRIALS} times</b> with the same list.<br>Keep them in mind: you will be asked about them again later.`);
  const ks = [];
  for (let tr = 1; tr <= MEM_TRIALS; tr++) {
    for (const w of WL.targets) await showBig(stage, w, 1300, 250, 'word');
    const got = await wordEntry(stage, `Trial ${tr} of ${MEM_TRIALS} · type every word you remember`, { splitSpaces: true });
    ks.push(scoreRecall(got, WL.targets));
    if (tr < MEM_TRIALS) await intro(stage, 'Word list learning', 'Same list again. Try to remember as many as you can, including the ones you already said.', 'Show the list');
  }
  return { ks };
}
async function runWordDelay(stage) {
  if (!WL) return null;
  await intro(stage, 'Delayed recall', `Earlier you learned a list of ${MEMN} words. Type as many of them as you can remember now.`);
  const got = await wordEntry(stage, 'Type every word you remember from the list', { splitSpaces: true });
  const del = scoreRecall(got, WL.targets);
  await intro(stage, 'Recognition', 'Words will appear one at a time. Was each one on the list?<br>Press <kbd>Y</kbd> for yes or <kbd>N</kbd> for no, or tap.');
  const items = shuffle(WL.targets.map(w => ({ w, old: true })).concat(WL.foils.map(w => ({ w, old: false }))));
  let hit = 0, fa = 0;
  for (const it of items) {
    stage.innerHTML = `<div class="st-trial"><div class="st-center"><div class="st-big word">${it.w}</div></div><div class="st-choices"><button class="st-btn ghost" data-choice="0">Yes, on the list <kbd>Y</kbd></button><button class="st-btn ghost" data-choice="1">No <kbd>N</kbd></button></div></div>`;
    const { i } = await choose(stage, ['y', 'n'], 0);
    if (i === 0 && it.old) hit++; if (i === 0 && !it.old) fa++;
    await sleep(150);
  }
  return { kd: del, hits: hit, fas: fa };
}

// --- Verbal fluency ---
async function runFluency(stage, kind) {
  const sem = kind === 'sem';
  await intro(stage, sem ? 'Category fluency' : 'Letter fluency', sem
    ? 'For <b>60 seconds</b>, type as many different <b>animals</b> as you can. Press Enter after each one.'
    : 'For <b>60 seconds</b>, type as many different words as you can that begin with the letter <b>F</b>. No names of people or places, and no repeats with different endings. Press Enter after each one.');
  const entries = await wordEntry(stage, sem ? 'Animals' : 'Words beginning with <b>F</b>', { seconds: 60, timed: true });
  const seen = new Set(), times = [];
  for (const { w: raw, t } of entries) {
    const w = raw.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!/^[a-z][a-z' -]{2,}$/.test(w)) continue;
    if (!sem && w[0] !== 'f') continue;
    const stem = w.replace(/(es|s|ing|ed)$/, '');
    if (seen.has(stem)) continue;
    seen.add(stem); times.push(t);
  }
  return { times };
}

// --- Responsive naming (ordered easy → hard, discontinue after 4 consecutive misses) ---
const NAMING = [
  ['What do you use to cut paper?', ['scissors', 'scissor', 'shears']],
  ['A very large grey animal with a trunk.', ['elephant']],
  ['A musical instrument with black and white keys.', ['piano', 'keyboard', 'pianoforte']],
  ['A device with a needle that always points north.', ['compass']],
  ['An instrument for looking at distant stars and planets.', ['telescope']],
  ['What a doctor uses to listen to your heart.', ['stethoscope']],
  ['A three-legged stand that holds a painter’s canvas.', ['easel']],
  ['An instrument that measures air pressure, used in weather forecasting.', ['barometer']],
  ['A device that ticks at a steady, adjustable beat for musicians.', ['metronome']],
  ['A bridge-like structure built to carry water across a valley.', ['aqueduct']],
  ['The wedge-shaped stone at the top of an arch that locks it in place.', ['keystone', 'capstone']],
  ['A navigator’s instrument for measuring the sun’s angle above the horizon.', ['sextant', 'octant', 'astrolabe', 'quadrant']],
];
async function runNaming(stage) {
  await intro(stage, 'Responsive naming', 'You will read a short description. Type the single word it describes. If it does not come to you, choose <b>Don’t know</b>.');
  let score = 0, miss = 0;
  for (let n = 0; n < NAMING.length; n++) {
    const [q, ans] = NAMING[n];
    const reply = await new Promise(res => {
      stage.innerHTML = `<div class="st-card"><p class="st-eyebrow">Item ${n + 1} of ${NAMING.length}</p><p class="st-prompt">${q}</p><div class="st-entry-row"><input id="stIn" class="st-input" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="st-btn" id="stOk">Submit</button><button class="st-btn ghost" id="stDk">Don’t know</button></div></div>`;
      const i = stage.querySelector('#stIn'); i.focus({ preventScroll: true });
      stage.querySelector('#stOk').onclick = () => res(i.value);
      stage.querySelector('#stDk').onclick = () => res('');
      i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); res(i.value); } };
    });
    const w = reply.toLowerCase().replace(/[^a-z]/g, '');
    const ok = !!w && ans.some(a => a === w || a === w.replace(/s$/, '') || (a.length >= 6 && lev(a, w) <= 1));
    if (ok) { score++; miss = 0; } else if (++miss >= 4) break;
  }
  return { naming: score };
}

// --- Mental rotation (2D pentominoes, same vs mirror, 5 s limit) ---
const SHAPES = [[[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]], [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3]], [[0, 1], [1, 0], [1, 1], [1, 2], [1, 3]], [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]]];
function drawShape(ctx, cells, cx, cy, s, ang, mirror) {
  const gx = cells.reduce((a, c) => a + c[0] + 0.5, 0) / cells.length, gy = cells.reduce((a, c) => a + c[1] + 0.5, 0) / cells.length;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang * Math.PI / 180); if (mirror) ctx.scale(-1, 1);
  for (const [x, y] of cells) { ctx.fillRect((x - gx) * s + 1, (y - gy) * s + 1, s - 2, s - 2); }
  ctx.restore();
}
async function runRotation(stage) {
  await intro(stage, 'Mental rotation', 'Two shapes appear side by side. Is the right one the <b>same</b> shape turned around, or its <b>mirror image</b>?<br><kbd>S</kbd> same · <kbd>M</kbd> mirror, or tap. Be quick but accurate.');
  const trials = [], angles = shuffle(Array.from({ length: 20 }, (_, i) => ROT_ANGLES[i % ROT_ANGLES.length]));
  for (let n = 0; n < angles.length; n++) {
    const shape = SHAPES[rnd(SHAPES.length)], base = rnd(360), delta = angles[n] * (Math.random() < 0.5 ? -1 : 1), mirror = Math.random() < 0.5;
    stage.innerHTML = `<div class="st-trial"><canvas class="st-canvas" aria-label="Two shapes"></canvas><div class="st-choices"><button class="st-btn ghost" data-choice="0">Same <kbd>S</kbd></button><button class="st-btn ghost" data-choice="1">Mirror <kbd>M</kbd></button></div></div>`;
    const cv = stage.querySelector('canvas'), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const s = Math.min(r.width / 12, r.height / 5.2);
    ctx.fillStyle = getComputedStyle(stage).getPropertyValue('--screen-ink').trim() || '#EDEFEA';
    drawShape(ctx, shape, r.width * 0.27, r.height / 2, s, base, false);
    drawShape(ctx, shape, r.width * 0.73, r.height / 2, s, base + delta, mirror);
    const { i, rt } = await choose(stage, ['s', 'm'], ROT_DEADLINE * 1000);
    trials.push({ angle: angles[n], correct: i === (mirror ? 1 : 0), rt: i < 0 ? null : rt / 1000 });
    stage.innerHTML = ''; await sleep(300);
  }
  return { trials };
}

const RUNNERS = {
  dsf: s => runDigitSpan(s, false), dsb: s => runDigitSpan(s, true), gng: runGoNoGo, stroop: runStroop, trails: runTrails,
  wl: runWordLearn, wld: runWordDelay, flus: s => runFluency(s, 'sem'), flup: s => runFluency(s, 'pho'), nam: runNaming, rot: runRotation,
};
