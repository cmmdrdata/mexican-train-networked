'use strict';
// The game log (games/): every game's boneyard, every hand as dealt, every draw and every play, written to a file for debugging later.
//   1. the recorder: a log of whole rounds (two and three players, every level) that the checker says adds up
//   2. the hooks wrapper changes nothing about what the game does; a failing log never stops a game; NOTHING OF A ROUND LEAVES MEMORY UNTIL THE ROUND IS OVER (the round buffer)
//   3. the checker notices a log that was tampered with
//   4. the files: the directory is made, one JSON Lines file per game, names that cannot escape, a size limit, a disk that fails
//   5. the server: POST /gamelog from this computer only, size limits, off unless asked for
//   6. a game between people on the server writes its own log
//   7. a game in the page against the computer: sent to the server, written, and it adds up; a game left half way is ended in its log
//   8. the tools and the command line
const fs = require('fs'), os = require('os'), path = require('path'), { spawn, spawnSync } = require('child_process');
const { OnlineMatch } = require('../online-match.js');         // (loads the game's code: the match and this test use the very same copy of it)
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32, newRound, playRound, cpuChooseAsync, cpuBuildAction } = E;
const { GameLogs, stamp, safe, isThisComputer, MAX_EVENTS_PER_POST } = require('../gamelog.js');
const { checkLog, parseLog, describe } = require('../tools/check_gamelog.js');
const { createGameServer } = require('../server.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => setImmediate(r));
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-gamelog-'));
const silent = { onNeedDraw() {}, onDraw() {}, onPass() {}, onPlay() {} };
const clone = x => JSON.parse(JSON.stringify(x));
const readEvents = file => parseLog(fs.readFileSync(file, 'utf8')).events;

/* One whole round, played by computers, recorded the way the page and the server record it. */
async function recordRound(players, seed, level, hand) {
  const events = []; let clockT = 0;
  const rec = G.createRecorder(ev => events.push(ev), () => (clockT += 7));
  const first = seed % players;
  const g = newRound({ engine: 12 - (seed % 13), handSize: hand, rng: mulberry32(seed), simultaneousOpening: true, players });
  const ids = g.players.map(p => p.id);
  g.players.forEach((p, i) => { p.name = 'P' + i; });
  rec.game({ mode: 'local', rounds: 1, hand, players: ids.map((id, i) => ({ id, name: 'P' + i, kind: i ? 'computer' : 'human', level: i ? level : undefined })) });
  rec.round(g, 0, first);
  const ctl = {}; ids.forEach(id => { ctl[id] = { act: async (gm, p, info) => cpuBuildAction(gm, p, info, level), choose: async (gm, p, moves) => cpuChooseAsync(gm, p, moves, level) }; });
  const result = await playRound(g, first, ctl, G.recordingUi(silent, rec));
  const totals = {}; g.players.forEach(p => { totals[p.id] = E.handPips(p); });
  rec.roundEnd(g, result, totals); rec.gameEnd(totals, 'finished');
  return { events, g, result, totals, ids };
}

(async () => {
  console.log('1. the recorder, on whole rounds');
  const good = [];
  {
    let bad = 0, firstBad = null; const sum = { draws: 0, plays: 0, passes: 0, undos: 0, rounds: 0 };
    for (let i = 0; i < 60; i++) {
      const players = i % 3 === 2 ? 3 : 2, level = ['easy', 'normal', 'hard'][i % 3], hand = [8, 12, 15][i % 3];
      const r = await recordRound(players, 100 + i, level, hand);
      const res = checkLog(r.events);
      if (!res.ok) { bad++; if (!firstBad) firstBad = `round ${i}: ${res.problems[0].msg}`; }
      Object.keys(sum).forEach(k => { sum[k] += res.summary[k] || 0; });
      if (i < 20) good.push(r);
    }
    ok(bad === 0, `60 whole rounds (two and three players, every level, 8, 12 and 15 tiles): the checker says every one of their logs adds up${firstBad ? ' (first that did not: ' + firstBad + ')' : ''}`);
    ok(sum.rounds === 60 && sum.draws > 20 && sum.plays > 1000 && sum.passes > 0 && sum.undos > 0, `and they were full of the things a log must hold: ${sum.plays} plays, ${sum.draws} draws, ${sum.passes} passes, ${sum.undos} tiles taken back`);
    const r = good[0], ev = r.events;
    ok(ev[0].e === 'game' && ev[0].version === 1 && ev[1].e === 'round' && ev[ev.length - 2].e === 'roundEnd' && ev[ev.length - 1].e === 'gameEnd', 'a log begins with the game and the deal, and ends with the round\'s result and the game\'s');
    const dealt = ev[1];
    ok(dealt.boneyard.length + Object.values(dealt.hands).reduce((n, h) => n + h.length, 0) === 90 && Object.keys(dealt.hands).join() === r.ids.join() && typeof dealt.first === 'string' && r.ids.includes(dealt.first), 'the deal holds the whole boneyard and every hand: 90 tiles');
    ok(ev.every((e, i) => e.n === i + 1) && ev.every((e, i) => i === 0 || e.t >= ev[i - 1].t), 'the events are numbered 1, 2, 3 ... and the time only goes forward');
    ok(ev.some(e => e.e === 'openingDone') && ev.filter(e => e.e === 'done' || e.e === 'pass' || e.e === 'play').length > 0, 'the opening and the game that follows are both in it');
    ok(good.every(r => r.events.filter(e => e.e === 'draw').every(e => e.phase === 'opening' || e.phase === 'turn')) && good.every(r => r.events.filter(e => e.e === 'play').every(e => /^\d+-\d+$/.test(e.tile) && /^\d+-\d+$/.test(e.placed))), 'tiles are written a-b, and each draw and play says whether it was in the opening');
  }

  console.log('2. the recorder changes nothing');
  {
    const calls = [];
    const base = { onPlay: async (...a) => { calls.push(['play', ...a]); return 'kept'; }, extra: 5, onDraw: undefined };
    const w = G.recordingUi(base, { onPlay: (...a) => calls.push(['rec', ...a]) });
    const r = await w.onPlay(1, 2, 3, 4);
    ok(r === 'kept' && calls.length === 2 && calls[0][0] === 'rec' && calls[1][0] === 'play' && calls[1].slice(1).join() === '1,2,3,4', 'the recorder hears each event first, then the real hook runs with the very same arguments and its answer is returned');
    ok(w.extra === 5 && (await w.onDraw(1, 2, 3)) === undefined, 'everything else of the original is still there, and a hook the original does not have does nothing');
    ok(G.LOG_HOOKS.every(h => typeof w[h] === 'function'), 'every hook the engine can call is there to be called');
    const w2 = G.recordingUi(base, { onPlay() { throw new Error('boom'); } });
    ok((await w2.onPlay(1)) === 'kept', 'a recorder that throws does not stop the game');
    let thrown = false; try { const rec = G.createRecorder(() => { throw new Error('disk full'); }); rec.game({}); rec.round({ engine: 12, players: [], boneyard: [], hands: {} }, 0, 0); } catch (e) { thrown = true; }
    ok(!thrown, 'and neither does a log that cannot be written');
    // nothing leaves memory until the round is over
    const out = [], buf = G.createRoundBuffer(events => out.push(events.map(e => e.e)));
    ['game', 'round', 'draw', 'play', 'play', 'pass'].forEach((e, i) => buf.push({ e, n: i + 1 }));
    ok(out.length === 0 && buf.pending === 6, 'THE ROUND BUFFER holds everything while a round is played: for the game, the deal (every hand and the boneyard), draws, plays and passes, nothing is let go');
    buf.push({ e: 'roundEnd', n: 7 });
    ok(out.length === 1 && out[0].join() === 'game,round,draw,play,play,pass,roundEnd' && buf.pending === 0, 'and lets it all go together, in order, when the round ends (the first round with the game event at its head)');
    buf.push({ e: 'round', n: 8 }); buf.push({ e: 'play', n: 9 });
    ok(out.length === 1 && buf.pending === 2, 'the next round is held in its turn: nothing of it is let go');
    buf.push({ e: 'gameEnd', n: 10 });
    ok(out.length === 2 && out[1].join() === 'round,play,gameEnd', 'and what is held when the game ends (finished, or stopped half way) is let go with its end');
    buf.flush();
    ok(out.length === 2, '(with nothing held, nothing is sent)');
    let t2 = false; try { G.createRoundBuffer(() => { throw new Error('disk'); }).push({ e: 'roundEnd' }); } catch (e) { t2 = true; }
    ok(!t2, 'and a place to write to that fails does not stop the game');
    // the same round, with and without the recorder, is played exactly the same
    const plain = newRound({ engine: 12, handSize: 12, rng: mulberry32(77), simultaneousOpening: true, players: 2 }), logged = newRound({ engine: 12, handSize: 12, rng: mulberry32(77), simultaneousOpening: true, players: 2 });
    const mk = () => ({ human: { act: async (g, p, i) => cpuBuildAction(g, p, i, 'hard'), choose: async (g, p, m) => cpuChooseAsync(g, p, m, 'hard') }, cpu: { act: async (g, p, i) => cpuBuildAction(g, p, i, 'hard'), choose: async (g, p, m) => cpuChooseAsync(g, p, m, 'hard') } });
    await playRound(plain, 0, mk(), silent);
    const rec = G.createRecorder(() => {}); await playRound(logged, 0, mk(), G.recordingUi(silent, rec));
    ok(JSON.stringify([plain.trains, plain.players.map(p => p.hand)]) === JSON.stringify([logged.trains, logged.players.map(p => p.hand)]), 'a round played with the recorder ends exactly as the same round without it (the recorder uses none of the game\'s random numbers)');
  }

  console.log('3. the checker notices a log that was tampered with');
  {
    const r = good.find(x => x.events.some(e => e.e === 'draw') && x.events.some(e => e.e === 'play' && e.phase === 'turn' && e.tile.split('-')[0] !== e.tile.split('-')[1])) || good[0];
    const ev = r.events;
    ok(checkLog(clone(ev)).ok, '(a log as it was written is fine)');
    const detects = (name, fn, why) => { const c = clone(ev); const did = fn(c); const res = checkLog(c); ok(did !== false && !res.ok && (!why || res.problems.some(p => why.test(p.msg))), `${name}: ${res.ok ? 'NOT noticed' : (why && !res.problems.some(p => why.test(p.msg)) ? 'noticed, but not for the right reason: ' + res.problems[0].msg.slice(0, 70) : 'noticed (' + res.problems[0].msg.slice(0, 70) + ')')}`); };
    detects('a drawn tile that was not the top of the boneyard', c => { const d = c.find(e => e.e === 'draw'); if (!d) return false; d.tile = d.tile === '0-1' ? '0-2' : '0-1'; }, /top of the boneyard/);
    detects('a tile played the wrong way round', c => { const p = c.find(e => e.e === 'play' && e.tile.split('-')[0] !== e.tile.split('-')[1]); if (!p) return false; p.placed = p.placed.split('-').reverse().join('-'); }, /laid on a train that ends|placed as/);
    detects('an event missing from the middle', c => { c.splice(Math.floor(c.length / 2), 1); }, /event number/);
    detects('the same tile dealt twice', c => { const d = c[1]; const ids = Object.keys(d.hands); d.hands[ids[0]][0] = d.hands[ids[1]][0]; }, /more than once/);
    detects('a total that is wrong', c => { const e = c.find(x => x.e === 'roundEnd'); const id = Object.keys(e.totals)[0]; e.totals[id] += 1; }, /total/);
    detects('pips that are wrong', c => { const e = c.find(x => x.e === 'roundEnd'); const id = Object.keys(e.pips)[0]; e.pips[id] += 1; }, /pips left/);
    detects('a hand left at the end that is not the hand they had', c => { const e = c.find(x => x.e === 'roundEnd'); const id = Object.keys(e.hands).find(i => e.hands[i].length); if (!id) return false; e.hands[id][0] = e.hands[id][0] === '0-1' ? '0-2' : '0-1'; });
    detects('a player who is not at the table', c => { c.find(e => e.e === 'play').player = 'zed'; }, /unknown player/);
    detects('a play of a tile the player did not hold', c => { const p = c.find(e => e.e === 'play'); const other = Object.keys(c[1].hands).find(i => i !== p.player); p.tile = c[1].hands[other][0]; }, /not in their hand|placed as/);
    detects('the time going backwards', c => { c[4].t = -5; }, /time went backwards/);
    detects('a log that does not begin with its game', c => { c.shift(); }, /begin with/);
    detects('a play on a train that does not end in that number', c => { const p = c.find(e => e.e === 'play' && e.phase === 'turn' && e.tile.split('-')[0] !== e.tile.split('-')[1]); if (!p) return false; p.placed = p.placed.split('-').reverse().join('-'); p.end = Number(p.placed.split('-')[1]); });
    detects('a round that ends with the wrong game total', c => { const e = c.find(x => x.e === 'gameEnd'); const id = Object.keys(e.totals)[0]; e.totals[id] += 5; });
    // text: a half-written last line is reported, not crashed on
    const text = ev.map(e => JSON.stringify(e)).join('\n') + '\n{"e":"play","n":';
    const parsed = parseLog(text);
    ok(parsed.events.length === ev.length && parsed.problems.length === 1 && /last line/.test(parsed.problems[0].msg), 'a log cut off in the middle of a line (the game stopped while it was being written): the rest is read, and the cut is reported');
    ok(typeof describe(ev[1], { human: 'You' }) === 'string' && ev.every(e => describe(e, {}).includes('#' + e.n)), 'every kind of event can be printed as a line of the transcript');
  }

  console.log('4. the files');
  {
    const dir = path.join(TMP, 'a', 'b', 'games');
    ok(!fs.existsSync(dir), '(the directory does not exist yet)');
    const errs = [];
    const gl = new GameLogs({ dir, onError: e => errs.push(e) });
    ok(fs.existsSync(dir) && fs.statSync(dir).isDirectory() && gl.dir === path.resolve(dir), 'making the log makes the games directory, with any directory above it that is missing');
    new GameLogs({ dir });
    ok(fs.existsSync(dir), '(and making it again when it is there is fine)');
    ok(/^\d{8}-\d{6}$/.test(stamp(new Date(2026, 9, 12, 14, 39, 5))) && stamp(new Date(2026, 9, 12, 14, 39, 5)) === '20261012-143905', 'a file is named by the moment its game began: 20261012-143905');
    ok(safe('../../etc/passwd') === 'etcpasswd' && safe('') === 'game' && safe('a b/c') === 'abc', 'anything that goes into a file name is cleaned: no slashes, dots or spaces');
    const h = gl.forHosted('ABCD12');
    ok(path.dirname(h.file) === path.resolve(dir) && /^\d{8}-\d{6}-hosted-ABCD12\.jsonl$/.test(path.basename(h.file)), 'a game between people: ...-hosted-CODE.jsonl in the directory');
    h.write({ e: 'game', n: 1, t: 0 }); h.write({ e: 'round', n: 2, t: 5, boneyard: ['1-2'] });
    const lines = fs.readFileSync(h.file, 'utf8').split('\n');
    ok(lines.length === 3 && lines[2] === '' && JSON.parse(lines[0]).e === 'game' && JSON.parse(lines[1]).boneyard[0] === '1-2', 'each event is a line of JSON, written as it happens (JSON Lines)');
    ok(gl.acceptLocal('abc123def', [{ e: 'game', n: 1, t: 0 }]) === true && gl.acceptLocal('abc123def', [{ e: 'round', n: 2, t: 9 }, { e: 'x', n: 3, t: 9 }]) === true, 'a page\'s events are kept');
    const localFiles = fs.readdirSync(dir).filter(f => f.includes('-local-'));
    ok(localFiles.length === 1 && /-local-abc123def\.jsonl$/.test(localFiles[0]) && fs.readFileSync(path.join(dir, localFiles[0]), 'utf8').trim().split('\n').length === 3, 'all of one page game\'s batches go into one file, in order');
    const before = fs.readdirSync(dir).length;
    ok([gl.acceptLocal('x', [{ e: 'a' }]), gl.acceptLocal('../../escape12', [{ e: 'a' }]), gl.acceptLocal('abc 123 def', [{ e: 'a' }]), gl.acceptLocal(12345678, [{ e: 'a' }]), gl.acceptLocal('abcdefgh', 'nope'), gl.acceptLocal('abcdefgh', []), gl.acceptLocal('abcdefgh', [1, 'x', null, [], { n: 1 }]), gl.acceptLocal('abcdefgh', new Array(MAX_EVENTS_PER_POST + 1).fill({ e: 'a' }))].every(r => r === false), 'an id that is too short or has anything but letters, digits, _ and -; events that are not a list of objects with a name; or far too many at once: all refused');
    ok(fs.readdirSync(dir).length === before && !fs.existsSync(path.join(TMP, 'escape12')), '... and none of them made a file, or one outside the directory');
    ok(gl.acceptLocal('bigevent1', [{ e: 'big', pad: 'x'.repeat(30000) }, { e: 'ok', n: 1 }]) === true && fs.readFileSync(gl.files.get('bigevent1').file, 'utf8').trim().split('\n').length === 1, 'an event that is absurdly large is left out, the others are kept');
    // a size limit
    const small = new GameLogs({ dir: path.join(TMP, 'small'), maxBytes: 400 }), sh = small.forHosted('SMALL1');
    let accepted = 0, refused = 0; for (let i = 0; i < 30; i++) { if (sh.write({ e: 'play', n: i + 1, t: i, tile: '1-2' })) accepted++; else refused++; }
    const smallText = fs.readFileSync(sh.file, 'utf8'), smallLines = smallText.trim().split('\n');
    ok(accepted > 3 && refused > 0 && JSON.parse(smallLines[smallLines.length - 1]).e === 'logTruncated' && smallText.length < 400 + 120 && smallLines.filter(l => JSON.parse(l).e === 'logTruncated').length === 1, `a game's file stops growing at its limit and says so, once (${accepted} events kept, then "logTruncated", ${smallText.length} bytes)`);
    // somebody removes the directory while the server is running
    fs.rmSync(path.join(TMP, 'small'), { recursive: true, force: true });
    const re = new GameLogs({ dir: path.join(TMP, 'small') }), rh = re.forHosted('AGAIN1'); fs.rmSync(path.join(TMP, 'small'), { recursive: true, force: true });
    ok(rh.write({ e: 'game', n: 1, t: 0 }) === true && fs.existsSync(rh.file), 'the directory removed while the server runs: it is made again and the log goes on');
    // a disk that fails: never stops a game
    const blocker = path.join(TMP, 'iamafile'); fs.writeFileSync(blocker, 'x');
    const errs2 = []; let boom = false, w1, w2;
    try { const bad = new GameLogs({ dir: path.join(blocker, 'sub'), onError: e => errs2.push(e) }); const bh = bad.forHosted('BAD001'); w1 = bh.write({ e: 'a' }); w2 = bad.acceptLocal('abcdefgh', [{ e: 'a' }]); } catch (e) { boom = true; }
    ok(!boom && errs2.length === 1 && w1 === false && w2 === false, 'a games directory that cannot be made: the error is reported once, the log switches itself off, and nothing throws');
    {
      const errs3 = []; let boom3 = false, r1, r2, r3;
      const g3 = new GameLogs({ dir: path.join(TMP, 'eisdir'), onError: e => errs3.push(e) }), h3 = g3.forHosted('NOFILE');
      fs.mkdirSync(h3.file);                                                 // (the log's file cannot be written: something that is not a file is there)
      try { r1 = h3.write({ e: 'a' }); r2 = h3.write({ e: 'b' }); r3 = g3.acceptLocal('abcdefgh', [{ e: 'a' }]); } catch (e) { boom3 = true; }
      ok(!boom3 && r1 === false && r2 === false && r3 === false && errs3.length === 1 && g3.failed, 'a file that cannot be written (the disk is full, or not allowed): reported once, the log switches itself off, and nothing throws into the game');
    }
    ok(isThisComputer('127.0.0.1') && isThisComputer('127.8.9.1') && isThisComputer('::1') && isThisComputer('::ffff:127.0.0.1') && !isThisComputer('8.8.8.8') && !isThisComputer('192.0.2.55') && !isThisComputer('') && !isThisComputer(undefined), 'this computer: the loopback address in any form; not other addresses, and not "nobody"');
    const own = Object.values(os.networkInterfaces()).flat().filter(Boolean).find(i => !i.internal && i.family === 'IPv4');
    if (own) ok(isThisComputer(own.address) && isThisComputer('::ffff:' + own.address), 'and this computer\'s own network address too (someone who opened the page by it)');
  }

  console.log('5. the server');
  {
    const http = require('http');
    const post = (port, body, p) => new Promise((resolve, reject) => { const req = http.request({ host: '127.0.0.1', port, path: p || '/gamelog', method: 'POST', headers: { 'Content-Type': 'text/plain' } }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); }); req.on('error', reject); req.end(typeof body === 'string' ? body : JSON.stringify(body)); });
    const get = (port, p) => new Promise((resolve, reject) => { http.get({ host: '127.0.0.1', port, path: p }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, allow: res.headers.allow })); }).on('error', reject); });
    const dir = path.join(TMP, 'srv', 'games');
    const server = createGameServer({ localOnly: true, publicIp: false, gameLog: true, gamesDir: dir, maxLogPost: 4000 });
    ok(fs.existsSync(dir) && server.gameLogDir === path.resolve(dir), 'the games directory exists as soon as the server is made (before anyone has played), and the server says where it is');
    const port = await server.listen(0);
    const batch1 = [{ e: 'game', n: 1, t: 0, mode: 'local' }, { e: 'round', n: 2, t: 4 }];
    let r = await post(port, { id: 'gameid1234', events: batch1 });
    ok(r.status === 204, `a page's events are accepted from this computer (${r.status})`);
    r = await post(port, { id: 'gameid1234', events: [{ e: 'draw', n: 3, t: 8 }] });
    const f = fs.readdirSync(dir).filter(x => x.includes('-local-gameid1234'));
    ok(r.status === 204 && f.length === 1 && fs.readFileSync(path.join(dir, f[0]), 'utf8').trim().split('\n').map(l => JSON.parse(l).n).join() === '1,2,3', 'the next batch goes on at the end of the same file');
    ok((await get(port, '/gamelog')).status === 405 && (await get(port, '/gamelog')).allow === 'POST', 'it is for POST only');
    ok((await post(port, 'not json at all')).status === 400 && (await post(port, '[1,2,3]')).status === 400 && (await post(port, { id: 'x', events: [{ e: 'a' }] })).status === 400 && (await post(port, { id: 'abcdefgh', events: 'no' })).status === 400, 'rubbish is refused: not JSON, not an object, a bad id, events that are not a list');
    ok((await post(port, { id: 'bigbigbig1', events: [{ e: 'a', pad: 'y'.repeat(6000) }] })).status === 413, 'more than the limit in one go is refused (413)');
    ok(fs.readdirSync(dir).length === 1, '(and none of that made a file)');
    {
      const { EventEmitter } = require('events');
      const ask = (addr, body) => { const q = new EventEmitter(); Object.assign(q, { method: 'POST', url: '/gamelog', headers: {}, socket: { remoteAddress: addr } }); const res = { status: null, body: '', writeHead(c) { res.status = c; }, end(b) { res.body += b || ''; } }; server.http.emit('request', q, res); if (body !== undefined) { q.emit('data', Buffer.from(JSON.stringify(body))); q.emit('end'); } return res; };
      const before = fs.readdirSync(dir).length;
      const stranger = ask('192.0.2.55', { id: 'strangerid1', events: [{ e: 'game', n: 1, t: 0 }] }), strangerV6 = ask('2001:db8::1', { id: 'strangerid2', events: [{ e: 'game', n: 1, t: 0 }] });
      ok(stranger.status === 403 && strangerV6.status === 403 && fs.readdirSync(dir).length === before, 'SOMEONE ELSE ON THE NETWORK cannot add to the log: a request from another address is refused (403) and nothing is written');
      const local = ask('::ffff:127.0.0.1', { id: 'localid12345', events: [{ e: 'game', n: 1, t: 0 }] });
      ok(local.status === 204 && fs.readdirSync(dir).length === before + 1, '(and one from this computer, in the form a dual-stack server sees it, is taken)');
    }
    ok((await get(port, '/healthz')).status === 200 && (await get(port, '/nothing')).status === 404, 'the rest of the server is as it was');
    if (server.http.closeAllConnections) server.http.closeAllConnections();
    await server.close();
    const off = createGameServer({ localOnly: true, publicIp: false });
    const offPort = await off.listen(0);
    ok((await post(offPort, { id: 'gameid1234', events: batch1 })).status === 204 && off.gameLogDir === null, 'a server not asked to keep a log takes the events (for the list of past games) and writes none (this is how every test server is made: nothing in the tests writes to games/)');
    if (off.http.closeAllConnections) off.http.closeAllConnections();
    await off.close();
    ok(/gameLog: gamelogs \? gamelogs\.forHosted\(/.test(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8')), 'a game between people gets its log from the server (the match is given one when it is made)');
  }

  console.log('6. a game between people on the server');
  {
    function fakeTimer() {
      let id = 0, t = 0; const q = [];
      return { q, get now() { return t; }, set(fn, ms) { q.push({ id: ++id, fn, at: t + ms }); return id; }, clear(x) { const i = q.findIndex(e => e.id === x); if (i >= 0) q.splice(i, 1); },
        advance(ms) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const e = q[0]; if (!e || e.at > end) break; q.shift(); t = e.at; e.fn(); } t = end; } };
    }
    async function drive(m, timer, until, cap) {
      for (let n = 0; n < cap && !until(); n++) {
        for (const seat of m.humans) {
          const v = m.viewFor(seat); if (!v.awaiting) continue; const a = v.awaiting;
          if (a.kind === 'modal') m.intent(seat, { a: 'ok' });
          else if (a.kind === 'draw') m.intent(seat, { a: 'draw' });
          else if (a.kind === 'move') { const mv = a.moves[0]; m.intent(seat, { a: 'play', tile: mv.tile, train: mv.trainId }); }
          else if (a.canDraw) m.intent(seat, { a: 'draw' }); else if (a.moves.length && a.placed < 2) { const mv = a.moves[0]; m.intent(seat, { a: 'play', tile: mv.tile, train: mv.trainId }); } else m.intent(seat, { a: a.canDone ? 'done' : 'undo' });
        }
        timer.advance(300); await tick();
      }
    }
    const gl = new GameLogs({ dir: path.join(TMP, 'hosted') });
    const mkMatch = (code, seed, rounds) => { const timer = fakeTimer(); const w = gl.forHosted(code); const m = new OnlineMatch({ names: ['Ann', 'Ben', 'Gandalf'], computer: { level: 'easy' }, theme: 'classic', rounds: rounds || 1, hand: 8, stepDelay: 0, nativeChance: 0, foodChance: 0, sleep: async () => {}, rng: mulberry32(seed), chatRng: () => 1, timer, now: () => timer.now, push() {}, gameLog: w }); return { m, timer, w }; };
    const laidIn = m => (m.game ? Object.values(m.game.trains).reduce((n, t) => n + t.tiles.length, 0) : 0);
    const a = mkMatch('GAMEAA', 21), run = a.m.start();
    await drive(a.m, a.timer, () => laidIn(a.m) > 12, 4000);
    ok(laidIn(a.m) > 12 && a.m.over === null && !fs.existsSync(a.w.file), 'NOTHING IS WRITTEN DURING A ROUND: with the round well under way (more than a dozen tiles laid) there is not even a file yet, so the hands and the boneyard cannot be read while they matter');
    await drive(a.m, a.timer, () => a.m.over === 'finished', 9000); await run;
    const ev = readEvents(a.w.file), res = checkLog(ev);
    ok(a.m.over === 'finished' && ev[0].e === 'game' && ev[0].mode === 'hosted' && ev[0].players.map(p => p.kind).join() === 'human,human,computer' && ev[0].players[2].level === 'easy', `a finished game: its file begins with the game (hosted; two people and a computer, with its level): ${ev.length} events`);
    ok(ev[1].e === 'round' && ev[1].boneyard.length + Object.values(ev[1].hands).reduce((n, h) => n + h.length, 0) === 90 && Object.keys(ev[1].hands).join() === 'human,cpu,cpu2', 'then the deal: the whole boneyard and the three hands');
    ok(ev[ev.length - 1].e === 'gameEnd' && ev[ev.length - 1].how === 'finished' && ev.filter(e => e.e === 'roundEnd').length === 1 && ev.filter(e => e.e === 'gameEnd').length === 1, 'it ends with the result of the round and of the game, once');
    ok(res.ok, `and the checker says it adds up (${res.summary.plays} plays, ${res.summary.draws} draws, ${res.summary.passes} passes)${res.ok ? '' : ': ' + res.problems.slice(0, 2).map(p => p.msg).join('; ')}`);
    const b = mkMatch('GAMEBB', 22), run2 = b.m.start();
    await drive(b.m, b.timer, () => laidIn(b.m) > 12, 4000);
    ok(laidIn(b.m) > 12 && !fs.existsSync(b.w.file), 'a second game, stopped part-way through its round: until then there is no file either');
    b.m.abort(); b.m.abort(); await run2;
    const ev2 = readEvents(b.w.file), res2 = checkLog(ev2);
    ok(ev2[ev2.length - 1].e === 'gameEnd' && ev2[ev2.length - 1].how === 'aborted' && ev2.filter(e => e.e === 'gameEnd').length === 1, 'a game that is stopped half way ends its log, once, as "aborted"');
    ok(res2.ok && ev2.filter(e => e.e === 'play').length > 12 && ev2.some(e => e.e === 'round'), 'when it is stopped the round it was in (which nobody can play on any more) is written, with the end: and what is there adds up');
    // several rounds: each is written when it ends, and not before (a game has 1, 4 or 13 rounds: this one has 4)
    const d = mkMatch('GAMEDD', 23, 4), run3 = d.m.start();
    await drive(d.m, d.timer, () => d.m.modal && d.m.modal.type === 'roundEnd', 9000);
    const afterOne = readEvents(d.w.file);
    ok(d.m.roundIndex === 0 && afterOne.filter(e => e.e === 'round').length === 1 && afterOne[afterOne.length - 1].e === 'roundEnd' && afterOne[0].e === 'game' && checkLog(afterOne).ok, `a game of four rounds: when the first has ended its log is written, from the game and the deal to the result of the round, and it adds up${checkLog(afterOne).ok ? '' : ' - ' + checkLog(afterOne).problems.slice(0, 2).map(p => p.msg).join('; ')}`);
    await drive(d.m, d.timer, () => d.m.roundIndex === 1 && laidIn(d.m) > 8, 9000);
    ok(d.m.roundIndex === 1 && readEvents(d.w.file).filter(e => e.e === 'round').length === 1 && readEvents(d.w.file).length === afterOne.length, 'with the second round well under way, the file is just as it was: the new deal is not in it, and nothing of the second round');
    await drive(d.m, d.timer, () => d.m.modal && d.m.modal.type === 'roundEnd' && d.m.roundIndex === 1, 9000);
    const afterTwo = readEvents(d.w.file);
    ok(afterTwo.filter(e => e.e === 'round').length === 2 && afterTwo[afterTwo.length - 1].e === 'roundEnd' && checkLog(afterTwo).ok, 'and when the second has ended it is in the file, and the two rounds together add up');
    d.m.abort(); await run3;
    const afterStop = readEvents(d.w.file);
    ok(afterStop[afterStop.length - 1].e === 'gameEnd' && afterStop[afterStop.length - 1].how === 'aborted' && afterStop.filter(e => e.e === 'round').length === 2 && checkLog(afterStop).ok, 'a game stopped between rounds ends its log, "aborted", with nothing of a third round');
    // a draw a person chooses to make while they have a play (hints off) is made by the match itself, not the engine: it must be in the log too
    {
      const timer = fakeTimer(), w = gl.forHosted('DRAWAN'), m = new OnlineMatch({ names: ['Ann', 'Ben', 'Gandalf'], computer: { level: 'easy' }, theme: 'classic', rounds: 1, hand: 12, allowHints: false, stepDelay: 0, nativeChance: 0, foodChance: 0, sleep: async () => {}, rng: mulberry32(41), chatRng: () => 1, timer, now: () => timer.now, push() {}, gameLog: w });
      const run = m.start(); let extra = 0;
      for (let n = 0; n < 9000 && !(m.modal && m.modal.type === 'roundEnd'); n++) {
        for (const seat of m.humans) {
          const v = m.viewFor(seat); if (!v.awaiting) continue; const a = v.awaiting;
          if (a.kind === 'move' && !a.drewThisTurn && extra < 6 && v.game.boneyard.length > 3 && !v.game.openDouble && m.intent(seat, { a: 'draw' }).ok) { extra++; continue; }
          if (a.kind === 'modal') m.intent(seat, { a: 'ok' });
          else if (a.kind === 'draw') m.intent(seat, { a: 'draw' });
          else if (a.kind === 'move') { const mv = a.moves[0]; m.intent(seat, { a: 'play', tile: mv.tile, train: mv.trainId }); }
          else if (a.canDraw) m.intent(seat, { a: 'draw' }); else if (a.moves.length && a.placed < 2) { const mv = a.moves[0]; m.intent(seat, { a: 'play', tile: mv.tile, train: mv.trainId }); } else m.intent(seat, { a: a.canDone ? 'done' : 'undo' });
        }
        timer.advance(300); await tick();
      }
      m.abort(); await run;
      const evs = readEvents(w.file), res = checkLog(evs);
      ok(extra > 0 && evs.filter(e => e.e === 'draw' && e.phase === 'turn' && m.humans.map(i => ['human', 'cpu', 'cpu2'][i]).includes(e.player)).length >= extra, `draws made while holding a play (${extra} of them, hints off) are in the log`);
      ok(res.ok, `and the log still adds up with them in it${res.ok ? '' : ': ' + res.problems.slice(0, 2).map(p => p.msg).join('; ')}`);
    }
    const c = new OnlineMatch({ names: ['Ann', 'Ben'], rounds: 1, hand: 8, stepDelay: 0, sleep: async () => {}, push() {} });
    ok(c.rec === null && c.gameLog === null, 'a match given no log keeps none');
  }

  console.log('7. a game in the page against the computer');
  {
    const store = {};
    const mkApp = extra => {
      const c = { html: '' };
      const root = { set innerHTML(v) { c.html = v; }, get innerHTML() { return c.html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
      c.app = G.createApp(Object.assign({ root, rng: mulberry32(31), paceRng: () => 0, chatRng: () => 1, nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } }, extra));
      c.S = c.app.state; c.d = a => c.app.dispatch(a); c.d({ type: 'boot' });
      return c;
    };
    const step = c => { const a = c.S.awaiting; if (!a) return; if (a.kind === 'modal') c.d({ type: 'dialogOk' }); else if (a.kind === 'draw') c.d({ type: 'draw' }); else if (a.kind === 'build') { if (a.canDraw) c.d({ type: 'draw' }); else if (a.canBuild) c.d({ type: 'autoBuild' }); else if (a.canDone) c.d({ type: 'endBuild' }); else c.d({ type: 'undoTile' }); } else { const m = a.moves[0]; c.d({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (c.S.awaiting === a) c.d({ type: 'playOn', train: m.trainId }); } };
    // (checks BEFORE it acts, so that a dialog can be stopped at: a game has 1, 4 or 13 rounds)
    const runTo = async (c, until, cap) => { if (until()) return true; for (let i = 0; i < cap; i++) { await wait(1); if (until()) return true; step(c); } return until(); };
    const laid = g => (g ? Object.values(g.trains).reduce((n, t) => n + t.tiles.length, 0) : 0);
    const sent = [], sender = { send(id, events) { sent.push({ id, events }); } };
    const c = mkApp({ gameLog: sender, build: 'test-build' });
    c.d({ type: 'startGame', rounds: 4, hand: 8, style: 'pips', level: 'easy' });
    ok(await runTo(c, () => laid(c.S.game) > 8, 6000), '(a four-round game is under way)');
    await wait(1700);                                                                  // (longer than the old 1.5 second batching: there is no timer any more)
    ok(!c.S.modal && sent.length === 0, 'NOTHING LEAVES THE PAGE DURING A ROUND: with the round well under way, and after waiting longer than the old batch time, nothing has been sent');
    ok(await runTo(c, () => c.S.modal && c.S.modal.type === 'roundEnd', 30000), '(the first round ends)');
    ok(sent.length === 1 && sent[0].events[0].e === 'game' && sent[0].events.filter(e => e.e === 'round').length === 1 && sent[0].events[sent[0].events.length - 1].e === 'roundEnd' && checkLog(sent[0].events).ok, 'when the round ends its events are sent, all at once: from the game and the deal to the result (and they add up)');
    ok(await runTo(c, () => c.S.roundIndex === 1 && !c.S.modal && laid(c.S.game) > 8, 30000), '(the second round is under way)');
    ok(sent.length === 1, 'and with the next round under way nothing of it has been sent');
    ok(await runTo(c, () => c.S.modal && c.S.modal.type === 'final', 90000), '(the game is played to its end)');
    const all = [].concat(...sent.map(x => x.events)), ids = new Set(sent.map(x => x.id));
    ok(ids.size === 1 && [...ids][0].length >= 8, `all of it was logged under one id of its own (${sent.length} batches, ${all.length} events)`);
    ok(sent.length === 5 && sent.map(x => x.events[x.events.length - 1].e).join() === 'roundEnd,roundEnd,roundEnd,roundEnd,gameEnd', 'five batches in all: one as each of the four rounds ended, and the end of the game');
    ok(all[0].e === 'game' && all[0].mode === 'local' && all[0].build === 'test-build' && all[0].rounds === 4 && all[0].players.map(p => p.id).join() === 'human,cpu' && all[0].players[1].level === 'easy' && all[0].players[0].kind === 'human', 'it begins with the game: local, the build, four rounds, you and the computer with its level');
    ok(all.filter(e => e.e === 'round').length === 4 && all.filter(e => e.e === 'roundEnd').length === 4 && all[all.length - 1].e === 'gameEnd' && all[all.length - 1].how === 'finished', 'all four rounds are dealt and ended, then the game ends, "finished"');
    const res = checkLog(all);
    ok(res.ok, `and the whole thing adds up: ${res.summary.plays} plays, ${res.summary.draws} draws, ${res.summary.passes} passes, ${res.summary.undos} tiles taken back${res.ok ? '' : ' - ' + res.problems.slice(0, 2).map(p => p.msg).join('; ')}`);
    const rd = all.find(e => e.e === 'round');
    ok(rd.hands.human.length === 8 && rd.hands.cpu.length === 8 && rd.boneyard.length === 74, 'the first deal: eight tiles each and 74 in the boneyard');
    ok(all[0].players[1].name === c.S.cpuName, 'the computer is logged under the name the game gave it');

    // a game left half way
    const sent2 = [], c2 = mkApp({ gameLog: { send(id, events) { sent2.push({ id, events }); } } });
    c2.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    ok(await runTo(c2, () => laid(c2.S.game) > 6, 6000) && sent2.length === 0, '(a game under way: nothing sent yet)');
    c2.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    await wait(20);
    ok(new Set(sent2.map(x => x.id)).size === 1, 'the game that was left half way sent its last round, with its end, as it was left (that game is dead); the new game has sent nothing yet');
    ok(await runTo(c2, () => c2.S.modal && c2.S.modal.type === 'roundEnd', 20000), '(the new game\'s round ends)');
    const ids2 = Array.from(new Set(sent2.map(x => x.id))), first = [].concat(...sent2.filter(x => x.id === ids2[0]).map(x => x.events)), second = [].concat(...sent2.filter(x => x.id === ids2[1]).map(x => x.events));
    ok(ids2.length === 2 && first.some(e => e.e === 'round') && first[first.length - 1].e === 'gameEnd' && first[first.length - 1].how === 'aborted' && checkLog(first).ok, 'starting a new game over one that is half played ends the first one\'s log, "aborted" (and what it has adds up)');
    ok(second[0].e === 'game' && second.some(e => e.e === 'round') && second[second.length - 1].e === 'roundEnd' && checkLog(second).ok, 'and the new game has a log of its own, which appears when its round ends');

    // nothing to send to
    const c3 = mkApp({ gameLog: null });
    c3.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    ok(await runTo(c3, () => c3.S.modal && c3.S.modal.type === 'roundEnd', 20000), 'with no log to send to (env.gameLog null) the game is played as usual');
    const c4 = mkApp({});
    c4.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    ok(await runTo(c4, () => c4.S.modal && c4.S.modal.type === 'roundEnd', 20000), 'and so it is when the page was not served by a game server (no address to send to)');

    // the real thing: the page's events, sent over HTTP to a real server, written to its games directory
    const dir = path.join(TMP, 'e2e'), server = createGameServer({ localOnly: true, publicIp: false, gameLog: true, gamesDir: dir });
    const port = await server.listen(0), reqs = [];
    const c5 = mkApp({ defaultServer: `127.0.0.1:${port}`, fetch: (url, init) => { reqs.push({ url, init }); return fetch(`http://127.0.0.1:${port}${url}`, init); } });
    c5.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'normal' });
    ok(await runTo(c5, () => laid(c5.S.game) > 6, 6000) && fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).length === 0 && reqs.length === 0, 'against a real server too: mid-round, no request has been made and there is no file in its games directory');
    await runTo(c5, () => c5.S.modal && c5.S.modal.type === 'final', 30000);
    let file = null; for (let i = 0; i < 100 && !file; i++) { await wait(30); const fs_ = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); if (fs_.length && fs.readFileSync(path.join(dir, fs_[0]), 'utf8').includes('"e":"gameEnd"')) file = path.join(dir, fs_[0]); }
    ok(reqs.length >= 2 && reqs.every(q => q.url === '/gamelog' && q.init.method === 'POST' && q.init.keepalive === true), `the page POSTed its events to /gamelog on the server it came from (${reqs.length} requests, each kept alive so that one can be sent as the page closes)`);
    const evs = file ? readEvents(file) : [], fres = checkLog(evs);
    ok(file && /-local-/.test(path.basename(file)) && evs[0].e === 'game' && evs[evs.length - 1].e === 'gameEnd' && fres.ok, `and the server wrote them to a file in its games directory, and the file adds up (${evs.length} events${file ? ', ' + path.basename(file) : ''})${fres.ok ? '' : ' - ' + fres.problems.slice(0, 2).map(p => p.msg).join('; ')}`);
    if (server.http.closeAllConnections) server.http.closeAllConnections();
    await server.close();
    // a draw you choose to make while you have a play (hints off) is made by the page, not the engine: it must be in the log too
    {
      const sent7 = [], c7 = mkApp({ gameLog: { send(id, events) { sent7.push({ id, events }); } } });
      c7.d({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'easy' });
      c7.d({ type: 'setAllowHints', value: false });
      let extra = 0;
      for (let i = 0; i < 20000 && !(c7.S.modal && c7.S.modal.type === 'roundEnd'); i++) {
        await wait(1); const A = c7.S.awaiting; if (!A) continue;
        if (A.kind === 'move' && !A.drewThisTurn && !c7.S.game.openDouble && c7.S.game.boneyard.length > 3 && extra < 6) {
          const h0 = c7.S.game.players[0].hand.length; c7.d({ type: 'draw' });
          for (let w = 0; w < 600 && !(c7.S.awaiting && c7.S.awaiting !== A) && !c7.S.modal; w++) await wait(2);       // (the new prompt: there is none for a moment after the draw)
          if (c7.S.game.players[0].hand.length === h0 + 1) { extra++; continue; }
        }
        step(c7);
      }
      const evs7 = [].concat(...sent7.map(x => x.events)), res7 = checkLog(evs7);
      ok(extra > 0 && evs7.filter(e => e.e === 'draw' && e.phase === 'turn' && e.player === 'human').length >= extra, `draws made while holding a play (${extra} of them, hints off) are in the log`);
      ok(res7.ok, `and the log still adds up with them in it${res7.ok ? '' : ': ' + res7.problems.slice(0, 2).map(p => p.msg).join('; ')}`);
    }
    // a server that does not take a log: the page stops trying
    let posts = 0;
    const c6 = mkApp({ defaultServer: '127.0.0.1:1', fetch: async () => { posts++; return { ok: false, status: 404 }; } });
    c6.d({ type: 'startGame', rounds: 4, hand: 8, style: 'pips', level: 'easy' });
    await runTo(c6, () => c6.S.modal && c6.S.modal.type === 'final', 90000); await wait(30);
    ok(posts === 1 && c6.S.modal && c6.S.modal.type === 'final', `a server that refuses the log (404): the page asks once, stops, and the game goes on (${posts} request)`);
  }

  console.log('8. the tools and the command line');
  {
    const r = (await recordRound(2, 555, 'normal', 12)), file = path.join(TMP, 'one.jsonl');
    fs.writeFileSync(file, r.events.map(e => JSON.stringify(e)).join('\n') + '\n');
    const tool = path.join(ROOT, 'tools', 'check_gamelog.js');
    let o = spawnSync(process.execPath, [tool, file], { encoding: 'utf8' });
    ok(o.status === 0 && /ADDS UP/.test(o.stdout) && /1 round\(s\) dealt/.test(o.stdout), `the checker: a good log gives exit status 0 and says it adds up`);
    o = spawnSync(process.execPath, [tool, file, '--print'], { encoding: 'utf8' });
    ok(o.status === 0 && /GAME \(local\)/.test(o.stdout) && /ROUND 1: engine/.test(o.stdout) && /boneyard \(drawn from the right\)/.test(o.stdout) && /ROUND 1 ENDS/.test(o.stdout) && /GAME FINISHED/.test(o.stdout), '--print adds the whole game as a transcript: the deal, the plays and the end');
    const tampered = clone(r.events); const d = tampered.find(e => e.e === 'play'); d.tile = d.tile === '0-1' ? '0-2' : '0-1';
    const file2 = path.join(TMP, 'two.jsonl'); fs.writeFileSync(file2, tampered.map(e => JSON.stringify(e)).join('\n') + '\n');
    o = spawnSync(process.execPath, [tool, file2], { encoding: 'utf8' });
    ok(o.status === 1 && /does NOT add up/.test(o.stdout) && /#\d+/.test(o.stdout), 'a log that does not add up: exit status 1, and it names the event');
    o = spawnSync(process.execPath, [tool, path.join(TMP, 'nope.jsonl')], { encoding: 'utf8' });
    ok(o.status === 2 && /Cannot read/.test(o.stderr), 'a file that cannot be read: exit status 2');
    o = spawnSync(process.execPath, [tool], { encoding: 'utf8' });
    ok(o.status === 2 && /Usage/.test(o.stdout), 'no file given: the usage, exit status 2');
    const ROOT_GAMES = path.join(ROOT, 'games');
    ok(fs.existsSync(ROOT_GAMES) && fs.statSync(ROOT_GAMES).isDirectory() && fs.existsSync(path.join(ROOT_GAMES, 'README.md')) && /\*\.jsonl/.test(fs.readFileSync(path.join(ROOT_GAMES, '.gitignore'), 'utf8')), 'the project has its games/ directory, with a README that explains the format, and the logs themselves ignored by git');
    const readme = fs.readFileSync(path.join(ROOT_GAMES, 'README.md'), 'utf8');
    ok(['game', 'round', 'draw', 'play', 'undo', 'done', 'pass', 'openingDone', 'roundEnd', 'gameEnd'].every(k => readme.includes('`' + k + '`')), 'and the README describes every kind of event');
    o = spawnSync(process.execPath, [path.join(ROOT, 'server.js'), '--help'], { encoding: 'utf8' });
    ok(/--games-dir DIR/.test(o.stdout) && /--no-game-log/.test(o.stdout), 'node server.js --help lists --games-dir and --no-game-log');
    const startServer = args => new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', '0', '--local-only', '--no-public-ip'].concat(args), { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; const t = setTimeout(() => { p.kill(); reject(new Error('the server did not start: ' + out)); }, 15000);
      p.stdout.on('data', d => { out += d; if (/reads it\)|Game logs: off|could NOT/.test(out)) { clearTimeout(t); setTimeout(() => { p.kill(); resolve(out); }, 100); } });
      p.stderr.on('data', d => { out += d; });
    });
    const cliDir = path.join(TMP, 'cli', 'deeper', 'games');
    const banner = await startServer(['--games-dir', cliDir]);
    ok(fs.existsSync(cliDir) && banner.includes(cliDir), 'node server.js --games-dir DIR: the directory is made (with the ones above it) and the banner says where the logs go');
    const offDir = path.join(TMP, 'cli-off');
    const banner2 = await startServer(['--no-game-log', '--games-dir', offDir]);
    ok(/Game logs: off/.test(banner2) && !fs.existsSync(offDir), 'node server.js --no-game-log: the banner says the logs are off, and no directory is made');
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (x) { /* ignore */ } process.exit(1); });
