'use strict';
/* Duplicate-deal matches using the game's REAL engine and the REAL computer players.
 *   node sim_levels.js <tested> <baseline> <deals> <handSize> <players 2|3> [firstDeal]
 * players: names are  oldhard (Hard before the new rule), normal, hard, expert.
 * Two players: every deal is played twice with the two swapping seats.
 * Three players: the tested player sits in each seat in turn against two of the baseline (3 games per deal).
 * Reported for the TESTED player: its share of the rounds won, and how many pips fewer it holds at the end than the others' average. */
require('./game.js');
const E = globalThis.MexicanTrainGame.Engine;
const { newRound, playRound, cpuChoose, cpuChooseAsync, cpuBuildAction, handPips, mulberry32 } = E;

/* Hard as it was before the rule about leaving the other player a play: the same evaluation, with nothing about the other player's tiles.
 * (Checked once to play identically to the old engine's Hard, move for move.) */
const isDouble = t => t[0] === t[1];
const sameTile = (a, b) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
function oldHard(game, player, moves) {
  let best = null, bs = -Infinity;
  for (const m of moves) {
    const rest = player.hand.filter(t => !sameTile(t, m.tile));
    let score = E.tilePips(m.tile);
    if (rest.length === 0 && !isDouble(m.tile)) score += 1000;
    if (isDouble(m.tile)) { const f = rest.length > 0 && rest.some(t => t[0] === m.tile[0] || t[1] === m.tile[0]); score += f ? 12 : -25; }
    if (m.trainId === player.id) { score += 3; if (game.trains[player.id].marker) score += 8; }
    score += 2 * rest.filter(t => t[0] === m.newEnd || t[1] === m.newEnd).length;
    score += 12 * E.longestChain(rest, m.newEnd, isDouble(m.tile)).length;
    score += game.rng() * 0.5;
    if (score > bs) { bs = score; best = m; }
  }
  return best;
}
const STRAT = {
  oldhard: async (g, p, ms) => oldHard(g, p, ms),
  normal: async (g, p, ms) => cpuChoose(g, p, ms, 'normal'),
  hard: async (g, p, ms) => cpuChoose(g, p, ms, 'hard'),
  expert: async (g, p, ms) => cpuChooseAsync(g, p, ms, 'expert'),
};
const NULL_UI = { onNeedDraw() {}, onDraw() {}, onPass() {}, onPlay() {}, onBuildPlay() {}, onBuildUndo() {}, onBuildDraw() {}, onBuildPass() {}, onBuildDone() {}, onOpeningDone() {} };

async function playGame(seed, hand, strats, start) {
  const n = strats.length;
  const g = newRound({ engine: 12, handSize: hand, rng: mulberry32(seed), simultaneousOpening: true, players: n });
  const controllers = {};
  g.players.forEach((p, i) => { controllers[p.id] = { act: async (gm, pl, info) => cpuBuildAction(gm, pl, info, 'hard'), choose: async (gm, pl, ms) => strats[i](gm, pl, ms) }; });
  const res = await playRound(g, start % n, controllers, NULL_UI, {});
  return { pips: g.players.map(handPips), winner: res.winner ? g.players.indexOf(res.winner) : -1 };
}

async function run(tested, base, deals, hand, n, firstDeal) {
  const T = STRAT[tested], B = STRAT[base];
  let wins = 0, games = 0, ties = 0; const per = [];
  for (let d = 0; d < deals; d++) {
    const seed = firstDeal + d, start = d % n;
    let adv = 0, cnt = 0;
    const seatings = n === 2 ? [[T, B], [B, T]] : [[T, B, B], [B, T, B], [B, B, T]];
    seatings.forEach((strats, k) => {});
    for (let k = 0; k < seatings.length; k++) {
      const strats = seatings[k], testedSeat = strats.findIndex(x => x === T);
      const r = await playGame(seed, hand, strats, start);
      games++; cnt++;
      if (r.winner === testedSeat) wins++; else if (r.winner < 0) ties++;
      const others = r.pips.filter((_, i) => i !== testedSeat);
      adv += others.reduce((a, b) => a + b, 0) / others.length - r.pips[testedSeat];
    }
    per.push(adv / cnt);
  }
  const mean = per.reduce((a, b) => a + b, 0) / per.length;
  const sd = Math.sqrt(per.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, per.length - 1));
  return { tested, base, players: n, hand, deals, games, winShare: (100 * wins / games).toFixed(1), fairShare: (100 / n).toFixed(1), ties: (100 * ties / games).toFixed(1), pipAdv: mean.toFixed(2), se: (sd / Math.sqrt(per.length)).toFixed(2) };
}
if (require.main === module) {
  const [tested, base, deals, hand, players, first] = process.argv.slice(2);
  const t0 = Date.now();
  run(tested, base, Number(deals), Number(hand || 15), Number(players || 2), Number(first || 1)).then(r => { r.seconds = ((Date.now() - t0) / 1000).toFixed(0); console.log(JSON.stringify(r)); }).catch(e => { console.error('CRASH', e); process.exit(1); });
}
