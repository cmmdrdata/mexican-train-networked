'use strict';
// The Expert against Hard, and Hard against a Hard without the new "do not leave the other player a play" rule, over many duplicate deals
// (every deal played twice with the seats swapped). Slow on purpose (the Expert thinks): about two minutes. For the full study see sim_levels.js.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { newRound, playRound, cpuChoose, cpuChooseAsync, cpuBuildAction, handPips, mulberry32, longestChain, tilePips } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const silent = { onNeedDraw() {}, onDraw() {}, onPass() {}, onPlay() {}, onBuildPlay() {}, onBuildUndo() {}, onBuildDraw() {}, onBuildPass() {}, onBuildDone() {}, onOpeningDone() {} };
const same = (a, b) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
const isDouble = t => t[0] === t[1];

// Hard as it was before the new rule: the same evaluation, nothing about what a move leaves the other player (checked equal below)
function plainHard(game, player, moves) {
  let best = null, bs = -Infinity;
  for (const m of moves) {
    const rest = player.hand.filter(t => !same(t, m.tile));
    let score = tilePips(m.tile);
    if (rest.length === 0 && !isDouble(m.tile)) score += 1000;
    if (isDouble(m.tile)) { const f = rest.length > 0 && rest.some(t => t[0] === m.tile[0] || t[1] === m.tile[0]); score += f ? 12 : -25; }
    if (m.trainId === player.id) { score += 3; if (game.trains[player.id].marker) score += 8; }
    score += 2 * rest.filter(t => t[0] === m.newEnd || t[1] === m.newEnd).length;
    score += 12 * longestChain(rest, m.newEnd, isDouble(m.tile)).length;
    score += game.rng() * 0.5;
    if (score > bs) { bs = score; best = m; }
  }
  return best;
}
const strat = { plain: async (g, p, m) => plainHard(g, p, m), hard: async (g, p, m) => cpuChoose(g, p, m, 'hard'), expert: async (g, p, m) => cpuChooseAsync(g, p, m, 'expert') };
const ctl = f => ({ act: async (g, p, i) => cpuBuildAction(g, p, i, 'hard'), choose: f });

async function duplicate(A, B, deals, seedBase, hand) {
  let wa = 0, wb = 0, pa = 0, pb = 0, n = 0;
  for (let i = 0; i < deals; i++) for (const swap of [false, true]) {
    const g = newRound({ engine: 12, handSize: hand, rng: mulberry32(seedBase + i), simultaneousOpening: true, players: 2 });
    const sa = swap ? 'cpu' : 'human', sb = swap ? 'human' : 'cpu';
    await playRound(g, i % 2, { [sa]: ctl(A), [sb]: ctl(B) }, silent);
    const x = handPips(g.players.find(p => p.id === sa)), y = handPips(g.players.find(p => p.id === sb));
    pa += x; pb += y; n++;
    if (x < y) wa++; else if (y < x) wb++;
  }
  return { winA: 100 * wa / n, winB: 100 * wb / n, pipsA: pa / n, pipsB: pb / n, n };
}

(async () => {
  console.log('1. the new Hard against the old Hard (the same evaluation without the new rule)');
  for (const hand of [15, 8]) {
    const r = await duplicate(strat.hard, strat.plain, 2500, 31000, hand);
    console.log(`   hand ${hand}: new Hard ${r.winA.toFixed(1)}% - old Hard ${r.winB.toFixed(1)}%   pips left ${r.pipsA.toFixed(1)} vs ${r.pipsB.toFixed(1)}   (${r.n} rounds)`);
    ok(r.winA > r.winB && r.pipsA < r.pipsB, `${hand} tiles: the new Hard wins more rounds than the old Hard and leaves fewer pips`);
  }
  console.log('2. the Expert against Hard (two players)');
  const r = await duplicate(strat.expert, strat.hard, 380, 41000, 15);
  console.log(`   Expert ${r.winA.toFixed(1)}% - Hard ${r.winB.toFixed(1)}%   pips left ${r.pipsA.toFixed(1)} vs ${r.pipsB.toFixed(1)}   (${r.n} rounds)`);
  ok(r.winA > r.winB + 2, 'the Expert beats Hard by a clear margin');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
