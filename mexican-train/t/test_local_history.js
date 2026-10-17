'use strict';
// A game a person plays alone against the computer is in the list of past games, like a hosted one: the server tallies the events the page posts (/gamelog) and, at the game's end, keeps a summary.
const http = require('http');
const { LocalTally } = require('../gamelog.js');
const { createGameServer } = require('../server.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const GAME = { e: 'game', mode: 'local', startedAt: '2026-10-17T15:00:00.000Z', rounds: 4, hand: 15, theme: 'classic', players: [{ id: 'human', name: 'Alexandria', kind: 'human' }, { id: 'cpu', name: 'Zed', kind: 'computer', level: 'hard' }] };
const roundEnd = (r, winner, totals) => ({ e: 'roundEnd', round: r, winner, blocked: false, tie: false, pips: {}, hands: {}, totals });
const post = (port, body) => new Promise((resolve, reject) => { const q = http.request({ host: '127.0.0.1', port, path: '/gamelog', method: 'POST', headers: { 'Content-Type': 'text/plain' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); q.on('error', reject); q.end(JSON.stringify(body)); });
const getJson = (port, p) => new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port, path: p }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve(JSON.parse(b))); }).on('error', reject); });

(async () => {
  console.log('1. the tally');
  {
    const t = new LocalTally();
    ok(t.observe('game000001', [GAME]) === null && t.observe('game000001', [roundEnd(0, 'human', { human: 20, cpu: 35 })]) === null, 'nothing until the game ends');
    t.observe('game000001', [roundEnd(1, 'cpu', { human: 50, cpu: 35 }), roundEnd(2, 'human', { human: 50, cpu: 60 })]);
    const s = t.observe('game000001', [{ e: 'gameEnd', how: 'finished', totals: { human: 50, cpu: 60 } }]);
    ok(s && s.result === 'finished' && s.roundsPlayed === 3 && s.rounds === 4 && s.hand === 15 && s.theme === 'classic', 'a finished game: result, rounds played and set, hand, theme');
    ok(s && s.players[0].name === 'Alexandria' && !s.players[0].computer && s.players[0].score === 50 && s.players[0].roundsWon === 2, 'the person, by name, with the score and the rounds won');
    ok(s && s.players[1].name === 'Zed' && s.players[1].computer && s.players[1].level === 'hard' && s.players[1].score === 60 && s.players[1].roundsWon === 1, 'the computer, with its skill');
    ok(s && s.startedAt === Date.parse('2026-10-17T15:00:00.000Z'), 'when it started');
    ok(t.observe('game000001', [{ e: 'gameEnd', how: 'finished', totals: {} }]) === null, 'only once');
    t.observe('stopped0001', [GAME, roundEnd(0, 'human', { human: 10, cpu: 12 })]);
    const st = t.observe('stopped0001', [{ e: 'gameEnd', how: 'aborted', totals: { human: 10, cpu: 12 } }]);
    ok(st && st.result === 'stopped' && st.roundsPlayed === 1, 'a game given up after a round is kept as stopped');
    t.observe('empty000001', [GAME]);
    ok(t.observe('empty000001', [{ e: 'gameEnd', how: 'aborted', totals: {} }]) === null, 'a game with no finished round is not kept');
    ok(t.observe('nogame00001', [{ e: 'gameEnd', how: 'finished', totals: {} }]) === null && t.observe(5, 'x') === null && t.observe('junk000001', [null, 3, 'a']) === null, 'rubbish and a game never seen start: nothing');
  }
  console.log('2. through the server, with and without a game log');
  for (const withLog of [false, true]) {
    const os = require('os'), fs = require('fs'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-lh-'));
    const server = createGameServer(Object.assign({ localOnly: true, publicIp: false }, withLog ? { gameLog: true, gamesDir: dir } : {}));
    const port = await server.listen(0);
    const id = 'localgame' + (withLog ? 'A' : 'B');
    ok(await post(port, { id, events: [GAME] }) === 204, `[log ${withLog}] the first events are taken`);
    ok((await getJson(port, '/history')).games.length === 0, `[log ${withLog}] nothing in the list while it is being played`);
    await post(port, { id, events: [roundEnd(0, 'human', { human: 5, cpu: 30 })] });
    await post(port, { id, events: [{ e: 'gameEnd', how: 'finished', totals: { human: 5, cpu: 30 } }] });
    const list = (await getJson(port, '/history')).games;
    ok(list.length === 1 && list[0].result === 'finished' && list[0].players.length === 2, `[log ${withLog}] when it ends it is in the list`);
    ok(list[0] && list[0].winners.join() === 'Alexandria' && list[0].players[0].name === 'Alexandria' && list[0].players[1].computer === true, `[log ${withLog}] the person is the winner, by name, against a computer`);
    await post(port, { id, events: [{ e: 'gameEnd', how: 'finished', totals: { human: 5, cpu: 30 } }] });
    ok((await getJson(port, '/history')).games.length === 1, `[log ${withLog}] and a repeat does not add it again`);
    if (server.http.closeAllConnections) server.http.closeAllConnections();
    await server.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
