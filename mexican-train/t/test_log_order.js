'use strict';
// The messages at the bottom of the game ("You played 8-9 on Ben's train.", ...): the NEWEST on top, the oldest at the bottom.
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
const logItems = html => { const m = html.match(/<section class="log"[^>]*><ol>([^]*?)<\/ol><\/section>/); return m ? Array.from(m[1].matchAll(/<li( class="latest")?>([^]*?)<\/li>/g)).map(x => ({ latest: !!x[1], html: x[2] })) : null; };

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
    ok(items.map(x => x.html).join() === 'g,f,e,d,c' && items.length === 5, 'only the five most recent are shown, the newest at the top and the oldest of the five at the bottom: ' + items.map(x => x.html).join());
    ok((c.html.match(/class="latest"/g) || []).length === 1 && /aria-label="Recent moves, newest first"/.test(c.html), 'exactly one line is the latest, and the list says it is newest first (for a screen reader)');
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
    const items = logItems(c.html), tail = c.S.log.slice(-5).reverse();
    ok(items.map(x => x.html).join('|') === tail.join('|'), 'and the lines below it are the earlier ones, in turn, back in time');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
