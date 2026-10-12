'use strict';
// Your hand as a row of slots: a tile that is played leaves its slot EMPTY (nothing else moves); a tile drawn goes into the first empty slot,
// else at the end; a tile taken back goes back to its own slot; dragging moves the tiles among themselves and the empty slots stay put.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(2); } return f(); };

function makeApp(seed) {
  const c = { store: {}, html: '' };
  const root = { set innerHTML(v) { c.html = v; }, get innerHTML() { return c.html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  c.app = G.createApp({ root, rng: mulberry32(seed), paceRng: () => 0, chatRng: () => 1, nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in c.store ? c.store[k] : null), set: (k, v) => { c.store[k] = v; } } });
  c.S = c.app.state; c.d = a => c.app.dispatch(a);
  c.d({ type: 'boot' });
  return c;
}
// the row as drawn: a key for a tile, null for an empty slot (read from the page, not from the program's own state)
const gridOf = html => { const g = (html.match(/<div class="hand-grid" style="--cols:(\d+)">([^]*?)<\/div><\/div>\s*<\/section>/) || []); const cells = []; const re = /<button class="tile-btn[^"]*"[^>]*data-key="([^"]+)"|<div class="slot-empty hole"|<button class="slot-draw|<div class="slot-empty" /g; let m; while ((m = re.exec(g[2] || ''))) { if (m[1]) cells.push(m[1]); else if (/hole/.test(m[0])) cells.push(null); } return { cols: +g[1], cells }; };
const show = cells => cells.map(k => (k === null ? '_' : k)).join(' ');

(async () => {
  console.log('1. a tile is played: its slot stays empty');
  {
    const c = makeApp(3);
    c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    const mk = n => { const all = []; for (let x = 0; x <= 12 && all.length < n; x++) for (let y = x; y <= 12 && all.length < n; y++) all.push([x, y]); return all; };
    const hand = mk(8); c.S.game.players[0].hand = hand.map(t => t.slice()); c.S.handOrder = null; c.app.render(true);
    const g0 = gridOf(c.html), keys0 = g0.cells.slice();
    ok(g0.cells.length === 8 && g0.cells.every(Boolean), 'a fresh hand of 8 is 8 tiles, no empty slots: ' + show(g0.cells));
    const heavy = c.S.game.players[0].hand.slice().sort((x, y) => (y[0] + y[1]) - (x[0] + x[1]) || y[0] - x[0]).map(key);
    ok(keys0.join() === heavy.join(), '(laid out heaviest first, as before)');
    // play the 4th tile
    const gone = keys0[3];
    c.S.game.players[0].hand = c.S.game.players[0].hand.filter(t => key(t) !== gone); c.app.render(true);
    const g1 = gridOf(c.html);
    ok(g1.cells.join() === keys0.map(k => (k === gone ? null : k)).join(), 'the 4th tile is played: its slot is empty and no other tile has moved: ' + show(g1.cells));
    ok(g1.cols === g0.cols, 'and the row is as wide as it was (' + g1.cols + ' across): it does not re-wrap');
    // more are played, including the first and the last
    const gone2 = [keys0[0], keys0[7]];
    c.S.game.players[0].hand = c.S.game.players[0].hand.filter(t => !gone2.includes(key(t))); c.app.render(true);
    const g2 = gridOf(c.html);
    ok(g2.cells.join() === keys0.map(k => (k === gone || gone2.includes(k) ? null : k)).join() && g2.cols === g0.cols, 'the first and the last are played too: three empty slots, the others where they were: ' + show(g2.cells));
    ok((c.html.match(/class="slot-empty hole" aria-hidden="true"/g) || []).length === 3 && (c.html.match(/class="tile-btn /g) || []).length === 5, 'the page draws 3 empty slots and 5 tiles (the empty slots are hidden from a screen reader)');
    ok(/5 tiles/.test(c.html), '(and the count says 5 tiles)');
    // a tile is drawn: it goes into the first empty slot, then the next
    const drawn = [[11, 12], [10, 12], [9, 12], [8, 12]];
    c.S.game.players[0].hand.push(drawn[0].slice()); c.app.render(true);
    const g3 = gridOf(c.html);
    ok(g3.cells[0] === key(drawn[0]) && g3.cells.slice(1).join() === g2.cells.slice(1).join(), 'a drawn tile goes into the FIRST empty slot, and nothing else moves: ' + show(g3.cells));
    c.S.game.players[0].hand.push(drawn[1].slice()); c.app.render(true);
    const g4 = gridOf(c.html);
    ok(g4.cells[3] === key(drawn[1]) && g4.cells[0] === key(drawn[0]), 'the next one goes into the next empty slot (the 4th): ' + show(g4.cells));
    c.S.game.players[0].hand.push(drawn[2].slice()); c.app.render(true);
    const g5 = gridOf(c.html);
    ok(g5.cells[7] === key(drawn[2]) && g5.cells.length === 8 && g5.cells.every(Boolean), 'and the last empty slot is filled by the next: a full row again');
    c.S.game.players[0].hand.push(drawn[3].slice()); c.app.render(true);
    const g6 = gridOf(c.html);
    ok(g6.cells.length === 9 && g6.cells[8] === key(drawn[3]) && g6.cells.slice(0, 8).join() === g5.cells.join(), 'with no empty slot left, a drawn tile goes at the end, and nothing moves');
  }

  console.log('2. a tile taken back goes back to its own slot');
  {
    const c = makeApp(4);
    c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    const hand = [[12, 12], [11, 12], [10, 12], [9, 12], [8, 12], [7, 12], [6, 12], [5, 12]];
    c.S.game.players[0].hand = hand.map(t => t.slice()); c.S.handOrder = null; c.app.render(true);
    const keys0 = gridOf(c.html).cells.slice();
    const t2 = c.S.game.players[0].hand.find(t => key(t) === keys0[2]), t5 = c.S.game.players[0].hand.find(t => key(t) === keys0[5]);
    c.S.game.players[0].hand = c.S.game.players[0].hand.filter(t => key(t) !== keys0[2] && key(t) !== keys0[5]); c.app.render(true);
    ok(gridOf(c.html).cells[2] === null && gridOf(c.html).cells[5] === null, 'two tiles are played (slots 3 and 6 are empty)');
    c.S.game.players[0].hand.push(t5.slice()); c.app.render(true);
    ok(gridOf(c.html).cells.join() === keys0.map((k, i) => (i === 2 ? null : k)).join(), 'the 6th is taken back: it returns to slot 6, not to the first empty slot (3): ' + show(gridOf(c.html).cells));
    c.S.game.players[0].hand.push([3, 3]); c.app.render(true);        // a drawn tile takes the empty slot 3
    ok(gridOf(c.html).cells[2] === key([3, 3]), '(a drawn tile takes slot 3)');
    c.S.game.players[0].hand.push(t2.slice()); c.app.render(true);
    const g = gridOf(c.html);
    ok(g.cells.includes(keys0[2]) && g.cells.length === 9 && g.cells[2] === key([3, 3]), 'the 3rd is taken back, but its slot is taken: it goes at the end, and nothing is pushed out of place: ' + show(g.cells));
    // a fresh hand forgets all of this
    c.S.game.players[0].hand = hand.slice(0, 3).map(t => t.slice()); c.S.handOrder = null; c.app.render(true);
    ok(gridOf(c.html).cells.length === 3 && gridOf(c.html).cells.every(Boolean), 'a new hand (a new round) starts with no empty slots');
  }

  console.log('3. moving tiles about: into an empty slot, or swapping with a tile');
  {
    const c = makeApp(5);
    c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    c.S.game.players[0].hand = [[12, 12], [11, 12], [10, 12], [9, 12], [8, 12], [7, 12]].map(t => t.slice()); c.S.handOrder = null; c.app.render(true);
    const k0 = gridOf(c.html).cells.slice();                                // a b c d e f
    const [A, B, Cc, D, Ee, F] = k0;
    c.S.game.players[0].hand = c.S.game.players[0].hand.filter(t => key(t) !== B && key(t) !== Ee); c.app.render(true);      // a _ c d _ f
    ok(gridOf(c.html).cells.join() === [A, null, Cc, D, null, F].join(), 'a layout with two empty slots: ' + show(gridOf(c.html).cells));
    c.d({ type: 'dragStart', key: A });
    c.d({ type: 'dragMove', index: 1 });
    ok(gridOf(c.html).cells.join() === [null, A, Cc, D, null, F].join(), 'a tile dragged over an empty slot MOVES into it, and the slot it came from is empty: ' + show(gridOf(c.html).cells));
    c.d({ type: 'dragMove', index: 4 });
    ok(gridOf(c.html).cells.join() === [null, null, Cc, D, A, F].join(), 'on to the other empty slot: ' + show(gridOf(c.html).cells));
    c.d({ type: 'dragMove', index: 2 });
    ok(gridOf(c.html).cells.join() === [null, null, A, D, Cc, F].join(), 'over a slot with a tile in it, the two swap places, and no other tile is disturbed: ' + show(gridOf(c.html).cells));
    c.d({ type: 'dragMove', index: 2 });
    ok(gridOf(c.html).cells.join() === [null, null, A, D, Cc, F].join(), '(over the same slot again: nothing changes)');
    c.d({ type: 'dragEnd' });
    ok(gridOf(c.html).cells.join() === [null, null, A, D, Cc, F].join() && c.S.handArranged === true, 'letting go leaves it there, and the hand counts as arranged by you');
    c.d({ type: 'moveTile', key: F, delta: -1 });
    ok(gridOf(c.html).cells.join() === [null, null, A, D, F, Cc].join(), 'the keyboard (Shift + arrow) moves a tile one slot, swapping with the tile there: ' + show(gridOf(c.html).cells));
    c.d({ type: 'moveTile', key: A, delta: -1 });
    ok(gridOf(c.html).cells.join() === [null, A, null, D, F, Cc].join(), 'and into an empty slot: ' + show(gridOf(c.html).cells));
    c.d({ type: 'moveTile', key: A, delta: -1 }); c.d({ type: 'moveTile', key: A, delta: -1 });
    ok(gridOf(c.html).cells.join() === [A, null, null, D, F, Cc].join(), 'to the first slot, where it cannot go further: ' + show(gridOf(c.html).cells));
    c.d({ type: 'moveTile', key: Cc, delta: 1 });
    ok(gridOf(c.html).cells.join() === [A, null, null, D, F, Cc].join(), '(and the last tile cannot go past the last slot)');
    // the same hand, a tile dragged out to play it: the layout is not rearranged by the drag, only the slot it leaves is empty
    c.d({ type: 'dragStart', key: D }); c.d({ type: 'dragMove', index: 1 });
    ok(gridOf(c.html).cells.join() === [A, D, null, null, F, Cc].join(), '(mid-drag it is in the slot under it)');
  }

  console.log('4. a whole real game: no tile of yours ever changes slot, and the row never changes width');
  {
    let total = 0, holeLooks = 0;
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const c = makeApp(seed);
      c.d({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'normal' });
      await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
      let prev = null, steps = 0, moved = 0, widths = new Set(), holesSeen = 0, drawsIntoHole = 0, maxHoles = 0;
      for (let i = 0; i < 400 && !c.S.modal; i++) {
        const a = c.S.awaiting;
        if (a && a.kind === 'move') { const m = a.moves[0]; c.d({ type: 'selectTile', key: key(m.tile) }); if (c.S.awaiting === a) c.d({ type: 'playOn', train: m.trainId }); }
        else if (a && a.kind === 'draw') c.d({ type: 'draw' });
        else if (a && a.kind === 'build') c.d({ type: a.canBuild ? 'autoBuild' : a.canDone ? 'endBuild' : 'undoTile' });
        await wait(3);
        if (!c.S.game || c.S.modal) break;
        const g = gridOf(c.html);
        if (!g.cells.length) continue;
        if (prev) {
          steps++;
          const old = {}; prev.cells.forEach((k, ix) => { if (k) old[k] = ix; });
          g.cells.forEach((k, ix) => { if (k && old[k] !== undefined && old[k] !== ix) moved++; });
          const had = prev.cells.filter(k => k).length, now = g.cells.filter(k => k).length;
          if (now > had) { const filled = g.cells.findIndex((k, ix) => k && old[k] === undefined); if (filled >= 0 && prev.cells[filled] === null && prev.cells.indexOf(null) === filled) drawsIntoHole++; }
        }
        widths.add(g.cols);
        const holes = g.cells.filter(k => k === null).length; maxHoles = Math.max(maxHoles, holes); if (holes) holesSeen++;
        prev = g;
      }
      total += steps;
      ok(steps > 5 && moved === 0, `game ${seed}: through ${steps} steps, no tile of yours ever moved to another slot (${moved} moves); up to ${maxHoles} empty slots at once`);
      holeLooks += holesSeen;
      ok(widths.size <= 2, `game ${seed}: the row stayed the same width (${Array.from(widths).join(', ')} across)`);
    }
    ok(total > 60, `across the games, ${total} steps were checked in all`);
    ok(holeLooks > 30, `and empty slots really were left behind: ${holeLooks} looks at a hand with at least one`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
