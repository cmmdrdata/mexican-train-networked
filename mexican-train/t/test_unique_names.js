'use strict';
// No two players at a table ever share a name (capitals ignored): the computers among themselves and against the people, in single-player and online, in every theme and at every skill.
require('./game.js');
const path = require('path');
const { createGameServer } = require('../server.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : require('../ws-lite.js').WebSocket;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const distinct = list => new Set(list.map(n => String(n).toLowerCase())).size === list.length;
const LEVELS = ['easy', 'normal', 'hard', 'expert'];

(async () => {
console.log('1. the picker: always a name nobody has, even when a level\'s own list runs out');
for (const theme of G.THEME_IDS) {
  let bad = 0, tries = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const rng = E.mulberry32(seed);
    const used = new Set(['you']); const got = [];
    for (let i = 0; i < 12; i++) {                         // far more than any table has, and more than a level's list
      const lv = LEVELS[Math.floor(rng() * 4)], n = G.pickCpuName(lv, rng, used, theme);
      tries++; if (used.has(n.toLowerCase())) bad++; used.add(n.toLowerCase()); got.push(n);
    }
    if (!distinct(got)) bad++;
  }
  ok(bad === 0, `${theme}: 200 tables of twelve computers, no name picked twice (${tries} picks)`);
}
{
  const used = new Set(['aragorn', 'elrond']); const n = G.pickCpuName('hard', Math.random, used, 'lotr');
  ok(!used.has(n.toLowerCase()), `the Lord of the Rings has two Hard names: a third Hard computer gets another name (${n})`);
}

console.log('2. single player: you and up to three computers');
{
  const store = {};
  const mk = seed => {
    const root = { set innerHTML(v) { this.h = v; }, get innerHTML() { return this.h || ''; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    return G.createApp({ root, rng: E.mulberry32(seed), paceRng: () => 0, chatRng: () => 0.99, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  };
  let bad = 0, games = 0, first = '';
  for (const theme of G.THEME_IDS) for (const lv of ['hard', 'expert', 'easy']) for (let seed = 1; seed <= 12; seed++) {
    const app = mk(seed * 31); app.dispatch({ type: 'boot' });
    const pool = G.themeOf ? null : null;
    const myName = ['Aragorn', 'Elrond', 'Zed', '', 'aragorn'][seed % 5];
    app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: lv, level2: lv, level3: lv, cpus: 3, theme, name: myName });
    const S = app.state, names = [S.myName || 'You', S.cpuName, S.cpu2Name, S.cpu3Name]; games++;
    if (!distinct(names)) { bad++; if (!first) first = `${theme}/${lv}/seed ${seed}: ${names.join(', ')}`; }
    app.dispatch({ type: 'newGame' });
  }
  ok(bad === 0, `${games} games with three computers of the same skill, in every theme, with names like theirs: all four names differ ${first}`);
}

console.log('3. online: the people and the computers at a hosted table');
{
  class Client {
    constructor(port) { this.ws = new WebSocketImpl(`ws://127.0.0.1:${port}/ws`); this.all = []; this.waiters = []; this.ws.onmessage = e => { try { this.all.push(JSON.parse(e.data)); } catch (x) { /* ignore */ } const w = this.waiters; this.waiters = []; w.forEach(f => f()); }; }
    open() { return new Promise(res => { this.ws.onopen = () => res(this); }); }
    send(o) { this.ws.send(JSON.stringify(o)); }
    async until(pred, ms) { const t0 = Date.now(); for (;;) { const m = this.all.find(pred); if (m) return m; if (Date.now() - t0 > (ms || 3000)) return null; await new Promise(res => { const t = setTimeout(res, 100); this.waiters.push(() => { clearTimeout(t); res(); }); }); } }
    last(type) { const a = this.all.filter(m => m.t === type); return a[a.length - 1] || null; }
    close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
  }
  const srv = createGameServer({ pagePath: path.join(__dirname, '..', 'mexican-train.html'), stepDelay: 0, sleep: async () => {}, log: () => {}, heartbeatMs: 60000, softGraceMs: 0, ratePerSecond: 5000, burst: 10000 });
  const port = await srv.listen(0, '127.0.0.1');
  let bad = 0, tables = 0, first = '';
  const cases = [];
  for (const theme of G.THEME_IDS) for (const lv of ['hard', 'expert', 'easy', 'normal']) for (const [a, b] of [['Aragorn', 'Elrond'], ['ARAGORN', 'gandalf'], ['Zed', 'Ben'], ['Ann', 'Ann']]) cases.push({ theme, lv, a, b });
  for (const k of cases) {
    const h = new Client(port); await h.open(); await h.until(m => m.t === 'hello');
    h.send({ t: 'create', name: k.a, rounds: 1, hand: 8, computer: k.lv, computer2: k.lv, humans: 2, theme: k.theme });
    const created = await h.until(m => m.t === 'created'); if (!created) { bad++; first = first || 'no room'; h.close(); continue; }
    const g = new Client(port); await g.open(); await g.until(m => m.t === 'hello');
    g.send({ t: 'join', code: created.code, name: k.b });
    await g.until(m => m.t === 'lobby' && m.players.filter(Boolean).length >= 3, 3000);
    const lob = g.last('lobby') || h.last('lobby'); tables++;
    const names = lob ? lob.players.filter(Boolean).map(p => p.name) : [];
    if (names.length < 4 || !distinct(names)) { bad++; if (!first) first = `${k.theme}/${k.lv}/${k.a}+${k.b}: ${names.join(', ')}`; }
    h.close(); g.close();
  }
  ok(tables > 0 && bad === 0, `${tables} hosted tables (two people and two computers, whatever the people call themselves): four different names every time ${first}`);
  if (srv.http.closeAllConnections) srv.http.closeAllConnections();
  await srv.close();
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
