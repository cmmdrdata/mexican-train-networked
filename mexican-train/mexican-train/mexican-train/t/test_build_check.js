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

function policyFor(rnd) {
  return v => {
    const a = v.awaiting;
    if (a.kind === 'modal') return { a: 'ok' };
    if (a.kind === 'draw') return { a: 'draw' };
    const pick = () => a.moves[Math.floor(rnd() * a.moves.length)];
    if (a.kind === 'move') { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    if (a.canDraw) return { a: 'draw' };
    if (a.canBuild && rnd() < 0.25) return { a: 'autoBuild' };
    if (a.moves.length && rnd() < 0.7) { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    if (a.canDone && rnd() < 0.5) return { a: 'done' };
    if (a.canUndo && rnd() < 0.3) return { a: 'undo' };
    if (a.canDone) return { a: 'done' };
    if (a.moves.length) { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    return { a: 'undo' };
  };
}
/* One player's side of a whole match, using the acks so that no state is ever answered twice. */
async function drive(c, policy, stats) {
  let n = 0, minSeq = -1;
  for (;;) {
    const m = await c.next(x => x.t === 'state' || x.t === 'ended', 10000);
    if (!m) { stats.timeout = true; return; }
    if (m.t === 'ended') { stats.ended = m; return; }
    if (m.seq <= minSeq) continue;
    const v = m.view;
    if (v.modal && v.modal.type === 'final') { stats.final = v; return; }
    if (!v.awaiting) continue;
    const id = ++n;
    c.send(Object.assign({ t: 'i', id }, policy(v)));
    const ack = await c.next(x => x.t === 'ack' && x.id === id, 4000);
    if (!ack) { stats.noAck = (stats.noAck || 0) + 1; continue; }
    stats.sent = (stats.sent || 0) + 1;
    if (!ack.ok) stats.refused = (stats.refused || 0) + 1;
    minSeq = ack.seq;
  }
}
const structuralLeaks = c => {                                // no real tile of the opponent, the boneyard or a hidden train in any state
  let bad = 0;
  for (const m of c.of('state')) {
    const g = m.view.game; if (!g) continue;
    if (!g.players[1].hand.every(t => t[0] < 0)) bad++;
    if (!g.boneyard.every(t => t[0] < 0)) bad++;
    if (g.opening && !g.opening.cpu.finished && !g.trains.cpu.tiles.every(t => t[0] < 0)) bad++;
    for (const ev of m.events) if (ev.e === 'play' && ev.who === 'opp' && ev.hidden && (ev.tile !== null || ev.placed[0] >= 0)) bad++;
  }
  return bad;
};

const os = require('os'), pathMod = require('path');
const tmp = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'mt-build-'));
const pageFile = pathMod.join(tmp, 'page.html');
let mt = 5000;
const writePage = stamp => { fs.writeFileSync(pageFile, `<!doctype html><title>t</title><script>${stamp ? `window.MT_BUILD = "${stamp}";` : ''} /* the game */</script>`); mt += 5000; fs.utimesSync(pageFile, new Date(mt * 1000), new Date(mt * 1000)); };
const getJson = (port, p) => new Promise((resolve, reject) => require('http').get({ host: '127.0.0.1', port, path: p }, res => { let b = ''; res.on('data', c => (b += c)); res.on('end', () => resolve(JSON.parse(b))); }).on('error', reject));
const rawJoin = async (port, code, name, build) => { const c = await connect(port); const m = { t: 'join', code, name }; if (build !== undefined) m.build = build; c.send(m); const r = await c.next(x => x.t === 'joined' || x.t === 'error'); return { c, r }; };

const rawHost = async (port, name, settings) => { const c = await connect(port); c.send(Object.assign({ t: 'create', name }, settings)); const created = await c.next(m => m.t === 'created' || m.t === 'error'); return { c, created }; };
(async () => {
  console.log('1. the server knows which page it serves');
  writePage('abc123def0');
  const logs = [];
  const T = await startServer(Object.assign({ pagePath: pageFile, checkBuild: true, log: m => logs.push(m) }, { ratePerSecond: 5000, burst: 10000 }));
  ok((await getJson(T.port, '/info')).build === 'abc123def0', '/info says which build of the page this server serves');
  {
    writePage('');
    const T2 = await startServer({ pagePath: pageFile, checkBuild: true });
    ok((await getJson(T2.port, '/info')).build === '', 'a page with no stamp (or none at all) gives an empty build');
    const h = await rawHost(T2.port, 'Ann', {});
    ok(h.created && h.created.t === 'created', 'and then there is nothing to compare, so nobody is turned away');
    h.c.close(); await T2.srv.close();
    writePage('abc123def0');
  }

  console.log('2. a page that is not the one being served is turned away, with what to do');
  {
    const stale = await rawHost(T.port, 'Ann', {});                                          // no build at all: a page from before pages carried one
    ok(stale.created && stale.created.t === 'error', 'creating from a page with no version is refused');
    const e = stale.created;
    ok(e.t === 'error' && e.code === 'page_outdated' && /out of date/.test(e.message) && /Reload it \(Ctrl\+F5, or Cmd\+Shift\+R on a Mac\)/.test(e.message) && /saved copy of the page/.test(e.message), 'with a message that says to reload the page: ' + e.message.slice(0, 90));
    ok(logs.some(l => /Ann \(hosting\) was refused \(create\): the page in use is from before pages carried a version, this server's is build abc123def0/.test(l)), 'and the server console says why, naming the builds: ' + logs.filter(l => /refused/.test(l)).slice(-1)[0]);
    ok(T.srv.rooms.size === 0, '(no game was made)');
    const wrong = await rawHost(T.port, 'Ann', { build: 'ffffffffff' });
    ok(wrong.created.code === 'page_outdated' && logs.some(l => /the page in use is build ffffffffff, this server's is build abc123def0/.test(l)), 'a different build is refused too, and the console names both');
    const good = await rawHost(T.port, 'Ann', { build: 'abc123def0', humans: 3, rounds: 1, hand: 8 });
    ok(good.created.t === 'created' && good.created.settings.humans === 3 && T.srv.rooms.size === 1, 'the matching build is let in (and a game for three is a game for three)');
    ok(logs.some(l => /game .* created by Ann: three people, 1 round of 8 tiles/.test(l)), 'and the console now says how the game was made: ' + logs.filter(l => /created by/.test(l)).slice(-1)[0]);
    const j0 = await rawJoin(T.port, good.created.code, 'Ben');
    ok(j0.r.t === 'error' && j0.r.code === 'page_outdated', 'joining from a page with no version is refused too');
    const j1 = await rawJoin(T.port, good.created.code, 'Ben', 'ffffffffff');
    ok(j1.r.code === 'page_outdated', '...and from a different build');
    const j2 = await rawJoin(T.port, 'ZZZZZZ', 'Ben', undefined);
    ok(j2.r.code === 'page_outdated', 'an old page is told it is old BEFORE anything about the code (it learns nothing about which games exist, and a wrong code is not counted against it)');
    const j3 = await rawJoin(T.port, good.created.code, 'Ben', 'abc123def0');
    ok(j3.r.t === 'joined' && j3.r.seat === 1, 'the matching build joins');
    const rs = await connect(T.port); rs.send({ t: 'resume', code: good.created.code, token: j3.r.token });
    ok((await rs.next(x => x.t === 'resumed' || x.t === 'error')).t === 'resumed', 'and coming back to a game in progress needs no version (the tab that is already in the game is not thrown out)');
    [stale.c, wrong.c, good.c, j0.c, j1.c, j2.c, j3.c, rs].forEach(x => x.close());
  }

  console.log('3. the page file is replaced while the server runs');
  {
    writePage('0987654321');
    const h = await rawHost(T.port, 'Zoe', { build: 'abc123def0' });
    ok(h.created.code === 'page_outdated' && (await getJson(T.port, '/info')).build === '0987654321', 'with new files on disk, the old build is turned away at once, with no restart of this check');
    const h2 = await rawHost(T.port, 'Zoe', { build: '0987654321' });
    ok(h2.created.t === 'created', 'and the new one is let in');
    h.c.close(); h2.c.close();
  }

  console.log('4. when the check is not wanted');
  {
    const T3 = await startServer({ pagePath: pageFile });            // (the default: the checking is the command line\'s doing)
    const h = await rawHost(T3.port, 'Ann', {});
    ok(h.created.t === 'created', 'a server made without the check lets any page in (as every other test relies on)');
    h.c.close(); await T3.srv.close();
  }
  await T.srv.close();

  console.log('5. the command line turns it on');
  {
    const node = process.execPath, server = pathMod.join(__dirname, '..', 'server.js');
    const port = 38000 + Math.floor(Math.random() * 1500);
    const child = spawn(node, [server, '--no-public-ip', '--port', String(port), '--quiet']);
    let out = ''; child.stdout.on('data', d => (out += d));
    for (let i = 0; i < 40 && !/is running/.test(out); i++) await wait(100);
    ok(/Serving the game page, build [0-9a-f]{10}\./.test(out), 'the start-up banner says which build of the page it is serving: ' + (out.match(/Serving the game page, build [0-9a-f]+/) || [''])[0]);
    const info = await getJson(port, '/info');
    const realStamp = /window\.MT_BUILD = "([0-9a-f]+)"/.exec(fs.readFileSync(pathMod.join(__dirname, '..', 'mexican-train.html'), 'utf8'));
    ok(realStamp && info.build === realStamp[1] && out.includes('build ' + realStamp[1] + '.'), 'node server.js reports the stamp of the real page it serves, in /info and in its banner: ' + info.build);
    const h = await rawHost(port, 'Ann', {});
    ok(h.created.code === 'page_outdated', 'and turns away a page with no version');
    const h2 = await rawHost(port, 'Ann', { build: info.build });
    ok(h2.created.t === 'created', 'while the page it serves is let in');
    h.c.close(); h2.c.close(); child.kill();
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
