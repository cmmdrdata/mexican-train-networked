'use strict';
// The computer changes its mind while it builds its opening train: it takes the tile it just laid back, one at a time, and goes on, until it finally finishes.
// Easy does it most, then Medium, then Hard, then Expert.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32, key, newRound, buildPhase, cpuBuildAction, legalMoves } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const LEVELS = ['easy', 'normal', 'hard', 'expert'];

/* Run one opening for the second player with the computer's own decisions; returns what it did. */
async function opening(level, seed, hand) {
  const g = newRound({ engine: 12, handSize: hand, rng: mulberry32(seed * 7919), simultaneousOpening: true });
  const p = g.players[1], train = g.trains[p.id], acts = [], lens = [];
  const agent = { act: async (gm, pl, info) => { const a = cpuBuildAction(gm, pl, info, level); acts.push(a.type + (a.wobble ? '!' : '')); return a; } };
  const ui = { onBuildPlay: async () => { lens.push(train.tiles.length); }, onBuildUndo: async () => { lens.push(train.tiles.length); }, onBuildDraw() {}, onBuildDone() {}, onBuildPass() {} };
  await buildPhase(g, p, agent, ui);
  return { g, p, train, acts, lens, st: g.opening[p.id], next: g.rng() };
}

(async () => {
  console.log('1. how much each level changes its mind (thousands of real openings)');
  const stats = {};
  for (const hand of [15, 8]) {
    stats[hand] = {};
    for (const level of LEVELS) {
      const s = { n: 0, wob: 0, max: 0, back2back: 0, wobNotLast: 0, endsOnDouble: 0, notFinished: 0, tiles: 0, pips: 0, undoThenDone: 0 };
      for (let seed = 1; seed <= 1000; seed++) {
        const r = await opening(level, seed, hand); s.n++;
        s.wob += r.st.wobbled || 0; s.max = Math.max(s.max, r.st.wobbled || 0);
        for (let i = 1; i < r.acts.length; i++) if (r.acts[i - 1].startsWith('undo!') && r.acts[i].startsWith('undo')) s.back2back++;
        if (!r.st.finished) s.notFinished++;
        const last = r.train.tiles[r.train.tiles.length - 1]; if (last && last[0] === last[1]) s.endsOnDouble++;
        s.tiles += r.train.tiles.length; s.pips += r.train.tiles.reduce((a, t) => a + t[0] + t[1], 0);
        for (let i = 1; i < r.acts.length; i++) if (r.acts[i - 1] === 'undo!' && r.acts[i] === 'done') s.undoThenDone++;
      }
      stats[hand][level] = s;
    }
    const a = LEVELS.map(l => stats[hand][l].wob / 1000);
    const gaps = hand === 15 ? [0.3, 0.3, 0.2] : [0.4, 0.15, 0.08];
    ok(a[0] > a[1] + gaps[0] && a[1] > a[2] + gaps[1] && a[2] > a[3] + gaps[2] && a[3] > 0, `${hand} tiles each: tiles taken back per opening, Easy ${a[0].toFixed(2)} > Medium ${a[1].toFixed(2)} > Hard ${a[2].toFixed(2)} > Expert ${a[3].toFixed(2)} (and Expert does it too, a little)`);
    ok(LEVELS.every(l => stats[hand][l].max <= G.WOBBLE[l].max), `${hand} tiles each: never more than its limit in an opening (${LEVELS.map(l => l + ' ' + stats[hand][l].max + '/' + G.WOBBLE[l].max).join(', ')})`);
    ok(LEVELS.every(l => stats[hand][l].back2back === 0), `${hand} tiles each: never two changes of mind running (one tile at a time: take one back, lay one)`);
    ok(LEVELS.every(l => stats[hand][l].notFinished === 0 && stats[hand][l].endsOnDouble === 0), `${hand} tiles each: every opening finishes, and never on an uncovered double`);
    ok(LEVELS.every(l => stats[hand][l].undoThenDone === 0), `${hand} tiles each: it never takes a tile back and finishes at once: it goes on, and finishes after`);
  }
  ok(G.WOBBLE.easy.p > G.WOBBLE.normal.p && G.WOBBLE.normal.p > G.WOBBLE.hard.p && G.WOBBLE.hard.p > G.WOBBLE.expert.p && G.WOBBLE.easy.max >= G.WOBBLE.normal.max && G.WOBBLE.normal.max >= G.WOBBLE.hard.max && G.WOBBLE.hard.max >= G.WOBBLE.expert.max, 'the settings themselves are in that order (the chance and the limit)');

  console.log('2. what it finishes with is as good as before');
  {
    const saved = JSON.parse(JSON.stringify(G.WOBBLE));
    for (const level of LEVELS) {
      let diffLen = 0, diffPips = 0, same = 0, n = 0, tilesNew = 0, tilesOld = 0, nextDiff = 0;
      for (let seed = 1; seed <= 600; seed++) {
        const a = await opening(level, seed, 15);
        G.WOBBLE[level] = { p: 0, max: 0 };
        const b = await opening(level, seed, 15);
        G.WOBBLE[level] = saved[level];
        n++; tilesNew += a.train.tiles.length; tilesOld += b.train.tiles.length;
        if (a.train.tiles.length !== b.train.tiles.length) diffLen++;
        if (a.train.tiles.reduce((s, t) => s + t[0] + t[1], 0) !== b.train.tiles.reduce((s, t) => s + t[0] + t[1], 0)) diffPips++;
        if (a.train.tiles.map(key).join() === b.train.tiles.map(key).join()) same++;
        if (a.next !== b.next) nextDiff++;
      }
      if (level === 'easy') ok(tilesNew / n >= tilesOld / n - 0.05, `easy: its trains are no shorter for the second thoughts (${(tilesNew / n).toFixed(2)} tiles against ${(tilesOld / n).toFixed(2)})`);
      else {
        ok(diffLen === 0 && diffPips === 0, `${level}: the train it finishes with is exactly as long and as heavy as without the second thoughts, in all ${n} openings (${diffLen} differ in length, ${diffPips} in pips; the same tiles in the same order in ${same})`);
        ok(nextDiff === 0, `${level}: and the game's own random numbers are not touched (the next number drawn is the same, in all ${n})`);
      }
    }
    LEVELS.forEach(l => { G.WOBBLE[l] = saved[l]; });
  }

  console.log('3. the same position always gives the same answer');
  {
    const a = await opening('normal', 17, 15), b = await opening('normal', 17, 15), c = await opening('normal', 18, 15);
    ok(a.acts.join() === b.acts.join() && a.lens.join() === b.lens.join(), 'the same deal: the very same sequence of laying and taking back');
    ok(a.acts.join() !== c.acts.join(), 'a different deal: a different one');
  }

  console.log('4. what it looks like: tiles added and removed one at a time');
  {
    let games = 0, withBack = 0, steps = 0, bad = 0, ups = 0, downs = 0;
    for (const level of ['easy', 'normal']) for (let seed = 1; seed <= 60; seed++) {
      const r = await opening(level, seed, 15); games++;
      let prev = 0, sawDown = false;
      for (const len of r.lens) { steps++; if (Math.abs(len - prev) !== 1) bad++; if (len > prev) ups++; else { downs++; sawDown = true; } prev = len; }
      if (sawDown) withBack++;
    }
    ok(bad === 0, `the number of tiles in its train only ever changes by one at a time, up or down (${steps} changes, ${ups} up, ${downs} down, ${bad} that were not by one)`);
    ok(withBack >= games * 0.5, `most openings (${withBack} of ${games}) have the train getting shorter at some point, then longer again`);
  }

  console.log('5. the pace');
  {
    ok(G.PACE.undo && G.PACE.undo[0] >= 300 && G.PACE.undo[1] > G.PACE.undo[0] && G.PACE.undo[1] < G.PACE.place[1], `taking a tile back has its own, quicker wait (${G.PACE.undo} against ${G.PACE.place} for laying one)`);
    ok(G.paceFor('undo', 0) === G.PACE.undo[0] && G.paceFor('undo', 0.5) === (G.PACE.undo[0] + G.PACE.undo[1]) / 2, 'and paceFor knows it');
    ok(G.PACE.replace && G.PACE.replace[1] < G.PACE.place[1] && G.PACE.replace[1] - G.PACE.replace[0] < G.PACE.place[1] - G.PACE.place[0], `laying a tile straight after changing its mind is quicker than a first look (${G.PACE.replace} against ${G.PACE.place})`);
    const taken = [400, 420, 450, 500, 560, 650, 700, 800, 900, 1000, 1100, 1200, 110, 150, 300];
    ok(!taken.slice(0, 1).includes(G.PACE.replace[0]) && G.PACE.replace[0] !== G.PACE.undo[0] && G.PACE.replace[0] !== G.PACE.place[0] && G.PACE.replace[0] !== G.PACE.finish[0] && G.PACE.replace[0] !== G.PACE.draw[0] && G.PACE.replace[0] !== G.PACE.settle[0], 'its shortest wait is its own number, so it can be told from the others in the tests of what the page waits for');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
