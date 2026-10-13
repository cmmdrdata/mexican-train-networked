#!/usr/bin/env node
'use strict';
/**
 * Replays a game log (see gamelog.js) and says whether it adds up, so that a log can be trusted when something has gone wrong:
 *
 *   node tools/check_gamelog.js games/20241012-143905-local-ab12cd34.jsonl          check it (exit status 0: it adds up, 1: it does not, 2: could not be read)
 *   node tools/check_gamelog.js FILE --print                                         also print the game as a readable transcript
 *
 * What is checked: the events are numbered 1, 2, 3 ... and time never goes back; every round starts with all the 90 tiles of the double-12 set (all but the engine) exactly
 * once, in the boneyard and the hands; every tile drawn is the top of the boneyard (and the count left is right); every tile played is one that player held, goes on a train
 * they may play on (their own; in the opening only their own; later the Mexican train, or another player's with a marker on it), and fits the end of that train; a tile taken
 * back is the last one laid; a player who passes has a marker put on their train; and at the end of a round the hands that are left, their pips and the totals add up.
 * (It does not judge whether a move was wise, or the rules about doubles: only that what is written could have happened.)
 */
const fs = require('fs');

const norm = k => { const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(k)); if (!m) return null; const a = Number(m[1]), b = Number(m[2]); return a <= b ? a + '-' + b : b + '-' + a; };
const ends = k => { const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(k)); return m ? [Number(m[1]), Number(m[2])] : null; };
const pipsOf = k => { const e = ends(k); return e ? (e[0] === 0 && e[1] === 0 ? 50 : e[0] + e[1]) : NaN; };       // (the 0-0 tile counts 50)
const sorted = list => list.map(norm).sort().join(',');

function parseLog(text) {
  const events = [], problems = [];
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try { events.push(JSON.parse(line)); }
    catch (e) { problems.push({ n: null, e: null, msg: `line ${i + 1} is not JSON${i === lines.length - 1 || (i === lines.length - 2 && !lines[lines.length - 1].trim()) ? ' (the last line: the game stopped while it was being written?)' : ''}` }); }
  });
  return { events, problems };
}

function checkLog(events) {
  const problems = [], notes = [];
  const bad = (ev, msg) => problems.push({ n: ev && ev.n, e: ev && ev.e, msg });
  const summary = { mode: null, rounds: 0, draws: 0, plays: 0, undos: 0, passes: 0, ended: null, players: [] };
  let last = 0, lastT = -1, R = null, ids = [], totals = {};
  const player = (ev, id) => { if (ids.indexOf(id) < 0) { bad(ev, `unknown player "${id}"`); return false; } return true; };
  events.forEach((ev, idx) => {
    if (!ev || typeof ev !== 'object') return bad(ev, 'not an event');
    if (!Number.isInteger(ev.n) || ev.n !== last + 1) bad(ev, `event number ${ev.n}, after ${last}`);
    last = Number.isInteger(ev.n) ? ev.n : last + 1;
    if (typeof ev.t !== 'number' || ev.t < lastT) bad(ev, 'the time went backwards'); else lastT = ev.t;
    if (idx === 0 && ev.e !== 'game') bad(ev, 'the log does not begin with its "game" event');
    const endOf = tr => (tr.tiles.length ? ends(tr.tiles[tr.tiles.length - 1])[1] : R.engine);
    switch (ev.e) {
      case 'game':
        if (idx !== 0) bad(ev, 'a second "game" event');
        summary.mode = ev.mode || null; summary.players = Array.isArray(ev.players) ? ev.players : [];
        ids = summary.players.map(p => p.id); ids.forEach(id => { totals[id] = 0; });
        if (ev.version !== 1) bad(ev, `a log of version ${ev.version}: this tool reads version 1`);
        if (ids.length < 2 || ids.length > 3) bad(ev, 'a game has two or three players');
        break;
      case 'round': {
        summary.rounds++;
        if (R && !R.over) notes.push(`round ${R.round} was never ended (n=${ev.n} starts round ${ev.round})`);
        const hands = {}, all = [];
        ids.forEach(id => { const h = ev.hands && ev.hands[id]; if (!Array.isArray(h)) bad(ev, `no hand for ${id}`); else { hands[id] = h.slice(); all.push(...h); } });
        const boneyard = Array.isArray(ev.boneyard) ? ev.boneyard.slice() : (bad(ev, 'no boneyard'), []);
        all.push(...boneyard);
        const seen = new Set(); let dup = 0, malformed = 0;
        all.forEach(k => { const nk = norm(k); if (!nk) malformed++; else if (seen.has(nk)) dup++; else seen.add(nk); });
        const eng = ev.engine + '-' + ev.engine;
        if (malformed) bad(ev, `${malformed} tile(s) are not written as "a-b"`);
        if (dup) bad(ev, `${dup} tile(s) appear more than once in the boneyard and the hands`);
        if (seen.has(norm(eng))) bad(ev, 'the engine tile is in a hand or the boneyard');
        if (all.length !== 90) bad(ev, `${all.length} tiles were dealt (a double-12 set has 90 besides the engine)`);
        const sizes = new Set(ids.map(id => (hands[id] || []).length));
        if (sizes.size > 1) bad(ev, 'the hands were not dealt the same size');
        const trains = { mexican: { tiles: [], marker: false } }; ids.forEach(id => { trains[id] = { tiles: [], marker: false }; });
        R = { round: ev.round, engine: ev.engine, hands, boneyard, trains, opening: true, finished: {}, over: false };
        break;
      }
      case 'draw': {
        if (!R) return bad(ev, 'a draw outside a round');
        summary.draws++;
        if (!player(ev, ev.player)) break;
        if (ev.phase !== (R.opening ? 'opening' : 'turn')) bad(ev, `a draw marked "${ev.phase}" while the ${R.opening ? 'opening' : 'game'} is on`);
        if (!R.boneyard.length) { bad(ev, 'a draw from an empty boneyard'); break; }
        const top = R.boneyard.pop();
        if (top !== ev.tile) bad(ev, `the tile drawn is ${ev.tile}, but the top of the boneyard was ${top}`);
        if (ev.boneyard !== R.boneyard.length) bad(ev, `${ev.boneyard} left in the boneyard, but there should be ${R.boneyard.length}`);
        R.hands[ev.player].push(ev.tile);
        break;
      }
      case 'play': {
        if (!R) return bad(ev, 'a play outside a round');
        summary.plays++;
        if (!player(ev, ev.player)) break;
        if (ev.phase !== (R.opening ? 'opening' : 'turn')) bad(ev, `a play marked "${ev.phase}" while the ${R.opening ? 'opening' : 'game'} is on`);
        const hand = R.hands[ev.player], at = hand.findIndex(k => norm(k) === norm(ev.tile));
        if (at < 0) { bad(ev, `${ev.player} played ${ev.tile}, which was not in their hand`); break; }
        hand.splice(at, 1);
        const tr = R.trains[ev.train];
        if (!tr) { bad(ev, `a play on a train that does not exist: "${ev.train}"`); break; }
        const mine = ev.train === ev.player;
        if (R.opening ? !mine : !(mine || ev.train === 'mexican' || tr.marker)) bad(ev, `${ev.player} played on ${ev.train}'s train, which they may not (${R.opening ? 'in the opening only their own' : 'only their own, the Mexican train, or one with a marker'})`);
        const placed = ends(ev.placed);
        if (!placed || norm(ev.placed) !== norm(ev.tile)) bad(ev, `placed as ${ev.placed}, but the tile is ${ev.tile}`);
        else {
          const want = endOf(tr);
          if (placed[0] !== want) bad(ev, `${ev.placed} laid on a train that ends in ${want}`);
          if (ev.end !== placed[1]) bad(ev, `the train is said to end in ${ev.end}, but ${ev.placed} leaves it ending in ${placed[1]}`);
        }
        tr.tiles.push(ev.placed);
        if (mine) tr.marker = false;
        if (ev.left !== hand.length) bad(ev, `${ev.left} tiles left in the hand, but there should be ${hand.length}`);
        break;
      }
      case 'undo': {
        if (!R) return bad(ev, 'an undo outside a round');
        summary.undos++;
        if (!player(ev, ev.player)) break;
        if (!R.opening) bad(ev, 'a tile taken back after the opening');
        const tr = R.trains[ev.player], lastTile = tr.tiles[tr.tiles.length - 1];
        if (!lastTile || norm(lastTile) !== norm(ev.tile)) { bad(ev, `${ev.tile} taken back, but the last tile on ${ev.player}'s train is ${lastTile || 'none'}`); break; }
        tr.tiles.pop();
        R.hands[ev.player].push(ev.tile);
        if (ev.left !== R.hands[ev.player].length) bad(ev, `${ev.left} tiles left in the hand, but there should be ${R.hands[ev.player].length}`);
        break;
      }
      case 'done': {
        if (!R) return bad(ev, 'a "done" outside a round');
        if (!player(ev, ev.player)) break;
        if (!R.opening) bad(ev, '"done" after the opening');
        if (ev.tiles !== R.trains[ev.player].tiles.length) bad(ev, `${ev.player} finished a train of ${ev.tiles}, but it has ${R.trains[ev.player].tiles.length} tiles`);
        R.finished[ev.player] = true;
        break;
      }
      case 'pass': {
        if (!R) return bad(ev, 'a pass outside a round');
        summary.passes++;
        if (!player(ev, ev.player)) break;
        if (ev.phase !== (R.opening ? 'opening' : 'turn')) bad(ev, `a pass marked "${ev.phase}" while the ${R.opening ? 'opening' : 'game'} is on`);
        if (ev.boneyard !== R.boneyard.length) bad(ev, `${ev.boneyard} left in the boneyard, but there should be ${R.boneyard.length}`);
        R.trains[ev.player].marker = true;
        if (R.opening) R.finished[ev.player] = true;
        break;
      }
      case 'openingDone':
        if (!R) return bad(ev, 'the opening ended outside a round');
        ids.forEach(id => { if (!R.finished[id]) bad(ev, `the opening ended but ${id} had not finished`); });
        R.opening = false;
        break;
      case 'roundEnd': {
        if (!R) return bad(ev, 'a round ended outside a round');
        R.over = true;
        ids.forEach(id => {
          const mine = R.hands[id] || [], said = ev.hands && ev.hands[id];
          if (!Array.isArray(said) || sorted(said) !== sorted(mine)) bad(ev, `${id} ends the round with ${JSON.stringify(said)}, but replaying gives ${JSON.stringify(mine)}`);
          const pips = mine.reduce((n, k) => n + pipsOf(k), 0);
          if (!ev.pips || ev.pips[id] !== pips) { bad(ev, `${id} has ${ev.pips && ev.pips[id]} pips left, but their hand is worth ${pips}`); }
          totals[id] += pips;
          if (ev.totals && ev.totals[id] !== totals[id]) bad(ev, `${id}'s total is ${ev.totals[id]}, but it should be ${totals[id]}`);
        });
        if (ev.winner && !ev.blocked && R.hands[ev.winner] && R.hands[ev.winner].length !== 0) bad(ev, `${ev.winner} is said to have won by going out but still holds ${R.hands[ev.winner].length} tile(s)`);
        break;
      }
      case 'gameEnd':
        summary.ended = ev.how || 'finished';
        if (ev.how === 'finished') ids.forEach(id => { if (ev.totals && ev.totals[id] !== totals[id]) bad(ev, `the final total of ${id} is ${ev.totals[id]}, but it should be ${totals[id]}`); });
        break;
      case 'logTruncated': notes.push('the log was cut short: it reached its size limit'); break;
      default: notes.push(`an event this tool does not know: "${ev.e}" (n=${ev.n})`);
    }
  });
  if (!summary.ended) summary.ended = 'not ended (the game was still being played, or stopped)';
  return { ok: problems.length === 0, problems, notes, summary };
}

/* One event, in words. `names` maps a player's id to what to call them. */
function describe(ev, names) {
  const who = id => (names && names[id]) || id, tr = id => (id === 'mexican' ? 'the Mexican train' : `${who(id)}'s train`);
  const at = `#${ev.n} +${(ev.t / 1000).toFixed(1)}s`;
  switch (ev.e) {
    case 'game': return `${at}  GAME (${ev.mode}): ${ev.rounds} round(s), ${ev.hand} tiles each, ${(ev.players || []).map(p => `${p.name} (${p.kind}${p.level ? ', ' + p.level : ''})`).join(', ')}${ev.theme ? ', theme ' + ev.theme : ''}${ev.build ? ', build ' + ev.build : ''}`;
    case 'round': return `${at}  ROUND ${ev.round}: engine ${ev.engine}-${ev.engine}; ${who(ev.first)} first once the trains are built\n        boneyard (drawn from the right): ${ev.boneyard.join(' ')}\n${Object.keys(ev.hands).map(id => `        ${who(id)} holds ${ev.hands[id].join(' ')}`).join('\n')}`;
    case 'draw': return `${at}  R${ev.round} ${ev.phase}: ${who(ev.player)} drew ${ev.tile} (${ev.boneyard} left in the boneyard)`;
    case 'play': return `${at}  R${ev.round} ${ev.phase}: ${who(ev.player)} played ${ev.tile} on ${tr(ev.train)}${ev.placed !== ev.tile ? ` as ${ev.placed}` : ''}, which now ends in ${ev.end} (${ev.left} left in hand)${ev.double ? ` [double ${ev.double}]` : ''}${ev.lastTileDouble ? ' [last tile was a double]' : ''}`;
    case 'undo': return `${at}  R${ev.round} opening: ${who(ev.player)} took ${ev.tile} back (${ev.left} in hand)`;
    case 'done': return `${at}  R${ev.round} opening: ${who(ev.player)} finished their train of ${ev.tiles}`;
    case 'pass': return `${at}  R${ev.round} ${ev.phase}: ${who(ev.player)} passed (a marker on their train; ${ev.boneyard} left in the boneyard)`;
    case 'openingDone': return `${at}  R${ev.round}: every train is built`;
    case 'roundEnd': return `${at}  ROUND ${ev.round} ENDS: ${ev.blocked ? 'blocked' : ev.tie ? 'a tie' : who(ev.winner) + ' went out'}; pips left ${Object.keys(ev.pips).map(id => `${who(id)} ${ev.pips[id]}`).join(', ')}; totals ${Object.keys(ev.totals).map(id => `${who(id)} ${ev.totals[id]}`).join(', ')}\n${Object.keys(ev.hands).map(id => `        ${who(id)} left holding ${ev.hands[id].join(' ') || 'nothing'}`).join('\n')}`;
    case 'gameEnd': return `${at}  GAME ${String(ev.how).toUpperCase()}: totals ${Object.keys(ev.totals).map(id => `${who(id)} ${ev.totals[id]}`).join(', ')}`;
    default: return `${at}  ${ev.e}`;
  }
}

function main(argv) {
  const file = argv.find(a => !a.startsWith('--')), print = argv.includes('--print');
  if (!file || argv.includes('--help')) { console.log('Usage: node tools/check_gamelog.js FILE [--print]\n  Replays a game log from the games directory and says whether it adds up.\n  --print   also prints the game as a readable transcript'); return file ? 0 : 2; }
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { console.error(`Cannot read ${file}: ${e.message}`); return 2; }
  const parsed = parseLog(text), res = checkLog(parsed.events);
  res.problems.unshift(...parsed.problems);
  const names = {}; (res.summary.players || []).forEach(p => { names[p.id] = p.name; });
  if (print) { parsed.events.forEach(ev => console.log(describe(ev, names))); console.log(''); }
  const s = res.summary;
  console.log(`${file}\n  ${s.mode || '?'} game, ${s.rounds} round(s) dealt, ${s.draws} draws, ${s.plays} plays, ${s.undos} tiles taken back, ${s.passes} passes; ${s.ended}`);
  res.notes.forEach(n => console.log('  note: ' + n));
  if (res.ok) { console.log('  It ADDS UP: every draw, play and total is consistent.'); return 0; }
  console.log(`  It does NOT add up: ${res.problems.length} problem(s):`);
  res.problems.slice(0, 40).forEach(p => console.log(`   - ${p.n !== null && p.n !== undefined ? '#' + p.n + ' ' : ''}${p.e ? '(' + p.e + ') ' : ''}${p.msg}`));
  if (res.problems.length > 40) console.log(`   ... and ${res.problems.length - 40} more`);
  return 1;
}

module.exports = { checkLog, parseLog, describe, norm };
if (require.main === module) process.exit(main(process.argv.slice(2)));
