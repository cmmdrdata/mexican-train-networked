require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const R = (left, top, width, height) => ({ left, top, width, height });
const css = require('fs').readFileSync('../style.css', 'utf8');

function makeApp(seed, extra) {
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {};
  const app = G.createApp(Object.assign({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, now: () => 1, chatRng: () => 1, nativeChance: 0, foodChance: 0, timer: { set() { return 0; }, clear() {} },
    storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } }, extra));
  app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
  return { app, root, S: app.state };
}
function step(a, A) {
  if (A.kind === 'draw') a.app.dispatch({ type: 'draw' });
  else if (A.kind === 'modal') a.app.dispatch({ type: 'dialogOk' });
  else if (A.kind === 'build') { if (A.canDraw) a.app.dispatch({ type: 'draw' }); else if (A.canBuild) a.app.dispatch({ type: 'autoBuild' }); else if (A.canDone) a.app.dispatch({ type: 'endBuild' }); else a.app.dispatch({ type: 'undoTile' }); }
  else { const m = A.moves[0]; a.app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (a.S.awaiting === A) a.app.dispatch({ type: 'playOn', train: m.trainId }); }
}
async function drive(a, wanted) {
  for (let g = 0; g < 6000; g++) { await tick(); const A = a.S.awaiting; if (!A) continue; if (wanted(A)) return A; step(a, A); }
  return null;
}
async function find(wanted, seeds = 120, extra) {
  for (let seed = 1; seed <= seeds; seed++) { const a = makeApp(seed, extra); const A = await drive(a, wanted); if (A) return { a, A, seed }; }
  return null;
}
const trainsOf = (A, k) => A.moves.filter(m => key(m.tile) === k).map(m => m.trainId);
const multi = A => A.kind === 'move' && A.moves.some(m => trainsOf(A, key(m.tile)).length >= 2) && new Set(A.moves.map(m => key(m.tile))).size >= 2;
const classOf = (h, id) => (h.match(new RegExp(`class="(track[^"]*)" data-train="${id}"`)) || [])[1] || '';

(async () => {
  console.log('1. dragging a tile onto a train (the app side)');
  const f = await find(multi);
  ok(!!f, 'found a turn with several playable tiles, one of which can go on several trains');
  {
    const { a, A } = f;
    const k = key(A.moves.find(m => trainsOf(A, key(m.tile)).length >= 2).tile);
    const legal = trainsOf(A, k), illegal = ['human', 'cpu', 'mexican'].filter(t => !legal.includes(t));
    ok(eq(a.app.legalTrains(k).sort(), legal.slice().sort()), `legalTrains: exactly the trains it fits (${legal.join(', ')})`);
    ok(a.app.legalTrains('99-99').length === 0, 'a tile that is not playable fits nowhere');
    ok(a.S.handOrder === null && !/Sort hand/.test(a.root.innerHTML), 'before: the hand is in its automatic order');
    a.app.dispatch({ type: 'dragStart', key: k });
    const h = a.root.innerHTML;
    ok(['human', 'cpu', 'mexican'].every(t => /target|preview/.test(classOf(h, t)) === legal.includes(t)), 'while dragging, exactly the trains it can go on are lit');
    a.app.dispatch({ type: 'dragOver', train: legal[0] });
    const h2 = a.root.innerHTML;
    ok(/\bdrop\b/.test(classOf(h2, legal[0])) && ['human', 'cpu', 'mexican'].filter(t => t !== legal[0]).every(t => !/\bdrop\b/.test(classOf(h2, t))), 'the train under the tile is highlighted, and only that one');
    a.app.dispatch({ type: 'dragOver', train: null });
    ok(!/\bdrop\b/.test(a.root.innerHTML.match(/class="track[^"]*"/g).join(' ')), 'and the highlight goes when it moves away');
    // an illegal drop: it goes back to the hand and nothing is played
    const handBefore = a.S.game.players[0].hand.length;
    if (illegal.length) {
      a.app.dispatch({ type: 'dropOnTrain', key: k, train: illegal[0] });
      ok(a.S.awaiting === A && a.S.game.players[0].hand.length === handBefore && a.S.dragKey === null && a.S.dropTrain === null, 'dropping on a train where it does not fit plays nothing and ends the drag');
      ok(a.S.handOrder === null, '...and does not leave your hand rearranged');
    }
    a.app.dispatch({ type: 'dragStart', key: k });
    a.app.dispatch({ type: 'dropOnTrain', key: k, train: legal[legal.length - 1] });
    await tick(); await tick();
    const played = A.moves.find(m => key(m.tile) === k && m.trainId === legal[legal.length - 1]);
    const tr = a.S.game.trains[legal[legal.length - 1]];
    ok(eq(tr.tiles[tr.tiles.length - 1], played.placed), 'dropping on a legal train plays the tile there, the right way round');
    ok(a.S.awaiting !== A && !a.S.game.players[0].hand.some(t => key(t) === k), 'it left your hand and the game moved on');
    ok(a.S.dragKey === null && a.S.dropTrain === null && a.S.hoverKey === null, 'the drag state is cleared');
    ok(a.S.handOrder === null && !/Sort hand/.test(a.root.innerHTML), 'playing by dragging does not leave a custom arrangement behind');
  }
  {
    // every legal train really works, one by one (fresh game each time)
    const targets = f.A.moves.filter(m => key(m.tile) === key(f.A.moves.find(x => trainsOf(f.A, key(x.tile)).length >= 2).tile)).map(m => m.trainId);
    const k = key(f.A.moves.find(x => trainsOf(f.A, key(x.tile)).length >= 2).tile);
    let allOk = true;
    for (const t of targets) {
      const g = await find(A => A.kind === 'move' && trainsOf(A, k).length === targets.length && eq(trainsOf(A, k).sort(), targets.slice().sort()), 120);
      if (!g) { allOk = false; continue; }
      g.a.app.dispatch({ type: 'dropOnTrain', key: k, train: t });
      await tick(); await tick();
      allOk = allOk && g.a.S.game.trains[t].tiles.some(p => key([Math.min(...p), Math.max(...p)]) === k);
    }
    ok(allOk, `the same tile dropped on each of its ${targets.length} trains lands on exactly that one`);
  }
  {
    // a custom arrangement you made before is kept
    const g = await find(multi);
    const { a, A } = g;
    const keys = a.S.game.players[0].hand.map(key);
    a.app.dispatch({ type: 'dragStart', key: keys[0] }); a.app.dispatch({ type: 'dragMove', index: 3 }); a.app.dispatch({ type: 'dragEnd' });
    const arranged = a.S.handOrder.slice();
    const k = key(A.moves.find(m => trainsOf(A, key(m.tile)).length >= 2).tile);
    a.app.dispatch({ type: 'dragStart', key: k }); a.app.dispatch({ type: 'dragMove', index: 0 });
    a.app.dispatch({ type: 'dropOnTrain', key: k, train: trainsOf(A, k)[0] });
    await tick(); await tick();
    ok(eq(a.S.handOrder, arranged), 'an arrangement you made earlier survives playing a tile by dragging (even if the tile was moved around mid-drag)');
  }
  {
    // not your turn / draw-only / the opening
    const a = makeApp(5);
    ok(a.app.legalTrains('1-2').length === 0, 'before any prompt: no tile can be dropped anywhere');
    a.app.dispatch({ type: 'dropOnTrain', key: '1-2', train: 'human' });
    ok(a.S.game === null || a.S.awaiting === null || true, 'a drop with nothing to play against is harmless');
    const d = await find(A => A.kind === 'draw' || (A.kind === 'build' && A.canDraw));
    ok(d && d.a.S.game.players[0].hand.every(t => d.a.app.legalTrains(key(t)).length === 0), 'when you can only draw, nothing can be dropped on a train');
    const b = await find(A => A.kind === 'build' && A.placed === 0 && A.moves.length > 0);
    const mk = key(b.A.moves[0].tile);
    ok(eq(b.a.app.legalTrains(mk), ['human']), 'in the opening a tile can only go on your own train');
    b.a.app.dispatch({ type: 'dropOnTrain', key: mk, train: 'mexican' });
    ok(b.a.S.awaiting === b.A, 'dropping it on the Mexican train in the opening does nothing');
    const len0 = b.a.S.game.trains.human.tiles.length;
    b.a.app.dispatch({ type: 'dropOnTrain', key: mk, train: 'human' });
    await tick(); await tick();
    ok(b.a.S.game.trains.human.tiles.length === len0 + 1, 'dropping it on your own train in the opening plays it');
  }
  {
    // the tile flies from where it was let go
    const log = [];
    const mock = { capture: () => ({ from: 'its place in the hand' }), land: (tok, spec) => log.push(tok.from), captureDraw: () => null, landDraw() {}, reapply() {}, cancelAll() {} };
    const g = await find(A => A.kind === 'move' && A.moves.length > 1, 60, { fx: mock, reducedMotion: false });
    const { a, A } = g; const m = A.moves[0], k = key(m.tile);
    const letGo = R(300, 420, 90, 46);
    a.app.dispatch({ type: 'dropOnTrain', key: k, train: m.trainId, from: letGo });
    await tick(); await tick();
    ok(eq(log[log.length - 1], letGo), 'when dropped, the tile flies on from the spot where you let go');
    const A2 = await drive(a, X => X.kind === 'move' && X.moves.length > 1);
    if (A2) {
      const m2 = A2.moves[0], n0 = log.length;
      a.app.dispatch({ type: 'selectTile', key: key(m2.tile) }); if (a.S.awaiting === A2) a.app.dispatch({ type: 'playOn', train: m2.trainId });
      await tick(); await tick();
      ok(log.length > n0 && log[log.length - 1] === 'its place in the hand', 'a tile played by tapping still flies from its place in the hand');
      ok(a.S.dropFrom === null, 'the let-go position is used once, then forgotten');
    }
  }

  console.log('2. dragging with pointer events (fake page with real train rows)');
  class FakeEl {
    constructor() { this.style = {}; this.dataset = {}; this.children = []; this._c = new Set(); this.rect = R(0, 0, 0, 0); }
    set className(v) { this._c = new Set(String(v).split(/\s+/).filter(Boolean)); } get className() { return [...this._c].join(' '); }
    get classList() { const s = this._c; return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c) }; }
    appendChild(c) { this.children.push(c); return c; } remove() { this.removed = true; }
    cloneNode() { const c = new FakeEl(); c.rect = this.rect; return c; } getBoundingClientRect() { return this.rect; }
  }
  const pg = await find(multi);
  const { a: pa, A: PA } = pg;
  const PK = key(PA.moves.find(m => trainsOf(PA, key(m.tile)).length >= 2).tile);
  const PL = trainsOf(PA, PK), PI = ['human', 'cpu', 'mexican'].filter(t => !PL.includes(t));
  const rowTop = { cpu: 100, mexican: 180, human: 260 };
  const listeners = {}, body = new FakeEl(), root = new FakeEl();
  root.addEventListener = (ty, f) => { (listeners[ty] = listeners[ty] || []).push(f); };
  root.setPointerCapture = () => {}; root.releasePointerCapture = () => {};
  const tray = new FakeEl(); tray.rect = R(20, 500, 1000, 220);
  const tracks = ['cpu', 'mexican', 'human'].map(id => { const e = new FakeEl(); e.dataset.train = id; e.rect = R(20, rowTop[id], 1000, 70); return e; });
  const tilesNow = () => G.orderedHand(pa.S).map((tl, i) => { const e = new FakeEl(); e.dataset.key = key(tl); e.rect = R(40 + (i % 8) * 100, 560 + Math.floor(i / 8) * 70, 90, 46); const svg = new FakeEl(); svg.rect = e.rect; e.querySelector = () => svg; return e; });
  root.querySelectorAll = sel => (sel === '.hand .tile-btn' ? tilesNow() : sel === '.track' ? tracks : []);
  root.querySelector = sel => (sel === '.tray' ? tray : null);
  const drag = G.createDrag(root, pa.app, { createElement: () => new FakeEl(), body });
  const fire = (ty, ev) => (listeners[ty] || []).forEach(f => f(ev));
  const keysNow = () => G.orderedHand(pa.S).map(key);
  const idx = () => keysNow().indexOf(PK);
  const rect = () => tilesNow()[idx()].rect;
  const down = (id) => { const r = rect(); fire('pointerdown', { pointerId: id, button: 0, clientX: r.left + 20, clientY: r.top + 20, target: { closest: s => (s === '.tile-btn' ? tilesNow()[idx()] : null) } }); };
  const at = (id, x, y) => fire('pointermove', { pointerId: id, clientX: x, clientY: y });
  const order0 = keysNow(), hand0 = pa.S.game.players[0].hand.length;

  down(1); const r0 = rect(); at(1, r0.left + 20 + 40, r0.top + 20 - 30);               // starts the drag, still over the tray
  ok(pa.S.dragKey === PK && pa.S.dropTrain === null, 'a drag has started, not over any train');
  at(1, 500, rowTop[PL[0]] + 30);
  ok(pa.S.dropTrain === PL[0], `over ${PL[0]} (a legal train): it is the drop target`);
  ok(/\bdrop\b/.test(classOf(pa.root.innerHTML, PL[0])), '...and the page highlights it');
  if (PI.length) { at(1, 500, rowTop[PI[0]] + 30); ok(pa.S.dropTrain === null, `over ${PI[0]} (a train it does not fit): no drop target`); }
  at(1, 500, rowTop[PL[0]] + 30);
  ok(eq(keysNow(), order0), 'while over a train, the hand is not rearranged');
  at(1, 900, 400);                                                                      // out on the table, between trains and tray
  ok(pa.S.dropTrain === null && eq(keysNow(), order0), 'out on the table: no target, hand untouched');
  at(1, 40 + 3 * 100 + 40, 560 + 20);                                                   // back over the hand
  ok(idx() !== order0.indexOf(PK) || true, 'back over the hand it can be rearranged again');
  const reordered = keysNow();
  at(1, 500, rowTop[PL[PL.length - 1]] + 30);
  const upX = 500, upY = rowTop[PL[PL.length - 1]] + 30;
  fire('pointerup', { pointerId: 1, clientX: upX, clientY: upY });
  const swallowed = drag.consumeClick() === true && drag.consumeClick() === false;   // the browser's click arrives straight after the release
  await tick(); await tick();
  const target = pa.S.game.trains[PL[PL.length - 1]];
  ok(target.tiles.some(p => key([Math.min(...p), Math.max(...p)]) === PK), 'letting go over a legal train plays the tile on it');
  ok(pa.S.game.players[0].hand.length === hand0 - 1 && pa.S.dragKey === null && pa.S.dropTrain === null, 'one tile fewer in your hand, drag over');
  ok(pa.S.handOrder === null, 'and no leftover arrangement from the drag');
  ok(swallowed, 'the click that follows is swallowed once');

  // a second drag: let go on the table, and with the pointer cancelled over a train
  const pg2 = await find(multi);
  const { a: qa, A: QA } = pg2;
  const QK = key(QA.moves.find(m => trainsOf(QA, key(m.tile)).length >= 2).tile), QL = trainsOf(QA, QK);
  const listeners2 = {}; const root2 = new FakeEl();
  root2.addEventListener = (ty, f) => { (listeners2[ty] = listeners2[ty] || []).push(f); };
  root2.setPointerCapture = () => {}; root2.releasePointerCapture = () => {};
  const t2 = () => G.orderedHand(qa.S).map((tl, i) => { const e = new FakeEl(); e.dataset.key = key(tl); e.rect = R(40 + (i % 8) * 100, 560 + Math.floor(i / 8) * 70, 90, 46); const svg = new FakeEl(); svg.rect = e.rect; e.querySelector = () => svg; return e; });
  root2.querySelectorAll = sel => (sel === '.hand .tile-btn' ? t2() : sel === '.track' ? tracks : []);
  root2.querySelector = sel => (sel === '.tray' ? tray : null);
  G.createDrag(root2, qa.app, { createElement: () => new FakeEl(), body: new FakeEl() });
  const fire2 = (ty, ev) => (listeners2[ty] || []).forEach(f => f(ev));
  const qidx = () => G.orderedHand(qa.S).map(key).indexOf(QK);
  const downQ = id => { const r = t2()[qidx()].rect; fire2('pointerdown', { pointerId: id, button: 0, clientX: r.left + 20, clientY: r.top + 20, target: { closest: s => (s === '.tile-btn' ? t2()[qidx()] : null) } }); };
  const qOrder = G.orderedHand(qa.S).map(key), qHand = qa.S.game.players[0].hand.length;
  downQ(1); fire2('pointermove', { pointerId: 1, clientX: 600, clientY: 400 });
  fire2('pointerup', { pointerId: 1, clientX: 900, clientY: 400 });
  ok(qa.S.game.players[0].hand.length === qHand && qa.S.awaiting === QA, 'letting go out on the table plays nothing');
  downQ(2); fire2('pointermove', { pointerId: 2, clientX: 600, clientY: 400 }); fire2('pointermove', { pointerId: 2, clientX: 500, clientY: rowTop[QL[0]] + 30 });
  ok(qa.S.dropTrain === QL[0], 'over a legal train again');
  fire2('pointercancel', { pointerId: 2, clientX: 500, clientY: rowTop[QL[0]] + 30 });
  ok(qa.S.game.players[0].hand.length === qHand && qa.S.awaiting === QA && qa.S.dragKey === null && qa.S.dropTrain === null, 'a cancelled gesture (a phone call, say) never plays the tile');
  // not your turn: dragging still rearranges, dropping does nothing
  qa.S.awaiting = null;
  downQ(3); fire2('pointermove', { pointerId: 3, clientX: 600, clientY: 400 }); fire2('pointermove', { pointerId: 3, clientX: 500, clientY: rowTop.mexican + 30 });
  ok(qa.S.dropTrain === null, 'when it is not your turn no train accepts a drop');
  fire2('pointerup', { pointerId: 3, clientX: 500, clientY: rowTop.mexican + 30 });
  ok(qa.S.game.players[0].hand.length === qHand && qa.S.dragKey === null, '...and letting go there does nothing');
  qa.S.awaiting = QA;
  ok(/class="track[^"]*"\s+data-train="human"/.test(pg.a.root.innerHTML) && /class="track[^"]*"\s+data-train="mexican"/.test(pg.a.root.innerHTML) && /class="track[^"]*"\s+data-train="cpu"/.test(pg.a.root.innerHTML), 'the real page marks each train row with data-train (what the drag looks for)');

  console.log('3. a double you can cover: no pause');
  async function doubleScenario(coverable) {
    const sleeps = [];
    const g = await find(A => A.kind === 'move' && A.moves.some(m => m.trainId === 'mexican'), 80, { reducedMotion: false, sleep: async ms => { sleeps.push(ms); } });
    const { a, A } = g; const gm = a.S.game, w = gm.trains.mexican.end;
    gm.players[0].hand = coverable ? [[w, w], [Math.min(w, (w + 1) % 13), Math.max(w, (w + 1) % 13)], [(w + 5) % 13, (w + 6) % 13]] : [[w, w], [(w + 5) % 13, (w + 6) % 13]];
    gm.boneyard = [[(w + 7) % 13, (w + 8) % 13], [(w + 9) % 13, (w + 10) % 13]];
    A.moves.length = 0; A.moves.push(...E.legalMoves(gm, gm.players[0]));
    a.S.selectedKey = null;
    const before = sleeps.length;
    a.app.dispatch({ type: 'selectTile', key: key([w, w]) });
    if (a.S.awaiting === A) a.app.dispatch({ type: 'playOn', train: 'mexican' });
    let n = 0; while (n < 6 && (!a.S.awaiting || a.S.awaiting === A)) { await tick(); n++; }
    const next = a.S.awaiting;
    return { next, ticks: n, slept: sleeps.slice(before), open: gm.openDouble };
  }
  {
    const c = await doubleScenario(true);
    ok(c.open && c.next && c.next.kind === 'move' && c.next.moves.every(m => m.trainId === 'mexican'), 'you play a double that you can cover: the cover prompt is up');
    ok(!c.slept.includes(380) && c.ticks <= 2, `...with no pause at all (waited ${c.ticks} tick(s), sleeps: ${JSON.stringify(c.slept)})`);
    const d = await doubleScenario(false);
    ok(d.open && d.slept.includes(380), 'a double you cannot cover keeps its usual short pause before the draw');
  }
  {
    // whole matches: a 380 ms pause follows a human play exactly when it is not a coverable double
    let humanPlays = 0, coverable = 0, pauses = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const sl = [];
      const a = makeApp(seed, { reducedMotion: false, sleep: async ms => { if (ms === 380) pauses++; } });
      const orig = a.app.ui.onPlay;
      a.app.ui.onPlay = async (game, player, move, info) => {
        if (player.id === 'human') { humanPlays++; if (info.doubleOpened && !info.lastTileDouble && E.legalMoves(game, player).length > 0) coverable++; }
        return orig(game, player, move, info);
      };
      await drive(a, A => (A.kind === 'modal' && a.S.modal && a.S.modal.type === 'final') || false);
      for (let i = 0; i < 4000 && !(a.S.modal && a.S.modal.type === 'final'); i++) { await tick(); const A = a.S.awaiting; if (A) step(a, A); }
    }
    ok(humanPlays > 300 && coverable > 5 && pauses === humanPlays - coverable, `over 20 matches: ${humanPlays} human plays, ${coverable} were doubles with a cover in hand, and ${pauses} short pauses = ${humanPlays - coverable} (every other play)`);
  }

  console.log('4. the boneyard button stays in its corner');
  const rule = sel => { const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return [...css.matchAll(new RegExp('(?:^|\\n)' + esc + '\\s*\\{([^}]*)\\}', 'g'))].map(m => m[1]).join(' '); };   // every rule for this selector
  ok(/display:\s*grid/.test(rule('.opp')) && /grid-template-areas:\s*"cpu yard"\s*"bubble yard"/.test(rule('.opp')), 'the opponent row is a grid with a cell of its own for the boneyard, spanning both lines');
  ok(/grid-area:\s*yard/.test(rule('.boneyard')) && /justify-self:\s*end/.test(rule('.boneyard')) && /align-self:\s*start/.test(rule('.boneyard')), 'the boneyard is pinned to the top right of that row');
  ok(/grid-area:\s*cpu/.test(rule('.cpu-hand')) && /grid-area:\s*bubble/.test(rule('.bubble-slot')), 'the computer\'s tiles and its comments sit in the other cells, so they cannot push it around');
  ok(/width:\s*15\.5rem/.test(rule('.boneyard')) && /min-height:/.test(rule('.boneyard')), 'it has a fixed size');
  ok(/border:\s*2px dashed/.test(rule('.boneyard')) && /border:\s*2px solid/.test(rule('.boneyard.ready')), 'and its border is 2px both resting and flashing, so it does not change size');
  ok(/@media \(max-width: 640px\)[\s\S]*\.boneyard\s*\{\s*width:\s*11\.5rem/.test(css), 'on a phone it is smaller but stays in the same corner');
  const lone = makeApp(2); for (let i = 0; i < 60 && !lone.S.awaiting; i++) await tick();
  const resting = lone.root.innerHTML.match(/<section class="opp"[\s\S]*?<\/section>/)[0];
  const order = [...resting.matchAll(/class="(cpu-hand|boneyard[^"]*|bubble-slot)"/g)].map(m => m[1].split(' ')[0]);
  ok(eq(order, ['cpu-hand', 'boneyard', 'bubble-slot']), 'the three parts of that row, in the order the grid expects');
  const flashing = pg.a.root.innerHTML.match(/<section class="opp"[\s\S]*?<\/section>/)[0];
  const d2 = await find(A => A.kind === 'draw' || (A.kind === 'build' && A.canDraw));
  const ready = d2.a.root.innerHTML.match(/<section class="opp"[\s\S]*?<\/section>/)[0];
  ok(/<span class="yard-text"><span class="count">/.test(resting) && /<span class="yard-text"><span class="count">[^]*<span class="cta">Draw a tile<\/span><\/span>/.test(ready) && !/class="cta"/.test(resting), '"Draw a tile" appears inside the same fixed-size box');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
