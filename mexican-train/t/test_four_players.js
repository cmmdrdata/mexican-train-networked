'use strict';
/* A table of four: you and three computers on this page, and online (three people and a computer, or two people and two computers).
 * Never more than four players in all. */
require('./game.js');
const path = require('path');
const { OnlineMatch } = require('../online-match.js');
const { createGameServer } = require('../server.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32, key, handPips } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canon = t => [Math.min(t[0], t[1]), Math.max(t[0], t[1])];
const IDS = ['human', 'cpu', 'cpu2', 'cpu3'];

/* ---------- the engine ---------- */
console.log('1. the deal');
for (const n of [2, 3, 4]) {
  const g = E.newRound({ engine: 12, handSize: 15, rng: mulberry32(7), players: n });
  const all = []; g.players.forEach(p => p.hand.forEach(t => all.push(key(canon(t))))); g.boneyard.forEach(t => all.push(key(canon(t))));
  ok(g.players.length === n && g.players.map(p => p.id).join() === IDS.slice(0, n).join(), `${n} players: ${IDS.slice(0, n).join(', ')}`);
  ok(g.players.every(p => p.hand.length === 15) && g.boneyard.length === 90 - 15 * n && new Set(all).size === 90, `${n} players: 15 tiles each, ${90 - 15 * n} in the boneyard, every tile once`);
  ok(Object.keys(g.trains).sort().join() === IDS.slice(0, n).concat(['mexican']).sort().join(), `${n} players: a train each and the Mexican train`);
}
ok(E.newRound({ engine: 12, handSize: 15, rng: mulberry32(1), players: 5 }).players.length === 2, 'five players is not a thing (two, the default)');
{
  const a = E.newRound({ engine: 12, handSize: 15, rng: mulberry32(9), players: 4 }), b = E.newRound({ engine: 12, handSize: 15, rng: mulberry32(9), players: 3 });
  ok(eq(a.players.slice(0, 3).map(p => p.hand), b.players.map(p => p.hand)), 'the first three hands are dealt exactly as at a table of three');
}

/* ---------- online: the match ---------- */
function harness(opts, n) {
  const h = { problems: [], pushes: 0, sent: [], match: null };
  for (let i = 0; i < n; i++) h.sent.push([]);
  h.match = new OnlineMatch(Object.assign({ rounds: 1, hand: 12, stepDelay: 0, sleep: async () => {}, rng: mulberry32(1) }, opts, {
    push(seat, msg) {
      h.pushes++; h.sent[seat].push(msg);
      const g = h.match.game, v = msg.view, json = JSON.stringify(msg);
      if (!g) return;
      if (h.match.computers[seat]) h.problems.push('a message was sent to a computer seat');
      if (!(v.modal && v.modal.type === 'roundEnd')) {
        const secret = [];
        g.players.forEach((p, i) => { if (i !== seat) p.hand.forEach(t => secret.push(t)); });
        g.boneyard.forEach(t => secret.push(t));
        if (g.opening) g.players.forEach((p, i) => { if (i !== seat && !g.opening[p.id].finished) g.trains[p.id].tiles.forEach(t => secret.push(t)); });
        const bad = secret.filter(t => [`[${t[0]},${t[1]}]`, `[${t[1]},${t[0]}]`].some(p => json.includes(p)));
        if (bad.length) h.problems.push(`seat ${seat} was shown ${bad.map(t => t.join('-')).join(', ')} (seq ${msg.seq})`);
      }
      const all = [];
      g.players.forEach(p => p.hand.forEach(t => all.push(key(canon(t))))); g.boneyard.forEach(t => all.push(key(canon(t))));
      Object.keys(g.trains).forEach(id => g.trains[id].tiles.forEach(t => all.push(key(canon(t)))));
      if (all.length !== 90 || new Set(all).size !== 90) h.problems.push(`tiles lost or duplicated (${all.length}, seq ${msg.seq})`);
    },
  }));
  return h;
}
function policy(rnd) {
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
async function playOut(h, seed, hook) {
  const m = h.match, run = m.start(), pols = {};
  m.humans.forEach(s => { pols[s] = policy(mulberry32(seed * 10 + s)); });
  let steps = 0, stuck = 0;
  while (!m.over && steps < 40000) {
    let acted = false;
    for (const seat of m.humans) {
      const v = m.viewFor(seat);
      if (v.awaiting && !m.paused) {
        const intent = pols[seat](v), r = m.intent(seat, intent);
        if (!r.ok) { h.problems.push(`an intent was refused: seat ${seat} ${JSON.stringify(intent)} -> ${r.code}`); m.abort(); await run; return false; }
        acted = true; steps++;
      }
    }
    if (hook) hook(m);
    await tick();
    stuck = acted ? 0 : stuck + 1;
    if (stuck > 600) { h.problems.push('the match stopped making progress'); break; }
  }
  if (!m.over) m.abort();
  await run;
  return m.over === 'finished';
}

(async () => {
  console.log('2. who sits where');
  {
    const a = new OnlineMatch({ names: ['A', 'B', 'C', 'D'], computers: [{ level: 'hard' }], push() {} });
    ok(a.n === 4 && a.humans.join() === '0,1,2' && eq(a.computers, { 3: { level: 'hard' } }), 'four names and one computer: three people and the computer in the last seat');
    const b = new OnlineMatch({ names: ['A', 'B', 'C', 'D'], computers: [{ level: 'easy' }, { level: 'expert' }], push() {} });
    ok(b.humans.join() === '0,1' && eq(b.computers, { 2: { level: 'easy' }, 3: { level: 'expert' } }), 'four names and two computers: two people, then the computers');
    const c = new OnlineMatch({ names: ['A', 'B', 'C', 'D'], computers: [{ level: 'easy' }, { level: 'easy' }, { level: 'easy' }], push() {} });
    ok(Object.keys(c.computers).length === 2 && c.humans.length === 2, 'there are always at least two people: a third computer is ignored');
    const d = new OnlineMatch({ names: ['A', 'B', 'C', 'D'], push() {} });
    ok(d.humans.length === 4 && d.n === 4, 'four names and no computers is four people (the server never offers it, but it works)');
    const e = new OnlineMatch({ names: ['A', 'B', 'C'], computer: { level: 'hard' }, push() {} });
    ok(eq(e.computers, { 2: { level: 'hard' } }), 'the old way of giving one computer (computer: { level }) still puts it in the third seat');
    const f = new OnlineMatch({ names: ['A', 'B', 'C', 'D', 'E'], push() {} });
    ok(f.n === 2, 'five names is not a thing');
  }

  console.log('3. what each person sees');
  {
    const h = harness({ names: ['Ann', 'Ben', 'Cy', 'Zed'], computers: [{ level: 'normal' }], rng: mulberry32(3), hand: 8 }, 4);
    const m = h.match; m.start(); await tick(); await tick();
    const v = [0, 1, 2].map(s => m.viewFor(s));
    ok(v[0].game.players.map(p => p.id).join() === 'human,cpu,cpu2,cpu3' && v[0].game.players.map(p => p.name).join() === 'You,Ben,Cy,Zed', 'Ann sees herself, then Ben, Cy and the computer Zed, in table order');
    ok(v[1].game.players.map(p => p.name).join() === 'You,Cy,Zed,Ann' && v[2].game.players.map(p => p.name).join() === 'You,Zed,Ann,Ben', 'Ben and Cy each see the others in table order after themselves');
    ok(v[0].opps.length === 3 && v[0].opps.map(o => o.id).join() === 'cpu,cpu2,cpu3' && v[0].opps[2].computer === true && v[0].opps[2].seat === 3 && !v[0].opps[0].computer, 'the view lists three opponents and says which is the computer');
    ok(Object.keys(v[0].game.trains).join() === 'human,cpu,cpu2,cpu3,mexican' && Object.keys(v[0].totals).join() === 'human,cpu,cpu2,cpu3', 'five trains and four scores on each screen');
    m.abort(); await m.done;
    const h2 = harness({ names: ['Ann', 'Ben', 'Yan', 'Zed'], computers: [{ level: 'easy' }, { level: 'hard' }], rng: mulberry32(4), hand: 8 }, 4);
    h2.match.start(); await tick(); await tick();
    const w = h2.match.viewFor(1);
    ok(w.game.players.map(p => p.name).join() === 'You,Yan,Zed,Ann' && eq(w.opps.map(o => [o.computer, o.level]), [[true, 'easy'], [true, 'hard'], [false, null]]), 'two people and two computers: Ben sees Yan (easy), Zed (hard), then Ann');
    h2.match.abort(); await h2.match.done;
  }

  console.log('4. whole matches');
  for (const layout of [{ name: 'three people and a computer', names: ['Ann', 'Ben', 'Cy', 'Zed'], comps: 1 }, { name: 'two people and two computers', names: ['Ann', 'Ben', 'Yan', 'Zed'], comps: 2 }]) {
    let done = 0, total = 0, problems = [], clean = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const levels = ['easy', 'normal', 'hard', 'expert'];
      const h = harness({ names: layout.names, computers: Array.from({ length: layout.comps }, (_, i) => ({ level: levels[(seed + i) % 4] })), rng: mulberry32(seed), hand: [8, 12, 15][seed % 3], rounds: seed % 4 === 0 ? 4 : 1 }, 4);
      let seenTotals = null;
      const ok1 = await playOut(h, seed, m => { seenTotals = m.totals; });
      total++; if (ok1) done++;
      problems.push(...h.problems.slice(0, 2).map(p => `seed ${seed}: ${p}`));
      if (seenTotals && Object.keys(seenTotals).length === 4) clean++;
    }
    ok(done === total, `${layout.name}: every match ran to the final score (${done}/${total})`);
    ok(problems.length === 0, `${layout.name}: nobody was ever shown another hand, the boneyard or a face-down train; no tile lost; every move accepted` + (problems[0] ? ' (' + problems[0] + ')' : ''));
    ok(clean === total, `${layout.name}: four scores kept`);
  }

  console.log('5. the server: never more than four players');
  {
    const srv = createGameServer({ pagePath: path.join(__dirname, '..', 'mexican-train.html'), stepDelay: 0, sleep: async () => {}, log: () => {}, heartbeatMs: 60000, softGraceMs: 0 });
    const port = await srv.listen(0, '127.0.0.1');
    const info = await (await fetch(`http://127.0.0.1:${port}/info`)).json();
    ok(info.maxPlayers === 4 && info.maxHumans === 3, '/info says: up to three people, four players in all');
    const connect = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), q = [], w = [];
      ws.onmessage = e => { q.push(JSON.parse(e.data)); w.splice(0).forEach(f => f()); };
      await new Promise(r => { ws.onopen = r; });
      const c = { ws, q, send: o => ws.send(JSON.stringify(o)), async next(pred, ms = 3000) { const t0 = Date.now(); for (;;) { const i = q.findIndex(pred); if (i >= 0) return q.splice(i, 1)[0]; const left = ms - (Date.now() - t0); if (left <= 0) return null; await new Promise(r => { const t = setTimeout(r, left); w.push(() => { clearTimeout(t); r(); }); }); } } };
      await c.next(m => m.t === 'hello'); return c;
    };
    const make = async settings => { const c = await connect(); c.send(Object.assign({ t: 'create', name: 'Ann' }, settings)); const m = await c.next(m => m.t === 'created'); const lob = await c.next(m => m.t === 'lobby'); return { c, created: m, lobby: lob }; };
    const cases = [
      [{ humans: 2, computer: 'hard', computer2: 'easy' }, { humans: 2, computer: 'hard', computer2: 'easy' }, 4, 'two people and two computers'],
      [{ humans: 3, computer: 'hard' }, { humans: 3, computer: 'hard', computer2: null }, 4, 'three people and a computer'],
      [{ humans: 3, computer: 'hard', computer2: 'easy' }, { humans: 3, computer: 'hard', computer2: null }, 4, 'three people and two computers is five: the second computer is dropped'],
      [{ humans: 2, computer2: 'easy' }, { humans: 2, computer: null, computer2: null }, 2, 'a second computer without a first is ignored'],
      [{ humans: 2, computer: 'hard' }, { humans: 2, computer: 'hard', computer2: null }, 3, 'two people and a computer, as before'],
      [{ humans: 3 }, { humans: 3, computer: null, computer2: null }, 3, 'three people, as before'],
    ];
    for (const [ask, want, seats, what] of cases) {
      const r = await make(ask);
      const st = r.created.settings;
      ok(st.humans === want.humans && (st.computer || null) === (want.computer || null) && (st.computer2 || null) === (want.computer2 || null), `${what}: settings ${JSON.stringify({ h: st.humans, c: st.computer, c2: st.computer2 })}`);
      ok(st.humans + (st.computer ? 1 : 0) + (st.computer2 ? 1 : 0) === seats && seats <= 4, `${what}: ${seats} players, not more than four`);
      ok(r.lobby.players.filter(p => p && p.computer).length === (st.computer ? 1 : 0) + (st.computer2 ? 1 : 0), `${what}: the lobby lists the computers`);
      const names = r.lobby.players.filter(p => p && p.computer).map(p => p.name.toLowerCase());
      ok(new Set(names).size === names.length, `${what}: the computers have different names`);
      r.c.ws.close();
    }
    // settings changed in the lobby
    {
      const r = await make({ humans: 2, computer: 'hard', computer2: 'easy' });
      r.c.send({ t: 'settings', humans: 3 });
      const lob = await r.c.next(m => m.t === 'lobby' && m.settings.humans === 3);
      ok(lob && lob.settings.computer === 'hard' && !lob.settings.computer2 && lob.players.filter(p => p && p.computer).length === 1, 'changing to three people keeps one computer and drops the second (four players)');
      r.c.send({ t: 'settings', humans: 2, computer2: 'normal' });
      const lob2 = await r.c.next(m => m.t === 'lobby' && m.settings.humans === 2);
      ok(lob2 && lob2.settings.computer2 === 'normal' && lob2.players.filter(p => p && p.computer).length === 2, 'and back to two people, a second computer can be added');
      r.c.send({ t: 'settings', computer: 'none' });
      const lob3 = await r.c.next(m => m.t === 'lobby' && !m.settings.computer);
      ok(lob3 && !lob3.settings.computer2 && lob3.players.filter(p => p && p.computer).length === 0, 'removing the first computer removes the second');
      r.c.ws.close();
    }
    // a whole hosted game: two people and two computers, played through the server
    {
      const host = await connect(); host.send({ t: 'create', name: 'Ann', rounds: 1, hand: 8, humans: 2, computer: 'normal', computer2: 'hard' });
      const created = await host.next(m => m.t === 'created');
      const guest = await connect(); guest.send({ t: 'join', code: created.code, name: 'Ben' });
      await guest.next(m => m.t === 'joined');
      await host.next(m => m.t === 'lobby' && m.canStart);
      host.send({ t: 'start' });
      const st = await host.next(m => m.t === 'state');
      ok(!!st && st.view.game.players.length === 4 && st.view.opps.length === 3, 'a hosted game with two people and two computers starts with four players');
      ok(st.view.opps.filter(o => o.computer).length === 2, 'and two of the opponents are computers');
      host.ws.close(); guest.ws.close();
    }
    await srv.close();
  }

  console.log('6. this page: you and three computers');
  {
    const store = {};
    const root = { set innerHTML(v) { this.h = v; }, get innerHTML() { return this.h || ''; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const app = G.createApp({ root, rng: mulberry32(2), paceRng: () => 0, chatRng: mulberry32(1002), nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
    const S = app.state; app.dispatch({ type: 'boot' });
    ok(/<option value="3">Three computer players<\/option>/.test(root.innerHTML) && /id="field-level3" hidden>/.test(root.innerHTML), 'the setup screen offers "Three computer players", and the third skill is hidden until chosen');
    app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy', cpus: 3, level2: 'normal', level3: 'hard' });
    ok(S.opts.cpus === 3 && S.opts.level3 === 'hard' && /"cpus":3/.test(store['mt-opts']) && /"level3":"hard"/.test(store['mt-opts']), 'three computers (Easy, Medium, Hard) are what the game starts with, and are remembered');
    const names = [S.cpuName, S.cpu2Name, S.cpu3Name];
    ok(names.every(Boolean) && new Set(names.map(x => x.toLowerCase())).size === 3, `three different names (${names.join(', ')})`);
    for (let i = 0; i < 50 && !S.game; i++) await wait(5);
    ok(S.game && S.game.players.length === 4 && S.game.players.map(p => p.id).join() === IDS.join(), 'four players are dealt');
    const rows = root.innerHTML.split('<div class="cpu-hand').slice(1).map(b => (b.match(/data-player="(\w+)"/) || [])[1]);
    ok(rows.join() === 'cpu,cpu2,cpu3', 'three computer rows on the screen');
    ok(/class="opp four"/.test(root.innerHTML), 'laid out for four');
    ok(/Computers: Easy, Medium and Hard/.test(root.innerHTML) && /against three computers/.test(root.innerHTML), 'the header says who they are');
    ok(Object.keys(S.totals).sort().join() === 'cpu,cpu2,cpu3,human', 'four scores');
    ok(new Set(IDS.map(id => G.trainColor(S, id))).size === 4, 'four train colours');
    // play a round at random
    const rnd = mulberry32(5);
    let guard = 0;
    while (guard++ < 40000 && !(S.modal && S.modal.type === 'final')) {
      const a = S.awaiting;
      if (a) {
        if (a.kind === 'modal') app.dispatch({ type: 'dialogOk' });
        else if (a.kind === 'draw') app.dispatch({ type: 'draw' });
        else if (a.kind === 'move') { const m = a.moves[Math.floor(rnd() * a.moves.length)]; app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); }
        else if (a.canDraw) app.dispatch({ type: 'draw' });
        else if (a.moves.length && rnd() < 0.6) { const m = a.moves[Math.floor(rnd() * a.moves.length)]; app.dispatch({ type: 'selectTile', key: key(m.tile) }); }
        else if (a.canDone) app.dispatch({ type: 'endBuild' });
        else app.dispatch({ type: 'undoTile' });
      }
      await wait(0);
    }
    ok(S.modal && S.modal.type === 'final', 'the game ran to the final score');
    const html = root.innerHTML;
    ok(IDS.every(id => (S.modal.totals[id] || 0) >= 0) && /You played .* \((Easy)\), .* \((Medium)\) and .* \((Hard)\)\./.test(html), 'the final screen names all three computers and their skill');
    ok(new Set((html.match(/<span>[^<]+<\/span><\/div>/g) || [])).size >= 4, 'four scores on the final screen');
  }

  console.log('6b. each of the three computers plays at its own skill');
  {
    const openings = async levels => {                       // the average length of each computer's opening train over 14 games
      const store = {}, sum = { cpu: 0, cpu2: 0, cpu3: 0 };
      const root = { set innerHTML(v) { this.h = v; }, get innerHTML() { return this.h || ''; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
      const app = G.createApp({ root, rng: mulberry32(40), paceRng: () => 0, chatRng: mulberry32(41), nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
      const S = app.state; app.dispatch({ type: 'boot' });
      let n = 0;
      for (let i = 0; i < 14; i++) {
        app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: levels[0], cpus: 3, level2: levels[1], level3: levels[2] });
        for (let g = 0; g < 4000 && !(S.game && S.game.opening && S.game.players.every(p => S.game.opening[p.id].finished)); g++) {
          const a = S.awaiting;
          if (a && a.kind === 'build') app.dispatch({ type: a.canDone ? 'endBuild' : a.canBuild ? 'autoBuild' : 'undoTile' });
          await wait(0);
        }
        if (S.game && S.game.opening && S.game.players.every(p => S.game.opening[p.id].finished)) { n++; ['cpu', 'cpu2', 'cpu3'].forEach(id => { sum[id] += S.game.trains[id].tiles.length; }); }
      }
      return { n, avg: id => sum[id] / Math.max(1, n) };
    };
    const x = await openings(['hard', 'hard', 'easy']), y = await openings(['easy', 'easy', 'hard']);
    ok(x.n >= 10 && y.n >= 10, `the openings were seen (${x.n}, ${y.n} games)`);
    ok(y.avg('cpu3') > x.avg('cpu3') + 1.5, `the third computer plays at its OWN skill: Hard builds ${y.avg('cpu3').toFixed(1)} tiles, Easy ${x.avg('cpu3').toFixed(1)}`);
    ok(x.avg('cpu2') > y.avg('cpu2') + 1.5, `and the second at its own: Hard ${x.avg('cpu2').toFixed(1)}, Easy ${y.avg('cpu2').toFixed(1)}`);
  }

  console.log('7. the game log at a table of four');
  {
    const { checkLog } = require('../tools/check_gamelog.js');
    for (const layout of [{ names: ['Ann', 'Ben', 'Cy', 'Zed'], comps: 1 }, { names: ['Ann', 'Ben', 'Yan', 'Zed'], comps: 2 }]) {
      const events = [];
      const h = harness({ names: layout.names, computers: Array.from({ length: layout.comps }, () => ({ level: 'normal' })), rng: mulberry32(21), hand: 12, rounds: 4, gameLog: { write(evs) { events.push(...evs); } } }, 4);
      const done = await playOut(h, 21);
      const res = checkLog(events);
      ok(done && events.length > 100 && res.ok, `a hosted game with ${layout.comps} computer(s) is logged and the checker passes it` + (res.ok ? '' : ': ' + (res.problems[0] && res.problems[0].msg)));
      ok(events.find(e => e.e === 'round').players.length === 4, 'the log names all four players');
    }
    const events = [], store = {};
    const root = { set innerHTML(v) { this.h = v; }, get innerHTML() { return this.h || ''; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const app = G.createApp({ root, rng: mulberry32(8), paceRng: () => 0, chatRng: mulberry32(1008), nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, gameLog: { send(id, evs) { events.push(...evs); } }, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
    const S = app.state; app.dispatch({ type: 'boot' });
    app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'normal', cpus: 3, level2: 'easy', level3: 'hard' });
    const rnd = mulberry32(3); let guard = 0;
    while (guard++ < 40000 && !(S.modal && S.modal.type === 'final')) {
      const a = S.awaiting;
      if (a) {
        if (a.kind === 'modal') app.dispatch({ type: 'dialogOk' });
        else if (a.kind === 'draw') app.dispatch({ type: 'draw' });
        else if (a.kind === 'move') { const m = a.moves[Math.floor(rnd() * a.moves.length)]; app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); }
        else if (a.canDraw) app.dispatch({ type: 'draw' });
        else if (a.moves.length && rnd() < 0.6) { const m = a.moves[Math.floor(rnd() * a.moves.length)]; app.dispatch({ type: 'selectTile', key: key(m.tile) }); }
        else if (a.canDone) app.dispatch({ type: 'endBuild' });
        else app.dispatch({ type: 'undoTile' });
      }
      await wait(0);
    }
    const res = checkLog(events);
    ok(S.modal && S.modal.type === 'final' && events.length > 50 && res.ok, 'a game against three computers on this page is logged and the checker passes it' + (res.ok ? '' : ': ' + (res.problems[0] && res.problems[0].msg)));
    const head = events.find(e => e.e === 'game');
    ok(head && head.players.length === 4 && head.players.map(p => p.id).join() === IDS.join(), 'the log header lists the four players');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
