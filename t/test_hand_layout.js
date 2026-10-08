require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const tick = () => new Promise(r => setImmediate(r));
const count = (h, s) => h.split(s).length - 1;
const R = (left, top, width, height) => ({ left, top, width, height });

function makeApp(seed) {
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {};
  const app = G.createApp({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, now: () => 1, chatRng: () => 1, nativeChance: 0, foodChance: 0, timer: { set() { return 0; }, clear() {} },
    storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
  return { app, root, S: app.state };
}
const handHtml = h => h.slice(h.indexOf('class="tray"'), h.indexOf('class="log"') > 0 ? h.indexOf('class="log"') : undefined);

(async () => {
  console.log('1. the hand: tiles lie down, in two or more rows');
  const a = makeApp(3);
  for (let i = 0; i < 80 && !a.S.awaiting; i++) await tick();
  const sizes = [1, 2, 3, 4, 5, 8, 12, 15, 16, 17, 20, 30, 40];
  for (const n of sizes) {
    const all = []; for (let x = 0; x <= 12 && all.length < n; x++) for (let y = x; y <= 12 && all.length < n; y++) all.push([x, y]);
    a.S.game.players[0].hand = all.slice(0, n).map(t => t.slice());
    a.app.render(true);
    const h = handHtml(a.root.innerHTML);
    const cols = +(h.match(/--cols:(\d+)/) || [])[1];
    const tiles = count(h, 'class="tile-btn');
    const lying = (h.match(/<svg class="tile h[ "]/g) || []).length, upright = (h.match(/<svg class="tile v[ "]/g) || []).length;
    const rows = Math.ceil((n + 1) / cols);
    ok(tiles === n && lying === n && upright === 0, `${n} tiles: every one lies down (long side horizontal), none stands up`);
    ok(rows >= 2 && cols <= 10 && cols >= 1, `${n} tiles: ${cols} across gives ${rows} rows (never fewer than two, never wider than ten)`);
    ok(/slot-empty|slot-draw/.test(h), `${n} tiles: a spare spot follows the last tile`);
  }
  ok(/\.hand-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill/.test(require('fs').readFileSync('../style.css', 'utf8')), 'on a narrow screen the grid wraps into more rows by itself');
  // a double lies down too
  a.S.game.players[0].hand = [[4, 4], [5, 7]]; a.app.render(true);
  ok(/<svg class="tile h[ "][^>]*aria-label="4 and 4"/.test(a.root.innerHTML), 'a double in the hand lies down like the others');

  console.log('2. drawing from an empty spot in the hand');
  const noDraw = handHtml(a.root.innerHTML);
  ok(!/slot-draw/.test(noDraw) && !/class="hand can-draw"/.test(noDraw) && !/<div class="hand"[^>]*data-action/.test(noDraw), 'when you cannot draw, the spare spot is just empty space and the hand area is not clickable');
  let found = null;
  for (let seed = 1; seed <= 80 && !found; seed++) {
    const b = makeApp(seed);
    for (let g = 0; g < 4000 && !found; g++) {
      await tick();
      const A = b.S.awaiting; if (!A) continue;
      if (A.kind === 'draw' || (A.kind === 'build' && A.canDraw)) { found = b; break; }
      if (A.kind === 'build') { if (A.canBuild) b.app.dispatch({ type: 'autoBuild' }); else if (A.canDone) b.app.dispatch({ type: 'endBuild' }); else b.app.dispatch({ type: 'undoTile' }); }
      else if (A.kind === 'modal') b.app.dispatch({ type: 'dialogOk' });
      else { const m = A.moves[0]; b.app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (b.S.awaiting === A) b.app.dispatch({ type: 'playOn', train: m.trainId }); }
    }
  }
  ok(!!found, 'found a moment when the only move is to draw');
  const hd = handHtml(found.root.innerHTML);
  ok(/<button class="slot-draw" data-action="draw"[^>]*aria-label="Draw a tile from the boneyard"/.test(hd), 'the spare spot becomes a Draw button (a real, focusable button)');
  ok(/<div class="hand can-draw" data-action="draw">/.test(hd), 'and clicking anywhere on the empty part of the hand draws as well');
  ok(count(hd, 'data-action="draw"') === 2 && count(hd, 'data-action="selectTile"') === found.S.game.players[0].hand.length, 'tiles themselves still do their own thing (clicking one does not draw)');
  ok(/boneyard ready/.test(found.root.innerHTML), 'the boneyard button is still flashing too');
  const before = found.S.game.players[0].hand.length, A0 = found.S.awaiting;
  found.app.dispatch({ type: 'draw' });                                        // what either click sends
  for (let i = 0; i < 30; i++) await tick();
  ok(found.S.game.players[0].hand.length === before + 1 || found.S.awaiting !== A0, 'clicking it draws a tile');

  console.log('3. flight geometry from a tile lying in the hand');
  const A = 204 / 104;
  const lying = (l, t, s) => R(l, t, s * A, s), up = (l, t, s) => R(l, t, s, s * A);
  function corners(to, g) {
    const cx = to.left + to.width / 2, cy = to.top + to.height / 2, c = Math.cos(g.rotate * Math.PI / 180), s = Math.sin(g.rotate * Math.PI / 180);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const x = u * to.width / 2 * g.scale, y = v * to.height / 2 * g.scale; return [cx + g.dx + (x * c - y * s), cy + g.dy + (x * s + y * c)]; });
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return R(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }
  const handTile = lying(100, 600, 46), board = lying(300, 200, 44), dbl = up(300, 180, 44), phone = lying(12, 330, 27), handPhone = lying(20, 640, 36);
  const cases = [['lying -> lying (matches as is)', handTile, board, 0], ['lying -> lying, flipped', handTile, board, 180], ['lying -> standing double', handTile, dbl, 90], ['phone sizes', handPhone, phone, 180]];
  for (const [name, from, to, rot] of cases) {
    const m = corners(to, G.flightGeometry(from, to, rot));
    ok(near(m.left, from.left) && near(m.top, from.top) && near(m.width, from.width) && near(m.height, from.height), `${name}: at the start the flying tile exactly covers the tile in the hand`);
  }
  // which number ends up on the left while flying: a hand tile shows its LOWER number on the left
  const leftOf = (to, g) => { const c = Math.cos(g.rotate * Math.PI / 180), s = Math.sin(g.rotate * Math.PI / 180); const pt = side => ({ x: to.left + to.width / 2 + g.dx + (side * to.width / 4 * g.scale * c), y: to.top + to.height / 2 + g.dy + (side * to.width / 4 * g.scale * s) }); return pt(-1).x < pt(1).x ? 'placed[0]' : 'placed[1]'; };
  for (const placed of [[5, 7], [3, 9], [0, 12], [7, 5], [9, 3], [12, 0]]) {
    const g = G.flightGeometry(handTile, board, G.flightRotation(placed, true));
    ok(placed[leftOf(board, g) === 'placed[0]' ? 0 : 1] === Math.min(...placed), `placed [${placed}]: the lower number is on the left while flying, as in the hand`);
  }
  ok(G.flightRotation([5, 7], true) === 0 && G.flightRotation([7, 5], true) === 180 && G.flightRotation([6, 6], true) === 90, 'from a lying tile: 0 degrees, 180 if the high end matched first, 90 for a double');
  ok(G.flightRotation([5, 7], false) === 90 && G.flightRotation([7, 5], false) === -90 && G.flightRotation([6, 6], false) === 0 && G.flightRotation([5, 7]) === 90, 'from a standing tile (the computer\'s): as before');
  ok(near(G.flightGeometry(handTile, board, 0).scale, handTile.width / board.width) && near(G.flightGeometry(handTile, dbl, 90).scale, handTile.width / dbl.height), 'the scale compares long sides');

  console.log('4. dropping into a row');
  const rows2 = n => Array.from({ length: n }, (_, i) => R(20 + (i % 8) * 100, 600 + Math.floor(i / 8) * 70, 90, 46));
  const r13 = rows2(13);                                   // 8 in row one, 5 in row two
  ok(G.dropIndexAt(r13, 65, 625, 0) === 0 && G.dropIndexAt(r13, 150, 695, 0) === 9, 'over a tile in either row: that tile');
  ok(G.dropIndexAt(r13, 800, 695, 2) === 12, 'past the end of a short row, from an earlier tile: the end of that row');
  ok(G.dropIndexAt(r13, 800, 695, 12) === 12, 'already at the end: no change');
  ok(G.dropIndexAt(r13, 830, 625, 11) === 8, 'beyond the right edge of a full row, from a later row: just after its last tile (it wraps to the next row)');
  ok(G.dropIndexAt(r13, 400, 900, 0) === 11, 'far below everything: the nearest row (the last), at the nearest tile');
  ok(G.dropIndexAt(r13, 900, 900, 0) === 12, 'far below and to the right: the end of the last row');
  ok(G.dropIndexAt(r13, 400, 400, 12) === 3, 'above everything: the nearest row (the first), at the nearest tile');
  ok(G.dropIndexAt(r13, 10, 625, 5) === 0, 'left of a row: its first tile');
  const raised = r13.map((r, i) => (i === 3 ? R(r.left, r.top - 16, r.width, r.height) : r));       // a selected tile sits higher
  ok(G.dropIndexAt(raised, 365, 600, 0) === 3 && G.dropIndexAt(raised, 465, 625, 0) === 4, 'a raised or selected tile is still part of its row (and its neighbours are found correctly)');
  ok(G.dropIndexAt([], 0, 0, 0) === -1 && G.dropIndexAt([R(0, 0, 90, 46)], 500, 500, 0) === 0, 'edge cases: no tiles, one tile');
  // in a single row it behaves exactly as before
  const one = Array.from({ length: 6 }, (_, i) => R(20 + i * 100, 600, 90, 46));
  ok([0, 1, 2, 3, 4, 5].every(i => G.dropIndexAt(one, 65 + i * 100, 620, 0) === i), 'a single row: the tile under the pointer');

  console.log('5. dragging a tile into the second row (pointer events on a fake page)');
  class FakeEl {
    constructor() { this.style = {}; this.dataset = {}; this.children = []; this._c = new Set(); this.rect = R(0, 0, 0, 0); }
    set className(v) { this._c = new Set(String(v).split(/\s+/).filter(Boolean)); } get className() { return [...this._c].join(' '); }
    get classList() { const s = this._c; return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c) }; }
    appendChild(c) { this.children.push(c); return c; } remove() { this.removed = true; }
    cloneNode() { const c = new FakeEl(); c.rect = this.rect; return c; } getBoundingClientRect() { return this.rect; }
  }
  const t = makeApp(12);
  for (let i = 0; i < 80 && !t.S.awaiting; i++) await tick();
  const listeners = {}, body = new FakeEl();
  const root = new FakeEl();
  root.addEventListener = (ty, f) => { (listeners[ty] = listeners[ty] || []).push(f); };
  root.setPointerCapture = () => {}; root.releasePointerCapture = () => {};
  const tilesNow = () => G.orderedHand(t.S).map((tl, i) => { const e = new FakeEl(); e.dataset.key = key(tl); e.rect = R(20 + (i % 8) * 100, 600 + Math.floor(i / 8) * 70, 90, 46); const svg = new FakeEl(); svg.rect = e.rect; e.querySelector = () => svg; return e; });
  root.querySelectorAll = sel => (sel === '.hand .tile-btn' ? tilesNow() : []);
  G.createDrag(root, t.app, { createElement: () => new FakeEl(), body });
  const fire = (ty, ev) => (listeners[ty] || []).forEach(f => f(ev));
  const keys = () => G.orderedHand(t.S).map(key);
  const start = keys(), n = start.length;                       // 15 tiles: 8 in row one, 7 in row two
  fire('pointerdown', { pointerId: 1, button: 0, clientX: 65, clientY: 620, target: { closest: s => (s === '.tile-btn' ? tilesNow()[0] : null) } });
  fire('pointermove', { pointerId: 1, clientX: 90, clientY: 650 });
  fire('pointermove', { pointerId: 1, clientX: 20 + 8 * 100 - 60 + 40, clientY: 695 });   // over the last tile of the second row
  ok(keys()[n - 1] === start[0] && keys().slice(0, n - 1).join() === start.slice(1).join(), 'dragged from the first row to the second row\'s last place');
  fire('pointermove', { pointerId: 1, clientX: 65 + 3 * 100, clientY: 695 });             // over the 4th tile of row two
  ok(keys().indexOf(start[0]) === 8 + 3, 'moved along the second row to the fourth place of that row');
  fire('pointermove', { pointerId: 1, clientX: 20 + 7 * 100 + 45, clientY: 620 });         // over the last tile of the first row
  ok(keys().indexOf(start[0]) === 7, 'and back up into the first row');
  fire('pointerup', { pointerId: 1, clientX: 20 + 7 * 100 + 45, clientY: 620 });
  ok(t.S.dragKey === null && keys().indexOf(start[0]) === 7 && new Set(keys()).size === n, 'dropped: it stays where it was left, nothing lost or duplicated');
  // drag to the empty end of a short row
  const mid = keys();
  fire('pointerdown', { pointerId: 2, button: 0, clientX: 65, clientY: 620, target: { closest: s => (s === '.tile-btn' ? tilesNow()[0] : null) } });
  fire('pointermove', { pointerId: 2, clientX: 100, clientY: 640 });
  fire('pointermove', { pointerId: 2, clientX: 20 + 7 * 100 + 45, clientY: 695 });         // beyond the seven tiles of row two? (cell 8 of row two is empty space)
  fire('pointerup', { pointerId: 2, clientX: 20 + 7 * 100 + 45, clientY: 695 });
  ok(keys().indexOf(mid[0]) === n - 1 && new Set(keys()).size === n, 'dropped in the empty spot at the end of the second row: it goes to the end of that row');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
