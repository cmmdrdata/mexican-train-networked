'use strict';
// The score counting up in the round-end and final dialogs: a click for each step, one player after another.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const C = G.COUNT_UP;

console.log('1. the sound');
{
  for (const sr of [44100, 48000]) {
    const t = G.renderTick(sr), k = G.renderClack(sr, 101);
    const peak = Math.max(...Array.from(t, Math.abs)), rms = a => Math.sqrt(Array.from(a).reduce((s, x) => s + x * x, 0) / a.length);
    const mean = Array.from(t).reduce((s, x) => s + x, 0) / t.length;
    let zc = 0; for (let i = 1; i < t.length; i++) if ((t[i] >= 0) !== (t[i - 1] >= 0)) zc++;
    const hz = zc / 2 / (t.length / sr);                                               // zero crossings per second / 2: roughly the pitch it is made of
    ok(Math.abs(t.length / sr - 0.016) < 0.0005, `${sr}: it is 16 milliseconds long (${(t.length / sr * 1000).toFixed(1)})`);
    ok(peak <= 1 && peak > 0.3 && t.every(x => Number.isFinite(x)), `${sr}: it is audible and never above full scale (peak ${peak.toFixed(2)})`);
    ok(Math.abs(t[t.length - 1]) < 1e-9 && Math.abs(t[0]) < 0.05, `${sr}: it starts and ends at nothing, so it does not click by itself`);
    ok(Math.abs(mean) < 0.02, `${sr}: it has no DC offset (${mean.toFixed(4)})`);
    ok(hz > 1500, `${sr}: it is high and crisp (about ${Math.round(hz)} Hz): a counter ticking, not a tile`);
    ok(t.length < k.length / 3 && rms(t) * 0.3 < rms(k) * 0.7, `${sr}: it is much shorter (${t.length} samples against ${k.length}) and, at the volume it is played at (0.3 against the clack's 0.7), quieter than a domino's clack`);
    ok(JSON.stringify(Array.from(G.renderTick(sr).slice(0, 50))) === JSON.stringify(Array.from(t.slice(0, 50))), `${sr}: and the same each time (no random numbers)`);
  }
  // playing it
  const plays = []; let state = 'running';
  class Ctx {
    constructor() { this.sampleRate = 44100; this.state = state; this.destination = {}; this.currentTime = 0; }
    createBuffer(c, n) { const d = new Float32Array(n); return { length: n, getChannelData: () => d }; }
    createBufferSource() { const s = { buffer: null, playbackRate: { value: 1 }, connect() {}, start() { plays.push({ len: s.buffer.length, rate: s.playbackRate.value, gain: s._gain }); } }; return s; }
    createGain() { const g = { gain: { value: 1 }, connect() {} }; const orig = g; return new Proxy(orig, { set(t, k, v) { t[k] = v; return true; } }); }
    resume() {}
  }
  const snd = G.createSound(Ctx, () => 0.5);
  ok(typeof snd.tick === 'function' && typeof snd.clack === 'function' && typeof snd.turn === 'function' && typeof snd.unlock === 'function', 'the sound has its tick as well as the clack and the turn cue');
  snd.tick(0.5); ok(plays.length === 0, 'before the sound is unlocked (no click or key press yet) a tick plays nothing, and breaks nothing');
  snd.unlock(); plays.length = 0;
  snd.tick(0); snd.tick(1); snd.tick(0.5); snd.tick(); snd.tick(NaN); snd.tick(7); snd.tick(-3);
  const rates = plays.map(p => +p.rate.toFixed(3));
  ok(plays.length === 7 && plays.every(p => p.len === Math.floor(44100 * 0.016)), 'once unlocked, each tick plays the tick sound (7 of 7)');
  ok(rates[0] === 0.92 && rates[1] === 1.22 && rates[2] === 1.07 && rates[3] === 0.92 && rates[4] === 0.92 && rates[5] === 1.22 && rates[6] === 0.92, `its pitch rises a little with the progress of the count, and stays within range whatever it is given: ${rates.join(' ')}`);
  plays.length = 0; snd.clack(); ok(plays.length === 1 && plays[0].len !== Math.floor(44100 * 0.016), 'the domino clack is unchanged');
}

console.log('2. the count, against a clock');
function fakeTimer() {
  let id = 0, clock = 0; const q = [];
  return { set(fn, ms) { const t = { id: ++id, fn, at: clock + ms }; q.push(t); return t.id; }, clear(i) { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); },
    advance(ms) { const end = clock + ms; for (;;) { q.sort((a, b) => a.at - b.at); const nx = q[0]; if (!nx || nx.at > end) break; q.shift(); clock = nx.at; nx.fn(); } clock = end; }, get clock() { return clock; }, get pending() { return q.length; } };
}
function makeApp(seed, extra) {
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {}, timer = fakeTimer(), clicks = [];
  const sound = { unlock() {}, clack() {}, tick(p) { clicks.push({ p, at: timer.clock }); } };
  const app = G.createApp(Object.assign({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: false, chatRng: () => 1, nativeChance: 0, foodChance: 0, timer, sound, now: () => 1e6 + timer.clock,
    storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } }, extra));
  return { app, root, timer, clicks, S: app.state, d: a => app.dispatch(a) };
}
const shownIn = html => Array.from(html.matchAll(/<b data-count="(\d+)" aria-hidden="true">(\d+)<\/b>/g)).map(m => +m[2]);
const finalIn = html => Array.from(html.matchAll(/<span class="sr-only">(\d+)(?: points,)?<\/span>/g)).map(m => +m[1]);
const tilesFor = n => { const h = []; while (n > 0) { const p = Math.min(n, 12); h.push([Math.min(6, p), p - Math.min(6, p)]); n -= p; } return h; };      // tiles adding up to n dots, the biggest first (45: 12, 12, 12, 9)
function roundEnd(S, rows, totals) { S.modal = { type: 'roundEnd', blocked: false, tie: false, winnerId: rows[0].id, rows: rows.map(r => Object.assign({ name: r.id, hand: tilesFor(r.pips) }, r)), totals, last: false }; }
const hiddenIn = html => (html.match(/class="mt hid"/g) || []).length, pipsIn = html => Array.from(html.matchAll(/<b data-pips="(\d+)" aria-hidden="true">\+(\d+)<\/b>/g)).map(m => +m[2]);
(async () => {
  {
    const a = makeApp(1); a.d({ type: 'startGame', rounds: 2, hand: 8, style: 'pips', level: 'easy' }); await tick();
    // human +45 (75 -> 120), the computer +0 (98 stays), nobody else
    roundEnd(a.S, [{ id: 'human', pips: 45 }, { id: 'cpu', pips: 0 }], { human: 120, cpu: 98 });
    a.app.render(true);
    ok(JSON.stringify(shownIn(a.root.innerHTML)) === '[75,98]', 'the dialog opens showing what each player had BEFORE the round: ' + JSON.stringify(shownIn(a.root.innerHTML)));
    ok(JSON.stringify(finalIn(a.root.innerHTML)) === '[120,98]', 'with the real totals for a screen reader, in a hidden span (it need not hear the count)');
    ok(/<span class="sr-only">\+45<\/span><span>this round<\/span>/.test(a.root.innerHTML) && JSON.stringify(pipsIn(a.root.innerHTML)) === '[0,0]' && hiddenIn(a.root.innerHTML) === 4, 'the points of this round start at +0 (the real +45 is there for a screen reader) and the human\'s 4 tiles are in place but not shown yet');
    ok(a.S.count && JSON.stringify(a.S.count.from) === '[75,98]' && JSON.stringify(a.S.count.to) === '[120,98]', 'the count runs from total minus this round to the total');
    a.timer.advance(C.startMs - 1);
    ok(a.clicks.length === 0 && JSON.stringify(a.S.count.shown) === '[75,98]', `nothing for the first ${C.startMs - 1} ms: the dialog is let appear first`);
    // watch every step
    const steps = []; let last = a.S.count.shown.slice();
    for (let t = 0; t < 4000; t++) { a.timer.advance(1); const now = a.S.count.shown; if (now.some((v, i) => v !== last[i])) { steps.push({ t: a.timer.clock, i: now.findIndex((v, k) => v !== last[k]), v: now.find((v, k) => v !== last[k]) }); last = now.slice(); } }
    ok(steps.length === 4 && steps.every(s => s.i === 0) && JSON.stringify(steps.map(s => s.v)) === '[87,99,111,120]', `the human counts up first, 75 to 120, one tile at a time: ${steps.map(s => s.v).join(', ')} (tiles of 12, 12, 12 and 9 dots)`);
    ok(steps[steps.length - 1].v === 120 && steps.every(s => s.v <= 120 && s.v >= 75), 'landing exactly on 120, never above it');
    ok(a.S.count.shown[1] === 98 && !steps.some(s => s.i === 1), 'the computer, who scored nothing this round, is not counted: no steps, no clicks, no pause');
    ok(a.clicks.length === steps.length, `one click for each step (${a.clicks.length})`);
    const gaps = steps.slice(1).map((s, k) => s.t - steps[k].t);
    ok(gaps.every(g => g === C.tileMs) && C.tileMs === 500, `half a second between tiles: two a second (${[...new Set(gaps)].join(', ')})`);
    ok(a.clicks.every((c, k) => k === 0 || c.p >= a.clicks[k - 1].p) && a.clicks[a.clicks.length - 1].p === 1 && a.clicks[0].p > 0 && a.clicks[0].p <= 0.25, 'the pitch rises with the count, from just above nothing to the top, on the last click');
    ok(a.S.count.done === true && JSON.stringify(shownIn(a.root.innerHTML)) === '[120,98]' && JSON.stringify(pipsIn(a.root.innerHTML)) === '[45,0]' && hiddenIn(a.root.innerHTML) === 0, 'and when it is done the dialog shows the real totals, all the tiles and +45');
  }
  {
    const a = makeApp(2); a.d({ type: 'startGame', rounds: 2, hand: 8, style: 'pips', level: 'easy', cpus: 2, level2: 'hard' }); await tick();
    roundEnd(a.S, [{ id: 'human', pips: 12 }, { id: 'cpu', pips: 30 }, { id: 'cpu2', pips: 90 }], { human: 22, cpu: 80, cpu2: 300 });
    a.app.render(true);
    const timeline = []; let last = a.S.count.shown.slice();
    for (let t = 0; t < 12000; t++) { a.timer.advance(1); const now = a.S.count.shown; const i = now.findIndex((v, k) => v !== last[k]); if (i >= 0) { timeline.push({ t: a.timer.clock, i, v: now[i] }); last = now.slice(); } }
    const order = timeline.map(s => s.i), counts = [0, 1, 2].map(i => timeline.filter(s => s.i === i).length);
    ok(order.join('') === [...order].sort().join(''), 'three players, one after another: every step of the first, then every step of the second, then the third');
    ok(counts[0] === 1 && counts[1] === 3 && counts[2] === 8, `steps: ${counts.join(', ')} (one for each tile left: 1, 3 and 8)`);
    const lastOf = i => timeline.filter(s => s.i === i).pop(), firstOf = i => timeline.find(s => s.i === i);
    ok(firstOf(1).t - lastOf(0).t === C.tileGapMs && firstOf(2).t - lastOf(1).t === C.tileGapMs, `a pause of ${C.tileGapMs} ms between one player and the next`);
    ok(lastOf(0).v === 22 && lastOf(1).v === 80 && lastOf(2).v === 300 && JSON.stringify(a.S.count.shown) === '[22,80,300]', 'each lands exactly on its total (22, 80, 300)');
    const total = timeline[timeline.length - 1].t;
    ok(total < C.startMs + 12 * C.tileMs + 3 * C.tileGapMs + 50, `the whole count takes ${(total / 1000).toFixed(1)} seconds for 12 tiles`);
    ok(a.clicks.length === timeline.length, `every step has its click (${a.clicks.length})`);
  }
  {
    // mute, and re-drawing the dialog while it counts
    const a = makeApp(3); a.d({ type: 'startGame', rounds: 2, hand: 8, style: 'pips', level: 'easy' }); await tick();
    a.S.opts.sound = false;
    roundEnd(a.S, [{ id: 'human', pips: 20 }, { id: 'cpu', pips: 10 }], { human: 50, cpu: 30 });
    a.app.render(true); a.timer.advance(C.startMs + 5 * C.tickMs + 5);
    const mid = a.S.count.shown.slice();
    ok(a.clicks.length === 0 && mid[0] > 30 && mid[0] < 50, 'with the sound muted the numbers still count, in silence (now ' + mid[0] + ')');
    const before = a.timer.pending; a.app.render(true); a.app.render(true);
    ok(JSON.stringify(shownIn(a.root.innerHTML)) === JSON.stringify(mid) && a.timer.pending === before, 'drawing the page again in the middle of the count shows where it has got to, and does not start it over');
    // a hosted game sends the same dialog again with every update: a new object, the same content
    const same = JSON.parse(JSON.stringify(a.S.modal)); a.S.modal = same; a.app.render(true);
    ok(JSON.stringify(a.S.count.shown) === JSON.stringify(mid) && a.timer.pending === before, 'the very same dialog sent again as a new object does not restart the count');
    a.timer.advance(5000);
    ok(JSON.stringify(a.S.count.shown) === '[50,30]', 'and it finishes: [50, 30]');
    a.S.opts.sound = true;
    // a different dialog: restarts from its own start
    roundEnd(a.S, [{ id: 'human', pips: 7 }, { id: 'cpu', pips: 0 }], { human: 57, cpu: 30 });
    a.app.render(true);
    ok(JSON.stringify(a.S.count.shown) === '[50,30]' && a.S.count.done === false, 'the next round\'s dialog starts its own count, from 50');
    a.timer.advance(5000); ok(JSON.stringify(a.S.count.shown) === '[57,30]' && a.clicks.length === 1, 'and counts the 7 points (one tile), with a click');
    // the dialog goes away: nothing is left
    a.S.modal = null; a.app.render(true);
    ok(a.S.count === null, 'when there is no such dialog there is no count');
    roundEnd(a.S, [{ id: 'human', pips: 40 }, { id: 'cpu', pips: 40 }], { human: 100, cpu: 100 });
    a.app.render(true); a.timer.advance(C.startMs + 200); const n0 = a.clicks.length;
    a.S.modal = null; a.timer.advance(5000);
    ok(a.clicks.length === n0, 'a count in progress when the dialog goes away stops (no more clicks)');
  }
  {
    // the final dialog
    const a = makeApp(4); a.d({ type: 'startGame', rounds: 2, hand: 8, style: 'pips', level: 'easy' }); await tick();
    a.S.modal = { type: 'final', totals: { human: 150, cpu: 90 } }; a.app.render(true);
    ok(JSON.stringify(shownIn(a.root.innerHTML)) === '[0,0]' && JSON.stringify(finalIn(a.root.innerHTML)) === '[150,90]', 'the final dialog opens at nothing, with the real totals for a screen reader');
    const timeline = []; let last = a.S.count.shown.slice();
    for (let t = 0; t < 12000; t++) { a.timer.advance(1); const now = a.S.count.shown; const i = now.findIndex((v, k) => v !== last[k]); if (i >= 0) { timeline.push({ t: a.timer.clock, i, v: now[i] }); last = now.slice(); } }
    const order = timeline.map(s => s.i);
    ok(order.join('') === [...order].sort().join('') && JSON.stringify(a.S.count.shown) === '[150,90]' && timeline.filter(s => s.i === 0).length <= C.maxTicks, 'each total counts up from nothing, one after another, to the final score: 150 then 90');
    ok(/<h2 id="dlg-title">(You win|[^<]+ wins|A tie[^<]*)<\/h2>/.test(a.root.innerHTML), 'the title says who won, as before');
    ok(a.clicks.length === timeline.length && JSON.stringify(shownIn(a.root.innerHTML)) === '[150,90]', 'with a click for each step, and the real scores shown at the end');
  }
  {
    // no count with reduced motion, or when switched off
    for (const [label, extra] of [['reduced motion', { reducedMotion: true }], ['switched off', { countUp: false }]]) {
      const a = makeApp(5, extra); a.d({ type: 'startGame', rounds: 2, hand: 8, style: 'pips', level: 'easy' }); await tick();
      roundEnd(a.S, [{ id: 'human', pips: 45 }, { id: 'cpu', pips: 9 }], { human: 120, cpu: 40 }); a.app.render(true);
      a.timer.advance(10000);
      ok(a.S.count === null && JSON.stringify(shownIn(a.root.innerHTML)) === '[120,40]' && a.clicks.length === 0, `${label}: the dialog shows the real totals at once, with no count and no clicks`);
    }
  }

  console.log('3. real games');
  {
    let games = 0, roundEnds = 0, finals = 0, wrong = 0, notSeq = 0, tooMany = 0, clicksOk = 0, clicksTotal = 0, minShown = 0;
    for (const [seed, hand, cpus] of [[11, 8, 1], [12, 8, 2], [13, 12, 1]]) {
      const a = makeApp(seed); a.d({ type: 'startGame', rounds: 3, hand, style: 'pips', level: 'easy', cpus, level2: 'normal' }); games++;
      const seen = new Set();
      for (let i = 0; i < 9000; i++) {
        await tick();
        const S = a.S, A = S.awaiting;
        if (S.modal && (S.modal.type === 'roundEnd' || S.modal.type === 'final') && S.count && !seen.has(S.count.sig)) {
          seen.add(S.count.sig); const isFinal = S.modal.type === 'final';
          if (isFinal) finals++; else roundEnds++;
          const ids = isFinal ? Object.keys(S.modal.totals).filter(k => k !== 'cpu2' || cpus === 2) : S.modal.rows.map(r => r.id);
          const c0 = a.clicks.length, startShown = S.count.shown.slice(); let last = S.count.shown.slice(), ord = [], ticks = 0;
          const wantFrom = isFinal ? startShown.map(() => 0) : S.modal.rows.map(r => S.modal.totals[r.id] - r.pips);
          if (JSON.stringify(startShown) !== JSON.stringify(wantFrom)) wrong++;
          let lastRev = isFinal ? null : S.count.rev.slice();
          for (let t = 0; t < 40000 && !S.count.done; t++) { a.timer.advance(5); const now = S.count.shown; let k = now.findIndex((v, q) => v !== last[q]); if (k < 0 && lastRev) k = S.count.rev.findIndex((v, q) => v !== lastRev[q]); if (k >= 0) { ord.push(k); ticks++; if (now[k] > S.count.to[k] || now[k] < S.count.from[k]) wrong++; last = now.slice(); if (lastRev) lastRev = S.count.rev.slice(); } }
          const want = isFinal ? ids.map(id => S.modal.totals[id]) : S.modal.rows.map(r => S.modal.totals[r.id]);
          if (JSON.stringify(S.count.shown) !== JSON.stringify(want) || JSON.stringify(shownIn(a.root.innerHTML)) !== JSON.stringify(want)) wrong++;
          if (ord.join('') !== [...ord].sort().join('')) notSeq++;
          for (let k = 0; k < want.length; k++) if (ord.filter(x => x === k).length > (isFinal ? C.maxTicks : S.modal.rows[k].hand.length)) tooMany++;
          clicksTotal++; if (a.clicks.length - c0 === ticks) clicksOk++;
        }
        if (!A) continue;
        if (A.kind === 'modal') { if (S.modal && S.modal.type === 'final') break; a.d({ type: 'dialogOk' }); }
        else if (A.kind === 'draw') a.d({ type: 'draw' });
        else if (A.kind === 'build') { if (A.canDraw) a.d({ type: 'draw' }); else if (A.canBuild) a.d({ type: 'autoBuild' }); else if (A.canDone) a.d({ type: 'endBuild' }); else a.d({ type: 'undoTile' }); }
        else { const m = A.moves[0]; a.d({ type: 'selectTile', key: key(m.tile) }); if (a.S.awaiting === A) a.d({ type: 'playOn', train: m.trainId }); }
      }
    }
    ok(roundEnds >= 6 && finals >= 2, `${games} real games (two and three players) were played to the end: ${roundEnds} round-end dialogs and ${finals} final dialogs counted`);
    ok(wrong === 0 && notSeq === 0 && tooMany === 0, `every one started from the right numbers, counted one player after another, never went outside its range, landed exactly on the real totals (and showed them), within the click limit (${wrong} wrong, ${notSeq} out of order, ${tooMany} over the limit)`);
    ok(clicksOk === clicksTotal, `and every one had exactly one click for each step (${clicksOk} of ${clicksTotal})`);
  }
  {
    // the button never waits for the count
    const a = makeApp(6); a.d({ type: 'startGame', rounds: 3, hand: 8, style: 'pips', level: 'easy' });
    let reached = false;
    for (let i = 0; i < 9000 && !reached; i++) {
      await tick(); const A = a.S.awaiting; if (!A) continue;
      if (A.kind === 'modal') { reached = true; break; }
      if (A.kind === 'draw') a.d({ type: 'draw' });
      else if (A.kind === 'build') { if (A.canDraw) a.d({ type: 'draw' }); else if (A.canBuild) a.d({ type: 'autoBuild' }); else if (A.canDone) a.d({ type: 'endBuild' }); else a.d({ type: 'undoTile' }); }
      else { const m = A.moves[0]; a.d({ type: 'selectTile', key: key(m.tile) }); if (a.S.awaiting === A) a.d({ type: 'playOn', train: m.trainId }); }
    }
    ok(reached && a.S.count && a.S.count.done === false, 'the round-end dialog is up and the count has begun');
    a.timer.advance(C.startMs + 2 * C.tickMs); const c0 = a.clicks.length;
    a.d({ type: 'dialogOk' });
    ok(a.S.modal === null && a.S.count === null, 'the button works at once, in the middle of the count (nothing makes you wait)');
    a.timer.advance(8000);
    ok(a.clicks.length === c0, 'and the clicks stop');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
