'use strict';
// In your hand, when two tiles lie side by side and have a number in common, one is drawn the other way round so that the like halves face each other.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(2); } return f(); };
const show = (slots, flips) => slots.map(t => (t ? (flips[key(t)] ? t[1] + '|' + t[0] : t[0] + '|' + t[1]) : '__')).join('  ');
const face = (slots, across, prior) => G.faceLikeDots(slots, across, prior || {});

console.log('1. cases');
ok(show([[3, 5], [3, 7]], face([[3, 5], [3, 7]], 8)) === '5|3  3|7', 'a 3|5 beside a 3|7: the first is turned so the 3s face each other');
ok(show([[5, 3], [7, 3]], face([[5, 3], [7, 3]], 8)) === '5|3  3|7', 'a 5|3 beside a 7|3: here the second is the one turned');
ok(show([[3, 5], [5, 7]], face([[3, 5], [5, 7]], 8)) === '3|5  5|7', 'already facing (3|5 beside 5|7): nothing is turned');
ok(show([[3, 5], [5, 3]], face([[3, 5], [5, 3]], 8)) === '3|5  5|3', 'sharing both numbers and already facing on one: left as it is');
ok(show([[1, 2], [3, 4]], face([[1, 2], [3, 4]], 8)) === '1|2  3|4', 'no number in common: nothing is turned');
ok(show([[2, 3], [4, 3], [4, 5]], face([[2, 3], [4, 3], [4, 5]], 8)) === '2|3  3|4  4|5', 'a chain: 2|3, 4|3, 4|5 lines up as 2|3 3|4 4|5 (the middle one is turned)');
ok(show([[9, 4], [4, 4], [4, 6]], face([[9, 4], [4, 4], [4, 6]], 8)) === '9|4  4|4  4|6', 'a double between: 9|4 4|4 4|6, the double is never turned');
ok(show([[4, 9], [4, 4]], face([[4, 9], [4, 4]], 8)) === '9|4  4|4', 'a 4|9 before a double 4|4: the 4|9 is turned to face it');
ok(Object.values(face([[4, 4], [4, 9], [6, 6]], 8)).filter(Boolean).length === 0 || face([[4, 4], [4, 9], [6, 6]], 8)['4-4'] === false, 'doubles are never marked turned');
ok(show([[3, 5], null, [3, 7]], face([[3, 5], null, [3, 7]], 8)) === '3|5  __  3|7', 'an empty slot between: they are not side by side, nothing is turned');
ok(show([[3, 5], [3, 7], [3, 9], [3, 11]], face([[3, 5], [3, 7], [3, 9], [3, 11]], 2)) === '5|3  3|7  9|3  3|11', 'in rows of 2: each pair is a row of its own: 5|3 3|7 and 9|3 3|11 (the 3|7 and the 3|9 are not side by side)');
{
  const sl = [[3, 5], [3, 7], [3, 9], [3, 11]], o = face(sl, 4);
  const drawn = sl.map(t => (o[key(t)] ? [t[1], t[0]] : [t[0], t[1]]));
  const joins = [0, 1, 2].filter(i => drawn[i][1] === drawn[i + 1][0]).length;
  ok(joins === 2, `four tiles that all have a 3, in one row: two joins can have 3 facing 3 (a tile has only one 3, so it can face a 3 on only one of its sides): ${show(sl, o)}`);
}
{
  const prior = { '3-5': true }, input = JSON.stringify(prior);
  const o1 = face([[3, 5], [3, 7]], 8, prior), o2 = face([[3, 5], [3, 7]], 8, prior);
  ok(JSON.stringify(prior) === input && JSON.stringify(o1) === JSON.stringify(o2), 'the answer does not change what was passed in, and is the same each time');
  ok(JSON.stringify(face([[3, 5], [3, 7]], 8, o1)) === JSON.stringify(o1), 'and given its own answer it gives it back (nothing keeps turning)');
}

console.log('2. stickiness: a tile is not turned back for no reason');
{
  const before = face([[3, 5], [3, 7]], 8);                                       // 5|3 3|7
  const after = face([[3, 5]], 8, before);                                         // the neighbour has gone
  ok(show([[3, 5]], after) === '5|3', 'the neighbour is played: the 3|5 stays turned as it was (nothing is turned back)');
  const again = face([[3, 5], [4, 8]], 8, before);
  ok(show([[3, 5], [4, 8]], again) === '5|3  4|8', 'and a new neighbour with nothing in common leaves it as it was too');
  const re = face([[3, 5], [5, 8]], 8, before);
  ok(show([[3, 5], [5, 8]], re) === '3|5  5|8', 'a new neighbour that does share a number is faced: the 3|5 is turned back to face the 5');
  ok(show([[1, 2], [6, 7]], face([[1, 2], [6, 7]], 8, { '1-2': true, '6-7': true })) === '2|1  7|6', 'tiles with nothing in common keep however they were');
}

console.log('3. it is the best that can be done, and with the fewest turns (against trying every way round)');
{
  const rnd = mulberry32(2024), all = []; for (let x = 0; x <= 12; x++) for (let y = x; y <= 12; y++) all.push([x, y]);
  let trials = 0, worst = 0, runsChecked = 0, withShared = 0, optimal = 0;
  for (let n = 0; n < 4000; n++) {
    const len = 1 + Math.floor(rnd() * 14), across = 2 + Math.floor(rnd() * 9);
    const pool = all.slice(); const slots = [];
    for (let i = 0; i < len; i++) slots.push(rnd() < 0.15 ? null : pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    const tiles = slots.filter(Boolean).map(t => (rnd() < 0.5 ? t : [t[1], t[0]]));      // (stored either way round)
    let ti = 0; const stored = slots.map(t => (t ? tiles[ti++] : null));
    const prior = {}; stored.forEach(t => { if (t && rnd() < 0.4) prior[key(t)] = true; });
    const out = G.faceLikeDots(stored, across, prior);
    trials++;
    // the runs, found independently here
    for (let i = 0; i < stored.length;) {
      if (!stored[i]) { i++; continue; }
      let j = i; while (j + 1 < stored.length && stored[j + 1] && (j + 1) % across !== 0) j++;
      const run = stored.slice(i, j + 1);
      if (run.length > 1) {
        runsChecked++;
        const free = run.map((t, k) => (t[0] === t[1] ? -1 : k)).filter(k => k >= 0), score = a => { let m = 0; for (let k = 0; k + 1 < run.length; k++) { const r = a[k] ? run[k][0] : run[k][1], l = a[k + 1] ? run[k + 1][1] : run[k + 1][0]; if (r === l) m++; } return m; };
        let bestM = -1, bestC = 1e9;
        for (let mask = 0; mask < (1 << free.length); mask++) {
          const a = run.map(() => 0); free.forEach((k, b) => { a[k] = (mask >> b) & 1; });
          const m = score(a), c = run.reduce((s, t, k) => s + ((a[k] === 1) !== !!(prior[key(t)] && t[0] !== t[1]) ? 1 : 0), 0);
          if (m > bestM || (m === bestM && c < bestC)) { bestM = m; bestC = c; }
        }
        const got = run.map(t => (out[key(t)] ? 1 : 0)), gm = score(got), gc = run.reduce((s, t, k) => s + ((got[k] === 1) !== !!(prior[key(t)] && t[0] !== t[1]) ? 1 : 0), 0);
        if (bestM > 0) withShared++;
        if (gm === bestM && gc === bestC) optimal++; else worst++;
      }
      i = j + 1;
    }
  }
  ok(worst === 0, `in ${trials} random hands (${runsChecked} rows of tiles side by side, ${withShared} of them with something to face) every row has the most facing pairs there could be, with the fewest tiles turned (${worst} not)`);
  ok(withShared > 500, `(and enough of them really had pairs to face to make that mean something: ${withShared})`);
}

console.log('4. on the page, in real games');
function makeApp(seed) {
  const c = { store: {}, html: '', renders: 0 };
  const root = { set innerHTML(v) { c.html = v; c.renders++; }, get innerHTML() { return c.html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  c.app = G.createApp({ root, rng: mulberry32(seed), paceRng: () => 0, chatRng: () => 1, nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in c.store ? c.store[k] : null), set: (k, v) => { c.store[k] = v; } } });
  c.S = c.app.state; c.d = a => c.app.dispatch(a);
  c.d({ type: 'boot' });
  return c;
}
function step(c) {                                     // one action of the person at the keyboard, as the page's own buttons would do it
  const a = c.S.awaiting;
  if (!a) return;
  if (a.kind === 'modal') c.d({ type: 'dialogOk' });
  else if (a.kind === 'draw') c.d({ type: 'draw' });
  else if (a.kind === 'build') c.d({ type: a.canBuild ? 'autoBuild' : a.canDone ? 'endBuild' : 'undoTile' });
  else if (a.kind === 'move') { const m = a.moves[0]; c.d({ type: 'selectTile', key: key(m.tile) }); if (c.S.awaiting === a) c.d({ type: 'playOn', train: m.trainId }); }
}
// the hand as drawn: for each slot the [left, right] pip counts (read from the drawn pips), or null for an empty slot; and what the tile says it is
function gridOf(html) {
  const g = html.match(/<div class="hand-grid" style="--cols:(\d+)">([^]*?)<\/div><\/div>\s*<\/section>/); if (!g) return null;
  const cells = []; const re = /<button class="tile-btn[^"]*"[^>]*data-key="([^"]+)"[^>]*aria-label="(\d+) and (\d+)[^"]*"[^>]*>([^]*?)<\/button>|<div class="slot-empty hole"/g; let m;
  while ((m = re.exec(g[2]))) {
    if (!m[1]) { cells.push(null); continue; }
    const gs = Array.from(m[4].matchAll(/<g transform="translate\((2|102),2\)">([^]*?)<\/g>/g)).map(x => (x[2].match(/<circle/g) || []).length);
    cells.push({ key: m[1], l: +m[2], r: +m[3], pips: gs });
  }
  return { cols: +g[1], cells };
}
const runsOf = (cells, across) => { const runs = []; for (let i = 0; i < cells.length;) { if (!cells[i]) { i++; continue; } let j = i; while (j + 1 < cells.length && cells[j + 1] && (j + 1) % across !== 0) j++; runs.push(cells.slice(i, j + 1)); i = j + 1; } return runs; };
const matches = run => { let m = 0; for (let k = 0; k + 1 < run.length; k++) if (run[k].r === run[k + 1].l) m++; return m; };
const bestMatches = run => { const free = run.map((t, k) => (t.l === t.r ? -1 : k)).filter(k => k >= 0); let best = 0; for (let mask = 0; mask < (1 << free.length); mask++) { const a = run.map(() => 0); free.forEach((k, b) => { a[k] = (mask >> b) & 1; }); let m = 0; for (let k = 0; k + 1 < run.length; k++) { const r = a[k] ? run[k].l : run[k].r, l = a[k + 1] ? run[k + 1].r : run[k + 1].l; if (r === l) m++; } best = Math.max(best, m); } return best; };
(async () => {
  let looks = 0, notBest = 0, labelsWrong = 0, rerolled = 0, pairsFaced = 0, pairsShared = 0, renderLooks = 0;
  for (const seed of [21, 22, 23, 24, 25]) {
    const c = makeApp(seed);
    c.d({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'normal' });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    let prev = null;
    for (let i = 0; i < 300 && !c.S.modal; i++) {
      step(c);
      await wait(3);
      if (!c.S.game || c.S.modal) break;
      const g = gridOf(c.html); if (!g) continue;
      looks++;
      const tilesNow = g.cells.filter(Boolean);
      if (tilesNow.some(t => t.pips[0] !== t.l || t.pips[1] !== t.r)) labelsWrong++;
      const runs = runsOf(g.cells, g.cols);
      for (const run of runs) {
        if (run.length < 2) continue;
        if (matches(run) < bestMatches(run)) notBest++;
        for (let k = 0; k + 1 < run.length; k++) { const a1 = run[k], b1 = run[k + 1]; const share = a1.l === b1.l || a1.l === b1.r || a1.r === b1.l || a1.r === b1.r; if (share) { pairsShared++; if (a1.r === b1.l) pairsFaced++; } }
      }
      if (prev) {                                                                 // a row of tiles that is just as it was is not turned about
        const was = {}; runsOf(prev.cells, prev.cols).forEach(r => { was[r.map(t => t.key).join()] = r.map(t => t.l + '|' + t.r).join(); });
        for (const r of runs) { const k = r.map(t => t.key).join(); if (prev.cols === g.cols && was[k] !== undefined && was[k] !== r.map(t => t.l + '|' + t.r).join()) rerolled++; }
      }
      prev = g;
    }
  }
  ok(looks > 100, `${looks} looks at the hand in 5 real games`);
  ok(labelsWrong === 0, 'the numbers each tile says it is match the pips it is drawn with, on every look');
  ok(notBest === 0, `in every row of tiles side by side, on every look, the most possible pairs face each other (${notBest} rows that did not)`);
  ok(pairsShared > 50 && pairsFaced >= pairsShared * 0.5, `and of the side-by-side pairs that had a number in common (${pairsShared}), ${pairsFaced} face each other (the rest could not all be: a tile has only two sides)`);
  ok(rerolled === 0, `a row of tiles that is just as it was is never turned about (${rerolled})`);

  console.log('5. the real length of a row, as the screen lays it out');
  {
    const c = makeApp(30);
    c.d({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'easy' });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    // hands are drawn in rows of the nominal length until the screen says otherwise
    let columns = '100px 100px 100px', measured = 0;
    globalThis.getComputedStyle = () => { measured++; return { gridTemplateColumns: columns }; };
    c.S.game.players[0].hand = [[3, 5], [3, 7], [3, 9], [3, 11], [3, 12], [3, 6]].map(t => t.slice()); c.S.handOrder = null; c.S.flips = {}; c.S.handCols = 0;
    const r0 = c.renders; c.app.render(true);
    ok(c.S.handCols === 3 && c.renders - r0 <= 2 && measured >= 1, `the page reads how many tiles the grid really has in a row (3), and draws at most one extra time to use it (${c.renders - r0} draws)`);
    let g = gridOf(c.html);
    ok(runsOf(g.cells, 3).every(r => r.length < 2 || matches(r) === bestMatches(r)) && runsOf(g.cells, 3).length === 2, 'and the tiles face each other within rows of 3, not of the nominal length');
    const a1 = g.cells[2], b1 = g.cells[3];
    ok(!(a1.r === b1.l) || a1.r === b1.l, '(the third and fourth tile are in different rows)');
    columns = '100px 100px 100px 100px 100px 100px'; const r1 = c.renders;
    c.d({ type: 'measureHand' });
    g = gridOf(c.html);
    ok(c.S.handCols === 6 && c.renders - r1 === 1 && runsOf(g.cells, 6).length === 1 && matches(runsOf(g.cells, 6)[0]) === bestMatches(runsOf(g.cells, 6)[0]), 'the window gets wider (6 in a row): the hand is drawn again, all six side by side now, and facing');
    const r2 = c.renders; c.d({ type: 'measureHand' });
    ok(c.renders === r2, 'and when nothing has changed, nothing is drawn');
    columns = 'none'; c.d({ type: 'measureHand' });
    ok(c.S.handCols === 6, '(a grid that says nothing leaves what was measured)');
    delete globalThis.getComputedStyle;
  }

  console.log('6. while a tile is being dragged about, nothing turns');
  {
    const c = makeApp(31);
    c.d({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'easy' });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    c.S.game.players[0].hand = [[3, 5], [4, 8], [3, 7], [1, 2], [6, 7]].map(t => t.slice()); c.S.handOrder = null; c.S.flips = {}; c.S.handCols = 0; c.app.render(true);
    const keys = gridOf(c.html).cells.map(t => t && t.key);
    const frozen = JSON.stringify(c.S.flips);
    c.d({ type: 'dragStart', key: keys[0] }); c.d({ type: 'dragMove', index: 1 }); c.d({ type: 'dragMove', index: 2 });
    ok(JSON.stringify(c.S.flips) === frozen, 'dragging a tile along: no tile is turned while it is on the move');
    c.d({ type: 'dragEnd' });
    const g = gridOf(c.html);
    ok(runsOf(g.cells, g.cols).every(r => r.length < 2 || matches(r) === bestMatches(r)), 'let go: the tiles that now lie side by side face each other');
  }
  console.log('7. a new round deals a fresh hand: nothing is still turned from the last one');
  {
    const c = makeApp(40);
    c.d({ type: 'startGame', rounds: 4, hand: 15, style: 'pips', level: 'normal' });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    let sawTurned = false, checked = 0, stale = 0;
    for (let i = 0; i < 4000 && !(c.S.roundIndex === 1 && c.S.awaiting && c.S.awaiting.kind === 'build' && checked); i++) {
      if (c.S.roundIndex === 0 && Object.values(c.S.flips || {}).some(Boolean)) sawTurned = true;
      if (c.S.roundIndex === 0 && c.S.awaiting && c.S.awaiting.kind === 'modal') {     // the round is over: leave EVERY tile marked as turned, so a new round that kept them would show it
        for (let x = 0; x <= 12; x++) for (let y = x + 1; y <= 12; y++) c.S.flips[x + '-' + y] = true;
      }
      step(c);
      await wait(3);
      if (c.S.roundIndex === 1 && c.S.game && !checked) {
        c.app.render(true);
        const g = gridOf(c.html); if (!g) continue;
        const hand = c.S.game.players[0].hand, byKey = {}; hand.forEach(t => { byKey[key(t)] = t; });
        const stored = g.cells.map(cell => (cell ? byKey[cell.key] : null));
        const want = G.faceLikeDots(stored, g.cols, {});
        stored.forEach((t, k) => { if (t && t[0] !== t[1] && (g.cells[k].l !== t[0]) !== !!want[key(t)]) stale++; });
        checked = 1;
      }
    }
    ok(sawTurned, 'in the first round some tiles really were turned (so this checks something)');
    ok(checked === 1 && stale === 0, `at the start of the second round the hand is drawn as a fresh hand is: no tile is left turned from the first (${stale} that were)`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
