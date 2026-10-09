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
  const srv = createGameServer(Object.assign({ pagePath: PAGE, stepDelay: 0, sleep: async () => {}, log: () => {}, heartbeatMs: 60000 }, opts));
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

(async () => {
  /* ======================================================================== */
  console.log('1. the page and plain HTTP');
  const S = await startServer({ maxConnections: 6 });
  const base = `http://127.0.0.1:${S.port}`;
  {
    const page = fs.readFileSync(PAGE);
    const r = await fetch(base + '/');
    ok(r.status === 200 && /text\/html/.test(r.headers.get('content-type')) && Buffer.from(await r.arrayBuffer()).equals(page), 'GET / serves the game page, byte for byte');
    ok(r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('cache-control') === 'no-store', 'with safe headers, and never cached (so an updated page is always picked up)');
    const h = await fetch(base + '/', { method: 'HEAD' });
    ok(h.status === 200 && Number(h.headers.get('content-length')) === page.length && (await h.text()) === '', 'HEAD gives the headers and no body');
    ok((await fetch(base + '/index.html')).status === 200, '/index.html works too');
    const hz = await fetch(base + '/healthz');
    ok(hz.status === 200 && (await hz.text()) === 'ok', '/healthz answers "ok"');
    ok((await fetch(base + '/nope')).status === 404 && (await fetch(base + '/ws')).status === 404, 'other paths are 404 (/ws without an upgrade too)');
    const attacks = ['/../server.js', '/..%2fserver.js', '/%2e%2e/server.js', '/server.js', '/game.js', '/mexican-train.js', '/t/test_server.js', '//etc/passwd', '/index.html/..', '/ws/../server.js', '/%00', '/..\\server.js'];
    const codes = [];
    for (const a of attacks) { try { const x = await fetch(base + a); const body = await x.text(); codes.push([x.status, /require\(|createGameServer/.test(body)]); } catch (e) { codes.push([0, false]); } }
    ok(codes.every(([s, leaked]) => !leaked && (s === 404 || s === 200 || s === 400 || s === 0)), 'path tricks (../, encoded dots, other source files, NUL) never reveal a source file');
    ok(codes.filter(([s]) => s === 200).length <= 3, '(only the real page ever answers 200)');
    ok((await fetch(base + '/', { method: 'POST', body: 'x' })).status === 405 && (await fetch(base + '/', { method: 'PUT' })).status === 405 && (await fetch(base + '/', { method: 'DELETE' })).status === 405, 'POST, PUT and DELETE are refused (405)');
    const s2 = await startServer({ pagePath: path.join(__dirname, 'does-not-exist.html') });
    const miss = await fetch(`http://127.0.0.1:${s2.port}/`);
    ok(miss.status === 500 && /not found/i.test(await miss.text()), 'a missing page file is a clear 500 message, not a crash');
    await s2.srv.close();
  }

  console.log('1a. the default pause between built tiles');
  {
    const D = createGameServer({ pagePath: PAGE, log: () => {} });
    ok(JSON.stringify(D.options.stepDelay) === '[500,3000]', 'a server started normally waits a random 0.5 to 3 seconds between the tiles of "Build my longest train"');
  }

  console.log('1b. which network address is shown');
  {
    ok(addressRank('192.168.1.5') === 0 && addressRank('10.0.0.5') === 1 && addressRank('172.16.0.1') === 2 && addressRank('172.31.255.1') === 2 && addressRank('100.64.0.2') === 3 && addressRank('8.8.8.8') === 3 && addressRank('169.254.3.3') === 4, 'ranking: 192.168.x.x first, then 10.x.x.x, then 172.16-31.x.x, then anything else, and self-assigned 169.254.x.x last');
    ok(addressRank('172.15.0.1') === 3 && addressRank('172.32.0.1') === 3 && addressRank('11.0.0.1') === 3 && addressRank('192.169.0.1') === 3, 'the edges of those ranges are exact (172.15 and 172.32 are not private, nor is 11.x or 192.169)');
    ok(sortAddresses(['10.0.0.5', '169.254.1.1', '100.64.0.2', '192.168.1.2', '172.20.0.1']).join() === '192.168.1.2,10.0.0.5,172.20.0.1,100.64.0.2,169.254.1.1', 'a computer with a VPN and a stray link-local address still shows its home-network address first');
    ok(sortAddresses(['192.168.1.9', '192.168.0.4', '10.1.1.1', '10.2.2.2']).join() === '192.168.1.9,192.168.0.4,10.1.1.1,10.2.2.2' && sortAddresses([]).length === 0, 'addresses of the same kind keep the order the computer lists them in');
    const I = await startServer({});
    const r = await fetch(`http://127.0.0.1:${I.port}/info`);
    const j = await r.json();
    ok(r.status === 200 && /application\/json/.test(r.headers.get('content-type')) && r.headers.get('cache-control') === 'no-store', '/info answers with JSON, never cached');
    ok(Array.isArray(j.addresses) && j.preferred === j.addresses[0] && j.preferred === `127.0.0.1:${I.port}`, 'for a server that only this computer can reach, its address is 127.0.0.1 and the port: ' + j.preferred);
    ok(!/localhost/.test(JSON.stringify(j)), '"localhost" is never given as an address');
    const cr = await host(I.port, 'Ann', {});
    ok(cr.created.addresses.length > 0 && !cr.created.addresses.some(a => /localhost/.test(a)), 'and the join screen and QR code get the same kind of address');
    cr.c.close();
    const head = await fetch(`http://127.0.0.1:${I.port}/info`, { method: 'HEAD' });
    ok(head.status === 200 && (await head.text()) === '', 'HEAD works too');
    await I.srv.close();
    // a server open to the whole network offers real network addresses, best first
    const W = createGameServer({ pagePath: PAGE, log: () => {}, heartbeatMs: 60000 });
    const wp = await W.listen(0, '0.0.0.0');
    const wj = await (await fetch(`http://127.0.0.1:${wp}/info`)).json();
    ok(wj.addresses.length === 0 ? wj.preferred === `127.0.0.1:${wp}` : wj.addresses.every(a => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(a) && !a.startsWith('127.')) && wj.preferred === wj.addresses[0], 'a server listening on the whole network offers this computer\'s network addresses (none starting 127.), best first: ' + wj.addresses.join(', '));
    ok(wj.addresses.length < 2 || addressRank(wj.addresses[0].split(':')[0]) <= addressRank(wj.addresses[1].split(':')[0]), '(in ranked order)');
    await W.close();
  }

  console.log('2. connecting');
  {
    const c = await connect(S.port);
    ok(c.all[0].t === 'hello' && c.all[0].game === 'mexican-train' && c.all[0].v === 1, 'the server greets every connection with its game and protocol version');
    const bad = new Client(S.port, '/elsewhere');
    await until(() => bad.errored, 1500);
    ok(!bad.openedOk && bad.errored, 'a WebSocket to any path but /ws is refused');
    // the connection cap (6): c is one; open 5 more, the next is refused
    const more = []; for (let i = 0; i < 5; i++) more.push(await connect(S.port));
    const over = new Client(S.port);
    await until(() => over.errored, 1500);
    ok(!over.openedOk && over.errored, 'beyond the connection limit, new connections are refused (503)');
    more.forEach(m => m.close()); c.close();
    await until(() => S.srv.conns.size === 0);
    const again = await connect(S.port);
    ok(again.openedOk, 'and when others leave, new ones are welcome again');
    again.close();
  }
  await S.srv.close();

  /* ======================================================================== */
  console.log('3. hosting, codes and the lobby');
  const L = await startServer({ ratePerSecond: 5000, burst: 10000, nameRng: mulberry32(3) });
  {
    const h = await host(L.port, 'Ann', { rounds: 4, hand: 15 });
    const cr = h.created;
    ok(/^[A-Z0-9]{6}$/.test(cr.code) && [...cr.code].every(ch => CODE_ALPHABET.includes(ch)), `the join code is 6 characters from an unambiguous alphabet (${cr.display})`);
    ok(cr.display === `${cr.code.slice(0, 3)}-${cr.code.slice(3)}` && !/[01OIL]/.test(cr.code), 'shown as ABC-DEF; no 0, O, 1, I or L to mix up');
    ok(/^[0-9a-f]{32}$/.test(cr.token) && cr.seat === 0, 'the host gets a private 128-bit token (for coming back) and is seat 0');
    ok(Array.isArray(cr.addresses) && cr.addresses.every(a => /:\d+$/.test(a)) && cr.settings.rounds === 4 && cr.settings.hand === 15, 'and the addresses the server can be reached on, and the settings');
    const lob = await h.c.next(m => m.t === 'lobby');
    ok(lob.players[0].name === 'Ann' && lob.players[0].connected && lob.players[1] === null && lob.canStart === false && lob.seat === 0, 'the lobby shows one player and cannot be started yet');
    // wrong codes
    const w = await connect(L.port);
    w.send({ t: 'join', code: 'ZZZ-ZZZ', name: 'X' });
    ok((await w.next(m => m.t === 'error')).code === 'no_such_game', 'a wrong code is "no such game"');
    w.send({ t: 'join', code: '', name: 'X' }); ok((await w.next(m => m.t === 'error')).code === 'no_such_game', 'an empty code too');
    w.send({ t: 'join', code: { x: 1 }, name: 'X' }); ok((await w.next(m => m.t === 'error')).code === 'no_such_game', 'and a code that is not even text');
    // the code is forgiving: lower case, hyphen, spaces
    const messy = ' ' + cr.display.toLowerCase().replace('-', ' - ') + ' ';
    const g = await join(L.port, messy, 'Ben');
    ok(g.joined.t === 'joined' && g.joined.seat === 1 && /^[0-9a-f]{32}$/.test(g.joined.token) && g.joined.token !== cr.token, 'joining works with lower case, spaces and the hyphen, and gives the guest their own token');
    const lob2 = await h.c.next(m => m.t === 'lobby' && m.players[1]);
    ok(lob2.players[1].name === 'Ben' && lob2.canStart === true, 'the host sees the guest arrive, and can now start');
    const lobG = await g.c.next(m => m.t === 'lobby');
    ok(lobG.seat === 1 && lobG.players[0].name === 'Ann', 'the guest sees the host');
    // a third person
    const third = await join(L.port, cr.code, 'Cy');
    ok(third.joined.t === 'error' && third.joined.code === 'game_full', 'a third player is told the game is full');
    // permissions
    g.c.send({ t: 'start' }); ok((await g.c.next(m => m.t === 'error')).code === 'not_allowed', 'only the host can start');
    g.c.send({ t: 'settings', rounds: 1, hand: 8 }); ok((await g.c.next(m => m.t === 'error')).code === 'not_allowed', 'only the host can change the settings');
    h.c.send({ t: 'settings', rounds: 13, hand: 12 });
    const lob3 = await h.c.next(m => m.t === 'lobby' && m.settings.rounds === 13);
    ok(lob3.settings.hand === 12, 'the host can change them (13 rounds, 12 tiles)');
    h.c.send({ t: 'settings', rounds: 7, hand: 99 }); await wait(60);
    ok(h.c.last('lobby').settings.rounds === 13 && h.c.last('lobby').settings.hand === 12, 'invalid settings are ignored');
    h.c.send({ t: 'create', name: 'Again' }); ok((await h.c.next(m => m.t === 'error')).code === 'already_in_game', 'one game per connection');
    // names
    const h2 = await host(L.port, '<img src=x onerror=alert(1)> "Eve"', {});
    const g2 = await join(L.port, h2.created.code, '<img src=x onerror=alert(1)> "Eve"');
    const lobN = await h2.c.next(m => m.t === 'lobby' && m.players[1]);
    ok(lobN.players.every(p => !/[<>"&=]/.test(p.name)) && lobN.players[0].name !== lobN.players[1].name, 'hostile names are cleaned, and two players cannot share a name: ' + lobN.players.map(p => p.name).join(' / '));
    const h3 = await host(L.port, 'x'.repeat(200), {}); await h3.c.next(m => m.t === 'lobby');
    ok(h3.c.last('lobby').players[0].name.length === 20, 'a long name is cut to 20 characters');
    const h4 = await host(L.port, undefined, { rounds: 'many', hand: -3 }); const l4 = await h4.c.next(m => m.t === 'lobby');
    ok(l4.players[0].name === 'Host' && l4.settings.rounds === 4 && l4.settings.hand === 15, 'a missing name and nonsense settings get defaults');
    [h2.c, g2.c, h3.c, h4.c, third.c].forEach(x => x.close());
    h.c.close(); g.c.close();
  }
  ok(normalizeCode(' ab-c d_e!f ') === 'ABCDEF' && showCode('ABCDEF') === 'ABC-DEF' && normalizeCode(null) === '' && normalizeCode(12) === '12', 'code helpers: tidy, upper-case and format');

  /* ======================================================================== */
  console.log('3b. a computer player in the lobby');
  {
    const lev = G2.levelOfName;
    const h = await host(L.port, 'Ann', { rounds: 1, hand: 8, computer: 'hard' });
    ok(h.created.settings.computer === 'hard', 'the host can ask for a computer player when creating the game (Hard)');
    const l1 = await h.c.next(m => m.t === 'lobby');
    ok(l1.players.length === 3 && l1.players[2].computer === true && l1.players[2].level === 'hard' && l1.players[2].connected === true && lev(l1.players[2].name) === 'hard', 'the lobby lists it as a third player, with a name from the Hard computer players: ' + l1.players[2].name);
    ok(l1.players[1] === null && l1.canStart === false, 'while the second person has not joined, the game cannot start');
    const g = await join(L.port, h.created.code, 'Ben');
    const l2 = await h.c.next(m => m.t === 'lobby' && m.players[1]);
    ok(l2.players.length === 3 && l2.canStart === true && l2.players[0].name === 'Ann' && l2.players[1].name === 'Ben', 'once Ben has joined it can start: Ann, Ben and the computer');
    const lg = await g.c.next(m => m.t === 'lobby' && m.players[1]);
    ok(lg.players.length === 3 && lg.settings.computer === 'hard', 'and Ben sees the computer player too');
    const nameBefore = l2.players[2].name;
    h.c.send({ t: 'settings', computer: 'easy' });
    const l3 = await h.c.next(m => m.t === 'lobby' && m.settings.computer === 'easy');
    ok(lev(l3.players[2].name) === 'easy' && l3.players[2].level === 'easy', 'changing the level gives it a name from that level: ' + nameBefore + ' becomes ' + l3.players[2].name);
    h.c.send({ t: 'settings', computer: 'easy', rounds: 1 });
    const l3b = await h.c.next(m => m.t === 'lobby' && m.settings.computer === 'easy');
    ok(l3b.players[2].name === l3.players[2].name, 'asking for the same level again keeps its name');
    h.c.send({ t: 'settings', computer: 'godlike' }); await wait(80);
    ok(h.c.last('lobby').settings.computer === 'easy' && h.c.last('lobby').players.length === 3, 'a level that does not exist is ignored (the computer is not removed by a typo)');
    g.c.send({ t: 'settings', computer: 'none' }); ok((await g.c.next(m => m.t === 'error')).code === 'not_allowed', 'a guest cannot remove it');
    h.c.send({ t: 'settings', computer: 'none' });
    const l4 = await h.c.next(m => m.t === 'lobby' && m.settings.computer === null);
    ok(l4.players.length === 2 && l4.settings.computer === null, '"none" removes it: back to two players');
    h.c.send({ t: 'settings', computer: 'normal' });
    const l5 = await h.c.next(m => m.t === 'lobby' && m.settings.computer === 'normal');
    ok(l5.players.length === 3 && lev(l5.players[2].name) === 'normal', 'and it can be added again');
    // the game: a computer takes part
    h.c.send({ t: 'start' });
    const st = await h.c.next(m => m.t === 'state', 3000);
    ok(st && st.view.me.seat === 0 && st.view.opps.map(o => o.seat).join() === '1,2', 'the first state tells the host her seat (0) and the other players\' seats (1, 2), which is what colours the toy trains the same on every screen');
    ok(st && st.view.game.players.length === 3 && st.view.game.players[2].name === l5.players[2].name && st.view.opps[1].computer === true && st.view.opps[1].level === 'normal', 'starting seats all three at once: the computer is in the game from the first state, under its lobby name');
    h.c.close(); g.c.close();
    // names
    const h2 = await host(L.port, 'Host', { computer: 'normal' });
    const lob2 = await h2.c.next(m => m.t === 'lobby'); const cname = lob2.players[2].name;
    const g2 = await join(L.port, h2.created.code, cname.toUpperCase());
    const lob2b = await h2.c.next(m => m.t === 'lobby' && m.players[1]);
    ok(lob2b.players[1].name.toLowerCase() !== cname.toLowerCase() && lob2b.players[1].name.toLowerCase().startsWith(cname.slice(0, 3).toLowerCase()), 'a guest who types the computer\'s name gets a different one: ' + lob2b.players[1].name);
    const bad = await host(L.port, 'Odd', { computer: 'invincible' }); const lb = await bad.c.next(m => m.t === 'lobby');
    ok(lb.settings.computer === null && lb.players.length === 2, 'an unknown level when creating means no computer player');
    const nn = await host(L.port, 'Odd', { computer: 'none' }); const ln = await nn.c.next(m => m.t === 'lobby');
    ok(ln.settings.computer === null && ln.players.length === 2, '(as does "none")');
    [h2.c, g2.c, bad.c, nn.c].forEach(x => x.close());
  }
  {
    // whole games with two people and a computer, over real sockets
    let finished = 0, games = 0, leaks = 0, refused = 0, sent = 0, consistent = true;
    for (let seed = 1; seed <= 4; seed++) {
      const level = ['easy', 'normal', 'hard'][seed % 3];
      const h = await host(L.port, 'Ann', { rounds: seed % 2 ? 1 : 4, hand: [8, 12][seed % 2], computer: level });
      const g = await join(L.port, h.created.code, 'Ben');
      await h.c.next(m => m.t === 'lobby' && m.players[1]);
      h.c.send({ t: 'start' });
      const sa = {}, sb = {};
      await Promise.all([drive(h.c, policyFor(mulberry32(seed)), sa), drive(g.c, policyFor(mulberry32(seed + 50)), sb)]);
      games++; if (sa.final && sb.final) finished++;
      refused += (sa.refused || 0) + (sb.refused || 0); sent += (sa.sent || 0) + (sb.sent || 0);
      for (const c of [h.c, g.c]) for (const m of c.of('state')) {
        const gm = m.view.game; if (!gm) continue;
        if (gm.players.length !== 3) leaks++;
        if (!gm.players.slice(1).every(p => p.hand.every(t => t[0] < 0)) || !gm.boneyard.every(t => t[0] < 0)) leaks++;
        for (const id of ['cpu', 'cpu2']) if (gm.opening && !gm.opening[id].finished && !gm.trains[id].tiles.every(t => t[0] < 0)) leaks++;
        for (const ev of m.events) if (ev.e === 'play' && ev.who !== 'me' && ev.hidden && (ev.tile !== null || ev.placed[0] >= 0)) leaks++;
      }
      if (sa.final && sb.final) { const fa = sa.final.totals, fb = sb.final.totals; if (!(fa.human === fb.cpu2 && fa.cpu === fb.human && fa.cpu2 === fb.cpu)) consistent = false; }
      h.c.close(); g.c.close();
    }
    ok(finished === games, `${games} complete games with a computer as the third player ran to the final score over sockets (${finished}/${games})`);
    ok(sent > 200 && refused === 0, `${sent} moves sent by the two people, none refused`);
    ok(leaks === 0, 'in every message each person got, the other two players\' hands, the boneyard and face-down trains were only placeholders');
    ok(consistent, 'both people ended with the same three scores, each under the right names');
  }
  {
    // a person drops out of a game with a computer: it pauses, and comes back
    const T = await startServer({});
    const h = await host(T.port, 'Ann', { rounds: 4, hand: 15, computer: 'normal' });
    const g = await join(T.port, h.created.code, 'Ben');
    await h.c.next(m => m.t === 'lobby' && m.players[1]);
    h.c.send({ t: 'start' }); await h.c.next(m => m.t === 'state'); await g.c.next(m => m.t === 'state');
    g.c.close();
    const p = await h.c.next(m => m.t === 'presence' && m.oppConnected === false, 3000);
    ok(!!p, 'with a computer in the game, a dropped person still pauses it for the other');
    const b2 = await connect(T.port); b2.send({ t: 'resume', code: h.created.code, token: g.joined.token });
    const res = await b2.next(m => m.t === 'resumed', 3000); const full = await b2.next(m => m.t === 'state', 3000);
    ok(res && full && full.view.game.players.length === 3 && full.view.me.name === 'Ben' && full.view.opps.length === 2, 'and he returns to a three-player game as himself');
    h.c.close(); b2.close(); await T.srv.close();
  }

  /* ======================================================================== */
  console.log('4. misbehaving clients');
  const AB = await startServer({});                         // the default limits
  {
    const c = await connect(AB.port);
    c.send('this is not json');
    ok((await c.next(m => m.t === 'error')).code === 'bad_json', 'text that is not JSON: an error, not a crash');
    c.send('[1,2,3]'); ok((await c.next(m => m.t === 'error')).code === 'bad_message', 'a JSON array: refused');
    c.send('"hello"'); ok((await c.next(m => m.t === 'error')).code === 'bad_message', 'a JSON string: refused');
    c.send('null'); ok((await c.next(m => m.t === 'error')).code === 'bad_message', 'null: refused');
    c.send({ x: 1 }); ok((await c.next(m => m.t === 'error')).code === 'bad_message', 'an object without a type: refused');
    c.send({ t: 5 }); ok((await c.next(m => m.t === 'error')).code === 'bad_message', 'a type that is not a string: refused');
    c.send({ t: 'explode' }); ok((await c.next(m => m.t === 'error')).code === 'unknown_type', 'an unknown type: refused');
    c.send({ t: 'i', a: 'play', tile: [1, 2], train: 'human' }); ok((await c.next(m => m.t === 'error')).code === 'not_now', 'a move before being in a game: "no game in progress"');
    c.send({ t: 'chat', id: 0 }); ok((await c.next(m => m.t === 'error')).code === 'not_in_game', 'chat before being in a game: refused');
    c.send({ t: 'start' }); ok((await c.next(m => m.t === 'error')).code === 'not_allowed', 'starting without a game: refused');
    c.send({ t: 'resume', code: 'ABCDEF', token: 'nope' }); ok((await c.next(m => m.t === 'error')).code === 'no_such_game', 'resuming with a made-up token: refused');
    c.send({ t: 'resume', code: 'ABCDEF' }); ok((await c.next(m => m.t === 'error')).code === 'no_such_game', 'resuming without a token: refused');
    c.send({ t: 'ping', n: 7 }); ok((await c.next(m => m.t === 'pong')).n === 7, 'ping is answered with the same number');
    c.send({ t: 'ping', n: 'x' }); ok((await c.next(m => m.t === 'pong')).n === 0, '(a non-numeric ping value is replaced by 0)');
    ok(!c.closeInfo, 'and through all of that, the connection stayed up');
    for (let i = 0; i < 25; i++) c.send({ t: 'explode' });
    ok(await until(() => c.closeInfo && c.closeInfo.code === 1008, 3000), 'a client that keeps sending nonsense is disconnected (1008)');
    const big = await connect(AB.port);
    big.send('x'.repeat(9000));
    ok(await until(() => big.closeInfo && big.closeInfo.code === 1009, 3000), 'a message over 8 KB closes the connection (1009)');
    const bin = await connect(AB.port);
    bin.ws.send(Buffer.from([1, 2, 3]));
    ok(await until(() => bin.closeInfo && bin.closeInfo.code === 1003, 3000), 'a binary message closes the connection (1003)');
    const flood = await connect(AB.port);
    for (let i = 0; i < 400; i++) flood.send({ t: 'ping', n: i });
    ok(await until(() => flood.closeInfo && flood.closeInfo.code === 1008, 4000), 'flooding (400 messages at once) gets the connection closed (1008)');
    const ok1 = await connect(AB.port); ok1.send({ t: 'ping', n: 1 });
    ok((await ok1.next(m => m.t === 'pong')) !== null, 'and the server is unaffected for everybody else');
    ok1.close();
    const flooded = await connect(AB.port);
    for (let i = 0; i < 120; i++) flooded.send({ t: 'ping', n: i });
    ok(await until(() => flooded.of('error').some(m => m.code === 'slow_down'), 2000), 'when messages come too fast the server answers "slow down" instead of silently ignoring them');
    flooded.close();
  }
  await AB.srv.close();

  /* ======================================================================== */
  console.log('5. whole matches over real sockets');
  {
    let games = 0, finished = 0, refusedTotal = 0, leaks = 0, sentTotal = 0, consistent = true;
    for (let seed = 1; seed <= 6; seed++) {
      const { a, b } = await pair(L.port, { rounds: seed % 2 ? 1 : 4, hand: [8, 12, 15][seed % 3] });
      a.send({ t: 'start' });
      const sa = {}, sb = {};
      await Promise.all([drive(a, policyFor(mulberry32(seed)), sa), drive(b, policyFor(mulberry32(seed + 100)), sb)]);
      games++;
      if (sa.final && sb.final) finished++;
      refusedTotal += (sa.refused || 0) + (sb.refused || 0); sentTotal += (sa.sent || 0) + (sb.sent || 0);
      leaks += structuralLeaks(a) + structuralLeaks(b);
      if (sa.final && sb.final && !(sa.final.totals.human === sb.final.totals.cpu && sa.final.totals.cpu === sb.final.totals.human && sa.final.modal.totals.human === sa.final.totals.human)) consistent = false;
      a.close(); b.close();
    }
    ok(finished === games, `${games} complete games between two random players over sockets: all ran to the final score (${finished}/${games})`);
    ok(sentTotal > 500 && refusedTotal === 0, `${sentTotal} moves sent, none refused: the server and the players always agreed on what was legal`);
    ok(consistent, 'both players ended with the same scores, each seeing them from their own side');
    ok(leaks === 0, 'in every message each player received, the opponent\'s hand, the boneyard and a face-down train were only placeholders');
  }
  {
    // using every tile on the first train, through the network (the deal is rigged by the server's test hook)
    const POOL = (() => { const t = []; for (let x = 0; x <= 12; x++) for (let y = x; y <= 12; y++) if (!(x === 12 && y === 12)) t.push([x, y]); return t; })();
    const CHAIN = [[11, 12], [10, 11], [10, 10], [9, 10], [9, 9], [8, 9], [7, 8], [6, 7], [5, 6], [4, 5], [3, 4], [2, 3], [1, 2], [0, 1], [0, 3]];
    const EV = [[0, 2], [0, 4], [0, 6], [0, 8], [0, 10], [2, 4], [2, 6], [2, 8], [2, 10], [4, 6], [4, 8], [4, 10], [6, 8], [6, 10], [8, 10]];
    const rig = (s0, s1) => () => {
      const used = new Set([...s0, ...s1].map(t => key(canon(t)))), rest = POOL.filter(t => !used.has(key(t)));
      const target = [...s0.map(canon), ...s1.map(canon), ...rest], w = POOL.map(t => t.slice()), vals = [];
      for (let i = target.length - 1; i >= 1; i--) { const j = w.slice(0, i + 1).findIndex(t => key(t) === key(target[i])); vals.push((j + 0.5) / (i + 1)); [w[i], w[j]] = [w[j], w[i]]; }
      const seq = [0.1, ...vals]; let n = 0; const fb = mulberry32(5);
      return () => (n < seq.length ? seq[n++] : fb());
    };
    const R = await startServer({ rng: rig(CHAIN, EV) });
    const { a, b } = await pair(R.port, { rounds: 1, hand: 15 });
    a.send({ t: 'start' });
    let st = await a.next(m => m.t === 'state' && m.view.awaiting && m.view.awaiting.kind === 'build');
    ok(st.view.awaiting.buildCount === 15 && st.view.awaiting.canBuild, 'Ann, dealt a complete train, is offered "Build my longest train" (15 tiles)');
    a.send({ t: 'i', id: 1, a: 'autoBuild' });
    ok((await a.next(m => m.t === 'ack' && m.id === 1)).ok === true, 'the server accepts it');
    st = await a.next(m => m.t === 'state' && m.view.awaiting && m.view.awaiting.placed === 15, 5000);
    ok(!!st && st.view.game.players[0].hand.length === 0, 'all 15 tiles are laid, one after another');
    ok(a.of('state').flatMap(m => m.events).filter(e => e.e === 'play').length === 15, 'announced to her as 15 separate play events');
    await until(() => b.of('state').flatMap(m => m.events).filter(e => e.e === 'play' && e.who === 'opp').length >= 15, 3000);
    ok(b.of('state').flatMap(m => m.events).filter(e => e.e === 'play' && e.who === 'opp').length === 15 && b.of('state').flatMap(m => m.events).filter(e => e.e === 'play').every(e => e.tile === null), 'and to Ben as 15 plays whose tiles are hidden from him');
    a.send({ t: 'i', id: 2, a: 'done' });
    // Ben has no 12: he draws, passes, and the round is over
    const sb = {}; const bs = await b.next(m => m.t === 'state' && m.view.awaiting, 3000);
    b.send({ t: 'i', id: 1, a: 'draw' });
    const endA = await a.next(m => m.t === 'state' && m.view.modal && m.view.modal.type === 'roundEnd', 5000);
    const endB = await b.next(m => m.t === 'state' && m.view.modal && m.view.modal.type === 'roundEnd', 5000);
    ok(endA && endA.view.modal.winnerId === 'human' && endA.view.modal.rows[0].pips === 0 && /You went out|human/.test(JSON.stringify(endA.view.modal)), 'Ann wins the round with 0 points, on her first turn');
    ok(endB && endB.view.modal.winnerId === 'cpu' && endB.view.modal.rows[0].name === 'You' && endB.view.modal.rows[0].pips === endA.view.modal.rows[1].pips, 'Ben sees it from his side: the other player won, and his own points are the same number');
    a.send({ t: 'i', id: 3, a: 'ok' }); b.send({ t: 'i', id: 2, a: 'ok' });
    const fin = await a.next(m => m.t === 'state' && m.view.modal && m.view.modal.type === 'final', 5000);
    ok(fin && fin.view.over === 'finished' && fin.view.totals.human === 0, 'then the final score: Ann 0');
    a.close(); b.close(); await R.srv.close();
  }

  /* ======================================================================== */
  console.log('6. dropping and coming back');
  {
    const { a, b, code, tokenA, tokenB } = await pair(L.port, { rounds: 1, hand: 12 });
    a.send({ t: 'start' });
    const sa = {}; 
    await a.next(m => m.t === 'state' && m.view.awaiting);
    // play a bit, then Ben vanishes
    const rndA = policyFor(mulberry32(3)), rndB = policyFor(mulberry32(4));
    for (let i = 0; i < 6; i++) {
      const sA = a.q.filter(m => m.t === 'state').pop(); a.q.length = 0;
      if (sA && sA.view.awaiting) { a.send(Object.assign({ t: 'i', id: 100 + i }, rndA(sA.view))); await a.next(m => m.t === 'ack' && m.id === 100 + i); }
      await wait(30);
    }
    const handBefore = a.last('state').view.game.players[0].hand.length;
    b.close();
    const pres = await a.next(m => m.t === 'presence' && m.oppConnected === false, 3000);
    ok(pres && typeof pres.graceUntil === 'number' && pres.graceUntil > Date.now() + 170000 && pres.graceUntil < Date.now() + 190000, 'when Ben drops, Ann is told, with the moment the 3 minutes run out');
    const paused = await a.next(m => m.t === 'state' && m.view.paused === true, 3000);
    ok(!!paused, 'and the game is paused');
    a.send({ t: 'i', id: 999, a: 'draw' });
    const errp = await a.next(m => m.t === 'error' && (m.code === 'paused' || m.code === 'illegal' || m.code === 'not_now'), 2000);
    ok(errp && errp.code !== undefined, 'while paused, Ann\'s moves are refused (' + (errp && errp.code) + ')');
    // wrong token cannot take Ben's place
    const thief = await connect(L.port);
    thief.send({ t: 'resume', code, token: tokenA.replace(/./, c => (c === '0' ? '1' : '0')) });
    ok((await thief.next(m => m.t === 'error')).code === 'no_such_game', 'someone with a wrong token cannot take a seat');
    thief.send({ t: 'resume', code, token: tokenB.toUpperCase().slice(0, 31) }); ok((await thief.next(m => m.t === 'error')).code === 'no_such_game', 'nor one with a token of the wrong length');
    thief.close();
    // Ben comes back with the right token
    const b2 = await connect(L.port);
    b2.send({ t: 'resume', code, token: tokenB });
    const res = await b2.next(m => m.t === 'resumed', 3000);
    ok(res && res.seat === 1 && res.state === 'playing', 'Ben comes back with his token and is put in his own seat');
    const full = await b2.next(m => m.t === 'state', 3000);
    ok(full && full.view.game && full.view.game.players[0].hand.length > 0 && full.view.me.name === 'Ben', 'and is sent the full game as it stands, his own hand included');
    const back = await a.next(m => m.t === 'presence' && m.oppConnected === true, 3000);
    ok(!!back, 'Ann is told he is back');
    const unp = await a.next(m => m.t === 'state' && m.view.paused === false, 3000);
    ok(!!unp, 'and the game carries on');
    // finish the game with both
    const stA = {}, stB = {};
    await Promise.all([drive(a, rndA, stA), drive(b2, rndB, stB)]);
    ok(!!stA.final && !!stB.final, 'the match is played to the end after the break');
    ok(a.of('state').filter(m => m.view.game).every(m => m.view.game.players[0].hand.length <= 40), '(nothing odd happened to Ann\'s hand: it was ' + handBefore + ' tiles when Ben dropped)');
    a.close(); b2.close();
  }
  {
    // a second connection takes over a seat: the old one is closed
    const { a, b, code, tokenA } = await pair(L.port, { rounds: 1, hand: 8 });
    a.send({ t: 'start' }); await a.next(m => m.t === 'state');
    const a2 = await connect(L.port);
    a2.send({ t: 'resume', code, token: tokenA });
    ok((await a2.next(m => m.t === 'resumed')) !== null, 'the same player reloads the page: the new connection takes the seat');
    ok(await until(() => a.closeInfo && a.closeInfo.code === 4000, 2000), 'and the old connection is closed (4000), not left as a ghost');
    await wait(100);
    ok(a2.last('state') !== null || a2.last('resumed') !== null, 'the new connection is fully in the game');
    a2.close(); b.close();
  }
  {
    // the time limit
    const T = await startServer({ graceMs: 400 });
    const { a, b, code, tokenB } = await pair(T.port, { rounds: 1, hand: 8 });
    a.send({ t: 'start' }); await a.next(m => m.t === 'state');
    b.close();
    const ended = await a.next(m => m.t === 'ended', 3000);
    ok(ended && ended.reason === 'timeout' && /did not come back/.test(ended.message) && /Ben/.test(ended.message), 'if Ben is gone for longer than the limit, Ann is told the game is over, and why');
    const late = await connect(T.port);
    late.send({ t: 'resume', code, token: tokenB });
    const lateMsg = await late.next(m => m.t === 'ended' || m.t === 'error', 2000);
    ok(lateMsg && (lateMsg.t === 'ended' || lateMsg.code === 'no_such_game'), 'Ben coming back too late is told it is over');
    // coming back inside the limit is fine
    const p2 = await pair(T.port, { rounds: 1, hand: 8 });
    p2.a.send({ t: 'start' }); await p2.a.next(m => m.t === 'state');
    p2.b.close(); await wait(120);
    const b3 = await connect(T.port); b3.send({ t: 'resume', code: p2.code, token: p2.tokenB });
    ok((await b3.next(m => m.t === 'resumed')) !== null, 'inside the limit he can come back');
    await wait(600);
    ok(!p2.a.of('ended').length && !b3.of('ended').length, 'and the old deadline does not end the game afterwards');
    [a, late, p2.a, b3].forEach(x => x.close());
    // lobby
    const lob = await pair(T.port, {});
    lob.a.q.length = 0;                                     // forget the lobby messages from before Ben joined, so only the news of him leaving can match
    lob.b.close();
    const freed = await lob.a.next(m => m.t === 'lobby' && m.players[1] === null, 2000);
    ok(!!freed && freed.canStart === false, 'a guest who leaves the lobby just frees the seat');
    const g2 = await join(T.port, lob.code, 'Cy');
    ok(g2.joined.t === 'joined', 'and someone else can take it' + (g2.joined.t === 'error' ? ' (got: ' + JSON.stringify(g2.joined) + ')' : ''));
    lob.a.close();
    const gone = await g2.c.next(m => m.t === 'ended', 3000);
    ok(gone && gone.reason === 'timeout', 'if the host drops from the lobby and does not return, the guest is told');
    g2.c.close();
    await T.srv.close();
  }
  {
    // leaving on purpose
    const LV = await startServer({ overRoomMs: 200 });
    const { a, b, code: leftCode } = await pair(LV.port, { rounds: 1, hand: 8 });
    a.send({ t: 'start' }); await a.next(m => m.t === 'state'); await b.next(m => m.t === 'state');
    b.send({ t: 'leave' });
    const e = await a.next(m => m.t === 'ended', 2000);
    ok(e && e.reason === 'left' && /Ben/.test(e.message), 'a player who leaves ends the game, and the other is told who left');
    a.close(); b.close();
    const h = await host(LV.port, 'Solo'); await h.c.next(m => m.t === 'lobby');
    const g = await join(LV.port, h.created.code, 'Duo'); await h.c.next(m => m.t === 'lobby' && m.players[1]);
    h.c.send({ t: 'leave' });
    const e2 = await g.c.next(m => m.t === 'ended', 2000);
    ok(e2 && e2.reason === 'left', 'if the host closes the game from the lobby, the guest is told');
    h.c.close(); g.c.close();
    await until(() => !LV.srv.rooms.has(h.created.code) && !LV.srv.rooms.has(leftCode), 3000);
    ok(!LV.srv.rooms.has(h.created.code) && !LV.srv.rooms.has(leftCode), 'and games that were left on purpose are removed from the server once everyone has gone');
    await LV.srv.close();
  }

  /* ======================================================================== */
  console.log('7. quick chat');
  {
    const { a, b } = await pair(L.port, {});
    a.send({ t: 'chat', id: 0, text: '<script>alert(1)</script>' });
    const m = await b.next(x => x.t === 'chat', 2000);
    ok(m && m.id === 0 && m.text === E.CHAT_PHRASES[0] && !/script/.test(JSON.stringify(m)), 'a phrase reaches the other player, and any text sent along with it is ignored');
    ok(!a.of('chat').length, 'and is not echoed back to the sender');
    a.send({ t: 'chat', id: 1 }); ok((await a.next(x => x.t === 'error')).code === 'slow_down', 'phrases are rate-limited');
    await wait(1600);
    for (const bad of [-1, 99, 1.5, '0', null, undefined, {}]) { a.send({ t: 'chat', id: bad }); await a.next(x => x.t === 'error'); }
    ok(!b.of('chat').some(x => x.id !== 0), 'invalid phrase numbers never reach the other player');
    b.send({ t: 'chat', id: E.CHAT_PHRASES.length - 1 });
    ok((await a.next(x => x.t === 'chat', 2000)).text === E.CHAT_PHRASES[E.CHAT_PHRASES.length - 1], 'it works both ways, and for the last phrase in the list');
    a.close(); b.close();
  }

  /* ======================================================================== */
  console.log('8. many games at once');
  {
    const N = 12;
    const pairs = [];
    for (let i = 0; i < N; i++) pairs.push(await pair(L.port, { rounds: 1, hand: 8 }));
    ok(L.srv.rooms.size >= N, `${N} games are open on one server`);
    const results = await Promise.all(pairs.map(async (p, i) => {
      p.a.send({ t: 'start' });
      const sa = {}, sb = {};
      await Promise.all([drive(p.a, policyFor(mulberry32(i + 1)), sa), drive(p.b, policyFor(mulberry32(i + 51)), sb)]);
      return { sa, sb, leaks: structuralLeaks(p.a) + structuralLeaks(p.b), names: [p.a.last('state').view.me.name, p.a.last('state').view.opp.name, p.b.last('state').view.me.name, p.b.last('state').view.opp.name] };
    }));
    ok(results.every(r => r.sa.final && r.sb.final), `all ${N} games finished`);
    ok(results.every(r => r.names.join() === 'Ann,Ben,Ben,Ann'), 'in every one, each player met only their own opponent: no messages crossed between games');
    ok(results.every(r => r.leaks === 0 && !r.sa.refused && !r.sb.refused), 'with no leaks and no refused moves');
    pairs.forEach(p => { p.a.close(); p.b.close(); });
  }
  {
    const F = await startServer({ maxRooms: 3 });
    const hs = []; for (let i = 0; i < 3; i++) hs.push(await host(F.port, 'H' + i));
    const over = await connect(F.port); over.send({ t: 'create', name: 'Late' });
    ok((await over.next(m => m.t === 'error')).code === 'server_full', 'beyond the room limit, creating a game says the server is full');
    hs[0].c.send({ t: 'leave' }); await wait(80);
    over.send({ t: 'create', name: 'Late' });
    ok((await over.next(m => m.t === 'created', 2000)) !== null, 'and as soon as a game ends there is room again');
    [...hs.map(h => h.c), over].forEach(x => x.close());
    await F.srv.close();
    const W = await startServer({ maxWrongCodes: 3 });
    const real = await host(W.port, 'Real');
    const guesser = await connect(W.port);
    for (let i = 0; i < 3; i++) { guesser.send({ t: 'join', code: 'AAAAA' + i, name: 'G' }); await guesser.next(m => m.t === 'error'); }
    guesser.send({ t: 'join', code: real.created.code, name: 'G' });
    ok((await guesser.next(m => m.t === 'error')).code === 'too_many_tries', 'after a few wrong codes, even the right code must wait (so codes cannot be guessed)');
    [real.c, guesser].forEach(x => x.close());
    await W.srv.close();
  }

  /* ======================================================================== */
  console.log('9. dead connections are noticed');
  {
    const H = await startServer({ heartbeatMs: 120 });
    // a raw TCP client that completes the handshake and then never answers pings
    const sock = net.connect(H.port, '127.0.0.1');
    let closed = false; sock.on('data', () => {}); sock.on('close', () => { closed = true; }); sock.on('error', () => {});   // (a socket nobody reads from is paused and never notices the close)
    sock.on('connect', () => sock.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    const live = await connect(H.port);
    ok(await until(() => closed, 2500), 'a connection that stops answering the server\'s pings is dropped');
    await wait(400);
    ok(!live.closeInfo, 'while a normal client, which answers pings by itself, stays connected');
    live.close();
    await H.srv.close();
  }

  /* ======================================================================== */
  console.log('10. the command line');
  {
    const run = (args, ms) => new Promise(res => {
      const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), ...args], { cwd: path.join(__dirname, '..') });
      const r = { code: null, out: '', err: '', p };
      p.stdout.on('data', d => { r.out += d; }); p.stderr.on('data', d => { r.err += d; });
      p.on('close', code => { r.code = code; res(r); });
      if (ms) setTimeout(() => res(r), ms);                 // r keeps filling in after this, so later output can be read
    });
    let r = await run(['--help']);
    ok(r.code === 0 && /Usage: node server.js/.test(r.out) && /--local-only/.test(r.out) && /whole network/.test(r.out), '--help explains the options, and says what listening on the whole network means');
    r = await run(['--bogus']); ok(r.code === 1 && /Unknown option/.test(r.err), 'an unknown option is an error');
    r = await run(['--port', 'abc']); ok(r.code === 1 && /--port must be/.test(r.err), 'a bad port number is an error');
    r = await run(['--port', '70000']); ok(r.code === 1, 'a port out of range is an error');
    r = await run(['--grace', '1']); ok(r.code === 1 && /--grace/.test(r.err), 'a silly grace time is an error');
    // really start it
    r = await run(['--port', '0', '--local-only'], 1500);
    ok(/Mexican Train server is running/.test(r.out) && /Open\s+http:\/\/127\.0\.0\.1:\d+/.test(r.out) && !/localhost/.test(r.out), 'it starts and prints where to find it, as an IP address and never "localhost"');
    ok(/local-only mode: only this computer/.test(r.out), 'and says it is in local-only mode');
    r.p.kill('SIGINT'); await new Promise(res => r.p.on('close', res));
    ok(/Stopping/.test(r.out) , 'Ctrl+C stops it with a message');
    // the port is taken
    const blocker = net.createServer(); await new Promise(res => blocker.listen(0, '0.0.0.0', res));
    const taken = blocker.address().port;
    r = await run(['--port', String(taken)]);
    ok(r.code === 1 && /already in use/.test(r.err), 'a port that is already in use gets a clear message (pick another with --port)');
    blocker.close();
    // listening on everything prints the network addresses
    r = await run(['--port', '0'], 1500);
    ok(/Open\s+http:\/\/(\d+\.\d+\.\d+\.\d+):\d+\s+in your browser to host a game/.test(r.out) || /no network address was found/.test(r.out), 'without --local-only it listens on the whole network and tells the host to open its network address (an IP such as 192.168.x.x), or says it has none');
    ok(!/localhost/.test(r.out), '...and never shows "localhost"');
    r.p.kill('SIGINT'); await new Promise(res => r.p.on('close', res));
    ok(lanAddresses(1234, true).join() === '127.0.0.1:1234' && lanAddresses(1234, false).every(a => /^\d+\.\d+\.\d+\.\d+:1234$/.test(a)), 'address lists: just 127.0.0.1 when local-only, else dotted IPv4 addresses with the port');
  }

  await L.srv.close();
  await until(() => L.srv.conns.size === 0, 2000);
  ok(L.srv.conns.size === 0, 'shutting down closes every connection');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
