'use strict';
// The game's history panel: scrollable, kept from round to round, in a hosted game too, and the reader is not thrown back to the top when the page is drawn again.
const fs = require('fs'), path = require('path');
const { OnlineMatch } = require('../online-match.js');         // (this loads the game's code; the match and this test must use the very same copy of it)
const G = globalThis.MexicanTrainGame;
const E = G.Engine, { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => setImmediate(r));
const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'mexican-train.html'), 'utf8');
const rule = sel => { const i = css.indexOf(sel + ' {'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1); };

console.log('1. the panel scrolls');
{
  const r = rule('.log');
  ok(/height:\s*7\.2rem/.test(r) && /overflow-y:\s*auto/.test(r), 'a fixed height (the same 7.2 rem as before, so the layout does not move) that scrolls when there is more');
  ok(/overscroll-behavior:\s*contain/.test(r), 'scrolling it does not scroll the whole page when it reaches its end');
  ok(/\.log:focus-visible\s*\{[^}]*outline/.test(css), 'it shows a focus ring when it has the keyboard focus');
  ok(/\.log li\.round\s*\{[^}]*font-weight:\s*700/.test(css) && /\.log li\.round[^}]*border-top/.test(css), 'and the start of a round stands out');
  ok(!/min-height:\s*7\.2rem/.test(r) && html.includes('overflow-y: auto; overscroll-behavior: contain'), '(the built page has these rules)');
}

console.log('2. the server keeps the history from round to round, and sends the latest lines with their place in it');
function fakeTimer() {
  let id = 0, t = 0; const q = [];
  return { q, get now() { return t; }, set(fn, ms) { q.push({ id: ++id, fn, at: t + ms }); return id; }, clear(x) { const i = q.findIndex(e => e.id === x); if (i >= 0) q.splice(i, 1); },
    advance(ms) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const e = q[0]; if (!e || e.at > end) break; q.shift(); t = e.at; e.fn(); } t = end; } };
}
(async () => {
  {
    const timer = fakeTimer();
    const m = new OnlineMatch({ names: ['Ann', 'Ben', 'Gandalf'], computer: { level: 'easy' }, theme: 'classic', rounds: 2, hand: 8, stepDelay: 0, nativeChance: 0, foodChance: 0, sleep: async () => {}, rng: mulberry32(9), chatRng: () => 1, timer, now: () => timer.now, push() {} });
    const run = m.start();
    let sawRound2 = false;
    for (let n = 0; n < 8000 && !sawRound2; n++) {
      for (const seat of m.humans) {
        const v = m.viewFor(seat); if (!v.awaiting) continue; const a = v.awaiting;
        if (a.kind === 'modal') m.intent(seat, { a: 'ok' });
        else if (a.kind === 'draw') m.intent(seat, { a: 'draw' });
        else if (a.kind === 'move') { const mv = a.moves[0]; m.intent(seat, { a: 'play', tile: mv.tile, train: mv.trainId }); }
        else if (a.canDraw) m.intent(seat, { a: 'draw' }); else if (a.moves.length && a.placed < 2) { const mv = a.moves[0]; m.intent(seat, { a: 'play', tile: mv.tile, train: mv.trainId }); } else m.intent(seat, { a: a.canDone ? 'done' : 'undo' });
      }
      timer.advance(300); await tick();
      if (m.logs[0].some(l => /^Round 2:/.test(l))) sawRound2 = true;
    }
    const L = m.logs[0], r1 = L.findIndex(l => /^Round 1:/.test(l)), r2 = L.findIndex(l => /^Round 2:/.test(l));
    ok(sawRound2 && r1 === 0 && r2 > 10, `the second round does not wipe a person's history: round 1 begins at line ${r1}, round 2 at line ${r2}, of ${L.length}`);
    const v = m.viewFor(0);
    ok(Array.isArray(v.log) && v.log.length <= 120 && v.logFrom === Math.max(0, L.length - 120) && v.logFrom + v.log.length === L.length && v.log.join() === L.slice(v.logFrom).join(), `an update carries the latest lines (${v.log.length}, at most 120) and where they begin in the whole history (${v.logFrom}), so that they add up exactly`);
    m.logs[0].push(...Array.from({ length: 400 }, (_, i) => 'later ' + i));
    const w = m.viewFor(0);
    ok(w.log.length === 120 && w.logFrom === m.logs[0].length - 120 && w.log[119] === 'later 399' && w.log[0] === 'later 280', 'in a long game the update is still just the latest 120 lines (it does not grow without end), with the right place');
    ok(m.viewFor(1).logFrom !== undefined && m.viewFor(0).log !== m.viewFor(1).log, 'each person has their own history (their own "You played ...")');
    m.abort(); await run;
  }

  console.log('3. the page keeps what it is sent, in a hosted game');
  {
    const store = {};
    const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    class FakeWS { constructor() { this.readyState = 0; this.sent = []; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); } send(d) { this.sent.push(JSON.parse(d)); } close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
    const app = G.createApp({ root, rng: mulberry32(7), paceRng: () => 0, sleep: async () => {}, reducedMotion: true, chatRng: () => 1, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } }, WebSocket: FakeWS, fetch: async () => ({ ok: true, json: async () => ({ addresses: ['fake:1'], preferred: 'fake:1' }) }) });
    app.dispatch({ type: 'boot' }); app.dispatch({ type: 'openHost' }); await wait(5); app.dispatch({ type: 'hostGame', server: 'x', name: 'Me', rounds: 4, hand: 15 }); await wait(10);
    const ws = FakeWS.last, S = app.state;
    ws.say({ t: 'created', code: 'ABCDEF', display: 'ABC-DEF', token: 't', seat: 0, settings: { rounds: 4, hand: 15, allowHints: true }, addresses: [] });
    const T = (a, b) => [a, b], tr = id => ({ id, marker: false, tiles: [], end: 12 });
    let seq = 0;
    const view = (log, logFrom) => { const v = { seq: ++seq, round: 0, rounds: 4, me: { name: 'Me' }, opp: { name: 'Zed' }, totals: { human: 0, cpu: 0 }, paused: false, over: null, log, banner: '', modal: null, awaiting: null,
      game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [T(12, 1)] }, { id: 'cpu', name: 'Zed', hand: [T(-1, -1)] }], boneyard: [T(-1, -1)], trains: { human: tr('human'), cpu: tr('cpu'), mexican: tr('mexican') }, openDouble: null, opening: { human: { finished: true }, cpu: { finished: true } } } }; if (logFrom !== undefined) v.logFrom = logFrom; return v; };
    const send = (log, from) => { ws.say({ t: 'state', seq, view: view(log, from), events: [] }); };
    const say = (log, from) => { const v = view(log, from); ws.say({ t: 'state', seq: v.seq, view: v, events: [] }); return S.log.slice(); };
    ok(say(['a', 'b', 'c'], 0).join() === 'a,b,c', 'the first update: its three lines');
    ok(say(['c', 'd', 'e'], 2).join() === 'a,b,c,d,e', 'the next carries the latest three, two of them already known: they are put in the same place (no repeats), and the history grows: a,b,c,d,e');
    ok(say(['d', 'e', 'f'], 3).join() === 'a,b,c,d,e,f', 'and again');
    ok(say(['x398', 'x399', 'x400'], 397).join() === 'a,b,c,d,e,f,x398,x399,x400', 'a long gap (the page missed 390 lines, say after being away): what it has is kept, and the new lines follow, with no holes shown');
    ok(say(['x398', 'x399', 'x400'], 397).join() === 'a,b,c,d,e,f,x398,x399,x400', 'the very same update again changes nothing');
    ok(root.innerHTML.indexOf('x400') < root.innerHTML.indexOf('x399') && root.innerHTML.indexOf('x398') < root.innerHTML.indexOf('>f<'), 'and the panel shows it newest first');
    ok(say(['<img src=x onerror=alert(1)>', 'p'], 400).join().indexOf('<img') < 0 && !/<img src=x/.test(root.innerHTML), 'a line from the server is cleaned of markup, as before');
    // the history got shorter: a new game on the same page
    ok(say(['n1'], 0).join() === 'n1', 'a history that is SHORTER than the one the page has means a new game: it starts again from its first line');
    ok(say(['n1', 'n2', 'n3'], 0).join() === 'n1,n2,n3', '... and builds up from there');
    // a server that does not send the position: show what it sends, as before
    ok(say(['old1', 'old2'], undefined).join() === 'old1,old2', 'a server that sends no place for its lines (an older one): the lines it sends are shown, as before');
  }

  console.log('4. a reader part-way down the history is not moved when the page is drawn again');
  {
    const store = {};
    const state = { cur: { scrollTop: 0, scrollHeight: 300 }, next: null };
    const root = { set innerHTML(v) { if (state.next) state.cur = state.next; }, get innerHTML() { return ''; }, querySelectorAll() { return []; }, querySelector(sel) { return sel === '.log' ? state.cur : { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const app = G.createApp({ root, rng: mulberry32(7), paceRng: () => 0, sleep: async () => {}, reducedMotion: true, chatRng: () => 1, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
    app.dispatch({ type: 'boot' });
    const redraw = (before, after) => { state.cur = Object.assign({}, before); state.next = Object.assign({ scrollTop: 0 }, after); app.render(true); return state.cur.scrollTop; };
    ok(redraw({ scrollTop: 0, scrollHeight: 500 }, { scrollHeight: 560 }) === 0, 'at the top (reading the newest) it stays at the top, however much is added');
    ok(redraw({ scrollTop: 120, scrollHeight: 500 }, { scrollHeight: 500 }) === 120, 'part-way down, and nothing was added: it stays exactly where it was');
    ok(redraw({ scrollTop: 120, scrollHeight: 500 }, { scrollHeight: 560 }) === 180, 'part-way down, and a line (60 high) was added at the TOP: it moves down by 60, so that the line being read has not moved on the screen');
    ok(redraw({ scrollTop: 120, scrollHeight: 500 }, { scrollHeight: 620 }) === 240, 'two lines (120) added at once: moved by 120');
    ok(redraw({ scrollTop: 120, scrollHeight: 500 }, { scrollHeight: 300 }) === 120, 'if the history got shorter (a new game) it is not pushed negative or past the end by us (the browser keeps it within the panel)');
    state.cur = null; state.next = { scrollTop: 0, scrollHeight: 100 };
    let threw = false; try { app.render(true); } catch (e) { threw = true; }
    ok(!threw, 'and with no panel on the page at all (a dialog only) drawing it breaks nothing');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
