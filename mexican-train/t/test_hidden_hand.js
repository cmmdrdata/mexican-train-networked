'use strict';
// The computer players cannot see your tiles that are not on the table: swap your hand with tiles from the boneyard (it cannot tell them apart) and every decision they make
// is exactly the same, at every level, in the opening and in normal turns, at a table of two and of three.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32, key, newRound, playRound, legalMoves, cpuChooseAsync, cpuBuildAction } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const silent = { onNeedDraw() {}, onDraw() {}, onPass() {}, onPlay() {} };
const same = (a, b) => a === b || (a && b && key(a.tile) === key(b.tile) && a.trainId === b.trainId);
const asKey = m => (m ? key(m.tile) + '>' + m.trainId : 'none');

/* A copy of a game at one moment, with its own random numbers (so two copies can be compared), as the computer's own code sees it. */
const copyOf = (game, seed) => { const c = JSON.parse(JSON.stringify(game)); c.rng = mulberry32(seed); return c; };
/* The same position, with every tile the computer cannot see dealt out again: the other players' hands and the boneyard are shuffled together (every size is kept). */
function reshuffled(game, meId, seed) {
  const c = copyOf(game, seed), rnd = mulberry32(seed * 31 + 7);
  const others = c.players.filter(p => p.id !== meId), pool = [].concat(...others.map(p => p.hand), c.boneyard);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  let k = 0; for (const p of others) { p.hand = pool.slice(k, k + p.hand.length); k += p.hand.length; }
  c.boneyard = pool.slice(k);
  return c;
}
const differentHands = (a, b, meId) => a.players.some((p, i) => p.id !== meId && p.hand.map(key).sort().join() !== b.players[i].hand.map(key).sort().join());

/* real rounds, played by computers on every side, with the position recorded each time the computer to be tested has a decision to make */
async function positions(n, players, seed0) {
  const turns = [], builds = [];
  for (let i = 0; i < n; i++) {
    const g = newRound({ engine: 12 - (i % 13), handSize: [8, 12, 15][i % 3], rng: mulberry32(seed0 + i), simultaneousOpening: true, players: players });
    const ids = g.players.map(p => p.id), ctl = {};
    for (const id of ids) ctl[id] = {
      act: async (gm, p, info) => { if (id !== 'human') builds.push({ game: copyOf(gm, 1), meId: id, info: JSON.parse(JSON.stringify(info)) }); return cpuBuildAction(gm, p, info, 'hard'); },
      choose: async (gm, p, moves) => { if (id !== 'human' && moves.length > 1) turns.push({ game: copyOf(gm, 1), meId: id }); return cpuChooseAsync(gm, p, moves, 'hard'); },
    };
    await playRound(g, i % ids.length, ctl, silent);
  }
  return { turns, builds };
}

(async () => {
  console.log('1. positions from real rounds');
  const two = await positions(110, 2, 5000), three = await positions(80, 3, 7000);
  ok(two.turns.length > 800 && three.turns.length > 500 && two.builds.length > 100 && three.builds.length > 100, `${two.turns.length} decisions in two-player rounds and ${three.turns.length} in three-player ones, and ${two.builds.length + three.builds.length} in the opening`);

  console.log('2. a normal turn: the same decision whatever is hidden');
  const results = {};
  for (const level of ['easy', 'normal', 'hard', 'expert']) {
    for (const [label, set] of [['two', two.turns], ['three', three.turns]]) {
      if (level === 'expert' && label === 'three') continue;                      // (at a table of three the Expert plays as Hard: covered by Hard)
      const take = level === 'expert' ? set.filter((x, i) => i % 9 === 0).slice(0, 110) : set.filter((x, i) => i % 2 === 0);
      let checked = 0, differ = 0, nondeterministic = 0, hiddenReallyDiffered = 0, first = null;
      for (let i = 0; i < take.length; i++) {
        const { game, meId } = take[i], seed = 900 + i;
        const a = copyOf(game, seed), b = copyOf(game, seed), c = reshuffled(game, meId, seed);
        const meA = a.players.find(p => p.id === meId), meB = b.players.find(p => p.id === meId), meC = c.players.find(p => p.id === meId);
        const movesA = legalMoves(a, meA); if (movesA.length < 2) continue;
        const da = await cpuChooseAsync(a, meA, movesA, level), db = await cpuChooseAsync(b, meB, legalMoves(b, meB), level), dc = await cpuChooseAsync(c, meC, legalMoves(c, meC), level);
        checked++;
        if (!same(da, db)) nondeterministic++;
        if (differentHands(game, c, meId)) hiddenReallyDiffered++;
        if (!same(da, dc)) { differ++; if (!first) first = `${level}/${label} #${i}: ${asKey(da)} vs ${asKey(dc)}`; }
      }
      results[level + label] = { checked, differ };
      ok(checked >= (level === 'expert' ? 60 : 300), `${level}, ${label} players: ${checked} real positions were decided twice`);
      ok(nondeterministic === 0, `${level}, ${label}: asked twice about the very same position it answers the same (so any difference below is down to what was hidden)`);
      ok(hiddenReallyDiffered >= checked * 0.9, `${level}, ${label}: and the hidden tiles really were different in the swapped position (${hiddenReallyDiffered} of ${checked})`);
      ok(differ === 0, `${level}, ${label}: with your hand swapped for other hidden tiles, the decision never changed: ${differ} of ${checked} did${first ? ' (first: ' + first + ')' : ''}`);
    }
  }

  console.log('3. the opening');
  for (const level of ['easy', 'normal', 'hard', 'expert']) {
    const take = two.builds.concat(three.builds).filter((x, i) => i % 3 === 0);
    let checked = 0, differ = 0;
    for (let i = 0; i < take.length; i++) {
      const { game, meId, info } = take[i], seed = 400 + i;
      const a = copyOf(game, seed), c = reshuffled(game, meId, seed);
      const meA = a.players.find(p => p.id === meId), meC = c.players.find(p => p.id === meId);
      const x = cpuBuildAction(a, meA, info, level), y = cpuBuildAction(c, meC, info, level);
      checked++;
      const sx = x.type + (x.move ? asKey(x.move) : ''), sy = y.type + (y.move ? asKey(y.move) : '');
      if (sx !== sy) differ++;
    }
    ok(checked > 150 && differ === 0, `${level}: laying its opening train, ${checked} decisions with the hidden tiles dealt out again: ${differ} changed`);
  }

  console.log('4. the test would notice if they peeked');
  {
    // a computer that DID look at your hand: it plays the move that leaves you the fewest tiles that fit anywhere
    const cheat = (game, me, moves) => {
      const you = game.players.find(p => p.id !== me.id);
      let best = null, bestN = 1e9;
      for (const m of moves) {
        const ends = Object.values(game.trains).filter(t => t.id === you.id || t.marker || t.id === 'mexican').map(t => (t.id === m.trainId ? m.newEnd : t.end));
        const n = you.hand.filter(t => ends.some(e => t[0] === e || t[1] === e)).length;
        if (n < bestN) { bestN = n; best = m; }
      }
      return best;
    };
    let checked = 0, differ = 0;
    for (let i = 0; i < two.turns.length; i += 2) {
      const { game, meId } = two.turns[i], seed = 77 + i, a = copyOf(game, seed), c = reshuffled(game, meId, seed);
      const meA = a.players.find(p => p.id === meId), meC = c.players.find(p => p.id === meId);
      const ma = legalMoves(a, meA); if (ma.length < 2) continue;
      checked++;
      if (!same(cheat(a, meA, ma), cheat(c, meC, legalMoves(c, meC)))) differ++;
    }
    ok(differ >= checked * 0.08, `a computer that really looked at the other player's hand decides differently once it is swapped in ${differ} of ${checked} positions: so this test does detect peeking`);
  }

  console.log('5. what it MAY use: what you have shown');
  {
    // your passes are public (everyone saw them), and a computer may reason from them: change what your passes showed and its decisions do change
    let checked = 0, differ = 0;
    for (let i = 0; i < two.turns.length; i += 3) {
      const { game, meId } = two.turns[i], seed = 55 + i, a = copyOf(game, seed), b = copyOf(game, seed);
      const you = a.players.find(p => p.id !== meId); b.noMatch = Object.assign({}, b.noMatch || {}, { [you.id]: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
      const meA = a.players.find(p => p.id === meId), meB = b.players.find(p => p.id === meId), ma = legalMoves(a, meA);
      if (ma.length < 2) continue;
      checked++;
      if (!same(await cpuChooseAsync(a, meA, ma, 'hard'), await cpuChooseAsync(b, meB, legalMoves(b, meB), 'hard'))) differ++;
    }
    ok(differ > 0, `told that you could not match nine of the numbers (as a long run of your passes would show), Hard decided differently in ${differ} of ${checked} positions: it does reason from what is public`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
