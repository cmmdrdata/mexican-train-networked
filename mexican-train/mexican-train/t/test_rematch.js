'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createGameServer, lanAddresses, addressRank, sortAddresses, normalizeCode, showCode, CODE_ALPHABET } = require('../server.js');
const E = require('../online-match.js');
const G = globalThis.MexicanTrainGame.Engine;
const G2 = globalThis.MexicanTrainGame;
const { mulberry32, key } = G;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(5); } return f(); };
const PAGE = path.join(__dirname, '..', 'mexican-train.html');
const canon = t => [Math.min(t[0], t[1]), Math.max(t[0], t[1])];

/* ---------------------------------- helpers ---------------------------------- */
async function startServer(opts) {
  const srv = createGameServer(Object.assign({ pagePath: PAGE, stepDelay: 0, sleep: async () => {}, log: () => {}, heartbeatMs: 60000, softGraceMs: 0 }, opts));
  const port = await srv.listen(0, '127.0.0.1');
  return { srv, port };
}

class Client {
  constructor(port, p) {
    this.port = port;
    this.ws = new WebSocket(`ws://127.0.0.1:${port}${p || '/ws'}`);
    this.q = []; this.all = []; this.waiters = []; this.closeInfo = null; this.openedOk = false; this.errored = false;
    this.ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { m = { t: '?raw', raw: e.data }; } this.all.push(m); this.q.push(m); this._wake(); };
    this.ws.onclose = e => { this.closeInfo = { code: e.code, reason: e.reason }; this._wake(); };
    this.ws.onerror = () => { this.errored = true; this._wake(); };
  }
  _wake() { const w = this.waiters; this.waiters = []; w.forEach(f => f()); }
  open() { return new Promise((res, rej) => { this.ws.onopen = () => { this.openedOk = true; res(this); }; const f = () => { if (!this.openedOk && this.closeInfo) rej(new Error('closed before open ' + JSON.stringify(this.closeInfo))); }; this.ws.addEventListener('error', () => setTimeout(f, 10)); this.ws.addEventListener('close', f); }); }
  send(o) { this.ws.send(typeof o === 'string' ? o : JSON.stringify(o)); }
  async next(pred, ms) {
    const t0 = Date.now(), limit = ms || 3000;
    for (;;) {
      const i = this.q.findIndex(pred);
      if (i >= 0) return this.q.splice(i, 1)[0];
      if (this.closeInfo && !this.q.length) return null;
      const left = limit - (Date.now() - t0);
      if (left <= 0) return null;
      await new Promise(res => { const t = setTimeout(res, left); this.waiters.push(() => { clearTimeout(t); res(); }); });
    }
  }
  of(type) { return this.all.filter(m => m.t === type); }
  last(type) { const a = this.of(type); return a[a.length - 1] || null; }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}
const connect = async port => { const c = new Client(port); await c.open(); await c.next(m => m.t === 'hello'); return c; };

async function host(port, name, settings) {
  const c = await connect(port);
  c.send(Object.assign({ t: 'create', name }, settings));
  const created = await c.next(m => m.t === 'created');
  return { c, created };
}
async function join(port, code, name) {
  const c = await connect(port);
  c.send({ t: 'join', code, name });
  const joined = await c.next(m => m.t === 'joined' || m.t === 'error');
  return { c, joined };
}
async function pair(port, settings) {
  const h = await host(port, 'Ann', settings);
  const g = await join(port, h.created.code, 'Ben');
  await h.c.next(m => m.t === 'lobby' && m.players[1]);
  return { a: h.c, b: g.c, code: h.created.code, tokenA: h.created.token, tokenB: g.joined.token };
}

function policyFor(rnd) {
  return v => {
    const a = v.awaiting;
    if (a.kind === 'modal') return { a: 'ok' };
    if (a.kind === 'draw') return { a: 'draw' };
    const pick = () => a.moves[Math.floor(rnd() * a.moves.length)];
    if (a.kind === 'move') { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    if (a.canDraw) return { a: 'draw' };
    if (a.canBuild && rnd() < 0.25) return { a: 'autoBuild' };
    if (a.moves.length && rnd() < 0.7) { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    if (a.canDone && rnd() < 0.5) return { a: 'done' };
    if (a.canUndo && rnd() < 0.3) return { a: 'undo' };
    if (a.canDone) return { a: 'done' };
    if (a.moves.length) { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    return { a: 'undo' };
  };
}
/* One player's side of a whole match, using the acks so that no state is ever answered twice. */
async function drive(c, policy, stats) {
  let n = 0, minSeq = -1;
  for (;;) {
    const m = await c.next(x => x.t === 'state' || x.t === 'ended', 10000);
    if (!m) { stats.timeout = true; return; }
    if (m.t === 'ended') { stats.ended = m; return; }
    if (m.seq <= minSeq) continue;
    const v = m.view;
    if (v.modal && v.modal.type === 'final') { stats.final = v; return; }
    if (!v.awaiting) continue;
    const id = ++n;
    c.send(Object.assign({ t: 'i', id }, policy(v)));
    const ack = await c.next(x => x.t === 'ack' && x.id === id, 4000);
    if (!ack) { stats.noAck = (stats.noAck || 0) + 1; continue; }
    stats.sent = (stats.sent || 0) + 1;
    if (!ack.ok) stats.refused = (stats.refused || 0) + 1;
    minSeq = ack.seq;
  }
}
const structuralLeaks = c => {                                // no real tile of the opponent, the boneyard or a hidden train in any state
  let bad = 0;
  for (const m of c.of('state')) {
    const g = m.view.game; if (!g) continue;
    if (!g.players[1].hand.every(t => t[0] < 0)) bad++;
    if (!g.boneyard.every(t => t[0] < 0)) bad++;
    if (g.opening && !g.opening.cpu.finished && !g.trains.cpu.tiles.every(t => t[0] < 0)) bad++;
    for (const ev of m.events) if (ev.e === 'play' && ev.who === 'opp' && ev.hidden && (ev.tile !== null || ev.placed[0] >= 0)) bad++;
  }
  return bad;
};

const toRoundEnd = async (c, policy) => {                       // one person's side of a match, up to the round-end dialog
  let n = 0, minSeq = -1;
  for (;;) {
    const m = await c.next(x => x.t === 'state' || x.t === 'ended', 15000);
    if (!m || m.t === 'ended') return false;
    if (m.seq <= minSeq) continue;
    const v = m.view;
    if (v.modal) return v.modal.type === 'roundEnd';
    if (!v.awaiting) continue;
    const id = ++n;
    c.send(Object.assign({ t: 'i', id }, policy(v)));
    const ack = await c.next(x => x.t === 'ack' && x.id === id, 4000);
    if (ack) minSeq = ack.seq;
  }
};
const lastView = c => c.of('state').slice(-1)[0].view;
const lobbyNow = async (c, pred, ms) => { const found = await until(() => { const l = c.last('lobby'); return !!(l && pred(l)); }, ms || 2000); return found ? c.last('lobby') : null; };     // (the latest lobby message, not whichever is oldest in the queue)
async function three(port, settings, guests) {
  const names = guests || ['Ben', 'Cat'];
  const h = await host(port, 'Ann', Object.assign({ humans: 3 }, settings || {}));
  const b = await join(port, h.created.code, names[0]);
  const c = await join(port, h.created.code, names[1]);
  await h.c.next(m => m.t === 'lobby' && m.players[2]);
  return { a: h.c, b: b.c, c: c.c, code: h.created.code, tok: [h.created.token, b.joined.token, c.joined.token], seats: [0, b.joined.seat, c.joined.seat], names: ['Ann'].concat(names) };
}
const BIG = { ratePerSecond: 5000, burst: 10000 };
const resume = async (port, code, token) => { const c = await connect(port); c.send({ t: 'resume', code, token }); const r = await c.next(m => m.t === 'resumed' || m.t === 'ended' || m.t === 'error'); return { c, r }; };

let nid = 1000;
const press = (c, a) => { const id = ++nid; c.send({ t: 'i', id, a }); return id; };
const isFinal = m => m.t === 'state' && m.view.modal && m.view.modal.type === 'final';
const dropBefore = (c, msg) => { const at = c.all.indexOf(msg); c.q = c.q.filter(m => c.all.indexOf(m) > at); };      // forget what arrived before this message (the finished game's)
async function toFinal(cs, seed) {                                    // everyone plays the one round to its end and presses the button to see the final score
  const ends = await Promise.all(cs.map((c, i) => toRoundEnd(c, policyFor(mulberry32(seed + i)))));
  if (!ends.every(Boolean)) return false;
  cs.forEach(c => press(c, 'ok'));
  const fs = await Promise.all(cs.map(c => c.next(isFinal, 6000)));
  return fs.every(Boolean);
}
const againOf = async (c, pred) => { const m = await c.next(x => x.t === 'again' && (!pred || pred(x)), 3000); return m; };
let seedBase = 1;

(async () => {
  const logs = [];
  const mk = () => startServer(Object.assign({ log: m => logs.push(m), rng: () => mulberry32(500 + seedBase++) }, BIG));

  console.log('1. two people play again');
  {
    const T = await mk();
    const h = await host(T.port, 'Ann', { rounds: 1, hand: 8, theme: 'lotr', allowHints: false });
    const b = await join(T.port, h.created.code, 'Ben');
    await h.c.next(m => m.t === 'lobby' && m.players[1]);
    h.c.send({ t: 'start' });
    const first = await h.c.next(m => m.t === 'state');
    const firstHand = JSON.stringify(first.view.game.players[0].hand);
    ok(await toFinal([h.c, b.c], 10), 'a one-round game is played to the final score on both screens');
    const room = T.srv.rooms.get(h.created.code), oldMatch = room.match;
    await until(() => room.state === 'over' && room.over === 'finished', 2000);
    ok(room.state === 'over' && room.again.size === 0, 'the finished game stays in its room, with nobody having asked to play again');
    h.c.send({ t: 'rematch' });
    const a0 = await againOf(h.c, m => m.asked.length === 1), a1 = await againOf(b.c, m => m.asked.length === 1);
    ok(a0.asked.join() === '0' && a0.gone.length === 0 && a1.asked.join() === '0', 'Ann asks: both are told that Ann has asked, and that nobody has gone');
    ok(room.state === 'over', '(and the game does not start: Ben has not asked)');
    h.c.send({ t: 'rematch' });
    await wait(100);
    ok(room.again.size === 1 && !h.c.of('rematch').length, 'asking twice is the same as asking once');
    b.c.send({ t: 'rematch' });
    const ra = await h.c.next(m => m.t === 'rematch', 3000), rb = await b.c.next(m => m.t === 'rematch', 3000);
    ok(!!ra && !!rb, 'Ben asks: both are told a new game is starting');
    dropBefore(h.c, ra); dropBefore(b.c, rb);
    const sa = await h.c.next(m => m.t === 'state', 3000), sb = await b.c.next(m => m.t === 'state', 3000);
    ok(sa.view.round === 0 && sa.view.rounds === 1 && Object.values(sa.view.totals).every(x => x === 0) && !sa.view.modal && sa.view.over === null && sa.seq < 5, 'the new game begins at round one, with nothing scored and no dialog, and the numbering of its updates starts again: seq ' + sa.seq);
    ok(JSON.stringify(sa.view.game.players[0].hand) !== firstHand && sa.view.game.players[0].hand.length === 8, 'with a new deal of 8 tiles (the same hand size)');
    ok(sa.view.me.name === 'Ann' && sa.view.me.seat === 0 && sb.view.me.name === 'Ben' && sb.view.me.seat === 1 && sa.view.opps[0].name === 'Ben', 'with the same people in the same seats');
    ok(room.state === 'playing' && room.over === null && room.match !== oldMatch && room.again.size === 0 && room.settings.theme === 'lotr' && room.settings.allowHints === false, 'the room is playing again with a new match and the same settings');
    ok(logs.some(l => /Ann asked to play game .* again \(1 of 2 asked\)/.test(l)) && logs.some(l => /game .* started again: Ann vs Ben/.test(l)), 'and the console says what happened: ' + logs.filter(l => /again/.test(l)).slice(-1)[0]);
    // the second game is a real game: it can be played to its end, and played again once more
    ok(await toFinal([h.c, b.c], 40), 'the second game is played to its final score too');
    await until(() => room.state === 'over' && room.over === 'finished', 2000);
    h.c.send({ t: 'rematch' }); b.c.send({ t: 'rematch' });
    ok(!!(await h.c.next(m => m.t === 'rematch', 3000)) && !!(await b.c.next(m => m.t === 'rematch', 3000)) && room.state === 'playing', 'and a third game can follow');
    [h.c, b.c].forEach(x => x.close()); await T.srv.close();
  }

  console.log('2. the rules of asking');
  {
    const T = await mk();
    const h = await host(T.port, 'Ann', { rounds: 1, hand: 8 });
    h.c.send({ t: 'rematch' });
    ok((await h.c.next(m => m.t === 'error', 2000)).code === 'not_now', 'asking in the lobby, before there is a game, is refused');
    const b = await join(T.port, h.created.code, 'Ben');
    await h.c.next(m => m.t === 'lobby' && m.players[1]);
    h.c.send({ t: 'start' }); await Promise.all([h.c, b.c].map(c => c.next(m => m.t === 'state')));
    h.c.send({ t: 'rematch' });
    const e = await h.c.next(m => m.t === 'error', 2000);
    ok(e.code === 'not_now' && /final score/.test(e.message), 'asking in the middle of a game is refused: ' + e.message);
    const ends = await Promise.all([h.c, b.c].map((c, i) => toRoundEnd(c, policyFor(mulberry32(70 + i)))));
    h.c.send({ t: 'rematch' });
    ok((await h.c.next(m => m.t === 'error', 2000)).code === 'not_now', 'asking at the last round dialog, before pressing the button for the final score, is refused');
    const room = T.srv.rooms.get(h.created.code);
    ok(room.again.size === 0, '(none of those counted)');
    [h.c, b.c].forEach(x => x.close()); await T.srv.close();
  }

  console.log('3. three people: someone is quicker than the others');
  {
    const T = await mk();
    const g = await three(T.port, { rounds: 1, hand: 8 });
    g.a.send({ t: 'start' });
    await Promise.all([g.a, g.b, g.c].map((c, i) => toRoundEnd(c, policyFor(mulberry32(90 + i)))));
    const room = T.srv.rooms.get(g.code);
    press(g.a, 'ok'); await g.a.next(isFinal, 3000);
    g.a.send({ t: 'rematch' });
    const early = await againOf(g.c, m => m.asked.length === 1);
    ok(early.asked.join() === '0' && room.state === 'playing', 'Ann sees her final score and asks while Ben and Cat are still at their last dialog: it is accepted, and they are told');
    press(g.b, 'ok'); await g.b.next(isFinal, 3000);
    g.b.send({ t: 'rematch' });
    const two = await againOf(g.c, m => m.asked.length === 2);
    ok(two.asked.join() === '0,1' && room.state === 'playing', 'Ben does the same: two of three have asked, and nothing starts');
    g.c.send({ t: 'rematch' });
    ok((await g.c.next(m => m.t === 'error', 2000)).code === 'not_now', 'Cat asks before pressing the button for her final score: refused');
    press(g.c, 'ok'); await g.c.next(isFinal, 3000);
    await until(() => room.state === 'over', 2000);
    ok(room.state === 'over', '(Cat sees her final score: the game is finished, but not restarted: she has not asked)');
    g.c.send({ t: 'rematch' });
    const rs = await Promise.all([g.a, g.b, g.c].map(c => c.next(m => m.t === 'rematch', 3000)));
    ok(rs.every(Boolean) && room.state === 'playing', 'Cat asks: all three are told the new game is starting');
    rs.forEach((r, i) => dropBefore([g.a, g.b, g.c][i], r));
    const st = await Promise.all([g.a, g.b, g.c].map(c => c.next(m => m.t === 'state', 3000)));
    ok(st.every((m, i) => m.view.me.seat === i && m.view.opps.length === 2 && m.view.opps.every(o => !o.computer) && m.view.round === 0), 'each is in their own seat with the other two');
    [g.a, g.b, g.c].forEach(x => x.close()); await T.srv.close();
  }

  console.log('4. someone has gone');
  {
    // (a) Ben leaves after seeing the final score
    const T = await mk();
    const h = await host(T.port, 'Ann', { rounds: 1, hand: 8 }); const b = await join(T.port, h.created.code, 'Ben');
    await h.c.next(m => m.t === 'lobby' && m.players[1]); h.c.send({ t: 'start' });
    await toFinal([h.c, b.c], 110);
    const room = T.srv.rooms.get(h.created.code);
    await until(() => room.state === 'over', 2000);
    h.c.send({ t: 'rematch' }); await againOf(h.c, m => m.asked.length === 1);
    b.c.send({ t: 'leave' });
    const gone = await againOf(h.c, m => m.gone.length === 1);
    ok(gone.gone.join() === '1' && gone.asked.join() === '0', 'Ben leaves: Ann is told Ben has gone (and that she had asked)');
    h.c.send({ t: 'rematch' }); await wait(150);
    ok(room.state === 'over' && !h.c.of('rematch').length, 'asking again changes nothing: there is no one to play with');
    h.c.close(); b.c.close(); await T.srv.close();
  }
  {
    // (b) Ben just closes his page
    const T = await mk();
    const h = await host(T.port, 'Ann', { rounds: 1, hand: 8 }); const b = await join(T.port, h.created.code, 'Ben');
    await h.c.next(m => m.t === 'lobby' && m.players[1]); h.c.send({ t: 'start' });
    await toFinal([h.c, b.c], 120);
    const room = T.srv.rooms.get(h.created.code); await until(() => room.state === 'over', 2000);
    b.c.ws.close();
    const gone = await againOf(h.c, m => m.gone.length === 1);
    ok(gone.gone.join() === '1', 'Ben closes his page: Ann is told he has gone');
    h.c.send({ t: 'rematch' }); await wait(150);
    ok(room.state === 'over', 'and there is no game');
    h.c.close(); await T.srv.close();
  }
  {
    // (c) the one who asked leaves
    const T = await mk();
    const h = await host(T.port, 'Ann', { rounds: 1, hand: 8 }); const b = await join(T.port, h.created.code, 'Ben');
    await h.c.next(m => m.t === 'lobby' && m.players[1]); h.c.send({ t: 'start' });
    await toFinal([h.c, b.c], 130);
    const room = T.srv.rooms.get(h.created.code); await until(() => room.state === 'over', 2000);
    h.c.send({ t: 'rematch' }); await againOf(b.c, m => m.asked.length === 1);
    h.c.send({ t: 'leave' });
    const m2 = await againOf(b.c, m => m.gone.length === 1);
    ok(m2.gone.join() === '0' && m2.asked.length === 0, 'Ann asks and then leaves: Ben is told she has gone, and that nobody is asking any more');
    b.c.close(); await T.srv.close();
  }
  {
    // (d) three people, one of them goes
    const T = await mk();
    const g = await three(T.port, { rounds: 1, hand: 8 });
    g.a.send({ t: 'start' });
    await toFinal([g.a, g.b, g.c], 140);
    const room = T.srv.rooms.get(g.code); await until(() => room.state === 'over', 2000);
    g.c.send({ t: 'leave' });
    const gone = await againOf(g.a, m => m.gone.length === 1);
    ok(gone.gone.join() === '2', 'Cat leaves: both of the others are told');
    g.a.send({ t: 'rematch' }); g.b.send({ t: 'rematch' }); await wait(200);
    ok(room.state === 'over' && !g.a.of('rematch').length, 'the two who remain cannot start a game of three');
    [g.a, g.b, g.c].forEach(x => x.close()); await T.srv.close();
  }
  {
    // (e) someone who has seen the final score leaves while the other is still at the last dialog
    const T = await mk();
    const h = await host(T.port, 'Ann', { rounds: 1, hand: 8 }); const b = await join(T.port, h.created.code, 'Ben');
    await h.c.next(m => m.t === 'lobby' && m.players[1]); h.c.send({ t: 'start' });
    await Promise.all([h.c, b.c].map((c, i) => toRoundEnd(c, policyFor(mulberry32(150 + i)))));
    press(h.c, 'ok'); await h.c.next(isFinal, 3000);
    h.c.send({ t: 'rematch' });
    h.c.send({ t: 'leave' });
    const m3 = await againOf(b.c, m => m.gone.length === 1);
    ok(m3.gone.join() === '0', 'Ann sees her final score, asks and leaves while Ben is still at his last dialog: Ben is told she has gone');
    press(b.c, 'ok'); await b.c.next(isFinal, 3000);
    b.c.send({ t: 'rematch' }); await wait(200);
    ok(T.srv.rooms.get(h.created.code).state === 'over' && !b.c.of('rematch').length, 'and when he has seen his final score there is no game to start');
    b.c.close(); await T.srv.close();
  }

  {
    // (f) Ben asks, and then just closes his page: his request stands, but he is not there to play
    const T = await mk();
    const h = await host(T.port, 'Ann', { rounds: 1, hand: 8 }); const b = await join(T.port, h.created.code, 'Ben');
    await h.c.next(m => m.t === 'lobby' && m.players[1]); h.c.send({ t: 'start' });
    await toFinal([h.c, b.c], 170);
    const room = T.srv.rooms.get(h.created.code); await until(() => room.state === 'over', 2000);
    b.c.send({ t: 'rematch' }); await againOf(h.c, m => m.asked.join() === '1');
    b.c.ws.close();
    const g = await againOf(h.c, m => m.gone.join() === '1');
    ok(g.asked.join() === '1', 'Ben asks and then closes his page: Ann is told he has gone (his request is still there)');
    h.c.send({ t: 'rematch' }); await wait(200);
    ok(room.state === 'over' && !h.c.of('rematch').length && room.again.size === 2, 'Ann asks too, and both have asked, but there is no game: one of them is not there');
    h.c.close(); await T.srv.close();
  }

  console.log('5. with a computer player');
  {
    const T = await mk();
    const h = await host(T.port, 'Ann', { rounds: 1, hand: 8, computer: 'hard' }); const b = await join(T.port, h.created.code, 'Ben');
    await h.c.next(m => m.t === 'lobby' && m.players[1]); h.c.send({ t: 'start' });
    const s0 = await h.c.next(m => m.t === 'state');
    const cpu = s0.view.opps.find(o => o.computer);
    await toFinal([h.c, b.c], 160);
    const room = T.srv.rooms.get(h.created.code); await until(() => room.state === 'over', 2000);
    h.c.send({ t: 'rematch' }); b.c.send({ t: 'rematch' });
    const ra = await h.c.next(m => m.t === 'rematch', 3000), rb = await b.c.next(m => m.t === 'rematch', 3000);
    ok(!!ra && !!rb, 'the two people ask: the computer needs no asking, and the game starts again');
    dropBefore(h.c, ra);
    const s1 = await h.c.next(m => m.t === 'state', 3000);
    const cpu1 = s1.view.opps.find(o => o.computer);
    ok(cpu1 && cpu1.name === cpu.name && cpu1.level === 'hard' && s1.view.opps.length === 2, 'against the same computer player: ' + cpu.name);
    [h.c, b.c].forEach(x => x.close()); await T.srv.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
