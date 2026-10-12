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


// ---- raw TCP clients: complete control over what is sent (and what is not) ----
const maskedText = text => { const payload = Buffer.from(text), mask = crypto.randomBytes(4), n = payload.length; const hd = n < 126 ? Buffer.from([0x81, 0x80 | n]) : Buffer.from([0x81, 0x80 | 126, n >> 8, n & 255]); const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = payload[i] ^ mask[i & 3]; return Buffer.concat([hd, mask, b]); };
function rawClient(port, ua) {                                 // does the handshake, then does nothing unless told to; reads (so it notices a close) but never answers pings
  const r = { sock: net.connect(port, '127.0.0.1'), closed: false };
  r.sock.on('data', () => {}); r.sock.on('close', () => { r.closed = true; }); r.sock.on('error', () => {});
  r.sock.on('connect', () => r.sock.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n${ua ? 'User-Agent: ' + ua + '\r\n' : ''}\r\n`));
  r.send = o => r.sock.write(maskedText(JSON.stringify(o)));
  return r;
}
const httpGet = (port, p) => new Promise((res, rej) => require('http').get({ host: '127.0.0.1', port, path: p }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej));
const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const serverConn = (srv, seat) => Array.from(srv.conns).find(c => c.session && c.session.seat === seat);

(async () => {
  console.log('1. the settings');
  {
    const D = createGameServer({ pagePath: PAGE, log: () => {} });
    ok(D.options.heartbeatMs === 5000 && D.options.deadAfterMs === 30000 && D.options.softGraceMs === 8000 && D.options.graceMs === 180000, 'by default: a ping every 5 s, a connection dropped after 30 s of complete silence, a game paused after a player has been gone 8 s, and 3 minutes to come back');
    ok(createGameServer({ pagePath: PAGE, log: () => {}, heartbeatMs: 100 }).options.deadAfterMs === 200, 'setting only the ping interval makes silence tolerated for two intervals');
    ok(createGameServer({ pagePath: PAGE, log: () => {}, heartbeatMs: 100, deadAfterMs: 777 }).options.deadAfterMs === 777, 'and the silence allowed can be set on its own');
  }

  console.log('2. what counts as being alive');
  {
    const H = await startServer({ heartbeatMs: 100 });                       // silence of 200 ms is too much
    const silent = rawClient(H.port);
    ok(await until(() => silent.closed, 2500), 'a connection that sends nothing and answers nothing is dropped');
    await H.srv.close();
  }
  {
    const H = await startServer({ heartbeatMs: 100 });
    const talker = rawClient(H.port);                                         // never answers a ping, but sends a message every 50 ms
    await wait(60);
    const iv = setInterval(() => { try { talker.send({ t: 'ping', n: 1 }); } catch (e) { /* closed */ } }, 50);
    await wait(900);
    ok(!talker.closed, 'a connection that never answers a ping, but keeps sending messages, is alive: any traffic is proof of life');
    clearInterval(iv);
    ok(await until(() => talker.closed, 2500), 'and when the messages stop, it is dropped after the silence');
    const live = await connect(H.port);
    await wait(700);
    ok(!live.closeInfo, 'a normal browser, which answers pings by itself, stays connected');
    live.close();
    await H.srv.close();
  }
  {
    const H = await startServer({ heartbeatMs: 1000, deadAfterMs: 3000 });     // the real ticks are far away: this test is the clock
    const logs = []; H.srv.options.log = m => logs.push(m);
    const silent = rawClient(H.port);
    await wait(80);
    const t0 = Date.now();
    H.srv.heartbeat(t0);
    H.srv.heartbeat(t0 + 60000);                                               // this server was not running for a minute (asleep, or stalled)
    await wait(150);                                                           // (time for a drop, if there were one, to show)
    ok(!silent.closed && H.srv.conns.size === 1, 'if THIS server was not running for a minute, a silent connection is not blamed for it');
    ok(logs.some(l => /not running for about 1\.0 min|not running for about 60/.test(l) && /not counted against any player/.test(l)), 'and the log says so: "' + (logs.find(l => /not running/.test(l)) || '') + '"');
    for (let k = 1; k <= 4; k++) H.srv.heartbeat(t0 + 60000 + k * 1000);       // but ordinary silence still counts
    ok(await until(() => silent.closed, 1500), 'but real silence afterwards is still dropped (3 s without a sign of life)');
    ok(H.srv.netStats().thisServer.stallsSeen === 1, 'and the stall was counted');
    await H.srv.close();
  }

  console.log('3. a player who drops is not announced at once: the soft grace');
  const startedPair = async opts => {
    const T = await startServer(opts);
    const p = await pair(T.port, {});
    p.a.send({ t: 'start' });
    await p.a.next(m => m.t === 'state'); await p.b.next(m => m.t === 'state');
    return Object.assign(p, T);
  };
  {
    const T = await startedPair({ softGraceMs: 400, graceMs: 5000 });
    const room = T.srv.rooms.get(T.code);
    serverConn(T.srv, 1).ws.socket.destroy();                                 // Ben's connection vanishes
    await wait(150);
    ok(room.match.paused === false && T.a.of('presence').every(m => m.oppConnected !== false), 'for the first moments nothing happens: the game is not paused and Ann is told nothing');
    const a2 = await connect(T.port); a2.send({ t: 'resume', code: T.code, token: T.tokenA });          // meanwhile Ann's own connection is replaced: she is told the situation again
    await a2.next(m => m.t === 'resumed');
    ok((await a2.next(m => m.t === 'presence')) !== null && a2.last('presence').oppConnected === true, 'a player in the first moments of a drop still counts as there when anyone asks (Ann reconnecting is told Ben is here)');
    const b2 = await connect(T.port); b2.send({ t: 'resume', code: T.code, token: T.tokenB });
    ok(!!(await b2.next(m => m.t === 'resumed')), 'Ben comes back (on a new connection) within the grace');
    await wait(500);                                                          // well past the point where it would have fired
    ok(room.match.paused === false && T.a.of('presence').every(m => m.oppConnected !== false), 'and the blip was never visible: no pause, nothing said to Ann, even after the grace has passed');
    ok(room.players[1].soft === null && room.players[1].conn !== null, '(and nothing is left waiting)');
    b2.close(); a2.close(); T.a.close(); T.b.close(); await T.srv.close();
  }
  {
    const T = await startedPair({ softGraceMs: 300, graceMs: 5000 });
    const room = T.srv.rooms.get(T.code);
    serverConn(T.srv, 1).ws.socket.destroy();
    await wait(700);
    ok(room.match.paused === true, 'if Ben is gone longer than the grace, the game is paused');
    const pr = T.a.of('presence').filter(m => m.oppConnected === false);
    ok(pr.length === 1 && typeof pr[0].graceUntil === 'number', 'and Ann is told, once, with the time he has to come back');
    const b2 = await connect(T.port); b2.send({ t: 'resume', code: T.code, token: T.tokenB });
    await b2.next(m => m.t === 'resumed');
    ok(await until(() => room.match.paused === false, 1000) && await until(() => (T.a.last('presence') || {}).oppConnected === true, 1000), 'and when he returns, the game goes on and Ann is told he is back');
    b2.close(); T.a.close(); T.b.close(); await T.srv.close();
  }
  {
    const T = await startedPair({ softGraceMs: 0, graceMs: 5000 });
    const room = T.srv.rooms.get(T.code);
    serverConn(T.srv, 1).ws.socket.destroy();
    ok(await until(() => room.match.paused === true, 500), 'with the soft grace set to 0, a drop pauses the game at once (the old behaviour)');
    T.a.close(); T.b.close(); await T.srv.close();
  }
  {
    const T = await startedPair({ softGraceMs: 150, graceMs: 600 });
    serverConn(T.srv, 1).ws.socket.destroy();
    const ended = await T.a.next(m => m.t === 'ended', 2500);
    ok(!!ended && /did not come back in time/.test(ended.message || ''), 'a player who never comes back still ends the game when the time to come back runs out (' + (ended && ended.message) + ')');
    T.a.close(); T.b.close(); await T.srv.close();
  }
  {
    const logs = []; const T = await startedPair({ softGraceMs: 300, graceMs: 5000, log: m => logs.push(m) });
    const room = T.srv.rooms.get(T.code);
    serverConn(T.srv, 1).ws.socket.destroy(); await wait(50);
    await T.srv.close();                                                       // the server shuts down during the grace
    await wait(600);                                                           // well past it
    ok(!logs.some(l => /still gone after/.test(l)) && room.match.paused !== true, 'shutting the server down during a grace cancels it: no late announcement, no pause');
    T.a.close(); T.b.close();
  }

  console.log('4. a drop explains itself in the log');
  {
    const logs = []; const T = await startedPair({ softGraceMs: 0, graceMs: 5000, log: m => logs.push(m) });
    const lost = () => logs.filter(l => /lost the connection to game/.test(l)).pop() || '';
    T.b.ws.close(4001, 'page: nothing heard from the server for 31 s');
    await until(() => /Ben lost the connection/.test(lost()));
    ok(/gave up waiting for this server/.test(lost()) && /nothing heard from the server for 31 s/.test(lost()), 'the page ending a connection because it heard nothing: "' + lost().slice(0, 150) + '"');
    ok(/connected; heard from them/.test(lost()) && /no ping answered yet|ping round trip/.test(lost()) && /this server's thread was never busy|no loop-lag/.test(lost()), 'with how long it was up, when it was last heard, the ping times, and whether this server was busy');
    const b2 = await connect(T.port); b2.send({ t: 'resume', code: T.code, token: T.tokenB, d: { why: 'nothing heard from the server for 31 s', hiddenMs: 14000, silentMs: 31000, tries: 3 } });
    await b2.next(m => m.t === 'resumed');
    const back = () => logs.filter(l => /Ben is back in game/.test(l)).pop() || '';
    ok(/after \d/.test(back()) && /their page says: ended because nothing heard from the server for 31 s; it was in the background for 14\.0 s; it had heard nothing for 31\.0 s; 3 attempts to reconnect/.test(back()), 'on resuming, the page\'s own account is logged next to the server\'s: "' + back().slice(0, 230) + '"');
    b2.send({ t: 'ping', n: 1 });
    b2.ws.close(4002, 'page: woke up');
    await until(() => logs.filter(l => /lost the connection/.test(l)).length >= 2);
    ok(/started a new connection after waking up/.test(lost()), 'a page that restarts its connection after waking up says so (4002)');
    serverConn(T.srv, 0).ws.socket.destroy();
    await until(() => /Ann lost the connection/.test(lost()));
    ok(/vanished without a goodbye/.test(lost()) && /Wi-Fi/.test(lost()), 'a connection that just disappears is described as one (Wi-Fi dropping, a locked phone, a suspended tab): "' + lost().slice(0, 120) + '"');
    T.a.close(); T.b.close(); b2.close(); await T.srv.close();
  }
  {
    const logs = []; const T = await startServer({ softGraceMs: 0, heartbeatMs: 100, log: m => logs.push(m) });
    const r = rawClient(T.port, iPhone); await wait(60);
    r.send({ t: 'create', name: 'Zoe' });
    await until(() => T.srv.rooms.size === 1);
    await until(() => /Zoe lost the connection/.test(logs.join('\n')), 3000);
    const line = logs.find(l => /Zoe lost the connection/.test(l)) || '';
    ok(/no sign of life for/.test(line) && /\[iPhone, Safari\]/.test(line), 'a connection dropped by the heartbeat says so, and which device it was: "' + line.slice(0, 40) + '...' + line.slice(-90) + '"');
    await T.srv.close();
  }
  {
    const T = await startedPair({ softGraceMs: 0, graceMs: 5000 });
    const b2 = await connect(T.port);
    b2.send({ t: 'resume', code: T.code, token: T.tokenB, d: { why: '<script>alert(1)</script>', hiddenMs: -5, silentMs: 'x', tries: 1e12, vis: { a: 1 } } });
    ok(!!(await b2.next(m => m.t === 'resumed')), 'a page can say anything in its account: it never breaks the server');
    const logs = []; T.srv.options.log = m => logs.push(m);
    T.srv.options.softGraceMs = 0;
    serverConn(T.srv, 1).ws.socket.destroy(); await wait(50);
    const b3 = await connect(T.port); b3.send({ t: 'resume', code: T.code, token: T.tokenB, d: { why: '<script>x</script> ok', hiddenMs: -5, silentMs: 'x', tries: 1e12 } });
    await b3.next(m => m.t === 'resumed');
    const back = logs.find(l => /is back in game/.test(l)) || '';
    const account = back.split('their page says:')[1] || '';
    ok(!/[<>]/.test(back) && account.length > 0 && !/-5|1e\+?12|NaN/.test(account), 'what the page says is cleaned (no markup, no negative or absurd numbers): "' + back.slice(0, 140) + '"');
    b2.close(); b3.close(); T.a.close(); T.b.close(); await T.srv.close();
  }

  console.log('5. looking at the connections: /netstats and the health line');
  {
    const T = await startedPair({ softGraceMs: 0, graceMs: 5000 });
    T.srv.heartbeat();                                                         // (a ping goes out; the browsers answer it)
    await wait(150);
    serverConn(T.srv, 1).ws.socket.destroy(); await wait(80);
    const r = await httpGet(T.port, '/netstats');
    const j = JSON.parse(r.body);
    ok(r.status === 200 && j.settings.pingEveryMs === 60000 && Array.isArray(j.connections) && Array.isArray(j.recentDrops) && 'stallsSeen' in j.thisServer, '/netstats is JSON: the settings, how busy this server has been, the connections, the recent drops');
    const ann = j.connections.find(c => c.player === 'Ann');
    ok(ann && ann.game === T.code.slice(0, 3) + '-' + T.code.slice(3) && ann.pingMs && ann.pingMs.answered >= 1 && typeof ann.lastHeardMsAgo === 'number' && ann.device, 'each connection: who, which game, device, ping times, when it was last heard');
    ok(j.recentDrops[0] && j.recentDrops[0].player === 'Ben' && /vanished/.test(j.recentDrops[0].why), 'and Ben\'s drop is listed with the reason');
    ok(!r.body.includes(T.tokenA) && !r.body.includes(T.tokenB), 'and no secret (the players\' tokens) is in it');
    T.a.close(); T.b.close(); await T.srv.close();
  }
  {
    const T = await startServer({ netStats: false });
    ok((await httpGet(T.port, '/netstats')).status === 404, '/netstats can be switched off');
    await T.srv.close();
  }
  {
    const logs = []; const T = await startedPair({ softGraceMs: 0, healthMs: 150, log: m => logs.push(m) });
    await wait(500);
    const h = logs.find(l => /connections healthy/.test(l)) || '';
    ok(/Ann/.test(h) && /Ben/.test(h) && /thread was never busy|no loop-lag/.test(h), 'while a game is on, the log gets a regular line about how the connections are doing: "' + h.slice(0, 130) + '"');
    T.a.close(); T.b.close(); await T.srv.close();
  }

  console.log('6. the command line still works');
  {
    const out = await new Promise(res => { const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--help'], { cwd: path.join(__dirname, '..') }); let o = ''; p.stdout.on('data', d => { o += d; }); p.on('close', () => res(o)); });
    ok(/Usage: node server.js/.test(out), '--help still works');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
