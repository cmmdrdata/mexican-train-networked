'use strict';
// Hints off: you may draw even if you have a play (the game does not refuse it, which would tell you that you have one), unless a double has to be covered.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32, key, newRound, legalMoves, buildPhase, drawAnyway, cpuBuildAction } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const wait = ms => new Promise(r => setTimeout(r, ms));

console.log('1. the engine: a draw you did not have to make');
{
  const g = newRound({ engine: 12, handSize: 15, rng: mulberry32(4), simultaneousOpening: true });
  const p = g.players[0]; g.noMatch = { human: [5, 6] };
  const hand0 = p.hand.length, bone0 = g.boneyard.length, top = g.boneyard[g.boneyard.length - 1];
  const t = drawAnyway(g, p);
  ok(t && key(t) === key(top) && p.hand.length === hand0 + 1 && g.boneyard.length === bone0 - 1 && p.hand.some(x => key(x) === key(t)), 'it takes the top tile of the boneyard into the hand');
  ok(g.noMatch.human === null, 'and, as for any draw, what the others knew about that hand (that it had no match for some numbers) no longer holds');
  g.openDouble = { trainId: 'mexican', value: 5 };
  const h1 = p.hand.length, b1 = g.boneyard.length;
  ok(drawAnyway(g, p) === null && p.hand.length === h1 && g.boneyard.length === b1, 'not while a double has to be covered: nothing is drawn');
  g.openDouble = null; g.boneyard.length = 0;
  ok(drawAnyway(g, p) === null && p.hand.length === h1, 'and not from an empty boneyard');
}
async function section2() {
  console.log('2. the opening: a draw before anything is down');
{
  const mk = seed => newRound({ engine: 12, handSize: 15, rng: mulberry32(seed), simultaneousOpening: true });
  const quiet = { onBuildPlay() {}, onBuildUndo() {}, onBuildDraw() {}, onBuildDone() {}, onBuildPass() {} };
  const run = async (seed, script) => {
    const g = mk(seed), p = g.players[0], infos = []; let i = 0, err = null;
    const agent = { act: async (gm, pl, info) => { infos.push(Object.assign({}, info)); const a = script[i++]; return typeof a === 'function' ? a(gm, pl, info) : a; } };
    try { await buildPhase(g, p, agent, quiet); } catch (e) { err = e.message; }
    return { g, p, infos, err };
  };
  const play = (gm, pl, info) => ({ type: 'play', move: info.moves[0] });
  let seed = 1; while (legalMoves(mk(seed), mk(seed).players[0], { ownOnly: true }).length === 0) seed++;
  const r1 = await run(seed, [{ type: 'draw' }, play, { type: 'done' }]);
  ok(r1.infos[0].canDrawEarly === true && r1.infos[0].canDraw === false && r1.infos[0].moves.length > 0, 'with a tile that fits and nothing down, the opening says a draw is possible (a draw you did not have to make)');
  ok(r1.err === null && r1.p.hand.length === 15 && r1.g.opening.human.drew === true && r1.infos.length === 3, 'the draw is accepted and the opening goes on (one drawn, one played: 15 in the hand)');
  ok(r1.infos[1].canDrawEarly === false && r1.infos[1].moves.length > 0, 'afterwards it is not offered again: one draw only');
  const r2 = await run(seed, [{ type: 'draw' }, { type: 'draw' }]);
  ok(/illegal action in the opening/.test(r2.err || ''), 'a second draw is refused by the engine');
  const r3 = await run(seed, [play, { type: 'draw' }]);
  ok(/illegal action in the opening/.test(r3.err || '') && r3.infos[1].canDrawEarly === false, 'and once a tile is down there is no drawing');
  const r4 = await run(seed, [{ type: 'draw' }]);
  ok(r4.p.hand.length === 16 && r4.g.opening.human.drew === true && r4.g.opening.human.lastDrew && r4.infos.length >= 1, 'the drawn tile is in the hand and the opening notes that the one draw has been used');
  // the boneyard emptied by somebody else while this person was deciding: no tile is invented
  const g5 = mk(seed), p5 = g5.players[0]; let n5 = 0;
  const agent5 = { act: async (gm, pl, info) => { n5++; if (n5 === 1) { gm.boneyard.length = 0; return { type: 'draw' }; } return { type: 'done' }; } };
  await buildPhase(g5, p5, agent5, quiet);
  ok(p5.hand.length === 15 && n5 >= 2, 'if the last tile was taken meanwhile, nothing is drawn (no missing tile appears in the hand)');
  // the computer never draws unless it has to
  let cpuEarly = 0, cpuRuns = 0;
  for (const level of E.LEVELS) for (let sd = 1; sd <= 40; sd++) {
    const g = mk(sd * 7 + 1), p = g.players[1];
    const agent = { act: async (gm, pl, info) => { const a = cpuBuildAction(gm, pl, info, level); if (a.type === 'draw' && !info.canDraw) cpuEarly++; return a; } };
    await buildPhase(g, p, agent, quiet); cpuRuns++;
  }
  ok(cpuRuns >= 160 && cpuEarly === 0, `the computer players (every level, ${cpuRuns} openings) never draw when they have a play: only a person with hints off can`);
}
}
function fakeTimer() {
  let id = 0, clock = 0; const q = [];
  return { set(fn, ms) { const t = { id: ++id, fn, at: clock + ms, ms }; q.push(t); return t.id; }, clear(i) { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); },
    advance(ms) { const end = clock + ms; for (;;) { q.sort((a, b) => a.at - b.at); const nx = q[0]; if (!nx || nx.at > end) break; q.shift(); clock = nx.at; nx.fn(); } clock = end; }, get clock() { return clock; } };
}
function makeApp(seed) {
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {}, timer = fakeTimer();
  const app = G.createApp({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, chatRng: () => 1, nativeChance: 0, foodChance: 0, timer, now: () => 1e6 + timer.clock, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  return { app, root, timer, S: app.state, d: a => app.dispatch(a) };
}
const all = g => g.players.reduce((n, p) => n + p.hand.length, 0) + Object.values(g.trains).reduce((n, t) => n + t.tiles.length, 0) + g.boneyard.length;
const keys = g => [].concat(...g.players.map(p => p.hand.map(key)), ...Object.values(g.trains).map(t => t.tiles.map(key)), g.boneyard.map(key));
function step(a, A) {
  if (A.kind === 'draw') a.d({ type: 'draw' });
  else if (A.kind === 'modal') a.d({ type: 'dialogOk' });
  else if (A.kind === 'build') { if (A.canDraw) a.d({ type: 'draw' }); else if (A.canBuild) a.d({ type: 'autoBuild' }); else if (A.canDone) a.d({ type: 'endBuild' }); else a.d({ type: 'undoTile' }); }
  else { const m = A.moves[0]; a.d({ type: 'selectTile', key: key(m.tile) }); if (a.S.awaiting === A) a.d({ type: 'playOn', train: m.trainId }); }
}
async function reach(wanted, o) {
  for (let seed = (o && o.from) || 1; seed < ((o && o.from) || 1) + 60; seed++) {
    const a = makeApp(seed); a.d({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'easy' });
    if (!(o && o.hints)) a.d({ type: 'setAllowHints', value: false });
    for (let i = 0; i < 6000; i++) {
      await tick(); const A = a.S.awaiting;
      if (a.S.modal && a.S.modal.type === 'roundEnd') break;
      if (!A) continue;
      if (wanted(A, a)) return { a, A };
      step(a, A);
    }
  }
  return null;
}
const untilNew = async (a, A) => { for (let w = 0; w < 600 && !(a.S.awaiting && a.S.awaiting !== A) && !a.S.modal; w++) await wait(2); return a.S.awaiting; };
(async () => {
  await section2();
  console.log('3. the game against the computer, hints off');
  {
    const f = await reach((A, a) => A.kind === 'move' && !a.S.game.openDouble && a.S.game.boneyard.length > 3);
    ok(!!f && f.a.S.opts.allowHints === false, 'a move prompt, no double to cover, hints off');
    const { a, A } = f, me = a.S.game.players[0];
    const hand0 = me.hand.length, bone0 = a.S.game.boneyard.length, log0 = a.S.log.length, oldMoves = A.moves.map(m => key(m.tile) + '>' + m.trainId);
    a.d({ type: 'draw' });
    const B = await untilNew(a, A);
    ok(me.hand.length === hand0 + 1 && a.S.game.boneyard.length === bone0 - 1, 'drawing while you have a play is allowed: a tile comes from the boneyard into your hand');
    ok(B && B.kind === 'move' && B.drewAnyway === true && B !== A, 'and the turn goes on: you are asked for your move again');
    ok(oldMoves.every(m => B.moves.some(x => key(x.tile) + '>' + x.trainId === m)), 'with everything you could play before still possible' + (B && B.moves.length > oldMoves.length ? ' (and the new tile too)' : ''));
    ok(a.S.log.slice(log0).some(l => /^You drew \d+-\d+\.$/.test(l)) && a.S.notice === '', 'it says which tile you drew, and there is no refusal message');
    ok(a.S.drawnKey && me.hand.some(t => key(t) === a.S.drawnKey), 'and the new tile is marked as just drawn');
    const bone1 = a.S.game.boneyard.length; a.d({ type: 'draw' }); await tick();
    ok(a.S.awaiting === B && a.S.game.boneyard.length === bone1 && /already drawn a tile this turn/.test(a.root.innerHTML), 'a second draw in the same turn is refused, with a message, and changes nothing');
    const m = B.moves[0]; a.d({ type: 'selectTile', key: key(m.tile) }); a.d({ type: 'playOn', train: m.trainId });
    for (let w = 0; w < 5; w++) await tick();
    ok(a.S.awaiting !== B && me.hand.length === hand0, 'you can still play, and the turn passes on as usual');
    const A2 = await (async () => { for (let w = 0; w < 800; w++) { await wait(2); const x = a.S.awaiting; if (x && x.kind === 'move' && x !== B) return x; if (a.S.modal) return null; } return null; })();
    ok(!A2 || A2.drewAnyway === false, 'and on the next turn a draw is allowed again');
  }
  {
    const f = await reach((A, a) => A.kind === 'move' && !!a.S.game.openDouble, { from: 1 });
    ok(!!f, 'a move prompt with a double that has to be covered, hints off');
    const { a, A } = f, me = a.S.game.players[0]; const hand0 = me.hand.length, bone0 = a.S.game.boneyard.length;
    a.d({ type: 'draw' }); await tick(); await tick();
    ok(a.S.awaiting === A && me.hand.length === hand0 && a.S.game.boneyard.length === bone0 && /double has to be covered first/.test(a.root.innerHTML), 'while a double has to be covered the draw is refused, with a message, and nothing changes');
    ok(A.moves.every(m => m.trainId === a.S.game.openDouble.trainId), '(and the only plays are on that double)');
    const m = A.moves[0]; a.d({ type: 'selectTile', key: key(m.tile) }); a.d({ type: 'playOn', train: m.trainId });
    ok(a.S.awaiting !== A, 'covering it works as ever');
  }
  {
    const f = await reach((A, a) => A.kind === 'move' && !a.S.game.openDouble);
    const { a, A } = f; const me = a.S.game.players[0]; const hand0 = me.hand.length;
    a.S.game.boneyard.length = 0;
    a.d({ type: 'draw' }); await tick();
    ok(a.S.awaiting === A && me.hand.length === hand0 && /boneyard is empty/.test(a.root.innerHTML), 'from an empty boneyard: refused, with a message');
  }
  {
    const f = await reach((A, a) => A.kind === 'move' && !a.S.game.openDouble && a.S.game.boneyard.length > 3, { hints: true });
    const { a, A } = f; const me = a.S.game.players[0]; const hand0 = me.hand.length, bone0 = a.S.game.boneyard.length;
    ok(a.S.opts.allowHints !== false, '(hints on)');
    a.d({ type: 'draw' }); await tick(); await tick();
    ok(a.S.awaiting === A && me.hand.length === hand0 && a.S.game.boneyard.length === bone0 && a.S.notice === '', 'with hints ON nothing changes: the Draw is not offered while you have a play, and pressing it does nothing (as before)');
  }
  {
    // the person has no play: the ordinary draw, as ever
    const f = await reach((A, a) => A.kind === 'draw', { from: 1 });
    ok(!!f, 'a turn with nothing to play, hints off');
    const { a, A } = f, me = a.S.game.players[0]; const hand0 = me.hand.length;
    a.d({ type: 'draw' }); await tick(); await tick();
    ok(me.hand.length === hand0 + 1, 'the ordinary draw (nothing fits) works as ever');
  }
  console.log('4. the opening, hints off');
  {
    const f = await reach((A, a) => A.kind === 'build' && A.placed === 0 && A.moves.length > 0 && A.canDrawEarly && !A.canDraw, { from: 1 });
    ok(!!f, 'at the start of the opening, a tile fits the engine, hints off');
    const { a, A } = f, me = a.S.game.players[0]; const hand0 = me.hand.length, bone0 = a.S.game.boneyard.length;
    a.d({ type: 'draw' });
    const B = await untilNew(a, A);
    ok(me.hand.length === hand0 + 1 && a.S.game.boneyard.length === bone0 - 1 && B && B.kind === 'build' && B.canDrawEarly === false && B.moves.length >= A.moves.length, 'a draw you did not have to make is allowed: the tile is in your hand, and you carry on building');
    const bone1 = a.S.game.boneyard.length; a.d({ type: 'draw' }); await tick();
    ok(a.S.awaiting === B && a.S.game.boneyard.length === bone1 && /only draw before/.test(a.root.innerHTML), 'but not twice: refused, with a message');
    const m = B.moves[0]; a.d({ type: 'selectTile', key: key(m.tile) }); a.d({ type: 'playOn', train: m.trainId }); await tick(); await tick();
    const C = a.S.awaiting;
    if (C && C.kind === 'build') { const b2 = a.S.game.boneyard.length; a.d({ type: 'draw' }); await tick(); ok(a.S.game.boneyard.length === b2 && /only draw before/.test(a.root.innerHTML), 'and once a tile is down, there is no drawing: refused with a message'); } else ok(false, 'a tile put down in the opening');
  }
  {
    const f = await reach((A, a) => A.kind === 'build' && A.placed === 0 && A.moves.length > 0 && A.canDrawEarly && !A.canDraw, { from: 1, hints: true });
    const { a, A } = f, me = a.S.game.players[0]; const hand0 = me.hand.length;
    a.d({ type: 'draw' }); await tick(); await tick();
    ok(a.S.awaiting === A && me.hand.length === hand0 && a.S.notice === '', 'with hints ON the opening does not draw for you either (the Draw button is only for when nothing fits)');
  }

  console.log('5. whole games with draws you did not have to make: no tile is lost or made');
  {
    let games = 0, steps = 0, early = 0, refused = 0, bad = 0, lost = 0, finished = 0, doubleRefused = 0, offered = 0, fits = 0, stale = 0;
    const rnd = mulberry32(5);
    for (const [hand, seed] of [[8, 1], [12, 2], [15, 3], [8, 4], [12, 5], [15, 6], [8, 7], [12, 8]]) {
      const a = makeApp(seed); a.d({ type: 'startGame', rounds: 1, hand, style: 'pips', level: 'normal' }); a.d({ type: 'setAllowHints', value: false }); games++;
      let total = null;
      for (let i = 0; i < 9000; i++) {
        await tick(); const A = a.S.awaiting;
        if (a.S.modal && a.S.modal.type === 'roundEnd') { finished++; break; }
        if (!A) continue;
        const g = a.S.game, n = all(g); if (total === null) total = n; if (n !== total) lost++;
        if (new Set(keys(g)).size !== keys(g).length) bad++;
        steps++;
        if ((A.kind === 'move' || A.kind === 'build') && rnd() < 0.3) {
          const dbl = !!g.openDouble, b0 = g.boneyard.length;
          a.d({ type: 'draw' });
          if (A.kind === 'move' && dbl) { if (g.boneyard.length === b0 && a.S.awaiting === A) doubleRefused++; else bad++; continue; }
          if (a.S.awaiting === null) {
            early++; for (let w = 0; w < 400 && !(a.S.awaiting && a.S.awaiting !== A) && !a.S.modal; w++) await wait(2);
            const B = a.S.awaiting;
            if (B && B.kind === 'move') {                         // what you are offered is exactly what the hand can now play, the new tile included
              offered++;
              const want = new Set(legalMoves(a.S.game, a.S.game.players[0]).map(m => key(m.tile) + '>' + m.trainId)), got = new Set(B.moves.map(m => key(m.tile) + '>' + m.trainId));
              if (want.size !== got.size || [...want].some(x => !got.has(x))) stale++;
              const drawn = a.S.drawnKey; if (drawn && B.moves.some(m => key(m.tile) === drawn)) fits++;
            }
          } else refused++;
          continue;
        }
        step(a, A);
      }
    }
    ok(finished === games && lost === 0 && bad === 0, `${games} whole games (hints off, three hand sizes) were played to the end of their round with draws you did not have to make thrown in: no tile lost, none made twice (${lost} counts that were off, ${bad} duplicates)`);
    ok(offered >= 20 && stale === 0 && fits >= 3, `after a draw you did not have to make, the plays you are offered are exactly what the hand can play now: ${offered} turns checked, ${fits} where the new tile itself could be played, ${stale} that were out of date`);
    ok(early >= 20 && refused >= 5 && doubleRefused >= 1, `with every kind of case really happening: ${early} draws allowed, ${refused} refused (second draw, empty boneyard, a tile already down), ${doubleRefused} refused for a double to cover`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
