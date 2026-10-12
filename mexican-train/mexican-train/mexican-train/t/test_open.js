require('./game.js');
const E = globalThis.MexicanTrainGame.Engine;
const { mulberry32, newRound, legalMoves, undoLast, buildPhase, playRound, longestChain, longestFullChain, buildSteps,
        cpuBuildAction, cpuChoose, handPips, tilePips, key } = E;
let pass = 0, fail = 0;
const failCounts = {};
const ok = (c, m) => { if (c) pass++; else { fail++; failCounts[m] = (failCounts[m] || 0) + 1; if (failCounts[m] === 1) console.log('  FAIL:', m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const isDbl = t => t[0] === t[1];
const canon = t => (t[0] <= t[1] ? [t[0], t[1]] : [t[1], t[0]]);
const silent = { onNeedDraw() {}, onDraw() {}, onPass() {}, onPlay() {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function mk(o) {
  const g = newRound({ engine: o.engine || 5, handSize: 1, rng: mulberry32(1), simultaneousOpening: true });
  g.players[0].hand = (o.human || []).map(canon);        // real deals are always [low, high]
  g.players[1].hand = (o.cpu || []).map(canon);
  g.boneyard = (o.boneyard || []).map(canon);
  return g;
}
const play = t => info => ({ type: 'play', move: info.moves.find(m => same(m.tile, canon(t))) });
const scripted = (actions, seen) => ({ act: async (g, p, info) => { if (seen) seen.push({ ...info, hand: p.hand.length }); const a = actions.shift(); return typeof a === 'function' ? a(info) : a; } });

function totalTiles(g) {
  return g.players.reduce((s, p) => s + p.hand.length, 0) + g.boneyard.length +
    Object.values(g.trains).reduce((s, t) => s + t.tiles.length, 0);
}
function chainOk(g, trainId) {
  const tr = g.trains[trainId]; let end = g.engine;
  for (const t of tr.tiles) { if (t[0] !== end) return false; end = t[1]; }
  return tr.end === end;
}
function bruteBest(hand, startEnd) {
  let best = { count: -1, pips: -1 };
  const n = hand.length, used = Array(n).fill(false);
  (function rec(end, lastDouble, count, pips) {
    if (!lastDouble) { if (count > best.count || (count === best.count && pips > best.pips)) best = { count, pips }; }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const t = hand[i]; let ne;
      if (t[0] === end) ne = t[1]; else if (t[1] === end) ne = t[0]; else continue;
      used[i] = true; rec(ne, isDbl(t), count + 1, pips + tilePips(t)); used[i] = false;
    }
  })(startEnd, false, 0, 0);
  return best;
}

(async () => {
  console.log('1. play, take back, done');
  let g = mk({ human: [[5,7],[7,9],[9,3],[1,1]], cpu: [[0,1]] });
  let seen = [];
  const before = totalTiles(g);
  await buildPhase(g, g.players[0], scripted([
    play([5,7]), play([7,9]), play([9,3]),
    { type: 'undo' }, { type: 'undo' },                      // take back two
    play([7,9]),                                             // and put one back
    { type: 'done' },
  ], seen), silent);
  ok(eq(g.trains.human.tiles, [[5,7],[7,9]]) && g.trains.human.end === 9, 'train after plays and take-backs');
  ok(g.players[0].hand.length === 2 && g.players[0].hand.some(t => same(t, [3,9])), 'taken-back tile is back in hand');
  ok(totalTiles(g) === before, 'no tile lost or duplicated');
  ok(g.opening.human.finished === true && g.opening.cpu.finished === false, 'only the finished player is marked finished');
  ok(seen[0].canUndo === false && seen[1].canUndo === true, 'cannot take back from an empty train, can after a play');
  ok(seen.every(s => s.moves.every(m => m.trainId === 'human')), 'only the own train is ever offered');
  ok(seen[seen.length - 1].canDone === true, 'done allowed with a clean train');

  console.log('2. undo restores the end value, even through doubles');
  g = mk({ human: [[5,5],[5,8],[8,8],[8,2]], cpu: [[0,1]] });
  await buildPhase(g, g.players[0], scripted([play([5,5]), play([5,8]), play([8,8]), play([8,2]),
    { type: 'undo' }, { type: 'undo' }, { type: 'undo' }, { type: 'undo' }, { type: 'done' }]), silent);
  ok(g.trains.human.tiles.length === 0 && g.trains.human.end === 5, 'everything taken back: train empty, end = engine');
  ok(g.players[0].hand.length === 4, 'all four tiles back in hand');
  ok(g.players[0].hand.every(t => t[0] <= t[1]), 'returned tiles are in canonical [low, high] form');

  console.log('3. cannot finish on an uncovered double');
  g = mk({ human: [[5,5],[5,8],[1,2]], cpu: [[0,1]] });
  seen = [];
  await buildPhase(g, g.players[0], scripted([play([5,5]), { type: 'undo' }, play([5,5]), play([5,8]), { type: 'done' }], seen), silent);
  ok(seen[1].canDone === false, 'Done is refused while the train ends on a double');
  ok(seen[0].canDone === true && seen[2].canDone === true && seen[4].canDone === true, 'Done allowed when empty, after taking the double back, and once it is covered');
  g = mk({ human: [[5,5],[1,2]], cpu: [[0,1]] });
  let threw = false;
  try { await buildPhase(g, g.players[0], scripted([play([5,5]), { type: 'done' }]), silent); } catch (e) { threw = true; }
  ok(threw, 'an agent that tries to finish on a double is stopped');
  // a double can never be the LAST tile down: it could not win the round, so it stays in the hand
  g = mk({ human: [[5,7],[7,7]], cpu: [[0,1]] });
  seen = [];
  await buildPhase(g, g.players[0], scripted([play([5,7]), { type: 'done' }], seen), silent);
  ok(seen[1].moves.length === 0 && seen[1].lastDouble === true, 'with only the double 7-7 left it is not offered as a move, and the screen is told why');
  ok(seen[1].canDone === true && eq(g.players[0].hand, [[7,7]]), 'Done is allowed, and the double stays in hand for the normal turns');
  g = mk({ human: [[5,7],[7,7]], cpu: [[0,1]] });
  threw = false;
  try { await buildPhase(g, g.players[0], scripted([play([5,7]), play([7,7])]), silent); } catch (e) { threw = true; }
  ok(threw, 'an agent that tries to lay the double as its last tile is stopped');
  g = mk({ human: [[5,7],[7,7],[7,9]], cpu: [[0,1]] });
  seen = [];
  await buildPhase(g, g.players[0], scripted([play([5,7]), play([7,7]), play([7,9]), { type: 'done' }], seen), silent);
  ok(seen[1].lastDouble === false && seen[1].moves.length === 2 && seen[2].canDone === false && seen[2].moves.length === 1, 'a double is fine while other tiles remain: it is offered, and then it has to be covered before Done');
  ok(g.players[0].hand.length === 0 && eq(g.trains.human.tiles, [[5,7],[7,7],[7,9]]), 'double covered by the last tile: out of tiles, and that does count as going out');
  g = mk({ human: [[5,5]], cpu: [[0,1]] });                       // nothing but a double: it cannot be laid, so this player has nothing to start with
  let soleDoublePasses = 0;
  await buildPhase(g, g.players[0], scripted([]), { ...silent, onBuildPass() { soleDoublePasses++; } });
  ok(soleDoublePasses === 1 && g.trains.human.marker === true && g.players[0].hand.length === 1, 'a hand of just one double passes with a marker, as if nothing fitted');
  // the planner never ends a chain on a double
  ok(eq(longestChain([[5,7],[7,7]], 5, false), [[5,7]]), 'longestChain: 5-7 then 7-7 is not a train: it would end on a double');
  ok(eq(longestChain([[5,5]], 5, false), []) && eq(longestChain([[5,7],[7,7],[7,9]], 5, false).length, 3), 'longestChain: a lone double is nothing; a covered double is fine');
  ok(longestChain([], 5, true).length === 0 && longestChain([[1,2]], 5, true).length === 0, 'longestChain: after a double, nothing to cover it means no chain');

  console.log('4. draw and pass rules');
  g = mk({ human: [[1,2],[3,4]], cpu: [[0,1]], boneyard: [[8,8],[5,9]] });   // draws [5,9]
  seen = [];
  const events = [];
  await buildPhase(g, g.players[0], scripted([{ type: 'draw' }, play([5,9]), { type: 'done' }], seen),
    { ...silent, onBuildDraw: (gm, p, t) => events.push(['draw', t]), onBuildPlay: () => events.push(['play']), onBuildDone: (gm, p, n) => events.push(['done', n]) });
  ok(seen[0].canDraw === true && seen[0].moves.length === 0 && seen[0].canDone === true, 'nothing fits: draw offered');
  ok(eq(seen[1].drew, [5,9]) && seen[1].canDraw === false, 'drawn tile reported, second draw not allowed');
  ok(eq(events, [['draw', [5,9]], ['play'], ['done', 1]]), 'hooks fire in order');
  g = mk({ human: [[1,2]], cpu: [[0,1]], boneyard: [[8,8]] });             // drawn tile does not fit either
  let passed = 0;
  await buildPhase(g, g.players[0], scripted([{ type: 'draw' }]), { ...silent, onBuildPass: () => { passed++; } });
  ok(g.trains.human.marker === true && g.opening.human.finished && passed === 1, 'still nothing fits: pass, marker, finished');
  g = mk({ human: [[1,2]], cpu: [[0,1]], boneyard: [] });                  // empty boneyard
  passed = 0;
  await buildPhase(g, g.players[0], scripted([]), { ...silent, onBuildPass: () => { passed++; } });
  ok(g.trains.human.marker === true && passed === 1, 'empty boneyard: immediate pass');
  g = mk({ human: [[5,2]], cpu: [[0,1]], boneyard: [[8,8]] });             // something fits: no draw offered
  seen = [];
  await buildPhase(g, g.players[0], scripted([{ type: 'done' }], seen), silent);
  ok(seen[0].canDraw === false && g.trains.human.marker === false, 'no draw when a tile fits; choosing not to build is not a pass');

  console.log('5. players build at the same time');
  g = mk({ human: [[5,7],[7,9]], cpu: [[5,2],[2,3]] });
  const order = [];
  const slowHuman = { act: async (gm, p, info) => { await sleep(30); return order.filter(x => x[0] === 'h').length < 2 ? play(order.filter(x => x[0] === 'h').length === 0 ? [5,7] : [7,9])(info) : { type: 'done' }; } };
  const fastCpu = { act: async (gm, p, info) => { await sleep(5); return cpuBuildAction(gm, p, info); } };
  const t0 = Date.now();
  await playRound(g, 0, { human: slowHuman, cpu: fastCpu }, {
    ...silent,
    onBuildPlay: (gm, p) => order.push([p.id[0], 'play', Date.now() - t0]),
    onBuildDone: (gm, p, n) => order.push([p.id[0], 'done', Date.now() - t0]),
    onOpeningDone: () => order.push(['*', 'opening-done', Date.now() - t0]),
  }).catch(() => {});
  const cpuDone = order.find(x => x[0] === 'c' && x[1] === 'done'), humanFirst = order.find(x => x[0] === 'h' && x[1] === 'play');
  ok(cpuDone && humanFirst && cpuDone[2] < order.find(x => x[0] === 'h' && x[1] === 'done')[2], 'the computer finishes while the human is still building (true concurrency)');
  ok(order.findIndex(x => x[1] === 'opening-done') > order.findIndex(x => x[0] === 'h' && x[1] === 'done'), 'the opening ends only after the LAST player finishes');
  ok(g.opening.human.finished && g.opening.cpu.finished, 'both marked finished');

  console.log('6. the opening can decide the round');
  g = mk({ human: [[5,7],[7,9]], cpu: [[0,1],[2,3]] });
  let res = await playRound(g, 1, { human: scripted([play([5,7]), play([7,9]), { type: 'done' }]), cpu: scripted([{ type: 'done' }]) }, silent);
  ok(res.winner && res.winner.id === 'human' && !res.blocked && g.players[0].hand.length === 0, 'laying down every tile wins the round at once');
  g = mk({ human: [[5,7]], cpu: [[5,2]] });
  res = await playRound(g, 0, { human: scripted([play([5,7]), { type: 'done' }]), cpu: scripted([play([5,2]), { type: 'done' }]) }, silent);
  ok(res.winner === null && res.tie === true, 'both emptying their hands is a tie');
  g = mk({ human: [[1,2]], cpu: [[3,4]], boneyard: [] });
  res = await playRound(g, 0, { human: scripted([]), cpu: scripted([]) }, silent);
  ok(res.blocked === true, 'nobody can start and the boneyard is empty: blocked');

  console.log('7. normal play follows the opening');
  g = mk({ human: [[5,7],[9,9],[7,3]], cpu: [[5,2],[2,4],[4,1],[5,9]] });   // CPU builds 5-2-4-1; its [5,9] still fits the Mexican train
  const turnsSeen = [];
  res = await playRound(g, 1, {
    human: { act: async (gm, p, info) => (info.placed === 0 ? play([5,7])(info) : { type: 'done' }), choose: async (gm, p, moves) => { turnsSeen.push('h'); return moves[0]; } },
    cpu: { act: async (gm, p, info) => cpuBuildAction(gm, p, info), choose: async (gm, p, moves) => { turnsSeen.push('c'); return cpuChoose(gm, p, moves); } },
  }, silent);
  ok(turnsSeen[0] === 'c', 'the chosen starting player takes the first normal turn');
  ok(g.trains.mexican.tiles.length >= 0 && res !== undefined, 'round completes');

  console.log('8. buildSteps / longestFullChain on partially built trains');
  const rngS = mulberry32(99);
  for (let i = 0; i < 400; i++) {
    const maxNum = 4 + Math.floor(rngS() * 5);
    const pool = [];
    for (let a = 0; a <= maxNum; a++) for (let b = a; b <= maxNum; b++) pool.push([a, b]);
    for (let j = pool.length - 1; j > 0; j--) { const k = Math.floor(rngS() * (j + 1)); [pool[j], pool[k]] = [pool[k], pool[j]]; }
    const gg = newRound({ engine: Math.floor(rngS() * (maxNum + 1)), handSize: 1, rng: mulberry32(i), simultaneousOpening: true });
    gg.players[0].hand = pool.slice(0, 3 + Math.floor(rngS() * 5)).map(t => t.slice());
    gg.boneyard = []; gg.players[1].hand = [[0, 0]];
    // build a random partial train by random plays
    const me = gg.players[0], tr = gg.trains.human;
    const k = Math.floor(rngS() * 4);
    for (let s = 0; s < k; s++) { const mv = legalMoves(gg, me, { ownOnly: true }); if (!mv.length) break; E.applyMove(gg, me, mv[Math.floor(rngS() * mv.length)]); }
    const poolAll = me.hand.map(canon).concat(tr.tiles.map(canon));
    const ref = bruteBest(poolAll, gg.engine);
    const full = longestFullChain(gg, me);
    ok(full.length === Math.max(0, ref.count), 'longestFullChain length matches brute force over hand + train');
    // execute the steps with a scripted agent and compare
    const steps = buildSteps(gg, me);
    const actions = steps.map(s => (s.type === 'undo' ? { type: 'undo' } : play(s.key.split('-').map(Number))));
    actions.push({ type: 'done' });
    try {
      await buildPhase(gg, me, scripted(actions), silent);
      ok(tr.tiles.length === Math.max(0, ref.count) && chainOk(gg, 'human'), 'executing the steps yields the longest valid train');
      const last = tr.tiles[tr.tiles.length - 1];
      ok(!last || !isDbl(last), 'and it does not end on a double');
    } catch (e) { ok(false, 'steps executed without error: ' + e.message); }
  }
  // steps reuse a matching prefix: a train that is already optimal needs nothing
  g = mk({ human: [[5,7],[7,9]], cpu: [[0,1]] });
  await buildPhase(g, g.players[0], scripted([play([5,7]), play([7,9]), { type: 'done' }]), silent);
  ok(buildSteps(g, g.players[0]).length === 0, 'an already-longest train needs no steps');
  g = mk({ human: [[5,7],[7,9],[5,2]], cpu: [[0,1]] });
  await buildPhase(g, g.players[0], scripted([play([5,2]), { type: 'done' }]), silent);
  const st = buildSteps(g, g.players[0]);
  ok(st.filter(s => s.type === 'undo').length === 1 && st.filter(s => s.type === 'play').length === 2, 'a worse start is taken back and rebuilt');

  console.log('9. 1,500 CPU-vs-CPU rounds through the real opening: every opening is the longest possible');
  let checked = 0, big = 0, maxLen = 0, outs = 0, blocked = 0, ties = 0;
  for (let i = 0; i < 1500; i++) {
    const engine = 12 - (i % 13);
    const game = newRound({ engine, handSize: 15, rng: mulberry32(7000 + i), simultaneousOpening: true });
    const initial = game.players.map(p => p.hand.map(t => t.slice()));
    const plan = initial.map(h => longestChain(h, engine, false).length);
    const hadEngine = initial.map(h => h.some(t => t[0] === engine || t[1] === engine));
    const agent = { act: async (gm, p, info) => cpuBuildAction(gm, p, info), choose: async (gm, p, moves) => cpuChoose(gm, p, moves) };
    let snapshot = null;
    const r = await playRound(game, i % 2, { human: agent, cpu: agent }, {
      ...silent,
      onOpeningDone: gm => { snapshot = { human: gm.trains.human.tiles.length, cpu: gm.trains.cpu.tiles.length, mex: gm.trains.mexican.tiles.length, total: totalTiles(gm) }; },
    });
    ok(snapshot.total === 90, 'tiles conserved through the opening');
    ok(snapshot.mex === 0, 'Mexican train empty after the opening');
    ok(chainOk(game, 'human') && chainOk(game, 'cpu') && chainOk(game, 'mexican'), 'trains are valid chains');
    [['human', 0], ['cpu', 1]].forEach(([id, idx]) => {
      if (plan[idx] > 0 && hadEngine[idx]) {
        checked++;
        ok(snapshot[id] === plan[idx], `opening train is the longest possible (${snapshot[id]} vs ${plan[idx]})`);
        maxLen = Math.max(maxLen, snapshot[id]);
        if (snapshot[id] >= 6) big++;
      }
    });
    if (r.blocked) blocked++; else if (r.tie) ties++; else outs++;
  }
  console.log(`   openings verified=${checked} | trains of 6+ tiles=${big} | longest=${maxLen} | rounds: wentOut=${outs} blocked=${blocked} ties=${ties}`);
  ok(checked > 2000 && big > 1000, 'many substantial openings exercised');

  console.log('10. random agents (take-backs, early Done, draws) never break the rules');
  let stress = 0;
  for (let i = 0; i < 1200; i++) {
    const game = newRound({ engine: 12 - (i % 13), handSize: 8 + (i % 8), rng: mulberry32(9000 + i), simultaneousOpening: true });
    const r = mulberry32(31337 + i);
    const randomAgent = { act: async (gm, p, info) => {
      await Promise.resolve();
      const opts = [];
      info.moves.forEach(m => { opts.push({ type: 'play', move: m }); opts.push({ type: 'play', move: m }); });
      if (info.canUndo) opts.push({ type: 'undo' });
      if (info.canDraw) { opts.push({ type: 'draw' }); opts.push({ type: 'draw' }); }
      if (info.canDone && r() < 0.35) return { type: 'done' };
      if (!opts.length) return info.canDone ? { type: 'done' } : { type: 'undo' };
      return opts[Math.floor(r() * opts.length)];
    }, choose: async (gm, p, moves) => moves[Math.floor(r() * moves.length)] };
    let snap = null;
    await playRound(game, i % 2, { human: randomAgent, cpu: randomAgent }, { ...silent, onOpeningDone: gm => { snap = { total: totalTiles(gm), ok: chainOk(gm, 'human') && chainOk(gm, 'cpu'), mex: gm.trains.mexican.tiles.length, dbl: ['human','cpu'].every(id => { const t = gm.trains[id].tiles; const last = t[t.length - 1]; return !last || !isDbl(last); }) }; } });
    ok(snap.total === 90 && snap.ok && snap.mex === 0, 'invariants hold after a random opening');
    ok(snap.dbl, 'nobody finished the opening on an uncovered double');
    stress++;
  }
  console.log(`   ${stress} random openings`);

  Object.keys(failCounts).forEach(m => console.log(`  (x${failCounts[m]}) ${m}`));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
