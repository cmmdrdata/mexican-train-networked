#!/usr/bin/env node
'use strict';
/**
 * Mexican Train game server: host a game on your own computer and let a friend join it.
 *
 *   node server.js                 listen on port 8080 on every network interface
 *   node server.js --port 3000     another port
 *   node server.js --local-only    only this computer may connect (for trying it out)
 *   node server.js --help
 *
 * No dependencies; plain Node.js (v14 or newer).
 *
 * What it does
 *  - Serves the game page (mexican-train.html) at "/", so a friend only needs a browser and your address.
 *  - Runs games: a WebSocket endpoint at "/ws" where players create a game (and get a join code) or
 *    join one with its code. The server runs the real rules (online-match.js) and sends each player
 *    only what they may see. Neither browser can look at the other's tiles.
 *  - If a player drops, the game pauses for 3 minutes so they can come back with the same code.
 *
 * How other people reach it
 *  - Same network (home Wi-Fi, office): they open  http://YOUR-IP:8080  (this program prints the addresses).
 *  - Over the internet: your router must forward the port to this computer, or use a VPN (Tailscale,
 *    ZeroTier...) or a tunnel service. The connection is plain HTTP/WebSocket, not encrypted.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { upgrade } = require('./ws-lite.js');
const { OnlineMatch, cleanName, CHAT_PHRASES } = require('./online-match.js');
const G = globalThis.MexicanTrainGame;                 // (loaded by online-match.js)

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';        // no 0/O or 1/I/L: easy to read out loud
const PROTOCOL = 1;

const randomCode = () => { const b = crypto.randomBytes(6); let s = ''; for (let i = 0; i < 6; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length]; return s; };
const showCode = c => c.slice(0, 3) + '-' + c.slice(3);
const normalizeCode = raw => String(raw === undefined || raw === null ? '' : raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

/* How good an address is for another computer on the same network to use: the ordinary home and office
 * ranges first (192.168.x.x, then 10.x.x.x, then 172.16-31.x.x), then anything else (a VPN, say), and last
 * the self-assigned 169.254.x.x addresses that mean a network is not really connected. */
function addressRank(ip) {
  const [a, b] = String(ip).split('.').map(Number);
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 2;
  if (a === 169 && b === 254) return 4;
  return 3;
}
const sortAddresses = ips => ips.map((ip, i) => ({ ip, i })).sort((x, y) => addressRank(x.ip) - addressRank(y.ip) || x.i - y.i).map(x => x.ip);

/* The addresses other computers can use to reach this server, best first, as "ip:port". A server that only
 * accepts this computer has one: 127.0.0.1. */
function lanAddresses(port, localOnly) {
  if (localOnly) return [`127.0.0.1:${port}`];
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) for (const n of nets[name] || []) if ((n.family === 'IPv4' || n.family === 4) && !n.internal) ips.push(n.address);
  return sortAddresses(ips).map(ip => `${ip}:${port}`);
}

function createGameServer(options) {
  const opt = Object.assign({
    pagePath: path.join(__dirname, 'mexican-train.html'),
    graceMs: 3 * 60 * 1000,              // how long a dropped player has to come back
    heartbeatMs: 20000,
    maxRooms: 50, maxConnections: 200,
    idleRoomMs: 10 * 60 * 1000,          // an empty room is forgotten after this long
    overRoomMs: 60 * 1000,               // a finished game is kept this long after everyone has gone (a reload still shows the result)
    localOnly: false,
    log: () => {},
    rng: null,                           // (room) => random source for the deal; tests use it to rig deals
    stepDelay: 90,
    maxMessage: 8192,
    maxWrongCodes: 8,                    // wrong join codes from one address before it must wait a minute
    ratePerSecond: 30, burst: 60,        // messages a connection may send: far more than a person can click
  }, options || {});

  const rooms = new Map();               // code -> room
  const conns = new Set();
  const failures = new Map();            // ip -> { n, until }: wrong-code guesses, to slow down guessing
  let page = null, pageMtime = 0;
  let boundPort = 0;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); if (t.unref) t.unref(); timers.add(t); return t; };
  const cancel = t => { if (t) { clearTimeout(t); timers.delete(t); } };

  /* ------------------------------ the page ------------------------------ */
  function readPage() {
    try {
      const st = fs.statSync(opt.pagePath);
      if (!page || st.mtimeMs !== pageMtime) { page = fs.readFileSync(opt.pagePath); pageMtime = st.mtimeMs; }
      return page;
    } catch (e) { return null; }
  }
  const http_ = http.createServer((req, res) => {
    const url = String(req.url || '/').split('?')[0];
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, Object.assign({ Allow: 'GET, HEAD' }, headers)); return res.end(); }
    if (url === '/' || url === '/index.html') {
      const body = readPage();
      if (!body) { res.writeHead(500, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers)); return res.end('The game page (' + path.basename(opt.pagePath) + ') was not found next to the server.'); }
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length }, headers));
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (url === '/info') {                                    // the address(es) the host's page should show: this computer's network address, never "localhost"
      const list = lanAddresses(boundPort, opt.localOnly);
      const body = JSON.stringify({ game: 'mexican-train', addresses: list, preferred: list[0] || `127.0.0.1:${boundPort}` });
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, headers));
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (url === '/healthz') { res.writeHead(200, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers)); return res.end('ok'); }
    res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers));
    res.end('Not found');
  });

  /* ------------------------------ connections ------------------------------ */
  http_.on('upgrade', (req, socket) => {
    const url = String(req.url || '').split('?')[0];
    if (url !== '/ws') { try { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); socket.destroy(); } catch (e) { /* ignore */ } return; }
    if (conns.size >= opt.maxConnections) { try { socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); socket.destroy(); } catch (e) { /* ignore */ } return; }
    const ws = upgrade(req, socket, { maxPayload: opt.maxMessage });
    if (!ws) return;
    const c = { ws, ip: (req.socket && req.socket.remoteAddress) || '?', session: null, bucket: opt.burst, bucketAt: Date.now(), bad: 0, slowAt: 0 };
    conns.add(c);
    send(c, { t: 'hello', game: 'mexican-train', v: PROTOCOL });
    ws.on('message', text => onMessage(c, text));
    ws.on('close', () => onClose(c));
    ws.on('protocol-error', () => { /* the connection is being closed */ });
  });

  function send(c, msg) { if (c && c.ws && c.ws.open) c.ws.send(JSON.stringify(msg)); }
  const reply = (c, code, message) => send(c, { t: 'error', code, message });

  function onMessage(c, text) {
    // a token bucket: `ratePerSecond` messages a second on average, bursts of `burst`
    const now = Date.now();
    c.bucket = Math.min(opt.burst, c.bucket + (now - c.bucketAt) * opt.ratePerSecond / 1000); c.bucketAt = now;
    if (c.bucket < 1) {                                      // too fast: say so (once a second), never just ignore it
      if (now - (c.slowAt || 0) > 1000) { c.slowAt = now; reply(c, 'slow_down', 'You are sending too fast. Wait a moment and try again.'); }
      if (++c.bad > 100) c.ws.close(1008, 'too many messages');
      return;
    }
    c.bucket -= 1;
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return strike(c, 'bad_json', 'That was not valid JSON.'); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return strike(c, 'bad_message', 'That was not understood.');
    switch (msg.t) {
      case 'ping': return send(c, { t: 'pong', n: typeof msg.n === 'number' ? msg.n : 0 });
      case 'create': return onCreate(c, msg);
      case 'join': return onJoin(c, msg);
      case 'resume': return onResume(c, msg);
      case 'settings': return onSettings(c, msg);
      case 'start': return onStart(c);
      case 'i': return onIntent(c, msg);
      case 'chat': return onChat(c, msg);
      case 'leave': return onLeave(c);
      default: return strike(c, 'unknown_type', 'Unknown message type.');
    }
  }
  function strike(c, code, message) { reply(c, code, message); if (++c.bad > 20) c.ws.close(1008, 'too many bad messages'); }

  /* ------------------------------ rooms ------------------------------ */
  function newRoom(c, name, settings) {
    let code; do { code = randomCode(); } while (rooms.has(code));
    const room = {
      code, settings: { rounds: [1, 4, 13].includes(Number(settings.rounds)) ? Number(settings.rounds) : 4, hand: [8, 12, 15].includes(Number(settings.hand)) ? Number(settings.hand) : 15, computer: cleanComputer(settings.computer) },
      computerName: null,
      players: [{ name, token: crypto.randomBytes(16).toString('hex'), conn: null, lostAt: null, timer: null }, null],
      state: 'lobby', match: null, chatAt: [0, 0], lastActivity: Date.now(), over: null,
    };
    rooms.set(code, room);
    return room;
  }
  const seatOf = c => (c.session ? c.session.seat : -1);
  const connectedSeats = room => room.players.map(p => !!(p && p.conn && p.conn.ws.open));

  function sendSeat(room, seat, msg) { const p = room.players[seat]; if (p && p.conn) send(p.conn, msg); }
  function lobbyMessage(room, seat) {
    return {
      t: 'lobby', code: room.code, display: showCode(room.code), seat, settings: room.settings,
      players: room.players.map(p => (p ? { name: p.name, connected: !!(p.conn && p.conn.ws.open) } : null))
        .concat(room.settings.computer ? [{ name: room.computerName, connected: true, computer: true, level: room.settings.computer }] : []),
      canStart: !!(room.state === 'lobby' && room.players[0] && room.players[1] && connectedSeats(room).every(Boolean)),
      addresses: lanAddresses(boundPort, opt.localOnly), state: room.state,
    };
  }
  function sendLobby(room) { for (const seat of [0, 1]) sendSeat(room, seat, lobbyMessage(room, seat)); }
  function presence(room) {
    for (const seat of [0, 1]) {
      const other = room.players[1 - seat];
      sendSeat(room, seat, { t: 'presence', oppConnected: !!(other && other.conn && other.conn.ws.open), graceUntil: other && other.lostAt ? other.lostAt + opt.graceMs : null });
    }
  }
  function attach(room, seat, c) {
    const p = room.players[seat];
    if (p.conn && p.conn !== c) { p.conn.session = null; try { p.conn.ws.close(4000, 'replaced by a newer connection'); } catch (e) { /* ignore */ } }
    p.conn = c; p.lostAt = null; cancel(p.timer); p.timer = null;
    c.session = { room, seat };
    room.lastActivity = Date.now();
  }
  function endRoom(room, reason, message) {
    if (room.state === 'over' && room.over) return;
    room.state = 'over'; room.over = reason;
    if (room.match) room.match.abort();
    for (const seat of [0, 1]) { const p = room.players[seat]; if (p) { cancel(p.timer); p.timer = null; } }
    for (const seat of [0, 1]) sendSeat(room, seat, { t: 'ended', reason, message });
    opt.log(`game ${showCode(room.code)} ended: ${reason}`);
  }
  function dropRoom(room) {
    endRoom(room, room.over || 'closed', 'This game was closed.');
    for (const p of room.players) if (p) { cancel(p.timer); if (p.conn) p.conn.session = null; }
    rooms.delete(room.code);
  }

  /* ------------------------------ messages ------------------------------ */
  const cleanSettings = msg => ({ rounds: msg.rounds, hand: msg.hand, computer: msg.computer });
  const cleanComputer = v => (G.Engine.LEVELS.includes(v) ? v : null);       // 'easy', 'normal' or 'hard'; anything else means no computer player
  /* A name for the computer player, from the computer players of its level, not one a person at the table has. */
  function nameComputer(room) {
    if (!room.settings.computer) { room.computerName = null; return; }
    const taken = new Set(room.players.filter(Boolean).map(p => p.name.toLowerCase()));
    if (room.computerName && !taken.has(room.computerName.toLowerCase()) && G.levelOfName(room.computerName) === room.settings.computer) return;   // keep its name while the level is unchanged
    room.computerName = G.pickCpuName(room.settings.computer, opt.nameRng || Math.random, taken);
  }

  function onCreate(c, msg) {
    if (c.session) return reply(c, 'already_in_game', 'You are already in a game.');
    if (rooms.size >= opt.maxRooms) return reply(c, 'server_full', 'This server is hosting as many games as it can. Try again later.');
    const room = newRoom(c, cleanName(msg.name, 'Host'), cleanSettings(msg));
    nameComputer(room);
    attach(room, 0, c);
    opt.log(`game ${showCode(room.code)} created by ${room.players[0].name}`);
    send(c, { t: 'created', code: room.code, display: showCode(room.code), token: room.players[0].token, seat: 0, settings: room.settings, addresses: lanAddresses(boundPort, opt.localOnly) });
    sendLobby(room);
  }
  function guessBlocked(c) { const f = failures.get(c.ip); return f && f.n >= opt.maxWrongCodes && Date.now() < f.until; }
  function onJoin(c, msg) {
    if (c.session) return reply(c, 'already_in_game', 'You are already in a game.');
    if (guessBlocked(c)) return reply(c, 'too_many_tries', 'Too many wrong codes. Wait a minute and try again.');
    const code = normalizeCode(msg.code);
    const room = rooms.get(code);
    if (!room || room.state === 'over') {
      const f = failures.get(c.ip) || { n: 0, until: 0 }; f.n++; f.until = Date.now() + 60000; failures.set(c.ip, f);
      return reply(c, 'no_such_game', 'There is no game with that code. Check the code and the address.');
    }
    if (room.state !== 'lobby' || room.players[1]) return reply(c, 'game_full', 'That game already has two players.');
    failures.delete(c.ip);
    room.players[1] = { name: cleanName(msg.name, 'Guest'), token: crypto.randomBytes(16).toString('hex'), conn: null, lostAt: null, timer: null };
    const sameName = n => n === room.players[0].name || (room.computerName && n.toLowerCase() === room.computerName.toLowerCase());
    if (sameName(room.players[1].name)) room.players[1].name = cleanName(room.players[1].name.slice(0, 17) + ' 2');   // keep it within 20 characters
    attach(room, 1, c);
    opt.log(`${room.players[1].name} joined game ${showCode(room.code)}`);
    send(c, { t: 'joined', code: room.code, display: showCode(room.code), token: room.players[1].token, seat: 1, settings: room.settings, addresses: lanAddresses(boundPort, opt.localOnly) });
    sendLobby(room);
  }
  function onResume(c, msg) {
    if (c.session) return reply(c, 'already_in_game', 'You are already in a game.');
    const room = rooms.get(normalizeCode(msg.code));
    const seat = room ? room.players.findIndex(p => p && typeof msg.token === 'string' && p.token.length === msg.token.length && crypto.timingSafeEqual(Buffer.from(p.token), Buffer.from(msg.token))) : -1;
    if (!room || seat < 0) return reply(c, 'no_such_game', 'That game is no longer there.');
    if (room.state === 'over') { send(c, { t: 'ended', reason: room.over || 'closed', message: 'That game is over.' }); return; }
    attach(room, seat, c);
    send(c, { t: 'resumed', code: room.code, display: showCode(room.code), seat, settings: room.settings, state: room.state, addresses: lanAddresses(boundPort, opt.localOnly) });
    if (room.state === 'playing' && room.match) {
      send(c, { t: 'state', seq: room.match.seq, view: room.match.viewFor(seat), events: [] });
      if (connectedSeats(room).every(Boolean)) room.match.setPaused(false);
    } else sendLobby(room);
    presence(room);
    opt.log(`${room.players[seat].name} is back in game ${showCode(room.code)}`);
  }
  function onSettings(c, msg) {
    const room = c.session && c.session.room;
    if (!room || c.session.seat !== 0 || room.state !== 'lobby') return reply(c, 'not_allowed', 'Only the host can change the settings before the game starts.');
    const s = cleanSettings(msg);
    if (s.rounds !== undefined && [1, 4, 13].includes(Number(s.rounds))) room.settings.rounds = Number(s.rounds);
    if (s.hand !== undefined && [8, 12, 15].includes(Number(s.hand))) room.settings.hand = Number(s.hand);
    if (Object.prototype.hasOwnProperty.call(msg, 'computer')) {            // a level sets it; an explicit "none" removes it; anything else is ignored
      const v = msg.computer;
      if (v === null || v === false || v === 'none' || v === '') { room.settings.computer = null; nameComputer(room); }
      else if (cleanComputer(v)) { room.settings.computer = v; nameComputer(room); }
    }
    sendLobby(room);
  }
  function onStart(c) {
    const room = c.session && c.session.room;
    if (!room || c.session.seat !== 0) return reply(c, 'not_allowed', 'Only the host can start the game.');
    if (room.state !== 'lobby') return reply(c, 'not_allowed', 'The game has already started.');
    if (!room.players[1] || !connectedSeats(room).every(Boolean)) return reply(c, 'not_ready', 'Wait for the other player to join.');
    room.state = 'playing';
    nameComputer(room);
    room.match = new OnlineMatch({
      rounds: room.settings.rounds, hand: room.settings.hand,
      names: room.settings.computer ? [room.players[0].name, room.players[1].name, room.computerName] : [room.players[0].name, room.players[1].name],
      computer: room.settings.computer ? { level: room.settings.computer } : undefined,
      rng: opt.rng ? opt.rng(room) : undefined, stepDelay: opt.stepDelay, sleep: opt.sleep,
      push: (seat, msg) => sendSeat(room, seat, msg),
    });
    opt.log(`game ${showCode(room.code)} started: ${room.players[0].name} vs ${room.players[1].name}${room.settings.computer ? ' vs ' + room.computerName + ' (computer, ' + room.settings.computer + ')' : ''}`);
    sendLobby(room);
    room.match.start().then(() => {
      room.lastActivity = Date.now();
      if (room.match.over === 'error') { opt.log(`game ${showCode(room.code)} hit an error: ${room.match.error && room.match.error.message}`); endRoom(room, 'error', 'Something went wrong in the game, so it had to end.'); }
      else if (room.match.over === 'finished') { room.state = 'over'; room.over = 'finished'; opt.log(`game ${showCode(room.code)} finished`); }
    });
  }
  function onIntent(c, msg) {
    const room = c.session && c.session.room;
    if (!room || room.state !== 'playing' || !room.match) return reply(c, 'not_now', 'There is no game in progress.');
    room.lastActivity = Date.now();
    const intent = { a: msg.a, tile: msg.tile, train: msg.train };
    const seqBefore = room.match.seq;                       // every state sent up to here is "old" for the sender once they get the ack
    const r = room.match.intent(c.session.seat, intent);
    if (!r.ok) reply(c, r.code, r.message);
    if (typeof msg.id === 'number') send(c, { t: 'ack', id: msg.id, ok: r.ok, seq: seqBefore });
  }
  function onChat(c, msg) {
    const room = c.session && c.session.room;
    if (!room) return reply(c, 'not_in_game', 'Join a game first.');
    const seat = c.session.seat, now = Date.now();
    if (!Number.isInteger(msg.id) || msg.id < 0 || msg.id >= CHAT_PHRASES.length) return reply(c, 'bad_message', 'Unknown phrase.');
    if (now - room.chatAt[seat] < 1500) return reply(c, 'slow_down', 'Not so fast.');
    room.chatAt[seat] = now;
    sendSeat(room, 1 - seat, { t: 'chat', id: msg.id, text: CHAT_PHRASES[msg.id] });
  }
  function onLeave(c) {
    const room = c.session && c.session.room, seat = seatOf(c);
    if (!room) return;
    c.session = null;
    const p = room.players[seat];
    if (p) { p.conn = null; cancel(p.timer); }
    if (room.state === 'lobby') {
      if (seat === 0) { endRoom(room, 'left', `${p ? p.name : 'The host'} closed the game.`); rooms.delete(room.code); }
      else { room.players[1] = null; sendLobby(room); }
    } else if (room.state === 'playing') {
      endRoom(room, 'left', `${p ? p.name : 'The other player'} left the game.`);
    }
    if (room.players.every(x => !x || !x.conn)) rooms.delete(room.code);
  }

  /* ------------------------------ dropped connections ------------------------------ */
  function onClose(c) {
    conns.delete(c);
    const s = c.session;
    if (!s) return;
    const { room, seat } = s;
    const p = room.players[seat];
    if (!p || p.conn !== c) return;                          // already replaced by a newer connection
    p.conn = null; p.lostAt = Date.now();
    room.lastActivity = Date.now();
    if (room.state === 'over') { if (room.players.every(x => !x || !x.conn)) later(() => { if (rooms.get(room.code) === room && room.players.every(x => !x || !x.conn)) rooms.delete(room.code); }, opt.overRoomMs); return; }
    if (room.state === 'lobby' && seat === 1) { room.players[1] = null; sendLobby(room); return; }     // a guest who drops from the lobby just frees the seat
    opt.log(`${p.name} lost the connection to game ${showCode(room.code)}`);
    if (room.state === 'playing' && room.match) room.match.setPaused(true);
    presence(room);
    cancel(p.timer);
    p.timer = later(() => {                                  // they did not come back in time
      p.timer = null;
      if (p.conn || room.state === 'over') return;
      endRoom(room, 'timeout', `${p.name} did not come back in time, so the game is over.`);
    }, opt.graceMs);
  }

  /* ------------------------------ upkeep ------------------------------ */
  const beat = setInterval(() => {
    for (const c of Array.from(conns)) {
      if (!c.ws.alive) { c.ws.terminate(); continue; }       // no answer to the last ping: the connection is dead
      c.ws.alive = false; c.ws.ping();
    }
    const now = Date.now();
    for (const room of Array.from(rooms.values())) {
      const empty = room.players.every(x => !x || !x.conn);
      if (empty && now - room.lastActivity > opt.idleRoomMs && !(room.state === 'playing' && room.players.some(p => p && p.timer))) { dropRoom(room); }
    }
    for (const [ip, f] of failures) if (now > f.until) failures.delete(ip);
  }, opt.heartbeatMs);
  if (beat.unref) beat.unref();

  /* ------------------------------ starting and stopping ------------------------------ */
  function listen(port, host) {
    return new Promise((resolve, reject) => {
      http_.once('error', reject);
      if (host === '127.0.0.1' || host === 'localhost' || host === '::1') opt.localOnly = true;    // only this computer can reach it, so that is its address
      http_.listen(port, host || (opt.localOnly ? '127.0.0.1' : '0.0.0.0'), () => {
        http_.removeListener('error', reject);
        boundPort = http_.address().port;
        resolve(boundPort);
      });
    });
  }
  function close() {
    clearInterval(beat);
    for (const t of Array.from(timers)) cancel(t);
    for (const room of Array.from(rooms.values())) { if (room.match) room.match.abort(); }
    rooms.clear();
    for (const c of Array.from(conns)) c.ws.terminate();
    return new Promise(res => http_.close(() => res()));
  }
  return { listen, close, rooms, conns, http: http_, get port() { return boundPort; }, options: opt };
}

/* ------------------------------ command line ------------------------------ */
function main(argv) {
  const args = { port: Number(process.env.PORT) || 8080, localOnly: false, page: null, grace: 180, help: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--port' || a === '-p') args.port = Number(argv[++i]);
    else if (a === '--local-only') args.localOnly = true;
    else if (a === '--page') args.page = argv[++i];
    else if (a === '--grace') args.grace = Number(argv[++i]);
    else if (a === '--quiet') args.quiet = true;
    else { console.error(`Unknown option: ${a}`); args.help = true; args.bad = true; }
  }
  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) { console.error('--port must be a number from 0 to 65535'); args.help = args.bad = true; }
  if (!(args.grace >= 5)) { console.error('--grace must be a number of seconds (at least 5)'); args.help = args.bad = true; }
  if (args.help) {
    console.log(`Mexican Train server

Usage: node server.js [options]

  -p, --port N     port to listen on (default 8080)
  --local-only     accept connections only from this computer (default: from the whole network)
  --page FILE      the game page to serve (default: mexican-train.html next to this file)
  --grace SECONDS  how long a dropped player has to come back (default 180)
  --quiet          do not print what happens in games
  -h, --help       this help

Listening on the whole network means other computers can connect to YOUR-IP:PORT.
Your firewall may ask whether to allow Node.js: say yes for private networks.`);
    process.exit(args.bad ? 1 : 0);
  }
  const server = createGameServer({
    localOnly: args.localOnly, graceMs: Math.round(args.grace * 1000),
    pagePath: args.page ? path.resolve(args.page) : path.join(__dirname, 'mexican-train.html'),
    log: args.quiet ? () => {} : msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`),
  });
  server.listen(args.port).then(port => {
    const addrs = lanAddresses(port, args.localOnly);
    console.log('\nMexican Train server is running.\n');
    if (args.localOnly) {
      console.log(`  Open  http://127.0.0.1:${port}  in a browser on this computer.`);
      console.log('  (local-only mode: only this computer can connect)');
    } else if (addrs.length) {
      console.log(`  Open  http://${addrs[0]}  in your browser to host a game.`);
      console.log('  The other player opens the same address to join.');
      if (addrs.length > 1) { console.log('\n  This computer has other network addresses too:'); addrs.slice(1).forEach(a => console.log(`      http://${a}`)); }
    } else {
      console.log(`  Open  http://127.0.0.1:${port}  in a browser on this computer.`);
      console.log('  (no network address was found: connect this computer to a network for others to join)');
    }
    console.log('\nPress "Host online game", and give the other player the address and the join code.');
    console.log('Press Ctrl+C to stop the server.\n');
    if (!fs.existsSync(server.options.pagePath)) console.log(`  Warning: ${server.options.pagePath} was not found, so the page cannot be served.\n`);
  }).catch(err => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${args.port} is already in use. Pick another with --port, or stop the other program.`);
    else if (err.code === 'EACCES') console.error(`Not allowed to use port ${args.port}. Try a number above 1024.`);
    else console.error(err.message);
    process.exit(1);
  });
  const stop = () => { console.log('\nStopping...'); server.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { createGameServer, lanAddresses, addressRank, sortAddresses, normalizeCode, showCode, CODE_ALPHABET };
