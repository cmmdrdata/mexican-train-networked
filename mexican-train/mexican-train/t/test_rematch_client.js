'use strict';

// Playing again, with real pages against a real server: what the final dialog offers, what each person is told, and a new game that really is new.
require('./game.js');
const G = globalThis.MexicanTrainGame;
const { mulberry32, key } = G.Engine;
const { createGameServer } = require('../server.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(4); } return f(); };
const PAGE = require('path').join(__dirname, '..', 'mexican-train.html');

async function startServer(opts) {
  const srv = createGameServer(Object.assign({ pagePath: PAGE, stepDelay: 0, sleep: async () => {}, log: () => {}, heartbeatMs: 60000, softGraceMs: 0, ratePerSecond: 5000, burst: 10000 }, opts));
  return { srv, port: await srv.listen(0, '127.0.0.1') };
}
function makeClient(port, opts) {
  opts = opts || {};
  const c = { screens: [], flights: [], clacks: 0, turns: 0, turnAt: [], store: {}, port };
  const root = { _h: '', set innerHTML(v) { this._h = v; c.screens.push(v); }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const R0 = { left: 10, top: 10, width: 40, height: 20 };
  const fx = { capture: () => ({ from: R0 }), land: (tok, spec) => c.flights.push(['play', spec]), captureDraw: () => ({ from: R0 }), landDraw: (tok, spec) => c.flights.push(['draw', spec]), reapply() {}, cancelAll() {} };
  const Base = opts.WebSocket || WebSocket;
  c.statesReceived = 0;
  const WS = function (url) { const s = opts.factory ? opts.factory(url, Base) : new Base(url); if (s.addEventListener) s.addEventListener('message', e => { try { if (JSON.parse(e.data).t === 'state') c.statesReceived++; } catch (x) { /* ignore */ } }); return s; };
  WS.prototype = Base.prototype;
  const app = G.createApp({ root, rng: mulberry32(1), sleep: async () => {}, reducedMotion: false, now: () => Date.now(), chatRng: () => 1, nativeChance: 0, foodChance: 0,
    storage: { get: k => (k in c.store ? c.store[k] : null), set: (k, v) => { c.store[k] = v; } }, fetch: opts.fetch || globalThis.fetch, infoUrl: `http://127.0.0.1:${port}/info`, WebSocket: WS, fx, sound: { unlock() {}, clack() { c.clacks++; }, turn() { c.turns++; c.turnAt.push(c.S.online ? c.S.online.applied : 0); } }, defaultServer: `127.0.0.1:${port}` });
  c.app = app; c.S = app.state; c.html = () => root.innerHTML; c.dispatch = a => app.dispatch(a);
  app.dispatch({ type: 'boot' });
  return c;
}
const infoStub = addr => async () => ({ ok: true, json: async () => ({ addresses: [addr], preferred: addr }) });
const hostInfoReady = async c => { c.dispatch({ type: 'openHost' }); await until(() => c.S.hostInfo && c.S.hostInfo.state === 'ready'); };
// Which colour each player's toy train had on every screen a client drew. The expected colours come from the table seats
// (host 0 red, guest 1 blue, computer 2 yellow), known here independently of the page: the same on every screen.
const SEAT_COLOUR = { 0: 'c0', 1: 'c1', 2: 'c2' };
function colourCheck(client, selfName, expected) {
  const bad = [], seen = {};
  for (const html of client.screens) {
    for (const blk of html.split(/<div class="track(?=[ "])/).slice(1)) {
      const toy = (blk.match(/class="toy-train (c\d)"/) || [])[1]; if (!toy) continue;
      const label = (blk.match(/class="track-name">([^<]*)</) || [])[1] || '';
      const owner = label === 'Your train' ? selfName : label.replace(/'s train$/, '');
      seen[owner] = (seen[owner] || 0) + 1;
      if (expected[owner] !== toy) bad.push(`${owner}'s train was ${toy}, expected ${expected[owner]}`);
    }
  }
  return { bad, seen };
}
const inGame = c => !!(c.S.online && c.S.online.phase === 'playing' && c.S.game);
function actions(c, rnd) {
  const S = c.S, a = S.awaiting, o = S.online;
  if (!a || !o || o.pending || o.conn !== 'open') return false;
  const d = x => c.dispatch(x);
  if (a.kind === 'modal') { d({ type: 'dialogOk' }); return true; }
  if (a.kind === 'draw') { d({ type: 'draw' }); return true; }
  const pick = () => a.moves[Math.floor(rnd() * a.moves.length)];
  const tap = () => { const m = pick(); d({ type: 'selectTile', key: key(m.tile) }); if (c.S.awaiting === a && !o.pending) d({ type: 'playOn', train: m.trainId }); };
  if (a.kind === 'move') { tap(); return true; }
  if (a.canDraw) { d({ type: 'draw' }); return true; }
  if (a.canBuild && rnd() < 0.25) { d({ type: 'autoBuild' }); return true; }
  if (a.moves.length && rnd() < 0.7) { tap(); return true; }
  if (a.canDone && rnd() < 0.5) { d({ type: 'endBuild' }); return true; }
  if (a.canUndo && rnd() < 0.3) { d({ type: 'undoTile' }); return true; }
  if (a.canDone) { d({ type: 'endBuild' }); return true; }
  if (a.moves.length) { tap(); return true; }
  d({ type: 'undoTile' }); return true;
}
async function playBoth(cs, rnds, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 40000)) {
    if (cs.every(c => c.S.modal && c.S.modal.type === 'final')) return true;
    if (cs.some(c => c.S.online && c.S.online.ended)) return false;
    let acted = false;
    cs.forEach((c, i) => { if (actions(c, rnds[i])) acted = true; });
    await wait(acted ? 2 : 6);
  }
  return false;
}


const rowsOf = html => ({ buttons: Array.from(html.matchAll(/<button[^>]*data-action="(playAgainOnline|onlineBack)"[^>]*>([^<]*)<\/button>/g)).map(m => m[2]), disabled: /<button class="btn primary" disabled>/.test(html), status: ((html.match(/<p role="status">([^<]*)<\/p>/) || [, ''])[1]).replace(/&#39;/g, "'") });
async function table(port, names, extra) {                           // pages for the people at one table, in the lobby, started
  const cs = names.map(() => makeClient(port));
  cs[0].dispatch({ type: 'openHost' }); await hostInfoReady(cs[0]);
  cs[0].dispatch(Object.assign({ type: 'hostGame', server: `127.0.0.1:${port}`, name: names[0], rounds: 1, hand: 8, computer: names.length === 3 ? 'person' : 'none' }, extra || {}));
  await until(() => cs[0].S.online && cs[0].S.online.phase === 'lobby' && cs[0].S.online.code);
  for (let i = 1; i < names.length; i++) { cs[i].dispatch({ type: 'openJoin' }); cs[i].dispatch({ type: 'joinGame', server: `127.0.0.1:${port}`, name: names[i], code: cs[0].S.online.display }); await until(() => cs[i].S.online && cs[i].S.online.phase === 'lobby' && cs[i].S.online.players[cs[i].S.online.seat]); }
  await until(() => cs[0].S.online.canStart);
  cs[0].dispatch({ type: 'startOnline' });
  await until(() => cs.every(inGame));
  await until(() => cs.every(c => c.S.awaiting));
  return cs;
}
let seed = 1;
const play = (cs) => playBoth(cs, cs.map(() => mulberry32(seed++ * 7)), 60000);
const handOf = c => JSON.stringify(c.S.game.players[0].hand);

(async () => {
  const A = await startServer({ publicIp: false });

  console.log('1. two people');
  {
    const [ann, ben] = await table(A.port, ['Ann', 'Ben']);
    const code = ann.S.online.code, room = () => A.srv.rooms.get(code);
    const firstHand = handOf(ann);
    ann.dispatch({ type: 'playAgainOnline' });
    ok(!room().again.size, 'a page that is not at its final dialog sends nothing when told to play again (so it cannot jump the queue)');
    ok(await play([ann, ben]), 'the two play a one-round game to its final score');
    let r = rowsOf(ann.html());
    ok(r.buttons.join() === 'Back to the menu,Play again' && !r.disabled && r.status === '', 'the final dialog offers "Play again" as well as "Back to the menu" (and says nothing about anyone yet)');
    ok(/data-action="playAgainOnline" data-primary="1"/.test(ann.html()) && !/data-action="onlineBack" data-primary/.test(ann.html()), '"Play again" is the main button');
    ann.dispatch({ type: 'playAgainOnline' });
    await until(() => ben.S.online.again && ben.S.online.again.asked.length === 1);
    r = rowsOf(ann.html());
    ok(r.status === 'You would like to play again. Waiting for Ben...' && r.buttons.join() === 'Back to the menu' && r.disabled, 'Ann presses it: she sees that she is waiting for Ben, and the button cannot be pressed again');
    ann.dispatch({ type: 'playAgainOnline' }); await wait(60);
    ok(room().again.size === 1, '(pressing it again changes nothing)');
    r = rowsOf(ben.html());
    ok(r.status === 'Ann wants to play again.' && r.buttons.join() === 'Back to the menu,Play again' && !r.disabled, 'Ben is told Ann wants to play again, and can say yes');
    ben.dispatch({ type: 'playAgainOnline' });
    await until(() => [ann, ben].every(c => !c.S.modal && c.S.awaiting && c.S.roundIndex === 0 && c.S.online.applied > 0 && handOf(c) !== undefined) && handOf(ann) !== firstHand, 5000);
    ok([ann, ben].every(c => !c.S.modal && c.S.online.phase === 'playing' && !/<h2 id="dlg-title">/.test(c.html())), 'Ben presses it: the final dialog goes away on both pages and a new game is on the table');
    ok([ann, ben].every(c => c.S.totals.human === 0 && c.S.totals.cpu === 0 && c.S.roundIndex === 0 && c.S.game.players[0].hand.length === 8), 'with nothing scored, at round one, with a new deal of 8 tiles each: ' + handOf(ann).slice(0, 40));
    ok(handOf(ann) !== firstHand && ann.S.online.seat === 0 && ben.S.online.seat === 1 && ann.S.opps[0].name === 'Ben' && ben.S.opps[0].name === 'Ann', 'the same people in the same seats, with different tiles from the first game');
    ok(!ann.S.online.again && !ann.S.online.againSent, '(and nobody is still "asking")');
    ok(await play([ann, ben]), 'the second game is played to its end on the pages: the new game\'s updates are not mistaken for old ones');
    r = rowsOf(ann.html());
    ok(r.buttons.join() === 'Back to the menu,Play again' && r.status === '', 'and its final dialog offers to play again too');
    ben.dispatch({ type: 'onlineBack' });
    await until(() => ann.S.online && ann.S.online.again && ann.S.online.again.gone.length === 1);
    r = rowsOf(ann.html());
    ok(r.status === 'Ben has left, so there is nobody to play again with.' && r.buttons.join() === 'Back to the menu' && /data-action="onlineBack" data-primary="1"/.test(ann.html()), 'Ben goes back to the menu: Ann is told he has left, and can only go back to the menu');
    ann.dispatch({ type: 'confirmLeave' });
  }

  console.log('2. one is quicker than the other');
  {
    const [ann, ben] = await table(A.port, ['Ann', 'Ben']);
    const code = ann.S.online.code;
    // Ann and Ben play; Ann gets her final score first (Ben is left at his last dialog)
    const t0 = Date.now();
    const ra = mulberry32(1), rb = mulberry32(2), atDialog = c => !!(c.S.awaiting && c.S.awaiting.kind === 'modal');
    while (Date.now() - t0 < 60000 && !(ann.S.modal && ann.S.modal.type === 'roundEnd' && ben.S.modal && ben.S.modal.type === 'roundEnd')) {
      if (!atDialog(ann)) actions(ann, ra);                                   // (a page that has reached its last dialog waits there: the test presses it, not the driver)
      if (!atDialog(ben)) actions(ben, rb);
      await wait(3);
    }
    ok(ann.S.modal && ann.S.modal.type === 'roundEnd' && ben.S.modal && ben.S.modal.type === 'roundEnd', '(both have reached their last-round dialog)');
    ann.dispatch({ type: 'dialogOk' });
    await until(() => ann.S.modal && ann.S.modal.type === 'final');
    ann.dispatch({ type: 'playAgainOnline' });
    await until(() => ben.S.online.again && ben.S.online.again.asked.length === 1);
    ok(ben.S.modal.type === 'roundEnd' && ben.S.modal.last === true, '(Ben is still at his last-round dialog)');
    ben.dispatch({ type: 'dialogOk' });
    await until(() => ben.S.modal && ben.S.modal.type === 'final');
    const r = rowsOf(ben.html());
    ok(r.status === 'Ann wants to play again.' && r.buttons.join() === 'Back to the menu,Play again', 'when Ben gets his final score he is already told that Ann wants to play again');
    ben.dispatch({ type: 'playAgainOnline' });
    await until(() => !ann.S.modal && !ben.S.modal && ann.S.awaiting && ben.S.awaiting, 5000);
    ok(!ann.S.modal && !ben.S.modal && inGame(ann) && inGame(ben), 'and a new game starts');
    ann.dispatch({ type: 'confirmLeave' }); ben.dispatch({ type: 'confirmLeave' });
  }

  console.log('3. three people');
  {
    const [ann, ben, cat] = await table(A.port, ['Ann', 'Ben', 'Cat']);
    ok(await play([ann, ben, cat]), 'three people play to the final score');
    ann.dispatch({ type: 'playAgainOnline' });
    await until(() => cat.S.online.again && cat.S.online.again.asked.length === 1);
    ok(rowsOf(ben.html()).status === 'Ann wants to play again.' && rowsOf(cat.html()).status === 'Ann wants to play again.', 'Ann asks: Ben and Cat are both told');
    ok(rowsOf(ann.html()).status === 'You would like to play again. Waiting for Ben and Cat...', 'and Ann sees that she is waiting for both: ' + rowsOf(ann.html()).status);
    ben.dispatch({ type: 'playAgainOnline' });
    await until(() => cat.S.online.again.asked.length === 2);
    ok(rowsOf(cat.html()).status === 'Ann and Ben want to play again.' && rowsOf(ann.html()).status === 'You would like to play again. Waiting for Cat...', 'Ben asks: Cat is told that Ann and Ben want to play again, and Ann that she is waiting for Cat');
    ok(inGame(ann) && ann.S.modal && ann.S.modal.type === 'final', '(nothing starts yet)');
    cat.dispatch({ type: 'playAgainOnline' });
    await until(() => [ann, ben, cat].every(c => !c.S.modal && c.S.awaiting), 5000);
    ok([ann, ben, cat].every(c => !c.S.modal && c.S.opps.length === 2 && c.S.totals.human === 0), 'Cat asks: all three are in a new game');
    ann.dispatch({ type: 'confirmLeave' }); ben.dispatch({ type: 'confirmLeave' }); cat.dispatch({ type: 'confirmLeave' });
  }

  console.log('4. with a computer player');
  {
    const [ann, ben] = await table(A.port, ['Ann', 'Ben'], { computer: 'hard' });
    const cpuName = ann.S.opps.find(o => o.computer).name;
    ok(await play([ann, ben]), 'two people and a computer play to the final score');
    ok(rowsOf(ann.html()).buttons.join() === 'Back to the menu,Play again', 'the dialog offers to play again');
    ann.dispatch({ type: 'playAgainOnline' }); ben.dispatch({ type: 'playAgainOnline' });
    await until(() => [ann, ben].every(c => !c.S.modal && c.S.awaiting), 5000);
    ok([ann, ben].every(c => !c.S.modal && c.S.opps.find(o => o.computer) && c.S.opps.find(o => o.computer).name === cpuName), 'once the two people have asked, the game starts again against the same computer player, ' + cpuName);
    ann.dispatch({ type: 'confirmLeave' }); ben.dispatch({ type: 'confirmLeave' });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
