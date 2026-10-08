require('./game.js');
const NEW = globalThis.MexicanTrainGame;
require('./game_before_cover.js');
const OLD = globalThis.MexicanTrainGame;                       // the build from just before this change
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tick = () => new Promise(r => setImmediate(r));
const { mulberry32, key } = NEW.Engine;
const PLACE = 2250, SETTLE = 675, DRAW = 1300, FINISH = 1700;   // the waits when the random value is 0.5

function makeApp(G, seed) {
  const sleeps = [];
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {};
  const app = G.createApp({ root, rng: mulberry32(seed), sleep: async ms => { sleeps.push(ms); }, reducedMotion: false, paceRng: () => 0.5, now: () => 1, chatRng: () => 1, nativeChance: 0, foodChance: 0,
    timer: { set() { return 0; }, clear() {} }, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  return { app, sleeps, S: app.state };
}
// run ONE computer turn on a crafted position, with the page's own hooks and pacing
async function cpuTurn(G, setup) {
  const a = makeApp(G, 1);
  const E = G.Engine;
  const game = E.newRound({ engine: 5, handSize: 1, rng: mulberry32(1), simultaneousOpening: false });
  game.players[0].hand = [[0, 1]]; game.players[1].hand = []; game.boneyard = [];
  setup(game);
  a.S.game = game; a.S.cpuName = 'Marta'; a.S.opts.level = 'normal';
  const events = [];
  const ui = a.app.ui, origPlay = ui.onPlay;
  const spy = Object.assign({}, ui, { onPlay: async (g, p, mv, info) => { events.push([p.id, mv.tile.join('-'), info.doubleOpened ? 'double' : info.doubleSatisfied ? 'cover' : 'tile']); return origPlay(g, p, mv, info); } });
  await E.playTurn(game, game.players[1], a.app.controllers.cpu, spy);
  return { sleeps: a.sleeps, game, events };
}

(async () => {
  console.log('1. the computer plays a double and holds a tile that covers it');
  const withCover = g => { g.players[1].hand = [[12, 12], [0, 12], [3, 4]]; g.trains.mexican.end = 12; g.trains.cpu.end = 5; g.boneyard = [[6, 7]]; };
  const o1 = await cpuTurn(OLD, withCover), n1 = await cpuTurn(NEW, withCover);
  ok(eq(n1.events, [['cpu', '12-12', 'double'], ['cpu', '0-12', 'cover']]), 'it plays the double, then covers it, in the same turn');
  ok(eq(o1.sleeps, [PLACE, SETTLE, PLACE, SETTLE]), `before: it waited to play the double, settled, WAITED AGAIN to cover it, and settled (${JSON.stringify(o1.sleeps)})`);
  ok(eq(n1.sleeps, [PLACE, SETTLE]), `now: one wait to play the double, then the cover comes at once, then it settles (${JSON.stringify(n1.sleeps)})`);
  ok(n1.game.trains.mexican.tiles.length === 2 && n1.game.openDouble === null && n1.game.players[1].hand.length === 1, 'the double is covered and the turn is over');

  console.log('2. the computer covers YOUR double');
  const coverYours = g => { g.trains.human.tiles = [[5, 12], [12, 12]]; g.trains.human.end = 12; g.openDouble = { trainId: 'human', value: 12 }; g.players[1].hand = [[12, 3], [4, 4]]; g.boneyard = [[6, 7]]; };
  const o2 = await cpuTurn(OLD, coverYours), n2 = await cpuTurn(NEW, coverYours);
  ok(eq(n2.events, [['cpu', '3-12', 'cover']]) || eq(n2.events, [['cpu', '12-3', 'cover']]), 'it covers your double with its matching tile');
  ok(eq(o2.sleeps, [PLACE, SETTLE]), `before: it thought for a while first (${JSON.stringify(o2.sleeps)})`);
  ok(eq(n2.sleeps, [SETTLE]), `now: no thinking wait at all, just the short beat after (${JSON.stringify(n2.sleeps)})`);
  ok(n2.game.openDouble === null && n2.game.trains.human.tiles.length === 3, 'your double is covered');

  console.log('3. what has NOT changed');
  const noCover = g => { g.players[1].hand = [[12, 12], [3, 4]]; g.trains.mexican.end = 12; g.trains.cpu.end = 5; g.boneyard = [[6, 7]]; };
  const o3 = await cpuTurn(OLD, noCover), n3 = await cpuTurn(NEW, noCover);
  ok(eq(n3.sleeps, o3.sleeps) && n3.sleeps[0] === PLACE && n3.sleeps.includes(SETTLE), `a double it cannot cover is paced exactly as before (${JSON.stringify(n3.sleeps)})`);
  ok(n3.game.openDouble && n3.game.openDouble.trainId === 'mexican' && n3.game.trains.cpu.marker === true, '...and it still draws, fails to cover, passes with a marker and leaves the double open');
  const plain = g => { g.players[1].hand = [[5, 8], [3, 4]]; g.trains.cpu.end = 5; g.boneyard = []; };
  const o4 = await cpuTurn(OLD, plain), n4 = await cpuTurn(NEW, plain);
  ok(eq(n4.sleeps, o4.sleeps) && eq(n4.sleeps, [PLACE, SETTLE]), 'an ordinary play still gets its thinking time');
  const nothing = g => { g.players[1].hand = [[3, 4]]; g.trains.mexican.end = 11; g.trains.cpu.end = 11; g.boneyard = [[6, 7]]; };
  const o5 = await cpuTurn(OLD, nothing), n5 = await cpuTurn(NEW, nothing);
  ok(eq(n5.sleeps, o5.sleeps), 'a turn with nothing to play (draw, pass) is paced as before');
  // it draws a tile that covers: the drawn tile is played straight away, with no thinking
  const drawCover = g => { g.players[1].hand = [[12, 12], [3, 4]]; g.trains.mexican.end = 12; g.trains.cpu.end = 5; g.boneyard = [[12, 9]]; };
  const o6 = await cpuTurn(OLD, drawCover), n6 = await cpuTurn(NEW, drawCover);
  ok(n6.events.length === 2 && n6.events[1][2] === 'cover', 'it draws a tile that fits the double and covers it');
  ok(o6.sleeps.filter(x => x === PLACE).length === 2 && n6.sleeps.filter(x => x === PLACE).length === 1, `after drawing the cover it plays at once too: one thinking wait instead of two (${JSON.stringify(o6.sleeps)} became ${JSON.stringify(n6.sleeps)})`);
  ok(n6.sleeps.includes(DRAW), '...though the draw itself still takes its usual moment');

  console.log('4. the rest of the game: thinking waits only where there is thinking to do (20 whole matches)');
  async function matchStats(G, seed) {
    const a = makeApp(G, seed);
    let cpuOpening = 0, cpuPlays = 0, covers = 0, placeWaits = 0;
    const origSleep = null;
    const sleeps = a.sleeps;
    const ui = a.app.ui, op = ui.onPlay, obp = ui.onBuildPlay;
    ui.onPlay = async (g, p, mv, info) => { if (p.id === 'cpu') cpuPlays++; return op(g, p, mv, info); };
    // a cover is any decision made while a double is open (that includes a cover that is the last tile, which the engine reports without the "satisfied" flag)
    const cc = a.app.controllers.cpu, oc = cc.choose;
    cc.choose = async (g, p, m, d) => { if (g.openDouble) covers++; return oc.call(cc, g, p, m, d); };
    ui.onBuildPlay = async (g, p, mv) => { if (p.id === 'cpu') cpuOpening++; return obp(g, p, mv); };
    a.app.dispatch({ type: 'startGame', rounds: 4, hand: 12, style: 'pips' });
    for (let i = 0; i < 12000 && !(a.S.modal && a.S.modal.type === 'final'); i++) {
      await tick(); const A = a.S.awaiting; if (!A) continue;
      if (A.kind === 'draw') a.app.dispatch({ type: 'draw' });
      else if (A.kind === 'modal') a.app.dispatch({ type: 'dialogOk' });
      else if (A.kind === 'build') { if (A.canDraw) a.app.dispatch({ type: 'draw' }); else if (A.canBuild) a.app.dispatch({ type: 'autoBuild' }); else if (A.canDone) a.app.dispatch({ type: 'endBuild' }); else a.app.dispatch({ type: 'undoTile' }); }
      else { const m = A.moves[0]; a.app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (a.S.awaiting === A) a.app.dispatch({ type: 'playOn', train: m.trainId }); }
    }
    placeWaits = sleeps.filter(ms => ms === PLACE).length;
    return { cpuOpening, cpuPlays, covers, placeWaits, finished: !!(a.S.modal && a.S.modal.type === 'final') };
  }
  let tot = { opening: 0, plays: 0, covers: 0, waits: 0, oldWaits: 0, oldPlays: 0 }, allFinished = true;
  for (let seed = 1; seed <= 20; seed++) {
    const n = await matchStats(NEW, seed); tot.opening += n.cpuOpening; tot.plays += n.cpuPlays; tot.covers += n.covers; tot.waits += n.placeWaits; allFinished = allFinished && n.finished;
  }
  ok(allFinished, 'every match runs to the end');
  ok(tot.covers > 10, `the computer covered a double ${tot.covers} times in those matches`);
  ok(tot.waits === tot.opening + tot.plays - tot.covers, `every computer placement had its thinking wait except the ${tot.covers} covers: ${tot.waits} waits = ${tot.opening} opening tiles + ${tot.plays} turn plays - ${tot.covers} covers`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
