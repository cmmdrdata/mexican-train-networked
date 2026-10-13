'use strict';
// The computer changing its mind while it builds, in whole games: against the computer on one's own, and in a hosted game.
const { OnlineMatch } = require('../online-match.js');         // (this loads the game's code; the match and this test must use the very same copy of it)
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));

console.log('1. against the computer');
function makeApp(seed, o) {
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {}, sleeps = [], snd = { clacks: 0, unlock() {}, clack() { snd.clacks++; } };
  const app = G.createApp(Object.assign({ root, rng: mulberry32(seed), paceRng: () => 0, sleep: async ms => { sleeps.push(ms); }, reducedMotion: false,        // (normal motion: with reduced motion every wait is halved)
     chatRng: () => 1, nativeChance: 0, foodChance: 0, sound: snd,
    storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } }, o));
  return { app, root, sleeps, snd };
}
(async () => {
  const perLevel = {};
  for (const level of ['easy', 'normal', 'hard', 'expert']) {
    let games = 0, openings = 0, undos = 0, bad = 0, withBack = 0, sleepsUndo = 0, clackOk = 0, seriesOk = 0, finalOk = 0, replays = 0, sleepsReplace = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const q = makeApp(seed); games++;
      const st = q.app.state; const series = []; let undoN = 0, placeN = 0, lenAtEnd = -1;
      const ob = q.app.ui.onBuildPlay, ou = q.app.ui.onBuildUndo, od = q.app.ui.onOpeningDone;
      q.app.ui.onOpeningDone = async (...a) => { lenAtEnd = st.game.trains.cpu.tiles.length; return od(...a); };      // (the moment the opening ends: the computer's first normal turn follows at once)
      let afterMind = false, replaysN = 0;                                                         // (the next tile the computer lays is straight after a change of mind)
      q.app.ui.onBuildPlay = async (game, player, mv) => { if (player.id !== 'human') { placeN++; series.push(game.trains[player.id].tiles.length); if (afterMind) { replaysN++; afterMind = false; } } return ob(game, player, mv); };
      q.app.ui.onBuildUndo = async (game, player, tile) => { if (player.id !== 'human') afterMind = !!game.opening[player.id].lastWobble; const r = await ou(game, player, tile); if (player.id !== 'human') { undoN++; series.push(game.trains[player.id].tiles.length); } return r; };
      q.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level });
      for (let i = 0; i < 6000; i++) {
        await tick(); const A = st.awaiting;
        if (st.game && st.game.opening && st.game.players.every(p => st.game.opening[p.id].finished)) break;      // everybody has finished building
        if (A && A.kind === 'build') { if (A.canDraw) q.app.dispatch({ type: 'draw' }); else if (A.canBuild) q.app.dispatch({ type: 'autoBuild' }); else if (A.canDone) q.app.dispatch({ type: 'endBuild' }); else q.app.dispatch({ type: 'undoTile' }); }
      }
      openings++; undos += undoN; replays += replaysN;
      let prev = 0, one = true; for (const n of series) { if (Math.abs(n - prev) !== 1) one = false; prev = n; }
      if (one) seriesOk++; else bad++;
      if (undoN > 0) withBack++;
      const opened = lenAtEnd === (series.length ? series[series.length - 1] : 0);      // the train it finished with is where its last change left it
      if (opened) finalOk++;
      sleepsUndo += q.sleeps.filter(ms => ms === G.PACE.undo[0]).length; sleepsReplace += q.sleeps.filter(ms => ms === G.PACE.replace[0]).length;
      if (q.snd.clacks >= placeN + undoN) clackOk++;
      perLevel[level] = { games, undos, withBack, per: undos / games };
      q.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level });                  // (leave: the next game starts fresh)
    }
    const s = perLevel[level];
    ok(bad === 0 && finalOk === games, `${level}: in ${games} real games the computer's train changed by one tile at a time, and the opening finished with its train as it ended (${bad} games where it did not)`);
    ok(sleepsReplace === replays && replays > 0, `${level}: and each tile laid straight after changing its mind had the quicker re-lay wait (${sleepsReplace} of those waits for ${replays} such tiles)`);
    ok(sleepsUndo === undos, `${level}: each take-back had the quick take-back wait (${sleepsUndo} of those waits for ${undos} take-backs)`);
    ok(clackOk === games, `${level}: and its click (at least one for each tile laid and each taken back)`);
  }
  const pl = ['easy', 'normal', 'hard', 'expert'].map(l => perLevel[l].per);
  ok(pl[0] > pl[1] && pl[1] > pl[2] && pl[2] >= pl[3] && pl[0] > pl[3] + 1, `in real games, take-backs per opening: Easy ${pl[0].toFixed(2)}, Medium ${pl[1].toFixed(2)}, Hard ${pl[2].toFixed(2)}, Expert ${pl[3].toFixed(2)}`);
  ok(perLevel.easy.withBack >= 15 && perLevel.normal.withBack >= 15 && perLevel.expert.withBack >= 3, `Easy changed its mind in ${perLevel.easy.withBack} of 25 games, Medium in ${perLevel.normal.withBack}, Hard in ${perLevel.hard.withBack}, Expert in ${perLevel.expert.withBack}`);

  console.log('2. a hosted game');
  function fakeTimer() {
    let id = 0, t = 0; const q = [];
    return { q, get now() { return t; }, set(fn, ms) { q.push({ id: ++id, fn, at: t + ms }); return id; }, clear(x) { const i = q.findIndex(e => e.id === x); if (i >= 0) q.splice(i, 1); },
      advance(ms) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const e = q[0]; if (!e || e.at > end) break; q.shift(); t = e.at; e.fn(); } t = end; } };
  }
  const hs = { matches: 0, undoEvents: 0, serverUndos: 0, oneAtATime: 0, bad: 0, seenByBoth: 0, sleepsUndo: 0, replays: 0, sleepsReplace: 0 };
  for (const level of ['easy', 'normal']) for (let seed = 1; seed <= 15; seed++) {
    const timer = fakeTimer(), ev = [[], [], []], sleeps = [], views = [];
    const m = new OnlineMatch({ names: ['Ann', 'Ben', 'Gandalf'], computer: { level }, theme: 'classic', rounds: 1, hand: 15, stepDelay: 0, nativeChance: 0, foodChance: 0,
      sleep: async ms => { sleeps.push(ms); }, rng: mulberry32(seed + 40), paceRng: () => 0, chatRng: () => 1, timer, now: () => timer.now,
      push(seat, msg) { if (msg && Array.isArray(msg.events)) ev[seat].push(...msg.events); } });
    let afterMind = false, replaysH = 0;                                  // (the next tile the computer lays is straight after a change of mind)
    const hu = m.hooks.onBuildUndo, hp = m.hooks.onBuildPlay;
    m.hooks.onBuildUndo = async (game, player, ...r) => { if (m.computers[m._seat(player)]) afterMind = !!game.opening[player.id].lastWobble; return hu.call(m.hooks, game, player, ...r); };
    m.hooks.onBuildPlay = async (game, player, ...r) => { if (afterMind && m.computers[m._seat(player)]) { replaysH++; afterMind = false; } return hp.call(m.hooks, game, player, ...r); };
    const run = m.start(); hs.matches++;
    const lens = [];
    for (let n = 0; n < 3000; n++) {
      for (const seat of m.humans) {
        const v = m.viewFor(seat);
        if (seat === 0) { const opp = v.game && v.game.trains && v.game.trains[Object.keys(v.game.trains).find(k => k !== 'human' && k !== 'cpu2')]; }
        if (v.awaiting && v.awaiting.kind === 'build') { const a = v.awaiting; if (a.canDraw) m.intent(seat, { a: 'draw' }); else if (a.moves.length && a.placed < 3) m.intent(seat, { a: 'play', tile: a.moves[0].tile, train: a.moves[0].trainId }); else m.intent(seat, { a: a.canDone ? 'done' : 'undo' }); }
        else if (v.awaiting && v.awaiting.kind === 'move') { /* the opening is over */ }
      }
      timer.advance(300); await tick();
      const g = m.game;
      if (g && g.opening && g.players.every(p => g.opening[p.id].finished)) break;
    }
    for (let i = 0; i < 20; i++) { timer.advance(300); await tick(); }
    const cpu = m.game.players.find(p => m.computers[m._seat(p)]);
    const undosServer = m.game.opening[cpu.id].undos || 0;
    hs.serverUndos += undosServer;
    const cpuSeat = m._seat(cpu);
    for (const seat of m.humans) { const n = ev[seat].filter(e => e.e === 'undo' && e.who === m.who(seat, cpuSeat)).length; hs.undoEvents += n; if (n === undosServer) hs.seenByBoth++; }
    hs.sleepsUndo += sleeps.filter(ms => ms === G.PACE.undo[0]).length; hs.sleepsReplace += sleeps.filter(ms => ms === G.PACE.replace[0]).length; hs.replays += replaysH;
    m.abort(); await run;
  }
  ok(hs.serverUndos > 10, `${hs.matches} hosted matches: the computer took ${hs.serverUndos} tiles back in all`);
  ok(hs.seenByBoth === hs.matches * 2, `and every one of them was shown to both people as an undo of the computer's train (${hs.seenByBoth} of ${hs.matches * 2} people saw exactly as many as there were)`);
  ok(hs.sleepsReplace === hs.replays && hs.replays > 0, `and each tile it laid straight after changing its mind had the quicker re-lay wait (${hs.sleepsReplace} waits for ${hs.replays} such tiles)`);
  ok(hs.sleepsUndo === hs.serverUndos, `each with the quick take-back wait (${hs.sleepsUndo} waits for ${hs.serverUndos} take-backs)`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
