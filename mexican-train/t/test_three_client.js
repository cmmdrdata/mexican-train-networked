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

(async () => {
  const A = await startServer({});

  console.log('1. asking for a computer player');
  let host, guest;
  {
    const c = makeClient(A.port);
    c.dispatch({ type: 'openHost' });
    const h = c.html();
    ok(/id="net-computer"/.test(h) && /<option value="none" selected>None<\/option>/.test(h) && /Add a Hard computer as a third player/.test(h) && /all three are at the table from the start/.test(h), 'the Host screen offers a Computer player: none (the default), Easy, Medium or Hard');
    c.dispatch({ type: 'closeOverlay' });
    host = makeClient(A.port); guest = makeClient(A.port);
    host.dispatch({ type: 'openHost' });
    await hostInfoReady(host); host.dispatch({ type: 'hostGame', server: `127.0.0.1:${A.port}`, name: 'Ann', rounds: 1, hand: 8, computer: 'normal' });
    await until(() => host.S.online.phase === 'lobby' && host.S.online.players[0]);
    let lh = host.html();
    ok(host.S.online.settings.computer === 'normal' && /with a Medium computer player/.test(lh) && !/<select|<option|<input/.test(lh), 'the lobby has no inputs, and says the host\'s choice: a Medium computer player');
    const comp = host.S.online.players[2];
    ok(comp && comp.computer === true && comp.level === 'normal' && G.levelOfName(comp.name.replace(/&#39;/g, "'")) === 'normal', 'the lobby lists a third player: the computer, with a name from the Medium computer players (' + (comp && comp.name) + ')');
    ok(new RegExp(`${comp.name}, computer, Medium`).test(lh) && /Waiting for a player/.test(lh), 'shown as "Name, computer, Medium", next to "Waiting for a player..." for the empty human seat');
    ok(/data-action="startOnline"[^>]*disabled/.test(lh), 'Start waits for the second person (the computer is already there)');
    guest.dispatch({ type: 'openJoin' });
    guest.dispatch({ type: 'joinGame', server: `127.0.0.1:${A.port}`, name: 'Ben', code: host.S.online.display });
    await until(() => guest.S.online && guest.S.online.phase === 'lobby' && guest.S.online.players[1]);
    await until(() => host.S.online.canStart);
    const gh = guest.html();
    ok(/with a Medium computer player/.test(gh) && new RegExp(`${comp.name}, computer, Medium`).test(gh) && /Ben \(you\)/.test(gh), 'the guest\'s lobby says there is a Medium computer player, and lists it');
  }

  console.log('2. three at the table');
  {
    host.dispatch({ type: 'startOnline' });
    await until(() => inGame(host) && inGame(guest));
    ok(inGame(host) && inGame(guest) && host.S.game.players.length === 3 && guest.S.game.players.length === 3, 'Start puts all three players in the game at once');
    const hh = host.html(), gh = guest.html();
    const rows = html => (html.match(/<div class="cpu-hand[^"]*" data-player="(cpu2?)"/g) || []).map(x => x.match(/data-player="(\w+)"/)[1]);
    ok(rows(hh).join() === 'cpu,cpu2' && rows(gh).join() === 'cpu,cpu2', 'each screen has a row for each of the two opponents');
    ok(/class="opp three"/.test(hh) && (hh.match(/class="boneyard/g) || []).length === 1, 'in a layout for three, with a single boneyard');
    ok((hh.match(/data-train="(human|cpu|cpu2|mexican)"/g) || []).filter((x, i, a) => a.indexOf(x) === i).length === 4, 'and four trains: yours, one for each opponent, and the Mexican train');
    const names = html => (html.match(/<span class="who">([^<]*)<\/span>/g) || []).map(x => x.replace(/<[^>]+>/g, ''));
    ok(names(hh).length === 2 && names(hh)[0] === 'Ben' && names(hh)[1] === host.S.cpu2Name, 'Ann sees Ben first, then the computer: ' + names(hh).join(' and '));
    ok(names(gh)[0] === host.S.cpu2Name && names(gh)[1] === 'Ann', 'Ben sees the computer first, then Ann (the order is the table order after himself)');
    ok(/tag tag-normal/.test(hh) && /tag tag-normal/.test(gh) && (hh.match(/net-dot/g) || []).length === 1, 'the computer opponent carries its level tag; the person carries the connection light');
    ok(/<div class="tot"><b>0<\/b><span>You<\/span><\/div>/.test(hh) && (hh.match(/class="tot"/g) || []).length === 3, 'the header shows three scores');
    ok(!/CPU/.test(hh + gh) && /Say something/.test(hh), 'nothing says "CPU", and Say something is still there');
    ok(/Waiting for|Everyone builds/.test(hh), '(and the opening prompt is on screen)');
  }

  console.log('3. a whole game of three');
  {
    const code = host.S.online.code;
    const rr = [mulberry32(7), mulberry32(8)];
    const done = await playBoth([host, guest], rr, 60000);
    ok(done, 'two people play through the screens against the computer: the match reaches the final score on both screens');
    const th = host.S.modal.totals, tg = guest.S.modal.totals;
    ok(th.human === tg.cpu2 && th.cpu === tg.human && th.cpu2 === tg.cpu, `the three scores agree, each under the right name on each screen (Ann ${th.human}, Ben ${th.cpu}, ${host.S.cpu2Name} ${th.cpu2})`);
    const fh = host.html(), fg = guest.html();
    ok((fh.match(/class="tot"><b>/g) || []).length >= 3 && /You played Ben and .+ online\./.test(fh) && /You played .+ and Ann online\./.test(fg), 'the final dialog lists three scores and says who you played');
    const scores = [th.human, th.cpu, th.cpu2], low = Math.min(...scores), lows = scores.filter(x => x === low).length;
    ok(lows > 1 ? /A tie/.test(fh) : (th.human === low ? /You win/.test(fh) : th.cpu === low ? /Ben wins/.test(fh) : new RegExp(host.S.cpu2Name + ' wins').test(fh)), 'and names the right winner (the lowest score)');
    const oppFlights = c => c.flights.filter(f => f[0] === 'play' && f[1].playerId !== 'human');
    {
      const placed = id => host.S.game.trains[id].tiles.length > 0;            // an opponent who never got a tile onto their own train has nothing to fly
      const from = id => oppFlights(host).some(f => f[1].playerId === id);
      ok(oppFlights(host).length > 0 && (!placed('cpu') || from('cpu')) && (!placed('cpu2') || from('cpu2')) && oppFlights(host).every(f => f[1].playerId === 'cpu' || f[1].playerId === 'cpu2'), 'tiles flew from each of the two opponents\' rows (each opponent who laid tiles on their own train)');
    }
    ok(oppFlights(host).every(f => f[1].hidden === (f[1].placed[0] < 0)) && oppFlights(guest).every(f => f[1].hidden === (f[1].placed[0] < 0)), 'and were face down exactly when their numbers were withheld');
    const plays = c => c.flights.filter(f => f[0] === 'play').length;
    ok(plays(host) === plays(guest) && host.clacks === plays(host) && guest.clacks === plays(guest), `all ${plays(host)} tile placements were animated and clicked on both screens: nobody's play was missed, the computer's included`);
    ok(host.flights.filter(f => f[0] === 'draw').length === guest.flights.filter(f => f[0] === 'draw').length, '(and every draw, by anyone, was seen by both)');
    const eh = turnsOf(A.srv, code, 0), eg = turnsOf(A.srv, code, 1);
    if (host.turns !== eh || guest.turns !== eg) {
      const seq = log.get(A.srv.rooms.get(code).match) || [];
      for (const [who, c, seat] of [['host', host, 0], ['guest', guest, 1]]) {
        const due = []; seq.forEach((e, i) => { if (e.prompt && e.seat === seat && !(i > 0 && seq[i - 1].seat === seat)) due.push({ i, at: e.seq, kind: e.kind }); });
        const missing = due.filter(d => !c.turnAt.some(a => Math.abs(a - d.at) <= 1));
        if (missing.length) missing.forEach(d => console.log(`   DIAG ${who}: no sound for the turn at broadcast ${d.at} (${d.kind}); the actors around it: ` + seq.slice(Math.max(0, d.i - 5), d.i + 3).map((e, k) => `${e.seat}${e.prompt ? 'P' : e.pass ? 'pass' : 'c'}${e.kind ? ':' + e.kind : ''}${Math.max(0, d.i - 5) + k === d.i ? '<<' : ''}`).join(' ')));
      }
    }
    if (host.turns !== eh || guest.turns !== eg) console.log('   DIAG skipped/applied  host:', host.S.online && host.S.online.skipped, host.S.online && host.S.online.skipWhy, '/', host.S.online && host.S.online.applied, ' guest:', guest.S.online && guest.S.online.skipped, guest.S.online && guest.S.online.skipWhy, '/', guest.S.online && guest.S.online.applied, ' states received by guest:', guest.statesReceived, ' host:', host.statesReceived);
    ok(host.turns === eh && guest.turns === eg, `the low turn sound played once for each turn the engine started for each person, with the computer's turns in between (${host.turns} and ${guest.turns}; engine ${eh} and ${eg})`);
    ok(host.S.cpu2Name && [...host.screens, ...guest.screens].every(h => !/<script|<img/i.test(h)), '(and no screen contained markup)');
    {
      const expected = { Ann: SEAT_COLOUR[0], Ben: SEAT_COLOUR[1], [host.S.cpu2Name]: SEAT_COLOUR[2] };
      const ch = colourCheck(host, 'Ann', expected), cg = colourCheck(guest, 'Ben', expected);
      ok(ch.bad.length === 0 && cg.bad.length === 0, 'on every screen of both players, every toy train has the colour of its owner\'s seat: Ann red, Ben blue, ' + host.S.cpu2Name + ' yellow, the same on her screen and on his' + (ch.bad[0] || cg.bad[0] ? ' (' + (ch.bad[0] || cg.bad[0]) + ')' : ''));
      ok(Object.keys(ch.seen).length + Object.keys(cg.seen).length >= 2 && Object.values(ch.seen).concat(Object.values(cg.seen)).reduce((a, b) => a + b, 0) >= 4, `(and trains really were open in this game: ${JSON.stringify(ch.seen)} on Ann's screen, ${JSON.stringify(cg.seen)} on Ben's)`);
      globalThis.__colourSeen = (globalThis.__colourSeen || 0) + Object.values(ch.seen).concat(Object.values(cg.seen)).reduce((a, b) => a + b, 0);
    }
    host.dispatch({ type: 'onlineBack' }); guest.dispatch({ type: 'onlineBack' });
  }

  console.log('4. chat names the person, not the computer');
  {
    const { host: a, guest: b } = await lobby(A.port, { rounds: 1, hand: 8 }, 'easy');
    a.dispatch({ type: 'startOnline' }); await until(() => inGame(a) && inGame(b));
    b.dispatch({ type: 'sendChat', key: '0' });
    await until(() => a.S.comment);
    ok(a.S.comment.from === 'Ben' && /<div class="bubble"><b>Ben<\/b><span>Nice play!<\/span><\/div>/.test(a.html()), 'a phrase from Ben is attributed to Ben on Ann\'s screen, although the computer is also an opponent');
    a.dispatch({ type: 'sendChat', key: '2' });
    await until(() => b.S.comment);
    ok(b.S.comment.from === 'Ann' && /<b>Ann<\/b><span>Good game!<\/span>/.test(b.html()), 'and the other way round');
    a.dispatch({ type: 'onlineBack' }); b.dispatch({ type: 'onlineBack' });
  }

  console.log('5. a dropped connection, with a computer in the game');
  {
    const { host: a, guest: b } = await lobby(A.port, { rounds: 4, hand: 15 }, 'normal');
    a.dispatch({ type: 'startOnline' }); await until(() => inGame(a) && inGame(b));
    const rr = [mulberry32(21), mulberry32(22)];
    for (let i = 0; i < 30; i++) { actions(a, rr[0]); actions(b, rr[1]); await wait(8); }
    await until(() => !a.S.online.pending && !b.S.online.pending, 2000); await wait(150);        // let every move in flight reach the server and come back, so the hand to compare with is the final one
    const handBefore = b.S.game.players[0].hand.map(key).sort().join();
    A.srv.rooms.get(a.S.online.code).players[1].conn.ws.terminate();
    await until(() => a.S.online.oppConnected === false, 3000);
    ok(/Game paused/.test(a.html()) && /Ben lost the connection/.test(a.html()), 'Ann is told that BEN lost the connection (the computer is not mistaken for the missing person)');
    await until(() => b.S.online.conn === 'open' && inGame(b) && !/Connection lost/.test(b.html()), 8000);
    ok(b.S.game.players.length === 3 && b.S.game.players[0].hand.map(key).sort().join() === handBefore && b.S.opps.length === 2, 'Ben comes back to the same three-player game with the same hand');
    await until(() => a.S.online.oppConnected === true, 3000);
    ok(a.S.online.oppConnected === true && !/Game paused/.test(a.html()), 'and the pause screen goes');
    const finished = await playBoth([a, b], rr, 60000);
    ok(finished, 'the game is played to the end');
    {
      const expected = { Ann: SEAT_COLOUR[0], Ben: SEAT_COLOUR[1], [a.S.cpu2Name]: SEAT_COLOUR[2] };
      const ca = colourCheck(a, 'Ann', expected), cb = colourCheck(b, 'Ben', expected);
      ok(ca.bad.length === 0 && cb.bad.length === 0, 'in a longer game, including Ben dropping out and rejoining on a new connection, the colours never change on either screen' + (ca.bad[0] || cb.bad[0] ? ' (' + (ca.bad[0] || cb.bad[0]) + ')' : ''));
    }
    a.dispatch({ type: 'onlineBack' }); b.dispatch({ type: 'onlineBack' });
  }

  console.log('6. a rigged first-train win against two opponents (through the screens)');
  {
    const POOL = (() => { const t = []; for (let x = 0; x <= 12; x++) for (let y = x; y <= 12; y++) if (!(x === 12 && y === 12)) t.push([x, y]); return t; })();
    const CHAIN = [[11, 12], [10, 11], [10, 10], [9, 10], [9, 9], [8, 9], [7, 8], [6, 7], [5, 6], [4, 5], [3, 4], [2, 3], [1, 2], [0, 1], [0, 3]];
    const ev = [[0, 2], [0, 4], [0, 6], [0, 8], [0, 10], [2, 4], [2, 6], [2, 8], [2, 10], [4, 6], [4, 8], [4, 10], [6, 8], [6, 10], [8, 10]];
    const od = [[1, 3], [1, 5], [1, 7], [1, 9], [1, 11], [3, 5], [3, 7], [3, 9], [3, 11], [5, 7], [5, 9], [5, 11], [7, 9], [7, 11], [9, 11]];
    const rig = () => {
      const mine = [CHAIN, ev, od].map(h => h.map(canon)), used = new Set(mine.flat().map(key)), rest = POOL.filter(t => !used.has(key(t)));
      const target = [...mine.flat(), ...rest], w = POOL.map(t => t.slice()), vals = [];
      for (let i = target.length - 1; i >= 1; i--) { const j = w.slice(0, i + 1).findIndex(t => key(t) === key(target[i])); vals.push((j + 0.5) / (i + 1)); [w[i], w[j]] = [w[j], w[i]]; }
      const seq = [0.1, ...vals]; let n = 0; const fb = mulberry32(5);
      return () => (n < seq.length ? seq[n++] : fb());
    };
    const R = await startServer({ rng: rig });
    const { host: a, guest: b } = await lobby(R.port, { rounds: 1, hand: 15 }, 'hard');
    a.dispatch({ type: 'startOnline' });
    await until(() => inGame(a) && inGame(b) && a.S.awaiting && a.S.awaiting.kind === 'build');
    ok(/Build my longest train \(15 tiles\)/.test(a.html()), 'Ann is dealt a complete train: the button offers all 15');
    a.dispatch({ type: 'autoBuild' });
    await until(() => a.S.game.players[0].hand.length === 0 && a.S.game.trains.human.tiles.length === 15 && !a.S.online.pending, 8000);
    ok(b.screens.some(h => /Building, tiles face down/.test(h)), 'Ben watched Ann\'s 15 tiles go down face down (she is his "cpu2")');
    await until(() => a.S.game.opening && a.S.game.opening.human.finished, 4000);
    ok(a.S.game.opening.human.finished && !a.S.awaiting, 'and nobody pressed Done: the game finished Ann\'s opening when her train was down');
    for (let i = 0; i < 60 && !(a.S.modal && b.S.modal); i++) { if (b.S.awaiting && !b.S.online.pending) { const q = b.S.awaiting; if (q.kind === 'build') b.dispatch({ type: q.canDraw ? 'draw' : q.canDone ? 'endBuild' : 'undoTile' }); else if (q.kind === 'draw') b.dispatch({ type: 'draw' }); } await wait(15); }
    await until(() => a.S.modal && b.S.modal, 5000);
    const ma = a.S.modal;
    ok(ma && ma.type === 'roundEnd' && /You went out first/.test(a.html()) && ma.rows.length === 3, 'Ann: "You went out first", with a row for each of the three players');
    ok(ma.rows[0].pips === 0 && ma.rows[1].pips > 0 && ma.rows[2].pips > 0 && ma.rows.map(r => r.name).join() === 'You,Ben,' + a.S.cpu2Name, 'she scores 0; Ben and the computer are left with points');
    ok(new RegExp(`${a.S.cpu2Name}`).test(a.html()) && (a.html().match(/class="mini"/g) || []).length === 3, 'the dialog shows everyone\'s remaining tiles, the computer\'s too');
    ok(/Ann went out first/.test(b.html()) && b.S.modal.rows.map(r => r.name).join() === `You,${a.S.cpu2Name},Ann`, 'Ben: "Ann went out first", rows in his table order');
    a.dispatch({ type: 'dialogOk' }); b.dispatch({ type: 'dialogOk' });
    await until(() => a.S.modal && a.S.modal.type === 'final' && b.S.modal && b.S.modal.type === 'final');
    ok(/You win/.test(a.html()) && /Ann wins/.test(b.html()), 'the final score: "You win" for Ann, "Ann wins" for Ben');
    a.dispatch({ type: 'onlineBack' }); b.dispatch({ type: 'onlineBack' }); await R.srv.close();
  }

  console.log('7. a hostile server describing three players');
  {
    const sent = [];
    class FakeWS { constructor() { this.readyState = 0; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); } send(d) { sent.push(JSON.parse(d)); } close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
    const c = makeClient(1, { WebSocket: FakeWS, fetch: infoStub('fake:1') });
    await hostInfoReady(c); c.dispatch({ type: 'hostGame', server: 'fake:1', name: 'Me', rounds: 4, hand: 15, computer: 'hard' });
    await until(() => sent.some(m => m.t === 'create'));
    ok(sent.find(m => m.t === 'create').computer === 'hard', 'the page asks the server for a Hard computer player when creating the game');
    const f = FakeWS.last, X = '<img src=x onerror=alert(1)>';
    f.say({ t: 'created', code: 'ABCDEF', display: 'ABC-DEF', token: 't', seat: 0, settings: { rounds: 4, hand: 15, computer: 'hard' }, addresses: [] });
    f.say({ t: 'lobby', code: 'ABCDEF', seat: 0, settings: { rounds: 4, hand: 15, computer: 'hard' }, players: [{ name: 'Me', connected: true }, { name: X, connected: true }, { name: X, connected: true, computer: true, level: '<b>' }, { name: 'extra' }], canStart: true, addresses: [], state: 'lobby' });
    ok(!/<img src=x/.test(c.html()) && /&lt;img/.test(c.html()) && c.S.online.players.length === 3, 'hostile names in a three-player lobby are escaped, and a fourth entry is ignored');
    ok(/, computer, Hard/.test(c.html()), '(a computer entry with a level that does not exist is shown at the lobby\'s own level)');
    const T = (a, b) => [a, b];
    const train = (id, tiles) => ({ id, marker: false, tiles: tiles || [], end: 12 });
    const view = (o) => Object.assign({ seq: 3, round: 0, rounds: 4, me: { name: 'Me' }, opp: { name: X }, opps: [{ id: 'cpu', name: X, computer: false }, { id: 'cpu2', name: X + '2', computer: true, level: '<script>' }], totals: { human: 1, cpu: 2, cpu2: 3 }, paused: false, over: null, log: [], banner: '', modal: null, awaiting: null,
      game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [T(1, 2)] }, { id: 'cpu', name: X, hand: [T(-1, -1)] }, { id: 'cpu2', name: X, hand: [T(-1, -1), T(-1, -1)] }], boneyard: [T(-1, -1)],
        trains: { human: train('human'), cpu: train('cpu'), cpu2: train('cpu2'), mexican: train('mexican') }, openDouble: null, opening: null } }, o);
    f.say({ t: 'state', seq: 3, view: view(), events: [] });
    let h = c.html();
    ok(inGame(c) && c.S.game.players.length === 3 && /data-player="cpu2"/.test(h) && !/<img src=x|<script>/.test(h) && (h.match(/<span class="who">img srcx onerroraler<\/span>/g) || []).length === 2, 'a three-player state with markup in both opponents\' names: the names are cleaned to plain text (and cut to 20 characters), and both rows are drawn');
    ok(/tag tag-normal/.test(h) && !/tag-<script>/.test(h), 'a computer level that does not exist is shown as Medium, never as markup');
    f.say({ t: 'state', seq: 4, view: view({ game: Object.assign(view().game, { trains: { human: train('human'), cpu: train('cpu'), mexican: train('mexican') } }) }), events: [] });
    ok(c.S.game.trains.cpu2 !== undefined, 'a three-player state with the third train missing is refused (the screen keeps the last good one)');
    f.say({ t: 'state', seq: 5, view: view({ game: Object.assign(view().game, { players: view().game.players.map((p, i) => (i === 2 ? Object.assign({}, p, { id: 'cpu3' }) : p)) }) }), events: [] });
    ok(c.S.game.players[2].id === 'cpu2', 'so is one whose players are not the expected three');
    f.say({ t: 'state', seq: 6, view: view({ game: Object.assign(view().game, { players: view().game.players.concat([view().game.players[1]]) }) }), events: [] });
    ok(c.S.game.players.length === 3, 'and one with four players');
    f.say({ t: 'state', seq: 7, view: view({ modal: { type: 'final', totals: { human: 5, cpu: 5, cpu2: 9 } } }), events: [] });
    h = c.html();
    ok(/A tie between You and /.test(h) && (h.match(/class="tot"><b>/g) || []).length >= 3, 'a final dialog where two players share the lowest score says "A tie between ..." and lists three scores');
    c.dispatch({ type: 'onlineBack' });
  }

  await A.srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
