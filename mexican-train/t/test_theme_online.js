'use strict';
require('./game.js');
const G = globalThis.MexicanTrainGame;
const { mulberry32, key } = G.Engine;
const { createGameServer } = require('../server.js');
const OM = require('../online-match.js').OnlineMatch;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(4); } return f(); };
const canon = t => [Math.min(t[0], t[1]), Math.max(t[0], t[1])];
const PAGE = require('path').join(__dirname, '..', 'mexican-train.html');

/* The engine's own record of turns (see test_online_client): prompts to people, passes, and the computer's choices. */
const log = new Map();
const note = (m, e) => { if (!log.has(m)) log.set(m, []); log.get(m).push(e); };
const realWait = OM.prototype._wait;
OM.prototype._wait = function (seat, kind, extra) { if (kind === 'move' || kind === 'draw') note(this, { seat, prompt: true, kind, seq: this.seq + 1 }); return realWait.call(this, seat, kind, extra); };
const realHooks = OM.prototype._makeHooks;
OM.prototype._makeHooks = function () { const h = realHooks.call(this), op = h.onPass; h.onPass = async (g, p) => { note(this, { seat: this._seat(p), prompt: false, pass: true, seq: this.seq + 1 }); return op(g, p); }; return h; };
const realController = OM.prototype._controller;
OM.prototype._controller = function (seat) {
  const c = realController.call(this, seat);
  if (this.computers[seat]) { const ch = c.choose; c.choose = async (g, p, moves) => { note(this, { seat, prompt: false, computer: true, seq: this.seq + 1 }); return ch(g, p, moves); }; }
  return c;
};
const turnsOf = (srv, code, seat) => { const seq = log.get(srv.rooms.get(code).match) || []; let n = 0; seq.forEach((e, i) => { if (e.prompt && e.seat === seat && !(i > 0 && seq[i - 1].seat === seat)) n++; }); return n; };

async function startServer(opts) {
  const srv = createGameServer(Object.assign({ pagePath: PAGE, stepDelay: 0, sleep: async () => {}, log: () => {}, heartbeatMs: 60000, ratePerSecond: 5000, burst: 10000 }, opts));
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
async function lobby(port, settings, level) {
  const host = makeClient(port), guest = makeClient(port);
  host.dispatch({ type: 'openHost' });
  await hostInfoReady(host); host.dispatch(Object.assign({ type: 'hostGame', server: `127.0.0.1:${port}`, name: 'Ann', rounds: 1, hand: 8, computer: level }, settings || {}));
  await until(() => host.S.online && host.S.online.phase === 'lobby' && host.S.online.code);
  guest.dispatch({ type: 'openJoin' });
  guest.dispatch({ type: 'joinGame', server: `127.0.0.1:${port}`, name: 'Ben', code: host.S.online.display });
  await until(() => guest.S.online && guest.S.online.phase === 'lobby' && guest.S.online.players[1]);
  await until(() => host.S.online.canStart);
  return { host, guest };
}


const T = G.THEMES.lotr;
class Raw {
  constructor(port) { this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); this.q = []; this.ws.onmessage = e => this.q.push(JSON.parse(e.data)); }
  open() { return new Promise(r => { this.ws.onopen = r; }); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async next(pred, ms) { const m = await until(() => { const i = this.q.findIndex(pred); return i >= 0 ? this.q.splice(i, 1)[0] : null; }, ms || 3000); return m; }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}
async function raw(port) { const c = new Raw(port); await c.open(); await c.next(m => m.t === 'hello'); return c; }
const lastLobby = async c => { let m = await c.next(x => x.t === 'lobby'); for (;;) { const n = await c.next(x => x.t === 'lobby', 150); if (!n) return m; m = n; } };
const compName = l => (l.players.find(p => p && p.computer) || {}).name;
const ringsAndTrains = c => { let rings = 0, trains = 0; c.screens.forEach(h => { if (/toy-train ring/.test(h)) rings++; if (/<span class="toy-train c\d"/.test(h)) trains++; }); return { rings, trains }; };

(async () => {
  const A = await startServer({});

  console.log('1. the server: the theme is part of the game settings');
  {
    const h = await raw(A.port);
    h.send({ t: 'create', name: 'Ann', rounds: 1, hand: 8, computer: 'hard' });
    const cr = await h.next(m => m.t === 'created');
    const l = await lastLobby(h);
    ok(cr.settings.theme === 'classic' && l.settings.theme === 'classic' && G.CPU_PLAYERS.hard.includes(compName(l)), `with no theme asked for, Classic and a classic Hard player (${compName(l)})`);
    h.send({ t: 'settings', theme: 'lotr' });
    let l2 = await lastLobby(h);
    ok(l2.settings.theme === 'lotr' && T.players.hard.includes(compName(l2)), `the host switches to The Lord of the Rings: the computer becomes a Hard character (${compName(l2)})`);
    h.send({ t: 'settings', computer: 'easy' });
    const l3 = await lastLobby(h);
    ok(l3.settings.theme === 'lotr' && T.players.easy.includes(compName(l3)), `a new level keeps the theme: an Easy character (${compName(l3)})`);
    h.send({ t: 'settings', rounds: 4 });
    const l4 = await lastLobby(h);
    ok(compName(l4) === compName(l3) && l4.settings.theme === 'lotr', 'changing something else keeps the same character');
    h.send({ t: 'settings', theme: 'narnia' });
    const l5 = await lastLobby(h);
    ok(l5.settings.theme === 'lotr' && compName(l5) === compName(l3), 'an unknown theme is ignored');
    h.send({ t: 'settings', theme: 'classic' });
    const l6 = await lastLobby(h);
    ok(l6.settings.theme === 'classic' && G.CPU_PLAYERS.easy.includes(compName(l6)), `and back to Classic: a classic Easy player (${compName(l6)})`);
    const g = await raw(A.port);
    g.send({ t: 'join', code: cr.code, name: 'Ben' });
    const j = await g.next(m => m.t === 'joined');
    ok(j.settings.theme === 'classic', 'the guest is told the theme when joining');
    g.send({ t: 'settings', theme: 'lotr' });
    const refused = await g.next(m => m.t === 'error');
    ok(refused && refused.code === 'not_allowed', 'only the host can change it');
    h.close(); g.close();
  }
  {
    const h = await raw(A.port);
    h.send({ t: 'create', name: 'Ann', rounds: 1, hand: 8, computer: 'normal', theme: 'lotr' });
    const cr = await h.next(m => m.t === 'created');
    const l = await lastLobby(h);
    ok(cr.settings.theme === 'lotr' && T.players.normal.includes(compName(l)), `a game created with the theme has a Medium character from the start (${compName(l)})`);
    h.close();
    const b = await raw(A.port);
    b.send({ t: 'create', name: 'Ann', theme: { evil: 1 } });
    const cb = await b.next(m => m.t === 'created');
    ok(cb.settings.theme === 'classic', 'a nonsense theme when creating means Classic');
    b.close();
    const n = await raw(A.port);
    n.send({ t: 'create', name: 'Sam', computer: 'normal', theme: 'lotr' });
    await n.next(m => m.t === 'created');
    let clash = 0;
    for (let i = 0; i < 30; i++) { n.send({ t: 'settings', computer: i % 2 ? 'easy' : 'normal' }); const li = await lastLobby(n); if (compName(li) === 'Sam') clash++; }
    ok(clash === 0, 'a host called Sam never faces a computer Sam');
    n.close();
  }

  console.log('2. the page: hosting with a theme');
  {
    const c = makeClient(A.port);
    c.dispatch({ type: 'openHost' });
    let h = c.html();
    ok(/<select id="net-theme">/.test(h) && /<option value="classic" selected>Classic<\/option>/.test(h) && /<option value="lotr">The Lord of the Rings<\/option>/.test(h), 'the Host screen has a Theme choice, Classic by default');
    c.dispatch({ type: 'closeOverlay' });
    const d = makeClient(A.port);
    d.dispatch({ type: 'startGame', rounds: 1, hand: 8, level: 'easy', theme: 'lotr' });
    d.dispatch({ type: 'newGame' }); d.dispatch({ type: 'openHost' });
    ok(/<option value="lotr" selected>The Lord of the Rings<\/option>/.test(d.html()) && /id="net-theme"/.test(d.html()), 'it starts on the theme you play against the computer with');
    d.dispatch({ type: 'closeOverlay' });
  }

  console.log('3. whole online games with the theme');
  let rings = 0, trains = 0, names = [];
  for (let k = 0; k < 4; k++) {
    const { host, guest } = await lobby(A.port, { theme: 'lotr', rounds: 1, hand: 15 }, ['easy', 'normal', 'hard', 'hard'][k]);
    const comp = host.S.online.players[2];
    names.push(comp && comp.name);
    ok(host.S.online.settings.theme === 'lotr' && guest.S.online.settings.theme === 'lotr', `game ${k + 1}: both players know the theme`);
    ok(comp && T.players[['easy', 'normal', 'hard', 'hard'][k]].includes(comp.name), `game ${k + 1}: the computer is ${comp && comp.name}`);
    if (k === 0) {
      const gh = guest.html();
      ok(/theme: The Lord of the Rings/.test(gh), 'the guest\'s lobby says which theme the host chose');
      ok(/<select id="net-theme">[^]*<option value="lotr" selected>/.test(host.html()), 'the host\'s lobby can still change it');
    }
    host.dispatch({ type: 'startOnline' });
    const done = await playBoth([host, guest], [mulberry32(k + 5), mulberry32(k + 50)], 60000);
    ok(done, `game ${k + 1}: played to the end`);
    [host, guest].forEach(c => { const r = ringsAndTrains(c); rings += r.rings; trains += r.trains; });
    ok([host, guest].every(c => c.screens.some(h => h.includes('Double-12 online, in Middle-earth'))), `game ${k + 1}: both headers say Middle-earth`);
    host.dispatch({ type: 'onlineBack' }); guest.dispatch({ type: 'onlineBack' });
  }
  ok(rings > 0 && trains === 0, `open trains wore the golden ring on both players' screens (${rings} screens), never a toy train`);

  console.log('4. the host changes the theme in the lobby');
  {
    const { host, guest } = await lobby(A.port, { rounds: 1, hand: 8 }, 'hard');
    ok(G.CPU_PLAYERS.hard.includes(host.S.online.players[2].name), 'a classic Hard player to begin with');
    host.dispatch({ type: 'onlineSettings', rounds: 1, hand: 8, computer: 'hard', theme: 'lotr' });
    await until(() => guest.S.online.settings.theme === 'lotr' && T.players.hard.includes((guest.S.online.players[2] || {}).name));
    ok(guest.S.online.settings.theme === 'lotr' && T.players.hard.includes(guest.S.online.players[2].name), `the guest sees the switch at once: ${guest.S.online.players[2].name}`);
    host.dispatch({ type: 'confirmLeave' }); guest.dispatch({ type: 'confirmLeave' });
  }

  console.log('5. Classic online games are unchanged');
  {
    const { host, guest } = await lobby(A.port, { rounds: 1, hand: 15 }, 'normal');
    ok(G.CPU_PLAYERS.normal.includes(host.S.online.players[2].name), 'a classic computer player');
    host.dispatch({ type: 'startOnline' });
    await playBoth([host, guest], [mulberry32(91), mulberry32(92)], 60000);
    const r = [host, guest].map(ringsAndTrains);
    ok(r.every(x => x.rings === 0), 'no rings');
    const subs = c => c.screens.map(h => (h.match(/<p class="sub">([^<]*)</) || [])[1]).filter(Boolean);
    ok([host, guest].every(c => subs(c).includes('Double-12 online') && !subs(c).some(x => /Middle-earth/.test(x))), 'and the usual header');
    // a page that plays The Lord of the Rings against the computer still shows a classic online game as classic
    const p = makeClient(A.port);
    p.dispatch({ type: 'startGame', rounds: 1, hand: 8, level: 'easy', theme: 'lotr' });
    p.dispatch({ type: 'newGame' });
    ok(p.S.opts.theme === 'lotr', '(a player whose own setting is the theme...)');
    const { host: h2, guest: g2 } = await lobby(A.port, { rounds: 1, hand: 15 }, 'easy');
    ok(h2.S.online.settings.theme === 'classic', '...hosting a Classic game gets Classic: the host\'s choice for this game decides, not the saved setting');
    h2.dispatch({ type: 'confirmLeave' }); g2.dispatch({ type: 'confirmLeave' });
  }

  A.srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
