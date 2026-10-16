'use strict';
// Against the computer, the soft low "your turn" sound plays once at the start of each of your turns (not for the opening, not again for the cover of a double or after a draw), and not when muted.
require('./game.js');
const G = globalThis.MexicanTrainGame;
const { mulberry32, key } = G.Engine;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => setImmediate(r));

async function game(seed, muted, buzzes) {
  const store = muted ? { 'mt-opts': JSON.stringify({ rounds: 1, hand: 8, style: 'pips', sound: false, level: 'easy', chat: false }) } : {};
  const calls = { turn: 0, clack: 0 };
  const sound = { unlock() {}, clack() { calls.clack++; }, turn() { calls.turn++; }, tick() {} };
  const root = { set innerHTML(v) { this.h = v; }, get innerHTML() { return this.h || ''; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const app = G.createApp({ root, rng: mulberry32(seed), paceRng: () => 0, chatRng: () => 0.99, sleep: async () => {}, reducedMotion: true, sound, vibrate: ms => { if (buzzes) buzzes.push(ms); }, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  app.dispatch({ type: 'boot' });
  app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy', chat: false });
  const S = app.state; let turns = 0, seen = 0, humanPrompts = 0, opening = 0;
  for (let i = 0; i < 6000 && !(S.modal && S.modal.type === 'roundEnd'); i++) {
    await tick();
    const a = S.awaiting;
    for (; seen < S.log.length; seen++) {
      const l = S.log[seen];
      if (/^You played (\d+)-(\d+) on/.test(l)) { const m = l.match(/^You played (\d+)-(\d+)/); if (m[1] !== m[2]) turns++; }
      else if (/^You pass/.test(l) || /^That tile does not fit\. You pass/.test(l) || /^The boneyard is empty/.test(l)) turns++;
    }
    if (!a) continue;
    if (a.kind === 'modal') break;
    if (a.kind === 'build') { opening++; app.dispatch({ type: a.canBuild ? 'autoBuild' : a.canDraw ? 'draw' : a.canDone ? 'endBuild' : 'undoTile' }); continue; }
    humanPrompts++;
    if (a.kind === 'draw') app.dispatch({ type: 'draw' });
    else { const m = a.moves[0]; app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); }
  }
  return { calls, turns, humanPrompts, opening };
}
(async () => {
  let total = 0, cues = 0, prompts = 0, worst = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const r = await game(seed, false);
    total += r.turns; cues += r.calls.turn; prompts += r.humanPrompts; worst = Math.max(worst, Math.abs(r.calls.turn - r.turns));
    ok(r.calls.turn >= 1, `seed ${seed}: it sounds at least once (${r.calls.turn})`);
    ok(Math.abs(r.calls.turn - r.turns) <= 1, `seed ${seed}: about one sound per turn of yours (${r.calls.turn} sounds, ${r.turns} turns)`);
  }
  ok(cues <= prompts, `never more sounds than prompts (${cues} <= ${prompts}): a double's cover or a draw's play does not sound again`);
  const m = await game(3, true);
  ok(m.calls.turn === 0, 'with sound switched off, nothing plays');
  const b1 = [], b2 = [];
  const r1 = await game(4, false, b1), r2 = await game(4, true, b2);
  ok(b1.length === r1.calls.turn && b1.length >= 1 && b1.every(ms => ms > 0 && ms <= 100), `a short buzz goes with each sound (${b1.length} buzzes of ${b1[0]} ms)`);
  ok(b2.length === 0, 'muted: no buzz either');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
