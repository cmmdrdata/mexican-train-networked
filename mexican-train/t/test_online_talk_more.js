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


const { OnlineMatch } = require('../online-match.js');
const TH = G2.THEMES.lotr;
const serverConn = (srv, seat) => Array.from(srv.conns).find(c => c.session && c.session.seat === seat);

function fakeTimer() {
  let id = 0, t = 0; const q = [];
  return { q, get now() { return t; }, set(fn, ms) { q.push({ id: ++id, fn, at: t + ms, ms }); return id; }, clear(x) { const i = q.findIndex(e => e.id === x); if (i >= 0) q.splice(i, 1); },
    advance(ms) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const e = q[0]; if (!e || e.at > end) break; q.shift(); t = e.at; e.fn(); } t = end; } };
}
function matchOf(opts) {
  const h = { said: [[], [], []], timer: fakeTimer() };
  h.match = new OnlineMatch(Object.assign({ names: ['Ann', 'Ben', 'Gandalf'], computer: { level: 'hard' }, theme: 'lotr', rounds: 1, hand: 12, stepDelay: 0, sleep: async () => {}, rng: mulberry32(1), chatRng: () => 0, timer: h.timer, now: () => h.timer.now }, opts, {
    push(seat, msg) { if (msg.t === 'say') h.said[seat].push(msg); } }));
  return h;
}

(async () => {
  console.log('1. when the computer may speak (the rules, one at a time)');
  {
    const h = matchOf({}), m = h.match;                                          // chance always passes, shortest delay
    ok(m._maybeSay(0, 'draw') === true, 'a reaction to a draw may be said');
    ok(h.timer.q.filter(e => e.ms >= 600 && e.ms <= 1100).length === 1 && h.said[0].length === 0, 'but a beat later, not at once (600 to 1100 ms)');
    h.timer.advance(500); ok(h.said[0].length === 0, '(not after 500 ms)');
    h.timer.advance(200);
    ok(h.said[0].length === 1 && h.said[0][0].kind === 'draw' && h.said[0][0].from === 'Gandalf' && h.said[1].length === 0, 'then it is said, to Ann only, in the computer\'s name');
    ok(m._maybeSay(0, 'draw') === false && m._maybeSay(0, 'pass') === false, 'a second ordinary remark to Ann within 7 seconds is held back (the cooldown)');
    ok(m._maybeSay(1, 'draw') === true, 'but the cooldown is each person\'s own: Ben can be spoken to');
    h.timer.advance(7000);
    ok(m._maybeSay(0, 'draw') === true, 'and Ann can be spoken to again once the cooldown has passed');
    const bypass = Object.keys(G2.CHAT.bypass);
    ok(bypass.length >= 3 && bypass.every(k => m._maybeSay(0, k) === true), `${bypass.join(', ')} always get through, whatever the cooldown`);
    ok(m._maybeSay(0, 'nonsense') === false, 'an unknown kind of remark is never said');
    const before = h.said[2].length; m._say1(2, 'draw', {}, 0);
    ok(h.said[2].length === before, 'nothing is ever said to the computer\'s own seat');
    h.timer.advance(5000);
    ok(m._maybeSay(0, 'awful') === true && h.timer.q.length >= 1, '(a reaction is on its way...)');
    const said0 = h.said[0].length; m.abort();
    ok(h.timer.q.length === 0, 'when the match ends, nothing is left on the clock...');
    h.timer.advance(5000);
    ok(h.said[0].length === said0, '...and the reaction that was on its way is never said');
  }
  {
    const quiet = matchOf({ chatRng: () => 0.999 });
    ok(quiet.match._maybeSay(0, 'draw') === false && quiet.match._maybeSay(0, 'pass') === false, 'bad luck on the dice: it stays quiet');
    const none = matchOf({ names: ['Ann', 'Ben'], computer: undefined });
    ok(none.match._maybeSay(0, 'draw') === false && none.match.talker === undefined, 'with no computer there is nobody to speak');
  }

  console.log('2. the page: receiving a comment');
  {
    class FakeWS { constructor() { this.readyState = 0; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); } send() {} close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
    const clock = { t: 1e9 }, timers = [];
    const timer = { set: (fn, ms) => { timers.push({ fn, at: clock.t + ms }); return timers.length; }, clear() {} };
    const advance = ms => { const end = clock.t + ms; for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > end) break; const x = timers.shift(); clock.t = x.at; x.fn(); } clock.t = end; };
    const root = { html: '', adds: 0, bubble: null, set innerHTML(v) { this.html = v; this.bubble = /<div class="bubble/.test(v) ? { classList: { add: () => { this.adds++; } } } : null; }, get innerHTML() { return this.html; }, querySelectorAll() { return []; }, querySelector(sel) { return sel === '.bubble' ? this.bubble : { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const store = {};
    const app = G2.createApp({ root, sleep: async () => {}, reducedMotion: true, timer, now: () => clock.t, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } }, WebSocket: FakeWS, fetch: async () => ({ ok: true, json: async () => ({ addresses: ['fake:1'], preferred: 'fake:1' }) }) });
    const S = app.state; app.dispatch({ type: 'boot' }); app.dispatch({ type: 'openHost' }); await wait(5);
    app.dispatch({ type: 'hostGame', server: 'x', name: 'Ann', rounds: 4, hand: 15, computer: 'normal', theme: 'lotr' }); await wait(10);
    FakeWS.last.say({ t: 'created', code: 'ABCDEF', display: 'ABC-DEF', token: 't', seat: 0, settings: { rounds: 4, hand: 15, computer: 'normal', theme: 'lotr' }, addresses: [] });
    const T2 = (a, b) => [a, b], tr = (id, marker) => ({ id, marker: !!marker, tiles: [], end: 12 });
    const view = (seq, marker) => ({ seq, round: 0, rounds: 4, me: { name: 'Ann', seat: 0 }, opp: { name: 'Ben' }, opps: [{ id: 'cpu', name: 'Ben', seat: 1, computer: false }, { id: 'cpu2', name: 'Gandalf', seat: 2, computer: true, level: 'normal' }],
      totals: { human: 0, cpu: 0, cpu2: 0 }, paused: false, over: null, log: ['x'], banner: '', modal: null, awaiting: null,
      game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [T2(1, 2)] }, { id: 'cpu', name: 'Ben', hand: [T2(-1, -1)] }, { id: 'cpu2', name: 'Gandalf', hand: [T2(-1, -1)] }], boneyard: [T2(-1, -1)], trains: { human: tr('human'), cpu: tr('cpu'), cpu2: tr('cpu2', marker), mexican: tr('mexican') }, openDouble: null, opening: null } });
    FakeWS.last.say({ t: 'say', from: 'Gandalf', kind: 'draw', text: 'Too early.' });
    ok(!S.comment, 'a comment that arrives before the game has started is ignored');
    FakeWS.last.say({ t: 'state', seq: 1, view: view(1, true), events: [] });
    FakeWS.last.say({ t: 'say', from: 'Gandalf', kind: 'slow1', text: 'A wizard is never late.' });
    ok(/<div class="bubble"><b>Gandalf<\/b><span>A wizard is never late\.<\/span><\/div>/.test(root.html) && root.adds === 1, 'a comment appears as a speech bubble in the computer\'s name, and fades in once');
    for (let i = 2; i <= 6; i++) FakeWS.last.say({ t: 'state', seq: i, view: view(i, true), events: [] });
    ok(/A wizard is never late/.test(root.html) && root.adds === 1, 'and stays steady through the moves that follow');
    ok(/class="toy-train ring c2"/.test(root.html) && !/class="toy-train c2"/.test(root.html), 'in the Lord of the Rings theme the computer\'s open train wears a ring, not a toy train (and that is unaffected by the comment)');
    advance(6100); ok(!/A wizard is never late/.test(root.html), 'and goes away after a few seconds');
    const say = o => { advance(6100); FakeWS.last.say(Object.assign({ t: 'say', from: 'Gandalf', kind: 'draw' }, o)); };
    say({ text: '<img src=x onerror=alert(1)>', from: '<b>Evil</b>' });
    ok(!/<img src=x|<b>Evil/.test(root.html) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(root.html), 'text and a name containing markup are shown as plain text');
    say({ text: 'Hi', lang: 'constructor', trans: 'x' });
    ok(!/ lang="constructor"/.test(root.html) && /<span>Hi<\/span>/.test(root.html), 'a "language" that is a property every object has (constructor) is not a language');
    say({ text: 'Hi', lang: '__proto__', trans: 'x' });
    ok(!/ lang="__proto__"/.test(root.html), '...nor is __proto__');
    say({ text: 'Hi', lang: '"><script>alert(1)</script>', trans: 'x' });
    ok(!/<script>/.test(root.html), 'nor anything else that is not one of ours');
    say({ text: 'Privet', lang: 'ru', trans: 'Hello' });
    ok(/<span lang="ru">Privet<\/span>/.test(root.html) && /Hello/.test(root.html), 'a real language, with its translation, is shown');
    say({ text: 'Privet', lang: 'ru' });
    ok(!/ lang="ru"/.test(root.html) && /<span>Privet<\/span>/.test(root.html), 'but a language with no translation is shown as plain text');
    say({ text: 'x'.repeat(5000) });
    ok((root.html.match(/<span>(x+)<\/span>/) || [, ''])[1].length === 160, 'an enormous comment is cut to 160 characters');
    advance(6100);
    for (const bad of [{ text: '' }, { text: 42 }, { text: null }, { text: { a: 1 } }, {}]) FakeWS.last.say(Object.assign({ t: 'say', from: 'Gandalf' }, bad));
    ok(!S.comment, 'comments with no text, or text that is not text, are ignored');
    FakeWS.last.say({ t: 'say', text: 'A', from: null });
    ok(/<b>Computer<\/b><span>A<\/span>/.test(root.html), '(a comment with no name is credited to "Computer")');
    advance(6100);
    app.dispatch({ type: 'toggleChat' });
    FakeWS.last.say({ t: 'say', from: 'Gandalf', kind: 'draw', text: 'Should not show.' });
    ok(!/Should not show/.test(root.html) && !S.comment, 'with Comments turned off, nothing is shown');
    app.dispatch({ type: 'toggleChat' });
    app.dispatch({ type: 'leaveOnline' });
  }

  console.log('3. through the real server, with a clock we control: classic and Lord of the Rings');
  for (const theme of ['lotr', 'classic']) {
    const ft = fakeTimer();
    const adv = async ms => { ft.advance(ms); await wait(70); };         // (time is ours; the network's delivery is real, so give it a moment)
    const T0 = await startServer({ timer: ft, now: () => ft.now, chatRng: () => 0.5, nativeChance: 0, foodChance: 0, softGraceMs: 400, graceMs: 8000 });
    const p = await pair(T0.port, { computer: 'normal', theme, rounds: 1, hand: 12 });
    const lob = p.a.last('lobby'), who = lob.players[2].name;
    p.a.send({ t: 'start' });
    await p.a.next(m => m.t === 'state'); await p.b.next(m => m.t === 'state');
    const label = theme === 'lotr' ? 'Lord of the Rings' : 'classic';
    ok(theme === 'lotr' ? TH.players.normal.includes(who) : G2.CPU_PLAYERS.normal.includes(who), `${label}: the computer is ${who}, one of that theme's players`);
    const voice = (kind, text) => theme === 'lotr' ? (TH.voices[who][kind] || []).includes(text) : (G2.LINES.normal[kind] || []).includes(text);
    await adv(24900);
    ok(p.a.of('say').length === 0 && p.b.of('say').length === 0, `${label}: nothing is said in the first 25 seconds`);
    await adv(200);
    const sa = p.a.of('say'), sb = p.b.of('say');
    ok(sa.length === 1 && sb.length === 1 && sa[0].kind === 'slow1' && sb[0].kind === 'slow1' && sa[0].from === who && sb[0].from === who, `${label}: both people, taking their time, get the first jab, from ${who}`);
    ok(voice('slow1', sa[0].text) && voice('slow1', sb[0].text), `${label}: in ${theme === 'lotr' ? who + '\'s own voice' : 'the classic Medium lines'}: "${sa[0].text}"`);
    p.b.send({ t: 'i', id: 1, a: 'done' }); await wait(80);
    await adv(2000);                                                           // (whatever Ben's own opening earns lands first)
    const a1 = p.a.of('say').length, b1 = p.b.of('say').length;
    await adv(30000);
    ok(p.a.of('say').length > a1 && p.b.of('say').length === b1, `${label}: Ben has moved on, so the jabs go on for Ann alone (${p.a.of('say').length - a1} more) and none to Ben`);
    ok(p.a.of('say').filter(s => /^slow/.test(s.kind)).every((s, i) => s.kind === 'slow' + Math.min(3, i + 1)), `${label}: and they get ruder, one tier at a time`);
    // Ann's connection drops for a moment (less than the grace) and she comes back
    serverConn(T0.srv, 0).ws.socket.destroy(); await wait(120);
    const a2 = await connect(T0.port); a2.send({ t: 'resume', code: p.code, token: p.tokenA }); await a2.next(m => m.t === 'resumed');
    await adv(30000);
    ok(a2.of('say').some(s => /^slow/.test(s.kind) && s.from === who), `${label}: after a blip she is still teased, on her new connection`);
    // gone longer than the grace: the game is paused, and nobody is teased while it is
    serverConn(T0.srv, 0).ws.socket.destroy(); await wait(700);
    const b2 = p.b.of('say').length, a3 = a2.of('say').length;
    await adv(120000);
    ok(T0.srv.rooms.get(p.code).match.paused === true && p.b.of('say').length === b2 && a2.of('say').length === a3, `${label}: while the game is paused for a long drop, nobody is teased`);
    const a4 = await connect(T0.port); a4.send({ t: 'resume', code: p.code, token: p.tokenA }); await a4.next(m => m.t === 'resumed');
    ok(await until(() => T0.srv.rooms.get(p.code).match.paused === false, 1500), `${label}: and she comes back to a game that goes on`);
    await adv(60000);
    ok(a4.of('say').some(s => /^slow/.test(s.kind)), `${label}: and the teasing resumes`);
    const mm = T0.srv.rooms.get(p.code).match;
    mm.setPaused(true);                                                         // paused while Ann is connected and still thinking
    await adv(1500);
    const a5 = a4.of('say').length;
    await adv(200000);
    ok(a4.of('say').length === a5, `${label}: a paused game teases nobody, even someone who is connected and still thinking`);
    mm.setPaused(false);
    await T0.srv.close();
    ok(ft.q.length === 0, `${label}: shutting the server down leaves nothing on the clock`);
    p.a.close(); p.b.close(); a2.close(); a4.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
