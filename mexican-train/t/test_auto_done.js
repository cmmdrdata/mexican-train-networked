'use strict';
// "Build my longest train": when the train is down, the opening is finished for the player (no Done to press), in the game against the computer.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32, key, longestFullChain } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(2); } return f(); };

function makeApp(seed) {
  const c = { screens: [], store: {} };
  const root = { _h: '', set innerHTML(v) { this._h = v; c.screens.push(v); }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  c.app = G.createApp({ root, rng: mulberry32(seed), paceRng: () => 0, chatRng: () => 1, nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in c.store ? c.store[k] : null), set: (k, v) => { c.store[k] = v; } } });
  c.S = c.app.state; c.d = a => c.app.dispatch(a); c.html = () => root._h; c.d({ type: 'boot' });
  return c;
}
// a deal where the human can build a train of at least `min` tiles
async function dealWith(min, hand) {
  for (let seed = 1; seed < 80; seed++) {
    const c = makeApp(seed); c.d({ type: 'startGame', rounds: 1, hand: hand || 15, style: 'pips', level: 'easy' });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    if (c.S.awaiting.canBuild && c.S.awaiting.buildCount >= min) return c;
    c.d({ type: 'newGame' });
  }
  throw new Error('no suitable deal');
}

(async () => {
  console.log('1. the longest train is laid and the opening finishes by itself');
  {
    const c = await dealWith(4);
    const want = c.S.awaiting.buildCount;
    ok(/data-action="autoBuild"[^>]*>Build my longest train/.test(c.html()) && /data-action="endBuild"/.test(c.html()), 'before: the Build button, and a Done button');
    c.d({ type: 'autoBuild' });
    ok(await until(() => c.S.game.opening.human.finished), 'with nothing else pressed, her opening finishes');
    ok(c.S.game.trains.human.tiles.length === want, `with the whole longest train down (${want} tiles)`);
    ok(c.S.log.some(l => new RegExp(`^You finished a train of ${want} tiles\\.`).test(l)), 'and the log says she finished it: "' + c.S.log.find(l => /You finished/.test(l)) + '"');
    await until(() => c.S.game.players.every(p => c.S.game.opening[p.id].finished) && (c.S.modal || (c.S.awaiting && c.S.awaiting.kind !== 'build')));
    ok(!/data-action="endBuild"/.test(c.html()) && !/data-action="autoBuild"/.test(c.html()), 'no Done button (or Build button) is left on the screen');
    ok(c.S.modal || (c.S.awaiting && ['move', 'draw'].includes(c.S.awaiting.kind)), 'and the game goes on to the first turns (or the round ends, if she went out)');
  }
  {
    // started after a short train had been laid by hand: the plan takes tiles back and relays
    const c = await dealWith(4);
    const a = c.S.awaiting, mv = a.moves[a.moves.length - 1];
    c.d({ type: 'selectTile', key: key(mv.tile) });
    await until(() => c.S.awaiting && c.S.awaiting !== a);
    const want = longestFullChain(c.S.game, c.S.game.players[0]).length;
    ok(c.S.awaiting.kind === 'build' && c.S.awaiting.canBuild && want >= 4, 'with one tile laid by hand, a longer train can still be built');
    c.d({ type: 'autoBuild' });
    ok(await until(() => c.S.game.opening.human.finished) && c.S.game.trains.human.tiles.length === want, `"Build my longest train" (taking that tile back if need be) ends with the longest train (${want}) and the opening finished`);
  }
  console.log('2. when it must NOT finish by itself');
  {
    const c = await dealWith(4);
    c.d({ type: 'autoBuild' });
    c.S.plan.unshift({ type: 'play', key: '99-99' });          // something unexpected happens to the plan
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build' && c.S.plan === null);
    ok(c.S.awaiting.kind === 'build' && !c.S.game.opening.human.finished, 'a plan that goes wrong hands control back to the player, who is asked what to do');
    ok(/data-action="endBuild"/.test(c.html()), '...with the Done button there');
    c.d({ type: 'endBuild' });
    ok(await until(() => c.S.game.opening.human.finished), '(and Done still works by hand)');
  }
  {
    const c = await dealWith(2);
    const a = c.S.awaiting;
    c.d({ type: 'selectTile', key: key(a.moves[0].tile) });                // one tile by hand, no Build
    await until(() => c.S.awaiting && c.S.awaiting !== a);
    await wait(30);
    ok(!c.S.game.opening.human.finished && c.S.awaiting && c.S.awaiting.kind === 'build', 'laying tiles by hand never finishes the opening: that is still done with the Done button');
  }
  {
    const c = await dealWith(4);
    c.d({ type: 'setAllowHints', value: false });
    ok(!/data-action="autoBuild"/.test(c.html()), 'with hints off there is no Build my longest train button, so nothing finishes by itself');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
