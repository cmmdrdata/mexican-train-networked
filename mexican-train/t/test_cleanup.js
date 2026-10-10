'use strict';
// Screen clean-ups: no "Needs N" on the players' rows (the shared Mexican train keeps it), no join code in a playing game's header,
// "None" as the first computer choice on the Host screen, and nothing to fill in once a game has been created.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32 } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(2); } return f(); };

// the label part of each train row, by train id
const labels = html => { const out = {}; const re = /<div class="track[^"]*" data-train="(\w+)">([\s\S]*?)<div class="rail">/g; let m; while ((m = re.exec(html))) out[m[1]] = m[2]; return out; };
const hasNeeds = label => /class="needs"|Needs/.test(label);

function makeLocal(seed, extra) {
  const c = { store: {} };
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  c.app = G.createApp(Object.assign({ root, rng: mulberry32(seed), paceRng: () => 0, chatRng: () => 1, nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in c.store ? c.store[k] : null), set: (k, v) => { c.store[k] = v; } } }, extra || {}));
  c.S = c.app.state; c.d = a => c.app.dispatch(a); c.html = () => root._h; c.d({ type: 'boot' });
  return c;
}

(async () => {
  console.log('1. players\' rows have no "Needs N"; the Mexican train keeps it');
  for (const cpus of [1, 2]) {
    const c = makeLocal(5 + cpus);
    c.d({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'easy', cpus, level2: 'hard' });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    let L = labels(c.html());
    const ids = cpus === 2 ? ['human', 'cpu', 'cpu2'] : ['human', 'cpu'];
    ok(ids.every(id => id in L) && 'mexican' in L, `${cpus} computer${cpus > 1 ? 's' : ''}: every row is found (${Object.keys(L).join(', ')})`);
    ok(ids.every(id => !hasNeeds(L[id])), `${cpus} computer${cpus > 1 ? 's' : ''}, while building (the computers' trains face down): no player's row says "Needs"`);
    ok(/Needs <b class="num"[^>]*>12<\/b>/.test(L.mexican), '...but the Mexican train still says what it needs');
    c.d({ type: 'autoBuild' });
    await until(() => c.S.game.opening.human.finished);
    await until(() => c.S.game.players.every(p => c.S.game.opening[p.id].finished) && c.S.awaiting && c.S.awaiting.kind !== 'build', 6000);
    L = labels(c.html());
    ok(ids.every(id => !hasNeeds(L[id])) && hasNeeds(L.mexican), `${cpus} computer${cpus > 1 ? 's' : ''}, after the opening (every train face up): the same`);
    ok(ids.every(id => /track-name/.test(L[id])), '(the rows still have their names)');
    const open = ids.filter(id => c.S.game.trains[id].marker);
    ok(open.every(id => /class="lamp"/.test(L[id]) && !hasNeeds(L[id])), `an open train still says so ("Open: ... can play here"), without Needs${open.length ? '' : ' (none were open here)'}`);
  }

  console.log('2. the playing screen\'s header');
  {
    class FakeWS { constructor() { this.readyState = 0; this.sent = []; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); } send(d) { this.sent.push(JSON.parse(d)); } close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
    const c = makeLocal(1, { WebSocket: FakeWS, fetch: async () => ({ ok: true, json: async () => ({ addresses: ['fake:1'], preferred: 'fake:1' }) }) });
    c.d({ type: 'openHost' }); await wait(5);
    const form = c.html();
    ok(/<option value="none" selected>None<\/option>/.test(form) && !/two players/i.test(form) && /Add a Hard computer as a third player/.test(form), 'the Host screen\'s first computer choice is just "None" (the others are unchanged)');
    c.d({ type: 'hostGame', server: 'x', name: 'Ann', rounds: 4, hand: 15 }); await wait(10);
    const ws = FakeWS.last;
    ws.say({ t: 'created', code: 'K7QF2M', display: 'K7Q-F2M', token: 't', seat: 0, settings: { rounds: 4, hand: 15, allowHints: true }, addresses: ['127.0.0.1:8080'] });
    ws.say({ t: 'lobby', code: 'K7QF2M', seat: 0, settings: { rounds: 4, hand: 15, allowHints: true }, players: [{ name: 'Ann', connected: true }, null], canStart: false, addresses: ['127.0.0.1:8080'], state: 'lobby' });
    const page = c.html(), lobby = page.slice(page.indexOf('<div class="overlay">'));         // the dialog (the page behind it has its own header buttons)
    ok(lobby.length > 200 && /Online game<\/h2>/.test(lobby), '(the lobby dialog is found)');
    ok(!/<select|<input|<textarea|<option|aria-pressed|class="btn toggle"/.test(lobby), 'after Create game, the screen has no inputs: no choices, no switches (the host is only waiting for players)');
    ok(/4 rounds, 15 tiles each\. Hints are allowed\./.test(lobby), '...it says how the game was set up');
    ok(/K7Q-F2M/.test(lobby) && /data-action="copyLink"/.test(lobby) && /data-action="confirmLeave"/.test(lobby) && /data-action="startOnline"[^>]*disabled/.test(lobby), '...and still shows the join code, the QR code\'s Copy link, Leave, and a Start that waits for a player');
    const T = (a, b) => [a, b], tr = (id, marker) => ({ id, marker: !!marker, tiles: [], end: 12 });
    ws.say({ t: 'state', seq: 1, events: [], view: { seq: 1, round: 0, rounds: 4, me: { name: 'Ann', seat: 0 }, opp: { name: 'Ben' }, opps: [{ id: 'cpu', name: 'Ben', seat: 1, computer: false }], totals: { human: 0, cpu: 0 }, paused: false, over: null, log: ['x'], banner: '', modal: null, awaiting: null,
      game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [T(1, 2)] }, { id: 'cpu', name: 'Ben', hand: [T(-1, -1)] }], boneyard: [T(-1, -1)], trains: { human: tr('human'), cpu: tr('cpu', true), mexican: tr('mexican') }, openDouble: null, opening: null } } });
    const game = c.html(), L = labels(game);
    ok(/<span>Online game<\/span>/.test(game) && !/Online game [A-Z0-9]{3}-?[A-Z0-9]{3}/.test(game) && !/K7Q/.test(game.split('class="tracks"')[0]), 'in the game, the header says "Online game" and no longer shows the join code');
    ok(!hasNeeds(L.human) && !hasNeeds(L.cpu) && hasNeeds(L.mexican) && /Open: you can play here/.test(L.cpu), 'a hosted game\'s rows: no "Needs" on the players\' rows (an open train still says it is open), "Needs" on the Mexican train');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
