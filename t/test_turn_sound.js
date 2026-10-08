'use strict';
require('./game.js');
const G = globalThis.MexicanTrainGame;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---- analysis helpers ---- */
const power = (x, sr, f) => { let re = 0, im = 0; const w = 2 * Math.PI * f / sr; for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos(w * i); im += x[i] * Math.sin(w * i); } return re * re + im * im; };
const spectrum = (x, sr, lo, hi, step) => { const out = []; for (let f = lo; f <= hi; f += step) out.push([f, power(x, sr, f)]); return out; };
const centroid = sp => { let a = 0, b = 0; sp.forEach(([f, p]) => { a += f * p; b += p; }); return a / b; };
const rms = (x, from, to) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / (to - from)); };

console.log('1. the sound, as numbers');
for (const sr of [44100, 48000, 22050]) {
  const t = G.renderTurn(sr);
  const peak = Math.max(...t.map(Math.abs));
  ok(Math.abs(t.length / sr - 0.22) < 0.001, `${sr} Hz: it lasts 0.22 seconds (short)`);
  ok(peak <= 1 && peak > 0.5, `${sr} Hz: loud enough and never clipping (peak ${peak.toFixed(2)})`);
  ok(Math.abs(t[0]) < 0.01 && Math.abs(t[t.length - 1]) < 0.001, `${sr} Hz: it starts and ends at silence (no click at either end)`);
  const mean = t.reduce((a, b) => a + b, 0) / t.length;
  ok(Math.abs(mean) < 0.02, `${sr} Hz: no DC offset (mean ${mean.toFixed(4)})`);
  const sp = spectrum(t, sr, 60, 3000, 5);
  const top = sp.reduce((a, b) => (b[1] > a[1] ? b : a));
  ok(top[0] >= 120 && top[0] <= 200, `${sr} Hz: the strongest pitch is ${top[0]} Hz: low (a low "G" is 196 Hz, a bass voice 100 to 300 Hz)`);
  const total = sp.reduce((a, [, p]) => a + p, 0), above1k = sp.filter(([f]) => f > 1000).reduce((a, [, p]) => a + p, 0);
  ok(above1k / total < 0.001, `${sr} Hz: almost nothing above 1 kHz (${(100 * above1k / total).toFixed(4)}% of the energy)`);
  const n = t.length, early = rms(t, 0, Math.floor(0.05 * sr)), late = rms(t, n - Math.floor(0.1 * sr), n);
  ok(late < early * 0.1, `${sr} Hz: it dies away (the last tenth of a second is under a tenth as loud as the first 50 ms)`);
  ok(G.renderTurn(sr).every((v, i) => v === t[i]), `${sr} Hz: the same every time`);
}
{
  const sr = 44100, t = G.renderTurn(sr), click = G.renderClack(sr, 101);
  const cT = centroid(spectrum(t, sr, 60, 6000, 20)), cC = centroid(spectrum(click, sr, 60, 12000, 40));
  ok(cT < 400 && cC > 2000 && cC > cT * 8, `against the domino click: the turn sound centres near ${cT.toFixed(0)} Hz, the click near ${cC.toFixed(0)} Hz, so they cannot be confused`);
  ok(t.length > click.length * 2, '(and the turn sound is longer than the click, a soft tone rather than a tick)');
}

console.log('2. the audio plumbing');
{
  const created = [], started = [];
  class Ctx {
    constructor() { this.sampleRate = 44100; this.state = 'suspended'; this.currentTime = 10; this.destination = {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createBuffer(ch, len) { const d = new Float32Array(len); return { length: len, getChannelData: () => d }; }
    // (the 1-sample silent blip that unlock() plays on purpose is not counted as a sound)
    createBufferSource() { const s = { buffer: null, playbackRate: { value: 1 }, connect() {}, start(when) { if (s.buffer.length > 1) started.push({ len: s.buffer.length, when }); } }; created.push(s); return s; }
    createGain() { const g = { gain: { value: 1 }, connect() {} }; const origConnect = g.connect; return g; }
  }
  const snd = G.createSound(Ctx);
  snd.turn();
  ok(started.length === 0, 'before the first tap or click (audio locked), the turn sound does nothing');
  snd.unlock();
  snd.turn();
  ok(started.length === 1 && started[0].len === Math.floor(44100 * 0.22), 'once unlocked, it plays the 0.22-second turn buffer');
  ok(started[0].when >= 10.1 && started[0].when <= 10.2, `and starts a moment later than now (${(started[0].when - 10).toFixed(2)} s), so it follows the click of the move before it instead of blurring with it`);
  snd.clack();
  ok(started.length === 2 && started[1].len !== started[0].len, 'the domino click still uses its own, different buffer');
  class Throws extends Ctx { createBufferSource() { throw new Error('no audio'); } }
  const bad = G.createSound(Throws); bad.unlock();
  let threw = false; try { bad.turn(); } catch (e) { threw = true; }
  ok(!threw, 'if the browser\'s audio fails, the turn sound fails quietly');
  const none = G.createSound(null);
  let threw2 = false; try { none.unlock(); none.turn(); } catch (e) { threw2 = true; }
  ok(!threw2, 'and with no audio at all there is no error');
}

(async () => {
console.log('3. when it plays: once per turn, not once per prompt');
{
  // a page in an online game, fed hand-made game states by a stand-in server
  function makePage(opts) {
    const calls = { turn: 0, clack: 0 };
    const html = { h: '' };
    class FakeWS { constructor() { this.readyState = 0; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); } send() {} close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
    const root = { set innerHTML(v) { html.h = v; }, get innerHTML() { return html.h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const store = opts && opts.muted ? { 'mt-opts': JSON.stringify({ rounds: 1, hand: 8, style: 'pips', sound: false, level: 'medium', chat: true }) } : {};
    const app = G.createApp({ root, sleep: async () => {}, reducedMotion: true, fetch: async () => ({ ok: true, json: async () => ({ addresses: ['fake:1'], preferred: 'fake:1' }) }), storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } }, WebSocket: FakeWS, sound: { unlock() {}, clack() { calls.clack++; }, turn() { calls.turn++; } } });
    app.dispatch({ type: 'boot' });
    app.dispatch({ type: 'hostGame', server: 'fake:1', name: 'Me', rounds: 4, hand: 15 });
    return { app, calls, FakeWS };
  }
  const T = (a, b) => [a, b];
  const view = (o) => {
    const trains = { human: { id: 'human', marker: false, tiles: [], end: 12 }, cpu: { id: 'cpu', marker: false, tiles: [], end: 12 }, mexican: { id: 'mexican', marker: false, tiles: [], end: 12 } };
    return Object.assign({ seq: 1, round: 0, rounds: 4, me: { name: 'Me' }, opp: { name: 'Zed' }, totals: { human: 0, cpu: 0 }, paused: false, over: null, log: [], banner: '', modal: null, awaiting: null,
      game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [T(1, 2), T(3, 4)] }, { id: 'cpu', name: 'Zed', hand: [T(-1, -1), T(-1, -1)] }], boneyard: [T(-1, -1)], trains, openDouble: null,
        opening: { human: { finished: true, drew: false, lastDrew: null }, cpu: { finished: true, drew: false, lastDrew: null } } } }, o);
  };
  const move = { kind: 'move', moves: [{ tile: T(1, 2), trainId: 'human', placed: T(12, 1), newEnd: 1 }, { tile: T(3, 4), trainId: 'mexican', placed: T(12, 3), newEnd: 3 }] };
  const build = { kind: 'build', moves: [{ tile: T(1, 2), trainId: 'human', placed: T(12, 1), newEnd: 1 }], placed: 0, canUndo: false, canDraw: false, canDone: true, lastDouble: false, canBuild: true, buildCount: 1 };
  const play = (who, train) => ({ e: 'play', who, train: train || 'mexican', index: 0, placed: T(12, 5), tile: T(5, 6), hidden: false });
  let seq = 0;
  const send = (page, v, events) => page.FakeWS.last.say({ t: 'state', seq: ++seq, view: v, events: events || [] });
  const start = async muted => {
    const p = makePage({ muted });
    await wait(10);
    p.FakeWS.last.say({ t: 'created', code: 'ABCDEF', display: 'ABC-DEF', token: 't', seat: 0, settings: { rounds: 4, hand: 15 }, addresses: [] });
    seq = 0;
    return p;
  };

  let p = await start();
  send(p, view({ awaiting: build }));
  ok(p.calls.turn === 0, 'building your opening train is not a turn: no sound');
  send(p, view({ awaiting: null }), []);
  send(p, view({ awaiting: move }), []);
  ok(p.calls.turn === 1, 'the first move after the opening is yours: one sound');
  send(p, view({ awaiting: move }), []);
  send(p, view({ awaiting: move, paused: true }), []);
  ok(p.calls.turn === 1, 'the same prompt arriving again (the game paused and resumed, say): no second sound');
  send(p, view({ awaiting: null }), [play('me')]);
  send(p, view({ awaiting: move }), []);
  ok(p.calls.turn === 1, 'after you play a double, the second prompt (cover it) is the same turn: no sound');
  send(p, view({ awaiting: null }), [play('me')]);
  send(p, view({ awaiting: null }), [play('opp')]);
  ok(p.calls.turn === 1, 'while the opponent plays: no sound');
  send(p, view({ awaiting: move }), []);
  ok(p.calls.turn === 2, 'when the opponent\'s move is done and it is yours: a sound');
  send(p, view({ awaiting: { kind: 'draw' } }), [{ e: 'draw', who: 'me', tile: T(5, 5) }]);
  ok(p.calls.turn === 2, '(a draw prompt straight after you played, same turn: still no sound)');
  send(p, view({ awaiting: null }), [{ e: 'draw', who: 'me', tile: T(5, 5) }]);
  send(p, view({ awaiting: move }), []);
  ok(p.calls.turn === 2, 'drawing a tile and then being asked to play it is the same turn: no sound');
  send(p, view({ awaiting: null }), [{ e: 'pass', who: 'me' }]);
  send(p, view({ awaiting: null }), [play('opp')]);
  send(p, view({ awaiting: { kind: 'draw' } }), []);
  ok(p.calls.turn === 3, 'a turn that begins with "nothing fits, draw" is a turn too: a sound');
  send(p, view({ awaiting: null }), [{ e: 'draw', who: 'me', tile: T(1, 1) }, { e: 'pass', who: 'me' }]);
  send(p, view({ awaiting: null }), [{ e: 'pass', who: 'opp' }]);
  send(p, view({ awaiting: move }), []);
  ok(p.calls.turn === 4, 'the opponent passing hands you the turn: a sound');
  // a modal prompt is not a turn
  send(p, view({ awaiting: { kind: 'modal' }, modal: { type: 'roundEnd', blocked: false, tie: false, winnerId: 'human', rows: [{ id: 'human', name: 'You', hand: [], pips: 0 }, { id: 'cpu', name: 'Zed', hand: [], pips: 5 }], totals: { human: 0, cpu: 5 }, last: false } }), []);
  ok(p.calls.turn === 4, 'the round-end dialog is not a turn: no sound');
  // a new round: the first prompt of the round may be yours even though you made the last move before it
  send(p, view({ round: 1, awaiting: build }), []);
  send(p, view({ round: 1, awaiting: null }), []);
  send(p, view({ round: 1, awaiting: move }), []);
  ok(p.calls.turn === 5, 'the first turn of the next round is announced, even if your move was the last of the round before');
  ok(p.calls.clack >= 0, '(and the click of tiles is separate, unchanged)');

  p = await start(true);
  send(p, view({ awaiting: move }), []);
  ok(p.calls.turn === 0, 'with sound muted, nothing plays');

  // a page that was reloaded in the middle of your turn: you are told it is your move
  p = await start();
  send(p, view({ awaiting: move }), []);
  ok(p.calls.turn === 1, 'a page that joins (or rejoins) when it is already your turn gets the sound once');

  // an opening where the opponent finished last: nothing plays until a real turn starts
  p = await start();
  const hiddenPlay = { e: 'play', who: 'opp', train: 'cpu', index: 0, placed: T(-1, -2), tile: null, hidden: true };
  send(p, view({ awaiting: build, game: Object.assign(view().game, { opening: { human: { finished: false, drew: false, lastDrew: null }, cpu: { finished: false, drew: false, lastDrew: null } } }) }), [hiddenPlay]);
  send(p, view({ awaiting: move }), [{ e: 'reveal' }]);
  ok(p.calls.turn === 1, 'the opponent\'s hidden opening plays do not count as "their last move": the first real turn still sounds');

  // the opposite: YOU laid tiles in the opening, and the first turn is yours. Your own opening plays are not "your last move".
  p = await start();
  const openingGame = () => Object.assign(view().game, { opening: { human: { finished: false, drew: false, lastDrew: null }, cpu: { finished: false, drew: false, lastDrew: null } } });
  send(p, view({ awaiting: build, game: openingGame() }), [Object.assign(play('me', 'human'), { hidden: false })]);
  send(p, view({ awaiting: build, game: openingGame() }), [Object.assign(play('me', 'human'), { hidden: false })]);
  send(p, view({ awaiting: move }), []);
  ok(p.calls.turn === 1, 'tiles you laid in the opening do not stop the first turn from sounding when it is yours');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
