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

(async () => {
  console.log('1. three people in the lobby');
  {
    const T = await startServer(BIG);
    const h = await host(T.port, 'Ann', { humans: 3, rounds: 1, hand: 8 });
    ok(h.created.settings.humans === 3 && h.created.seat === 0, 'a game made for three people says so');
    const l0 = await h.c.next(m => m.t === 'lobby');
    ok(l0.players.length === 3 && l0.players[0].name === 'Ann' && l0.players[1] === null && l0.players[2] === null && l0.canStart === false && l0.settings.humans === 3, 'the lobby has three places, one taken: ' + JSON.stringify(l0.players));
    const b = await join(T.port, h.created.code, 'Ben');
    ok(b.joined.t === 'joined' && b.joined.seat === 1 && b.joined.settings.humans === 3, 'the first guest sits in seat 1');
    const l1 = await h.c.next(m => m.t === 'lobby' && m.players[1]);
    ok(l1.players[1].name === 'Ben' && l1.players[2] === null && l1.canStart === false, 'and the host cannot start with only two of three here');
    h.c.send({ t: 'start' });
    const e0 = await h.c.next(m => m.t === 'error');
    ok(e0.code === 'not_ready' && /other players/.test(e0.message), 'pressing Start then says to wait for the others: ' + e0.message);
    const c = await join(T.port, h.created.code, 'Cat');
    ok(c.joined.seat === 2, 'the second guest sits in seat 2');
    const la = await h.c.next(m => m.t === 'lobby' && m.players[2]), lb = await b.c.next(m => m.t === 'lobby' && m.players[2]), lc = await c.c.next(m => m.t === 'lobby' && m.players[2]);
    ok([la, lb, lc].every(l => l.players.map(p => p && p.name).join() === 'Ann,Ben,Cat' && l.canStart === true && l.players.every(p => p.connected)) && [la.seat, lb.seat, lc.seat].join() === '0,1,2', 'all three are told who is in, each their own seat, and the game can start');
    const d = await join(T.port, h.created.code, 'Dan');
    ok(d.joined.t === 'error' && d.joined.code === 'game_full' && /three players/.test(d.joined.message), 'a fourth person is told the game has three players: ' + d.joined.message);
    b.c.send({ t: 'start' });
    ok((await b.c.next(m => m.t === 'error')).code === 'not_allowed', 'a guest cannot start it');
    [h.c, b.c, c.c, d.c].forEach(x => x.close());
    await T.srv.close();
  }
  {
    const T = await startServer(BIG);
    const two = await host(T.port, 'Ann', {});
    ok(two.created.settings.humans === 2 && (await two.c.next(m => m.t === 'lobby')).players.length === 2, 'a game with no choice made is still for two (two places)');
    const j2 = await join(T.port, two.created.code, 'Ben'); const x = await join(T.port, two.created.code, 'Cat');
    ok(x.joined.code === 'game_full' && /two players/.test(x.joined.message), 'and a third person is told it has two players');
    for (const junk of [4, '4', 0, -1, null, undefined, 'three', {}, [], 2.5, true]) { const h = await host(T.port, 'Z', { humans: junk }); if (h.created.settings.humans !== 2) ok(false, 'humans ' + JSON.stringify(junk) + ' gave ' + h.created.settings.humans); h.c.close(); }
    const s = await host(T.port, 'Z', { humans: '3' });
    ok(s.created.settings.humans === 3, 'anything but 3 means two ("3" as text counts)'); s.c.close();
    const comp = await host(T.port, 'Ann', { humans: 3, computer: 'hard' });
    const lc = await comp.c.next(m => m.t === 'lobby');
    ok(comp.created.settings.computer === 'hard' && lc.players.length === 4 && lc.players.filter(p => p && p.computer).length === 1, 'a computer player can be added to a game for three people (four players in all)');
    [two.c, j2.c, x.c, comp.c].forEach(y => y.close());
    await T.srv.close();
  }
  console.log('1b. being turned away: what the other person is told, and what the server says');
  {
    const logs = [];
    const T = await startServer(Object.assign({ log: m => logs.push(m) }, BIG));
    const info = await new Promise((resolve, reject) => require('http').get({ host: '127.0.0.1', port: T.port, path: '/info' }, res => { let b = ''; res.on('data', c => (b += c)); res.on('end', () => resolve(JSON.parse(b))); }).on('error', reject));
    ok(info.maxHumans === 3 && Array.isArray(info.addresses), 'the server says it can seat three people (an older server says nothing, so the page can tell the difference)');
    const g = await three(T.port, { rounds: 1, hand: 8 });
    const d = await join(T.port, g.code, 'Dan');
    ok(d.joined.code === 'game_full' && d.joined.message === 'That game already has three players (Ann, Ben and Cat).', 'a game for three that is full says who is in it: ' + d.joined.message);
    ok(logs.some(l => /Dan could not join game .*: it is for 3 people and has Ann, Ben and Cat/.test(l)), 'and the server console says why a person was turned away: ' + logs.filter(l => /could not join/.test(l)).slice(-1)[0]);
    const two = await host(T.port, 'Zoe', {}); const zb = await join(T.port, two.created.code, 'Yan');
    const zc = await join(T.port, two.created.code, 'Xi');
    ok(zc.joined.code === 'game_full' && zc.joined.message === 'That game already has two players (Zoe and Yan).', 'a game for two says who is in it: ' + zc.joined.message);
    ok(logs.some(l => /Xi could not join game .*: it is for 2 people and has Zoe and Yan/.test(l)), '(and the console says it is a game for 2 people, which is how a host who expected three would find out)');
    g.a.send({ t: 'start' }); await Promise.all([g.a, g.b, g.c].map(c => c.next(m => m.t === 'state')));
    const late = await join(T.port, g.code, 'Eve');
    ok(late.joined.code === 'game_started' && late.joined.message === 'That game has already started.', 'a game that has begun says it has begun (not that it is full): ' + late.joined.message);
    ok(logs.some(l => /Eve could not join game .*: it has already started \(Ann, Ben and Cat\)/.test(l)), '...and so does the console');
    [g.a, g.b, g.c, d.c, two.c, zb.c, zc.c, late.c].forEach(x => x.close()); await T.srv.close();
  }

  console.log('2. names');
  {
    const T = await startServer(BIG);
    const g = await three(T.port, {}, ['Ben', 'ben']);
    const l = g.a.last('lobby');
    ok(l.players.map(p => p.name).join() === 'Ann,Ben,ben 2', 'a second "Ben" (capitals do not make a different name) becomes "ben 2": ' + l.players.map(p => p.name).join());
    const g2 = await three(T.port, {}, ['ann', 'Ann']);
    ok(g2.a.last('lobby').players.map(p => p.name).join() === 'Ann,ann 2,Ann 3', 'a guest with the host\'s name is "ann 2", and the next one "Ann 3": ' + g2.a.last('lobby').players.map(p => p.name).join());
    const g3 = await three(T.port, {}, ['A'.repeat(20), 'A'.repeat(20)]);
    ok(g3.a.last('lobby').players.every(p => p.name.length <= 20) && new Set(g3.a.last('lobby').players.map(p => p.name.toLowerCase())).size === 3, 'long names stay within 20 characters and different');
    [g, g2, g3].forEach(x => { x.a.close(); x.b.close(); x.c.close(); });
    await T.srv.close();
  }
  console.log('3. coming and going in the lobby');
  {
    const T = await startServer(BIG);
    const g = await three(T.port);
    g.c.send({ t: 'leave' });
    const la = await lobbyNow(g.a, l => l.players[2] === null), lb = await lobbyNow(g.b, l => l.players[2] === null);
    ok(la && lb && la.canStart === false && lb.players[1].name === 'Ben', 'Cat leaves the lobby: her place is free, and nobody can start');
    const d = await join(T.port, g.code, 'Dan');
    ok(d.joined.seat === 2, 'the next to join takes the free seat');
    ok(await lobbyNow(g.a, l => l.players[2] && l.players[2].name === 'Dan' && l.canStart === true), '(and the host sees him, and can start again)');
    g.b.send({ t: 'leave' });
    ok(await lobbyNow(g.a, l => l.players[1] === null && l.players[2] && l.players[2].name === 'Dan'), 'Ben leaves: seat 1 is free, Dan keeps seat 2');
    const e = await join(T.port, g.code, 'Eve');
    ok(e.joined.seat === 1, 'and Eve takes seat 1 (the first free)');
    ok(await lobbyNow(g.a, l => l.players.map(p => p && p.name).join() === 'Ann,Eve,Dan'), 'the lobby lists Ann, Eve, Dan');
    d.c.close();                                                          // Dan just closes the page
    ok(await lobbyNow(g.a, l => l.players[2] === null && l.players[1] && l.players[1].name === 'Eve'), 'a guest whose page closes in the lobby frees the place too');
    g.a.send({ t: 'leave' });
    const end = await e.c.next(m => m.t === 'ended');
    ok(end && end.reason === 'left', 'when the host leaves, the game is closed for the others');
    [g.a, g.b, g.c, e.c].forEach(x => x.close());
    await T.srv.close();
  }
  {
    const T = await startServer(BIG);
    const h = await host(T.port, 'Ann', {}); await h.c.next(m => m.t === 'lobby');
    const b = await join(T.port, h.created.code, 'Ben');
    await h.c.next(m => m.t === 'lobby' && m.players[1]);
    h.c.send({ t: 'settings', humans: 3 });
    const l3 = await h.c.next(m => m.t === 'lobby' && m.settings.humans === 3);
    ok(l3.players.length === 3 && l3.canStart === false, 'the host can make it a game for three while there is room');
    const c = await join(T.port, h.created.code, 'Cat');
    ok(c.joined.seat === 2, '(and Cat sits in the new seat)');
    await h.c.next(m => m.t === 'lobby' && m.players[2]);
    h.c.send({ t: 'settings', humans: 2 });
    const er = await h.c.next(m => m.t === 'error');
    ok(er.code === 'not_allowed' && h.c.last('lobby').settings.humans === 3, 'but not back to two once someone sits in the third seat: ' + er.message);
    b.c.send({ t: 'settings', humans: 2 });
    ok((await b.c.next(m => m.t === 'error')).code === 'not_allowed', 'and a guest cannot change it');
    c.c.send({ t: 'leave' }); await h.c.next(m => m.t === 'lobby' && m.players[2] === null);
    h.c.send({ t: 'settings', humans: 2 });
    ok((await h.c.next(m => m.t === 'lobby' && m.settings.humans === 2)).players.length === 2, 'with the seat empty it can');
    h.c.send({ t: 'settings', humans: 3, computer: 'easy' });
    ok(((await h.c.next(m => m.t === 'lobby' && m.settings.humans === 3)).settings.computer === 'easy'), 'asking for three people keeps the computer player (four players in all)');
    [h.c, b.c, c.c].forEach(x => x.close());
    await T.srv.close();
  }

  console.log('4. a whole match between three people');
  {
    const T = await startServer(BIG);
    const g = await three(T.port, { rounds: 1, hand: 8 });
    g.a.send({ t: 'start' });
    const st = [{}, {}, {}];
    await Promise.all([g.a, g.b, g.c].map((c, i) => drive(c, policyFor(mulberry32(70 + i)), st[i])));
    ok(st.every(s => s.final && !s.ended && !s.timeout), 'all three play the match to its final score, with nobody refused or timing out (refused: ' + st.map(s => s.refused || 0).join('/') + ')');
    const views = st.map(s => s.final);
    ok(views.every((v, i) => v.me.seat === g.seats[i] && v.me.name === g.names[i] && v.opps.length === 2 && v.opps.every(o => !o.computer)), 'each sees themselves in their own seat and two human opponents');
    ok(views.every((v, i) => JSON.stringify(v.opps.map(o => o.seat).sort()) === JSON.stringify([0, 1, 2].filter(s => s !== g.seats[i]))), 'whose seats are the other two');
    const byName = v => { const t = {}; t[v.me.name] = v.totals.human; v.opps.forEach(o => { t[o.name] = v.totals[o.id]; }); return JSON.stringify(Object.keys(t).sort().map(n => [n, t[n]])); };
    ok(new Set(views.map(byName)).size === 1 && views.every(v => v.over === 'finished'), 'and all three screens show the same score for each person: ' + byName(views[0]));
    ok(await until(() => T.srv.rooms.get(g.code) && T.srv.rooms.get(g.code).over === 'finished', 2000), 'the game is finished once all three have pressed their button');
    [g.a, g.b, g.c].forEach(x => x.close()); await T.srv.close();
  }
  {
    const T = await startServer(BIG);
    const g = await three(T.port, { rounds: 4, hand: 8 });
    g.a.send({ t: 'start' });
    const ends = await Promise.all([g.a, g.b, g.c].map((c, i) => toRoundEnd(c, policyFor(mulberry32(90 + i)))));
    ok(ends.every(Boolean) && [g.a, g.b, g.c].every(c => lastView(c).modal.last === false), 'a four-round game reaches the end of its first round on all three screens');
    g.a.send({ t: 'i', id: 900, a: 'ok' }); g.b.send({ t: 'i', id: 900, a: 'ok' });
    await wait(300);
    ok(lastView(g.a).modal === null && lastView(g.b).modal === null && lastView(g.c).modal.type === 'roundEnd' && !lastView(g.a).awaiting, 'between rounds, with two of three ready, nothing starts: they wait for the third');
    ok(/Waiting for the others/.test(JSON.stringify(lastView(g.a).log)), '(and are told they are waiting for the others)');
    g.c.send({ t: 'i', id: 900, a: 'ok' });
    const nx = await g.a.next(m => m.t === 'state' && m.view.round === 1 && m.view.awaiting, 3000);
    ok(!!nx && !!(await g.b.next(m => m.t === 'state' && m.view.round === 1 && m.view.awaiting, 3000)) && !!(await g.c.next(m => m.t === 'state' && m.view.round === 1 && m.view.awaiting, 3000)), 'when the third is ready, round two begins for all three');
    [g.a, g.b, g.c].forEach(x => x.close()); await T.srv.close();
  }

  console.log('5. talking');
  {
    const T = await startServer(BIG);
    const g = await three(T.port, { rounds: 1, hand: 8 });
    const room = T.srv.rooms.get(g.code), clear = () => { room.chatAt = [0, 0, 0]; };
    g.a.send({ t: 'chat', text: 'Hello you two' });
    const mb = await g.b.next(m => m.t === 'chat', 2000), mc = await g.c.next(m => m.t === 'chat', 2000);
    ok(mb.text === 'Hello you two' && mc.text === 'Hello you two' && mb.from === 0 && mc.from === 0 && !g.a.of('chat').length, 'what the host says goes to both guests, from seat 0, and not back to the host');
    clear(); g.b.send({ t: 'chat', text: 'Hi Ann', from: 0 });
    const ma = await g.a.next(m => m.t === 'chat', 2000), mc2 = await g.c.next(m => m.t === 'chat' && m.text === 'Hi Ann', 2000);
    ok(ma.from === 1 && mc2.from === 1, 'what a guest says goes to the other two, from their own seat, whatever the message claims to be from (it said 0)');
    clear(); g.c.send({ t: 'chat', id: 2 });
    const mp = await g.a.next(m => m.t === 'chat' && m.id === 2, 2000), mp2 = await g.b.next(m => m.t === 'chat' && m.id === 2, 2000);
    ok(mp.text === E.CHAT_PHRASES[2] && mp2.text === E.CHAT_PHRASES[2] && mp.from === 2 && mp2.from === 2, 'a quick phrase goes to both others, as the real phrase, from the one who sent it');
    clear(); g.a.send({ t: 'chat', text: 'one' }); g.a.send({ t: 'chat', text: 'two' });
    ok((await g.a.next(m => m.t === 'error' && m.code === 'slow_down', 2000)) && g.b.of('chat').filter(m => /^(one|two)$/.test(m.text)).length === 1, 'each person has their own limit on how fast they can speak (a second message straight away is refused)');
    clear(); g.b.send({ t: 'chat', text: 'still allowed' });
    ok(!!(await g.a.next(m => m.t === 'chat' && m.text === 'still allowed', 2000)), 'and one person being slowed down does not stop another');
    for (let i = 0; i < 12; i++) { clear(); g.c.send({ t: 'chat', text: 'burst ' + i }); await wait(12); }
    await wait(60);
    ok(g.c.of('error').filter(m => m.code === 'slow_down').length >= 2 && g.a.of('chat').filter(m => /^burst/.test(m.text)).length <= 10, 'and no more than ten a minute from one person');
    [g.a, g.b, g.c].forEach(x => x.close()); await T.srv.close();
  }

  console.log('6. someone drops');
  {
    const T = await startServer(Object.assign({ softGraceMs: 120, graceMs: 2500 }, BIG));
    const g = await three(T.port, { rounds: 1, hand: 8 });
    g.a.send({ t: 'start' });
    await Promise.all([g.a, g.b, g.c].map(c => c.next(m => m.t === 'state')));
    const room = T.srv.rooms.get(g.code);
    g.b.ws.close();                                                       // Ben's page closes
    const pa = await g.a.next(m => m.t === 'presence' && m.oppConnected === false, 2000), pc = await g.c.next(m => m.t === 'presence' && m.oppConnected === false, 2000);
    ok(room.match.paused === true, 'when one of three drops (for more than a moment) the game is paused');
    ok(pa.opps.length === 2 && pa.opps.find(o => o.seat === 1).connected === false && pa.opps.find(o => o.seat === 2).connected === true && typeof pa.opps.find(o => o.seat === 1).graceUntil === 'number' && pa.graceUntil === pa.opps.find(o => o.seat === 1).graceUntil, 'the host is told it is Ben (seat 1) who is gone, that Cat is there, and how long he has: ' + JSON.stringify(pa.opps));
    ok(pc.opps.find(o => o.seat === 1).connected === false && pc.opps.find(o => o.seat === 0).connected === true, 'and Cat is told the same');
    const r = await resume(T.port, g.code, g.tok[1]);
    ok(r.r.t === 'resumed' && r.r.seat === 1, 'Ben comes back with his token, to his own seat');
    const sv = await r.c.next(m => m.t === 'state');
    ok(sv.view.me.seat === 1 && sv.view.me.name === 'Ben' && sv.view.opps.length === 2, 'and gets his own view of the game');
    const pa2 = await g.a.next(m => m.t === 'presence' && m.oppConnected === true, 2000);
    ok(pa2.opps.every(o => o.connected) && await until(() => room.match.paused === false, 1000), 'everyone is told he is back, and the game goes on');
    r.c.close(); g.a.close(); g.c.close(); await T.srv.close();
  }
  {
    const T = await startServer(Object.assign({ softGraceMs: 120, graceMs: 2500 }, BIG));
    const g = await three(T.port, { rounds: 1, hand: 8 });
    g.a.send({ t: 'start' }); await Promise.all([g.a, g.b, g.c].map(c => c.next(m => m.t === 'state')));
    const room = T.srv.rooms.get(g.code);
    g.b.ws.close(); g.c.ws.close();                                       // two of the three
    const p2 = await g.a.next(m => m.t === 'presence' && m.opps.every(o => !o.connected), 2000);
    ok(p2 && room.match.paused === true, 'two of three gone: the host is told about both, and the game is paused');
    const rb = await resume(T.port, g.code, g.tok[1]);
    const pa = await g.a.next(m => m.t === 'presence' && m.opps.find(o => o.seat === 1).connected && !m.opps.find(o => o.seat === 2).connected, 2000);
    ok(!!pa && room.match.paused === true, 'when one of them returns the game stays paused until the other has too, and the host is told it is Cat who is still missing');
    const rc = await resume(T.port, g.code, g.tok[2]);
    ok(await until(() => room.match.paused === false, 1500), 'and when both are back it goes on');
    [rb.c, rc.c, g.a].forEach(x => x.close()); await T.srv.close();
  }
  {
    const T = await startServer(Object.assign({ softGraceMs: 150, graceMs: 2500 }, BIG));
    const g = await three(T.port, { rounds: 1, hand: 8 });
    g.a.send({ t: 'start' }); await Promise.all([g.a, g.b, g.c].map(c => c.next(m => m.t === 'state')));
    const room = T.srv.rooms.get(g.code);
    g.b.ws.close(); await wait(40);
    const rb = await resume(T.port, g.code, g.tok[1]);
    await wait(300);
    ok(rb.r.t === 'resumed' && room.match.paused === false && !g.a.of('presence').some(m => m.oppConnected === false) && !g.c.of('presence').some(m => m.oppConnected === false), 'a blip that mends within a moment is never announced and never pauses anything');
    [rb.c, g.a, g.c].forEach(x => x.close()); await T.srv.close();
  }
  {
    const T = await startServer(Object.assign({ softGraceMs: 40, graceMs: 500 }, BIG));
    const g = await three(T.port, { rounds: 1, hand: 8 });
    g.a.send({ t: 'start' }); await Promise.all([g.a, g.b, g.c].map(c => c.next(m => m.t === 'state')));
    g.b.ws.close();
    const ea = await g.a.next(m => m.t === 'ended', 3000), ec = await g.c.next(m => m.t === 'ended', 3000);
    ok(ea && ec && ea.reason === 'timeout' && /Ben did not come back/.test(ea.message) && ec.reason === 'timeout', 'if he does not come back in time, the game ends for the other two, saying who: ' + (ea && ea.message));
    g.a.close(); g.c.close(); await T.srv.close();
  }
  {
    const T = await startServer(BIG);
    const g = await three(T.port, { rounds: 1, hand: 8 });
    g.a.send({ t: 'start' }); await Promise.all([g.a, g.b, g.c].map(c => c.next(m => m.t === 'state')));
    g.c.send({ t: 'leave' });
    const ea = await g.a.next(m => m.t === 'ended', 2000), eb = await g.b.next(m => m.t === 'ended', 2000);
    ok(ea && eb && ea.reason === 'left' && /Cat left the game/.test(ea.message) && eb.reason === 'left', 'someone who leaves the game ends it for the other two, saying who: ' + (ea && ea.message));
    g.a.close(); g.b.close(); await T.srv.close();
  }

  console.log('7. the last round: nobody waits for the others to see the final score');
  {
    const T = await startServer(Object.assign({ softGraceMs: 150, graceMs: 20000 }, BIG));
    const g = await three(T.port, { rounds: 1, hand: 8 });
    g.a.send({ t: 'start' });
    const ends = await Promise.all([g.a, g.b, g.c].map((c, i) => toRoundEnd(c, policyFor(mulberry32(110 + i)))));
    const room = T.srv.rooms.get(g.code);
    ok(ends.every(Boolean) && [g.a, g.b, g.c].every(c => lastView(c).modal.last === true), 'a one-round game reaches its last dialog on all three screens');
    g.a.send({ t: 'i', id: 900, a: 'ok' });
    const fa = await g.a.next(m => m.t === 'state' && m.view.modal && m.view.modal.type === 'final', 3000);
    await wait(100);
    ok(!!fa && fa.view.over === 'finished' && lastView(g.b).modal.type === 'roundEnd' && lastView(g.c).modal.type === 'roundEnd' && room.state === 'playing', 'the first to press has the final score at once, while the other two still have their dialogs');
    g.a.send({ t: 'leave' }); await wait(300);
    ok(!g.b.of('ended').length && !g.c.of('ended').length && /has gone/.test(JSON.stringify(lastView(g.b).log)) && /has gone/.test(JSON.stringify(lastView(g.c).log)), 'the host sees it and goes back to the menu: the others are not thrown out, and are told');
    g.b.send({ t: 'i', id: 901, a: 'ok' });
    const fb = await g.b.next(m => m.t === 'state' && m.view.modal && m.view.modal.type === 'final', 3000);
    await wait(100);
    ok(!!fb && lastView(g.c).modal.type === 'roundEnd' && room.state === 'playing', 'the second presses theirs and has the final score; the third is still not hurried');
    g.b.close();                                                          // the second just closes the page
    await wait(500);
    ok(room.match.paused === false && !g.c.of('ended').length, 'closing the page after seeing the final score does not pause the game for the one still to press');
    g.c.send({ t: 'i', id: 902, a: 'ok' });
    ok(!!(await g.c.next(m => m.t === 'state' && m.view.modal && m.view.modal.type === 'final', 3000)) && await until(() => room.over === 'finished', 2000), 'and the third gets theirs, and the game is finished');
    g.c.close(); await T.srv.close();
  }
  {
    const T = await startServer(BIG);
    const g = await three(T.port, { rounds: 1, hand: 8 });
    g.a.send({ t: 'start' });
    await Promise.all([g.a, g.b, g.c].map((c, i) => toRoundEnd(c, policyFor(mulberry32(120 + i)))));
    g.b.send({ t: 'leave' });                                             // Ben leaves BEFORE pressing his button
    const ea = await g.a.next(m => m.t === 'ended', 2000);
    ok(ea && ea.reason === 'left' && /Ben left/.test(ea.message), 'someone who leaves before pressing their button still ends the game for the others');
    g.a.close(); g.c.close(); await T.srv.close();
  }

  console.log('8. coming back to a game of three');
  {
    const T = await startServer(Object.assign({ softGraceMs: 60, graceMs: 5000 }, BIG));
    const g = await three(T.port, { rounds: 1, hand: 8 });
    g.a.send({ t: 'start' }); await Promise.all([g.a, g.b, g.c].map(c => c.next(m => m.t === 'state')));
    let good = 0;
    for (const s of [0, 1, 2]) {
      const old = [g.a, g.b, g.c][s]; old.ws.close(); await wait(150);
      const r = await resume(T.port, g.code, g.tok[s]);
      const sv = await r.c.next(m => m.t === 'state');
      if (r.r.t === 'resumed' && r.r.seat === s && sv.view.me.seat === s && sv.view.me.name === g.names[s] && sv.view.opps.length === 2 && sv.view.opps.every(o => o.seat !== s)) good++;
      r.c.close(); await wait(150);
    }
    ok(good === 3, 'each of the three, coming back with their own token, is back in their own seat with their own view');
    const wrong = await resume(T.port, g.code, 'not-a-token');
    ok(wrong.r.t === 'error' && wrong.r.code === 'no_such_game', 'a wrong token gets nothing');
    wrong.c.close(); await T.srv.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
