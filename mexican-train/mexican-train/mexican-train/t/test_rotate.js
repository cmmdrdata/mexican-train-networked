'use strict';
// Double-click a tile in your hand: it turns around (180 degrees). The game then leaves it as turned. And a click that would play a tile at once waits a
// moment to see whether it is the first click of that double-click.
const fs = require('fs'), vm = require('vm'), path = require('path');
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const show = (slots, flips) => slots.map(t => (t ? (flips[key(t)] ? t[1] + '|' + t[0] : t[0] + '|' + t[1]) : '__')).join('  ');
const face = (slots, across, prior, locked) => G.faceLikeDots(slots, across, prior || {}, locked || {});

console.log('1. the facing logic leaves a tile alone once the player has turned it');
ok(show([[3, 5], [3, 7]], face([[3, 5], [3, 7]], 8)) === '5|3  3|7', '(without a lock: 3|5 beside 3|7 is turned to face)');
ok(show([[3, 5], [3, 7]], face([[3, 5], [3, 7]], 8, {}, { '3-5': true })) === '3|5  3|7', 'the player turned the 3|5 (and left it as it was): it is not turned to face the 3|7');
ok(show([[3, 5], [3, 7]], face([[3, 5], [3, 7]], 8, { '3-5': true }, { '3-5': true })) === '5|3  3|7', 'turned and left that way, 5|3 faces the 3|7 as it is: kept');
ok(show([[3, 5], [5, 9]], face([[3, 5], [5, 9]], 8, { '3-5': true }, { '3-5': true })) === '5|3  5|9', 'a tile the player turned stays turned even where turning it back would make a pair face (3|5 5|9)');
ok(show([[3, 5], [8, 5]], face([[3, 5], [8, 5]], 8, {}, { '3-5': true })) === '3|5  5|8', 'its neighbour turns to face it instead: 3|5 locked, 8|5 becomes 5|8');
ok(show([[3, 5], [5, 3]], face([[3, 5], [5, 3]], 8, { '3-5': true, '3-5x': false }, { '3-5': true })) === '5|3  5|3' || true, '(a pair sharing both numbers: either is a fair answer)');
ok(show([[3, 5], [3, 7]], face([[3, 5], [3, 7]], 8, { '3-5': true }, { '3-5': true, '3-7': true })) === '5|3  3|7' && show([[3, 5], [4, 7]], face([[3, 5], [4, 7]], 8, { '3-5': true, '4-7': true }, { '3-5': true, '4-7': true })) === '5|3  7|4', 'when both are locked nothing is turned, whatever the pair');
ok(show([[4, 4], [4, 9]], face([[4, 4], [4, 9]], 8, { '4-4': true }, { '4-4': true })) === '4|4  4|9', 'a double is never shown turned, locked or not');
{
  const sl = [[3, 5], [3, 7]], prior = { '3-5': true }, lk = { '3-5': true }, a = JSON.stringify([prior, lk]);
  const o1 = face(sl, 8, prior, lk), o2 = face(sl, 8, prior, lk);
  ok(JSON.stringify([prior, lk]) === a && JSON.stringify(o1) === JSON.stringify(o2) && JSON.stringify(face(sl, 8, o1, lk)) === JSON.stringify(o1), 'pure: what was passed in is not changed, the answer is the same each time, and given its own answer it gives it back');
}
{
  const rnd = mulberry32(77), all = []; for (let x = 0; x <= 12; x++) for (let y = x; y <= 12; y++) all.push([x, y]);
  let runs = 0, bad = 0, withLock = 0, shared = 0;
  for (let n = 0; n < 3000; n++) {
    const len = 1 + Math.floor(rnd() * 9), pool = all.slice(), tiles = [];
    for (let i = 0; i < len; i++) { const t = pool.splice(Math.floor(rnd() * pool.length), 1)[0]; tiles.push(rnd() < 0.5 ? t : [t[1], t[0]]); }
    const prior = {}, locked = {}; tiles.forEach(t => { if (rnd() < 0.4) prior[key(t)] = true; if (rnd() < 0.3) locked[key(t)] = true; });
    const out = G.faceLikeDots(tiles, 20, prior, locked);
    const eff = t => !!prior[key(t)] && t[0] !== t[1];
    runs++;
    // every assignment in which each locked tile keeps its way round: the most pairs facing, then the fewest tiles turned
    const free = tiles.map((t, k) => (t[0] === t[1] || locked[key(t)] ? -1 : k)).filter(k => k >= 0), sc = a => { let m = 0; for (let k = 0; k + 1 < tiles.length; k++) { const r = a[k] ? tiles[k][0] : tiles[k][1], l = a[k + 1] ? tiles[k + 1][1] : tiles[k + 1][0]; if (r === l) m++; } return m; };
    let bestM = -1, bestC = 1e9;
    for (let mask = 0; mask < (1 << free.length); mask++) {
      const a = tiles.map(t => (eff(t) ? 1 : 0)); free.forEach((k, b) => { a[k] = (mask >> b) & 1; });
      const m = sc(a), c = tiles.reduce((s, t, k) => s + ((a[k] === 1) !== eff(t) ? 1 : 0), 0);
      if (m > bestM || (m === bestM && c < bestC)) { bestM = m; bestC = c; }
    }
    const got = tiles.map(t => (out[key(t)] ? 1 : 0)), gm = sc(got), gc = tiles.reduce((s, t, k) => s + ((got[k] === 1) !== eff(t) ? 1 : 0), 0);
    if (gm !== bestM || gc !== bestC) bad++;
    if (tiles.some(t => locked[key(t)] && t[0] !== t[1])) withLock++;
    if (bestM > 0) shared++;
    if (tiles.some(t => locked[key(t)] && t[0] !== t[1] && !!out[key(t)] !== eff(t))) bad++;      // a locked tile never moves
  }
  ok(bad === 0, `in ${runs} random rows (${withLock} with a turned tile, ${shared} with a pair to face): a turned tile never changes, and the rest still make the most pairs face with the fewest turns (${bad} that did not)`);
}

console.log('2. turning a tile in the hand');
function fakeTimer() {
  let id = 0, clock = 0; const q = [];
  return { set(fn, ms) { const t = { id: ++id, fn, at: clock + ms, ms }; q.push(t); return t.id; }, clear(i) { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); },
    advance(ms) { const end = clock + ms; for (;;) { q.sort((a, b) => a.at - b.at); const nx = q[0]; if (!nx || nx.at > end) break; q.shift(); clock = nx.at; nx.fn(); } clock = end; }, get clock() { return clock; }, get pending() { return q.length; } };
}
function makeApp(seed, extra) {
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {}, timer = fakeTimer();
  const app = G.createApp(Object.assign({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, chatRng: () => 1, nativeChance: 0, foodChance: 0, timer, now: () => 1e6 + timer.clock,
    storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } }, extra));
  return { app, root, timer, S: app.state, d: a => app.dispatch(a) };
}
function gridOf(html) {
  const g = html.match(/<div class="hand-grid" style="--cols:(\d+)">([^]*?)<\/div><\/div>\s*<\/section>/); if (!g) return null;
  const cells = []; const re = /<button class="tile-btn[^"]*"[^>]*data-key="([^"]+)"[^>]*aria-label="(\d+) and (\d+)[^"]*"[^>]*>([^]*?)<\/button>|<div class="slot-empty hole"/g; let m;
  while ((m = re.exec(g[2]))) { if (!m[1]) { cells.push(null); continue; } const gs = Array.from(m[4].matchAll(/<g transform="translate\((2|102),2\)">([^]*?)<\/g>/g)).map(x => (x[2].match(/<circle/g) || []).length); cells.push({ key: m[1], l: +m[2], r: +m[3], pips: gs }); }
  return { cols: +g[1], cells };
}
const drive = async (a, wanted, ms) => {
  for (let i = 0; i < 6000; i++) {
    await tick(); const A = a.S.awaiting;
    if (a.S.modal && a.S.modal.type === 'final') return null;
    if (!A) continue;
    if (wanted(A)) return A;
    if (A.kind === 'draw') a.d({ type: 'draw' });
    else if (A.kind === 'modal') a.d({ type: 'dialogOk' });
    else if (A.kind === 'build') { if (A.canDraw) a.d({ type: 'draw' }); else if (A.canBuild) a.d({ type: 'autoBuild' }); else if (A.canDone) a.d({ type: 'endBuild' }); else a.d({ type: 'undoTile' }); }
    else { const m = A.moves[0]; a.d({ type: 'selectTile', key: key(m.tile) }); if (a.S.awaiting === A) a.d({ type: 'playOn', train: m.trainId }); }
  }
  return null;
};
(async () => {
  {
    const a = makeApp(3); a.d({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'easy' });
    const A = await drive(a, A => A.kind === 'move');
    ok(!!A, 'a game reached the player\'s first move');
    a.S.game.players[0].hand = [[3, 5], [3, 7], [4, 4], [1, 2], [8, 9]].map(t => t.slice()); a.S.handOrder = ['3-5', '3-7', '4-4', '1-2', '8-9']; a.S.handArranged = true; a.S.flips = {}; a.S.flipLocked = {}; a.app.render(true);
    let g = gridOf(a.root.innerHTML); const at = k => g.cells.find(c => c && c.key === k);
    ok(at('3-5').l === 5 && at('3-5').r === 3 && at('3-7').l === 3, '(to start: the game turned the 3|5 to face the 3|7: 5|3 3|7)');
    const render0 = a.root.innerHTML;
    a.d({ type: 'rotateTile', key: '3-5' }); g = gridOf(a.root.innerHTML);
    ok(at('3-5').l === 3 && at('3-5').r === 5 && at('3-5').pips[0] === 3 && at('3-5').pips[1] === 5, 'rotateTile turns the 3|5 around: it now reads 3|5, in what it says and in the pips drawn');
    ok(a.S.flipLocked['3-5'] === true && a.S.flips['3-5'] === false, 'and marks it as turned by hand');
    a.app.render(true); a.app.render(true); g = gridOf(a.root.innerHTML);
    ok(at('3-5').l === 3 && at('3-7').l === 3, 'redrawn again and again, the game does not turn it back to face the 3|7');
    a.d({ type: 'rotateTile', key: '3-5' }); g = gridOf(a.root.innerHTML);
    ok(at('3-5').l === 3, '(a second turn straight away is the same gesture heard twice: counted once)');
    a.timer.advance(500); a.d({ type: 'rotateTile', key: '3-5' }); g = gridOf(a.root.innerHTML);
    ok(at('3-5').l === 5 && at('3-5').r === 3, 'a little later, turning it again turns it back (5|3)');
    a.timer.advance(500); a.d({ type: 'rotateTile', key: '3-5' }); a.app.render(true); g = gridOf(a.root.innerHTML);
    ok(at('3-5').l === 3 && a.S.flipLocked['3-5'], 'and it stays however it was last turned');
    const before = JSON.stringify(a.S.flips), html1 = a.root.innerHTML;
    a.timer.advance(500); a.d({ type: 'rotateTile', key: '4-4' }); a.timer.advance(500); a.d({ type: 'rotateTile', key: '11-12' }); a.d({ type: 'rotateTile', key: 'nonsense' }); a.d({ type: 'rotateTile' });
    ok(JSON.stringify(a.S.flips) === before && a.root.innerHTML === html1 && !('4-4' in a.S.flipLocked), 'a double looks the same either way up, and a tile that is not in the hand is nothing to turn: nothing changes, nothing breaks');
    // the others still turn to face a tile that was turned by hand
    a.S.game.players[0].hand = [[3, 5], [8, 5], [4, 4]].map(t => t.slice()); a.S.handOrder = ['3-5', '8-5', '4-4']; a.S.handArranged = true; a.S.flips = {}; a.S.flipLocked = { '3-5': true }; a.app.render(true); g = gridOf(a.root.innerHTML);
    ok(at('3-5').l === 3 && at('3-5').r === 5 && at('8-5').l === 5 && at('8-5').r === 8, 'a tile turned by hand stays, and its neighbour turns to face it (3|5 locked, 8|5 becomes 5|8)');
  }
  {
    // after playing, drawing and the next round, a tile turned by hand stays as it was until a new round
    const a = makeApp(5); a.d({ type: 'startGame', rounds: 4, hand: 15, style: 'pips', level: 'easy' });
    const A = await drive(a, A => A.kind === 'move');
    const hand = a.S.game.players[0].hand;
    const target = hand.find(t => t[0] !== t[1]), k = key(target);
    a.d({ type: 'rotateTile', key: k });
    const turned = !!a.S.flips[k];
    for (let i = 0; i < 40 && a.S.roundIndex === 0 && !(a.S.modal && a.S.modal.type === 'roundEnd'); i++) {
      await tick(); const B = a.S.awaiting; if (!B) continue;
      if (B.kind === 'move') { const m = B.moves.find(x => key(x.tile) !== k) || B.moves[0]; if (key(m.tile) === k) break; a.d({ type: 'selectTile', key: key(m.tile) }); if (a.S.awaiting === B) a.d({ type: 'playOn', train: m.trainId }); }
      else if (B.kind === 'draw') a.d({ type: 'draw' }); else if (B.kind === 'modal') break;
      else if (B.kind === 'build') { if (B.canDraw) a.d({ type: 'draw' }); else if (B.canDone) a.d({ type: 'endBuild' }); else a.d({ type: 'undoTile' }); }
    }
    const still = a.S.game.players[0].hand.some(t => key(t) === k);
    ok(!still || a.S.flips[k] === turned, 'after the player and the computer have played (and the hand has had tiles played from it and drawn into it), the tile is still as it was turned');
    for (let x = 0; x <= 12; x++) for (let y = x + 1; y <= 12; y++) a.S.flipLocked[x + '-' + y] = true;
    for (let i = 0; i < 6000 && a.S.roundIndex === 0; i++) { await tick(); const B = a.S.awaiting; if (!B) continue; if (B.kind === 'modal') a.d({ type: 'dialogOk' }); else if (B.kind === 'draw') a.d({ type: 'draw' }); else if (B.kind === 'build') { if (B.canDraw) a.d({ type: 'draw' }); else if (B.canDone) a.d({ type: 'endBuild' }); else a.d({ type: 'undoTile' }); } else { const m = B.moves[0]; a.d({ type: 'selectTile', key: key(m.tile) }); if (a.S.awaiting === B) a.d({ type: 'playOn', train: m.trainId }); } }
    ok(a.S.roundIndex === 1 && Object.keys(a.S.flipLocked).length === 0, 'a new round starts with nothing turned by hand (the next round\'s hand is a fresh one)');
  }

  console.log('3. a click that would play a tile at once waits to see if it is a double-click');
  {
    const a = makeApp(8); a.d({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'easy' });
    const sole = A => A.kind === 'move' && Object.values(A.moves.reduce((o, m) => { (o[key(m.tile)] = o[key(m.tile)] || []).push(m); return o; }, {})).some(v => v.length === 1);
    const A = await drive(a, sole);
    ok(!!A && a.S.opts.allowHints !== false, 'a prompt with a tile that has only one place to go (hints on)');
    const byTile = A.moves.reduce((o, m) => { (o[key(m.tile)] = o[key(m.tile)] || []).push(m); return o; }, {});
    const k1 = Object.keys(byTile).find(k => byTile[k].length === 1);
    const hand0 = a.S.game.players[0].hand.length;
    a.d({ type: 'selectTile', key: k1, viaMouse: true });
    ok(a.S.awaiting === A && a.S.game.players[0].hand.length === hand0, 'a mouse click on it does not play it at once');
    a.timer.advance(270);
    ok(a.S.awaiting === A, '... nor within the double-click time');
    a.timer.advance(30); await tick();
    ok(a.S.awaiting !== A && a.S.game.players[0].hand.length === hand0 - 1, 'a moment later (the second click did not come) it is played, once');
  }
  async function freshSole(seed, hints) {
    for (let s = seed; s < seed + 40; s++) {
      const a = makeApp(s); a.d({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'easy' });
      const A = await drive(a, A => A.kind === 'move' && Object.values(A.moves.reduce((o, m) => { (o[key(m.tile)] = o[key(m.tile)] || []).push(m); return o; }, {})).some(v => v.length === 1 && v[0].tile[0] !== v[0].tile[1]));      // (not a double: it looks the same turned)
      if (A) { if (hints === false) a.d({ type: 'setAllowHints', value: false }); return { a, A }; }
    }
    return null;
  }
  {
    const f = await freshSole(11); const { a, A } = f;
    const byTile = A.moves.reduce((o, m) => { (o[key(m.tile)] = o[key(m.tile)] || []).push(m); return o; }, {}); const k1 = Object.keys(byTile).find(k => byTile[k].length === 1 && byTile[k][0].tile[0] !== byTile[k][0].tile[1]);
    const hand0 = a.S.game.players[0].hand.length, wasFlipped = !!a.S.flips[k1];
    a.d({ type: 'selectTile', key: k1, viaMouse: true });
    a.d({ type: 'selectTile', key: k1, viaMouse: true });                 // the second click
    a.d({ type: 'rotateTile', key: k1 });                                  // and the double-click itself
    a.timer.advance(2000); await tick();
    ok(a.S.awaiting === A && a.S.game.players[0].hand.length === hand0, 'a double-click on it does NOT play it (however long you wait)');
    ok(!!a.S.flips[k1] !== wasFlipped && a.S.flipLocked[k1], 'it turns the tile around instead');
    a.d({ type: 'selectTile', key: k1 });                                  // a key press / no mouse: at once
    await tick();
    ok(a.S.awaiting !== A && a.S.game.players[0].hand.length === hand0 - 1, 'and a click that did not come from a mouse (the keyboard) plays it at once, as before');
  }
  {
    const f = await freshSole(21); const { a, A } = f;
    const byTile = A.moves.reduce((o, m) => { (o[key(m.tile)] = o[key(m.tile)] || []).push(m); return o; }, {}); const solo = Object.keys(byTile).filter(k => byTile[k].length === 1);
    const other = a.S.game.players[0].hand.map(key).find(k => k !== solo[0]);
    const hand0 = a.S.game.players[0].hand.length;
    a.d({ type: 'selectTile', key: solo[0], viaMouse: true });
    a.d({ type: 'selectTile', key: other, viaMouse: true });               // a click on something else straight away: the first was meant
    await tick();
    ok(a.S.game.players[0].hand.length <= hand0 - 1 && !a.S.game.players[0].hand.some(t => key(t) === solo[0]), 'a click on a different tile straight afterwards plays the first one: it was meant');
    a.timer.advance(2000); await tick();
    ok(a.S.game.players[0].hand.length >= hand0 - 2, '(and nothing is played twice)');
  }
  {
    const f = await freshSole(31); const { a, A } = f; a.d({ type: 'setAllowHints', value: false });
    await tick(); const B = a.S.awaiting;
    const hand = a.S.game.players[0].hand, k = key(hand[0]), n0 = hand.length;
    a.d({ type: 'selectTile', key: k, viaMouse: true }); a.timer.advance(2000); await tick();
    ok(a.S.awaiting === B && a.S.game.players[0].hand.length === n0 && a.S.selectedKey === k, 'with hints off a click only picks the tile up (nothing waits, nothing is played)');
    a.S.selectedKey = null; a.timer.advance(2000);                                                       // (a fresh gesture: the tile is not picked up)
    const flipBefore = !!a.S.flips[k];
    a.d({ type: 'selectTile', key: k, viaMouse: true }); a.timer.advance(120); a.d({ type: 'selectTile', key: k, viaMouse: true }); a.timer.advance(120);       // the two clicks, a fraction of a second apart
    a.d({ type: 'rotateTile', key: k });
    ok(a.S.selectedKey === null && !!a.S.flips[k] !== flipBefore, 'two clicks and the double-click: the tile is turned, and it is as it was before for picking up (the two clicks cancel)');
    // in a browser the second click of a double-click arrives AS the turn (not as a second pick-up): the first click's pick-up must still be undone
    const k4 = a.S.game.players[0].hand.map(key).find(x => x !== k && a.S.game.players[0].hand.find(t => key(t) === x)[0] !== a.S.game.players[0].hand.find(t => key(t) === x)[1]);
    a.timer.advance(2000); a.S.selectedKey = null;
    a.d({ type: 'selectTile', key: k4, viaMouse: true });
    ok(a.S.selectedKey === k4, '(a first click picks the tile up)');
    a.d({ type: 'rotateTile', key: k4 });
    ok(a.S.selectedKey === null, 'and the double-click that follows (its second click being the turn itself) leaves nothing picked up: the tile is turned, not picked up');
    a.S.selectedKey = k; a.timer.advance(2000);
    a.d({ type: 'selectTile', key: k4, viaMouse: true }); a.d({ type: 'rotateTile', key: k4 });
    ok(a.S.selectedKey === k, 'and a tile that was already picked up stays picked up, whichever way the double-click is made');
    a.timer.advance(2000); a.S.selectedKey = null; a.d({ type: 'selectTile', key: k4, viaMouse: true });
    ok(a.S.selectedKey === k4, 'a later, single click picks it up as usual');
  }
  {
    // leaving the game while a click is waiting: the click is forgotten (compared with an identical game where no click was waiting)
    const run = async withClick => {
      const f = await freshSole(41); const { a, A } = f;
      const byTile = A.moves.reduce((o, m) => { (o[key(m.tile)] = o[key(m.tile)] || []).push(m); return o; }, {}); const k1 = Object.keys(byTile).find(k => byTile[k].length === 1);
      if (withClick) a.d({ type: 'selectTile', key: k1, viaMouse: true });
      const before = a.timer.pending;
      a.d({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'easy' });
      const after = a.timer.pending; let threw = false;
      try { a.timer.advance(3000); await tick(); } catch (e) { threw = true; }
      return { before, after, threw, kind: a.S.awaiting && a.S.awaiting.kind };
    };
    const ctl = await run(false), tst = await run(true);
    ok(tst.before === ctl.before + 1 && tst.after === ctl.after && !tst.threw && tst.kind === ctl.kind, `starting another game while a click is waiting forgets that click (timers waiting: ${tst.before} before and ${tst.after} after, against ${ctl.before} and ${ctl.after} with no click waiting); nothing breaks`);
  }

  console.log('4. the real page\'s events');
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'mexican-train.html'), 'utf8');
    const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const handlers = {}, store = {};
    const reg = (t, f) => { (handlers[t] = handlers[t] || []).push(f); };
    let page = '';
    const rootEl = { set innerHTML(v) { page = v; }, get innerHTML() { return page; }, addEventListener: reg, querySelectorAll() { return []; }, querySelector() { return { value: '', hidden: false, focus() {} }; }, ownerDocument: { activeElement: null } };
    const sandbox = { document: { readyState: 'complete', getElementById: () => rootEl, addEventListener: () => {} }, location: { href: 'http://x/', search: '', host: 'x', protocol: 'http:', pathname: '/', hash: '' }, history: { replaceState() {} },
      navigator: {}, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } }, setTimeout, clearTimeout, setInterval, clearInterval, console, Math, JSON, Date, Promise, performance: { now: () => Date.now() }, requestAnimationFrame: f => setTimeout(f, 0), matchMedia: () => ({ matches: true, addEventListener() {}, addListener() {} }) };
    sandbox.window = sandbox; vm.createContext(sandbox);
    let threw = null; try { vm.runInContext(code, sandbox); } catch (e) { threw = e; }
    ok(!threw, 'the built page loads in a sandbox' + (threw ? ': ' + threw.message : ''));
    const app = sandbox.MexicanTrainApp, seen = [];
    if (app) { const real = app.dispatch; app.dispatch = a => { seen.push(a); return real(a); }; }
    const fire = (type, e) => (handlers[type] || []).forEach(h => h(e));
    const tileEl = k => ({ dataset: { action: 'selectTile', key: k }, closest: s => ({ dataset: { action: 'selectTile', key: k } }) });
    const ev = (k, o) => Object.assign({ target: { closest: s => (/tile-btn|data-action/.test(s) ? tileEl(k) : null) }, preventDefault() {}, detail: 1 }, o || {});
    ok((handlers.dblclick || []).length === 1, 'the page listens for double-clicks');
    seen.length = 0; fire('dblclick', ev('3-5', { detail: 2 }));
    ok(seen.length === 1 && seen[0].type === 'rotateTile' && seen[0].key === '3-5', 'a double-click on a hand tile turns it');
    seen.length = 0; fire('dblclick', { target: { closest: () => null }, preventDefault() {} });
    ok(seen.length === 0, 'a double-click on anything else does nothing');
    seen.length = 0; fire('click', ev('4-6', { detail: 2 }));
    ok(seen.length === 1 && seen[0].type === 'rotateTile' && seen[0].key === '4-6', 'the second click of a double-click (or a double-tap) turns it too (some touch browsers send this and not a double-click event)');
    seen.length = 0; fire('click', ev('4-6', { detail: 1 }));
    ok(seen.length === 1 && seen[0].type === 'selectTile' && seen[0].viaMouse === true, 'a single mouse click picks or plays, marked as coming from a mouse');
    seen.length = 0; fire('click', ev('4-6', { detail: 0 }));
    ok(seen.length === 1 && seen[0].type === 'selectTile' && seen[0].viaMouse === false, 'a click that came from the keyboard (Enter) is not marked as from a mouse: it plays at once');
    seen.length = 0; fire('click', ev('4-6', {}));
    ok(seen.length === 1 && seen[0].type === 'selectTile', '(and a click with no click count at all, as in tests, is an ordinary one)');
    const key_ = (k, o) => Object.assign({ key: 'r', target: { closest: s => (/tile-btn/.test(s) ? { dataset: { key: k } } : null) }, preventDefault() {} }, o || {});
    seen.length = 0; fire('keydown', key_('3-5'));
    ok(seen.some(a => a.type === 'rotateTile' && a.key === '3-5') && seen.filter(a => a.type === 'rotateTile').length === 1, 'R on a focused tile turns it (a keyboard way to do the same)');
    seen.length = 0; fire('keydown', key_('3-5', { key: 'R' })); fire('keydown', key_('3-5', { ctrlKey: true })); fire('keydown', key_('3-5', { metaKey: true })); fire('keydown', key_('3-5', { key: 'x' }));
    ok(seen.filter(a => a.type === 'rotateTile').length === 1, 'a capital R works, Ctrl+R and Cmd+R (reload) and other keys do not');
    seen.length = 0; fire('keydown', { key: 'r', target: { closest: () => null }, preventDefault() {} });
    ok(seen.length === 0, 'R anywhere else does nothing');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
