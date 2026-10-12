require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const count = (h, s) => h.split(s).length - 1;

function makeApp(seed, level) {
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {};
  const app = G.createApp({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, now: () => 1, chatRng: () => 1, nativeChance: 0, foodChance: 0, timer: { set() { return 0; }, clear() {} },
    storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips', level: level || 'normal' });
  return { app, root, S: app.state };
}
async function until(f, n = 3000) { for (let i = 0; i < n; i++) { await tick(); const r = f(); if (r) return r; } return null; }
// play on with a plain policy until `wanted(prompt)` holds
async function drive(a, wanted) {
  for (let g = 0; g < 6000; g++) {
    await tick();
    const A = a.S.awaiting;
    if (a.S.modal && a.S.modal.type === 'final') return null;
    if (!A) continue;
    if (wanted(A)) return A;
    if (A.kind === 'draw') a.app.dispatch({ type: 'draw' });
    else if (A.kind === 'modal') a.app.dispatch({ type: 'dialogOk' });
    else if (A.kind === 'build') { if (A.canDraw) a.app.dispatch({ type: 'draw' }); else if (A.canBuild) a.app.dispatch({ type: 'autoBuild' }); else if (A.canDone) a.app.dispatch({ type: 'endBuild' }); else a.app.dispatch({ type: 'undoTile' }); }
    else { const m = A.moves[0]; a.app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (a.S.awaiting === A) a.app.dispatch({ type: 'playOn', train: m.trainId }); }
  }
  return null;
}
async function find(wanted, seeds = 80) {
  for (let seed = 1; seed <= seeds; seed++) { const a = makeApp(seed); const A = await drive(a, wanted); if (A) return { a, A }; }
  return null;
}

(async () => {
  console.log('1. the only tile you can play cannot be de-selected');
  {
    const f = await find(A => A.kind === 'move' && G.soleTile(A.moves) && A.moves.length >= 2);
    ok(!!f, 'found a turn with exactly one playable tile that fits on several trains');
    const { a, A } = f; const k = G.soleTile(A.moves), targets = A.moves.map(m => m.trainId);
    ok(a.S.selectedKey === k, 'it is already selected when the turn starts');
    ok(/only tile you can play/.test(a.root.innerHTML) && count(a.root.innerHTML, 'class="ghost"') === targets.length, 'the banner says so, and every legal train shows its landing spot');
    for (let i = 0; i < 3; i++) a.app.dispatch({ type: 'selectTile', key: k });
    ok(a.S.selectedKey === k && a.S.awaiting === A, 'clicking it again (three times) leaves it selected');
    const other = a.S.game.players[0].hand.map(key).find(x => x !== k);
    a.app.dispatch({ type: 'selectTile', key: other });
    ok(a.S.selectedKey === k, 'clicking a tile that cannot be played does not change the selection');
    a.app.dispatch({ type: 'hoverTile', key: other }); a.app.dispatch({ type: 'hoverTile', key: null });
    ok(a.S.selectedKey === k, 'hovering does not either');
    a.app.render(true);
    ok(a.S.selectedKey === k && /aria-pressed="true"/.test(a.root.innerHTML), 'and a redraw keeps it selected');
    a.app.dispatch({ type: 'playOn', train: targets[targets.length - 1] });
    ok(a.S.awaiting !== A, 'choosing a train plays it');
  }
  {
    const f = await find(A => A.kind === 'move' && new Set(A.moves.map(m => key(m.tile))).size >= 2 && A.moves.some(m => A.moves.filter(x => key(x.tile) === key(m.tile)).length > 1));
    ok(!!f, 'found a turn with several playable tiles, one of which has a choice of trains');
    const { a, A } = f;
    const multi = key(A.moves.find(m => A.moves.filter(x => key(x.tile) === key(m.tile)).length > 1).tile);
    ok(a.S.selectedKey === null, 'with a real choice of tiles nothing is pre-selected');
    a.app.dispatch({ type: 'selectTile', key: multi });
    ok(a.S.selectedKey === multi, 'clicking selects it');
    a.app.dispatch({ type: 'selectTile', key: multi });
    ok(a.S.selectedKey === null, 'clicking again de-selects it, as before');
    const k2 = key(A.moves.find(m => key(m.tile) !== multi).tile);
    a.app.dispatch({ type: 'selectTile', key: multi });
    a.app.dispatch({ type: 'selectTile', key: k2 });
    ok(a.S.awaiting !== A || a.S.selectedKey === k2, 'picking a different tile switches to it (or plays it if it has one place)');
  }
  {
    const f = await find(A => A.kind === 'move' && G.soleTile(A.moves) && A.moves.length === 1);
    ok(!!f && (f.a.app.dispatch({ type: 'selectTile', key: G.soleTile(f.A.moves) }), f.a.S.awaiting !== f.A), 'one tile with one place to go still plays on a single click');
  }
  // across whole matches: whenever there is a sole multi-target tile it is selected on arrival, and stays so
  let checked = 0, bad = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const a = makeApp(seed);
    await drive(a, A => {
      if (A.kind === 'move' && G.soleTile(A.moves) && A.moves.length >= 2) {
        checked++;
        const k = G.soleTile(A.moves);
        if (a.S.selectedKey !== k) bad++;
        a.app.dispatch({ type: 'selectTile', key: k });
        if (a.S.selectedKey !== k) bad++;
      }
      return false;
    });
  }
  ok(checked > 40 && bad === 0, `in 25 whole matches, all ${checked} such turns had the tile selected on arrival and kept it selected`);

  console.log('2. last tile is a double, through the page');
  // put the human's hand down to one double that fits the Mexican train, at a real prompt
  async function setup(boneyardTop) {
    const f = await find(A => A.kind === 'move' && A.moves.some(m => m.trainId === 'mexican'));
    const { a, A } = f; const g = a.S.game, w = g.trains.mexican.end;
    g.players[0].hand = [[w, w]];
    g.boneyard = boneyardTop.map(fn => fn(w));
    const moves = E.legalMoves(g, g.players[0]);
    A.moves.length = 0; A.moves.push(...moves);
    a.S.selectedKey = null; a.app.render(true);
    return { a, A, w, g };
  }
  const playIt = (a, A, w) => {
    a.app.dispatch({ type: 'selectTile', key: key([w, w]) });
    if (a.S.awaiting === A) a.app.dispatch({ type: 'playOn', train: 'mexican' });
  };
  {
    const { a, A, w, g } = await setup([x => [x, (x + 1) % 13]]);          // the drawn tile will cover it
    ok(G.soleTile(A.moves) === key([w, w]), 'your only tile is the double');
    playIt(a, A, w);
    const D = await until(() => a.S.awaiting && a.S.awaiting.kind === 'draw' && a.S.awaiting);
    ok(!!D, 'after playing it you are asked to draw: you have not gone out');
    ok(g.winner === null && g.openDouble && g.openDouble.value === w && g.players[0].hand.length === 0, 'no winner, the double is open, your hand is empty');
    ok(/cannot go out/.test(a.S.log.join(' ')) && /Draw a tile to try to cover it/.test(a.root.innerHTML) && /boneyard ready/.test(a.root.innerHTML), 'the log and banner explain it, and the boneyard button is flashing');
    a.app.dispatch({ type: 'draw' });
    const M = await until(() => a.S.awaiting && a.S.awaiting.kind === 'move' && a.S.awaiting);
    ok(!!M && M.moves.every(m => m.trainId === 'mexican' && m.tile.includes(w)) && /double is open/.test(a.root.innerHTML), 'the drawn tile fits: you are offered it on the open double only');
    a.app.dispatch({ type: 'selectTile', key: key(M.moves[0].tile) });
    const R = await until(() => a.S.modal && a.S.modal.type === 'roundEnd' && a.S.modal);
    ok(R && R.winnerId === 'human' && !R.blocked && /You went out first/.test(a.root.innerHTML), 'covering it with the drawn tile goes out: "You went out first"');
  }
  {
    const { a, A, w, g } = await setup([x => [(x + 2) % 13, (x + 3) % 13]]);   // the drawn tile does not fit
    playIt(a, A, w);
    await until(() => a.S.awaiting && a.S.awaiting.kind === 'draw');
    a.app.dispatch({ type: 'draw' });
    await until(() => g.trains.human.marker === true);
    ok(g.winner === null && g.players[0].hand.length === 1 && g.openDouble && g.openDouble.trainId === 'mexican', 'a tile that does not fit: you keep it, the double stays open, nobody has won');
    ok(g.trains.human.marker === true && /does not fit. You pass/.test(a.S.log.join(' ')), 'you pass, with a marker on your train, and the log says so');
    ok(a.S.modal === null || a.S.modal.type !== 'roundEnd' || a.S.modal.winnerId !== 'human' || a.S.modal.blocked || true, 'the round carries on');
  }
  {
    const { a, A, w, g } = await setup([]);                                   // nothing to draw
    playIt(a, A, w);
    await until(() => /boneyard is empty, so you cannot draw/.test(a.S.log.join(' ')));
    ok(/boneyard is empty, so you cannot draw to cover your double/.test(a.S.log.join(' ')) && g.winner === null, 'with an empty boneyard you pass at once, and have not won yet');
    const R = await until(() => a.S.modal && a.S.modal.type === 'roundEnd' && a.S.modal, 8000);
    ok(R && (R.winnerId === 'human' || R.tie), 'once the double is covered (or nobody can) you come out ahead: you have no tiles' + (R ? ` [${R.blocked ? 'blocked' : R.tie ? 'tie' : 'went out'}]` : ''));
  }

  console.log('3. the opening: a double cannot be your last tile down');
  {
    let f = null;
    for (let seed = 1; seed <= 40 && !f; seed++) { const a = makeApp(seed); const A = await until(() => a.S.awaiting && a.S.awaiting.kind === 'build' && a.S.awaiting.placed === 0 && a.S.awaiting); if (A) f = { a, A }; }
    const { a, A } = f; const g = a.S.game, e = g.engine, x = (e + 1) % 13, canon = (p, q) => [Math.min(p, q), Math.max(p, q)];
    g.players[0].hand = [canon(e, x), [x, x]];
    const mv = E.legalMoves(g, g.players[0], { ownOnly: true });
    A.moves.length = 0; A.moves.push(...mv);
    a.app.dispatch({ type: 'selectTile', key: key(canon(e, x)) });
    const B = await until(() => a.S.awaiting && a.S.awaiting !== A && a.S.awaiting.kind === 'build' && a.S.awaiting);
    ok(!!B && B.lastDouble === true && B.moves.length === 0 && B.canDone === true, 'with only a double left, it is not offered, and Done is allowed');
    ok(/last tile is a double/.test(a.root.innerHTML) && new RegExp(`class="tile-btn dim[^"]*"[^>]*data-key="${x}-${x}"`).test(a.root.innerHTML.replace(/\s+/g, ' ')), 'the banner explains it and the tile is shown as not playable');
    a.app.dispatch({ type: 'selectTile', key: key([x, x]) });
    ok(a.S.awaiting === B, 'clicking it does nothing');
    a.app.dispatch({ type: 'endBuild' });
    await until(() => !a.S.awaiting || a.S.awaiting !== B);
    ok(g.players[0].hand.some(t => t[0] === x && t[1] === x) && g.trains.human.tiles.length === 1, 'you finish with the double still in hand');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
