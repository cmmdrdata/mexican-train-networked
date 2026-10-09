'use strict';
// A speech bubble fades in once, when it first appears: not again every time the page is redrawn for a move.
require('./game.js');
const fs = require('fs');
const G = globalThis.MexicanTrainGame;
const { mulberry32 } = G.Engine;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const css = fs.readFileSync('../style.css', 'utf8');

// A page root that behaves like the real one in the way that matters here: every innerHTML assignment destroys the old
// elements and makes new ones, and a new bubble starts with no "in" class.
function makeRoot() {
  const r = { html: '', generation: 0, bubble: null, adds: [], draws: 0,
    set innerHTML(v) {
      r.html = v; r.generation++; r.draws++;
      const gen = r.generation;
      r.bubble = /class="bubble"/.test(v) ? { gen, classes: new Set(['bubble']), classList: { add: n => { r.bubble.classes.add(n); r.adds.push({ gen, name: n }); } } } : null;
    },
    get innerHTML() { return r.html; }, querySelectorAll() { return []; }, querySelector(sel) { return sel === '.bubble' ? r.bubble : { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  return r;
}

(async () => {
  console.log('1. the stylesheet');
  {
    const rule = sel => { const m = css.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[2] : null; };
    ok(rule('.bubble') !== null && !/animation/.test(rule('.bubble')), 'a bubble drawn by a redraw has no animation of its own (every redraw makes a new element, so it would play again each time)');
    ok(rule('.bubble.in') !== null && /animation:\s*bubbleIn 0\.22s/.test(rule('.bubble.in')), 'the fade-in belongs to .bubble.in, which the script adds once, to the bubble it has just drawn');
    ok(/@keyframes bubbleIn/.test(css) && /\*, \*::before, \*::after \{ animation: none !important/.test(css), '(and the fade-in itself, and the rule that switches animation off for people who ask for less motion, are still there)');
  }

  console.log('2. the computer\'s comments: a bubble fades in once, however many times the page is redrawn while it is up');
  {
    let clock = 0; const timers = []; let idc = 0;
    const timer = { set: (fn, ms) => { const id = ++idc; timers.push({ id, at: clock + ms, fn }); return id; }, clear: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); } };
    const advance = ms => { const end = clock + ms; for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > end) break; const t = timers.shift(); clock = t.at; t.fn(); } clock = end; };
    const root = makeRoot(), store = {}; let force = false; const base = mulberry32(8);
    const app = G.createApp({ root, rng: mulberry32(4), paceRng: () => 0, chatRng: () => (force ? 0 : base()), nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, timer, now: () => clock, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
    const S = app.state; app.dispatch({ type: 'boot' });
    app.dispatch({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'normal' });
    for (let i = 0; i < 6000 && !(S.awaiting && S.awaiting.kind === 'build'); i++) await wait(0);
    const ids = new Set(); let comments = 0, stable = true, redraws = 0;
    for (let round = 0; round < 5; round++) {
      let before = root.adds.length, seen = null;
      for (let step = 0; step < 12 && !seen; step++) { advance(5000); if (S.comment && !ids.has(S.comment.id)) seen = S.comment; }
      if (!seen) break;
      ids.add(seen.id); comments++;
      ok(root.adds.length === before + 1 && root.adds[root.adds.length - 1].name === 'in' && root.adds[root.adds.length - 1].gen === root.generation, `comment ${comments}: the page was drawn with the bubble, and it was given the fade-in, once`);
      for (let k = 0; k < 6; k++) { S.log.push('Somebody played something ' + k); app.render(true); redraws++; if (!root.bubble || root.bubble.classes.has('in')) stable = false; if (!/class="bubble"/.test(root.html)) stable = false; }
      ok(root.adds.length === before + 1, `comment ${comments}: six more redraws while it was up (as when the computers play) did not fade it in again`);
      const a = S.awaiting; if (a && a.kind === 'build') a.resolve({ type: a.canDraw ? 'draw' : 'done' });
      for (let i = 0; i < 200; i++) { await wait(0); advance(50); if (S.awaiting) break; }
    }
    ok(comments >= 3 && stable, `${comments} comments over ${redraws} extra redraws: each redraw made a plain bubble (no "in") and it stayed on screen`);
    ok(root.adds.length === ids.size, `and the fade-in happened exactly once per comment (${root.adds.length} fade-ins for ${ids.size} comments)`);
  }

  console.log('2b. a comment that comes due while a dialog is open over the game');
  {
    // A bubble is on screen; you open the rules; a comment that was already on its way arrives. The page behind the dialog is
    // not redrawn, so the bubble still there must not be faded in again.
    let staged = false, detail = '';
    for (let seed = 1; seed <= 40 && !staged; seed++) {
      let clock = 0; const timers = []; let idc = 0;
      const timer = { set: (fn, ms) => { const id = ++idc; timers.push({ id, at: clock + ms, fn }); return id; }, clear: id => { const i = timers.findIndex(x => x.id === id); if (i >= 0) timers.splice(i, 1); } };
      const advance = ms => { const end = clock + ms; for (;;) { timers.sort((x, y) => x.at - y.at); if (!timers.length || timers[0].at > end) break; const x = timers.shift(); clock = x.at; x.fn(); } clock = end; };
      const root = makeRoot(), store = {};
      const app = G.createApp({ root, rng: mulberry32(seed), paceRng: () => 0, chatRng: mulberry32(seed + 90), nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, timer, now: () => clock, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
      const S = app.state; app.dispatch({ type: 'boot' });
      app.dispatch({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'normal' });
      for (let i = 0; i < 6000 && !(S.awaiting && S.awaiting.kind === 'build'); i++) await wait(0);
      const me = S.game.players[0];
      if (G.Engine.longestChain(me.hand.map(x => x.slice()), S.game.engine, false).length < 1) { app.dispatch({ type: 'newGame' }); continue; }   // this deal gives you nothing to build with
      let first = null; for (let step = 0; step < 12 && !first; step++) { advance(5000); first = S.comment; }          // a bubble goes up...
      if (!first) { app.dispatch({ type: 'newGame' }); continue; }
      app.dispatch({ type: 'openRules' });                                                                            // ...and you open the rules
      const behind = /class="bubble"/.test(root.html), adds = root.adds.length;
      await app.ui.onBuildDone(S.game, me, 0);                                                                        // you finish with no tiles built: it always has a remark
      advance(1500);                                                                                                  // ...which arrives a moment later, behind the dialog
      staged = true;
      ok(behind, 'the bubble is still in the page behind the dialog (so there is something that could wrongly be faded in)');
      ok(S.comment && S.comment.id !== first.id, 'the new comment arrived while the rules were open');
      ok(root.adds.length === adds, 'and no fade-in was given to the bubble left behind the dialog (the page was not redrawn)');
      app.dispatch({ type: 'newGame' });
    }
    ok(staged, 'a deal was found where this could be staged');
  }

  console.log('3. online chat: the same');
  {
    class FakeWS { constructor() { this.readyState = 0; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); } send() {} close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
    const root = makeRoot(), store = {};
    const app = G.createApp({ root, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } }, WebSocket: FakeWS, fetch: async () => ({ ok: true, json: async () => ({ addresses: ['fake:1'], preferred: 'fake:1' }) }) });
    app.dispatch({ type: 'boot' }); app.dispatch({ type: 'openHost' }); await wait(5); app.dispatch({ type: 'hostGame', server: 'x', name: 'Me', rounds: 4, hand: 15 }); await wait(10);
    FakeWS.last.say({ t: 'created', code: 'ABCDEF', display: 'ABC-DEF', token: 't', seat: 0, settings: { rounds: 4, hand: 15 }, addresses: [] });
    const T = (a, b) => [a, b], tr = (id) => ({ id, marker: false, tiles: [], end: 12 });
    const view = seq => ({ seq, round: 0, rounds: 4, me: { name: 'Me', seat: 0 }, opp: { name: 'Ben' }, opps: [{ id: 'cpu', name: 'Ben', seat: 1, computer: false }], totals: { human: 0, cpu: 0 }, paused: false, over: null, log: ['x'], banner: '', modal: null, awaiting: null,
      game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [T(1, 2)] }, { id: 'cpu', name: 'Ben', hand: [T(-1, -1)] }], boneyard: [T(-1, -1)], trains: { human: tr('human'), cpu: tr('cpu'), mexican: tr('mexican') }, openDouble: null, opening: null } });
    FakeWS.last.say({ t: 'state', seq: 1, view: view(1), events: [] });
    const before = root.adds.length;
    FakeWS.last.say({ t: 'chat', id: 0, text: 'Good luck!' });
    ok(root.adds.length === before + 1 && /Good luck!/.test(root.html), 'a phrase from the other person appears and fades in once');
    for (let i = 2; i <= 7; i++) { FakeWS.last.say({ t: 'state', seq: i, view: view(i), events: [] }); }
    ok(root.adds.length === before + 1 && /class="bubble"/.test(root.html) && !root.bubble.classes.has('in') && /Good luck!/.test(root.html), 'six moves later it is still on screen, redrawn each time, and has not faded in again');
    FakeWS.last.say({ t: 'chat', id: 1, text: 'Nice one!' });
    ok(root.adds.length === before + 2 && /Nice one!/.test(root.html), 'and the next phrase fades in once, too');
    app.dispatch({ type: 'leaveOnline' });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
