const vm = require('vm'), fs = require('fs');
function loadEngine(path) {
  const ctx = vm.createContext({ console, Math, JSON, Object, Array, Number, String, Set, Map, Promise, Error, Float32Array, Float64Array, Uint32Array });
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx);
  return ctx.MexicanTrainGame.Engine;
}
const NEW = loadEngine('./game.js');
const OLD = loadEngine('../game_v4_rule.js');                       // the engine from before the levels were added, plus ONLY the new rule that a double cannot go out

let pass = 0, fail = 0;
const failCounts = {};
const ok = (c, m) => { if (c) pass++; else { fail++; failCounts[m] = (failCounts[m] || 0) + 1; if (failCounts[m] === 1) console.log('  FAIL:', m); } };
const silent = { onNeedDraw() {}, onDraw() {}, onPass() {}, onPlay() {} };
const isDbl = t => t[0] === t[1];

const ctl = (E, level, check) => ({
  act: async (g, p, i) => E.cpuBuildAction(g, p, i, level),
  choose: async (g, p, moves) => { const c = E.cpuChoose(g, p, moves, level); if (check) check(moves, c); return c; },
});
const total = g => g.players.reduce((s, p) => s + p.hand.length, 0) + g.boneyard.length + Object.values(g.trains).reduce((s, t) => s + t.tiles.length, 0);
const chainOk = (g, id) => { let end = g.engine; for (const t of g.trains[id].tiles) { if (t[0] !== end) return false; end = t[1]; } return g.trains[id].end === end; };

async function duplicate(E, A, B, deals, seedBase) {
  let wa = 0, wb = 0, ties = 0, pa = 0, pb = 0, n = 0;
  for (let i = 0; i < deals; i++) for (const swap of [false, true]) {
    const g = E.newRound({ engine: 12 - (i % 13), handSize: 15, rng: E.mulberry32(seedBase + i), simultaneousOpening: true });
    const sa = swap ? 'cpu' : 'human', sb = swap ? 'human' : 'cpu';
    await E.playRound(g, i % 2, { [sa]: A, [sb]: B }, silent);
    const x = E.handPips(g.players.find(p => p.id === sa)), y = E.handPips(g.players.find(p => p.id === sb));
    pa += x; pb += y; n++;
    if (x < y) wa++; else if (y < x) wb++; else ties++;
  }
  return { winA: 100 * wa / n, winB: 100 * wb / n, pipsA: pa / n, pipsB: pb / n, n };
}

(async () => {
  console.log('1. Normal is exactly what it was before (same deals, old engine vs new engine)');
  let same = 0, differ = 0;
  for (let i = 0; i < 400; i++) {
    const seed = 3000 + i, engine = 12 - (i % 13);
    const go = OLD.newRound({ engine, handSize: 15, rng: OLD.mulberry32(seed), simultaneousOpening: true });
    const gn = NEW.newRound({ engine, handSize: 15, rng: NEW.mulberry32(seed), simultaneousOpening: true });
    const co = { act: async (g, p, i2) => OLD.cpuBuildAction(g, p, i2), choose: async (g, p, m) => OLD.cpuChoose(g, p, m) };
    await OLD.playRound(go, i % 2, { human: co, cpu: co }, silent);
    await NEW.playRound(gn, i % 2, { human: ctl(NEW, 'normal'), cpu: ctl(NEW, undefined) }, silent);   // 'normal' and "no level" must both match
    const a = JSON.stringify([go.trains, go.players.map(p => p.hand)]), b = JSON.stringify([gn.trains, gn.players.map(p => p.hand)]);
    if (a === b) same++; else differ++;
  }
  ok(differ === 0, `400 whole rounds played identically move-for-move (${same} same, ${differ} differ)`);
  console.log(`   ${same}/400 rounds identical`);

  console.log('2. every level plays legally and keeps the board valid (all 9 pairings)');
  let rounds = 0;
  for (const la of NEW.LEVELS) for (const lb of NEW.LEVELS) {
    for (let i = 0; i < 150; i++) {
      const g = NEW.newRound({ engine: 12 - (i % 13), handSize: 8 + (i % 8), rng: NEW.mulberry32(11000 + i), simultaneousOpening: true });
      const legal = (moves, c) => ok(moves.includes(c), `${la}/${lb}: chosen play is one of the legal moves`);
      let snap = null;
      await NEW.playRound(g, i % 2, { human: ctl(NEW, la, legal), cpu: ctl(NEW, lb, legal) }, { ...silent, onOpeningDone: gm => {
        snap = { n: total(gm), ok: chainOk(gm, 'human') && chainOk(gm, 'cpu'), mex: gm.trains.mexican.tiles.length,
          dbl: ['human', 'cpu'].every(id => { const t = gm.trains[id].tiles; const last = t[t.length - 1]; return !last || !isDbl(last); }) };
      } });
      ok(snap.n === 90 && snap.ok && snap.mex === 0 && snap.dbl, `${la}/${lb}: board valid after the opening`);
      ok(total(g) === 90 && chainOk(g, 'human') && chainOk(g, 'cpu') && chainOk(g, 'mexican'), `${la}/${lb}: board valid at the end of the round`);
      rounds++;
    }
  }
  console.log(`   ${rounds} rounds`);

  console.log('3. openings by level');
  const lens = { easy: [], normal: [], hard: [] };
  for (const lv of NEW.LEVELS) for (let i = 0; i < 800; i++) {
    const g = NEW.newRound({ engine: 12 - (i % 13), handSize: 15, rng: NEW.mulberry32(21000 + i), simultaneousOpening: true });
    let n = null;
    await NEW.playRound(g, 0, { human: ctl(NEW, lv), cpu: ctl(NEW, lv) }, { ...silent, onOpeningDone: gm => { n = gm.trains.human.tiles.length; } });
    lens[lv].push(n);
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`   average opening length: easy ${avg(lens.easy).toFixed(2)} | normal ${avg(lens.normal).toFixed(2)} | hard ${avg(lens.hard).toFixed(2)}`);
  ok(JSON.stringify(lens.normal) === JSON.stringify(lens.hard), 'Normal and Hard both build the true longest train');
  ok(avg(lens.easy) < avg(lens.normal) - 2, 'Easy builds clearly shorter trains');
  ok(avg(lens.easy) > 1.5, 'but still builds something');

  console.log('4. strength ordering (duplicate deals: each played twice with seats swapped)');
  const mk = lv => ctl(NEW, lv);
  const N = 700;
  const hn = await duplicate(NEW, mk('hard'), mk('normal'), N, 60000);
  console.log(`   Hard   vs Normal : ${hn.winA.toFixed(1)}% - ${hn.winB.toFixed(1)}%   pips left ${hn.pipsA.toFixed(1)} vs ${hn.pipsB.toFixed(1)}   (${hn.n} rounds)`);
  ok(hn.winA > hn.winB + 4 && hn.pipsA < hn.pipsB - 2, 'Hard beats Normal by a clear margin and leaves fewer pips');
  const ne = await duplicate(NEW, mk('normal'), mk('easy'), N, 61000);
  console.log(`   Normal vs Easy   : ${ne.winA.toFixed(1)}% - ${ne.winB.toFixed(1)}%   pips left ${ne.pipsA.toFixed(1)} vs ${ne.pipsB.toFixed(1)}`);
  ok(ne.winA > ne.winB + 15 && ne.pipsA < ne.pipsB - 8, 'Normal beats Easy by a clear margin');
  const he = await duplicate(NEW, mk('hard'), mk('easy'), N, 62000);
  console.log(`   Hard   vs Easy   : ${he.winA.toFixed(1)}% - ${he.winB.toFixed(1)}%   pips left ${he.pipsA.toFixed(1)} vs ${he.pipsB.toFixed(1)}`);
  ok(he.winA > ne.winA && he.winA > he.winB + 20, 'Hard beats Easy by even more than Normal does');
  const rnd = { act: async (g, p, i) => NEW.cpuBuildAction(g, p, i, 'easy'), choose: async (g, p, m) => m[Math.floor(g.rng() * m.length)] };
  const er = await duplicate(NEW, mk('easy'), rnd, N, 63000);
  console.log(`   Easy   vs random : ${er.winA.toFixed(1)}% - ${er.winB.toFixed(1)}%   pips left ${er.pipsA.toFixed(1)} vs ${er.pipsB.toFixed(1)}`);
  ok(er.winA > er.winB + 2, 'Easy is still better than pure random play (not silly)');
  const hh = await duplicate(NEW, mk('hard'), mk('hard'), 300, 64000);
  ok(Math.abs(hh.winA - hh.winB) < 8, `identical levels are evenly matched (${hh.winA.toFixed(1)}% vs ${hh.winB.toFixed(1)}%)`);

  Object.keys(failCounts).forEach(m => console.log(`  (x${failCounts[m]}) ${m}`));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
