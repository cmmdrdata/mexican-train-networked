require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function makeApp(seed, extra) {
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {};
  const app = G.createApp(Object.assign({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, now: () => 1, chatRng: () => 1, nativeChance: 0, foodChance: 0, timer: { set() { return 0; }, clear() {} },
    storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } }, extra));
  app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
  return { app, root, S: app.state };
}

(async () => {
  console.log('the computer\'s face-down train: doubles stand upright');
  {
    const c = makeApp(5);
    for (let i = 0; i < 80 && !c.S.awaiting; i++) await tick();
    const gm = c.S.game;
    gm.opening = { human: { finished: false }, cpu: { finished: false } };                 // the computer is still building: its tiles are face down
    gm.trains.cpu.tiles = [[5, 7], [7, 7], [7, 9], [9, 9], [9, 2]]; gm.trains.cpu.end = 2;
    c.app.render(true);
    const track = c.root.innerHTML.match(/<div class="track[^"]*" data-train="cpu">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)[0];
    const tiles = [...track.matchAll(/<svg class="tile (h|v) back[^"]*"[^>]*data-idx="(\d+)"/g)].map(m => [Number(m[2]), m[1]]);
    ok(eq(tiles, [[0, 'h'], [1, 'v'], [2, 'h'], [3, 'v'], [4, 'h']]), `face down: the two doubles (7-7 and 9-9) stand upright, the rest lie along the train (${JSON.stringify(tiles)})`);
    const numbered = [...track.matchAll(/<svg class="tile (?!engine)[^"]*"[^>]*data-idx="\d+"/g)].map(m => m[0]);
    ok(numbered.length === 5 && numbered.every(x => / back/.test(x)), 'every tile placed so far is face down (only the engine tile at the start is face up, as always)');
    const labels = [...track.matchAll(/<svg class="tile (?!engine)[^"]*"[^>]*data-idx="\d+"[^>]*aria-label="([^"]*)"/g)].map(m => m[1]);
    ok(labels.length === 5 && labels.every(l => l === 'face-down tile'), 'and none of them reveals its numbers, even to a screen reader');
    gm.opening.cpu.finished = true; c.S.revealed = null; c.app.render(true);
    const open = c.root.innerHTML.match(/<div class="track[^"]*" data-train="cpu">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)[0];
    ok(!/ back/.test(open) && /<circle|<text/.test(open) && /<svg class="tile v[ "][^>]*aria-label="7 and 7"/.test(open) && /<svg class="tile h[ "][^>]*aria-label="5 and 7"/.test(open), 'once it has finished building they turn face up, doubles still across');
  }
  {
    // for real: let the computer build slowly, and check after each of its tiles
    const sleeps = [], gates = [];
    const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const store = {};
    let checked = 0, doublesSeen = 0, wrong = 0, runs = 0;
    for (let seed = 1; seed <= 60 && doublesSeen < 8; seed++) {
      const gatesLocal = [];
      const app = G.createApp({ root, rng: mulberry32(seed), reducedMotion: false, paceRng: () => 0.5, now: () => 1, chatRng: () => 1, nativeChance: 0, foodChance: 0, timer: { set() { return 0; }, clear() {} },
        sleep: ms => (ms >= 1300 ? new Promise(res => gatesLocal.push(res)) : Promise.resolve()), storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
      const orig = app.ui.onBuildPlay;
      app.ui.onBuildPlay = async (game, player, mv) => {
        const r = await orig(game, player, mv);
        if (player.id === 'cpu' && !game.opening.cpu.finished) {
          const tr = root.innerHTML.match(/<div class="track[^"]*" data-train="cpu">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
          if (tr) {
            [...tr[0].matchAll(/<svg class="tile (h|v) back[^"]*"[^>]*data-idx="(\d+)"/g)].forEach(m => { checked++; const t = game.trains.cpu.tiles[Number(m[2])]; const isD = t[0] === t[1]; if (isD) doublesSeen++; if ((m[1] === 'v') !== isD) wrong++; });
          }
        }
        return r;
      };
      app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
      for (let i = 0; i < 400; i++) { await tick(); if (gatesLocal.length) gatesLocal.shift()(); if (app.state.modal) break; const A = app.state.awaiting; if (A && A.kind === 'build') { if (A.canDraw) app.dispatch({ type: 'draw' }); else if (A.canDone) app.dispatch({ type: 'endBuild' }); else app.dispatch({ type: 'undoTile' }); } }
      app.dispatch({ type: 'newGame' }); runs++;
    }
    ok(checked > 50 && doublesSeen >= 5 && wrong === 0, `through real openings: ${checked} face-down tiles checked as the computer built (${doublesSeen} of them doubles), every one drawn the right way up`);
  }


  // and the hand is back to a plain grid: no overlap, no stagger
  const css = require('fs').readFileSync('../style.css', 'utf8');
  ok(!/--dy|--reserve|--rows/.test(css) && /\.hand-grid\s*\{[^}]*display:\s*grid/.test(css), 'the hand is a plain, non-overlapping grid again');
  const g = makeApp(3);
  for (let i = 0; i < 80 && !g.S.awaiting; i++) await tick();
  ok(!/data-row=|--dy:|--reserve/.test(g.root.innerHTML) && /<div class="hand-grid" style="--cols:\d+">/.test(g.root.innerHTML), 'and so is its markup');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
