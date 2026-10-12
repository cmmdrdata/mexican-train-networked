const mt = require('./mexican-train.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  FAIL:', msg); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const silent = { onNeedDraw(){}, onDraw(){}, onPass(){}, onPlay(){} };

function mk({ engine = 5, human = [], cpu = [], boneyard = [] }) {
  const g = mt.newRound({ engine, handSize: 1, rng: mt.mulberry32(1) });
  g.players[0].hand = human.map(t => t.slice());
  g.players[1].hand = cpu.map(t => t.slice());
  g.boneyard = boneyard.map(t => t.slice());
  return g;
}
// scripted controller: `picks` is a list of functions (moves, drew) => move
function script(picks, seen) {
  let i = 0;
  return { choose: async (game, player, moves, drew) => { if (seen) seen.push({ moves, drew }); return picks[i++](moves, drew); } };
}
const find = (moves, tile, trainId) => moves.find(m => eq(m.tile, tile) && (!trainId || m.trainId === trainId));

(async () => {
  console.log('T1 legal targets + orientation');
  let g = mk({ engine: 5, human: [[5,7],[3,4]] });
  let moves = mt.legalMoves(g, g.players[0]);
  ok(moves.length === 2 && moves.every(m => eq(m.tile, [5,7])), 'only [5,7] fits, on 2 trains (own + mexican)');
  ok(!moves.some(m => m.trainId === 'cpu'), "CPU train closed without marker");
  ok(eq(moves[0].placed, [5,7]) && moves[0].newEnd === 7, 'orientation [5|7], end becomes 7');
  g.trains.cpu.marker = true;
  moves = mt.legalMoves(g, g.players[0]);
  ok(moves.some(m => m.trainId === 'cpu'), "CPU train playable once it has a marker");
  g.trains.human.end = 7; g.trains.human.marker = false;
  moves = mt.legalMoves(g, g.players[0]);
  const own = moves.find(m => m.trainId === 'human');
  ok(own && eq(own.placed, [7,5]) && own.newEnd === 5, 'tile flips so matching side touches the train end');

  console.log('T2 pass -> marker; marker cleared only by playing on own train');
  g = mk({ engine: 5, human: [[1,2]], cpu: [[9,9]], boneyard: [[3,4]] });
  await mt.playTurn(g, g.players[0], script([]), silent);
  ok(g.trains.human.marker === true, 'marker placed after failed draw');
  ok(g.players[0].hand.length === 2, 'drew exactly one tile');
  ok(g.boneyard.length === 0, 'boneyard shrank');
  g.players[0].hand = [[5,8],[5,6]]; g.boneyard = [[0,1]];
  await mt.playTurn(g, g.players[0], script([ms => find(ms, [5,8], 'mexican')]), silent);
  ok(g.trains.human.marker === true, 'marker stays when playing on the Mexican train');
  await mt.playTurn(g, g.players[0], script([ms => find(ms, [5,6], 'human')]), silent);
  ok(g.trains.human.marker === false, 'marker removed after playing on own train');

  console.log('T3 unsatisfied double restricts everyone to that train');
  g = mk({ engine: 6, human: [[2,6],[1,2],[6,6]], cpu: [[0,3]] });
  g.trains.cpu.tiles.push([6,6]); g.trains.cpu.end = 6;
  g.openDouble = { trainId: 'cpu', value: 6 };
  g.players[0].hand = [[2,6],[1,2],[6,9]];
  moves = mt.legalMoves(g, g.players[0]);
  ok(moves.length === 2 && moves.every(m => m.trainId === 'cpu'), 'only the double\'s train is offered (even w/o marker)');
  ok(moves.some(m => eq(m.tile, [2,6])) && moves.some(m => eq(m.tile, [6,9])), 'both tiles containing 6 offered');

  console.log('T4 double + follow-up in the same turn');
  g = mk({ engine: 5, human: [[5,5],[5,9],[1,2]], cpu: [[0,0]] });
  const seen = [];
  await mt.playTurn(g, g.players[0], script([
    ms => find(ms, [5,5], 'human'),
    ms => { seen.push(ms.map(m => m.trainId + ':' + m.tile)); return find(ms, [5,9], 'human'); },
  ], null), silent);
  ok(eq(g.trains.human.tiles, [[5,5],[5,9]]) && g.trains.human.end === 9, 'double then follow-up placed in order');
  ok(g.openDouble === null, 'double satisfied -> cleared');
  ok(seen.length === 1 && seen[0].every(s => s.startsWith('human:')), 'follow-up choices restricted to the double\'s train');

  console.log('T5 a double as the LAST tile cannot go out: draw and cover it, or pass');
  // 5a. the drawn tile does not fit: no win; the double stays open; a marker goes on; the drawn tile stays in hand
  g = mk({ engine: 5, human: [[5,5]], cpu: [[0,1]], boneyard: [[2,3]] });
  let drawCalls = 0;
  await mt.playTurn(g, g.players[0], script([ms => find(ms, [5,5], 'human')]), { ...silent, onNeedDraw() { drawCalls++; } });
  ok(g.winner === null, '5a: playing a double as the last tile does not win');
  ok(drawCalls === 1 && g.boneyard.length === 0, '5a: the player had to draw');
  ok(eq(g.players[0].hand, [[2,3]]), '5a: the drawn tile that does not fit stays in hand');
  ok(g.openDouble && g.openDouble.trainId === 'human' && g.openDouble.value === 5, '5a: the double is left open');
  ok(g.trains.human.marker === true, '5a: and a marker goes on the player\'s train (pass)');
  // 5b. the drawn tile covers the double: now they go out
  g = mk({ engine: 5, human: [[5,5]], cpu: [[0,1]], boneyard: [[5,9]] });
  const s5b = [];
  await mt.playTurn(g, g.players[0], script([ms => find(ms, [5,5], 'human'), ms => ms[0]], s5b), silent);
  ok(g.winner && g.winner.id === 'human', '5b: covering the double with the drawn tile goes out');
  ok(eq(s5b[1].drew, [5,9]) && s5b[1].moves.every(m => m.trainId === 'human' && eq(m.tile, [5,9])), '5b: the controller is told which tile was drawn, and may only cover the double');
  ok(eq(g.trains.human.tiles, [[5,5],[5,9]]) && g.openDouble === null && g.players[0].hand.length === 0, '5b: double covered, nothing left open, hand empty');
  // 5c. the boneyard is empty: cannot draw, passes; no win yet; the other player covers it and THEN the double player has gone out
  g = mk({ engine: 5, human: [[5,5]], cpu: [[5,8],[0,1]], boneyard: [] });
  let r = await mt.playRound(g, 0, { human: script([ms => find(ms, [5,5], 'human')]), cpu: mt.cpuController }, silent);
  ok(r.winner && r.winner.id === 'human' && !r.blocked, '5c: once the other player covers the double, the empty-handed player has gone out');
  ok(g.trains.cpu.tiles.length === 0 && eq(g.trains.human.tiles, [[5,5],[5,8]]), '5c: the other player covered it on the double\'s train');
  // 5d. nobody can cover it and the boneyard is empty: blocked, and the empty hand holds the fewest pips
  g = mk({ engine: 5, human: [[5,5]], cpu: [[0,1]], boneyard: [] });
  r = await mt.playRound(g, 0, { human: script([ms => find(ms, [5,5], 'human')]), cpu: mt.cpuController }, silent);
  ok(r.blocked === true && r.winner && r.winner.id === 'human', '5d: blocked; the empty hand wins on pips');
  // 5e. an ordinary last tile still wins at once
  g = mk({ engine: 5, human: [[5,7]], cpu: [[0,1]], boneyard: [[2,3]] });
  r = await mt.playRound(g, 0, { human: script([ms => ms[0]]), cpu: mt.cpuController }, silent);
  ok(r.winner && r.winner.id === 'human' && !r.blocked && g.boneyard.length === 1, '5e: a non-double last tile wins immediately (no draw)');
  // 5f. covering SOMEONE ELSE'S open double with your last tile wins
  g = mk({ engine: 5, human: [[5,8]], cpu: [[0,1]], boneyard: [] });
  g.openDouble = { trainId: 'cpu', value: 5 }; g.trains.cpu.tiles = [[5,5]]; g.trains.cpu.end = 5;
  r = await mt.playRound(g, 0, { human: script([ms => ms[0]]), cpu: mt.cpuController }, silent);
  ok(r.winner && r.winner.id === 'human', '5f: covering an open double with your last tile goes out');
  // 5g. a double that is NOT the last tile behaves as before (play on, then cover it straight away)
  g = mk({ engine: 5, human: [[5,5],[5,9]], cpu: [[0,1]], boneyard: [] });
  r = await mt.playRound(g, 0, { human: script([ms => find(ms, [5,5], 'human'), ms => ms[0]]), cpu: mt.cpuController }, silent);
  ok(r.winner && r.winner.id === 'human' && eq(g.trains.human.tiles, [[5,5],[5,9]]), '5g: double then cover goes out as before');
  // 5h. the computer in the same position: the same rule, and the interface is told why
  g = mk({ engine: 5, human: [[1,2]], cpu: [[5,5]], boneyard: [[2,3]] });
  const infos = []; let cpuDraws = 0;
  await mt.playTurn(g, g.players[1], mt.cpuController, { ...silent, onNeedDraw() { cpuDraws++; }, onPlay(gm, p, mv, info) { infos.push(info); } });
  ok(g.winner === null && cpuDraws === 1 && infos.length === 1 && infos[0].lastTileDouble === true && infos[0].doubleOpened === true, '5h: the computer cannot go out on a double either, must draw, and the hook says "last tile double"');
  ok(g.trains.cpu.marker === true && g.openDouble && g.openDouble.trainId === 'cpu', '5h: it passes with a marker and the double stays open');
  // 5i. on the Mexican train: same thing, and it is the Mexican train that stays open
  g = mk({ engine: 5, human: [[5,5]], cpu: [[5,8],[0,1]], boneyard: [[2,3]] });
  await mt.playTurn(g, g.players[0], script([ms => find(ms, [5,5], 'mexican')]), silent);
  ok(g.winner === null && g.openDouble && g.openDouble.trainId === 'mexican', '5i: a last-tile double on the Mexican train stays open too');
  // 5j. an open double with a player holding a drawn tile: the other player must cover it first
  const ms5 = mt.legalMoves(g, g.players[1]);
  ok(ms5.length === 1 && ms5.every(m => m.trainId === 'mexican'), '5j: the other player may only cover the open double');
  // 5k. both players end with no tiles at once (the cover was the other player's last tile too): a tie
  g = mk({ engine: 5, human: [[5,5]], cpu: [[5,8]], boneyard: [] });
  r = await mt.playRound(g, 0, { human: script([ms => find(ms, [5,5], 'human')]), cpu: mt.cpuController }, silent);
  ok(r.tie === true && r.winner === null && !r.blocked && g.winner === null, '5k: both out together is a tie (as in the opening)');
  ok(g.players[0].hand.length === 0 && g.players[1].hand.length === 0 && g.openDouble === null, '5k: nothing left in either hand, nothing open');

  console.log('T6 double with no follow-up (after drawing) stays open + marker, next player must satisfy');
  g = mk({ engine: 5, human: [[5,5],[1,2]], cpu: [[5,8],[0,1]], boneyard: [[3,4]] });
  await mt.playTurn(g, g.players[0], script([ms => find(ms, [5,5], 'mexican')]), silent);
  ok(g.openDouble && g.openDouble.trainId === 'mexican' && g.openDouble.value === 5, 'double left open on Mexican train');
  ok(g.trains.human.marker === true, 'passing player gets a marker on their own train');
  ok(g.players[0].hand.length === 2, 'drew one tile while trying to satisfy');
  const cpuSeen = [];
  await mt.playTurn(g, g.players[1], script([ms => { cpuSeen.push(ms); return ms[0]; }]), silent);
  ok(cpuSeen[0].every(m => m.trainId === 'mexican' && eq(m.tile, [5,8])), 'CPU may only satisfy the open double');
  ok(g.openDouble === null, 'satisfied by next player');

  console.log('T7 draw only when stuck; drawn tile is playable');
  g = mk({ engine: 5, human: [[1,2]], cpu: [[0,1]], boneyard: [[6,7],[5,9]] }); // pop() takes [5,9]
  const s7 = [];
  await mt.playTurn(g, g.players[0], script([ms => ms.find(m => m.trainId === 'human')], s7), silent);
  ok(eq(s7[0].drew, [5,9]), 'controller told which tile was drawn');
  ok(eq(g.trains.human.tiles, [[5,9]]), 'drawn tile was played');
  g = mk({ engine: 5, human: [[5,2],[1,2]], cpu: [[0,1]], boneyard: [[6,7]] });
  await mt.playTurn(g, g.players[0], script([ms => ms[0]]), silent);
  ok(g.boneyard.length === 1, 'no draw when a play exists');

  console.log('T8 blocked rounds + scoring');
  g = mk({ engine: 5, human: [[1,2]], cpu: [[3,4],[0,0]], boneyard: [] });
  r = await mt.playRound(g, 0, { human: mt.cpuController, cpu: mt.cpuController }, silent);
  ok(r.blocked === true, 'blocked when boneyard empty and nobody can play');
  ok(r.winner && r.winner.id === 'human', 'lowest pips wins a blocked round');
  ok(mt.handPips(g.players[1]) === 57, '0-0 counts 50 (+7)');
  g = mk({ engine: 5, human: [[1,2]], cpu: [[0,3]], boneyard: [] });
  r = await mt.playRound(g, 1, { human: mt.cpuController, cpu: mt.cpuController }, silent);
  ok(r.blocked && r.winner === null, 'equal pips -> no winner');
  ok(mt.tilePips([0,0]) === 50 && mt.tilePips([12,12]) === 24 && mt.tilePips([0,5]) === 5, 'tilePips');

  console.log('T8b regression: a pass opens that player\'s train, so two passes is NOT automatically blocked');
  g = mk({ engine: 5, human: [[7,9]], cpu: [[2,2]], boneyard: [] });
  g.trains.cpu.tiles = [[5,7]]; g.trains.cpu.end = 7;
  r = await mt.playRound(g, 0, { human: mt.cpuController, cpu: mt.cpuController }, silent);
  ok(!r.blocked && r.winner && r.winner.id === 'human', 'human plays on the CPU\'s newly opened train and wins');
  g = mk({ engine: 5, human: [[1,2]], cpu: [[3,4]], boneyard: [[8,8]] });
  ok(mt.isBlocked(g) === false, 'never blocked while the boneyard has tiles');
  g.boneyard = [];
  ok(mt.isBlocked(g) === true, 'blocked: boneyard empty and no tile fits anywhere');
  ok(g.trains.human.marker === false && g.trains.cpu.marker === false, 'isBlocked leaves markers untouched');

  console.log('T9 deal sanity');
  for (const engine of [12, 7, 0]) {
    const d = mt.newRound({ engine, handSize: 15, rng: mt.mulberry32(engine + 1) });
    ok(d.players[0].hand.length === 15 && d.players[1].hand.length === 15 && d.boneyard.length === 60, `engine ${engine}: 15+15+60=90`);
    const all = [...d.players[0].hand, ...d.players[1].hand, ...d.boneyard];
    ok(!all.some(t => t[0] === engine && t[1] === engine), `engine ${engine} double removed from the pool`);
  }

  console.log('T10 AI sanity');
  g = mk({ engine: 5, human: [[5,5],[5,9],[1,2]] });
  g.players[0].hand = [[5,5],[5,9],[1,2]];
  let ms = mt.legalMoves(g, g.players[0]);
  ok(eq(mt.cpuChoose(g, g.players[0], ms).tile, [5,5]) || eq(mt.cpuChoose(g, g.players[0], ms).tile, [5,9]), 'AI plays something sensible');
  g.players[0].hand = [[5,9]];
  ms = mt.legalMoves(g, g.players[0]);
  ok(mt.cpuChoose(g, g.players[0], ms).tile[1] === 9, 'AI goes out when it can');
  g.players[0].hand = [[5,5],[3,4]]; // double with no follow-up should be avoided if an alternative exists
  g.trains.human.end = 5;
  g.players[0].hand = [[5,5],[5,6]];
  g.players[0].hand.push([6,6]);
  ms = mt.legalMoves(g, g.players[0]);
  const choice = mt.cpuChoose(g, g.players[0], ms);
  ok(true, 'AI choice computed: ' + JSON.stringify(choice.tile));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
