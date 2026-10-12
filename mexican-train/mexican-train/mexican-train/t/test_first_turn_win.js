require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32, key, handPips } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canon = t => [Math.min(t[0], t[1]), Math.max(t[0], t[1])];
const sortKeys = hand => hand.map(t => key(canon(t))).sort();

/* ---------- a deal of our choosing ----------
 * The game deals by shuffling the 90 tiles (every tile but the engine, 12-12 in round 1) with a
 * Fisher-Yates shuffle. That can be run backwards: for any arrangement we want, there are exact
 * random numbers that produce it. So we can hand the game a rigged "random" source and it deals
 * the hands we want, with no tampering with the game's state afterwards. Before the shuffle the game
 * uses two random numbers (the computer's name, then who goes first); we choose those too. */
const ENGINE = 12;
const POOL = (() => { const t = []; for (let a = 0; a <= 12; a++) for (let b = a; b <= 12; b++) if (!(a === ENGINE && b === ENGINE)) t.push([a, b]); return t; })();
function dealRng({ human, cpu, hand, boneyardEnd = [] }) {
  const mine = human.map(canon), theirs = cpu.map(canon);
  if (mine.length !== hand || theirs.length !== hand) throw new Error('hands must be ' + hand);
  const used = new Set([...mine, ...theirs].map(key));
  if (used.size !== hand * 2) throw new Error('a tile was dealt twice');
  const rest = POOL.filter(t => !used.has(key(t)));
  // the boneyard is drawn from the END: put the tiles we want drawn first last (boneyardEnd is in draw order)
  const wantLast = boneyardEnd.map(canon).reverse();
  const restOrdered = rest.filter(t => !wantLast.some(w => key(w) === key(t))).concat(wantLast);
  const target = [...mine, ...theirs, ...restOrdered];
  const w = POOL.map(t => t.slice()), values = [];
  for (let i = target.length - 1; i >= 1; i--) {
    const j = w.slice(0, i + 1).findIndex(t => key(t) === key(target[i]));
    values.push((j + 0.5) / (i + 1));
    [w[i], w[j]] = [w[j], w[i]];
  }
  const fallback = mulberry32(12345);
  const seq = [0.05, 0.1, ...values];                    // name, who goes first (0.1 = you), then the shuffle
  let n = 0;
  return () => (n < seq.length ? seq[n++] : fallback());
}

/* a full train from the engine 12: every tile used, doubles in the middle (never last) */
const CHAIN_A = [[11, 12], [10, 11], [10, 10], [9, 10], [9, 9], [8, 9], [7, 8], [6, 7], [5, 6], [4, 5], [3, 4], [2, 3], [1, 2], [0, 1], [0, 3]];
/* a second, different full train, for the computer */
const CHAIN_B = [[8, 12], [8, 11], [7, 11], [7, 10], [6, 10], [6, 9], [5, 9], [5, 8], [4, 8], [4, 7], [3, 7], [3, 6], [2, 6], [2, 5], [1, 5]];
/* a hand that can never start a train from 12: even numbers only */
const EVENS = [[0, 2], [0, 4], [0, 6], [0, 8], [0, 10], [2, 4], [2, 6], [2, 8], [2, 10], [4, 6], [4, 8], [4, 10], [6, 8], [6, 10], [8, 10]];

function validChain(engine, tiles) { let end = engine; for (const t of tiles) { if (t[0] !== end) return false; end = t[1]; } return true; }
// the same, for tiles written either way round (as in the chains defined above)
function fits(engine, tiles) { let end = engine; for (const t of tiles) { if (t[0] === end) end = t[1]; else if (t[1] === end) end = t[0]; else return false; } return true; }

async function newGame(deal, level) {
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {};
  const app = G.createApp({ root, rng: dealRng(deal), sleep: async () => {}, reducedMotion: true, now: () => 1, chatRng: () => 1, nativeChance: 0, foodChance: 0, timer: { set() { return 0; }, clear() {} },
    storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  const counts = { turnPlays: 0, turnDraws: 0, turnPasses: 0, buildPlays: { human: 0, cpu: 0 } };
  const ui = app.ui, op = ui.onPlay, od = ui.onDraw, opass = ui.onPass, obp = ui.onBuildPlay;
  ui.onPlay = async (...a) => { counts.turnPlays++; return op(...a); };
  ui.onDraw = async (...a) => { counts.turnDraws++; return od(...a); };
  ui.onPass = async (...a) => { counts.turnPasses++; return opass(...a); };
  ui.onBuildPlay = async (g, p, mv) => { counts.buildPlays[p.id]++; return obp(g, p, mv); };
  app.dispatch({ type: 'startGame', rounds: 4, hand: deal.hand, style: 'pips', level: level || 'normal' });
  const first = await until(() => app.state.awaiting && app.state.awaiting.kind === 'build' && app.state.awaiting);
  return { app, root, S: app.state, counts, first };
  async function until(f, n = 4000) { for (let i = 0; i < n; i++) { await tick(); const r = f(); if (r) return r; } return null; }
}
async function until(f, n = 4000) { for (let i = 0; i < n; i++) { await tick(); const r = f(); if (r) return r; } return null; }
// tap one tile and wait for the next prompt
async function tap(a, tile) {
  const before = a.S.awaiting;
  a.app.dispatch({ type: 'selectTile', key: key(canon(tile)) });
  return until(() => a.S.awaiting && a.S.awaiting !== before && a.S.awaiting.kind === 'build' && a.S.awaiting);
}
const roundEnd = a => until(() => a.S.modal && a.S.modal.type === 'roundEnd' && a.S.modal);

(async () => {
  console.log('0. the rigged deal really deals what we asked for');
  {
    const a = await newGame({ hand: 15, human: CHAIN_A, cpu: EVENS });
    ok(a.first && eq(sortKeys(a.S.game.players[0].hand), sortKeys(CHAIN_A)), 'you are dealt exactly the 15 tiles of the chain');
    ok(eq(sortKeys(a.S.game.players[1].hand.concat(a.S.game.trains.cpu.tiles.map(canon))), sortKeys(EVENS)) || a.S.game.players[1].hand.length >= 14, 'the computer is dealt the even-numbers hand');
    ok(a.S.game.engine === 12 && a.S.game.players[0].hand.length === 15 && fits(12, CHAIN_A) && fits(12, CHAIN_B) && !CHAIN_A.some(t => CHAIN_B.some(u => key(t) === key(u))), 'the engine is the double-12, and both chains are real trains from it, with no tile in common');
    ok(a.first.moves.length === 1 && key(a.first.moves[0].tile) === '11-12', 'the only tile that fits the engine is 11-12, so the opening has one way to start');
    ok(a.first.canBuild === true && a.first.buildCount === 15, 'and "Build my longest train" offers all 15');
  }

  console.log('1. you tap all 15 tiles, one at a time, then press Done');
  {
    const a = await newGame({ hand: 15, human: CHAIN_A, cpu: EVENS });
    let A = a.first, placed = 0;
    for (const t of CHAIN_A) {
      ok(A && A.moves.some(m => key(m.tile) === key(canon(t))), `tile ${t.join('-')} is playable when it is its turn`);
      A = await tap(a, t); placed++;
      if (!A) break;
    }
    ok(placed === 15 && a.S.game.players[0].hand.length === 0, 'all 15 tiles are on your train and your hand is empty');
    ok(a.S.game.trains.human.tiles.length === 15 && validChain(12, a.S.game.trains.human.tiles), 'it is one unbroken train from the engine, with the two doubles in the middle');
    ok(A && A.canDone === true && A.moves.length === 0 && !a.S.modal, 'the game then waits for you to press Done: Done is allowed and nothing is left to play');
    a.app.dispatch({ type: 'endBuild' });
    const R = await roundEnd(a);
    ok(!!R, 'the round ends as soon as the opening is over');
    ok(R && R.winnerId === 'human' && !R.blocked && !R.tie, 'you win it: not blocked, not a tie');
    ok(/You went out first/.test(a.root.innerHTML), 'the dialog says "You went out first"');
    const youRow = R.rows.find(r => r.id === 'human'), cpuRow = R.rows.find(r => r.id === 'cpu');
    ok(youRow.pips === 0 && youRow.hand.length === 0, 'your hand: no tiles, 0 points');
    ok(cpuRow.pips === handPips({ hand: cpuRow.hand }) && cpuRow.pips > 0, `the computer is left holding ${cpuRow.hand.length} tiles = ${cpuRow.pips} points`);
    ok(R.totals.human === 0 && R.totals.cpu === cpuRow.pips, 'the scores: you 0, the computer ' + R.totals.cpu);
    ok(a.counts.turnPlays === 0 && a.counts.turnDraws === 0 && a.counts.turnPasses === 0, 'not a single normal turn was played: you won on your first (opening) turn');
    ok(a.counts.buildPlays.human === 15, 'you made 15 plays in the opening');
    ok(a.S.game.trains.mexican.tiles.length === 0 && a.S.game.openDouble === null && a.S.game.winner === a.S.game.players[0], 'the Mexican train is untouched, nothing is left open, and the game records you as the winner');
    ok(/played the last tile/.test(a.S.banner), 'the banner says "You played the last tile."');
    // and the next round starts normally
    a.app.dispatch({ type: 'dialogOk' });
    const next = await until(() => a.S.roundIndex === 1 && a.S.game && a.S.game.engine === 11 && a.S.awaiting);
    ok(!!next && a.S.totals.human === 0 && a.S.totals.cpu === cpuRow.pips, 'pressing OK starts round 2 (engine 11) with the scores carried over');
  }

  console.log('2. "Build my longest train", then Done');
  {
    const a = await newGame({ hand: 15, human: CHAIN_A, cpu: EVENS });
    a.app.dispatch({ type: 'autoBuild' });
    const A = await until(() => a.S.game.players[0].hand.length === 0 && a.S.game.trains.human.tiles.length === 15 && !a.S.plan);
    ok(!!A && a.S.game.players[0].hand.length === 0 && validChain(12, a.S.game.trains.human.tiles), 'one press lays all 15 tiles, in order, and nobody presses Done');
    // (no Done: with the whole train down, the opening is finished for the player)
    const R = await roundEnd(a);
    ok(R && R.winnerId === 'human' && /You went out first/.test(a.root.innerHTML) && R.totals.human === 0, 'then Done: you win with 0 points');
    ok(a.counts.turnPlays === 0 && a.counts.buildPlays.human === 15, 'on your first turn, without a normal turn being played');
  }

  console.log('3. a smaller hand (8 tiles) works the same way');
  {
    const eight = CHAIN_A.slice(0, 8);                           // ends on 6-7: not a double
    const cpu8 = EVENS.slice(0, 8);
    const a = await newGame({ hand: 8, human: eight, cpu: cpu8 });
    a.app.dispatch({ type: 'autoBuild' });
    const A = await until(() => a.S.game.players[0].hand.length === 0 && a.S.game.trains.human.tiles.length === 8 && !a.S.plan);
    ok(!!A && a.S.game.players[0].hand.length === 0, 'all 8 are down, with no Done pressed');
    // (no Done: with the whole train down, the opening is finished for the player)
    const R = await roundEnd(a);
    ok(R && R.winnerId === 'human' && R.totals.human === 0 && /You went out first/.test(a.root.innerHTML), 'you win');
  }

  console.log('4. it happens to the computer too');
  {
    const a = await newGame({ hand: 15, human: EVENS, cpu: CHAIN_A });
    // you cannot start a train from 12 with only even numbers: you draw one tile, then pass if it does not fit
    for (let g = 0; g < 200 && !a.S.modal; g++) {
      await tick();
      const A = a.S.awaiting;
      if (A && A.kind === 'build') { if (A.canDraw) a.app.dispatch({ type: 'draw' }); else if (A.canDone) a.app.dispatch({ type: 'endBuild' }); else a.app.dispatch({ type: 'undoTile' }); }
    }
    const R = a.S.modal && a.S.modal.type === 'roundEnd' ? a.S.modal : await roundEnd(a);
    ok(R && R.winnerId === 'cpu' && !R.tie, 'the computer, holding a complete train, builds it and wins');
    ok(new RegExp(a.S.cpuName + ' went out first').test(a.root.innerHTML), `the dialog says "${a.S.cpuName} went out first"`);
    const cpuRow = R.rows.find(r => r.id === 'cpu'), youRow = R.rows.find(r => r.id === 'human');
    ok(cpuRow.pips === 0 && cpuRow.hand.length === 0 && youRow.pips > 0 && R.totals.cpu === 0 && R.totals.human === youRow.pips, `it scores 0, you are left with ${youRow.pips}`);
    ok(a.counts.turnPlays === 0, 'again without a normal turn');
  }

  console.log('5. both players use every tile: a tie');
  {
    const a = await newGame({ hand: 15, human: CHAIN_A, cpu: CHAIN_B });
    a.app.dispatch({ type: 'autoBuild' });
    await until(() => a.S.awaiting && a.S.awaiting.kind === 'build' && a.S.awaiting.placed === 15 && !a.S.plan);
    a.app.dispatch({ type: 'endBuild' });
    const R = await roundEnd(a);
    ok(R && R.tie === true && R.winnerId === null && !R.blocked, 'both empty their hands: a tie');
    ok(/You both played every tile/.test(a.root.innerHTML), 'the dialog says "You both played every tile"');
    ok(R.rows.every(r => r.pips === 0 && r.hand.length === 0) && R.totals.human === 0 && R.totals.cpu === 0, 'nobody scores anything');
  }

  console.log('6. one tile short: no win');
  {
    const a = await newGame({ hand: 15, human: CHAIN_A, cpu: EVENS });
    let A = a.first;
    for (const t of CHAIN_A.slice(0, 14)) A = await tap(a, t);
    ok(a.S.game.players[0].hand.length === 1 && A && A.canDone, 'fourteen tiles down, one left, Done is allowed');
    a.app.dispatch({ type: 'endBuild' });
    await until(() => a.counts.turnPlays + a.counts.turnDraws + a.counts.turnPasses > 0 || (a.S.modal && a.S.modal.type === 'roundEnd') || (a.S.awaiting && a.S.awaiting.kind === 'move'));
    ok(!(a.S.modal && a.S.modal.type === 'roundEnd' && a.S.modal.winnerId === 'human'), 'with a tile still in your hand you have not won');
    ok(a.S.game.winner === null && a.S.game.players[0].hand.length >= 1, 'the round carries on into normal turns');
  }

  console.log('7. a double cannot be the last tile of your opening train');
  {
    const withDouble = CHAIN_A.slice(0, 14).concat([[0, 0]]);       // 14 tiles ending on 0, and 0-0 as the 15th
    const a = await newGame({ hand: 15, human: withDouble, cpu: EVENS });
    let A = a.first;
    for (const t of CHAIN_A.slice(0, 14)) A = await tap(a, t);
    ok(a.S.game.players[0].hand.length === 1 && key(a.S.game.players[0].hand[0]) === '0-0', 'fourteen tiles down; the last one is the double 0-0, and it fits the end of your train');
    ok(A && A.moves.length === 0 && A.lastDouble === true && A.canDone === true, 'but it is not offered as a play: a double cannot be your last tile');
    ok(/last tile is a double/.test(a.root.innerHTML), 'the banner says why');
    a.app.dispatch({ type: 'selectTile', key: '0-0' });
    await tick(); await tick();
    ok(a.S.game.players[0].hand.length === 1 && a.S.awaiting === A, 'tapping it does nothing');
    a.app.dispatch({ type: 'endBuild' });
    await until(() => (a.S.awaiting && a.S.awaiting.kind === 'move') || (a.S.modal && a.S.modal.type === 'roundEnd'));
    ok(!(a.S.modal && a.S.modal.type === 'roundEnd') && a.S.game.winner === null && a.S.game.players[0].hand.length === 1, 'so you do not win: the double stays in your hand and the game moves on');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
