const mt = require('./mexican-train.js');

const silentUI = { onNeedDraw(){}, onDraw(){}, onPass(){}, onPlay(){} };
const randomController = { choose: async (game, player, moves) => moves[Math.floor(game.rng() * moves.length)] };

function checkInvariants(game) {
  const errs = [];
  // 1) every tile accounted for exactly once (91 total, engine excluded)
  const all = [];
  game.players.forEach(p => p.hand.forEach(t => all.push([Math.min(...t), Math.max(...t)])));
  game.boneyard.forEach(t => all.push([Math.min(...t), Math.max(...t)]));
  Object.values(game.trains).forEach(tr => tr.tiles.forEach(t => all.push([Math.min(...t), Math.max(...t)])));
  if (all.length !== 90) errs.push(`tile count ${all.length} != 90`);
  const seen = new Set();
  for (const t of all) { const k = t.join('-'); if (seen.has(k)) errs.push('duplicate tile ' + k); seen.add(k); }
  if (seen.has(game.engine + '-' + game.engine)) errs.push('engine tile also elsewhere');
  // 2) every train is a valid chain starting at the engine number
  for (const tr of Object.values(game.trains)) {
    let end = game.engine;
    for (const t of tr.tiles) { if (t[0] !== end) errs.push(`${tr.id}: broken chain`); end = t[1]; }
    if (tr.end !== end) errs.push(`${tr.id}: end ${tr.end} != chain end ${end}`);
  }
  // 3) open-double consistency
  if (game.openDouble) {
    const tr = game.trains[game.openDouble.trainId];
    const last = tr.tiles[tr.tiles.length - 1];
    if (!last || last[0] !== last[1] || last[0] !== game.openDouble.value) errs.push('openDouble does not match last tile');
  }
  // 4) mexican train never carries a marker
  if (game.trains.mexican.marker) errs.push('marker on mexican train');
  return errs;
}

// the "a double cannot go out" rule, watched on every play of every round
const ruleStats = { lastDouble: 0, drawCover: 0, passWithTile: 0, passEmpty: 0, lateWin: 0, bothOut: 0 };
function trackRule(report) {
  const st = { pendingLast: null, lastMover: null };
  return {
    st,
    ui: {
      onNeedDraw() {}, onDraw() {},
      onPass(g, p) {
        if (st.pendingLast === p.id) { if (p.hand.length === 0) ruleStats.passEmpty++; else ruleStats.passWithTile++; st.pendingLast = null; }
      },
      onPlay(g, p, mv, info) {
        st.lastMover = p;
        if (info.lastTileDouble) {
          ruleStats.lastDouble++; st.pendingLast = p.id;
          if (g.winner !== null) report('a last-tile double declared a winner');
          if (p.hand.length !== 0 || !g.openDouble || g.openDouble.value !== mv.tile[0]) report('a last-tile double must leave the hand empty and the double open');
        } else if (g.winner) {
          if (mv.tile[0] === mv.tile[1]) report('went out on a double');
          if (p.hand.length !== 0 || g.winner !== p) report('the winner went out with tiles left');
          if (st.pendingLast === p.id) ruleStats.drawCover++;
          st.pendingLast = null;
        } else if (info.doubleOpened && p.hand.length === 0) report('empty hand after a double but not flagged');
      },
    },
  };
}

async function run(n, ctrlHuman, ctrlCpu, label) {
  let outs = 0, blocked = 0, turns = 0, humanPts = 0, cpuPts = 0, humanWins = 0, cpuWins = 0, ties = 0, problems = 0;
  for (let i = 0; i < n; i++) {
    const rng = mt.mulberry32(1000 + i);
    const engine = i % 13;
    const game = mt.newRound({ engine: 12 - engine, handSize: 15, rng });
    let t = 0;
    const tr = trackRule(msg => { problems++; if (problems < 5) console.log('RULE FAIL', msg); });
    const res = await mt.playRound(game, i % 2, { human: ctrlHuman, cpu: ctrlCpu }, tr.ui, {
      onTurn: (g) => { t++; const e = checkInvariants(g); if (e.length) { problems++; if (problems < 5) console.log('INVARIANT FAIL', e); } }
    });
    turns += t;
    if (res.blocked) {
      blocked++;
      // verify it is genuinely dead: nobody can play even with every train open
      game.players.forEach(p => { game.trains[p.id].marker = true; });
      for (const p of game.players) if (mt.legalMoves(game, p).length) { problems++; console.log('FALSE BLOCK'); }
      if (game.boneyard.length) { problems++; console.log('blocked with boneyard tiles'); }
    } else {
      outs++;
      // a round that was not blocked ends with exactly one player holding no tiles, and nothing left uncovered
      const empties = game.players.filter(p => p.hand.length === 0);
      if (res.tie) {                                   // both ran out together (one covered the other's last-tile double with their own last tile)
        ruleStats.bothOut++;
        if (res.winner || empties.length !== 2 || game.openDouble) { problems++; console.log('BAD TIE', !!res.winner, empties.length, !!game.openDouble); }
      } else if (!res.winner || empties.length !== 1 || empties[0] !== res.winner || game.openDouble) { problems++; console.log('BAD GOING OUT', !!res.winner, empties.length, !!game.openDouble); }
      else if (tr.st.lastMover !== res.winner) ruleStats.lateWin++;      // went out because the other player covered their double
    }
    humanPts += mt.handPips(game.players[0]); cpuPts += mt.handPips(game.players[1]);
    if (!res.winner) ties++; else if (res.winner.id === 'human') humanWins++; else cpuWins++;
  }
  console.log(`${label}: ${n} rounds | wentOut=${outs} blocked=${blocked} | avgTurns=${(turns/n).toFixed(1)} | wins human=${humanWins} cpu=${cpuWins} ties=${ties} | avgPts human=${(humanPts/n).toFixed(1)} cpu=${(cpuPts/n).toFixed(1)} | invariantProblems=${problems}`);
  return problems;
}

(async () => {
  let bad = 0;
  bad += await run(2600, mt.cpuController, mt.cpuController, 'CPU vs CPU      ');
  bad += await run(1300, randomController, mt.cpuController, 'random vs CPU    ');
  bad += await run(1300, randomController, randomController, 'random vs random ');
  console.log(`double-out rule: last-tile doubles=${ruleStats.lastDouble} | drew and covered it (went out)=${ruleStats.drawCover} | drew, did not fit, passed=${ruleStats.passWithTile} | could not draw, passed=${ruleStats.passEmpty} | went out when the OTHER player covered it=${ruleStats.lateWin} | both out together (tie)=${ruleStats.bothOut}`);
  if (!(ruleStats.lastDouble > 200 && ruleStats.drawCover > 20 && ruleStats.passWithTile > 50 && ruleStats.passEmpty > 5 && ruleStats.lateWin > 5 && ruleStats.bothOut > 0)) { bad++; console.log('the simulation did not exercise every outcome of the rule'); }
  console.log(bad === 0 ? 'ALL INVARIANTS HELD' : 'PROBLEMS FOUND');
  process.exit(bad === 0 ? 0 : 1);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
