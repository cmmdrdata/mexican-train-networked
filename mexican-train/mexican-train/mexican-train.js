#!/usr/bin/env node
/**
 * Mexican Train (double-12 set) - you vs. the computer, in the terminal.
 *
 *   node mexican-train.js               full game (13 rounds, engine 12-12 down to 0-0)
 *   node mexican-train.js --rounds 1    just one quick round
 *   node mexican-train.js --help        options + rules summary
 *
 * No dependencies; plain Node.js (v14+).
 *
 * RULES AS IMPLEMENTED
 *  - 91 tiles (0-0 .. 12-12). Each round has an "engine" double that starts the
 *    game (12-12 in round 1, 11-11 in round 2, ... 0-0 in round 13).
 *  - Each player gets 15 tiles. The rest is the boneyard.
 *  - Three trains all start from the engine's number: YOUR train, the CPU's
 *    train, and the shared MEXICAN train that anybody can play on.
 *  - On your turn, play one tile onto: your own train, the Mexican train, or
 *    the opponent's train if it has a marker ("open").
 *  - Can't play? Draw one tile. If it fits, you play it. If not, you pass and a
 *    marker goes on YOUR train (so the opponent may play on it). The marker
 *    comes off when you next play on your own train.
 *  - Play a double and you must immediately play a second tile on it. If you
 *    can't (even after drawing), the double stays open and the next player must
 *    satisfy it before anything else is played. A double cannot go out: if it
 *    is your very last tile you must draw one tile and cover it, or pass (and if
 *    the other player then covers it, you have gone out).
 *  - Going out wins the round: you score 0, the other player scores the pips
 *    left in their hand (the 0-0 tile counts 50). If the round is blocked
 *    (boneyard empty and nobody can play) both players score their pips.
 *    Lowest total after the last round wins.
 */
'use strict';

const readline = require('readline');

const MAX_PIP = 12;

// ------------------------------------------------------------------ helpers

const tileStr  = t => `[${t[0]}|${t[1]}]`;
const sameTile = (a, b) => a[0] === b[0] && a[1] === b[1];
const isDouble = t => t[0] === t[1];
const tilePips = t => (t[0] === 0 && t[1] === 0 ? 50 : t[0] + t[1]); // double-blank = 50
const handPips = p => p.hand.reduce((sum, t) => sum + tilePips(t), 0);

/** Small seedable random number generator (so --seed reproduces a game). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// -------------------------------------------------------------- game engine

function newTrain(id, engine) {
  // `end` is the number the next tile must match; it starts as the engine's number.
  return { id, tiles: [], end: engine, marker: false };
}

function newRound({ engine, handSize, rng }) {
  const tiles = [];
  for (let a = 0; a <= MAX_PIP; a++) {
    for (let b = a; b <= MAX_PIP; b++) {
      if (!(a === engine && b === engine)) tiles.push([a, b]); // engine is already on the table
    }
  }
  shuffle(tiles, rng);
  const players = [
    { id: 'human', name: 'You', hand: tiles.splice(0, handSize) },
    { id: 'cpu',   name: 'CPU', hand: tiles.splice(0, handSize) },
  ];
  return {
    engine,
    players,
    boneyard: tiles,
    trains: {
      human:   newTrain('human', engine),
      cpu:     newTrain('cpu', engine),
      mexican: newTrain('mexican', engine),
    },
    openDouble: null,        // { trainId, value } while a double is unsatisfied
    winner: null,
    rng,
  };
}

/** Every (tile, train) placement the player may legally make right now. */
function legalMoves(game, player) {
  const targets = [];
  if (game.openDouble) {
    // An unsatisfied double must be dealt with first, by everyone.
    targets.push(game.trains[game.openDouble.trainId]);
  } else {
    targets.push(game.trains[player.id]);
    targets.push(game.trains.mexican);
    for (const other of game.players) {
      if (other !== player && game.trains[other.id].marker) targets.push(game.trains[other.id]);
    }
  }
  const moves = [];
  for (const tile of player.hand) {
    for (const train of targets) {
      if (tile[0] === train.end) {
        moves.push({ tile, trainId: train.id, placed: [tile[0], tile[1]], newEnd: tile[1] });
      } else if (tile[1] === train.end) {
        moves.push({ tile, trainId: train.id, placed: [tile[1], tile[0]], newEnd: tile[0] });
      }
    }
  }
  return moves;
}

function applyMove(game, player, move) {
  const i = player.hand.findIndex(t => sameTile(t, move.tile));
  player.hand.splice(i, 1);
  const train = game.trains[move.trainId];
  train.tiles.push(move.placed);
  train.end = move.newEnd;
  if (move.trainId === player.id) train.marker = false; // playing on your own train clears your marker
}

/**
 * One player's whole turn (which can include a forced second play after a
 * double). `controller.choose` picks a move; `ui` is told what happens.
 */
async function playTurn(game, player, controller, ui) {
  for (;;) {
    let moves = legalMoves(game, player);
    let drew = null;

    if (moves.length === 0) {
      if (game.boneyard.length > 0) {
        await ui.onNeedDraw(game, player);
        drew = game.boneyard.pop();
        player.hand.push(drew);
        await ui.onDraw(game, player, drew);
        moves = legalMoves(game, player);
      }
      if (moves.length === 0) {
        game.trains[player.id].marker = true;
        await ui.onPass(game, player);
        return;
      }
    }

    const move = await controller.choose(game, player, moves, drew);
    applyMove(game, player, move);

    // Going out wins the round, but not with a double: a double has to be covered, so a
    // player whose last tile is a double must draw a tile and cover it, or pass.
    if (player.hand.length === 0 && !isDouble(move.tile)) {
      game.winner = player;
      game.openDouble = null;                     // nothing left to satisfy once the round is over
      await ui.onPlay(game, player, move, {});
      return;
    }

    const info = {};
    if (isDouble(move.tile)) {
      game.openDouble = { trainId: move.trainId, value: move.tile[0] };
      info.doubleOpened = true;
      if (player.hand.length === 0) info.lastTileDouble = true;   // it cannot win: the turn goes on with a draw
    } else if (game.openDouble && game.openDouble.trainId === move.trainId) {
      game.openDouble = null;
      info.doubleSatisfied = true;
    }
    await ui.onPlay(game, player, move, info);

    if (info.doubleOpened) continue;              // must play again right away
    return;
  }
}

/**
 * A round is blocked when the boneyard is empty and nobody could play even if
 * every train were open. (A player who is stuck passes and puts a marker on
 * their train, which opens it to the other player - so "two passes in a row" is
 * NOT enough to call it blocked; the other player might fit that newly open train.)
 */
function isBlocked(game) {
  if (game.boneyard.length > 0) return false;
  const saved = game.players.map(p => game.trains[p.id].marker);
  game.players.forEach(p => { game.trains[p.id].marker = true; });
  const anyMove = game.players.some(p => legalMoves(game, p).length > 0);
  game.players.forEach((p, i) => { game.trains[p.id].marker = saved[i]; });
  return !anyMove;
}

/** Runs a round to the end. Returns { winner, blocked } (winner may be null on a tie). */
async function playRound(game, startIndex, controllers, ui, hooks) {
  let turn = startIndex;
  for (let guard = 0; guard < 5000; guard++) {
    const player = game.players[turn];
    await playTurn(game, player, controllers[player.id], ui);
    if (hooks && hooks.onTurn) hooks.onTurn(game, player);

    // A player may have run out by playing a double with nothing left to draw. Once that double
    // is covered (by the other player) they have gone out; if the cover was the other player's
    // last tile too, both are out together: a tie.
    const out = game.players.filter(p => p.hand.length === 0);
    if (game.winner || (!game.openDouble && out.length)) {
      if (out.length > 1) { game.winner = null; return { winner: null, blocked: false, tie: true }; }
      if (!game.winner) game.winner = out[0];
      return { winner: game.winner, blocked: false };
    }

    if (isBlocked(game)) {
      const [a, b] = game.players;
      const pa = handPips(a), pb = handPips(b);
      return { winner: pa === pb ? null : (pa < pb ? a : b), blocked: true };
    }
    turn = (turn + 1) % game.players.length;
  }
  throw new Error('Round did not terminate (bug)');
}

// ------------------------------------------------------------- computer AI

/**
 * Simple heuristic: get rid of heavy tiles, only play a double when we can
 * follow it up, keep our own train flexible, and clear our marker when we can.
 */
function cpuChoose(game, player, moves) {
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    const rest = player.hand.filter(t => !sameTile(t, m.tile));
    let score = m.tile[0] + m.tile[1];                       // dump heavy tiles first
    if (rest.length === 0) score += 1000;                    // going out
    if (isDouble(m.tile) && rest.length > 0) {
      const canFollowUp = rest.some(t => t[0] === m.tile[0] || t[1] === m.tile[0]);
      score += canFollowUp ? 12 : -25;                       // an unsatisfied double is costly
    }
    if (m.trainId === player.id) {
      score += 3;                                            // build our own train
      if (game.trains[player.id].marker) score += 8;         // ...and close it again
    }
    const followers = rest.filter(t => t[0] === m.newEnd || t[1] === m.newEnd).length;
    score += 2 * followers;                                  // keep the train extendable
    score += game.rng() * 0.5;                               // break ties a little randomly
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

const cpuController = { choose: async (game, player, moves) => cpuChoose(game, player, moves) };

// ------------------------------------------------------------ terminal UI

class Quit extends Error {}

function createIO() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on('line', line => { if (waiters.length) waiters.shift()(line); else queue.push(line); });
  rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(null); });
  return {
    ask(prompt) {
      process.stdout.write(prompt);
      return new Promise(resolve => {
        if (queue.length) resolve(queue.shift());
        else if (closed) resolve(null);
        else waiters.push(resolve);
      });
    },
    close() { rl.close(); },
  };
}

const trainName = id => (id === 'mexican' ? 'the Mexican Train' : id === 'human' ? 'your train' : "CPU's train");

function trainStr(train, engine) {
  const MAX = 8;
  const shown = train.tiles.slice(-MAX).map(tileStr).join('');
  const hidden = train.tiles.length - Math.min(MAX, train.tiles.length);
  return `(${engine}) ${hidden > 0 ? `...+${hidden} ` : ''}${shown}`;
}

function renderBoard(game) {
  const me  = game.players.find(p => p.id === 'human');
  const cpu = game.players.find(p => p.id === 'cpu');
  console.log('\n' + '='.repeat(66));
  console.log(`Boneyard: ${game.boneyard.length} tiles   |   CPU holds ${cpu.hand.length}   |   You hold ${me.hand.length}`);
  console.log('-'.repeat(66));
  const line = (label, train, note) =>
    console.log(`${label.padEnd(15)}${trainStr(train, game.engine)}   [needs ${train.end}]${note || ''}`);
  line('Mexican Train:', game.trains.mexican, '   (open to everyone)');
  line("CPU's train:",   game.trains.cpu,     game.trains.cpu.marker ? '   <-- OPEN (marker): you may play here' : '');
  line('Your train:',    game.trains.human,   game.trains.human.marker ? '   <-- OPEN (marker): CPU may play here' : '');
  if (game.openDouble) {
    console.log(`\n!! Unsatisfied double on ${trainName(game.openDouble.trainId)}: the next tile must match ${game.openDouble.value} and go on it.`);
  }
}

function renderHand(player) {
  const sorted = player.hand.slice().sort((a, b) => (b[0] + b[1]) - (a[0] + a[1]) || b[0] - a[0]);
  console.log(`\nYour hand (${sorted.length}):`);
  for (let i = 0; i < sorted.length; i += 8) console.log('  ' + sorted.slice(i, i + 8).map(tileStr).join(' '));
}

const RULES_SUMMARY = `
HOW TO PLAY
 * Every round starts from the "engine" double (12-12 first, then 11-11 ... 0-0).
   Your train, the CPU's train and the shared Mexican Train all start from its number.
 * On your turn play ONE tile that matches the "needs" number of: your train, the
   Mexican Train, or the CPU's train if it is marked OPEN.
 * Nothing playable? You draw one tile. If it fits you play it; if not you pass and a
   marker goes on YOUR train (the CPU may then play there). The marker comes off when
   you next play on your own train.
 * Play a double and you must play a second tile on it right away. If you can't, the
   double stays open and the next player must satisfy it first.
 * Play your last tile to win the round (score 0). The loser scores the pips left in
   hand (0-0 counts 50). If the round is blocked, both score their pips.
   Lowest total after the final round wins.
`;

function makeCliUI(io) {
  return {
    async onNeedDraw(game, player) {
      if (player.id !== 'human') return;
      renderBoard(game);
      renderHand(player);
      console.log(`\nYou have no playable tile. The boneyard has ${game.boneyard.length} tile(s).`);
      const ans = await io.ask('Press Enter to draw (or q to quit)... ');
      if (ans === null || ans.trim().toLowerCase() === 'q') throw new Quit();
    },
    async onDraw(game, player, tile) {
      console.log(player.id === 'human' ? `You draw ${tileStr(tile)}.` : 'CPU draws a tile.');
    },
    async onPass(game, player) {
      if (player.id === 'human') {
        console.log(game.boneyard.length === 0 ? 'The boneyard is empty and you cannot play.' : 'That tile does not fit either.');
        console.log('You pass. A marker goes on your train - the CPU may now play on it.');
      } else {
        console.log('CPU cannot play and passes. A marker goes on its train - you may play on it now!');
      }
    },
    async onPlay(game, player, move, info) {
      const who = player.id === 'human' ? 'You play' : 'CPU plays';
      console.log(`${who} ${tileStr(move.placed)} on ${trainName(move.trainId)}.`);
      if (info.lastTileDouble) {
        console.log(player.id === 'human'
          ? '  That was your last tile, but a double cannot go out. You must draw a tile to try to cover it.'
          : '  That was CPU\'s last tile, but a double cannot go out. CPU must draw a tile to try to cover it.');
      } else if (info.doubleOpened) {
        console.log(player.id === 'human' ? '  A double! You must play another tile on it.' : '  A double! CPU must play another tile on it.');
      }
      if (info.doubleSatisfied) console.log('  The double is satisfied.');
      if (player.hand.length === 1) console.log(`  (${player.id === 'human' ? 'You have' : 'CPU has'} only one tile left!)`);
    },
  };
}

function makeHumanController(io) {
  return {
    async choose(game, player, moves, drew) {
      if (!drew) renderBoard(game);
      renderHand(player);
      const order = { human: 0, mexican: 1, cpu: 2 };
      const list = moves.slice().sort((a, b) =>
        (b.tile[0] + b.tile[1]) - (a.tile[0] + a.tile[1]) || order[a.trainId] - order[b.trainId]);
      console.log(game.openDouble ? '\nYou must satisfy the double:' : '\nYour moves:');
      list.forEach((m, i) =>
        console.log(`  ${String(i + 1).padStart(2)}) play ${tileStr(m.placed)} on ${trainName(m.trainId)}  (it will then need ${m.newEnd})`));
      for (;;) {
        const ans = await io.ask(`\nChoose 1-${list.length}  (? = rules, q = quit): `);
        if (ans === null) throw new Quit();
        const s = ans.trim().toLowerCase();
        if (s === 'q') throw new Quit();
        if (s === '?' || s === 'h') { console.log(RULES_SUMMARY); continue; }
        const n = Number(s);
        if (s !== '' && Number.isInteger(n) && n >= 1 && n <= list.length) return list[n - 1];
        console.log('Please type one of the numbers from the list.');
      }
    },
  };
}

// ------------------------------------------------------------------- main

function parseArgs(argv) {
  const opts = { rounds: 13, handSize: 15, seed: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--rounds') opts.rounds = Number(argv[++i]);
    else if (a === '--hand')   opts.handSize = Number(argv[++i]);
    else if (a === '--seed')   opts.seed = Number(argv[++i]);
    else { console.error(`Unknown option: ${a}`); opts.help = true; opts.bad = true; }
  }
  if (!Number.isInteger(opts.rounds) || opts.rounds < 1 || opts.rounds > 13) { console.error('--rounds must be 1-13'); opts.help = opts.bad = true; }
  if (!Number.isInteger(opts.handSize) || opts.handSize < 3 || opts.handSize > 30) { console.error('--hand must be 3-30'); opts.help = opts.bad = true; }
  if (opts.seed !== null && !Number.isFinite(opts.seed)) { console.error('--seed must be a number'); opts.help = opts.bad = true; }
  return opts;
}

function printHelp() {
  console.log(`Mexican Train (double-12) vs. the computer

Usage: node mexican-train.js [options]

  --rounds N   number of rounds to play, 1-13 (default 13: engine 12-12 down to 0-0)
  --hand N     tiles dealt to each player (default 15)
  --seed N     fixed random seed, to replay the same deal
  -h, --help   show this help
${RULES_SUMMARY}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); process.exitCode = opts.bad ? 1 : 0; return; }

  const rng = opts.seed !== null ? mulberry32(opts.seed) : Math.random;
  const io = createIO();
  const ui = makeCliUI(io);
  const controllers = { human: makeHumanController(io), cpu: cpuController };
  const totals = { human: 0, cpu: 0 };
  let startIndex = rng() < 0.5 ? 0 : 1;

  try {
    console.log('\n*** MEXICAN TRAIN - double-12 ***');
    console.log(RULES_SUMMARY);

    for (let r = 0; r < opts.rounds; r++) {
      const engine = MAX_PIP - r;
      const game = newRound({ engine, handSize: opts.handSize, rng });
      console.log(`\n#### ROUND ${r + 1} of ${opts.rounds}: the engine is the double-${engine} ####`);
      console.log(`${game.players[startIndex].name} ${startIndex === 0 ? 'go' : 'goes'} first.`);

      const result = await playRound(game, startIndex, controllers, ui);

      console.log('\n' + '-'.repeat(66));
      if (result.blocked) console.log('The round is BLOCKED - nobody can play and the boneyard is empty.');
      else if (result.tie) console.log('You both played every tile!');
      else console.log(`${result.winner.name} played the last tile!`);
      for (const p of game.players) {
        const pts = handPips(p);
        totals[p.id] += pts;
        const left = p.hand.length ? ` (${p.hand.map(tileStr).join(' ')})` : '';
        console.log(`  ${p.name.padEnd(4)} +${String(pts).padStart(3)} points${left}`);
      }
      console.log(`  TOTALS so far:  You ${totals.human}   |   CPU ${totals.cpu}   (lowest wins)`);

      startIndex = 1 - startIndex;
      if (r < opts.rounds - 1) {
        const ans = await io.ask('\nPress Enter for the next round (q to quit)... ');
        if (ans === null || ans.trim().toLowerCase() === 'q') throw new Quit();
      }
    }

    console.log('\n' + '='.repeat(66));
    console.log(`FINAL SCORE:  You ${totals.human}   |   CPU ${totals.cpu}`);
    console.log(totals.human === totals.cpu ? "It's a tie!" : totals.human < totals.cpu ? 'You win! Nicely played.' : 'The CPU wins this time.');
  } catch (e) {
    if (e instanceof Quit) console.log('\nThanks for playing!');
    else throw e;
  } finally {
    io.close();
  }
}

module.exports = {
  newRound, legalMoves, applyMove, playTurn, playRound, cpuChoose, cpuController,
  handPips, tilePips, mulberry32, shuffle, isDouble, isBlocked,
};

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
