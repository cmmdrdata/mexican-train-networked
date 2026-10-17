'use strict';
// Easy sometimes (about one turn in five) draws a tile although it has a play, and then plays any tile that fits. No other level does.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const LEVELS = ['easy', 'normal', 'hard', 'expert'];
const total = g => g.players.reduce((s, p) => s + p.hand.length, 0) + g.boneyard.length + Object.values(g.trains).reduce((s, t) => s + t.tiles.length, 0);

async function play(level, seed) {
  const g = E.newRound({ engine: 12, handSize: 15, rng: E.mulberry32(seed * 104729), simultaneousOpening: true });
  const st = { chances: 0, optional: 0, later: 0, oldTile: 0, drewTile: 0, bad: 0, turns: 0 }; let pending = null;
  const ctl = id => ({
    act: async (gm, p, i) => E.cpuBuildAction(gm, p, i, level),
    wantsDraw: (gm, p, moves) => { const w = E.easyDrawsAnyway(gm, p, moves, level); st.chances++; if (w) pending = { id: p.id, handBefore: p.hand.map(E.key) }; return w; },
    choose: async (gm, p, moves, drew) => {
      st.turns++;
      const c = await E.cpuChooseAsync(gm, p, moves, level);
      if (pending && pending.id === p.id) {                       // it drew although it had a play
        st.optional++;
        if (pending.handBefore.includes(E.key(c.tile))) st.oldTile++; else st.drewTile++;
        if (!p.hand.some(t => E.key(t) === E.key(c.tile))) st.bad++;
        pending = null;
      }
      return c;
    },
  });
  const ui = { onNeedDraw() {}, onDraw() {}, onPass() {}, onPlay() {}, onOpeningDone() {} };
  const before = total(g);
  await E.playRound(g, 0, { human: ctl('human'), cpu: ctl('cpu') }, ui);
  if (total(g) !== before) st.bad++;
  return st;
}
function v0done(m) { return m.over || (m.roundsPlayed >= 1); }
(async () => {
  const sum = {};
  for (const level of LEVELS) {
    const s = { chances: 0, optional: 0, oldTile: 0, drewTile: 0, bad: 0 };
    for (let seed = 1; seed <= 250; seed++) { const r = await play(level, seed); for (const k in s) s[k] += r[k]; }
    sum[level] = s;
  }
  const e = sum.easy, rate = e.optional / e.chances;
  console.log(`   easy: ${e.optional} voluntary draws in ${e.chances} turns with a play (${(100 * rate).toFixed(1)}%); then played the new tile ${e.drewTile}x and a tile it already held ${e.oldTile}x`);
  ok(rate > 0.16 && rate < 0.24, `Easy draws on about 20% of the turns it has a play (${(100 * rate).toFixed(1)}%)`);
  ok(e.oldTile > 0 && e.drewTile > 0, 'after the draw it plays any tile that fits: sometimes the new one, sometimes one it held');
  ok(LEVELS.slice(1).every(l => sum[l].optional === 0), 'Normal, Hard and Expert never do it');
  ok(LEVELS.every(l => sum[l].bad === 0), 'every round still adds up (no tile lost or made), and the tile played is always in the hand');
  // a double that must be covered is never skipped by a draw, and an empty boneyard is never drawn from
  const g = E.newRound({ engine: 12, handSize: 15, rng: E.mulberry32(9), simultaneousOpening: true });
  g.openDouble = { trainId: 'human', value: 3 };
  let any = false; for (let i = 0; i < 200; i++) { g.boneyard.push([i % 13, 0]); if (E.easyDrawsAnyway(g, g.players[1], [{ trainId: 'human' }], 'easy')) any = true; }
  ok(!any, 'with a double to cover it never draws instead');
  g.openDouble = null; g.boneyard.length = 0; ok(!E.easyDrawsAnyway(g, g.players[1], [{ trainId: 'human' }], 'easy'), 'nor from an empty boneyard');
  // hosted: an Easy computer at a hosted table draws on purpose now and then, and the table is told
  {
    const { OnlineMatch } = require('../online-match.js');
    let said = 0, drawn = 0, rounds = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const m = new OnlineMatch({ names: ['Ann', 'Ben'], computer: { level: 'easy' }, rounds: 1, hand: 8, stepDelay: 0, sleep: async () => {}, rng: E.mulberry32(seed), chatRng: () => 0.99, nativeChance: 0, foodChance: 0, push(seat, msg) { for (const e of (msg.events || [])) if (e.e === 'draw' && e.who !== 'me') drawn++; if (msg.log) for (const l of msg.log) if (/did not have to/.test(String(l.text || l))) said++; } });
      const run = m.start(); let n = 0;
      while (!m.over && n++ < 6000) { for (const seat of m.humans) { const v = m.viewFor(seat); if (!v.awaiting) continue; const a = v.awaiting; if (a.kind === 'modal') m.intent(seat, { a: 'ok' }); else if (a.kind === 'draw') m.intent(seat, { a: 'draw' }); else if (a.kind === 'build') { if (a.canDone) m.intent(seat, { a: 'done' }); else if (a.canDraw) m.intent(seat, { a: 'draw' }); else if (a.moves.length) m.intent(seat, { a: 'play', tile: a.moves[0].tile, train: a.moves[0].trainId }); } else if (a.kind === 'move') m.intent(seat, { a: 'play', tile: a.moves[0].tile, train: a.moves[0].trainId }); } await new Promise(r => setImmediate(r)); if (v0done(m)) break; }
      m.abort(); await run.catch(() => {}); rounds++;
    }
    console.log(`   hosted easy: ${drawn} opponent draws seen over ${rounds} games`);
    ok(drawn > 0, 'the hosted Easy computer draws and the people at the table see it');
    const fs = require('fs'), path = require('path');
    ok(/wantsDraw: \(game, player, moves\) => easyDrawsAnyway\(game, player, moves, cpu\.level\)/.test(fs.readFileSync(path.join(__dirname, '..', 'online-match.js'), 'utf8')) && /wantsDraw: \(game, player, moves\) => easyDrawsAnyway\(game, player, moves, levelFor\(S, id\)\)/.test(fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8')), 'both the single-player page and the hosted match ask the Easy computer whether it draws');
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
