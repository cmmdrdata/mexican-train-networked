'use strict';
// A tile tried on a train it does not fit: a face-down tile goes there and comes back. Computers do it at half the rate they take tiles back (per level), and a person's invalid try shows it too, to themselves and (online) to the others.
require('./game.js');
const { OnlineMatch } = require('../online-match.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32, key, newRound, buildPhase, cpuBuildAction, invalidAttempt } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const LEVELS = ['easy', 'normal', 'hard', 'expert'];
const wait = ms => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => setImmediate(r));

async function opening(level, seed, hand) {
  const g = newRound({ engine: 12, handSize: hand, rng: mulberry32(seed * 7919), simultaneousOpening: true });
  const p = g.players[1]; let tries = 0, others = new Set();
  const agent = { act: async (gm, pl, info) => { const a = cpuBuildAction(gm, pl, info, level); if (a.type === 'play') { const t = invalidAttempt(gm, pl, info, level); if (t) { tries++; others.add(t.trainId); } } return a; } };
  const ui = { onBuildPlay() {}, onBuildUndo() {}, onBuildDraw() {}, onBuildDone() {}, onBuildPass() {} };
  await buildPhase(g, p, agent, ui);
  return { tries, takebacks: g.opening[p.id].wobbled || 0, others, st: g.opening[p.id], g };
}

(async () => {
console.log('1. how often each level tries a wrong train (thousands of real openings)');
for (const level of LEVELS) {
  let tries = 0, back = 0, maxTries = 0, bad = 0;
  for (let seed = 1; seed <= 1500; seed++) {
    const r = await opening(level, seed, 15);
    tries += r.tries; back += r.takebacks; maxTries = Math.max(maxTries, r.tries);
    for (const t of r.others) if (t === 'human' ? false : t === 'cpu' ? false : false) bad++;
    if ([...r.others].some(t => t === 'cpu')) bad++;          // (it is the second player, "cpu": never its own train)
  }
  const ratio = tries / back;
  ok(back > 0 && tries > 0 && ratio > 0.35 && ratio < 0.65, `${level}: tries ${tries} against ${back} take-backs: ${ratio.toFixed(2)} of them (about half)`);
  ok(maxTries <= Math.ceil(G.WOBBLE[level].max * G.TRY_SHARE !== undefined ? G.WOBBLE[level].max * 0.5 : 1), `${level}: never more than ${Math.ceil(G.WOBBLE[level].max * 0.5)} in an opening (${maxTries})`);
  ok(bad === 0, `${level}: always a train that is not its own`);
}
{
  const t = LEVELS.map(l => 0);
  ok(E.TRY_SHARE === 0.5, 'the share is one half');
}
{
  // the same position always gives the same answer, and it never disturbs the game's random numbers
  const a = await opening('easy', 5, 15), b = await opening('easy', 5, 15);
  ok(a.tries === b.tries && a.takebacks === b.takebacks, 'the same opening gives the same tries');
  const g = newRound({ engine: 12, handSize: 15, rng: mulberry32(3), simultaneousOpening: true }); const before = g.rng();
  const g2 = newRound({ engine: 12, handSize: 15, rng: mulberry32(3), simultaneousOpening: true });
  invalidAttempt(g2, g2.players[1], { moves: [{}] }, 'easy');
  ok(g2.rng() === before, 'deciding it uses none of the game\'s random numbers');
}

console.log('2. the animation itself (fake page)');
{
  class El { constructor(t) { this.tag = t; this.style = {}; this.children = []; this.className = ''; this.dataset = {}; this.attrs = {}; }
    appendChild(c) { this.children.push(c); return c; } remove() { this.removed = true; }
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, width: 0, height: 0 }; } getAttribute(k) { return this.attrs[k] || null; }
    animate(frames, opts) { this.frames = frames; this.opts = opts; const self = this; return { finished: new Promise(r => { self.finish = r; }) }; } }
  const mk = (rect, extra) => Object.assign(new El('div'), { rect }, extra || {});
  const body = new El('body'); const created = [];
  const doc = { body, createElement: t => { const e = new El(t); created.push(e); return e; } };
  const hand = mk({ left: 10, top: 600, width: 80, height: 40 }); hand.dataset.key = '1-2';
  const back = mk({ left: 100, top: 40, width: 12, height: 22 });
  const lastTile = mk({ left: 120, top: 300, width: 80, height: 40 });
  const scroller = mk({ left: 0, top: 280, width: 300, height: 80 }); scroller.sc = true;
  const root = { querySelector: sel => (sel.indexOf('.hand .tile-btn[data-key="1-2"]') === 0 ? hand : sel.indexOf('.hand .tile-btn') === 0 ? hand : sel === '.cpu-hand .back' ? back : sel.indexOf('.scroller[data-train="cpu2"]') === 0 ? Object.assign(scroller, { querySelectorAll: () => [lastTile] }) : sel.indexOf('.cpu-hand[data-player') === 0 ? null : null),
    querySelectorAll: sel => (sel.indexOf('.back') >= 0 ? [back] : []) };
  const fx = G.createFx(root, doc, () => 0);
  fx.bounce({ playerId: 'human', trainId: 'cpu2', key: '1-2' });
  const w = created.find(e => e.className === 'flying');
  ok(w && body.children.includes(w) && w.frames && w.frames.length >= 6, 'a flying face-down tile is made, with its keyframes (there, a shake, and back)');
  ok(w && w.style.width === `${40 * 1.9615}px` && parseFloat(w.style.left) >= 0 && parseFloat(w.style.left) + 40 * 1.9615 <= 300, 'it is a tile of the board\'s size, in the empty place after the last tile, kept in view');
  ok(fx.active === 1, 'it counts as in flight');
  w.finish(); await tick(); await tick();
  ok(w.removed && fx.active === 0, 'and when it is back it is gone');
  fx.bounce({ playerId: 'cpu', trainId: 'cpu2' });
  ok(created.filter(e => e.className === 'flying').length === 2, 'a computer\'s try, from its row of tiles, too');
  fx.cancelAll(); ok(fx.active === 0, 'cancelAll clears it');
  const n0 = created.length; fx.bounce({ playerId: 'human', trainId: 'nowhere', key: '1-2' });
  ok(created.length === n0, 'a train that is not on the screen: nothing');
}

console.log('3. a person\'s invalid try, on this page and online');
{
  const store = {}; const calls = [];
  const root = { set innerHTML(v) { this.h = v; }, get innerHTML() { return this.h || ''; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const fx = { capture() { return null; }, land() {}, captureDraw() { return null; }, landDraw() {}, captureUndo() { return null; }, landUndo() {}, bounce(s) { calls.push(s); }, reapply() {}, cancelAll() {}, shownOf() { return null; }, active: 0 };
  const app = G.createApp({ root, fx, rng: mulberry32(5), paceRng: () => 0, chatRng: () => 0.99, sleep: async () => {}, reducedMotion: false, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  app.dispatch({ type: 'boot' });
  app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'normal', allowHints: false });
  for (let i = 0; i < 300 && !(app.state.awaiting && app.state.awaiting.kind === 'build'); i++) await wait(5);
  const S = app.state, a = S.awaiting, m0 = a.moves[0];
  app.dispatch({ type: 'selectTile', key: key(m0.tile) });
  calls.length = 0;
  app.dispatch({ type: 'playOn', train: 'mexican' });
  ok(calls.length === 1 && calls[0].playerId === 'human' && calls[0].trainId === 'mexican' && calls[0].key === key(m0.tile), `hints off, a tile on a train it does not go on: the animation (${JSON.stringify(calls[0])})`);
  calls.length = 0;
  app.dispatch({ type: 'dropOnTrain', key: key(m0.tile), train: 'cpu' });
  ok(calls.length === 1 && calls[0].trainId === 'cpu', 'a tile let go over a train it does not go on: the animation');
  calls.length = 0;
  app.dispatch({ type: 'invalidTry', train: 'cpu', key: key(m0.tile) });
  ok(calls.length === 1, 'a drag that ends over a train it cannot go on: the animation');
  calls.length = 0;
  app.dispatch({ type: 'selectTile', key: key(m0.tile) }); app.dispatch({ type: 'playOn', train: m0.trainId });
  ok(calls.length === 0, 'a legal play: no animation');
}
{
  const pushes = [[], [], []];
  const m = new OnlineMatch({ names: ['Ann', 'Ben', 'Marta'], computer: { level: 'easy' }, rounds: 1, hand: 8, stepDelay: 0, sleep: async () => {}, rng: mulberry32(2), chatRng: () => 0.99, nativeChance: 0, foodChance: 0, push(seat, msg) { pushes[seat].push(msg); } });
  const run = m.start();
  for (let i = 0; i < 200 && !m.awaiting[0]; i++) await wait(5);
  const before = pushes.map(p => p.length);
  m.tried(0, 'cpu');            // Ann tried a tile on Ben's train (on her screen, Ben is "cpu")
  const ev = s => pushes[s].slice(before[s]).flatMap(x => x.events || []).filter(e => e.e === 'try');
  ok(ev(0).length === 0, 'the person who tried gets no echo (their own page showed it)');
  ok(ev(1).length === 1 && ev(1)[0].who === 'opp2' && ev(1)[0].train === 'human', 'the other person sees it: the person who tried (his second opponent) tried THEIR train ("human" on their screen)');
  const b2 = pushes.map(p => p.length); m.tried(0, 'mexican');
  const e2 = pushes[1].slice(b2[1]).flatMap(x => x.events || []).filter(e => e.e === 'try');
  ok(e2.length === 1 && e2[0].train === 'mexican', 'a try on the Mexican train');
  const b3 = pushes.map(p => p.length); m.tried(0, 'nonsense'); m.tried(0, undefined);
  ok(pushes[1].length === b3[1], 'a train that is not one: nothing is sent');
  m.abort(); await run.catch(() => {});
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
