'use strict';
require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { newRound, legalMoves, playRound, playTurn, isBlocked, handPips, mulberry32, key, cpuChoose, cpuBuildAction } = E;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const canon = t => [Math.min(t[0], t[1]), Math.max(t[0], t[1])];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const noUi = () => ({ async onNeedDraw() {}, async onDraw() {}, async onPass() {}, async onPlay() {}, async onBuildPlay() {}, async onBuildUndo() {}, async onBuildDraw() {}, async onBuildPass() {}, async onBuildDone() {}, async onOpeningDone() {} });

console.log('1. the deal');
{
  const g = newRound({ engine: 12, handSize: 15, rng: mulberry32(5), players: 3 });
  ok(g.players.length === 3 && g.players.map(p => p.id).join() === 'human,cpu,cpu2', 'three players, in turn order: human, cpu, cpu2');
  ok(g.players.every(p => p.hand.length === 15) && g.boneyard.length === 90 - 45, '15 tiles each, 45 left in the boneyard');
  const all = [...g.players.flatMap(p => p.hand), ...g.boneyard].map(t => key(canon(t)));
  ok(all.length === 90 && new Set(all).size === 90 && !all.includes('12-12'), 'all 90 different tiles are in play, and the engine double is not');
  ok(Object.keys(g.trains).join() === 'human,cpu,cpu2,mexican' && g.trains.cpu2.end === 12 && g.trains.cpu2.marker === false, 'four trains: one each and the Mexican train');
  const o = newRound({ engine: 12, handSize: 8, rng: mulberry32(5), players: 3, simultaneousOpening: true });
  ok(Object.keys(o.opening).join() === 'human,cpu,cpu2' && Object.values(o.opening).every(x => x.finished === false), 'the opening tracks all three players');
  ok(newRound({ engine: 12, handSize: 8, rng: mulberry32(5), players: 3 }).opening === null, '(and there is none unless asked for)');
  const two = newRound({ engine: 12, handSize: 15, rng: mulberry32(5) }), three = newRound({ engine: 12, handSize: 15, rng: mulberry32(5), players: 3 });
  ok(eq(two.players[0].hand, three.players[0].hand) && eq(two.players[1].hand, three.players[1].hand), 'the first two hands are the same as in a two-player game from the same shuffle');
  ok(two.players.length === 2 && !('cpu2' in two.trains) && newRound({ engine: 12, handSize: 8, rng: mulberry32(1), players: 7 }).players.length === 2 && newRound({ engine: 12, handSize: 8, rng: mulberry32(1), players: 2 }).players.length === 2, 'asking for anything but 3 players gives the usual two');
}

/* ---- crafted situations ---- */
function table(hands, opts) {
  const g = newRound({ engine: 12, handSize: 1, rng: mulberry32(1), players: hands.length });
  hands.forEach((h, i) => { g.players[i].hand = h.map(canon); });
  g.boneyard = ((opts && opts.boneyard) || []).map(canon);
  return g;
}
const script = steps => {                 // a controller that plays the tiles it is told to, in order
  const queue = steps.slice();
  return { async choose(game, player, moves) { const want = queue.shift(); const mv = moves.find(m => key(m.tile) === key(canon(want.tile)) && m.trainId === want.on); if (!mv) throw new Error(`${player.id} cannot play ${want.tile} on ${want.on}; options: ${moves.map(m => key(m.tile) + '>' + m.trainId).join(' ')}`); return mv; }, async act() { throw new Error('no opening here'); } };
};

console.log('2. who may play where');
{
  const g = table([[[12, 1], [5, 5]], [[12, 2]], [[12, 3]]]);
  const targets = p => Array.from(new Set(legalMoves(g, g.players[p]).map(m => m.trainId))).sort().join();
  ok(targets(0) === 'human,mexican' && targets(1) === 'cpu,mexican' && targets(2) === 'cpu2,mexican', 'at first each plays on their own train or the Mexican train');
  g.trains.cpu.marker = true;
  ok(targets(0) === 'cpu,human,mexican' && targets(2) === 'cpu,cpu2,mexican' && targets(1) === 'cpu,mexican', 'a marker on one train lets BOTH of the others play there');
  g.trains.cpu2.marker = true;
  ok(targets(0) === 'cpu,cpu2,human,mexican' && targets(1) === 'cpu,cpu2,mexican', 'with two markers, there are two extra trains to play on');
  g.openDouble = { trainId: 'cpu2', value: 12 };
  ok([0, 1, 2].every(p => legalMoves(g, g.players[p]).every(m => m.trainId === 'cpu2')), 'an open double restricts everyone, whoever they are, to that one train');
}

console.log('3. a marker after a pass, and an open double passed along');
(async () => {
  {
    const g = table([[[1, 1]], [[2, 2]], [[3, 4]]], { boneyard: [] });     // nobody can play on the engine
    const seen = [];
    await playTurn(g, g.players[0], script([]), Object.assign(noUi(), { async onPass(game, p) { seen.push(p.id); } }));
    ok(seen.join() === 'human' && g.trains.human.marker === true && g.trains.cpu.marker === false && g.trains.cpu2.marker === false, 'a player with nothing to play and an empty boneyard passes and gets a marker, and only they');
  }
  {
    // 0 plays 12-5 then double 5-5; with nothing to follow it up and an empty boneyard he passes; 1 cannot cover and passes; 2 covers it
    const g = table([[[12, 5], [5, 5], [9, 9]], [[12, 7], [3, 3]], [[12, 8], [5, 6], [1, 1]]]);
    const played = [];
    const ui = Object.assign(noUi(), { async onPlay(game, p, mv, info) { played.push([p.id, key(mv.tile), mv.trainId, !!info.doubleOpened, !!info.doubleSatisfied]); }, async onPass(game, p) { played.push([p.id, 'pass']); } });
    await playTurn(g, g.players[0], script([{ tile: [12, 5], on: 'human' }]), ui);
    ok(g.openDouble === null && g.players[0].hand.length === 2, 'a normal tile leaves no double open');
    // now a double: player 0 plays 5-5 on his own train (end 5) and has no 5 left, an empty boneyard: he passes
    await playTurn(g, g.players[0], script([{ tile: [5, 5], on: 'human' }]), ui);
    ok(g.openDouble && g.openDouble.trainId === 'human' && g.openDouble.value === 5 && g.trains.human.marker === true, 'a double that cannot be followed up stays open, and its owner passes (marker)');
    ok(played.slice(-2).map(x => x.join(':')).join(' ') === 'human:5-5:human:true:false human:pass', 'in that order: the double, then the pass');
    await playTurn(g, g.players[1], script([]), ui);
    ok(g.openDouble !== null && g.trains.cpu.marker === true && played[played.length - 1].join(':') === 'cpu:pass', 'the next player cannot cover it either: he passes, the double stays open');
    ok(legalMoves(g, g.players[2]).every(m => m.trainId === 'human' && (m.tile[0] === 5 || m.tile[1] === 5)), 'the third player may only play a 5 on that double');
    await playTurn(g, g.players[2], script([{ tile: [5, 6], on: 'human' }]), ui);
    ok(g.openDouble === null && played[played.length - 1].join(':') === 'cpu2:5-6:human:false:true', 'the third player covers it: the double is closed');
  }
  {
    // the first player must follow his own double if he can
    const g = table([[[12, 4], [4, 4], [4, 9]], [[1, 1]], [[2, 2]]]);
    const ui = noUi(); const seq = [];
    ui.onPlay = async (game, p, mv) => { seq.push(key(mv.tile)); };
    await playTurn(g, g.players[0], script([{ tile: [12, 4], on: 'human' }]), ui);
    await playTurn(g, g.players[0], script([{ tile: [4, 4], on: 'human' }, { tile: [4, 9], on: 'human' }]), ui);
    ok(seq.join() === '4-12,4-4,4-9' && g.openDouble === null && g.players[0].hand.length === 0, 'a player who can follow his own double does so in the same turn');
    ok(g.winner === g.players[0], '...and going out on that follow-up wins');
  }

  console.log('4. going out, ties and blocked rounds');
  const run = (g, ctl, start) => playRound(g, start || 0, { human: ctl[0], cpu: ctl[1], cpu2: ctl[2] }, noUi());
  {
    // 0's last tile is a double: it cannot win; 1 cannot cover; 2 covers with a tile that is not his last: 0 is out and wins
    const g = table([[[12, 6], [6, 6]], [[1, 2]], [[6, 3], [3, 3]]]);
    const r = await run(g, [script([{ tile: [12, 6], on: 'human' }, { tile: [6, 6], on: 'human' }]), script([]), script([{ tile: [6, 3], on: 'human' }])]);
    ok(r.winner && r.winner.id === 'human' && !r.tie && !r.blocked && g.players[0].hand.length === 0, 'a double as the last tile cannot go out, but when someone else covers it (not with their last tile) its owner has won');
  }
  {
    // 0 out on a double; 2 covers with HIS LAST tile too: 0 and 2 are out together: a tie; 1 holds tiles
    const g = table([[[12, 6], [6, 6]], [[1, 2], [1, 1]], [[6, 3]]]);
    const r = await run(g, [script([{ tile: [12, 6], on: 'human' }, { tile: [6, 6], on: 'human' }]), script([]), script([{ tile: [6, 3], on: 'human' }])]);
    ok(r.tie === true && r.winner === null && g.players[0].hand.length === 0 && g.players[2].hand.length === 0 && g.players[1].hand.length > 0, 'two players out together (a double and the tile that covers it): a tie between them, the third player is not part of it');
  }
  {
    // the covering tile that goes out comes from the player who is next
    const g = table([[[12, 6], [6, 6]], [[6, 2]], [[1, 2], [1, 1]]]);
    const r = await run(g, [script([{ tile: [12, 6], on: 'human' }, { tile: [6, 6], on: 'human' }]), script([{ tile: [6, 2], on: 'human' }]), script([])]);
    ok(r.tie === true && g.players[0].hand.length === 0 && g.players[1].hand.length === 0, 'the next player covering with his last tile ties with the owner of the double');
  }
  {
    // blocked: nobody can play, empty boneyard. Fewest pips wins.
    const g = table([[[1, 2]], [[3, 4]], [[0, 1]]]);
    const rb = await run(g, [script([]), script([]), script([])]);
    ok(rb.blocked && rb.winner && rb.winner.id === 'cpu2' && handPips(g.players[2]) === 1, 'a blocked round goes to the lowest hand of the three (1 pip beats 3 and 7)');
    const g2 = table([[[1, 2]], [[0, 3]], [[5, 6]]]);
    const rt = await run(g2, [script([]), script([]), script([])]);
    ok(rt.blocked && rt.winner === null, 'two players sharing the lowest count (3 and 3 against 11): nobody wins the blocked round');
    const g3 = table([[[1, 2]], [[0, 3]], [[0, 4]]]);
    ok((await run(g3, [script([]), script([]), script([])])).winner === null, 'the two lowest sharing it (3, 3 and 4): nobody wins either');
    const g4 = table([[[0, 4]], [[1, 3]], [[2, 2]]]);
    ok((await run(g4, [script([]), script([]), script([])])).winner === null, 'all three level (4, 4 and 4): nobody wins');
    ok(isBlocked(table([[[1, 2]], [[3, 4]], [[5, 6]]])) === true && isBlocked(table([[[12, 2]], [[3, 4]], [[5, 6]]])) === false && isBlocked(table([[[1, 2]], [[3, 4]], [[5, 6]]], { boneyard: [[1, 1]] })) === false, 'blocked means: nothing playable by anyone, and nothing left to draw');
  }
  {
    // turn order, and who starts
    const g = table([[[12, 1], [1, 2], [2, 3]], [[12, 4], [4, 5], [5, 6]], [[12, 7], [7, 8], [8, 9]]]);
    const order = [];
    const ctl = id => ({ async choose(game, p, moves) { order.push(p.id); return moves[0]; }, async act() { throw new Error('x'); } });
    await playRound(g, 2, { human: ctl(), cpu: ctl(), cpu2: ctl() }, noUi());
    ok(order.slice(0, 7).join() === 'cpu2,human,cpu,cpu2,human,cpu,cpu2', 'turns go round in order, starting with whoever was named first (here the third player)');
  }
  {
    // the opening, three at once
    const g = newRound({ engine: 12, handSize: 3, rng: mulberry32(1), players: 3, simultaneousOpening: true });
    g.players[0].hand = [[12, 1], [1, 2], [2, 3]].map(canon); g.players[1].hand = [[12, 4], [4, 5], [5, 6]].map(canon); g.players[2].hand = [[12, 7], [7, 8], [8, 9]].map(canon);
    g.boneyard = [[0, 0], [0, 1]];
    const build = tiles => { const q = tiles.slice(); return { async act(game, p, info) { const t = q.shift(); if (!t) return { type: 'done' }; return { type: 'play', move: info.moves.find(m => key(m.tile) === key(canon(t))) }; }, async choose() { throw new Error('x'); } }; };
    const r = await playRound(g, 0, { human: build([[12, 1], [1, 2], [2, 3]]), cpu: build([[12, 4], [4, 5], [5, 6]]), cpu2: build([[12, 7]]) }, noUi());
    ok(r.tie === true && r.winner === null && g.players[0].hand.length === 0 && g.players[1].hand.length === 0 && g.players[2].hand.length === 2, 'in the opening, two players who use every tile tie, and the third (still holding tiles) is not part of it');
    const g2 = newRound({ engine: 12, handSize: 2, rng: mulberry32(1), players: 3, simultaneousOpening: true });
    g2.players[0].hand = [[12, 1], [1, 2]].map(canon); g2.players[1].hand = [[12, 4], [4, 5]].map(canon); g2.players[2].hand = [[12, 7], [7, 8]].map(canon);
    const r2 = await playRound(g2, 0, { human: build([[12, 1], [1, 2]]), cpu: build([[12, 4], [4, 5]]), cpu2: build([[12, 7], [7, 8]]) }, noUi());
    ok(r2.tie === true && g2.players.every(p => p.hand.length === 0), 'all three using every tile: a three-way tie');
    const g3 = newRound({ engine: 12, handSize: 2, rng: mulberry32(1), players: 3, simultaneousOpening: true });
    g3.players[0].hand = [[12, 1], [1, 2]].map(canon); g3.players[1].hand = [[0, 4], [4, 5]].map(canon); g3.players[2].hand = [[0, 7], [7, 8]].map(canon);
    g3.boneyard = [];
    const r3 = await playRound(g3, 0, { human: build([[12, 1], [1, 2]]), cpu: build([]), cpu2: build([]) }, noUi());
    ok(r3.winner && r3.winner.id === 'human' && !r3.tie, 'one player using every tile while the other two cannot start wins outright');
    ok(g3.trains.cpu.marker === true && g3.trains.cpu2.marker === true, '(the two who could not start have markers)');
  }

  console.log('5. a thousand and more computer rounds with three players: invariants at every step');
  {
    const LEVELS = ['easy', 'normal', 'hard'];
    let rounds = 0, plays = 0, wins = [0, 0, 0], ties = 0, blocked = 0, openingWins = 0, problems = [];
    const rndAgent = (rnd) => ({
      async act(game, p, info) { const r = rnd(); if (info.canDraw) return { type: 'draw' }; if (info.moves.length && r < 0.7) return { type: 'play', move: info.moves[Math.floor(rnd() * info.moves.length)] }; if (info.canDone) return { type: 'done' }; if (info.canUndo) return { type: 'undo' }; return { type: 'play', move: info.moves[0] }; },
      async choose(game, p, moves) { return moves[Math.floor(rnd() * moves.length)]; },
    });
    const cpuAgent = level => ({ async act(game, p, info) { return cpuBuildAction(game, p, info, level); }, async choose(game, p, moves) { return cpuChoose(game, p, moves, level); } });
    for (let seed = 1; seed <= 1500; seed++) {
      const hand = [8, 12, 15][seed % 3];
      const rnd = mulberry32(seed * 7 + 3);
      const g = newRound({ engine: 12 - (seed % 13), handSize: hand, rng: mulberry32(seed), players: 3, simultaneousOpening: seed % 5 !== 0 });
      const agents = [0, 1, 2].map(i => (seed % 4 === 0 ? rndAgent(rnd) : cpuAgent(LEVELS[(seed + i) % 3])));
      const check = (where) => {
        const tiles = [];
        g.players.forEach(p => p.hand.forEach(t => tiles.push(key(canon(t)))));
        g.boneyard.forEach(t => tiles.push(key(canon(t))));
        ['human', 'cpu', 'cpu2', 'mexican'].forEach(id => g.trains[id].tiles.forEach(t => tiles.push(key(canon(t)))));
        if (tiles.length !== 90) problems.push(`seed ${seed} ${where}: ${tiles.length} tiles`);
        else if (new Set(tiles).size !== tiles.length) problems.push(`seed ${seed} ${where}: a tile appears twice`);
        for (const id of ['human', 'cpu', 'cpu2', 'mexican']) {                    // every train is a chain from the engine
          let end = g.engine; for (const t of g.trains[id].tiles) { if (t[0] !== end) { problems.push(`seed ${seed} ${where}: broken chain on ${id}`); break; } end = t[1]; }
          if (g.trains[id].end !== end) problems.push(`seed ${seed} ${where}: ${id} end is wrong`);
        }
      };
      const ui = Object.assign(noUi(), {
        async onPlay(game, p, mv, info) { plays++; check('play'); if (info.doubleOpened && !game.openDouble) problems.push(`seed ${seed}: a double was played but none is open`); },
        async onBuildPlay() { check('build'); }, async onDraw() { check('draw'); }, async onPass() { check('pass'); },
      });
      const order = []; let startIndex = seed % 3;
      const res = await playRound(g, startIndex, { human: agents[0], cpu: agents[1], cpu2: agents[2] }, ui, { onTurn(game, p) { order.push(game.players.indexOf(p)); } });
      rounds++;
      if (g.players.length !== 3) problems.push('players changed');
      // the turns go round in order
      if (order.length > 1) for (let i = 1; i < order.length; i++) if (order[i] !== (order[i - 1] + 1) % 3) { problems.push(`seed ${seed}: turn order broke at ${i}: ${order.slice(i - 1, i + 2)}`); break; }
      if (order.length && order[0] !== startIndex) problems.push(`seed ${seed}: the wrong player started`);
      const out = g.players.filter(p => p.hand.length === 0);
      if (res.blocked) {
        blocked++;
        if (g.boneyard.length) problems.push(`seed ${seed}: blocked with tiles in the boneyard`);
        const pips = g.players.map(handPips), low = Math.min(...pips);
        if (res.winner ? handPips(res.winner) !== low || pips.filter(x => x === low).length !== 1 : pips.filter(x => x === low).length < 2) problems.push(`seed ${seed}: blocked result is wrong (${pips}) winner ${res.winner && res.winner.id}`);
      } else if (res.tie) {
        ties++;
        if (out.length < 2 || res.winner) problems.push(`seed ${seed}: a tie needs two or more players out`);
      } else {
        if (!res.winner || res.winner.hand.length !== 0 || out.length !== 1 || out[0] !== res.winner) problems.push(`seed ${seed}: the winner has not gone out alone (${out.map(p => p.id)})`);
        else wins[g.players.indexOf(res.winner)]++;
        if (g.openDouble && !res.tie) problems.push(`seed ${seed}: a double is still open at the end`);
      }
      if (!order.length) openingWins++;
    }
    console.log(`   ${rounds} rounds, ${plays} plays; won by seat 1/2/3: ${wins.join('/')}, ${ties} ties, ${blocked} blocked, ${openingWins} decided in the opening`);
    ok(problems.length === 0, 'at every play, draw and pass: 90 different tiles, every train an unbroken chain from the engine, turns in order, and every result consistent' + (problems[0] ? ' (' + problems[0] + ')' : ''));
    ok(rounds === 1500 && wins.every(w => w > 150), 'all three seats win a fair share of rounds (nobody is advantaged by position): ' + wins.join('/'));
    ok(ties > 0 && blocked > 0, 'ties and blocked rounds both occurred, so those paths were exercised');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
