'use strict';
// The game's history at the bottom of the game ("You played 8-9 on Ben's train.", ...): every message of the game so far, the NEWEST on top and the oldest further down (it scrolls),
// kept from round to round, with the start of each round picked out.
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
const logItems = html => { const m = html.match(/<section class="log"[^>]*><ol>([^]*?)<\/ol><\/section>/); return m ? Array.from(m[1].matchAll(/<li(?: class="([^"]*)")?>([^]*?)<\/li>/g)).map(x => ({ latest: /\blatest\b/.test(x[1] || ''), round: /\bround\b/.test(x[1] || ''), html: x[2] })) : null; };

(async () => {
  console.log('1. the order');
  {
    const c = makeApp(3);
    c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    c.S.log = ['one', 'two', 'three'];
    c.d({ type: 'toggleStyle' }); c.d({ type: 'toggleStyle' });                   // (a redraw)
    let items = logItems(c.html);
    ok(items && items.map(x => x.html).join() === 'three,two,one', 'three messages are shown newest first: ' + (items && items.map(x => x.html).join()));
    ok(items.map(x => x.latest).join() === 'true,false,false', 'the highlight is on the newest, which is now the top line');
    c.S.log = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    c.d({ type: 'toggleStyle' }); c.d({ type: 'toggleStyle' });
    items = logItems(c.html);
    ok(items.map(x => x.html).join() === 'g,f,e,d,c,b,a' && items.length === 7, 'ALL seven are shown (not just the latest five), the newest at the top and the oldest at the bottom: ' + items.map(x => x.html).join());
    ok(items.filter(x => x.latest).length === 1 && items[0].latest && /aria-label="Game history, newest first\. Scroll to see earlier moves\."/.test(c.html), 'exactly one line is the latest, and the panel says it is the game\'s history, newest first (for a screen reader)');
    ok(/<section class="log" role="region" tabindex="0"/.test(c.html), 'the panel can be given the focus (tabindex 0, a region), so that it can be scrolled from the keyboard');
    c.S.log = Array.from({ length: 700 }, (_, i) => 'l' + i);
    c.d({ type: 'toggleStyle' }); c.d({ type: 'toggleStyle' });
    items = logItems(c.html);
    ok(items.length === 600 && items[0].html === 'l699' && items[599].html === 'l100', 'a very long game: the latest 600 lines are drawn (l699 down to l100), so that the page does not get heavy');
    c.S.log = ['one', 'Round 2: the engine is double-11. Everyone builds their train at the same time.', 'two'];
    c.d({ type: 'toggleStyle' }); c.d({ type: 'toggleStyle' });
    items = logItems(c.html);
    ok(items.map(x => x.round).join() === 'false,true,false' && items[1].html.startsWith('Round 2:') && items[0].latest && !items[1].latest, 'the line that starts a round is picked out (class round), the others are not');
    c.S.log = ['one', 'Round 3: the engine is double-10. Everyone builds their train at the same time.'];
    c.d({ type: 'toggleStyle' }); c.d({ type: 'toggleStyle' });
    items = logItems(c.html);
    ok(items[0].latest && items[0].round, 'and when the newest line is a round\'s start it is both the latest and a round start');
    c.S.log = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    ok(c.S.log.join() === 'a,b,c,d,e,f,g', '(the log itself is still kept oldest first: only how it is drawn changed)');
    c.S.log = [];
    c.d({ type: 'toggleStyle' }); c.d({ type: 'toggleStyle' });
    ok(logItems(c.html).length === 0, 'and with nothing to say the list is empty');
  }
  console.log('2. in a real game');
  {
    const c = makeApp(5);
    c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    c.d({ type: c.S.awaiting.canBuild ? 'autoBuild' : 'endBuild' });
    await until(() => c.S.log.length >= 4, 6000);
    const seen = [];
    for (let i = 0; i < 40 && !c.S.modal; i++) {
      const a = c.S.awaiting;
      if (a && a.kind === 'move') c.d({ type: 'selectTile', key: key(a.moves[0].tile) });
      else if (a && a.kind === 'draw') c.d({ type: 'draw' });
      else if (a && a.kind === 'build') c.d({ type: a.canDone ? 'endBuild' : 'undoTile' });
      await wait(15);
      const items = logItems(c.html);
      if (items && items.length) seen.push({ top: items[0].html, newest: c.S.log[c.S.log.length - 1], n: items.length, latest: items[0].latest });
    }
    ok(seen.length > 10 && seen.every(x => x.top === x.newest && x.latest), `through ${seen.length} redraws of a real game the top line is always the newest message (${seen.slice(-1)[0] && seen.slice(-1)[0].top.replace(/<[^>]*>/g, '')})`);
    const items = logItems(c.html), tail = c.S.log.slice(-600).reverse();
    ok(items.map(x => x.html).join('|') === tail.join('|') && items.length === c.S.log.length, `and below it are all the earlier ones, in turn, back in time: all ${items.length} lines of the game so far, not five`);
    ok(items.length > 10, '(a real game soon has far more than five)');
  }
  console.log('3. from round to round');
  {
    const c = makeApp(8);
    c.d({ type: 'startGame', rounds: 2, hand: 8, style: 'pips', level: 'easy' });
    let sawRound2 = false, before = 0;
    for (let i = 0; i < 9000 && !sawRound2; i++) {
      await wait(1); const a = c.S.awaiting;
      if (c.S.roundIndex === 1 && c.S.log.some(l => /^Round 2:/.test(l))) { sawRound2 = true; break; }
      if (!a) continue;
      if (a.kind === 'modal') { before = c.S.log.length; c.d({ type: 'dialogOk' }); }
      else if (a.kind === 'draw') c.d({ type: 'draw' });
      else if (a.kind === 'build') { if (a.canDraw) c.d({ type: 'draw' }); else if (a.canBuild) c.d({ type: 'autoBuild' }); else if (a.canDone) c.d({ type: 'endBuild' }); else c.d({ type: 'undoTile' }); }
      else { const m = a.moves[0]; c.d({ type: 'selectTile', key: key(m.tile) }); if (c.S.awaiting === a) c.d({ type: 'playOn', train: m.trainId }); }
    }
    const r1 = c.S.log.findIndex(l => /^Round 1:/.test(l)), r2 = c.S.log.findIndex(l => /^Round 2:/.test(l));
    ok(sawRound2 && r1 === 0 && r2 > 10 && c.S.log.length > before, `the second round does not wipe the history: the first round's lines are still there (round 1 begins at line ${r1}, round 2 at line ${r2} of ${c.S.log.length})`);
    const items = logItems(c.html);
    ok(items.filter(x => x.round).length === 2 && items.length === c.S.log.length, 'and both rounds\' beginnings are picked out in the panel');
    c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    await wait(30);
    ok(c.S.log.filter(l => /^Round 1:/.test(l)).length === 1 && !c.S.log.some(l => /^Round 2:/.test(l)) && c.S.log.length < 15, 'a NEW game starts with a clean history');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
