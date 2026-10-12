'use strict';
// Three PEOPLE at one table, each a real page talking to a real server: the Host screen's choice, the lobby, play, who said what,
// who is shown as disconnected and who the pause dialog names, and the final screens.
require('./game.js');
const G = globalThis.MexicanTrainGame;
const { mulberry32, key } = G.Engine;
const { createGameServer } = require('../server.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(4); } return f(); };
const PAGE = require('path').join(__dirname, '..', 'mexican-train.html');

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

const serverConn = (srv, seat) => Array.from(srv.conns).find(c => c.session && c.session.seat === seat);
async function lobby3(port) {
  const host = makeClient(port), ben = makeClient(port), cat = makeClient(port);
  host.dispatch({ type: 'openHost' }); await hostInfoReady(host);
  host.dispatch({ type: 'hostGame', server: `127.0.0.1:${port}`, name: 'Ann', rounds: 1, hand: 8, computer: 'person' });
  await until(() => host.S.online && host.S.online.phase === 'lobby' && host.S.online.code);
  const join = async (c, name) => { c.dispatch({ type: 'openJoin' }); c.dispatch({ type: 'joinGame', server: `127.0.0.1:${port}`, name, code: host.S.online.display }); await until(() => c.S.online && c.S.online.phase === 'lobby' && c.S.online.players[c.S.online.seat]); };
  await join(ben, 'Ben'); await join(cat, 'Cat');
  await until(() => host.S.online.canStart);
  return { host, ben, cat };
}
const rowOf = (html, id) => { const m = html.split('<div class="cpu-hand').slice(1).find(b => b.includes(`data-player="${id}"`)); return m || ''; };

(async () => {
  const A = await startServer({ publicIp: false, softGraceMs: 100, graceMs: 4000 });

  console.log('1. the Host screen offers a third person');
  {
    const c = makeClient(A.port);
    c.dispatch({ type: 'openHost' }); await hostInfoReady(c);
    const h = c.html();
    ok(/<label for="net-computer">Third player<\/label>/.test(h) && /<option value="person">Add a third person<\/option>/.test(h) && /<option value="none" selected>None<\/option>/.test(h), 'the choice is now "Third player": None, a computer of each level, or a third person');
    ok(/a third person, three people play, everyone joins with the same code/.test(h), 'with a line saying what that means');
    c.dispatch({ type: 'hostGame', server: `127.0.0.1:${A.port}`, name: 'Ann', rounds: 1, hand: 8, computer: 'person' });
    await until(() => c.S.online && c.S.online.phase === 'lobby' && c.S.online.code);
    ok(c.S.online.settings.humans === 3 && c.S.online.settings.computer === null && c.S.online.players.length === 3, 'choosing it makes a game for three people, with no computer');
    c.dispatch({ type: 'confirmLeave' });
    // and a game for two still speaks of one other player
    const two = makeClient(A.port);
    two.dispatch({ type: 'openHost' }); await hostInfoReady(two);
    two.dispatch({ type: 'hostGame', server: `127.0.0.1:${A.port}`, name: 'Zoe', rounds: 1, hand: 8, computer: 'none' });
    await until(() => two.S.online && two.S.online.phase === 'lobby' && two.S.online.code);
    ok(two.S.online.settings.humans === 2 && two.S.online.players.length === 2 && /Or the other player opens one of these addresses in a browser, or enters it under/.test(two.html()) && !/three people/.test(two.html()), 'a game for two is as it was: two places, and "the other player" (singular)');
    two.dispatch({ type: 'confirmLeave' });
  }

  console.log('2. the lobby');
  const { host, ben, cat } = await (async () => {
    const host = makeClient(A.port), ben = makeClient(A.port), cat = makeClient(A.port);
    host.dispatch({ type: 'openHost' }); await hostInfoReady(host);
    host.dispatch({ type: 'hostGame', server: `127.0.0.1:${A.port}`, name: 'Ann', rounds: 1, hand: 8, computer: 'person' });
    await until(() => host.S.online && host.S.online.phase === 'lobby' && host.S.online.code);
    const li = html => Array.from(html.matchAll(/<li class="(up|down|empty)">/g)).map(m => m[1]);
    ok(li(host.html()).join() === 'up,empty,empty' && /Waiting for 2 players\.\.\./.test(host.html()) && /three people/.test(host.html()) && /data-action="startOnline"[^>]*disabled/.test(host.html()), 'alone, the host sees three places (one taken) and a Start button that says it is waiting for 2 players');
    ben.dispatch({ type: 'openJoin' }); ben.dispatch({ type: 'joinGame', server: `127.0.0.1:${A.port}`, name: 'Ben', code: host.S.online.display });
    await until(() => ben.S.online && ben.S.online.phase === 'lobby' && ben.S.online.players[1]);
    await until(() => host.S.online.players[1]);
    ok(ben.S.online.seat === 1 && li(host.html()).join() === 'up,up,empty' && /Waiting for a player\.\.\./.test(host.html()) && /data-action="startOnline"[^>]*disabled/.test(host.html()), 'Ben joins (seat 1): two places taken, still waiting for a player, and Start still waits');
    ok(/Ben \(you\)/.test(ben.html()) && /Ann, host/.test(ben.html()) && li(ben.html()).join() === 'up,up,empty' && /Ann will start the game/.test(ben.html()), 'Ben\'s own lobby shows him as "you", Ann as host, the empty place, and who starts the game');
    cat.dispatch({ type: 'openJoin' }); cat.dispatch({ type: 'joinGame', server: `127.0.0.1:${A.port}`, name: 'Cat', code: host.S.online.display });
    await until(() => cat.S.online && cat.S.online.phase === 'lobby' && cat.S.online.players[2]);
    await until(() => host.S.online.canStart);
    ok(cat.S.online.seat === 2 && li(host.html()).join() === 'up,up,up' && /data-action="startOnline"[^>]*>Start game/.test(host.html()) && !/data-action="startOnline"[^>]*disabled/.test(host.html()), 'Cat joins (seat 2): all three are in, and the host\'s Start button is ready');
    ok([host, ben, cat].every(c => /Ann/.test(c.html()) && /Ben/.test(c.html()) && /Cat/.test(c.html())), 'everyone\'s lobby lists all three names');
    ok(/Or the other players open one of these addresses in a browser, or enter it under/.test(host.html()), 'the host\'s lobby speaks of the other players (plural)');
    ok(!/data-action="startOnline"/.test(cat.html()), '(only the host has a Start button)');
    const late = makeClient(A.port);
    late.dispatch({ type: 'openJoin' }); late.dispatch({ type: 'joinGame', server: `127.0.0.1:${A.port}`, name: 'Dan', code: host.S.online.display });
    await until(() => late.S.onlineError);
    ok(/already has three players/.test(late.S.onlineError || '') && !late.S.online, 'a fourth person is told the game already has three players: ' + late.S.onlineError);
    return { host, ben, cat };
  })();

  console.log('3. in the game');
  host.dispatch({ type: 'startOnline' });
  await until(() => [host, ben, cat].every(inGame));
  await until(() => [host, ben, cat].every(c => c.S.awaiting));
  {
    const names = c => (c.S.opps || []).map(o => `${o.name}:${o.seat}:${o.computer}`).sort().join();
    ok(names(host) === 'Ben:1:false,Cat:2:false' && names(ben) === 'Ann:0:false,Cat:2:false' && names(cat) === 'Ann:0:false,Ben:1:false', 'each page has two human opponents, with their real seats: ' + names(host) + ' | ' + names(ben) + ' | ' + names(cat));
    ok([host, ben, cat].every(c => (c.html().match(/class="cpu-hand/g) || []).length === 2 && (c.html().match(/data-action="toggleSay"/g) || []).length === 1 && !/Comments: /.test(c.html())), 'each shows two opponent rows, one "Say something" (it goes to both) and no computer-comments switch');
    ok(['cpu', 'cpu2'].every(id => /net-dot up/.test(rowOf(host.html(), id))), 'both opponents show as connected');
    ok([host, ben, cat].every(c => /Open to all players/.test(c.html()) && !/Open to both players/.test(c.html())), 'the shared Mexican train says it is open to all players');
    ok(ben.S.opps.every(o => !o.computer) && /Cat/.test(rowOf(ben.html(), 'cpu')) && /Ann/.test(rowOf(ben.html(), 'cpu2')), '(the others come in seat order after you: on Ben\'s page Cat is the first row and Ann the second)');
  }

  console.log('4. talking');
  {
    host.dispatch({ type: 'toggleSay' }); host.dispatch({ type: 'sendText', text: 'Hello both' });
    await until(() => ben.S.comment && ben.S.comment.text === 'Hello both' && cat.S.comment && cat.S.comment.text === 'Hello both');
    ok(ben.S.comment.from === 'Ann' && cat.S.comment.from === 'Ann' && /<div class="bubble"><b>Ann<\/b><span>Hello both<\/span>/.test(ben.html()) && /<b>Ann<\/b><span>Hello both/.test(cat.html()), 'what Ann says appears on both pages, as Ann\'s: ' + ben.S.comment.from);
    ok(/You said: Hello both/.test(host.html()) && !host.S.comment, 'and Ann sees "You said", not a bubble of her own');
    ben.dispatch({ type: 'toggleSay' }); ben.dispatch({ type: 'sendText', text: 'Hi Ann and Cat' });
    await until(() => host.S.comment && host.S.comment.text === 'Hi Ann and Cat' && cat.S.comment && cat.S.comment.text === 'Hi Ann and Cat');
    ok(host.S.comment.from === 'Ben' && cat.S.comment.from === 'Ben', 'what Ben says shows as Ben\'s on both of the others (so Cat can tell whom it came from, not just "someone")');
    await wait(1600);
    cat.dispatch({ type: 'toggleSay' }); cat.dispatch({ type: 'sendChat', key: 1 });
    await until(() => host.S.comment && host.S.comment.from === 'Cat' && ben.S.comment && ben.S.comment.from === 'Cat');
    ok(host.S.comment.text === G.ONLINE_PHRASES[1] && ben.S.comment.text === G.ONLINE_PHRASES[1], 'a quick phrase from Cat reaches both: "' + host.S.comment.text + '"');
  }

  console.log('5. someone drops');
  {
    serverConn(A.srv, 1).ws.socket.destroy();                                   // Ben's connection dies
    await until(() => host.S.online.oppConnected === false && cat.S.online.oppConnected === false, 4000);
    ok(host.S.online.presenceBySeat[1].connected === false && host.S.online.presenceBySeat[2].connected === true, 'Ann\'s page knows it is Ben who is gone, and that Cat is there');
    ok(/Game paused/.test(host.html()) && /Ben lost the connection/.test(host.html()) && !/Cat lost/.test(host.html()) && !/Ben and Cat/.test(host.html()), 'the pause dialog on Ann\'s page names Ben, and only Ben');
    ok(/Ben lost the connection/.test(cat.html()) && /net-dot down/.test(rowOf(host.html(), 'cpu')) && /net-dot up/.test(rowOf(host.html(), 'cpu2')), 'and Cat\'s does, and on Ann\'s page Ben\'s row shows disconnected while Cat\'s shows connected');
    await until(() => host.S.online.oppConnected === true && cat.S.online.oppConnected === true, 8000);      // Ben's page reconnects by itself
    ok(!/Game paused/.test(host.html()) && !/Game paused/.test(cat.html()) && ben.S.online.conn === 'open', 'Ben\'s page reconnects by itself, and the pause goes away on both');
    serverConn(A.srv, 1).ws.socket.destroy(); serverConn(A.srv, 2).ws.socket.destroy();
    await until(() => host.S.online.oppConnected === false && host.S.online.presenceBySeat[1] && host.S.online.presenceBySeat[2] && !host.S.online.presenceBySeat[1].connected && !host.S.online.presenceBySeat[2].connected, 4000);
    ok(/Ben and Cat lost the connection/.test(host.html()), 'with two gone the dialog names both: ' + (host.html().match(/<p>([^<]*lost the connection)/) || [, ''])[1]);
    await until(() => host.S.online.oppConnected === true, 10000);
    ok(!/Game paused/.test(host.html()), 'and when both are back it goes on');
    ok(host.S.online.seat === 0 && ben.S.online.seat === 1 && cat.S.online.seat === 2 && host.S.online.host === true && !ben.S.online.host && !cat.S.online.host, 'after reconnecting, each page is still in its own seat (Cat is not taken for the host)');
  }

  console.log('6. played to the end');
  {
    const rnds = [mulberry32(31), mulberry32(32), mulberry32(33)];
    const done = await playBoth([host, ben, cat], rnds, 60000);
    ok(done, 'the three play on to the final score on their own pages');
    const titles = [host, ben, cat].map(c => { const m = c.html().match(/<h2 id="dlg-title">([^<]*)<\/h2>/); return m ? m[1] : ''; });
    const scores = (c, self) => Array.from(c.html().matchAll(/<div class="tot"><b>(\d+)<\/b><span>([^<]*)<\/span>/g)).map(m => (m[2] === 'You' ? self : m[2]) + '=' + m[1]).filter((x, i, a) => a.indexOf(x) === i).sort().join();      // (a screen calls its own player "You")
    ok(scores(host, 'Ann') === scores(ben, 'Ben') && scores(ben, 'Ben') === scores(cat, 'Cat') && scores(host, 'Ann').split(',').length === 3, 'all three final screens show the same three scores: ' + scores(host, 'Ann'));
    const winner = t => /^You win$/.test(t) ? 'self' : (t.match(/^(\w+) wins$/) || [, t])[1];
    const names = ['Ann', 'Ben', 'Cat'];
    ok(titles.every((t, i) => { const w = winner(t); return w === 'self' ? true : names.includes(w) || /tie/i.test(t); }) && titles.filter(t => t === 'You win').length <= 1, 'and agree about who won: ' + titles.join(' / '));
    ok(/You played Ben and Cat online/.test(host.html()) && /You played Cat and Ann online/.test(ben.html()) && /You played Ann and Ben online/.test(cat.html()), 'each is told whom they played (the others, in seat order after themselves)');
    const expected = { Ann: 'c0', Ben: 'c1', Cat: 'c2' };
    const cc = [colourCheck(host, 'Ann', expected), colourCheck(ben, 'Ben', expected), colourCheck(cat, 'Cat', expected)];
    ok(cc.every(x => x.bad.length === 0) && cc.every(x => Object.keys(x.seen).length >= 2) && cc.reduce((n, x) => n + Object.values(x.seen).reduce((a, b) => a + b, 0), 0) > 20, 'every player\'s toy train had the same colour (by seat) on every screen all game long');
  }

  console.log('7. leaving in the middle');
  {
    const g = await lobby3(A.port);
    g.host.dispatch({ type: 'startOnline' });
    await until(() => [g.host, g.ben, g.cat].every(inGame));
    g.cat.dispatch({ type: 'askLeave' }); g.cat.dispatch({ type: 'confirmLeave' });
    await until(() => g.host.S.online && g.host.S.online.ended && g.ben.S.online && g.ben.S.online.ended, 4000);
    ok(/Cat left the game/.test(g.host.html()) && /Cat left the game/.test(g.ben.html()), 'when Cat leaves, both the others are told Cat left the game');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
