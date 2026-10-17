#!/usr/bin/env node
'use strict';
/**
 * Mexican Train game server: host a game on your own computer and let a friend join it.
 *
 *   node server.js                 listen on port 8080 on every network interface
 *   node server.js --port 3000     another port
 *   node server.js --local-only    only this computer may connect (for trying it out)
 *   node server.js --name table1   a label of your choice, to tell this server from other processes in `ps -ef`
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
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GameLogs, LocalTally, isThisComputer } = require('./gamelog.js');
const { GameHistory } = require('./history.js');
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

/* ------------------------------ this computer's address on the internet ------------------------------ */
/* Is this text an address that could be this computer's public one? Only a plain IPv4 address qualifies, and not one that is private,
 * loopback, link-local, carrier-grade-NAT, multicast or reserved: a service that answers with one of those has told us nothing useful. */
function isPublicIPv4(text) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(text));
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some(n => n > 255)) return false;
  const a = o[0], b = o[1];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 192 && b === 0 && o[2] === 0) return false;
  return true;
}
/* GET a small plain-text reply: IPv4 only, no redirects followed, a time limit, and the reply cut off at maxBytes (a service that sends more is refused). */
function fetchSmallText(urlString, timeoutMs, maxBytes) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlString); } catch (e) { return reject(new Error('bad address')); }
    const mod = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!mod) return reject(new Error('unsupported protocol'));
    let done = false, req = null;
    const finish = (err, value) => { if (done) return; done = true; clearTimeout(timer); try { if (req) req.destroy(); } catch (e) { /* ignore */ } if (err) reject(err); else resolve(value); };
    const timer = setTimeout(() => finish(new Error('timed out')), timeoutMs);
    if (timer.unref) timer.unref();
    req = mod.get(u, { family: 4, timeout: timeoutMs, headers: { 'User-Agent': 'mexican-train-server', Accept: 'text/plain' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return finish(new Error('status ' + res.statusCode)); }
      let size = 0; const chunks = [];
      res.on('data', c => { size += c.length; if (size > maxBytes) return finish(new Error('reply too long')); chunks.push(c); });
      res.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
      res.on('error', e => finish(e));
    });
    req.on('error', e => finish(e));
    req.on('timeout', () => finish(new Error('timed out')));
  });
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
    checkBuild: false,                   // turn away a page that is not the one this server serves (the command line turns this on; see pageBuild)
    publicIp: true,                      // may the server ask a public service what this computer's address on the internet is? (node server.js --no-public-ip turns it off)
    publicIpUrls: ['https://api.ipify.org', 'https://checkip.amazonaws.com', 'https://icanhazip.com'],     // asked in turn, only when the Host screen asks (plain text reply)
    publicIpTimeoutMs: 2500,             // for each of them
    publicIpCacheMs: 5 * 1000,           // a found address is reused this long (a public address can change, so every time the Host screen is opened it is asked again) ...
    publicIpFailMs: 5 * 1000,            // ... and so is a failure: it is not asked more often than this, however many clicks or clients there are
    publicIpLookup: null,                // (tests) an async function returning { ip, via } instead of asking a service
    maxWrongCodes: 8,                    // wrong join codes from one address before it must wait a minute
    ratePerSecond: 30, burst: 60,        // messages a connection may send: far more than a person can click
    gameLog: false,                      // write a log of every game, for debugging (the command line turns this on; see gamelog.js)
    historyFile: null,                   // the SQLite file the list of games is kept in (null: only while the server runs); GET /history shows it
    historyMax: 500,                     // how many games it remembers
    gamesDir: path.join(__dirname, 'games'),     // ... into this directory (made if it is not there)
    maxLogPost: 256 * 1024,              // the most a page may send in one go
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

  /* ------------------------------ which version of the page ------------------------------ */
  /* The stamp inside the page file this server serves (see build.py), looked up again whenever the file changes. */
  let buildId = '', buildMtime = -1;
  function pageBuild() {
    try {
      const st = fs.statSync(opt.pagePath);
      if (st.mtimeMs !== buildMtime) { const m = /window\.MT_BUILD = "([0-9a-f]{6,64})"/.exec(fs.readFileSync(opt.pagePath, 'utf8')); buildId = m ? m[1] : ''; buildMtime = st.mtimeMs; }
    } catch (e) { buildId = ''; }
    return buildId;
  }
  /* A page that is not the one being served (an old tab, a saved copy) is told so, instead of being let in: it could ask for things this server
   * would then do differently from what its screen promised (a game for three people, say). */
  function outdatedPage(c, msg, who) {
    if (!opt.checkBuild) return false;
    const want = pageBuild();
    if (!want || msg.build === want) return false;
    opt.log(`${who} was refused (${msg.t}): the page in use is ${typeof msg.build === 'string' && msg.build ? 'build ' + msg.build : 'from before pages carried a version'}, this server's is build ${want}`);
    reply(c, 'page_outdated', 'The game page you are using is out of date. Reload it (Ctrl+F5, or Cmd+Shift+R on a Mac) and try again. (If you opened a saved copy of the page, open the game server\'s address in your browser instead.)');
    return true;
  }

  /* ------------------------------ the public address ------------------------------ */
  const pub = { at: 0, result: null, promise: null };
  function findPublicIp() {
    if (opt.localOnly || opt.publicIp === false) return Promise.resolve({ state: 'off' });
    const age = Date.now() - pub.at;
    if (pub.result && age < (pub.result.state === 'ok' ? opt.publicIpCacheMs : opt.publicIpFailMs)) return Promise.resolve(pub.result);
    if (pub.promise) return pub.promise;                          // one question at a time, however many are waiting for the answer
    pub.promise = (async () => {
      let result = { state: 'unavailable' };
      try {
        if (opt.publicIpLookup) {
          const r = await opt.publicIpLookup();
          if (r && isPublicIPv4(r.ip)) result = { state: 'ok', ip: r.ip, via: String(r.via || 'custom') };
        } else {
          for (const url of opt.publicIpUrls) {
            try {
              const text = (await fetchSmallText(url, opt.publicIpTimeoutMs, 128)).trim();
              if (isPublicIPv4(text)) { result = { state: 'ok', ip: text, via: new URL(url).host }; break; }
            } catch (e) { /* try the next one */ }
          }
        }
      } catch (e) { /* unavailable */ }
      pub.result = result; pub.at = Date.now(); pub.promise = null;
      opt.log(result.state === 'ok' ? `this computer's public address is ${result.ip} (asked ${result.via})` : 'could not find this computer\'s public address (no internet access, or the lookup services did not answer)');
      return result;
    })();
    return pub.promise;
  }

  /* ------------------------------ the page ------------------------------ */
  function readPage() {
    try {
      const st = fs.statSync(opt.pagePath);
      if (!page || st.mtimeMs !== pageMtime) { page = fs.readFileSync(opt.pagePath); pageMtime = st.mtimeMs; }
      return page;
    } catch (e) { return null; }
  }
  const history = new GameHistory({ file: opt.historyFile, max: opt.historyMax, onError: e => opt.log(`the list of past games could not be saved: ${e && e.message}`) });
  const keepHistory = match => { if (match && !match.recorded && match.roundsPlayed > 0) { match.recorded = true; try { history.add(match.summary()); } catch (e) { /* never a reason to disturb a game */ } } };
  const localGames = new LocalTally();
  const gamelogs = opt.gameLog ? new GameLogs({ dir: opt.gamesDir, onError: e => opt.log(`the game log has been switched off: ${e && e.message}`) }) : null;
  const http_ = http.createServer((req, res) => {
    const url = String(req.url || '/').split('?')[0];
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
    if (url === '/gamelog') {                                 // events of a game a page is playing against the computer: kept in this server's games directory
      const reply = (code, text) => { res.writeHead(code, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers)); res.end(text || ''); };
      if (req.method !== 'POST') { res.writeHead(405, Object.assign({ Allow: 'POST' }, headers)); return res.end(); }
      if (!isThisComputer(req.socket && req.socket.remoteAddress)) return reply(403, 'Only this computer may add to the game log.');
      let size = 0, tooBig = false; const chunks = [];
      req.on('data', c => { size += c.length; if (size > opt.maxLogPost) { tooBig = true; return; } chunks.push(c); });
      req.on('end', () => {
        if (tooBig) return reply(413, 'Too much at once.');
        let body = null; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { /* not JSON */ }
        if (!body || typeof body !== 'object') return reply(400, 'Not understood.');
        const valid = typeof body.id === 'string' && /^[A-Za-z0-9_-]{6,48}$/.test(body.id) && Array.isArray(body.events) && body.events.length <= 2000;
        if (!(gamelogs ? gamelogs.acceptLocal(body.id, body.events) : valid)) return reply(400, 'Nothing was kept.');      // (with no game log kept, the events are still counted for the list of past games)
        try { const sum = localGames.observe(body.id, body.events); if (sum) history.add(sum); } catch (e) { /* never a reason to disturb a game */ }      // the finished game goes into the list of past games, too
        return reply(204);
      });
      req.on('error', () => reply(400, 'Not understood.'));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, Object.assign({ Allow: 'GET, HEAD' }, headers)); return res.end(); }
    if (url === '/' || url === '/index.html') {
      const body = readPage();
      if (!body) { res.writeHead(500, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers)); return res.end('The game page (' + path.basename(opt.pagePath) + ') was not found next to the server.'); }
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length }, headers));
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (url === '/info') {                                    // the address(es) the host's page should show: this computer's network address, never "localhost"
      const list = lanAddresses(boundPort, opt.localOnly);
      const body = JSON.stringify({ game: 'mexican-train', addresses: list, preferred: list[0] || `127.0.0.1:${boundPort}`, maxHumans: 3, maxPlayers: 4, build: pageBuild() });         // (maxHumans: how many people this server can seat. An older server does not say, and the page knows it cannot do three.)
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, headers));
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (url === '/history') {                                 // the games played here: newest first, ?n= how many (20 by default)
      const q = /[?&]n=(\d+)/.exec(String(req.url || ''));
      const body = JSON.stringify({ game: 'mexican-train', games: history.list(q ? Number(q[1]) : 20) });
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, headers));
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (url === '/publicip') {                                // what this computer's address on the internet is, if a public service can tell (asked only now, remembered for a while)
      findPublicIp().then(r => {
        const out = { game: 'mexican-train', state: r.state };
        if (r.state === 'ok') Object.assign(out, { ip: r.ip, address: `${r.ip}:${boundPort}`, via: r.via });
        const body = JSON.stringify(out);
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, headers));
        res.end(req.method === 'HEAD' ? undefined : body);
      });
      return;
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
      case 'tried': return onTried(c, msg);
      case 'leave': return onLeave(c);
      case 'rematch': return onRematch(c);
      default: return strike(c, 'unknown_type', 'Unknown message type.');
    }
  }
  function strike(c, code, message) { reply(c, code, message); if (++c.bad > 20) c.ws.close(1008, 'too many bad messages'); }

  /* ------------------------------ rooms ------------------------------ */
  const pickBackdrop = () => G.BACKDROPS[(opt.nameRng || Math.random)() < 0.5 ? 0 : 1];      // the wizarding board's picture: chosen for every game, for everyone at the table
  function newRoom(c, name, settings) {
    let code; do { code = randomCode(); } while (rooms.has(code));
    const room = {
      code, settings: { rounds: [1, 4, 13].includes(Number(settings.rounds)) ? Number(settings.rounds) : 4, hand: [8, 12, 15].includes(Number(settings.hand)) ? Number(settings.hand) : 15, computer: cleanComputer(settings.computer), computer2: cleanHumans(settings.humans) === 2 && cleanComputer(settings.computer) ? cleanComputer(settings.computer2) : null, theme: cleanTheme(settings.theme), allowHints: !(settings.allowHints === false || settings.allowHints === 'false'), humans: cleanHumans(settings.humans) },
      computerName: null, computer2Name: null,
      players: [{ name, token: crypto.randomBytes(16).toString('hex'), conn: null, lostAt: null, timer: null }, null, null],
      state: 'lobby', match: null, again: new Set(), chatAt: [0, 0, 0], chatLog: [[], [], []], lastActivity: Date.now(), over: null,
    };
    rooms.set(code, room);
    return room;
  }
  const seatOf = c => (c.session ? c.session.seat : -1);
  const seatsOf = room => Array.from({ length: room.settings.humans }, (_, i) => i);          // the seats people sit in: two or three
  const connectedSeats = room => seatsOf(room).map(i => { const p = room.players[i]; return !!(p && p.conn && p.conn.ws.open); });

  function sendSeat(room, seat, msg) { const p = room.players[seat]; if (p && p.conn) send(p.conn, msg); }
  function lobbyMessage(room, seat) {
    return {
      t: 'lobby', code: room.code, display: showCode(room.code), seat, settings: room.settings,
      players: seatsOf(room).map(i => room.players[i]).map(p => (p ? { name: p.name, connected: !!(p.conn && p.conn.ws.open) } : null))
        .concat(room.settings.computer ? [{ name: room.computerName, connected: true, computer: true, level: room.settings.computer }] : [])
        .concat(room.settings.computer2 ? [{ name: room.computer2Name, connected: true, computer: true, level: room.settings.computer2 }] : []),
      canStart: !!(room.state === 'lobby' && seatsOf(room).every(i => room.players[i]) && connectedSeats(room).every(Boolean)),
      addresses: lanAddresses(boundPort, opt.localOnly), state: room.state,
    };
  }
  function sendLobby(room) { for (const seat of seatsOf(room)) sendSeat(room, seat, lobbyMessage(room, seat)); }
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
    for (const seat of seatsOf(room)) {
      // a player in the first few seconds after a drop still counts as there: most blips mend themselves, and nobody needs to hear about those
      const others = seatsOf(room).filter(i => i !== seat).map(i => ({ seat: i, p: room.players[i] }));
      const state = others.map(({ seat: i, p }) => ({ seat: i, connected: !!(p && ((p.conn && p.conn.ws.open) || p.soft)), graceUntil: p && p.lostAt && !p.soft ? p.lostAt + opt.graceMs : null }));
      const gone = state.filter(x => !x.connected && x.graceUntil !== null).map(x => x.graceUntil);
      // oppConnected / graceUntil say it for everyone else at once (as they always did with one other person); opps says it for each
      sendSeat(room, seat, { t: 'presence', oppConnected: state.every(x => x.connected), graceUntil: gone.length ? Math.min.apply(null, gone) : null, opps: state });
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
    if (room.match) { room.match.abort(); keepHistory(room.match); }
    for (const seat of seatsOf(room)) { const p = room.players[seat]; if (p) { cancel(p.timer); p.timer = null; cancel(p.soft); p.soft = null; } }
    for (const seat of seatsOf(room)) sendSeat(room, seat, { t: 'ended', reason, message });
    opt.log(`game ${showCode(room.code)} ended: ${reason}`);
  }
  function dropRoom(room) {
    endRoom(room, room.over || 'closed', 'This game was closed.');
    for (const p of room.players) if (p) { cancel(p.timer); cancel(p.soft); if (p.conn) p.conn.session = null; }
    rooms.delete(room.code);
  }

  /* ------------------------------ messages ------------------------------ */
  const cleanSettings = msg => ({ rounds: msg.rounds, hand: msg.hand, computer: msg.computer, computer2: msg.computer2, theme: msg.theme, allowHints: msg.allowHints, humans: msg.humans });
  const cleanHumans = v => (Number(v) === 3 ? 3 : 2);                              // people at the table: two, or three (a table never has more than four players in all, computers included)
  const cleanComputer = v => (G.Engine.LEVELS.includes(v) ? v : null);       // 'easy', 'normal' or 'hard'; anything else means no computer player
  const cleanTheme = v => (G.THEME_IDS.includes(v) ? v : 'classic');            // who the computer player is, and the ring or toy train markers
  /* A name for the computer player, from the computer players of its level (and theme), not one a person at the table has. */
  function nameComputer(room) {
    const taken = new Set(room.players.filter(Boolean).map(p => p.name.toLowerCase()));
    const one = (key, nameKey, other) => {
      const level = room.settings[key];
      if (!level) { room[nameKey] = null; return; }
      const mine = new Set(taken); if (other) mine.add(other.toLowerCase());
      if (room[nameKey] && !mine.has(room[nameKey].toLowerCase()) && room[nameKey + 'For'] === level + '|' + room.settings.theme) return;   // keep its name while the level and theme are unchanged
      room[nameKey] = G.pickCpuName(level, opt.nameRng || Math.random, mine, room.settings.theme); room[nameKey + 'For'] = level + '|' + room.settings.theme;
    };
    one('computer', 'computerName', null);
    one('computer2', 'computer2Name', room.computerName);
  }
  /* Never more than four players at the table, and a second computer only after a first, and only at a table of two people. */
  function fixComputers(room) {
    const st = room.settings;
    if (!st.computer) st.computer2 = null;
    if (st.humans === 3) st.computer2 = null;
    nameComputer(room);
  }

  const computersText = room => [['computer', 'computerName'], ['computer2', 'computer2Name']].filter(([k]) => room.settings[k]).map(([k, n]) => ' vs ' + room[n] + ' (computer, ' + room.settings[k] + ')').join('');
  const seatText = room => `${room.settings.humans === 3 ? 'three people' : 'two people'}${[room.settings.computer, room.settings.computer2].filter(Boolean).map(l => (l === 'easy' ? ' and an ' : ' and a ') + l + ' computer').join('')}`;
  function onCreate(c, msg) {
    if (c.session) return reply(c, 'already_in_game', 'You are already in a game.');
    if (outdatedPage(c, msg, `${cleanName(msg.name, 'Host')} (hosting)`)) return;
    if (rooms.size >= opt.maxRooms) return reply(c, 'server_full', 'This server is hosting as many games as it can. Try again later.');
    const room = newRoom(c, cleanName(msg.name, 'Host'), cleanSettings(msg));
    fixComputers(room);
    attach(room, 0, c);
    opt.log(`game ${showCode(room.code)} created by ${room.players[0].name}: ${seatText(room)}, ${room.settings.rounds} round${room.settings.rounds === 1 ? '' : 's'} of ${room.settings.hand} tiles`);
    send(c, { t: 'created', code: room.code, display: showCode(room.code), token: room.players[0].token, seat: 0, settings: room.settings, addresses: lanAddresses(boundPort, opt.localOnly) });
    sendLobby(room);
  }
  function guessBlocked(c) { const f = failures.get(c.ip); return f && f.n >= opt.maxWrongCodes && Date.now() < f.until; }
  /* A name nobody at the table already has (compared without regard to capitals, the computer player's name included): a second "Ann" is "Ann 2". */
  function uniqueName(room, wanted) {
    const taken = new Set(room.players.filter(Boolean).map(p => p.name.toLowerCase()));
    if (room.computerName) taken.add(room.computerName.toLowerCase());
    if (room.computer2Name) taken.add(room.computer2Name.toLowerCase());
    let name = wanted;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = cleanName(wanted.slice(0, 10 - (' ' + n).length) + ' ' + n);      // (kept within 10 characters)
    return name;
  }
  function onJoin(c, msg) {
    if (c.session) return reply(c, 'already_in_game', 'You are already in a game.');
    if (guessBlocked(c)) return reply(c, 'too_many_tries', 'Too many wrong codes. Wait a minute and try again.');
    if (outdatedPage(c, msg, `${cleanName(msg.name, 'Guest')} (joining)`)) return;
    const code = normalizeCode(msg.code);
    const room = rooms.get(code);
    if (!room || room.state === 'over') {
      const f = failures.get(c.ip) || { n: 0, until: 0 }; f.n++; f.until = Date.now() + 60000; failures.set(c.ip, f);
      return reply(c, 'no_such_game', 'There is no game with that code. Check the code and the address.');
    }
    const seat = room.state === 'lobby' ? seatsOf(room).find(i => i > 0 && !room.players[i]) : undefined;
    if (seat === undefined) {
      const inIt = seatsOf(room).map(i => room.players[i]).filter(Boolean).map(p => p.name);
      const who = inIt.length > 1 ? inIt.slice(0, -1).join(', ') + ' and ' + inIt[inIt.length - 1] : inIt.join('');
      if (room.state !== 'lobby') { opt.log(`${cleanName(msg.name, 'Guest')} could not join game ${showCode(room.code)}: it has already started (${who})`); return reply(c, 'game_started', 'That game has already started.'); }
      opt.log(`${cleanName(msg.name, 'Guest')} could not join game ${showCode(room.code)}: it is for ${room.settings.humans} people and has ${who}`);
      return reply(c, 'game_full', `That game already has ${room.settings.humans === 3 ? 'three' : 'two'} players (${who}).`);
    }
    failures.delete(c.ip);
    room.players[seat] = { name: uniqueName(room, cleanName(msg.name, 'Guest')), token: crypto.randomBytes(16).toString('hex'), conn: null, lostAt: null, timer: null };
    attach(room, seat, c);
    opt.log(`${room.players[seat].name} joined game ${showCode(room.code)}`);
    send(c, { t: 'joined', code: room.code, display: showCode(room.code), token: room.players[seat].token, seat, settings: room.settings, addresses: lanAddresses(boundPort, opt.localOnly) });
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
      if (v === null || v === false || v === 'none' || v === '') room.settings.computer = null;
      else if (cleanComputer(v)) room.settings.computer = v;
    }
    if (Object.prototype.hasOwnProperty.call(msg, 'computer2')) {            // the second computer: the same
      const v = msg.computer2;
      if (v === null || v === false || v === 'none' || v === '') room.settings.computer2 = null;
      else if (cleanComputer(v)) room.settings.computer2 = v;
    }
    if (s.theme !== undefined && G.THEME_IDS.includes(s.theme)) room.settings.theme = s.theme;   // an unknown theme is ignored
    if (typeof s.allowHints === 'boolean') room.settings.allowHints = s.allowHints;                                       // the host's choice about hints, for everyone at the table
    if (Object.prototype.hasOwnProperty.call(msg, 'humans') && [2, 3, '2', '3'].includes(msg.humans)) {                    // two people or three
      const want = cleanHumans(msg.humans);
      if (want === 2 && room.players[2]) return reply(c, 'not_allowed', 'Someone has already joined the third seat.');
      room.settings.humans = want;
    }
    fixComputers(room);
    sendLobby(room);
  }
  function onStart(c) {
    const room = c.session && c.session.room;
    if (!room || c.session.seat !== 0) return reply(c, 'not_allowed', 'Only the host can start the game.');
    if (room.state !== 'lobby') return reply(c, 'not_allowed', 'The game has already started.');
    if (!seatsOf(room).every(i => room.players[i]) || !connectedSeats(room).every(Boolean)) return reply(c, 'not_ready', room.settings.humans === 3 ? 'Wait for the other players to join.' : 'Wait for the other player to join.');
    room.state = 'playing';
    nameComputer(room);
    room.settings.backdrop = pickBackdrop();
    startMatch(room);
    opt.log(`game ${showCode(room.code)} started: ${seatsOf(room).map(i => room.players[i].name).join(' vs ')}${computersText(room)}${room.settings.theme !== 'classic' ? ' [' + room.settings.theme + ' theme]' : ''}`);
    sendLobby(room);
  }
  /* Make the match for this room (its first game, or a rematch with the same people and settings) and run it. */
  function startMatch(room) {
    const match = room.match = new OnlineMatch({
      rounds: room.settings.rounds, hand: room.settings.hand, allowHints: room.settings.allowHints !== false,
      names: seatsOf(room).map(i => room.players[i].name).concat(room.settings.computer ? [room.computerName] : []).concat(room.settings.computer2 ? [room.computer2Name] : []),
      computers: [room.settings.computer, room.settings.computer2].filter(Boolean).map(level => ({ level })), theme: room.settings.theme,
      rng: opt.rng ? opt.rng(room) : undefined, stepDelay: opt.stepDelay, sleep: opt.sleep,
      chatRng: opt.chatRng || undefined, timer: opt.timer || undefined, now: opt.now || undefined, nativeChance: opt.nativeChance, foodChance: opt.foodChance,
      push: (seat, msg) => sendSeat(room, seat, msg),
      gameLog: gamelogs ? gamelogs.forHosted(showCode(room.code).replace(/[^A-Za-z0-9]/g, '')) : undefined,
    });
    match.start().then(() => {
      if (room.match !== match) return;                            // (a newer match has taken this room over: this one must not change its state)
      room.lastActivity = Date.now();
      if (match.over === 'error') { opt.log(`game ${showCode(room.code)} hit an error: ${match.error && match.error.message}`); endRoom(room, 'error', 'Something went wrong in the game, so it had to end.'); }
      else if (match.over === 'finished') { keepHistory(match); room.state = 'over'; room.over = 'finished'; opt.log(`game ${showCode(room.code)} finished`); }
    });
  }
  /* ------------------------------ playing again ------------------------------ */
  /* Anyone who has seen the final score may ask to play again. The game starts again, with the same people, seats, settings and computer
   * player, when EVERY person at the table has asked. If someone has left (or their page has closed) there is no one to play with, and
   * the others are told who has gone. Everyone is told, after every change, who has asked and who has gone. */
  const seenFinal = (room, seat) => (room.state === 'over' && room.over === 'finished') || sawEverything(room, seat);
  const seatGone = (room, seat) => { const p = room.players[seat]; return !p || !!p.left || !(p.conn && p.conn.ws.open); };
  function againState(room) { return { asked: Array.from(room.again).sort(), gone: seatsOf(room).filter(i => seatGone(room, i)) }; }
  function sendAgain(room) { const st = againState(room); for (const seat of seatsOf(room)) sendSeat(room, seat, { t: 'again', asked: st.asked, gone: st.gone }); }
  function someoneLeft(room, seat) {                       // a person has left, or closed their page, after the final score: nobody can play again
    const p = room.players[seat];
    if (p) p.left = true;
    room.again.delete(seat);
    sendAgain(room);
  }
  function onRematch(c) {
    const room = c.session && c.session.room, seat = seatOf(c);
    if (!room || (room.state !== 'over' && room.state !== 'playing')) return reply(c, 'not_now', 'There is no game to play again.');
    if (room.state === 'over' && room.over !== 'finished') return reply(c, 'not_now', 'That game was not played to the end.');
    if (!seenFinal(room, seat)) return reply(c, 'not_now', 'You can ask to play again once you have seen the final score.');
    room.lastActivity = Date.now();
    room.again.add(seat);
    const st = againState(room);
    opt.log(`${room.players[seat].name} asked to play game ${showCode(room.code)} again (${room.again.size} of ${room.settings.humans} asked${st.gone.length ? '; ' + st.gone.map(i => (room.players[i] || {}).name).join(' and ') + ' has gone' : ''})`);
    sendAgain(room);
    if (room.state !== 'over' || st.gone.length || !seatsOf(room).every(i => room.again.has(i))) return;      // not everyone yet (or someone has gone, or the others have not seen their final score)
    room.again.clear(); room.state = 'playing'; room.over = null;
    room.settings.backdrop = pickBackdrop();
    for (const i of seatsOf(room)) sendSeat(room, i, { t: 'rematch', backdrop: room.settings.backdrop });              // (told first, so a page forgets the finished game before the first state of the new one)
    startMatch(room);
    opt.log(`game ${showCode(room.code)} started again: ${seatsOf(room).map(i => room.players[i].name).join(' vs ')}${computersText(room)}`);
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
  /* A person tried to put a tile where it does not go: the computer at the table may remark on it (no reply: it is only a remark). */
  function onTried(c, msg) {
    const room = c.session && c.session.room;
    if (room && room.match && room.state === 'playing') room.match.tried(c.session.seat, msg && typeof msg.train === 'string' ? msg.train : undefined);
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
    for (const other of seatsOf(room)) if (other !== seat) sendSeat(room, other, Object.assign({ t: 'chat', text, from: seat }, id !== null ? { id } : {}));       // (the server says who: a sender cannot claim to be someone else)
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
      else { room.players[seat] = null; sendLobby(room); }
    } else if (room.state === 'playing') {
      if (sawEverything(room, seat)) { opt.log(`${p ? p.name : 'A player'} left game ${showCode(room.code)} after seeing the final score; the other player has not yet`); room.match.seatLeft(seat); someoneLeft(room, seat); }
      else endRoom(room, 'left', `${p ? p.name : 'The other player'} left the game.`);
    } else if (room.state === 'over' && room.over === 'finished' && p) someoneLeft(room, seat);
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
    if (room.state === 'over') { if (room.over === 'finished') sendAgain(room); if (room.players.every(x => !x || !x.conn)) later(() => { if (rooms.get(room.code) === room && room.players.every(x => !x || !x.conn)) rooms.delete(room.code); }, opt.overRoomMs); return; }
    if (room.state === 'lobby' && seat !== 0) { room.players[seat] = null; sendLobby(room); return; }     // a guest who drops from the lobby just frees the seat
    if (sawEverything(room, seat)) { opt.log(`${p.name} closed the page of game ${showCode(room.code)} after seeing the final score; the other player has not yet: no pause, no waiting for them`); room.match.seatLeft(seat); sendAgain(room); return; }
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
    rooms.clear(); history.close();
    for (const c of Array.from(conns)) c.ws.terminate();
    return new Promise(res => http_.close(() => res()));
  }
  return { listen, close, rooms, conns, http: http_, get port() { return boundPort; }, options: opt, heartbeat, netStats, pageBuild, gameLogs: gamelogs, history, get gameLogDir() { return gamelogs ? gamelogs.dir : null; } };
}

/* ------------------------------ command line ------------------------------ */
/* What `ps -ef` (and Activity Monitor, top, htop, pgrep -f ...) show for this process: not just "node", but this, so that it can be told from any other Node program:
 *     mexican-train-server :8080            or, with --name table1:      mexican-train-server table1 :8080
 * (On Windows the title is the console window's.) */
const PROCESS_NAME = 'mexican-train-server';
const NAME_OK = /^[A-Za-z0-9._:-]{1,40}$/;
function processTitle(name, port) { return PROCESS_NAME + (name ? ' ' + name : '') + (port ? ' :' + port : ''); }

function main(argv) {
  const args = { port: Number(process.env.PORT) || 8080, localOnly: false, page: null, grace: 180, help: false, quiet: false, publicIp: true, name: null, gameLog: true, gamesDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--port' || a === '-p') args.port = Number(argv[++i]);
    else if (a === '--local-only') args.localOnly = true;
    else if (a === '--page') args.page = argv[++i];
    else if (a === '--grace') args.grace = Number(argv[++i]);
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--no-public-ip') args.publicIp = false;
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--games-dir') args.gamesDir = argv[++i];
    else if (a === '--no-game-log') args.gameLog = false;
    else if (a === '--no-history') args.history = false;
    else { console.error(`Unknown option: ${a}`); args.help = true; args.bad = true; }
  }
  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) { console.error('--port must be a number from 0 to 65535'); args.help = args.bad = true; }
  if (args.name !== null && !(typeof args.name === 'string' && NAME_OK.test(args.name))) { console.error('--name must be 1 to 40 letters, digits, dots, dashes, underscores or colons (no spaces)'); args.help = args.bad = true; }
  if (args.gamesDir !== null && !(typeof args.gamesDir === 'string' && args.gamesDir.length > 0 && args.gamesDir.length < 400)) { console.error('--games-dir needs a directory'); args.help = args.bad = true; }
  if (!(args.grace >= 5)) { console.error('--grace must be a number of seconds (at least 5)'); args.help = args.bad = true; }
  if (args.help) {
    console.log(`Mexican Train server

Usage: node server.js [options]

  -p, --port N     port to listen on (default 8080)
  --local-only     accept connections only from this computer (default: from the whole network)
  --page FILE      the game page to serve (default: mexican-train.html next to this file)
  --grace SECONDS  how long a dropped player has to come back (default 180)
  --quiet          do not print what happens in games
  --no-public-ip   never ask an internet service (api.ipify.org and others) what this computer's public address is
                   (by default it is asked, only when you open the Host screen, to offer it as a way to join)
  --games-dir DIR  where the log of every game is written (default: the games directory next to server.js; it is made if it is not there)
  --no-game-log    do not keep a log of the games (by default every game's boneyard, hands, draws and plays are written to a file, one file per game, for debugging)
  --no-history     do not keep the list of finished games (by default each game's players, time, winner and final scores go into a SQLite file, history.db, in the games directory; with --no-game-log it is kept only while the server runs)
  --name LABEL     a label to tell this server from other processes: it is part of the command line and of the process name
                   (in ps -ef the server shows as "mexican-train-server LABEL :PORT"; with no label, "mexican-train-server :PORT")
  -h, --help       this help

Listening on the whole network means other computers can connect to YOUR-IP:PORT.
Your firewall may ask whether to allow Node.js: say yes for private networks.`);
    process.exit(args.bad ? 1 : 0);
  }
  process.title = processTitle(args.name, args.port);                    // what ps shows (updated below when the port is known)
  const server = createGameServer({
    historyFile: args.history === false || !args.gameLog ? null : path.join(args.gamesDir ? path.resolve(args.gamesDir) : path.join(__dirname, 'games'), 'history.db'),
    localOnly: args.localOnly, checkBuild: true, publicIp: args.publicIp, gameLog: args.gameLog, gamesDir: args.gamesDir ? path.resolve(args.gamesDir) : path.join(__dirname, 'games'), graceMs: Math.round(args.grace * 1000),
    pagePath: args.page ? path.resolve(args.page) : path.join(__dirname, 'mexican-train.html'),
    log: args.quiet ? () => {} : msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`),
  });
  server.listen(args.port).then(port => {
    const addrs = lanAddresses(port, args.localOnly);
    process.title = processTitle(args.name, port);
    console.log('\nMexican Train server is running.\n');
    console.log(`  Process name: ${process.title}   (find it with: ps -ef | grep mexican-train-server)\n`);
    if (!args.gameLog) console.log('  Game logs: off (--no-game-log)\n');
    else if (server.gameLogs && server.gameLogs.failed) console.log(`  Game logs: could NOT be started in ${server.gameLogDir} (is it writable?). The games are played as usual.\n`);
    else console.log(`  Game logs: ${server.gameLogDir}\n  (every game's boneyard, hands, draws and plays, one file per game, each round written when it has ended,\n   so that a log cannot show a round that is still being played; node tools/check_gamelog.js FILE checks\n   that a log adds up, and --print reads it)\n`);
    const served = server.pageBuild ? server.pageBuild() : '';
    console.log(served ? `  Serving the game page, build ${served}. (A browser tab opened before the files were replaced has an older build: reload it.)\n` : '');
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

module.exports = { processTitle, PROCESS_NAME, createGameServer, isPublicIPv4, lanAddresses, addressRank, sortAddresses, normalizeCode, showCode, CODE_ALPHABET };
