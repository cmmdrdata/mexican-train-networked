'use strict';
require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32, key } = E;
const { createGameServer } = require('../server.js');
// the engine's own record of turns: every time it asks a seat to move or draw, and every pass. Consecutive entries
// for the same seat are one turn (covering your own double, playing the tile you drew), but never across two rounds: the first turn
// of a new round is a new turn even for the player who made the last move of the one before.
const OM = require('../online-match.js').OnlineMatch;
const prompts = new Map();
const realWait = OM.prototype._wait;
OM.prototype._wait = function (seat, kind, extra) { if (kind === 'move' || kind === 'draw') { if (!prompts.has(this)) prompts.set(this, []); prompts.get(this).push({ seat, prompt: true, round: this.roundIndex }); } return realWait.call(this, seat, kind, extra); };
// a player with nothing to play and an empty boneyard is passed without being asked anything: that is a turn too
const realHooks = OM.prototype._makeHooks;
OM.prototype._makeHooks = function () {
  const hooks = realHooks.call(this), onPass = hooks.onPass;
  hooks.onPass = async (game, player) => { if (!prompts.has(this)) prompts.set(this, []); prompts.get(this).push({ seat: this._seat(player), prompt: false, round: this.roundIndex }); return onPass(game, player); };
  return hooks;
};
// a sound is due for a prompt to this seat when the action before it (a prompt or a pass, by either player) was the other player's
const turnsOf = (srv, code, seat) => { const seq = prompts.get(srv.rooms.get(code).match) || []; let n = 0; seq.forEach((e, i) => { if (e.prompt && e.seat === seat && !(i > 0 && seq[i - 1].seat === seat && seq[i - 1].round === e.round)) n++; }); return n; };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(4); } return f(); };
const canon = t => [Math.min(t[0], t[1]), Math.max(t[0], t[1])];
const PAGE = require('path').join(__dirname, '..', 'mexican-train.html');

async function startServer(opts) {
  const srv = createGameServer(Object.assign({ pagePath: PAGE, stepDelay: 0, sleep: async () => {}, log: () => {}, heartbeatMs: 60000, softGraceMs: 0, ratePerSecond: 5000, burst: 10000,
    rng: () => mulberry32(2024) }, opts));                 // (the deal is fixed: a random one sometimes ends in the opening, with no turns for these checks to count)
  const port = await srv.listen(0, '127.0.0.1');
  return { srv, port };
}

/* ------------------------------------------------------------------------------------------------
 * A client: the real game page logic (createApp) with a fake screen, a real WebSocket, and recorders.
 * ---------------------------------------------------------------------------------------------- */
function makeClient(port, opts) {
  opts = opts || {};
  const c = { screens: [], sent: [], flights: [], clacks: 0, turns: 0, store: opts.store || {}, port };
  const root = { _h: '', set innerHTML(v) { this._h = v; c.screens.push(v); }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const R0 = { left: 10, top: 10, width: 40, height: 20 };
  const fx = {
    capture: () => ({ from: R0 }), land: (tok, spec, o) => c.flights.push(['play', spec, o || {}]),
    captureDraw: () => ({ from: R0 }), landDraw: (tok, spec) => c.flights.push(['draw', spec]), reapply() {}, cancelAll() {},
  };
  const Base = opts.WebSocket || WebSocket;
  class CountingWS extends Base { send(d) { try { c.sent.push(JSON.parse(d)); } catch (e) { /* ignore */ } return super.send(d); } }
  c.sockets = [];
  const WS = function (url) { const s = opts.factory ? opts.factory(url, CountingWS) : new CountingWS(url); c.sockets.push(s); return s; };
  WS.prototype = CountingWS.prototype;
  const app = G.createApp({
    root, rng: mulberry32(1), sleep: async () => {}, reducedMotion: false, now: () => Date.now(), chatRng: () => 1, nativeChance: 0, foodChance: 0,
    storage: { get: k => (k in c.store ? c.store[k] : null), set: (k, v) => { c.store[k] = v; } },
    fetch: opts.fetch === undefined ? globalThis.fetch : opts.fetch, infoUrl: `http://127.0.0.1:${port}/info`,
    WebSocket: WS, fx, sound: { unlock() {}, clack() { c.clacks++; }, turn() { c.turns++; } }, defaultServer: opts.noDefault ? '' : `127.0.0.1:${port}`,
  });
  c.app = app; c.S = app.state; c.root = root;
  c.html = () => root.innerHTML;
  c.dispatch = a => app.dispatch(a);
  app.dispatch({ type: 'boot' });
  return c;
}
// the Host screen gets this computer's address from the game server: wait for it, as a person would before pressing Create
const infoStub = addr => async () => ({ ok: true, json: async () => ({ addresses: [addr], preferred: addr }) });
const hostInfoReady = async c => { c.dispatch({ type: 'openHost' }); await until(() => c.S.hostInfo && c.S.hostInfo.state === 'ready'); };
const inGame = c => !!(c.S.online && c.S.online.phase === 'playing' && c.S.game);

/* a player who plays through the screens: taps, drops, the buttons */
function actions(c, rnd) {
  const S = c.S, a = S.awaiting, o = S.online;
  if (!a || !o || o.pending || o.conn !== 'open') return false;
  const d = x => c.dispatch(x);
  if (a.kind === 'modal') { d({ type: 'dialogOk' }); return true; }
  if (a.kind === 'draw') { d({ type: 'draw' }); return true; }
  const pick = () => a.moves[Math.floor(rnd() * a.moves.length)];
  const tap = () => {
    const m = pick();
    d({ type: 'selectTile', key: key(m.tile) });
    if (c.S.awaiting === a && !o.pending) { if (rnd() < 0.5) d({ type: 'playOn', train: m.trainId }); else d({ type: 'dropOnTrain', key: key(m.tile), train: m.trainId, from: { left: 5, top: 5, width: 40, height: 20 } }); }
  };
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
async function lobby(srv, port, settings) {
  const host = makeClient(port), guest = makeClient(port);
  await hostInfoReady(host);
  await hostInfoReady(host); host.dispatch(Object.assign({ type: 'hostGame', server: `127.0.0.1:${port}`, name: 'Ann' }, settings || { rounds: 1, hand: 8 }));
  await until(() => host.S.online && host.S.online.phase === 'lobby' && host.S.online.code);
  guest.dispatch({ type: 'openJoin' });
  guest.dispatch({ type: 'joinGame', server: `127.0.0.1:${port}`, name: 'Ben', code: host.S.online.display });
  await until(() => guest.S.online && guest.S.online.phase === 'lobby' && guest.S.online.code);
  await until(() => host.S.online.canStart);
  return { host, guest };
}
const allScreens = cs => cs.flatMap(c => c.screens);
const hostile = /<(script|img|svg|iframe|b|i)\b[^>]*>/i;

(async () => {
  /* ================================================================== */
  console.log('1. addresses and names');
  const P = G.parseServerAddress;
  ok(P('192.168.1.23:8080') === '192.168.1.23:8080' && P('192.168.1.23') === '192.168.1.23:8080', 'an address with or without a port (default 8080)');
  ok(P('http://myhost:3000/') === 'myhost:3000' && P('ws://10.0.0.5/ws?x=1') === '10.0.0.5:8080' && P('HTTP://Host.Example.com:81/path') === 'Host.Example.com:81', 'pasted URLs are reduced to host:port');
  ok(P('  localhost:8080  ') === 'localhost:8080' && P('[::1]:9000') === '[::1]:9000', 'spaces and IPv6 in brackets');
  ok([P(''), P('   '), P(null), P(undefined), P('a b'), P('host:0'), P('host:70000'), P('host:abc'), P('999.1.1.1'), P('<script>'), P('host:8080:9'), P('-bad.com'), P('x'.repeat(300)), P('http://'), P(':8080'), P('host name:80')].every(x => x === null), 'nonsense gives null: empty, spaces, bad port, bad IP, markup, double ports');
  ok(G.cleanPlayerName('<b>Ann</b>') === 'bAnnb' && G.cleanPlayerName('') === 'Player' && G.cleanPlayerName('x'.repeat(50)).length === 20 && G.cleanPlayerName(null, 'Z') === 'Z', 'names are cleaned the same way on the page as on the server');
  ok(G.ONLINE_PHRASES.length >= 8 && JSON.stringify(G.ONLINE_PHRASES) === JSON.stringify(require('../online-match.js').CHAT_PHRASES), 'the quick phrases are defined once and shared with the server');

  /* ================================================================== */
  console.log('2. the host and join screens');
  const A = await startServer({});
  {
    const c = makeClient(A.port);
    ok(/data-action="openHost">Host online game/.test(c.html()) && /data-action="openJoin">Join online game/.test(c.html()) && /data-action="startGame"/.test(c.html()), 'the start screen offers Host and Join next to the normal game');
    c.dispatch({ type: 'openHost' });
    let h = c.html();
    ok(/Looking up this computer&#39;s address|Looking up this computer's address/.test(h) && /data-action="hostGame"[^>]*disabled/.test(h), 'at first the Host screen says it is looking up this computer\'s address, and Create is not available yet');
    await until(() => c.S.hostInfo.state === 'ready');
    h = c.html();
    ok(new RegExp(`id="net-server" type="text" value="127\\.0\\.0\\.1:${A.port}" readonly aria-readonly="true" class="fixed"`).test(h), 'then the address the server reported is shown, in a field that cannot be edited (readonly)');
    ok(/cannot be changed here/.test(h) && !/data-action="hostGame"[^>]*disabled/.test(h), 'with a line saying so, and Create is available');
    ok(/id="net-name"/.test(h) && /id="net-rounds"/.test(h) && /id="net-hand"/.test(h) && !/id="net-code"/.test(h) && /node server.js/.test(h), 'it asks for a name and the game length, not a code, and says the page must be opened from the game server');
    // whatever the page is told to use, hosting uses the server's address
    c.dispatch({ type: 'hostGame', server: 'evil.example.com:9999', name: 'Ann', rounds: 1, hand: 8 });
    await until(() => c.S.online && c.S.online.phase === 'lobby');
    ok(c.sockets[0].url === `ws://127.0.0.1:${A.port}/ws` && c.S.online.server === `127.0.0.1:${A.port}`, 'even if a different address is sent along with Create, the game is hosted at the address the server gave (the field cannot be used to change it)');
    c.dispatch({ type: 'confirmLeave' });
    // a page that is not served by a game server (no way to ask it)
    const nf = makeClient(A.port, { fetch: null, noDefault: true });
    nf.dispatch({ type: 'openHost' });
    ok(nf.S.hostInfo.state === 'none' && /did not give its address/.test(nf.html()) && /data-action="hostGame"[^>]*disabled/.test(nf.html()) && /id="net-server" type="text" value="" readonly/.test(nf.html()), 'a page that cannot reach a game server says so, shows an empty read-only field and offers no Create');
    nf.dispatch({ type: 'hostGame', server: '10.0.0.1:8080', name: 'Ann', rounds: 4, hand: 15 });
    await wait(30);
    ok(!nf.S.online && /address is not known/.test(nf.html()), 'and pressing Create anyway, with an address typed in elsewhere, hosts nothing');
    const bad = makeClient(A.port, { fetch: async () => { throw new Error('offline'); } });
    bad.dispatch({ type: 'openHost' }); await until(() => bad.S.hostInfo.state === 'none');
    ok(/did not give its address/.test(bad.html()), 'a server that does not answer gives the same message');
    const junk = makeClient(A.port, { fetch: async () => ({ ok: true, json: async () => ({ addresses: ['<script>', 'a b'], preferred: '<img src=x>' }) }) });
    junk.dispatch({ type: 'openHost' }); await until(() => junk.S.hostInfo.state === 'none');
    ok(/did not give its address/.test(junk.html()) && !/<img src=x|<script>/.test(junk.html()), 'an answer that is not a usable address is refused, and nothing in it reaches the page');
    const multi = makeClient(A.port, { fetch: async () => ({ ok: true, json: async () => ({ addresses: ['192.168.1.9:8080', '10.0.0.4:8080', '100.64.0.2:8080'], preferred: '192.168.1.9:8080' }) }) });
    multi.dispatch({ type: 'openHost' }); await until(() => multi.S.hostInfo.state === 'ready');
    ok(/value="192\.168\.1\.9:8080" readonly/.test(multi.html()) && /other addresses too: 10\.0\.0\.4:8080, 100\.64\.0\.2:8080/.test(multi.html()), 'a computer with several addresses shows the best one and mentions the others');
    c.dispatch({ type: 'closeOverlay' });
    ok(/Choose your game settings|Mexican Train/.test(c.html()) && /data-action="startGame"/.test(c.html()), 'Back returns to the start screen');
    c.dispatch({ type: 'openJoin' });
    h = c.html();
    ok(/Join an online game/.test(h) && /id="net-code"/.test(h) && !/id="net-rounds"/.test(h), 'the Join screen asks for a code, not a game length');
    c.dispatch({ type: 'joinGame', server: `127.0.0.1:${A.port}`, name: 'Ben', code: '   ' });
    ok(/Enter the join code/.test(c.html()), 'no code: it says so');
    c.dispatch({ type: 'joinGame', server: `127.0.0.1:${A.port}`, name: 'Ben', code: 'ZZZ-ZZZ' });
    await until(() => /no game with that code/.test(c.html()));
    ok(/no game with that code/i.test(c.html()) && /id="net-code"/.test(c.html()) && /value="ZZZ-ZZZ"/.test(c.html()), 'a wrong code: the server\'s message appears on the same screen, and what was typed is kept');
    ok(c.S.online === null, '(and no half-open game is left behind)');
    // a server that is not there
    const dead = require('net').createServer(); await new Promise(r => dead.listen(0, '127.0.0.1', r)); const deadPort = dead.address().port; await new Promise(r => dead.close(r));
    c.dispatch({ type: 'joinGame', server: `127.0.0.1:${deadPort}`, name: 'Ben', code: 'ABC-DEF' });
    ok(/Connecting/.test(c.html()), 'while it tries, the button says "Connecting..."');
    await until(() => /Could not reach/.test(c.html()));
    ok(/Could not reach 127\.0\.0\.1:\d+/.test(c.html()) && /firewall/.test(c.html()) && /node server\.js/.test(c.html()), 'an unreachable server: a clear message that mentions the address, the server and the firewall');
    ok(c.S.online === null && c.S.overlay === 'online-join', 'and the player is still on the Join screen to fix it');
    c.dispatch({ type: 'closeOverlay' });
    const f = makeClient(A.port, { noDefault: true });
    f.dispatch({ type: 'openHost' });
    ok(/id="net-server" type="text" value=""/.test(f.html()), 'a page opened from a file (no server it came from) starts with an empty address');
    f.store['mt-server'] = '10.1.2.3:9000'; f.S.form = null; f.dispatch({ type: 'openJoin' });
    ok(/value="10\.1\.2\.3:9000"/.test(f.html()), '...or the one used last time');
  }

  /* ================================================================== */
  console.log('3. hosting, joining and the lobby (through the screens)');
  let host, guest;
  {
    host = makeClient(A.port); guest = makeClient(A.port);
    host.dispatch({ type: 'openHost' });
    await hostInfoReady(host);
    await hostInfoReady(host); host.dispatch({ type: 'hostGame', server: `127.0.0.1:${A.port}`, name: 'Ann', rounds: 1, hand: 8 });
    ok(host.S.online && host.S.online.phase === 'connecting', 'the host starts connecting');
    await until(() => host.S.online.phase === 'lobby' && host.S.online.players[0]);
    const lh = host.html();
    ok(/Online game/.test(lh) && new RegExp(host.S.online.display).test(lh) && /[A-Z0-9]{3}-[A-Z0-9]{3}/.test(lh), 'the host sees the join code, big');
    ok(/Waiting for a player/.test(lh) && /Ann \(you\), host/.test(lh), 'with the player list: themselves, and an empty seat');
    ok(!/Copy code/.test(lh) && !/copyCode/.test(lh) && /class=\"code-big\"/.test(lh), 'the code is shown, large, with no Copy code button (the link is the thing to send)');
    ok(/node|address/.test(lh) && host.S.online.addresses.length > 0 && host.S.online.addresses.every(a => /:\d+$/.test(a)) && lh.includes(host.S.online.addresses[0]), 'and the addresses the other player can use: ' + host.S.online.addresses.join(', '));
    ok(/data-action="startOnline"[^>]*disabled/.test(lh), 'Start is disabled until someone joins');
    ok(!/<select|<input|<textarea|<option/.test(lh) && !/toggleNetHints|onlineSettings/.test(lh), 'the lobby has no inputs: the game was set up on the Host screen, and now the host is only waiting for players');
    ok(/One round, 8 tiles each\. Hints are allowed\./.test(lh), '...it just says how the game was set up');
    ok(!/Start game<\/button>/.test(lh) || /Waiting for a player/.test(lh), '(the button reads "Waiting for a player...")');
    const code = host.S.online.code;
    guest.dispatch({ type: 'openJoin' });
    guest.dispatch({ type: 'joinGame', server: `127.0.0.1:${A.port}`, name: 'Ben', code: host.S.online.display.toLowerCase().replace('-', ' - ') });
    await until(() => guest.S.online && guest.S.online.phase === 'lobby' && guest.S.online.players[1]);
    await until(() => host.S.online.canStart);
    const gh = guest.html();
    ok(/Ben \(you\)/.test(gh) && /Ann, host/.test(gh) && !/data-action="startOnline"/.test(gh), 'the guest sees both players, and has no Start button');
    ok(/Ann will start the game/.test(gh) && /One round, 8 tiles each/.test(gh) && !/<select|<input/.test(gh), 'and who will start it, and how the game was set up (and nothing to change)');
    ok(/data-action="startOnline" data-primary="1">Start game/.test(host.html()) && !/startOnline[^>]*disabled/.test(host.html()), 'the host\'s Start button is now live');
    ok(!host.S.overlay && !guest.S.overlay, '(the Host and Join screens closed by themselves)');
    guest.dispatch({ type: 'onlineSettings', rounds: 13, hand: 15 }); await wait(80);
    ok(guest.S.online.settings.rounds === 1 && !guest.sent.some(m => m.t === 'settings'), 'there is nothing a guest can change (and the page does not send settings)');
    // the session is saved for coming back
    const sv = JSON.parse(host.store['mt-online']);
    ok(sv.code === code && /^[0-9a-f]{32}$/.test(sv.token) && sv.seat === 0 && sv.server === `127.0.0.1:${A.port}` && sv.name === 'Ann', 'the host\'s seat is remembered in the browser (code, token, seat, address), so a reload can rejoin');
    ok(host.store['mt-name'] === 'Ann' && host.store['mt-server'] === `127.0.0.1:${A.port}`, 'as are the name and address for next time');
  }

  /* ================================================================== */
  console.log('4. a whole game through the screens');
  {
    host.dispatch({ type: 'startOnline' });
    await until(() => inGame(host) && inGame(guest));
    ok(inGame(host) && inGame(guest), 'the host presses Start: both are in the game');
    const hh = host.html(), gh = guest.html();
    ok(/Online game/.test(hh) && !/Online game [A-Z0-9]{3}-[A-Z0-9]{3}/.test(hh) && /Double-12 online/.test(hh) && !/Computer:/.test(hh) && !/against the computer/.test(hh), 'the header says it is an online game, without the join code, and not "against the computer"');
    ok(/Leave game/.test(hh) && !/data-action="newGame"/.test(hh), 'there is a Leave game button instead of New game');
    ok(/Say something/.test(hh) && !/Comments: /.test(hh) && !/class="tag tag-/.test(hh), 'quick phrases replace the computer\'s Comments toggle, and there is no skill-level tag');
    ok(/<span class="who">Ben<\/span>/.test(hh) && /<span class="who">Ann<\/span>/.test(gh), 'each sees the other\'s name where the computer\'s used to be');
    ok(/net-dot up/.test(hh), 'with a green connected light');
    ok(!/CPU/.test(hh + gh), 'and nothing in either screen says "CPU"');
    const rr = [mulberry32(7), mulberry32(8)];
    const done = await playBoth([host, guest], rr, 45000);
    ok(done, 'both players play with taps, drops, the longest-train button, take-backs, draws and OK: the match reaches the final score on both screens');
    const th = host.S.modal.totals, tg = guest.S.modal.totals;
    ok(th.human === tg.cpu && th.cpu === tg.human, 'both show the same scores, each from their own side (' + th.human + ' to ' + th.cpu + ')');
    const fh = host.html(), fg = guest.html();
    const hostWon = th.human < th.cpu, tie = th.human === th.cpu;
    ok(tie ? /A tie/.test(fh) && /A tie/.test(fg) : hostWon ? /You win/.test(fh) && /Ann wins/.test(fg) : /Ben wins/.test(fh) && /You win/.test(fg), 'the final dialog names the winner from each side: "You win" for one, "<name> wins" for the other');
    ok(/You played Ben online\./.test(fh) && /You played Ann online\./.test(fg) && /Back to the menu/.test(fh), 'it says they played online, and offers a way back to the menu');
    ok(!/against the computer|on Medium|on Easy|on Hard/.test(fh + fg), 'and does not mention a computer level');
    {
      const code = host.S.online.code;
      const expectHost = turnsOf(A.srv, code, 0), expectGuest = turnsOf(A.srv, code, 1);
      ok(expectHost + expectGuest >= 4, `(the engine started ${expectHost} turns for Ann and ${expectGuest} for Ben)`);
      ok(host.turns === expectHost && guest.turns === expectGuest, `each page played the low turn sound exactly once for each turn the engine started for its player (pages ${host.turns} and ${guest.turns}; engine ${expectHost} and ${expectGuest})`);
    }
    const plays = c => c.sent.filter(m => m.t === 'i' && m.a === 'play').length;
    ok(plays(host) + plays(guest) >= 4, `${plays(host)} and ${plays(guest)} plays were sent`);
    ok(host.sent.every(m => m.t !== 'i' || (m.id > 0 && ['play', 'undo', 'draw', 'done', 'autoBuild', 'ok'].includes(m.a))), 'every message the page sent was a well-formed intent');
    // every redraw: no secret
    const leaky = cs => cs.some(c => c.S.game && (!c.S.game.players[1].hand.every(t => t[0] < 0) || !c.S.game.boneyard.every(t => t[0] < 0)));
    ok(!leaky([host, guest]), 'the opponent\'s hand and the boneyard in the page\'s state are only placeholders');
  }
  {
    // flights and sounds: one per tile that moved, for both players
    const c = host;
    const playEv = c.sent.length;                              // (the recorders below are per client)
    const hostPlayFlights = host.flights.filter(f => f[0] === 'play').length, guestPlayFlights = guest.flights.filter(f => f[0] === 'play').length;
    const sA = host.S.online, sB = guest.S.online;
    if (hostPlayFlights !== guestPlayFlights) {
      const show = f => f.filter(x => x[0] === 'play').map(x => `${x[1].playerId}:${x[1].trainId}#${x[1].index}${x[1].hidden ? 'h' : ''}`).join(' ');
      console.log('   DIAG host :', show(host.flights)); console.log('   DIAG guest:', show(guest.flights));
    }
    ok(hostPlayFlights >= 6 && Math.abs(hostPlayFlights - guestPlayFlights) === 0, `both screens animated the same ${hostPlayFlights} tile placements (every tile either player put down)`);
    ok(host.clacks === hostPlayFlights && guest.clacks === guestPlayFlights, 'and clicked once for each, including the opponent\'s');
    const drawsH = host.flights.filter(f => f[0] === 'draw').length, drawsG = guest.flights.filter(f => f[0] === 'draw').length;
    ok(drawsH === drawsG && drawsH > 0, `and drawn tiles flew from the boneyard (${drawsH} draws, seen by both)`);
    ok(host.flights.filter(f => f[0] === 'play' && f[1].playerId === 'cpu').every(f => f[1].placed[0] < 0 ? f[1].hidden : true), 'a tile the opponent lays in the opening flies face down, with no number in it');
    const oppFlights = host.flights.concat(guest.flights).filter(f => f[0] === 'play' && f[1].playerId === 'cpu');
    ok(oppFlights.every(f => f[1].hidden === (f[1].placed[0] < 0)), 'a flight is face down exactly when its numbers are withheld (the rigged-deal section below checks that the opening ones really are)');
    host.dispatch({ type: 'onlineBack' }); guest.dispatch({ type: 'onlineBack' });
    ok(host.S.online === null && guest.S.online === null && /data-action="startGame"/.test(host.html()), 'Back to the menu returns to the start screen on both');
    ok(host.store['mt-online'] === '' && guest.store['mt-online'] === '', 'and forgets the finished game, so a reload does not try to rejoin it');
  }

  /* ================================================================== */
  console.log('5. using every tile on the first train, through the screens (rigged deal)');
  {
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
    const { host: a, guest: b } = await lobby(R.srv, R.port, { rounds: 1, hand: 15 });
    a.dispatch({ type: 'startOnline' });
    await until(() => inGame(a) && inGame(b) && a.S.awaiting && a.S.awaiting.kind === 'build');
    ok(a.S.awaiting.canBuild && a.S.awaiting.buildCount === 15 && /Build my longest train \(15 tiles\)/.test(a.html()), 'Ann is dealt a complete train: the screen offers "Build my longest train (15 tiles)"');
    ok(/Everyone builds their train at the same time/.test(a.html()), 'with the opening instructions');
    a.dispatch({ type: 'autoBuild' });
    ok(a.S.online.pending !== null && a.sent.filter(m => m.a === 'autoBuild').length === 1, 'one tap sends one request');
    a.dispatch({ type: 'autoBuild' }); a.dispatch({ type: 'autoBuild' });
    ok(a.sent.filter(m => m.a === 'autoBuild').length === 1, 'tapping it again while waiting for the server sends nothing more (no double plays)');
    await until(() => a.S.game.players[0].hand.length === 0 && a.S.game.trains.human.tiles.length === 15 && !a.S.online.pending, 6000);
    ok(a.S.game.players[0].hand.length === 0 && a.S.game.trains.human.tiles.length === 15, 'all 15 tiles are on her train');
    ok(allScreens([b]).some(h => /Building, tiles face down/.test(h)), 'Ben watched her train go down face down (he could not see which tiles)');
    ok(allScreens([b]).some(h => /tile v back/.test(h)), '...with the doubles standing across the train');
    ok(!a.sent.some(m => m.a === 'done'), 'Ann never pressed Done: when the longest train was down, the game finished her opening for her');
    await until(() => !a.S.awaiting || a.S.awaiting.kind !== 'build', 4000);
    ok(!/Building, tiles face down/.test(b.html()) && b.S.game.trains.cpu.tiles.length === 15 && b.S.game.trains.cpu.tiles.every(t => t[0] >= 0), 'and then Ben sees her 15 tiles turned face up');
    await until(() => a.S.awaiting && a.S.awaiting.kind === 'build' || b.S.awaiting, 3000);
    for (let i = 0; i < 40 && !(a.S.modal && b.S.modal); i++) { if (b.S.awaiting && !b.S.online.pending) { const q = b.S.awaiting; if (q.kind === 'build') b.dispatch({ type: q.canDraw ? 'draw' : q.canDone ? 'endBuild' : 'undoTile' }); else if (q.kind === 'draw') b.dispatch({ type: 'draw' }); } await wait(15); }
    await until(() => a.S.modal && b.S.modal, 4000);
    ok(a.S.modal && a.S.modal.type === 'roundEnd' && /You went out first/.test(a.html()), 'Ann: "You went out first"');
    ok(b.S.modal && /Ann went out first/.test(b.html()), 'Ben: "Ann went out first"');
    ok(a.S.modal.rows[0].pips === 0 && a.S.totals.human === 0 && a.S.totals.cpu === b.S.totals.human && b.S.totals.human > 0, 'Ann scores 0; Ben is left with his points, the same number on both screens (' + b.S.totals.human + ')');
    ok(/See final score/.test(a.html()), 'a one-round game: the button says "See final score"');
    a.dispatch({ type: 'dialogOk' });
    await until(() => a.S.modal && a.S.modal.type === 'final');
    ok(a.S.modal && a.S.modal.type === 'final' && /You win/.test(a.html()) && !/Waiting for/.test(a.html()), 'Ann presses the button and gets the final score at once: she does not wait for Ben');
    ok(b.S.modal && b.S.modal.type === 'roundEnd' && /Ann went out first/.test(b.html()), '...while Ben, who has not pressed it yet, still has the round-end dialog');
    b.dispatch({ type: 'dialogOk' });
    await until(() => b.S.modal && b.S.modal.type === 'final');
    ok(a.S.modal.type === 'final' && /Ann wins/.test(b.html()), 'then Ben presses it and gets the final score too: "You win" for Ann and "Ann wins" for Ben');
    a.dispatch({ type: 'onlineBack' }); b.dispatch({ type: 'onlineBack' });
    await R.srv.close();
  }

  /* ================================================================== */
  console.log('6. quick phrases');
  const C = await startServer({});
  {
    const { host: a, guest: b } = await lobby(C.srv, C.port, { rounds: 1, hand: 8 });
    a.dispatch({ type: 'startOnline' }); await until(() => inGame(a) && inGame(b));
    ok(!/class="say-panel"/.test(a.html()), 'the phrase panel starts closed');
    a.dispatch({ type: 'toggleSay' });
    const panel = a.html();
    ok(/class="say-panel"/.test(panel) && G.ONLINE_PHRASES.every(p => panel.includes(`>${p.replace(/'/g, '&#39;')}</button>`) || panel.includes(`>${p}</button>`)), 'Say something opens the panel with every phrase as a button');
    a.dispatch({ type: 'sendChat', key: '0' });
    await until(() => b.S.comment);
    ok(b.S.comment.text === G.ONLINE_PHRASES[0] && b.S.comment.kind === 'chat', 'the phrase appears on the other screen');
    ok(new RegExp(`<div class="bubble"><b>Ann</b><span>${G.ONLINE_PHRASES[0]}</span></div>`).test(b.html()), 'in a speech bubble with the sender\'s name');
    ok(/You said: Nice play!/.test(a.html()) && !/class="say-panel"/.test(a.html()), 'the sender sees "You said...", and the panel closes');
    a.dispatch({ type: 'toggleSay' }); a.dispatch({ type: 'sendChat', key: '1' });
    await until(() => a.S.banner && /Not so fast/.test(a.S.banner), 2000);
    ok(/Not so fast/.test(a.S.banner), 'sending again at once is turned down by the server, and the player is told');
    a.dispatch({ type: 'sendChat', key: '99' }); a.dispatch({ type: 'sendChat', key: 'x' }); a.dispatch({ type: 'sendChat', key: '-1' }); a.dispatch({ type: 'sendChat', key: '1.5' });
    ok(a.sent.filter(m => m.t === 'chat').length === 2, 'phrase numbers that do not exist are never sent');
    b.dispatch({ type: 'sendChat', key: String(G.ONLINE_PHRASES.length - 1) });
    await until(() => a.S.comment);
    ok(a.S.comment.text === G.ONLINE_PHRASES[G.ONLINE_PHRASES.length - 1], 'and it works the other way');
    a.dispatch({ type: 'onlineBack' }); b.dispatch({ type: 'onlineBack' });
  }

  /* ================================================================== */
  console.log('7. a dropped connection and coming back');
  {
    const { host: a, guest: b } = await lobby(C.srv, C.port, { rounds: 4, hand: 15 });      // long enough to still be going when the connection drops
    a.dispatch({ type: 'startOnline' }); await until(() => inGame(a) && inGame(b));
    // some play, then Ben's connection is cut by the network (the server end drops it)
    const rr = [mulberry32(21), mulberry32(22)];
    for (let i = 0; i < 40; i++) { actions(a, rr[0]); actions(b, rr[1]); await wait(8); }
    const handBefore = b.S.game.players[0].hand.map(key).sort().join();
    const room = C.srv.rooms.get(a.S.online.code);
    room.players[1].conn.ws.terminate();
    await until(() => b.S.online.conn !== 'open', 2000);
    ok(/Connection lost/.test(b.html()) && /Trying to reconnect/.test(b.html()) && /Leave game/.test(b.html()), 'Ben\'s screen says the connection was lost and that it is trying to reconnect');
    await until(() => a.S.online.oppConnected === false, 2000);
    const pa = a.html();
    ok(/Game paused/.test(pa) && /Ben lost the connection/.test(pa) && /\d:\d\d<\/b> left/.test(pa), 'Ann\'s screen says the game is paused, who dropped, and how long they have (a countdown)');
    const t1 = (pa.match(/<b>(\d:\d\d)<\/b> left/) || [])[1];
    ok(/^(2:5\d|3:00)$/.test(t1), 'it starts at about 3 minutes (' + t1 + ')');
    ok(!a.sent.some(m => m.t === 'i' && m.id > 1000), '(Ann is not offered anything to do while it is paused)');
    await until(() => b.S.online.conn === 'open' && b.S.online.phase === 'playing' && !/Connection lost|Rejoining/.test(b.html()), 6000);
    ok(b.S.online.conn === 'open' && !/Connection lost/.test(b.html()), 'after a second or so Ben\'s page reconnects by itself');
    ok(b.S.game.players[0].hand.map(key).sort().join() === handBefore, 'and he is back in the same game with exactly the same hand');
    await until(() => a.S.online.oppConnected === true, 3000);
    ok(a.S.online.oppConnected === true && !/Game paused/.test(a.html()), 'Ann\'s pause screen disappears');
    const finished = await playBoth([a, b], rr, 40000);
    ok(finished, 'and the game is played to the end');
    a.dispatch({ type: 'onlineBack' }); b.dispatch({ type: 'onlineBack' });
  }
  {
    // coming back when the connection to the server cannot be made for a while
    const flaky = { allow: true };
    const down = () => { const s = { readyState: 3, send() {}, close() {} }; setTimeout(() => { if (s.onclose) s.onclose(); }, 5); return s; };   // a connection that never opens
    const a = makeClient(C.port), b = makeClient(C.port, { factory: (url, Real) => (flaky.allow ? new Real(url) : down()) });
    await hostInfoReady(a);
    await hostInfoReady(a); a.dispatch({ type: 'hostGame', server: `127.0.0.1:${C.port}`, name: 'Ann', rounds: 1, hand: 8 }); await until(() => a.S.online.display);
    b.dispatch({ type: 'joinGame', server: `127.0.0.1:${C.port}`, name: 'Ben', code: a.S.online.display }); await until(() => b.S.online.phase === 'lobby');
    await until(() => a.S.online.canStart); a.dispatch({ type: 'startOnline' }); await until(() => inGame(a) && inGame(b));
    flaky.allow = false;                                        // the network is down for Ben: the server stays reachable for Ann
    const room = C.srv.rooms.get(a.S.online.code);
    room.players[1].conn.ws.terminate();
    await until(() => b.S.online.conn === 'reconnecting', 2000);
    await wait(2600);
    ok(b.S.online.conn === 'reconnecting' && /Trying to reconnect/.test(b.html()), 'while the network stays down he keeps trying (it does not give up or show an error page)');
    ok(a.S.online.oppConnected === false && /Game paused/.test(a.html()), 'and Ann keeps waiting');
    flaky.allow = true;
    await until(() => b.S.online.conn === 'open' && b.S.online.oppConnected !== false && inGame(b), 8000);
    ok(inGame(b) && b.S.online.conn === 'open', 'when the network is back he is back in the game');
    b.dispatch({ type: 'confirmLeave' });
    const e = await until(() => a.S.online && a.S.online.ended, 3000);
    ok(e && a.S.online.ended.reason === 'left', 'Ben leaving ends it for Ann');
    a.dispatch({ type: 'onlineBack' });
  }

  /* ================================================================== */
  console.log('8. giving up: the three minutes run out');
  {
    const T = await startServer({ graceMs: 900 });
    let tries = 0;
    const b_factory = (url, Real) => { tries++; if (tries === 1) return new Real(url); const s = { readyState: 3, send() {}, close() {} }; setTimeout(() => { if (s.onclose) s.onclose(); }, 5); return s; };   // the first connection is real; every later one fails
    const a = makeClient(T.port), b = makeClient(T.port, { factory: b_factory });
    await hostInfoReady(a);
    await hostInfoReady(a); a.dispatch({ type: 'hostGame', server: `127.0.0.1:${T.port}`, name: 'Ann', rounds: 1, hand: 8 }); await until(() => a.S.online.display);
    b.dispatch({ type: 'joinGame', server: `127.0.0.1:${T.port}`, name: 'Ben', code: a.S.online.display }); await until(() => b.S.online.phase === 'lobby');
    await until(() => a.S.online.canStart); a.dispatch({ type: 'startOnline' }); await until(() => inGame(a) && inGame(b));
    T.srv.rooms.get(a.S.online.code).players[1].conn.ws.terminate();
    await until(() => a.S.online.ended, 4000);
    const ha = a.html();
    ok(a.S.online.ended && a.S.online.ended.reason === 'timeout' && /Game over/.test(ha) && /Ben did not come back in time/.test(ha), 'Ann is told the game is over and why: "Ben did not come back in time"');
    ok(/Back to the menu/.test(ha) && a.store['mt-online'] === '', 'with a way back, and the saved game is forgotten');
    a.dispatch({ type: 'onlineBack' });
    ok(a.S.online === null && /data-action="startGame"/.test(a.html()), 'back at the start screen');
    b.dispatch({ type: 'confirmLeave' });
    await T.srv.close();
  }

  /* ================================================================== */
  console.log('9. leaving, and rejoining after a page reload');
  {
    const { host: a, guest: b } = await lobby(C.srv, C.port, { rounds: 4, hand: 15 });     // a long game: it must still be going when the page is reloaded
    a.dispatch({ type: 'startOnline' }); await until(() => inGame(a) && inGame(b));
    a.dispatch({ type: 'askLeave' });
    ok(/Leave the game\?/.test(a.html()) && /ends the game for both players/.test(a.html()) && /Keep playing/.test(a.html()), 'Leave game first asks, and says what it does');
    a.dispatch({ type: 'closeOverlay' });
    ok(a.S.online && !/Leave the game\?/.test(a.html()), '"Keep playing" closes it and nothing happens');
    // a reload: a brand new page with the same saved session
    const saved = JSON.parse(b.store['mt-online']);
    const rr = [mulberry32(31), mulberry32(32)];
    for (let i = 0; i < 25; i++) { actions(a, rr[0]); actions(b, rr[1]); await wait(8); }
    await until(() => !a.S.online.pending && !b.S.online.pending, 2000); await wait(150);       // let every move in flight reach the server and come back
    ok(!(b.S.modal && b.S.modal.type === 'final'), '(the long game is still going)');
    const handBefore = b.S.game.players[0].hand.map(key).sort().join(), tilesOnBoard = b.S.game.trains.human.tiles.length;
    const b2 = makeClient(C.port, { store: { 'mt-online': JSON.stringify(saved) } });
    b2.dispatch({ type: 'resumeOnline' });
    ok(b2.S.online && b2.S.online.phase === 'resuming' && /Rejoining your game|Connection lost|Connecting/.test(b2.html()), 'a reloaded page starts rejoining at once, and says so');
    await until(() => inGame(b2) && b2.S.online.conn === 'open', 4000);
    await until(() => b.S.online && b.S.online.ended, 3000);
    ok(b.S.online.ended && b.S.online.ended.reason === 'replaced' && /opened in another window/.test(b.html()) && /Opened somewhere else/.test(b.html()), 'the old window is told the game was opened elsewhere, and stops (it does not reconnect and steal the seat back)');
    await wait(1500);
    ok(inGame(b2) && b2.S.online.conn === 'open' && !b2.S.online.ended, 'the new window keeps the game (checked after the old one\'s reconnect time has passed)');
    ok(b.store['mt-online'] !== '', '(and the shared saved game was not wiped by the old window closing)');
    ok(inGame(b2) && b2.S.game.players[0].hand.map(key).sort().join() === handBefore && b2.S.game.trains.human.tiles.length === tilesOnBoard, 'and lands in the same game with the same hand and the same train');
    ok(b2.S.cpuName === 'Ann' && /<span class="who">Ann<\/span>/.test(b2.html()), 'against the same opponent');
    b.dispatch({ type: 'onlineBack' });                                   // the old page is gone
    const finished = await playBoth([a, b2], rr, 40000);
    ok(finished, 'the game goes on to the end on the new page');
    // a saved game that no longer exists
    const stale = makeClient(C.port, { store: { 'mt-online': JSON.stringify({ server: `127.0.0.1:${C.port}`, code: 'ABCDEF', token: 'a'.repeat(32), seat: 1, name: 'Old' }) } });
    stale.dispatch({ type: 'resumeOnline' });
    await until(() => stale.S.online === null, 3000);
    ok(stale.S.online === null && stale.store['mt-online'] === '' && /data-action="startGame"/.test(stale.html()), 'a saved game the server no longer has is forgotten quietly: the player just sees the start screen');
    [a, b2].forEach(x => x.dispatch({ type: 'onlineBack' }));
  }
  {
    const { host: a, guest: b } = await lobby(C.srv, C.port, { rounds: 1, hand: 8 });
    a.dispatch({ type: 'startOnline' }); await until(() => inGame(a) && inGame(b));
    a.dispatch({ type: 'askLeave' }); a.dispatch({ type: 'confirmLeave' });
    ok(a.S.online === null && /data-action="startGame"/.test(a.html()) && a.store['mt-online'] === '', 'leaving returns to the start screen and forgets the game');
    await until(() => b.S.online && b.S.online.ended, 3000);
    ok(b.S.online.ended.reason === 'left' && /The game was left/.test(b.html()) && /Ann left the game/.test(b.html()), 'the other player is told: "The game was left... Ann left the game."');
    b.dispatch({ type: 'onlineBack' });
    // and the single-player game still works afterwards
    a.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    await until(() => a.S.awaiting, 3000);
    ok(a.S.online === null && a.S.game && /Computer: Easy/.test(a.html()) && /Comments: /.test(a.html()) && /against the computer/.test(a.html()), 'a game against the computer works as before, with no online leftovers on screen');
    a.dispatch({ type: 'newGame' });
  }
  {
    // starting a computer game while connected ends the online one
    const { host: a, guest: b } = await lobby(C.srv, C.port, { rounds: 1, hand: 8 });
    a.dispatch({ type: 'startOnline' }); await until(() => inGame(a) && inGame(b));
    a.dispatch({ type: 'newGame' });
    a.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    ok(a.S.online === null, 'starting a game against the computer leaves the online game');
    b.dispatch({ type: 'onlineBack' });
    a.dispatch({ type: 'newGame' });
  }

  /* ================================================================== */
  console.log('10. a hostile or broken server cannot hurt the page');
  {
    // a stand-in server that sends whatever we tell it to
    const sent = [];
    class FakeWS {
      constructor(url) { this.url = url; this.readyState = 0; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); }
      send(d) { sent.push(JSON.parse(d)); }
      close() { this.readyState = 3; }
      say(o) { this.onmessage && this.onmessage({ data: typeof o === 'string' ? o : JSON.stringify(o) }); }
    }
    const c = makeClient(1, { WebSocket: FakeWS, fetch: infoStub('fake:1') });
    await hostInfoReady(c); c.dispatch({ type: 'hostGame', server: 'fake:1', name: 'Me', rounds: 4, hand: 15 });
    await until(() => sent.some(m => m.t === 'create'));
    const f = FakeWS.last;
    const XSS = '<img src=x onerror=alert(1)><script>alert(2)</script>"\'&';
    const survived = fn => { try { fn(); return true; } catch (e) { console.log('   threw:', e.message); return false; } };
    ok(survived(() => { f.say({ t: 'hello' }); f.say('this is not json'); f.say('[1,2,3]'); f.say('null'); f.say('{"t":42}'); f.say({}); f.say({ t: 'state' }); f.say({ t: 'state', seq: 1 }); f.say({ t: 'lobby', players: 5 }); f.say({ t: 'ack' }); }), 'garbage of every kind is ignored without an exception');
    f.say({ t: 'created', code: 'ABCDEF', display: XSS, token: 'tok', seat: 0, settings: { rounds: 4, hand: 15 }, addresses: [XSS, '1.2.3.4:80'] });
    f.say({ t: 'lobby', code: 'ABCDEF', seat: 0, settings: { rounds: 4, hand: 15 }, players: [{ name: XSS, connected: true }, { name: XSS + 'b', connected: true }], canStart: true, addresses: [XSS], state: 'lobby' });
    let h = c.html();
    ok(c.S.online.phase === 'lobby' && !hostile.test(h.replace(/<(?:div|span|button|ul|li|p|b|h2|i|code|label|select|option|svg|rect|path)\b[^>]*>|<\/(?:div|span|button|ul|li|p|b|h2|i|code|label|select|option|svg)>/g, '')), 'markup in the join code, the player names and the address list is shown as text, never run');
    ok(!/<img src=x|<script>alert/.test(h) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(h), '(it appears escaped: &lt;img ...)');
    ok(/<svg class="qr"/.test(h) && /data-action="copyLink" data-key="http:\/\/&lt;img/.test(h), 'a hostile address inside the join link and its Copy button is escaped as well, and the QR code is still drawn');
    const view = (extra) => Object.assign({
      seq: 5, round: 0, rounds: 1, me: { name: 'Me' }, opp: { name: XSS }, totals: { human: 0, cpu: 0 }, paused: false, over: null,
      log: [XSS, 'Ben\'s train'], banner: XSS, modal: null, awaiting: null,
      game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [[1, 2]] }, { id: 'cpu', name: XSS, hand: [[-1, -1], [-1, -1]] }], boneyard: [[-1, -1]],
        trains: { human: { id: 'human', marker: false, tiles: [], end: 12 }, cpu: { id: 'cpu', marker: false, tiles: [], end: 12 }, mexican: { id: 'mexican', marker: false, tiles: [], end: 12 } }, openDouble: null, opening: null },
    }, extra);
    f.say({ t: 'state', seq: 5, view: view(), events: [] });
    h = c.html();
    ok(inGame(c) && !/<img src=x|<script>alert/.test(h) && /&lt;img/.test(h), 'a game state with markup in the opponent\'s name, the log and the banner: all shown as text');
    ok(/Ben&#39;s train/.test(h), '(an apostrophe in a log line survives, as text)');
    f.say({ t: 'state', seq: 6, view: view({ modal: { type: 'roundEnd', blocked: false, tie: false, winnerId: 'human', rows: [{ id: 'human', name: XSS, hand: [[1, 2]], pips: 3 }, { id: 'cpu', name: XSS, hand: [[3, 4]], pips: 7 }], totals: { human: 3, cpu: 7 }, last: true } }), events: [] });
    h = c.html();
    ok(!/<img src=x|<script>alert/.test(h) && /You went out first/.test(h), 'the round-end dialog with hostile names in its rows: escaped too');
    f.say({ t: 'chat', id: 0, text: XSS });
    ok(c.S.comment && !/<img src=x|<script>alert/.test(c.html()) && /&lt;script&gt;/.test(c.html()), 'a chat message with markup is shown as text (and cut to 60 characters)');
    f.say({ t: 'state', seq: 2, view: view({ banner: 'OLD' }), events: [] });
    ok(!/OLD/.test(c.html()), 'a state older than one already seen is ignored (the order of events cannot go backwards)');
    ok(survived(() => f.say({ t: 'state', seq: 9, view: { game: { engine: 12, players: [{ hand: [] }, { hand: [] }], trains: {}, boneyard: [] } }, events: [{ e: 'play' }, { e: 'draw' }, null] })), 'a state with missing pieces does not crash the page');
    f.say({ t: 'ended', reason: 'x', message: XSS });
    h = c.html();
    ok(/Game closed/.test(h) && !/<img src=x|<script>alert/.test(h) && /&lt;img/.test(h), 'an "ended" message with markup: shown as text');
    ok(/Back to the menu/.test(h), '...with the way out');
    c.dispatch({ type: 'onlineBack' });
    ok(c.S.online === null, 'and the page recovers');
    // the page never sends a name it did not clean, nor a made-up message
    const c2 = makeClient(1, { WebSocket: FakeWS, fetch: infoStub('fake:2') });
    await hostInfoReady(c2); c2.dispatch({ type: 'hostGame', server: 'fake:2', name: XSS, rounds: '4', hand: '15' });
    await until(() => sent.filter(m => m.t === 'create').length === 2);
    const created = sent.filter(m => m.t === 'create').pop();
    ok(created.name === G.cleanPlayerName(XSS) && !/[<>"&]/.test(created.name) && created.rounds === 4 && created.hand === 15, 'the name the page sends is already cleaned, and the numbers are numbers');
    c2.dispatch({ type: 'onlineBack' });
  }

  await C.srv.close(); await A.srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
