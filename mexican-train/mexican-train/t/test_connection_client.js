'use strict';
// How the page decides a connection is dead, how it reconnects, and what it records (fake clock, fake socket).
require('./game.js');
const G = globalThis.MexicanTrainGame;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

class FakeWS {
  constructor(url) {
    this.url = url; this.readyState = 0; this.sent = []; this.closedBy = null;
    FakeWS.all.push(this); FakeWS.last = this;
    setTimeout(() => {
      if (FakeWS.failOpen) { this.readyState = 3; this.onerror && this.onerror(); this.onclose && this.onclose({ code: 1006, reason: '', wasClean: false }); return; }
      this.readyState = 1; this.onopen && this.onopen();
    }, 1);
  }
  send(d) { this.sent.push(JSON.parse(d)); }
  close(code, reason) { if (this.readyState === 3) return; this.closedBy = { code, reason }; this.readyState = 3; this.onclose && this.onclose({ code: code || 1005, reason: reason || '', wasClean: true }); }
  say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); }
  serverClose(code, reason) { this.readyState = 3; this.onclose && this.onclose({ code, reason: reason || '', wasClean: false }); }
  get pings() { return this.sent.filter(m => m.t === 'ping'); }
}
FakeWS.all = []; FakeWS.last = null; FakeWS.failOpen = false;

function fakeTime() {
  let clock = 1e9, idc = 0; const timers = [];
  const timer = { set: (fn, ms) => { const id = ++idc; timers.push({ id, at: clock + ms, fn, ms }); return id; }, clear: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); } };
  const advance = ms => { const end = clock + ms; for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > end) break; const t = timers.shift(); clock = t.at; t.fn(); } clock = end; };
  // the page was not running at all for `ms` (a hidden tab, a locked phone): when it runs again, every overdue timer fires at once
  const suspend = ms => { clock += ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers.find(x => x.at <= clock); if (!t) break; timers.splice(timers.indexOf(t), 1); t.fn(); } };
  return { timer, advance, suspend, now: () => clock, pending: () => timers.length };
}

async function inGame(extra) {                         // a hosted game, created and open
  FakeWS.all = []; FakeWS.failOpen = false;
  const t = fakeTime(), store = {};
  const root = { html: '', set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const app = G.createApp(Object.assign({ root, sleep: async () => {}, reducedMotion: true, timer: t.timer, now: t.now, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } },
    WebSocket: FakeWS, fetch: async () => ({ ok: true, json: async () => ({ addresses: ['fake:1'], preferred: 'fake:1' }) }) }, extra || {}));
  app.dispatch({ type: 'boot' }); app.dispatch({ type: 'openHost' }); await wait(5);
  app.dispatch({ type: 'hostGame', server: 'x', name: 'Ann', rounds: 4, hand: 15 }); await wait(10);
  FakeWS.last.say({ t: 'created', code: 'ABCDEF', display: 'ABC-DEF', token: 'tok', seat: 0, settings: { rounds: 4, hand: 15 }, addresses: [] });
  return { app, S: app.state, t, root, ws: () => FakeWS.last };
}
const events = (S, kind) => S.netLog.filter(e => e.kind === kind);

(async () => {
  console.log('1. any traffic is proof of life');
  {
    const { S, t, ws } = await inGame(); const w = ws();
    for (let i = 0; i < 30; i++) { t.advance(4000); w.say({ t: 'presence', oppConnected: true }); }      // two minutes, a message every 4 s
    ok(S.online.conn === 'open' && FakeWS.all.length === 1 && w.pings.length === 0, 'a connection the server keeps talking to is never pinged and never doubted (2 minutes)');
  }
  {
    const { S, t, ws } = await inGame(); const w = ws();
    t.advance(9000);
    ok(w.pings.length === 0, 'a quiet connection is not pinged in the first 10 s');
    t.advance(7000);
    ok(w.pings.length === 1, 'it is pinged once it has been quiet for more than 10 s');
    for (let i = 0; i < 40; i++) { t.advance(5000); const p = w.pings[w.pings.length - 1]; if (p && !p.answered) { p.answered = true; w.say({ t: 'pong', n: p.n }); } }
    ok(S.online.conn === 'open' && FakeWS.all.length === 1 && w.pings.length >= 10, `a server that answers pings keeps the connection open for 200 s (${w.pings.length} pings, one every 10-15 s)`);
    ok(events(S, 'dead').length === 0 && events(S, 'closed').length === 0, '(and nothing was recorded as wrong)');
  }

  console.log('2. real silence ends a connection, with a reason, and the page reconnects');
  {
    const { S, t, ws } = await inGame(); const w = ws();
    t.advance(30000);
    ok(S.online.conn === 'open' && !w.closedBy, 'after 30 s of silence it is still open (and has been pinged)');
    t.advance(5000);
    ok(w.closedBy && w.closedBy.code === 4001 && /^page: nothing heard from the server for 3\d s$/.test(w.closedBy.reason), `after 35 s of nothing (not even an answer to a ping) the page gives up and says why to the server: ${JSON.stringify(w.closedBy)}`);
    ok(events(S, 'dead').length === 1 && /nothing heard from the server for 3\d s/.test(events(S, 'dead')[0].detail), 'and writes it in its log');
    ok(S.online.conn === 'reconnecting' && FakeWS.all.length === 1, 'it is reconnecting...');
    t.advance(250); await wait(5);
    ok(FakeWS.all.length === 2, '...with the first retry almost at once (250 ms), because most blips are over by then');
    const second = ws();
    ok(second.sent.length === 1 && second.sent[0].t === 'resume' && second.sent[0].code === 'ABCDEF' && second.sent[0].token === 'tok', 'and asks for its seat back');
    ok(second.sent[0].d && /nothing heard from the server for 3\d s/.test(second.sent[0].d.why) && second.sent[0].d.tries === 1 && second.sent[0].d.silentMs >= 30000, 'and tells the server what happened on its side, so the server\'s log can say: ' + JSON.stringify(second.sent[0].d));
  }
  {
    const { S, t } = await inGame();
    FakeWS.failOpen = true;
    FakeWS.last.serverClose(1006);                                           // the connection drops, and every new attempt fails
    const waits = [];
    for (let i = 0; i < 8; i++) { t.advance(5500); await wait(5); }
    const re = events(S, 'reconnecting').map(e => Number(/in (\d+) ms/.exec(e.detail)[1]));
    ok(re.slice(0, 7).join() === '250,1000,2000,3000,4000,5000,5000', `retries: quick first, then slower, never slower than 5 s: ${re.slice(0, 7).join(', ')} ms`);
    FakeWS.failOpen = false; t.advance(5500); await wait(10);
    ok(S.online.conn === 'open' && /connected again after \d+ tries/.test(events(S, 'open').pop().detail), 'and when the network is back it connects again: "' + events(S, 'open').pop().detail + '"');
  }

  console.log('3. a page that was not running is not held against the server');
  {
    const { S, t, ws } = await inGame(); const w = ws();
    t.suspend(90000);                                                         // a locked phone, a hidden tab: the page did not run for 90 s
    ok(events(S, 'suspended').length === 1 && /about 9\d s/.test(events(S, 'suspended')[0].detail), 'a page that finds it was not running says so: "' + (events(S, 'suspended')[0] || {}).detail + '"');
    ok(events(S, 'dead').length === 0 && !w.closedBy, 'and does not conclude that the connection is dead just because it heard nothing');
    ok(w.pings.length === 1, 'it checks the connection at once instead (a ping)');
    w.say({ t: 'pong', n: w.pings[0].n });
    t.advance(20000);
    ok(S.online.conn === 'open' && FakeWS.all.length === 1 && !w.closedBy, 'and when the server answers, all is well: nothing was reconnected');
  }
  {
    const { S, t, ws } = await inGame(); const w = ws();
    t.suspend(90000);                                                         // the same, but this time the connection really is gone
    t.advance(5900);
    ok(!w.closedBy, 'if the check gets no answer, it waits a few seconds before judging (5.9 s)');
    t.advance(200);
    ok(w.closedBy && w.closedBy.code === 4001 && /no answer within 6 s of checking/.test(w.closedBy.reason) && /page was suspended/.test(w.closedBy.reason), 'and then gives up, saying why: ' + JSON.stringify(w.closedBy));
    t.advance(300); await wait(5);
    ok(FakeWS.all.length === 2, 'and reconnects');
  }

  console.log('4. the page waking up, or the network coming back');
  {
    const { S, t, ws, app } = await inGame(); const w = ws();
    app.dispatch({ type: 'netWake', why: 'the page is visible again', hiddenMs: 14000 });
    ok(w.pings.length === 1 && events(S, 'wake').length === 1 && /hidden for 14 s/.test(events(S, 'wake')[0].detail), 'waking up on an open connection checks it at once (a ping), and records how long the page was hidden');
    w.serverClose(1006);                                                      // it was dead after all
    ok(S.online.conn === 'reconnecting' && FakeWS.all.length === 1, 'the connection closes: reconnecting, with the retry timer running');
    app.dispatch({ type: 'netWake', why: 'the network came back' });
    await wait(5);
    ok(FakeWS.all.length === 2, 'waking again does not wait out the retry timer: it reconnects immediately');
    ok(ws().sent[0].d && ws().sent[0].d.hiddenMs === 14000 && ws().sent[0].d.why === 'the connection closed (code 1006)', 'and tells the server about the 14 s in the background: ' + JSON.stringify(ws().sent[0].d));
    ws().serverClose(1006); t.advance(300); await wait(5);
    ok(ws().sent[0].d && ws().sent[0].d.hiddenMs === 0 && ws().sent[0].d.tries === 1, 'each account is about that drop only (the hidden time is not counted twice)');
    app.dispatch({ type: 'netNote', what: 'the browser says it is offline' });
    ok(events(S, 'note').pop().detail === 'the browser says it is offline', 'notes from the browser are recorded');
  }
  {
    const { S, app } = await inGame();
    S.online.ended = { reason: 'x', message: 'y' };
    const n = FakeWS.all.length;
    app.dispatch({ type: 'netWake', why: 'the page is visible again' });
    ok(FakeWS.all.length === n && events(S, 'wake').length === 0, 'a page whose game has ended ignores wake-ups');
  }

  console.log('5. the server closing the connection');
  {
    const { S, t, ws } = await inGame();
    ws().serverClose(4000, 'replaced by a newer connection');
    ok(S.online.ended && S.online.ended.reason === 'replaced' && FakeWS.all.length === 1, 'being replaced by another window still ends the game here, without a fight (as before)');
  }
  {
    const { S, t, ws, root } = await inGame();
    ws().serverClose(1012, '<img src=x onerror=alert(1)>');
    ok(S.online.conn === 'reconnecting' && /What happened: code 1012/.test(root.innerHTML), 'the reconnect screen says what happened: "' + (root.innerHTML.match(/What happened:[^<]*/) || [''])[0] + '"');
    ok(!/<img src=x/.test(root.innerHTML) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(root.innerHTML), '...but never as markup: whatever the server says is escaped on the page');
  }

  console.log('6. a slow answer is noticed');
  {
    const { S, t, ws } = await inGame(); const w = ws();
    t.advance(15000);
    const p = w.pings[0];
    t.advance(2500); w.say({ t: 'pong', n: p.n });
    ok(events(S, 'slow-reply').length === 1 && /took 2[5-9]\d\d ms/.test(events(S, 'slow-reply')[0].detail), 'a ping that takes over a second to come back is written down: "' + (events(S, 'slow-reply')[0] || {}).detail + '"');
    w.say({ t: 'pong', n: 9999 }); w.say({ t: 'pong' });
    ok(S.online.conn === 'open' && events(S, 'slow-reply').length === 1, 'and an answer that matches no ping is ignored');
  }

  console.log('7. the log');
  {
    const { S, t, ws, app } = await inGame();
    for (let i = 0; i < 40; i++) { app.dispatch({ type: 'netNote', what: 'event ' + i }); }
    for (let i = 0; i < 40; i++) { app.dispatch({ type: 'netNote', what: 'more ' + i }); }
    ok(S.netLog.length === 60 && S.netLog[59].detail === 'more 39' && S.netLog[0].detail !== 'event 0', 'it keeps the last 60 events');
    ok(S.netLog.every(e => typeof e.at === 'number' && typeof e.kind === 'string'), 'each with a time and a kind');
  }
  {
    const lines = []; const orig = console.info; console.info = (...a) => lines.push(a.join(' '));
    try {
      const quiet = await inGame(); quiet.app.dispatch({ type: 'netNote', what: 'quiet' });
      const before = lines.length;
      const loud = await inGame({ netConsole: true }); loud.app.dispatch({ type: 'netNote', what: 'hello' });
      ok(before === 0 && lines.length >= 2 && lines.some(l => l === '[net] note: hello') && lines.some(l => /^\[net\] open/.test(l)), 'in a browser each event is also written to the console as "[net] ...": ' + JSON.stringify(lines.slice(-2)));
    } finally { console.info = orig; }
  }
  {
    const { S, ws, app, root, t } = await inGame();
    ok(!/net-debug/.test(root.innerHTML), 'the on-screen log is not shown normally');
    app.dispatch({ type: 'netDebug' });
    ws().say({ t: 'presence', oppConnected: true });
    ok(/class="net-debug"/.test(root.innerHTML) && /Connection: open/.test(root.innerHTML) && /\bopen\b: connected/.test(root.innerHTML), 'with ?debug=1 a panel shows the connection and its recent events');
    app.dispatch({ type: 'netNote', what: '<script>alert(1)</script>' });
    ok(!/<script>/.test(root.innerHTML) && /&lt;script&gt;/.test(root.innerHTML), 'escaped');
    ok(typeof app.dispatch({ type: 'copyNetLog' }) === 'undefined', 'and it can be copied (nothing breaks without a clipboard)');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
