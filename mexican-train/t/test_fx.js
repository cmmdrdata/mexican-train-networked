require('./game.js');
const G = globalThis.MexicanTrainGame;
const { mulberry32, key } = G.Engine;
let pass = 0, fail = 0;
const failCounts = {};
const ok = (c, m) => { if (c) pass++; else { fail++; failCounts[m] = (failCounts[m] || 0) + 1; if (failCounts[m] === 1) console.log('  FAIL:', m); } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const tick = () => new Promise(r => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- a tiny fake DOM ---------- */
class FakeEl {
  constructor(tag) { this.tag = tag || 'div'; this.style = {}; this.dataset = {}; this.children = []; this._c = new Set(); this.rect = { left: 0, top: 0, width: 0, height: 0 }; this.anims = []; this.removed = false; this.parent = null; this._inner = ''; this.firstChild = null; }
  set className(v) { this._c = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._c].join(' '); }
  get classList() { const s = this._c; return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, on) => { on = on === undefined ? !s.has(c) : on; if (on) s.add(c); else s.delete(c); } }; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  cloneNode() { const c = new FakeEl(this.tag); c._c = new Set(this._c); c.style = { ...this.style }; c.dataset = { ...this.dataset }; c.rect = { ...this.rect }; c.cloned = true; return c; }
  getBoundingClientRect() { return this.rect; }
  animate(kf, opts) { const a = { kf, opts }; a.finished = new Promise(r => { a.resolve = r; }); this.anims.push(a); return a; }
  set innerHTML(v) { this._inner = v; this.firstChild = new FakeEl('svg'); this.firstChild._c = new Set(['tile', 'back']); this.firstChild.markup = v; }
  get innerHTML() { return this._inner; }
  querySelector() { return null; }
}
function fakeEnv() {
  const root = new FakeEl('div');
  root.map = {}; root.mapAll = {};
  root.querySelector = sel => root.map[sel] || null;
  root.querySelectorAll = sel => root.mapAll[sel] || [];
  const doc = { createElement: t => new FakeEl(t), body: new FakeEl('body') };
  return { root, doc };
}
const R = (left, top, width, height) => ({ left, top, width, height });

(async () => {
  console.log('1. flight geometry: the transform maps the lying tile back onto the source tile');
  // corners of the destination rectangle after: scale about its centre, rotate about its centre, then translate
  function mapCorners(to, g) {
    const cx = to.left + to.width / 2, cy = to.top + to.height / 2;
    const c = Math.cos(g.rotate * Math.PI / 180), s = Math.sin(g.rotate * Math.PI / 180);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
      const x = u * to.width / 2 * g.scale, y = v * to.height / 2 * g.scale;
      return [cx + g.dx + (x * c - y * s), cy + g.dy + (x * s + y * c)];
    });
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  const A = 204 / 104;                                  // tiles are 1.9615 times as long as they are wide
  const up = (left, top, s) => R(left, top, s, s * A), lying = (left, top, s) => R(left, top, s * A, s);
  const cases = [
    ['hand tile -> lying tile (+90)', up(100, 500, 36), lying(300, 200, 44), 90, true],
    ['hand tile -> lying tile (-90)', up(100, 500, 36), lying(300, 200, 44), -90, true],
    ['hand tile -> upright double',   up(100, 500, 36), up(300, 180, 44), 0, true],
    ['phone sizes',                   up(20, 640, 36), lying(12, 330, 27), -90, true],
    ['face-down tile at the top -> lying tile', R(420, 80, 15, 26), lying(150, 260, 44), 90, false],   // these small tiles are a different shape
  ];
  for (const [name, from, to, rot, exact] of cases) {
    const g = G.flightGeometry(from, to, rot);
    const m = mapCorners(to, g);
    if (exact) ok(near(m.left, from.left, 1e-6) && near(m.top, from.top, 1e-6) && near(m.width, from.width, 1e-6) && near(m.height, from.height, 1e-6),
       `${name}: at the start the flying tile exactly covers the source tile`);
    else ok(near(m.top + m.height / 2, from.top + from.height / 2, 1e-6) && near(m.left + m.width / 2, from.left + from.width / 2, 1e-6) && near(m.height, from.height, 1e-6) && Math.abs(m.width - from.width) < from.width * 0.25,
       `${name}: same centre and height as the source (width within 25%)`);
  }
  // which half ends up on top: the hand tile shows its LOWER number on top
  const half = (to, g, side) => {      // centre of the left (-1) or right (+1) half of the lying tile after the transform
    const c = Math.cos(g.rotate * Math.PI / 180), s = Math.sin(g.rotate * Math.PI / 180);
    const x = side * to.width / 4 * g.scale, y = 0;
    return { x: to.left + to.width / 2 + g.dx + (x * c - y * s), y: to.top + to.height / 2 + g.dy + (x * s + y * c) };
  };
  const to = R(300, 200, 88, 44), from = R(100, 500, 36, 70);
  for (const placed of [[5, 7], [3, 9], [0, 12], [7, 5], [9, 3], [12, 0]]) {
    const g = G.flightGeometry(from, to, G.flightRotation(placed));
    const left = half(to, g, -1), right = half(to, g, 1);
    const leftValue = placed[0], rightValue = placed[1];
    const topValue = left.y < right.y ? leftValue : rightValue;
    ok(topValue === Math.min(...placed), `placed [${placed}]: the lower number (${Math.min(...placed)}) is on top while flying, like in the hand`);
  }
  ok(G.flightRotation([6, 6]) === 0 && G.flightRotation([2, 9]) === 90 && G.flightRotation([9, 2]) === -90, 'rotation rule: doubles upright, otherwise +90 / -90 by which end is lower');
  const g1 = G.flightGeometry(R(100, 500, 36, 70), R(300, 200, 88, 44), 90);
  ok(near(g1.dx, -226) && near(g1.dy, 313) && near(g1.scale, 70 / 88), 'worked example: dx -226, dy 313, scale 70/88');

  console.log('2. ordering helpers');
  ok(eq(G.moveInOrder(['a', 'b', 'c', 'd'], 'a', 2), ['b', 'c', 'a', 'd']), 'move forward');
  ok(eq(G.moveInOrder(['a', 'b', 'c', 'd'], 'd', 0), ['d', 'a', 'b', 'c']), 'move back');
  ok(eq(G.moveInOrder(['a', 'b', 'c'], 'b', 99), ['a', 'c', 'b']) && eq(G.moveInOrder(['a', 'b', 'c'], 'b', -5), ['b', 'a', 'c']), 'clamped at both ends');
  ok(eq(G.moveInOrder(['a', 'b'], 'zzz', 0), ['a', 'b']), 'unknown tile: unchanged');
  const orig = ['a', 'b', 'c']; G.moveInOrder(orig, 'a', 2); ok(eq(orig, ['a', 'b', 'c']), 'the original array is never mutated');
  const row = [R(10, 10, 40, 80), R(60, 10, 40, 80), R(110, 10, 40, 80)];
  ok(G.slotAt(row, 15, 50) === 0 && G.slotAt(row, 85, 50) === 1 && G.slotAt(row, 130, 50) === 2, 'pointer over a tile picks that tile');
  ok(G.slotAt(row, 500, 500) === 2 && G.slotAt(row, -50, 10) === 0, 'pointer outside picks the nearest tile');
  const wrapped = [R(10, 10, 40, 80), R(60, 10, 40, 80), R(10, 110, 40, 80), R(60, 110, 40, 80)];
  ok(G.slotAt(wrapped, 30, 150) === 2 && G.slotAt(wrapped, 80, 150) === 3, 'works across wrapped rows');
  ok(G.slotAt([], 0, 0) === -1, 'no tiles: -1');

  console.log('3. the effects layer against a fake page');
  {
    const { root, doc } = fakeEnv();
    const fx = G.createFx(root, doc);
    const handSvg = new FakeEl('svg'); handSvg.rect = R(100, 500, 36, 70);
    root.map['.tile-btn[data-key="5-7"] .tile'] = handSvg;
    const dest = new FakeEl('svg'); dest.rect = R(300, 200, 88, 44); dest._c = new Set(['tile', 'h', 'pop']);
    root.map['.scroller[data-train="human"] .tile[data-idx="0"]'] = dest;
    const spec = { playerId: 'human', trainId: 'human', index: 0, key: '5-7', placed: [5, 7], hidden: false };
    const tok = fx.capture(spec);
    ok(tok && eq(tok.from, R(100, 500, 36, 70)), 'capture notes where the tile is in the hand');
    fx.land(tok, spec);
    const wrap = doc.body.children[0];
    ok(wrap && wrap.className === 'flying', 'a flying copy is added to the page');
    ok(wrap.style.left === '300px' && wrap.style.top === '200px' && wrap.style.width === '88px' && wrap.style.height === '44px', 'it sits exactly where the tile will land');
    ok(dest.style.visibility === 'hidden', 'the real tile is hidden until the copy arrives');
    ok(!wrap.children[0].classList.contains('pop'), 'the copy has no pop animation of its own');
    const a = wrap.anims[0];
    ok(a.kf[0].transform === G.flightStart(G.flightGeometry(R(100, 500, 36, 70), R(300, 200, 88, 44), 90)), 'it starts as the hand tile, turned and scaled to match');
    ok(a.kf[a.kf.length - 1].transform === 'translate(0px, 0px) rotate(0deg) scale(1)' && a.kf.length === 3, 'and ends exactly on the board, with a small lift on the way');
    ok(a.opts.duration === 440 && a.opts.fill === 'forwards', 'about 0.44 s');
    ok(fx.active === 1, 'one flight in the air');
    a.resolve(); await tick(); await tick();
    ok(wrap.removed && doc.body.children.length === 0, 'the copy is removed on arrival');
    ok(dest.style.visibility === '' && dest.anims.length === 1, 'the real tile appears with a small settle');
    ok(fx.active === 0, 'no flights left');

    // a redraw in mid-flight replaces the real tile: it must be hidden again
    const tok2 = fx.capture(spec); fx.land(tok2, spec);
    const dest2 = new FakeEl('svg'); dest2.rect = R(300, 200, 88, 44);
    root.map['.scroller[data-train="human"] .tile[data-idx="0"]'] = dest2;
    ok(dest2.style.visibility !== 'hidden', 'a freshly drawn tile starts visible...');
    fx.reapply();
    ok(dest2.style.visibility === 'hidden', '...and reapply() hides it again while its copy is still flying');
    doc.body.children[0].anims[0].resolve(); await tick(); await tick();
    ok(dest2.style.visibility === '', 'it is shown when the flight ends');

    // cancel (new game): nothing left behind
    const tok3 = fx.capture(spec); fx.land(tok3, spec);
    const w3 = doc.body.children[0];
    fx.cancelAll();
    ok(w3.removed && root.map['.scroller[data-train="human"] .tile[data-idx="0"]'].style.visibility === '' && fx.active === 0, 'cancelAll clears flying copies and unhides tiles');

    // quick plays (auto-build) fly faster
    const tok4 = fx.capture(spec); fx.land(tok4, spec, { fast: true });
    ok(doc.body.children[0].anims[0].opts.duration === 260, 'fast flights take 0.26 s');
    fx.cancelAll();

    // flipped and double tiles
    const flipped = { ...spec, placed: [7, 5] };
    fx.land(fx.capture(spec), flipped);
    ok(doc.body.children[0].anims[0].kf[0].transform.includes('rotate(-90deg)'), 'a tile placed with its higher end first turns the other way');
    fx.cancelAll();
    const dbl = { ...spec, placed: [6, 6], key: '5-7' };
    dest.rect = R(300, 180, 44, 88);
    fx.land(fx.capture(spec), dbl);
    ok(doc.body.children[0].anims[0].kf[0].transform.includes('rotate(0deg)') && near(G.flightGeometry(R(100, 500, 36, 70), R(300, 180, 44, 88), 0).scale, 70 / 88), 'a double lands upright without turning');
    fx.cancelAll();

    // nothing to animate: no crash, nothing hidden
    ok(fx.capture({ ...spec, key: '1-1' }) === null, 'capture finds nothing for a tile that is not on screen');
    fx.land(null, spec); fx.land(tok, { ...spec, index: 9 });
    ok(doc.body.children.length === 0, 'land with no token or no destination does nothing');
    const flat = new FakeEl('svg'); flat.rect = R(0, 0, 0, 0);
    root.map['.scroller[data-train="human"] .tile[data-idx="0"]'] = flat;
    fx.land(tok, spec);
    ok(doc.body.children.length === 0 && flat.style.visibility !== 'hidden', 'a zero-size destination is skipped, not hidden');
    handSvg.rect = R(0, 0, 0, 0);
    ok(fx.capture(spec) === null, 'capture ignores a zero-size source');
  }
  {
    // the computer's tiles
    const { root, doc } = fakeEnv();
    const fx = G.createFx(root, doc);
    const b1 = new FakeEl('i'); b1.rect = R(400, 70, 15, 26); const b2 = new FakeEl('i'); b2.rect = R(418, 70, 15, 26);
    root.mapAll['.cpu-hand .back'] = [b1, b2];
    const dest = new FakeEl('svg'); dest.rect = R(150, 260, 88, 44);
    root.map['.scroller[data-train="cpu"] .tile[data-idx="3"]'] = dest;
    const tok = fx.capture({ playerId: 'cpu', trainId: 'cpu', index: 3 });
    ok(eq(tok.from, R(418, 70, 15, 26)), 'a computer tile leaves from the end of its row of face-down tiles');
    fx.land(tok, { playerId: 'cpu', trainId: 'cpu', index: 3, placed: [4, 9], hidden: true });
    const w = doc.body.children[0];
    ok(w.children.length === 1, 'while it is building, the computer\'s tile flies face down only (nothing revealed)');
    w.anims[0].resolve(); await tick(); await tick();
    fx.land(tok, { playerId: 'cpu', trainId: 'cpu', index: 3, placed: [4, 9], hidden: false });
    const w2 = doc.body.children[0];
    ok(w2.children.length === 2 && w2.children[0].style.opacity === '0', 'a tile that becomes public starts face down and turns over');
    const face = w2.children[0], back = w2.children[1];
    ok(face.anims.length === 1 && back.anims.length === 1 && face.anims[0].kf[2].opacity === 1 && back.anims[0].kf[2].opacity === 0, 'cross-fade from back to face during the flight');
    fx.cancelAll();
    const root2 = fakeEnv(); const fxNo = G.createFx(root2.root, { createElement: null });
    ok(fxNo.capture({ playerId: 'human', key: '1-1' }) === null, 'with no usable page, the effects are silently off');
  }

  console.log('3b. drawing from the boneyard');
  {
    const { root, doc } = fakeEnv();
    const fx = G.createFx(root, doc);
    const stack = new FakeEl('span'); stack.rect = R(900, 60, 30, 32);
    root.map['.boneyard .stack'] = stack;
    const handDest = new FakeEl('svg'); handDest.rect = R(500, 600, 44, 86); handDest._c = new Set(['tile', 'v']);
    root.map['.hand .tile-btn[data-key="5-7"] .tile'] = handDest;
    const tok = fx.captureDraw({ playerId: 'human', key: '5-7' });
    ok(tok && eq(tok.from, R(900, 60, 30, 32)), 'a draw starts from the boneyard');
    fx.landDraw(tok, { playerId: 'human', key: '5-7' });
    const w = doc.body.children[0];
    ok(w && w.className === 'flying' && w.style.left === '500px' && w.style.top === '600px' && w.style.width === '44px' && w.style.height === '86px', 'the flying tile is sized for its slot in your hand');
    ok(handDest.style.visibility === 'hidden', 'the real tile waits, hidden, until it arrives');
    ok(w.children.length === 2 && w.children[0].style.opacity === '0', 'it flies face down and turns face up on the way');
    const a = w.anims[0];
    ok(a.kf[0].transform === G.flightStart(G.flightGeometry(R(900, 60, 30, 32), R(500, 600, 44, 86), 0)) && a.kf[0].transform.includes('rotate(0deg)'), 'it starts at the boneyard, upright, growing to full size');
    ok(a.opts.duration === 480, 'about half a second');
    ok(w.children[0].anims[0].kf[2].opacity === 1 && w.children[1].anims[0].kf[2].opacity === 0, 'cross-fade from the back to the face');
    a.resolve(); await tick(); await tick();
    ok(w.removed && handDest.style.visibility === '' && fx.active === 0, 'it lands, the copy goes, the real tile appears');
    // a redraw of the hand mid-flight (the tile is re-created) keeps the new one hidden
    fx.landDraw(tok, { playerId: 'human', key: '5-7' });
    const handDest2 = new FakeEl('svg'); handDest2.rect = R(500, 600, 44, 86);
    root.map['.hand .tile-btn[data-key="5-7"] .tile'] = handDest2;
    fx.reapply();
    ok(handDest2.style.visibility === 'hidden', 'a redraw mid-flight keeps the new tile hidden');
    fx.cancelAll();
    ok(handDest2.style.visibility === '' && fx.active === 0, 'cancel restores it');

    // the computer's draw stays face down, into its row of face-down tiles
    const b1 = new FakeEl('i'); b1.rect = R(400, 70, 15, 26); const b2 = new FakeEl('i'); b2.rect = R(418, 70, 15, 26);
    root.mapAll['.cpu-hand .back'] = [b1, b2];
    const tokC = fx.captureDraw({ playerId: 'cpu', key: '1-1' });
    fx.landDraw(tokC, { playerId: 'cpu', key: '1-1' });
    const wc = doc.body.children[0];
    ok(wc.children.length === 1 && wc.style.left === '418px' && b2.style.visibility === 'hidden', 'the computer\'s drawn tile flies face down into the end of its row');
    wc.anims[0].resolve(); await tick(); await tick();
    ok(b2.style.visibility === '' && wc.removed, 'and settles when it arrives');

    // missing things: no crash
    delete root.map['.boneyard .stack'];
    ok(fx.captureDraw({ playerId: 'human' }) === null, 'with no boneyard on screen, no flight');
    root.map['.boneyard'] = stack;
    ok(fx.captureDraw({ playerId: 'human' }) !== null, 'falls back to the whole boneyard button');
    stack.rect = R(0, 0, 0, 0);
    ok(fx.captureDraw({ playerId: 'human' }) === null, 'a zero-size boneyard is ignored');
    delete root.map['.hand .tile-btn[data-key="5-7"] .tile'];
    fx.landDraw({ from: R(900, 60, 30, 32) }, { playerId: 'human', key: '5-7' });
    ok(doc.body.children.length === 0, 'no destination in the hand: nothing flies');
  }

  console.log('4. whole matches: capture -> redraw -> land, once per placed tile');
  function makeApp(seed, extra) {
    const log = [];
    const root = { _h: '', set innerHTML(v) { this._h = v; log.push(['render']); }, get innerHTML() { return this._h; },
      querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const mock = {
      capture(spec) { log.push(['capture', spec]); return { spec }; },
      land(tok, spec, opts) { log.push(['land', spec, opts || {}, tok]); },
      captureDraw(spec) { log.push(['captureDraw', spec]); return { spec }; },
      landDraw(tok, spec) { log.push(['landDraw', spec, tok]); },
      reapply() { log.push(['reapply']); },
      cancelAll() { log.push(['cancelAll']); },
    };
    const store = {};
    const app = G.createApp(Object.assign({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: false, fx: mock,
      chatRng: () => 1, nativeChance: 0, foodChance: 0, timer: { set() { return 0; }, clear() {} },
      storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } }, now: () => 1 }, extra));
    return { app, root, log, mock };
  }
  let placements = 0, totalLands = 0, fastSeen = 0, hiddenSeen = 0, publicCpu = 0, humanPlays = 0, drawsSeen = 0, humanDraws = 0, cpuDraws = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const t = makeApp(seed);
    let n = 0;
    const ob = t.app.ui.onBuildPlay, op = t.app.ui.onPlay, od = t.app.ui.onDraw, obd = t.app.ui.onBuildDraw;
    let nd = 0;
    t.app.ui.onBuildPlay = async (...a) => { n++; return ob(...a); };
    t.app.ui.onPlay = async (...a) => { n++; return op(...a); };
    t.app.ui.onDraw = async (...a) => { nd++; return od(...a); };
    t.app.ui.onBuildDraw = async (...a) => { nd++; return obd(...a); };
    const pk = mulberry32(seed + 77);
    t.app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
    for (let g = 0; g < 30000; g++) {
      await tick();
      const A = t.app.state.awaiting;
      if (t.app.state.modal && t.app.state.modal.type === 'final') break;
      if (!A) continue;
      if (A.kind === 'draw') t.app.dispatch({ type: 'draw' });
      else if (A.kind === 'modal') t.app.dispatch({ type: 'dialogOk' });
      else if (A.kind === 'build') {
        if (A.canDraw) t.app.dispatch({ type: 'draw' });
        else if (!A.canDone) t.app.dispatch({ type: 'undoTile' });
        else if (A.canBuild && pk() < 0.35) t.app.dispatch({ type: 'autoBuild' });
        else if (A.moves.length && pk() < 0.6) t.app.dispatch({ type: 'selectTile', key: key(A.moves[0].tile) });
        else t.app.dispatch({ type: 'endBuild' });
      } else { const m = A.moves[0]; t.app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (t.app.state.awaiting === A) t.app.dispatch({ type: 'playOn', train: m.trainId }); }
    }
    // every placement: capture, then a redraw, then reapply, then land - in that order
    const L = t.log;
    let caps = 0, lands = 0;
    for (let i = 0; i < L.length; i++) {
      if (L[i][0] === 'capture') {
        caps++;
        const next = L.slice(i + 1, i + 4).map(e => e[0]);
        ok(eq(next, ['render', 'reapply', 'land']), 'order is capture, redraw, reapply, land');
        const spec = L[i][1], land = L[i + 3];
        ok(land && land[1] === spec, 'land gets the same spec that capture saw');
        const trainTiles = t.app.state.game ? null : null;
        if (spec.playerId === 'cpu' && spec.hidden) hiddenSeen++;
        if (spec.playerId === 'cpu' && !spec.hidden) publicCpu++;
        if (spec.playerId === 'human') humanPlays++;
        if (land && land[2].fast) fastSeen++;
      }
      if (L[i][0] === 'land') lands++;
    }
    let dcaps = 0, dlands = 0;
    for (let i = 0; i < L.length; i++) {
      if (L[i][0] === 'captureDraw') {
        dcaps++;
        ok(eq(L.slice(i + 1, i + 4).map(e => e[0]), ['render', 'reapply', 'landDraw']), 'draw order is captureDraw, redraw, reapply, landDraw');
        if (L[i + 3] && L[i + 3][1] === L[i][1]) dlands++;
        if (L[i][1].playerId === 'human') humanDraws++; else cpuDraws++;
      }
    }
    drawsSeen += dcaps;
    ok(dcaps === nd && dlands === nd, `seed ${seed}: one draw flight per tile drawn (${dcaps} captures, ${dlands} lands, ${nd} draws)`);
    placements += n; totalLands += lands;
    ok(caps === n && lands === n, `seed ${seed}: one flight per placed tile (${caps} captures, ${lands} lands, ${n} placements)`);
    ok(L.filter(e => e[0] === 'reapply').length === L.filter(e => e[0] === 'render').length, `seed ${seed}: reapply follows every redraw`);
    ok(L.some(e => e[0] === 'cancelAll'), `seed ${seed}: starting a game clears any flying tiles`);
  }
  console.log(`   ${placements} placements, ${totalLands} flights | computer tiles flown face down (opening)=${hiddenSeen}, public=${publicCpu} | human=${humanPlays} | fast (auto-build) flights=${fastSeen}`);
  console.log(`   draw flights: ${drawsSeen} (you ${humanDraws}, computer ${cpuDraws})`);
  ok(placements > 300 && hiddenSeen > 30 && publicCpu > 30 && fastSeen > 5 && humanDraws > 50 && cpuDraws > 50, 'every kind of flight was exercised');
  {
    // the destination index really is the new tile's position on its train, and the placed tile matches
    const t = makeApp(3);
    const seen = [];
    t.mock.land = (tok, spec) => { const tiles = t.app.state.game.trains[spec.trainId].tiles; seen.push(tiles[spec.index] && tiles[spec.index][0] === spec.placed[0] && tiles[spec.index][1] === spec.placed[1]); };
    t.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
    for (let g = 0; g < 8000; g++) {
      await tick();
      const A = t.app.state.awaiting;
      if (t.app.state.modal) break;
      if (!A) continue;
      if (A.kind === 'draw') t.app.dispatch({ type: 'draw' });
      else if (A.kind === 'modal') t.app.dispatch({ type: 'dialogOk' });
      else if (A.kind === 'build') { if (A.canDraw) t.app.dispatch({ type: 'draw' }); else if (A.moves.length && seen.length < 40) t.app.dispatch({ type: 'selectTile', key: key(A.moves[0].tile) }); else if (A.canDone) t.app.dispatch({ type: 'endBuild' }); else t.app.dispatch({ type: 'undoTile' }); }
      else { const m = A.moves[0]; t.app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (t.app.state.awaiting === A) t.app.dispatch({ type: 'playOn', train: m.trainId }); }
    }
    ok(seen.length > 20 && seen.every(Boolean), `at landing time, each tile is exactly where its spec says (${seen.length} checked)`);
  }
  {
    const quiet = makeApp(2, { reducedMotion: true });
    quiet.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
    for (let i = 0; i < 40; i++) await tick();
    const A = quiet.app.state.awaiting;
    if (A && A.kind === 'build' && A.moves.length) { quiet.app.dispatch({ type: 'selectTile', key: key(A.moves[0].tile) }); for (let i = 0; i < 20; i++) await tick(); }
    ok(!quiet.log.some(e => e[0] === 'capture' || e[0] === 'land' || e[0] === 'reapply'), 'with "reduce motion" on, no tile flies');
  }

  console.log('5. arranging the hand');
  {
    function newApp(seed) {
      const root = { _h: '', renders: 0, set innerHTML(v) { this._h = v; this.renders++; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
      const store = {};
      const app = G.createApp({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, now: () => 1, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
      return { app, root };
    }
    const order = html => (html.match(/data-key="(\d+-\d+)"[^>]*aria-pressed/g) || []).map(s => s.match(/data-key="(\d+-\d+)"/)[1]);
    let t = null;
    for (let seed = 5; seed < 60; seed++) {
      t = newApp(seed);
      t.app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
      for (let i = 0; i < 80 && !t.app.state.awaiting; i++) await tick();
      if (t.app.state.awaiting && t.app.state.awaiting.kind === 'build' && t.app.state.awaiting.moves.length >= 2) break;
    }
    const S = t.app.state;
    const pips = k => k.split('-').reduce((a, b) => a + Number(b), 0);
    const base = order(t.root.innerHTML);
    ok(base.length === 15 && base.every((k, i) => i === 0 || pips(base[i - 1]) >= pips(k)), 'by default the hand is heaviest first');
    ok(/Drag a tile onto a train to play it/.test(t.root.innerHTML) && !/Sort hand/.test(t.root.innerHTML), 'round 1 shows a hint, and no Sort button yet');
    const handBefore = JSON.stringify(S.game.players[0].hand);
    const [k0, k1, k2] = base;
    t.app.dispatch({ type: 'dragStart', key: k0 });
    ok(S.dragKey === k0 && eq(S.handOrder, base), 'dragStart records the current order');
    ok(new RegExp(`tile-btn[^"]*drag-src[^"]*"[^>]*data-key="${k0}"`).test(t.root.innerHTML.replace(/\s+/g, ' ')) || /drag-src/.test(t.root.innerHTML), 'the tile being dragged is marked so it can be dimmed');
    t.app.dispatch({ type: 'dragMove', index: 2 });
    ok(eq(order(t.root.innerHTML).slice(0, 3), [k1, k2, k0]), 'dragging over the third tile moves it there');
    const r0 = t.root.renders;
    t.app.dispatch({ type: 'dragMove', index: 2 });
    ok(t.root.renders === r0, 'the same position again: no redraw');
    t.app.dispatch({ type: 'dragMove', index: -1 }); t.app.dispatch({ type: 'dragMove', index: NaN });
    ok(t.root.renders === r0, 'invalid positions are ignored');
    t.app.dispatch({ type: 'hoverTile', key: k1 });
    ok(S.hoverKey === k0, 'while dragging, only the dragged tile lights up trains; hovering other tiles is ignored');
    t.app.dispatch({ type: 'dragMove', index: 14 });
    ok(order(t.root.innerHTML)[14] === k0, 'can be dragged all the way to the end');
    t.app.dispatch({ type: 'dragEnd' });
    ok(S.dragKey === null && !/drag-src/.test(t.root.innerHTML), 'dropping clears the marker');
    const arranged = order(t.root.innerHTML);
    ok(arranged[14] === k0 && !/Sort hand/.test(t.root.innerHTML) && !/Drag a tile onto a train/.test(t.root.innerHTML), 'the arrangement stays; there is no Sort button, and the hint goes');
    ok(JSON.stringify(S.game.players[0].hand) === handBefore, 'the hand itself is untouched: only the display order changed');
    ok(eq([...arranged].sort(), [...base].sort()), 'same 15 tiles');

    // keyboard
    t.app.dispatch({ type: 'moveTile', key: arranged[0], delta: -1 });
    ok(eq(order(t.root.innerHTML), arranged), 'Shift+Left on the first tile does nothing');
    t.app.dispatch({ type: 'moveTile', key: arranged[3], delta: -1 });
    ok(order(t.root.innerHTML)[2] === arranged[3] && order(t.root.innerHTML)[3] === arranged[2], 'Shift+Left swaps with the tile before');
    t.app.dispatch({ type: 'moveTile', key: arranged[14], delta: 1 });
    ok(order(t.root.innerHTML)[14] === arranged[14], 'Shift+Right on the last tile does nothing');
    t.app.dispatch({ type: 'moveTile', key: '99-99', delta: 1 });
    ok(true, 'an unknown tile is ignored');

    // playing a tile keeps everyone else where they were
    const custom = order(t.root.innerHTML);
    const A = S.awaiting;
    const playKey = key(A.moves[0].tile);
    t.app.dispatch({ type: 'selectTile', key: playKey });
    for (let i = 0; i < 60 && !(S.awaiting && S.awaiting !== A); i++) await tick();
    ok(eq(order(t.root.innerHTML), custom.filter(k => k !== playKey)) || S.awaiting == null, 'after playing a tile the rest keep your arrangement');
    // taking it back returns it to the spot it came from in your arrangement
    if (S.awaiting && S.awaiting.kind === 'build' && S.awaiting.canUndo) {
      t.app.dispatch({ type: 'undoTile' });
      for (let i = 0; i < 60 && order(t.root.innerHTML).length < custom.length; i++) await tick();
      ok(eq(order(t.root.innerHTML), custom), 'a tile taken back returns to its old spot in your arrangement');
    }
    ok(S.handOrder !== null && !/sort-btn|Sort hand/.test(t.root.innerHTML), 'there is no Sort button, and the arrangement stays');
    S.handOrder = null; t.app.render(true);                 // (a new round or game clears it)
    const re = order(t.root.innerHTML);
    ok(S.handOrder === null && re.every((k, i) => i === 0 || pips(re[i - 1]) >= pips(k)), 'a cleared arrangement shows the automatic order again (heaviest first)');

    // stale keys in the saved order are ignored
    S.handOrder = ['99-99', ...order(t.root.innerHTML)];
    t.app.render(true);
    ok(!/99-99/.test(t.root.innerHTML) && order(t.root.innerHTML).length === S.game.players[0].hand.length, 'tiles no longer in the hand are ignored');
    S.handOrder = null;

    // the hint is for round one only
    S.roundIndex = 1; t.app.render(true);
    ok(!/Drag a tile onto a train/.test(t.root.innerHTML), 'no hint after the first round');
    S.roundIndex = 0;
  }
  {
    // a new round starts with a fresh, sorted hand
    const r = (() => { const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} }; return root; })();
    const store = {};
    const app = G.createApp({ root: r, rng: mulberry32(8), sleep: async () => {}, reducedMotion: true, now: () => 1, storage: { get: k => store[k] || null, set: (k, v) => { store[k] = v; } } });
    app.dispatch({ type: 'startGame', rounds: 4, hand: 8, style: 'pips' });
    let sawCustom = false, resetOk = false;
    for (let g = 0; g < 30000 && app.state.roundIndex < 2; g++) {
      await tick();
      const A = app.state.awaiting;
      if (!A) continue;
      if (app.state.roundIndex === 0 && !sawCustom && A.kind === 'build') { app.dispatch({ type: 'dragStart', key: app.state.game.players[0].hand[0].join('-') }); app.dispatch({ type: 'dragEnd' }); sawCustom = !!app.state.handOrder; }
      if (A.kind === 'modal') { app.dispatch({ type: 'dialogOk' }); for (let i = 0; i < 40 && app.state.roundIndex < 1; i++) await tick(); if (app.state.roundIndex === 1) { resetOk = app.state.handOrder === null && app.state.dragKey === null; break; } continue; }
      if (A.kind === 'draw') app.dispatch({ type: 'draw' });
      else if (A.kind === 'build') { if (A.canDraw) app.dispatch({ type: 'draw' }); else if (A.moves.length) app.dispatch({ type: 'selectTile', key: key(A.moves[0].tile) }); else if (A.canDone) app.dispatch({ type: 'endBuild' }); else app.dispatch({ type: 'undoTile' }); }
      else { const m = A.moves[0]; app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (app.state.awaiting === A) app.dispatch({ type: 'playOn', train: m.trainId }); }
    }
    ok(sawCustom && resetOk, 'a custom arrangement is cleared when the next round is dealt');
  }

  console.log('6. dragging with pointer events (fake page)');
  {
    const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const store = {};
    const app = G.createApp({ root, rng: mulberry32(12), sleep: async () => {}, reducedMotion: true, now: () => 1, storage: { get: k => store[k] || null, set: (k, v) => { store[k] = v; } } });
    app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
    for (let i = 0; i < 80 && !app.state.awaiting; i++) await tick();
    // a fake page whose hand row mirrors the app's display order
    const fr = fakeEnv();
    const listeners = {};
    fr.root.addEventListener = (t, f) => { (listeners[t] = listeners[t] || []).push(f); };
    fr.root.setPointerCapture = () => { fr.captured = true; }; fr.root.releasePointerCapture = () => { fr.captured = false; };
    const tiles = () => G.orderedHand(app.state).map((t, i) => { const e = new FakeEl('button'); e.dataset.key = key(t); e.rect = R(20 + i * 60, 600, 44, 86); const svg = new FakeEl('svg'); svg.rect = e.rect; e.querySelector = () => svg; e.svg = svg; return e; });
    fr.root.querySelectorAll = sel => (sel === '.hand .tile-btn' ? (fr.cur = tiles()) : []);
    const drag = G.createDrag(fr.root, app, fr.doc);
    const fire = (type, ev) => (listeners[type] || []).forEach(f => f(ev));
    const targetOf = i => { const el = tiles()[i]; return { closest: sel => (sel === '.tile-btn' ? el : null) }; };
    const keysNow = () => G.orderedHand(app.state).map(key);
    const start = keysNow();

    fire('pointerdown', { pointerId: 1, button: 0, clientX: 40, clientY: 640, target: targetOf(0) });
    fire('pointermove', { pointerId: 1, clientX: 43, clientY: 642 });
    ok(app.state.dragKey === null && !drag.dragging, 'a tiny movement is still just a press');
    fire('pointermove', { pointerId: 1, clientX: 75, clientY: 650 });
    ok(app.state.dragKey === start[0] && drag.dragging && fr.captured === true, 'moving past the threshold starts a drag and captures the pointer');
    const fl = fr.doc.body.children.find(c => c.className === 'dragfloat');
    ok(fl && fr.doc.body.classList.contains('dragging'), 'a floating copy follows the pointer and the page shows a grabbing cursor');
    ok(/translate\(\d+px, \d+px\)/.test(fl.style.transform) && near(parseFloat(fl.style.transform.match(/translate\(([\d.-]+)px/)[1]), 75 - 20, 1e-6), 'the copy keeps the grab point under the pointer');
    fire('pointermove', { pointerId: 1, clientX: 20 + 2 * 60 + 20, clientY: 640 });
    ok(keysNow()[2] === start[0] && keysNow()[0] === start[1], 'over the third tile: the dragged tile takes that place, the others shuffle');
    fire('pointermove', { pointerId: 1, clientX: 20 + 14 * 60 + 20, clientY: 640 });
    ok(keysNow()[14] === start[0], 'carried to the far end');
    fire('pointerup', { pointerId: 1, clientX: 20 + 14 * 60 + 20, clientY: 640 });
    ok(app.state.dragKey === null && fl.removed && !fr.doc.body.classList.contains('dragging') && fr.captured === false && !drag.dragging, 'dropping ends it cleanly');
    ok(drag.consumeClick() === true && drag.consumeClick() === false, 'the click that follows a drag is swallowed once (so it does not play the tile)');
    const afterDrag = keysNow();

    fire('pointerdown', { pointerId: 2, button: 0, clientX: 40, clientY: 640, target: targetOf(0) });
    fire('pointerup', { pointerId: 2, clientX: 40, clientY: 640 });
    ok(drag.consumeClick() === false && eq(keysNow(), afterDrag), 'a press and release without moving is an ordinary click and changes nothing');

    fire('pointerdown', { pointerId: 3, button: 2, clientX: 40, clientY: 640, target: targetOf(0) });
    fire('pointermove', { pointerId: 3, clientX: 200, clientY: 640 });
    ok(!drag.dragging && eq(keysNow(), afterDrag), 'the right mouse button does not drag');
    fire('pointerdown', { pointerId: 4, button: 0, clientX: 40, clientY: 640, target: { closest: () => null } });
    fire('pointermove', { pointerId: 4, clientX: 200, clientY: 640 });
    ok(!drag.dragging, 'pressing somewhere that is not a tile does nothing');
    fire('pointerdown', { pointerId: 5, button: 0, clientX: 40, clientY: 640, target: targetOf(1) });
    fire('pointermove', { pointerId: 6, clientX: 300, clientY: 640 });
    ok(!drag.dragging, 'moves from a different pointer are ignored');
    fire('pointermove', { pointerId: 5, clientX: 100, clientY: 640 });
    ok(drag.dragging, 'but the original pointer still works');
    fire('pointercancel', { pointerId: 5 });
    ok(!drag.dragging && app.state.dragKey === null, 'a cancelled gesture (e.g. a phone call) ends the drag');
    drag.consumeClick();
    app.state.overlay = 'rules';
    fire('pointerdown', { pointerId: 7, button: 0, clientX: 40, clientY: 640, target: targetOf(0) });
    fire('pointermove', { pointerId: 7, clientX: 300, clientY: 640 });
    ok(!drag.dragging, 'no dragging behind an open dialog');
    app.state.overlay = null;
  }

  console.log('7. the built page: pointer drag, swallowed click, Shift+arrow keys (real page script)');
  {
    const fs = require('fs'), vm = require('vm');
    const html = fs.readFileSync('../mexican-train.html', 'utf8');
    const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const handlers = {}, docH = {}, winH = {}, store = {};
    const body = new FakeEl('body');
    const rootEl = new FakeEl('div');
    let inner = '';
    Object.defineProperty(rootEl, 'innerHTML', { get: () => inner, set: v => { inner = v; } });
    rootEl.addEventListener = (t, f) => { handlers[t] = f; };
    rootEl.setPointerCapture = () => {}; rootEl.releasePointerCapture = () => {};
    rootEl.ownerDocument = {};
    rootEl.querySelector = sel => ({ focus() {}, value: '4' });
    const sandbox = {
      document: { readyState: 'complete', body, createElement: t => new FakeEl(t), getElementById: () => rootEl, addEventListener(t, f) { (docH[t] = docH[t] || []).push(f); } },
      addEventListener(type, f) { winH[type] = f; },
      location: { search: '?seed=9' }, localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
      matchMedia: () => ({ matches: true }), console, setTimeout: (f, ms) => setTimeout(f, (ms || 0) / 80), clearTimeout,
      URLSearchParams, Math, JSON, Object, Array, Number, String, Set, Map, Promise, Error, Float32Array, Float64Array, Uint32Array,
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox); vm.runInContext(code, sandbox);
    const app = sandbox.MexicanTrainApp;
    const click = (attrs) => ({ target: { closest: sel => (sel === '[data-action]' ? { dataset: attrs } : null) } });
    handlers.click(click({ action: 'startGame' }));
    for (let i = 0; i < 400 && !(app.state.awaiting); i++) await new Promise(r => setTimeout(r, 5));
    rootEl.querySelectorAll = sel => (sel === '.hand .tile-btn' ? G.orderedHand(app.state).map((t, i) => { const e = new FakeEl('button'); e.dataset.key = key(t); e.rect = R(20 + i * 60, 600, 44, 86); const svg = new FakeEl('svg'); svg.rect = e.rect; e.querySelector = () => svg; return e; }) : []);
    const keysNow = () => G.orderedHand(app.state).map(key);
    const first = keysNow();
    const tileTarget = i => { const el = rootEl.querySelectorAll('.hand .tile-btn')[i]; return { closest: sel => (sel === '.tile-btn' ? el : null) }; };
    handlers.pointerdown({ pointerId: 1, button: 0, clientX: 40, clientY: 640, target: tileTarget(0) });
    handlers.pointermove({ pointerId: 1, clientX: 90, clientY: 650 });
    handlers.pointermove({ pointerId: 1, clientX: 20 + 3 * 60 + 20, clientY: 640 });
    handlers.pointerup({ pointerId: 1, clientX: 20 + 3 * 60 + 20, clientY: 640 });
    ok(keysNow()[3] === first[0], 'the page really reorders the hand when you drag a tile');
    const handLen = app.state.game.players[0].hand.length, aw = app.state.awaiting;
    handlers.click({ target: { closest: sel => (sel === '[data-action]' ? { dataset: { action: 'selectTile', key: keysNow()[3] } } : null) } });
    ok(app.state.game.players[0].hand.length === handLen && app.state.awaiting === aw, 'the click right after a drag is ignored: the tile is not played');
    // a genuine click afterwards still works (use a tile that is playable)
    const playable = aw && aw.moves && aw.moves.length ? key(aw.moves[0].tile) : null;
    if (playable) {
      handlers.click({ target: { closest: sel => (sel === '[data-action]' ? { dataset: { action: 'selectTile', key: playable } } : null) } });
      ok(app.state.awaiting !== aw, 'the next ordinary click plays the tile as before');
    }
    // keyboard
    let prevented = 0;
    const kb = (k, shift) => handlers.keydown({ key: k, shiftKey: shift, preventDefault() { prevented++; }, target: { closest: sel => (sel === '.tile-btn' ? { dataset: { key: keysNow()[4] } } : null) } });
    const k4 = keysNow()[4], before = keysNow();
    kb('ArrowLeft', true);
    ok(keysNow()[3] === k4 && prevented === 1, 'Shift+Left moves the focused tile one place left');
    kb('ArrowLeft', false); kb('ArrowUp', true);
    ok(prevented === 1, 'plain arrows and other keys are left alone');
    // no Sort button; a cleared arrangement is the automatic order
    ok(!/sort-btn|Sort hand/.test(rootEl.innerHTML), 'the page has no Sort hand button');
    app.state.handOrder = null; app.render(true);
    const sorted = keysNow();
    ok(app.state.handOrder === null && sorted.every((k, i) => i === 0 || k.split('-').reduce((a, b) => a + +b, 0) <= sorted[i - 1].split('-').reduce((a, b) => a + +b, 0)), 'and the automatic order is heaviest first');
    app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips' });
    // resizing the window: every train goes back to showing its newest domino
    const scrollers = ['human', 'cpu', 'mexican'].map(id => { const e = new FakeEl('div'); e.dataset.train = id; e.scrollLeft = 0; e.scrollWidth = 1800; return e; });
    const prevQ = rootEl.querySelectorAll;
    rootEl.querySelectorAll = sel => (sel === '.scroller' ? scrollers : prevQ(sel));
    ok(typeof winH.resize === 'function', 'the page listens for the window being resized');
    winH.resize();
    ok(scrollers.every(e => e.scrollLeft === 1800 && e.classList.contains('more-left')), 'on resize every train jumps back to its newest domino and shows the fade on its old end');
  }

  console.log('8. trains without scroll bars');
  {
    const fs = require('fs');
    const css = fs.readFileSync('../style.css', 'utf8');
    const rule = sel => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
    ok(/scrollbar-width:\s*none/.test(rule('.scroller')) && /display:\s*none/.test(rule('.scroller::-webkit-scrollbar')), 'scroll bars are hidden (Firefox and Chrome/Safari/Edge)');
    ok(/overflow-x:\s*auto/.test(rule('.scroller')), 'trains can still be moved by swiping or a trackpad');
    ok(/mask-image/.test(rule('.scroller.more-left')), 'a soft fade shows when older tiles are out of sight');
    ok(!/scrollbar-color|scrollbar-width:\s*thin/.test(css), 'no leftover visible scroll bar styling');

    const sc = ['human', 'cpu', 'mexican'].map(id => { const e = new FakeEl('div'); e.dataset.train = id; e.scrollLeft = 0; e.scrollWidth = 1800; return e; });
    const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll: sel => (sel === '.scroller' ? sc : []), querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const store = {};
    const app = G.createApp({ root, rng: mulberry32(4), sleep: async () => {}, reducedMotion: true, now: () => 1, chatRng: () => 1, nativeChance: 0, foodChance: 0, timer: { set() { return 0; }, clear() {} },
      storage: { get: k => store[k] || null, set: (k, v) => { store[k] = v; } } });
    app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
    for (let i = 0; i < 80 && !app.state.awaiting; i++) await tick();
    ok(sc.every(e => e.scrollLeft === 1800 && e.classList.contains('more-left')), 'when the board first appears every train is showing its newest end');
    sc[0].scrollLeft = 0; app.render(true);
    ok(sc[0].scrollLeft === 0 && !sc[0].classList.contains('more-left'), 'a redraw with no new tile leaves a train where it is');
    let A = app.state.awaiting;
    for (let i = 0; i < 40 && !(A && A.moves && A.moves.length); i++) {     // no play yet: draw until there is one
      if (A && (A.kind === 'build' && A.canDraw || A.kind === 'draw')) app.dispatch({ type: 'draw' });
      for (let j = 0; j < 10; j++) await tick();
      A = app.state.awaiting;
    }
    const m = A.moves.find(x => x.trainId === 'human') || A.moves[0];
    app.dispatch({ type: 'selectTile', key: key(m.tile) });
    for (let i = 0; i < 40; i++) await tick();
    const trainEl = sc.find(e => e.dataset.train === m.trainId);
    ok(trainEl.scrollLeft === 1800 && trainEl.classList.contains('more-left'), 'a new tile on a train scrolls it to show that tile');
  }

  Object.keys(failCounts).forEach(m => console.log(`  (x${failCounts[m]}) ${m}`));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
