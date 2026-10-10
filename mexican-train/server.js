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
let monitorEventLoopDelay = null; try { monitorEventLoopDelay = require('perf_hooks').monitorEventLoopDelay; } catch (e) { /* older Node: no loop-lag figures */ }
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
    heartbeatMs: 5000,                   // how often every connection is pinged (a browser answers pings by itself, without the page)
    deadAfterMs: undefined,              // how long a connection may be completely silent (no message, no ping reply) before it is dropped: 30 s, or twice heartbeatMs if that is set
    softGraceMs: 8000,                   // a player who drops is not announced, and the game is not paused, until they have been gone this long (most blips mend themselves)
    healthMs: 60000,                     // while games are running, a line about the connections' health is logged this often
    netStats: true,                      // GET /netstats shows who is connected, ping times and the recent drops
    chatRng: null, timer: null, now: null, nativeChance: undefined, foodChance: undefined,    // (tests: the computer's talk uses these random numbers, clock and timers)
    maxRooms: 50, maxConnections: 200,
    idleRoomMs: 10 * 60 * 1000,          // an empty room is forgotten after this long
    overRoomMs: 60 * 1000,               // a finished game is kept this long after everyone has gone (a reload still shows the result)
    localOnly: false,
    log: () => {},
    rng: null,                           // (room) => random source for the deal; tests use it to rig deals
    stepDelay: [500, 3000],              // the pause between the tiles of "Build my longest train": random, between these (milliseconds)
    maxMessage: 8192,
    maxWrongCodes: 8,                    // wrong join codes from one address before it must wait a minute
    ratePerSecond: 30, burst: 60,        // messages a connection may send: far more than a person can click
  }, options || {});
  if (opt.deadAfterMs === undefined) opt.deadAfterMs = options && options.heartbeatMs !== undefined ? 2 * opt.heartbeatMs : 30000;

  const rooms = new Map();               // code -> room
  const conns = new Set();
  let shuttingDown = false;
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
    if (url === '/netstats' && opt.netStats) {                // who is connected and how healthy the connections are (no secrets in it)
      const body = JSON.stringify(netStats(), null, 2);
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
    const c = { ws, ip: (req.socket && req.socket.remoteAddress) || '?', session: null, bucket: opt.burst, bucketAt: Date.now(), bad: 0, slowAt: 0, since: Date.now(), ua: String((req.headers && req.headers['user-agent']) || '').slice(0, 160), dropWhy: null };
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
      code, settings: { rounds: [1, 4, 13].includes(Number(settings.rounds)) ? Number(settings.rounds) : 4, hand: [8, 12, 15].includes(Number(settings.hand)) ? Number(settings.hand) : 15, computer: cleanComputer(settings.computer), theme: cleanTheme(settings.theme), allowHints: !(settings.allowHints === false || settings.allowHints === 'false') },
      computerName: null,
      players: [{ name, token: crypto.randomBytes(16).toString('hex'), conn: null, lostAt: null, timer: null }, null],
      state: 'lobby', match: null, chatAt: [0, 0], chatLog: [[], []], lastActivity: Date.now(), over: null,
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
  /* ------------------------------ what happened to a connection ------------------------------ */
  const deviceOf = ua => {
    ua = String(ua || '');
    const os_ = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'unknown device';
    const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /(Chrome|CriOS)\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return br ? `${os_}, ${br}` : os_;
  };
  const span = ms => ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : ms < 120000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`;
  const rttText = ws => ws.rtt.n ? `ping round trip: last ${ws.rtt.last} ms, average ${Math.round(ws.rtt.sum / ws.rtt.n)} ms, worst ${ws.rtt.max} ms` : 'no ping answered yet';
  const lag = monitorEventLoopDelay ? monitorEventLoopDelay({ resolution: 20 }) : null; if (lag) lag.enable();
  const lagText = () => (lag && lag.count ? `this server's thread was never busy for more than ${(lag.max / 1e6).toFixed(0)} ms (99% under ${(lag.percentile(99) / 1e6).toFixed(0)} ms)` : 'no loop-lag figures');
  const recentDrops = []; let stalls = 0, lastTick = Date.now();
  // How a connection ended, in words. The page closes with its own codes when it ends a connection itself, so we can tell.
  function whyEnded(c) {
    if (c.dropWhy) return c.dropWhy;
    const i = c.ws.closeInfo || { by: 'network' };
    if (i.by === 'client') {
      if (i.code === 4001) return `the page gave up waiting for this server ("${i.reason}")`;
      if (i.code === 4002) return `the page started a new connection after waking up ("${i.reason}")`;
      if (i.code === 1001) return 'the page was closed or left (a closed tab, a reload, or navigating away)';
      return `the page closed it (code ${i.code}${i.reason ? ': ' + i.reason : ''})`;
    }
    if (i.by === 'server') return i.code === 4000 ? 'replaced by a newer connection from the same player' : `this server closed it${i.reason ? ' (' + i.reason + ')' : ''}`;
    return 'it vanished without a goodbye: Wi-Fi dropping, a phone locking, a tab being suspended or killed, or a cable pulled';
  }
  function cleanDiag(d) {                                   // what the page says about why it reconnected: numbers and short words only
    if (!d || typeof d !== 'object') return '';
    const n = x => (typeof x === 'number' && isFinite(x) && x >= 0 && x < 1e9 ? Math.round(x) : null);
    const w = x => (typeof x === 'string' ? x.replace(/[^A-Za-z0-9 .,:;()'\-]/g, '').slice(0, 60) : '');
    const out = [];
    if (w(d.why)) out.push(`ended because ${w(d.why)}`);
    if (n(d.hiddenMs) !== null && n(d.hiddenMs) > 0) out.push(`it was in the background for ${span(n(d.hiddenMs))}`);
    if (n(d.silentMs) !== null) out.push(`it had heard nothing for ${span(n(d.silentMs))}`);
    if (n(d.tries) !== null && n(d.tries) > 1) out.push(`${n(d.tries)} attempts to reconnect`);
    if (w(d.vis)) out.push(`the page was ${w(d.vis)}`);
    return out.join('; ');
  }
  function netStats() {
    const now = Date.now();
    return {
      at: new Date(now).toISOString(), uptimeSeconds: Math.round(process.uptime()),
      settings: { pingEveryMs: opt.heartbeatMs, droppedAfterSilentMs: opt.deadAfterMs, pauseAfterGoneMs: opt.softGraceMs, comebackWithinMs: opt.graceMs },
      thisServer: { busiestMomentMs: lag && lag.count ? Math.round(lag.max / 1e6) : null, p99Ms: lag && lag.count ? Math.round(lag.percentile(99) / 1e6) : null, stallsSeen: stalls },
      connections: Array.from(conns).map(c => ({ player: c.session ? (c.session.room.players[c.session.seat] || {}).name || null : null, game: c.session ? showCode(c.session.room.code) : null,
        from: c.ip, device: deviceOf(c.ua), connectedForSeconds: Math.round((now - c.since) / 1000), lastHeardMsAgo: now - c.ws.lastSeen,
        pingMs: c.ws.rtt.n ? { last: c.ws.rtt.last, average: Math.round(c.ws.rtt.sum / c.ws.rtt.n), worst: c.ws.rtt.max, answered: c.ws.rtt.n } : null })),
      recentDrops,
    };
  }
  function presence(room) {
    for (const seat of [0, 1]) {
      const other = room.players[1 - seat];
      // a player in the first few seconds after a drop still counts as there: most blips mend themselves, and nobody needs to hear about those
      sendSeat(room, seat, { t: 'presence', oppConnected: !!(other && ((other.conn && other.conn.ws.open) || other.soft)), graceUntil: other && other.lostAt && !other.soft ? other.lostAt + opt.graceMs : null });
    }
  }
  function attach(room, seat, c) {
    const p = room.players[seat];
    if (p.conn && p.conn !== c) { p.conn.session = null; try { p.conn.ws.close(4000, 'replaced by a newer connection'); } catch (e) { /* ignore */ } }
    p.conn = c; p.lostAt = null; cancel(p.timer); p.timer = null; cancel(p.soft); p.soft = null;
    c.session = { room, seat };
    room.lastActivity = Date.now();
  }
  function endRoom(room, reason, message) {
    if (room.state === 'over' && room.over) return;
    room.state = 'over'; room.over = reason;
    if (room.match) room.match.abort();
    for (const seat of [0, 1]) { const p = room.players[seat]; if (p) { cancel(p.timer); p.timer = null; cancel(p.soft); p.soft = null; } }
    for (const seat of [0, 1]) sendSeat(room, seat, { t: 'ended', reason, message });
    opt.log(`game ${showCode(room.code)} ended: ${reason}`);
  }
  function dropRoom(room) {
    endRoom(room, room.over || 'closed', 'This game was closed.');
    for (const p of room.players) if (p) { cancel(p.timer); cancel(p.soft); if (p.conn) p.conn.session = null; }
    rooms.delete(room.code);
  }

  /* ------------------------------ messages ------------------------------ */
  const cleanSettings = msg => ({ rounds: msg.rounds, hand: msg.hand, computer: msg.computer, theme: msg.theme, allowHints: msg.allowHints });
  const cleanComputer = v => (G.Engine.LEVELS.includes(v) ? v : null);       // 'easy', 'normal' or 'hard'; anything else means no computer player
  const cleanTheme = v => (G.THEME_IDS.includes(v) ? v : 'classic');            // who the computer player is, and the ring or toy train markers
  /* A name for the computer player, from the computer players of its level (and theme), not one a person at the table has. */
  function nameComputer(room) {
    if (!room.settings.computer) { room.computerName = null; return; }
    const taken = new Set(room.players.filter(Boolean).map(p => p.name.toLowerCase()));
    if (room.computerName && !taken.has(room.computerName.toLowerCase()) && G.levelOfName(room.computerName, room.settings.theme) === room.settings.computer) return;   // keep its name while the level and theme are unchanged
    room.computerName = G.pickCpuName(room.settings.computer, opt.nameRng || Math.random, taken, room.settings.theme);
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
    const wasGone = room.players[seat].lostAt, diag = cleanDiag(msg.d);
    attach(room, seat, c);
    send(c, { t: 'resumed', code: room.code, display: showCode(room.code), seat, settings: room.settings, state: room.state, addresses: lanAddresses(boundPort, opt.localOnly) });
    if (room.state === 'playing' && room.match) {
      send(c, { t: 'state', seq: room.match.seq, view: room.match.viewFor(seat), events: [] });
      if (connectedSeats(room).every(Boolean)) room.match.setPaused(false);
    } else sendLobby(room);
    presence(room);
    opt.log(`${room.players[seat].name} is back in game ${showCode(room.code)}${wasGone ? ' after ' + span(Date.now() - wasGone) : ''}${diag ? '; their page says: ' + diag : ''} [${deviceOf(c.ua)}]`);
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
    if (s.theme !== undefined && G.THEME_IDS.includes(s.theme)) { room.settings.theme = s.theme; nameComputer(room); }   // an unknown theme is ignored
    if (typeof s.allowHints === 'boolean') room.settings.allowHints = s.allowHints;                                       // the host's choice about hints, for everyone at the table
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
      rounds: room.settings.rounds, hand: room.settings.hand, allowHints: room.settings.allowHints !== false,
      names: room.settings.computer ? [room.players[0].name, room.players[1].name, room.computerName] : [room.players[0].name, room.players[1].name],
      computer: room.settings.computer ? { level: room.settings.computer } : undefined, theme: room.settings.theme,
      rng: opt.rng ? opt.rng(room) : undefined, stepDelay: opt.stepDelay, sleep: opt.sleep,
      chatRng: opt.chatRng || undefined, timer: opt.timer || undefined, now: opt.now || undefined, nativeChance: opt.nativeChance, foodChance: opt.foodChance,
      push: (seat, msg) => sendSeat(room, seat, msg),
    });
    opt.log(`game ${showCode(room.code)} started: ${room.players[0].name} vs ${room.players[1].name}${room.settings.computer ? ' vs ' + room.computerName + ' (computer, ' + room.settings.computer + ')' : ''}${room.settings.theme !== 'classic' ? ' [' + room.settings.theme + ']' : ''}`);
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
    // a quick phrase (by number) or something typed (as text, which is cleaned here whatever the page did: plain text, one line, 80 characters)
    let text, id = null;
    if (Number.isInteger(msg.id) && msg.id >= 0 && msg.id < CHAT_PHRASES.length) { id = msg.id; text = CHAT_PHRASES[id]; }     // (a phrase number wins: text sent along with it is ignored)
    else if (typeof msg.text === 'string') { text = G.cleanChatText(msg.text); if (!text) return reply(c, 'bad_message', 'There was nothing to send.'); }
    else return reply(c, 'bad_message', 'Unknown phrase.');
    if (now - room.chatAt[seat] < 1500) return reply(c, 'slow_down', 'Not so fast: that message was not sent.');
    const recent = (room.chatLog[seat] || []).filter(t => now - t < 60000);
    if (recent.length >= 10) { room.chatLog[seat] = recent; return reply(c, 'slow_down', 'That is a lot of messages. Wait a little: that one was not sent.'); }
    room.chatAt[seat] = now; recent.push(now); room.chatLog[seat] = recent;
    sendSeat(room, 1 - seat, Object.assign({ t: 'chat', text }, id !== null ? { id } : {}));
  }
  // Someone who has pressed "See the final score" has seen everything there is to see. If they leave (or close the page) before the
  // other person has pressed it, the game is not abandoned: the other person still gets their final score.
  const sawEverything = (room, seat) => !!(room.state === 'playing' && room.match && !room.match.over && room.match.modal
    && room.match.modal.type === 'roundEnd' && room.match.modal.last && room.match.modalOk[seat]);
  function onLeave(c) {
    const room = c.session && c.session.room, seat = seatOf(c);
    if (!room) return;
    c.session = null;
    const p = room.players[seat];
    if (p) { p.conn = null; cancel(p.timer); cancel(p.soft); p.soft = null; }
    if (room.state === 'lobby') {
      if (seat === 0) { endRoom(room, 'left', `${p ? p.name : 'The host'} closed the game.`); rooms.delete(room.code); }
      else { room.players[1] = null; sendLobby(room); }
    } else if (room.state === 'playing') {
      if (sawEverything(room, seat)) { opt.log(`${p ? p.name : 'A player'} left game ${showCode(room.code)} after seeing the final score; the other player has not yet`); room.match.seatLeft(seat); }
      else endRoom(room, 'left', `${p ? p.name : 'The other player'} left the game.`);
    }
    if (room.players.every(x => !x || !x.conn)) rooms.delete(room.code);
  }

  /* ------------------------------ dropped connections ------------------------------ */
  function onClose(c) {
    conns.delete(c);
    if (shuttingDown) return;                                // the server is closing: nobody is waiting for anyone any more
    const s = c.session;
    const why = whyEnded(c), heard = Date.now() - c.ws.lastSeen;
    recentDrops.unshift({ at: new Date().toISOString(), player: s ? (s.room.players[s.seat] || {}).name || null : null, why, connectedForSeconds: Math.round((Date.now() - c.since) / 1000), lastHeardMsBefore: heard, device: deviceOf(c.ua) });
    if (recentDrops.length > 30) recentDrops.pop();
    if (!s) return;
    const { room, seat } = s;
    const p = room.players[seat];
    if (!p || p.conn !== c) return;                          // already replaced by a newer connection
    p.conn = null; p.lostAt = Date.now();
    room.lastActivity = Date.now();
    if (room.state === 'over') { if (room.players.every(x => !x || !x.conn)) later(() => { if (rooms.get(room.code) === room && room.players.every(x => !x || !x.conn)) rooms.delete(room.code); }, opt.overRoomMs); return; }
    if (room.state === 'lobby' && seat === 1) { room.players[1] = null; sendLobby(room); return; }     // a guest who drops from the lobby just frees the seat
    if (sawEverything(room, seat)) { opt.log(`${p.name} closed the page of game ${showCode(room.code)} after seeing the final score; the other player has not yet: no pause, no waiting for them`); room.match.seatLeft(seat); return; }
    opt.log(`${p.name} lost the connection to game ${showCode(room.code)}: ${why}. (${span(Date.now() - c.since)} connected; heard from them ${span(heard)} before it ended; ${rttText(c.ws)}; ${lagText()}) [${deviceOf(c.ua)}]`);
    cancel(p.timer); cancel(p.soft);
    const announce = () => {                                 // they have been gone long enough that it is worth telling the other player, and pausing
      p.soft = null;
      if (p.conn || room.state === 'over') return;
      if (room.state === 'playing' && room.match) room.match.setPaused(true);
      presence(room);
      if (opt.softGraceMs > 0) opt.log(`${p.name} is still gone after ${span(opt.softGraceMs)}: game ${showCode(room.code)} is paused until they come back (up to ${span(opt.graceMs)})`);
    };
    if (room.state === 'playing' && room.match && opt.softGraceMs > 0) p.soft = later(announce, opt.softGraceMs);
    else announce();
    p.timer = later(() => {                                  // they did not come back in time
      p.timer = null;
      if (p.conn || room.state === 'over') return;
      endRoom(room, 'timeout', `${p.name} did not come back in time, so the game is over.`);
    }, opt.graceMs);
  }

  /* ------------------------------ upkeep ------------------------------ */
  /* A connection is dropped when NOTHING has arrived from it (no message, no ping reply) for `deadAfterMs`, not when one ping goes
   * unanswered. And if THIS process was not running for a while (stalled, or the computer slept) nobody is blamed for the silence:
   * whatever they sent could not be read. */
  function heartbeat(now) {
    now = now === undefined ? Date.now() : now;
    const late = now - lastTick - opt.heartbeatMs;
    lastTick = now;
    if (late > Math.max(1500, opt.heartbeatMs * 1.5)) {
      stalls++;
      for (const c of conns) c.ws.lastSeen = now;
      opt.log(`this server was not running for about ${span(late + opt.heartbeatMs)} (stalled, or the computer slept): that is not counted against any player`);
    }
    for (const c of Array.from(conns)) {
      const silent = now - c.ws.lastSeen;
      if (silent > opt.deadAfterMs) { c.dropWhy = `no sign of life for ${span(silent)} (it did not answer pings)`; c.ws.terminate('heartbeat'); continue; }
      c.ws.alive = false; c.ws.ping();
    }
    for (const room of Array.from(rooms.values())) {
      const empty = room.players.every(x => !x || !x.conn);
      if (empty && now - room.lastActivity > opt.idleRoomMs && !(room.state === 'playing' && room.players.some(p => p && p.timer))) { dropRoom(room); }
    }
    for (const [ip, f] of failures) if (now > f.until) failures.delete(ip);
  }
  const beat = setInterval(() => heartbeat(), opt.heartbeatMs);
  if (beat.unref) beat.unref();
  const health = setInterval(() => {                       // while games are on: one line about how the connections are doing
    if (!Array.from(rooms.values()).some(r => r.state === 'playing')) { if (lag) lag.reset(); return; }
    const parts = Array.from(conns).filter(c => c.session).map(c => `${(c.session.room.players[c.session.seat] || {}).name} ${c.ws.rtt.n ? `ping ${Math.round(c.ws.rtt.sum / c.ws.rtt.n)} ms (worst ${c.ws.rtt.max})` : 'no ping yet'} [${deviceOf(c.ua)}]`);
    opt.log(`connections healthy: ${parts.join('; ') || 'none'}; ${lagText()}`);
    if (lag) lag.reset();
  }, opt.healthMs);
  if (health.unref) health.unref();

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
    shuttingDown = true;
    clearInterval(beat); clearInterval(health); if (lag) lag.disable();
    for (const t of Array.from(timers)) cancel(t);
    for (const room of Array.from(rooms.values())) { if (room.match) room.match.abort(); }
    rooms.clear();
    for (const c of Array.from(conns)) c.ws.terminate();
    return new Promise(res => http_.close(() => res()));
  }
  return { listen, close, rooms, conns, http: http_, get port() { return boundPort; }, options: opt, heartbeat, netStats };
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
