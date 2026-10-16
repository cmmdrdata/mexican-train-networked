'use strict';
// The list of past games: the SQLite store, the server keeping a game when it ends, and GET /history.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { GameHistory, hasSqlite } = require('../history.js');
require('./game.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const g = (over) => Object.assign({ startedAt: 1000, endedAt: 5000, result: 'finished', rounds: 3, roundsPlayed: 3, hand: 15, theme: 'classic',
  players: [{ name: 'Ann', score: 40, roundsWon: 1 }, { name: 'Ben', score: 25, roundsWon: 2 }, { name: 'Nadia', computer: true, level: 'hard', score: 25, roundsWon: 0 }] }, over);
(async () => {
  console.log('1. the store');
  ok(hasSqlite, 'this Node has SQLite (node:sqlite)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mthist-')), file = path.join(dir, 'sub', 'history.db');
  let h = new GameHistory({ file, max: 5 });
  ok(h.kind === 'sqlite' && fs.existsSync(file), 'it is a SQLite database in the file asked for (the folder is made)');
  ok(JSON.stringify(h.list(10)) === '[]', 'empty at first');
  const r = h.add(g());
  ok(r && r.id === 1 && h.add(g({ endedAt: 6000, players: [{ name: 'Cy', score: 9 }, { name: 'Di', score: 70 }] })).id === 2, 'games get numbers 1, 2, ...');
  let l = h.list(10);
  ok(l.length === 2 && l[0].id === 2 && l[1].id === 1, 'newest first');
  ok(JSON.stringify(l[1].winners) === '["Ben","Nadia"]' && l[1].players.length === 3 && l[1].players[2].computer === true && l[1].players[2].level === 'hard' && l[1].players[0].roundsWon === 1, 'a tie shares the win (lowest score); computers, levels and rounds won are kept, in seat order');
  ok(l[1].startedAt === 1000 && l[1].endedAt === 5000 && l[1].rounds === 3 && l[1].roundsPlayed === 3 && l[1].hand === 15 && l[1].theme === 'classic' && l[1].result === 'finished', 'with the times and the settings');
  h.add(g({ result: 'stopped', roundsPlayed: 1 }));
  l = h.list(1);
  ok(l.length === 1 && l[0].result === 'stopped' && l[0].winners.length === 0, 'a game that was stopped has no winner');
  for (let i = 0; i < 10; i++) h.add(g({ endedAt: 7000 + i }));
  ok(h.list(100).length === 5 && h.list(100)[0].id === 13, 'only the newest 5 are kept (max 5), and the rest of the tables go with the old games');
  h.close();
  h = new GameHistory({ file, max: 5 });
  ok(h.list(100).length === 5 && h.add(g()).id === 14, 'a new run of the server (a new open of the file) still has them, and the numbers go on');
  h.close();
  ok(new GameHistory({ file: null }).add(g()).id === 1, 'with no file it still works, in memory');
  const m = new GameHistory({ file: null }); m.add(g({ players: [] })); ok(m.list(5).length === 0, 'a game with no players is not kept');
  m.add(g({ players: [{ name: 'X'.repeat(200), score: -5 }] })); ok(m.list(1)[0].players[0].name.length === 40 && m.list(1)[0].players[0].score === 0, 'names are cut to 40 characters and scores are never negative');

  console.log('2. the server');
  const { createGameServer } = require('../server.js');
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mthist2-')), hf = path.join(dir2, 'history.db');
  const srv = createGameServer({ historyFile: hf, localOnly: true });
  await srv.listen(0, '127.0.0.1');
  const get = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: srv.port, path: p }, r => { let b = ''; r.on('data', c => { b += c; }); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej));
  let j = await get('/history'); ok(j.status === 200 && JSON.stringify(JSON.parse(j.body).games) === '[]', 'GET /history answers with an empty list');
  srv.history.add(g()); srv.history.add(g({ endedAt: 9000 })); srv.history.add(g({ endedAt: 9500 }));
  j = JSON.parse((await get('/history')).body); ok(j.games.length === 3 && j.games[0].endedAt === 9500, 'GET /history lists the games, newest first');
  j = JSON.parse((await get('/history?n=2')).body); ok(j.games.length === 2, '?n=2 gives the newest two');
  j = JSON.parse((await get('/history?n=99999')).body); ok(j.games.length === 3, 'a huge n is held to what there is');
  ok(!/password|token|session/i.test(JSON.stringify(j)), 'nothing secret in it');
  srv.close(); ok(fs.existsSync(hf), 'the database file is on disk');
  console.log('3. what a hosted match hands over');
  {
    const { OnlineMatch } = require('../online-match.js');
    const mulberry32 = globalThis.MexicanTrainGame.Engine.mulberry32;
    const tick = () => new Promise(r => setImmediate(r));
    for (const stop of [false, true]) {
      const m = new OnlineMatch({ names: ['Ann', 'Ben', 'Nadia'], computers: [{ level: 'easy' }], rounds: 2, hand: 8, stepDelay: 0, sleep: async () => {}, rng: mulberry32(5), push() {} });
      const run = m.start(); let steps = 0;
      while (!m.over && steps < 20000) {
        for (const seat of m.humans) {
          const v = m.viewFor(seat), a = v.awaiting; if (!a || m.paused) continue;
          let it;
          if (a.kind === 'modal') it = { a: 'ok' }; else if (a.kind === 'draw') it = { a: 'draw' };
          else if (a.kind === 'move') it = { a: 'play', tile: a.moves[0].tile, train: a.moves[0].trainId };
          else if (a.canDraw) it = { a: 'draw' }; else if (a.canBuild) it = { a: 'autoBuild' }; else if (a.canDone) it = { a: 'done' }; else it = { a: 'undo' };
          m.intent(seat, it); steps++;
        }
        await tick();
        if (stop && m.roundsPlayed >= 1) { m.abort(); break; }
      }
      await run;
      const sm = m.summary(); if (process.env.VERBOSE) console.log(JSON.stringify(sm));
      const h = new GameHistory({ file: null }); const rec = h.add(sm);
      ok(sm.players.length === 3 && sm.players[2].computer === true && sm.players[2].level === 'easy' && sm.players[0].name === 'Ann', `${stop ? 'stopped' : 'finished'}: the players, in seat order, with the computer marked`);
      ok(stop ? (sm.result === 'stopped' && sm.roundsPlayed === 1 && rec.winners.length === 0) : (sm.result === 'finished' && sm.roundsPlayed === sm.rounds && rec.winners.length >= 1), `${stop ? 'stopped after one round: no winner' : 'finished after every round, with a winner'}`);
      ok(sm.players.every((p, i) => p.score === m.totals[['human', 'cpu', 'cpu2'][i]]) && sm.players.reduce((n, p) => n + p.roundsWon, 0) <= sm.roundsPlayed && sm.startedAt > 0 && sm.endedAt >= sm.startedAt, `${stop ? 'stopped' : 'finished'}: scores are the match's totals, rounds won add up, times make sense`);
      if (!stop) ok(rec.winners.every(w => rec.players.find(p => p.name === w).score === Math.min(...rec.players.map(p => p.score))), 'the winner has the lowest score');
    }
  }
  console.log('4. a whole hosted game through the server is kept');
  {
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'mthist3-')), hf3 = path.join(dir3, 'history.db');
    const srv3 = createGameServer({ pagePath: path.join(__dirname, '..', 'mexican-train.html'), stepDelay: 0, sleep: async () => {}, log: () => {}, heartbeatMs: 60000, softGraceMs: 0, historyFile: hf3, localOnly: true });
    const port = await srv3.listen(0, '127.0.0.1');
    const wait = ms => new Promise(r => setTimeout(r, ms));
    class C { constructor() { this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); this.msgs = []; this.view = null; this.ws.onmessage = e => { const m = JSON.parse(e.data); this.msgs.push(m); if (m.t === 'state') { this.view = m.view; this.seq = m.seq; } else if (m.t === 'error' || m.t === 'bad') { this.answered = null; this.errs = (this.errs || 0) + 1; } }; }
      open() { return new Promise(r => { this.ws.onopen = () => r(this); }); } send(o) { this.ws.send(JSON.stringify(o)); } }
    const host = await new C().open(), guest = await new C().open();
    host.send({ t: 'create', name: 'Ann', rounds: 4, hand: 8, humans: 2, computer: 'normal' });
    let t0 = Date.now(); while (!host.msgs.find(m => m.t === 'created') && Date.now() - t0 < 3000) await wait(5);
    guest.send({ t: 'join', code: host.msgs.find(m => m.t === 'created').code, name: 'Ben' });
    t0 = Date.now(); while (!host.msgs.find(m => m.t === 'lobby' && m.canStart) && Date.now() - t0 < 3000) await wait(5);
    host.send({ t: 'start' });
    let id = 1; const done = c => c.view && c.view.modal && c.view.modal.type === 'final';
    t0 = Date.now();
    while (!(done(host) && done(guest)) && Date.now() - t0 < 90000) {
      for (const c of [host, guest]) {
        const a = c.view && c.view.awaiting; if (!a || c.answered === c.seq) continue;
        let it;
        if (a.kind === 'modal') it = { a: 'ok' }; else if (a.kind === 'draw') it = { a: 'draw' };
        else if (a.kind === 'move') it = { a: 'play', tile: a.moves[0].tile, train: a.moves[0].trainId };
        else if (a.canDraw) it = { a: 'draw' }; else if (a.canBuild) it = { a: 'autoBuild' }; else if (a.canDone) it = { a: 'done' }; else it = { a: 'undo' };
        c.send(Object.assign({ t: 'i', id: id++ }, it)); c.answered = c.seq;          // (one answer for each state the server sends)
      }
      await wait(20);
    }
    if (!done(host)) console.log('STALL', host.errs, guest.errs, JSON.stringify(host.msgs.filter(m => m.t !== 'say' && m.t !== 'state').slice(-3)).slice(0, 800));
    ok(done(host), 'the hosted game played through to the final score');
    await wait(100);
    const list = srv3.history.list(5);
    ok(list.length === 1 && list[0].result === 'finished' && list[0].rounds === 4 && list[0].roundsPlayed === 4, 'when it finished it was put in the list (one game, finished, 4 of 4 rounds)');
    ok(list[0].players.map(p => p.name).join() === 'Ann,Ben,' + list[0].players[2].name && list[0].players[2].computer === true && list[0].players[2].level === 'normal', 'with the people and the computer');
    const tot = host.view.modal.totals, tv = Object.values(tot); if (process.env.VERBOSE) console.log(JSON.stringify(tot));
    ok(list[0].players.every((p, i) => p.score === tv[i]), 'and the same final scores as the players saw (' + tv + ')');
    ok(list[0].winners.length >= 1 && list[0].winners.every(w => list[0].players.find(p => p.name === w).score === Math.min(...list[0].players.map(p => p.score))), 'and the winner: ' + list[0].winners.join(' and '));
    host.ws.close(); guest.ws.close();
    await wait(50);
    ok(srv3.history.list(5).length === 1, 'the people leaving afterwards does not add anything');
    await srv3.close();
    const reopened = new GameHistory({ file: hf3 }); ok(reopened.list(5).length === 1, 'and it is in the file after the server has stopped'); reopened.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
