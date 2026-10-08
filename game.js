(function (global) {
  'use strict';

  /* ================================ ENGINE ================================ */
  /* Rules code shared in spirit with the command-line version, which was tested with
   * thousands of simulated rounds. Tiles are [low, high] arrays. */

  const MAX_PIP = 12;
  const key = t => t[0] + '-' + t[1];
  const sameTile = (a, b) => a[0] === b[0] && a[1] === b[1];
  const isDouble = t => t[0] === t[1];
  const canon = t => (t[0] <= t[1] ? [t[0], t[1]] : [t[1], t[0]]);
  const tilePips = t => (t[0] === 0 && t[1] === 0 ? 50 : t[0] + t[1]); // the 0-0 counts 50
  const handPips = p => p.hand.reduce((sum, t) => sum + tilePips(t), 0);

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

  function newTrain(id, engine) {
    return { id, tiles: [], end: engine, marker: false };
  }

  // The ids of the players at the table, in turn order. Two players are "human" and "cpu"; a third is "cpu2".
  // (The ids are also the ids of their trains. They are only names: any of the players may be a person.)
  const PLAYER_IDS = ['human', 'cpu', 'cpu2'];

  /* simultaneousOpening: every player builds their own train at the same time before the
   * first normal turn (see buildPhase). Off by default so the plain rules stay testable.
   * players: 2 (the default) or 3 at the table; each is dealt handSize tiles. */
  function newRound({ engine, handSize, rng, simultaneousOpening, players }) {
    const tiles = [];
    for (let a = 0; a <= MAX_PIP; a++) {
      for (let b = a; b <= MAX_PIP; b++) {
        if (!(a === engine && b === engine)) tiles.push([a, b]);
      }
    }
    shuffle(tiles, rng);
    const ids = PLAYER_IDS.slice(0, players === 3 ? 3 : 2);
    const names = { human: 'You', cpu: 'CPU', cpu2: 'CPU 2' };
    const seated = ids.map(id => ({ id, name: names[id], hand: tiles.splice(0, handSize) }));   // (the first two hands are dealt exactly as in a two-player game)
    const trains = {};
    ids.forEach(id => { trains[id] = newTrain(id, engine); });
    trains.mexican = newTrain('mexican', engine);
    const opening = {};
    ids.forEach(id => { opening[id] = { finished: false, drew: false, lastDrew: null }; });
    return {
      engine,
      players: seated,
      boneyard: tiles,
      trains,
      openDouble: null,
      winner: null,
      rng,
      opening: simultaneousOpening ? opening : null,
    };
  }

  function legalMoves(game, player, opts) {
    const ownOnly = !!(opts && opts.ownOnly);
    const targets = [];
    if (game.openDouble) {
      targets.push(game.trains[game.openDouble.trainId]);
    } else {
      targets.push(game.trains[player.id]);
      if (!ownOnly) {
        targets.push(game.trains.mexican);
        for (const other of game.players) {
          if (other !== player && game.trains[other.id].marker) targets.push(game.trains[other.id]);
        }
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
    if (move.trainId === player.id) train.marker = false;
  }

  /* Take the last tile back off the player's own train and into their hand. */
  function undoLast(game, player) {
    const train = game.trains[player.id];
    const placed = train.tiles.pop();
    const tile = canon(placed);
    player.hand.push(tile);
    train.end = train.tiles.length ? train.tiles[train.tiles.length - 1][1] : game.engine;
    return tile;
  }

  /* One normal turn: a tile (plus the forced follow-up after a double). */
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

      // Going out wins the round, but not with a double: a double must be covered, so a player
      // whose last tile is a double has to draw a tile and cover it, or pass.
      if (player.hand.length === 0 && !isDouble(move.tile)) {
        game.winner = player;
        game.openDouble = null;
        await ui.onPlay(game, player, move, {});
        return;
      }

      const info = {};
      if (isDouble(move.tile)) {
        game.openDouble = { trainId: move.trainId, value: move.tile[0] };
        info.doubleOpened = true;
        if (player.hand.length === 0) info.lastTileDouble = true;     // it cannot win: the turn goes on with a draw
      } else if (game.openDouble && game.openDouble.trainId === move.trainId) {
        game.openDouble = null;
        info.doubleSatisfied = true;
      }
      await ui.onPlay(game, player, move, info);

      if (info.doubleOpened) continue;
      return;
    }
  }

  /* THE OPENING. Before normal turns begin, every player builds their own train at the same
   * time. Each player runs this loop on their own; `agent.act(game, player, info)` returns
   * one action: {type:'play', move} | {type:'undo'} | {type:'draw'} | {type:'done'}.
   *
   *  - play: put a tile on your own train (only your own train is allowed).
   *  - undo: take your last tile back, as often as you like, until you are done.
   *  - draw: only when nothing is down and nothing fits the engine; one draw only.
   *  - done: finish. Not allowed while the train ends on an uncovered double (cover it or
   *    take it back). A double can never be your last tile down: it could not win the round.
   * If nothing is down, nothing fits, and no draw is possible, the player passes and a
   * marker goes on their train, exactly as on a normal turn. */
  async function buildPhase(game, player, agent, ui) {
    const st = game.opening[player.id];
    const train = game.trains[player.id];
    while (!st.finished) {
      const all = legalMoves(game, player, { ownOnly: true });
      // A double cannot be the last tile you put down: it could not win the round (it has to be
      // covered), and the opening has no draw to cover it. It stays in your hand for normal turns.
      const moves = player.hand.length === 1 ? all.filter(m => !isDouble(m.tile)) : all;
      const lastDouble = all.length > moves.length;
      const placed = train.tiles.length;
      const canDraw = placed === 0 && moves.length === 0 && !st.drew && game.boneyard.length > 0;

      if (placed === 0 && moves.length === 0 && !canDraw) {
        train.marker = true;
        st.finished = true;
        if (ui.onBuildPass) await ui.onBuildPass(game, player);
        return;
      }

      const last = train.tiles[placed - 1];
      const canDone = !last || !isDouble(last);
      const info = { moves, placed, canUndo: placed > 0, canDraw, canDone, drew: st.lastDrew, lastDouble };
      const action = await agent.act(game, player, info);

      if (action && action.type === 'play') {
        const mv = moves.find(m => sameTile(m.tile, action.move.tile) && m.trainId === action.move.trainId);
        if (!mv) throw new Error('illegal tile in the opening');
        applyMove(game, player, mv);
        st.lastDrew = null;
        if (ui.onBuildPlay) await ui.onBuildPlay(game, player, mv);
      } else if (action && action.type === 'undo' && info.canUndo) {
        const tile = undoLast(game, player);
        st.lastDrew = null;
        if (ui.onBuildUndo) await ui.onBuildUndo(game, player, tile);
      } else if (action && action.type === 'draw' && canDraw) {
        const tile = game.boneyard.pop();
        player.hand.push(tile);
        st.drew = true;
        st.lastDrew = tile;
        if (ui.onBuildDraw) await ui.onBuildDraw(game, player, tile);
      } else if (action && action.type === 'done' && canDone) {
        st.finished = true;
        if (ui.onBuildDone) await ui.onBuildDone(game, player, train.tiles.length);
      } else {
        throw new Error('illegal action in the opening: ' + (action && action.type));
      }
    }
  }

  // Blocked = boneyard empty and nobody could play even if every train were open.
  function isBlocked(game) {
    if (game.boneyard.length > 0) return false;
    const saved = game.players.map(p => game.trains[p.id].marker);
    game.players.forEach(p => { game.trains[p.id].marker = true; });
    const anyMove = game.players.some(p => legalMoves(game, p).length > 0);
    game.players.forEach((p, i) => { game.trains[p.id].marker = saved[i]; });
    return !anyMove;
  }

  /* A blocked round goes to the player holding the fewest pips; if the lowest count is shared, nobody wins it. */
  function blockedResult(game) {
    const pips = game.players.map(handPips), low = Math.min(...pips);
    const lowest = game.players.filter((p, i) => pips[i] === low);
    return { winner: lowest.length === 1 ? lowest[0] : null, blocked: true };
  }

  async function playRound(game, startIndex, controllers, ui, hooks) {
    if (game.opening) {
      // everybody builds at once; the phase ends when the last player is done
      await Promise.all(game.players.map(p => buildPhase(game, p, controllers[p.id], ui)));
      if (ui.onOpeningDone) await ui.onOpeningDone(game);
      const out = game.players.filter(p => p.hand.length === 0);
      if (out.length) {
        game.winner = out.length === 1 ? out[0] : null;
        return { winner: game.winner, blocked: false, tie: out.length > 1 };
      }
      if (isBlocked(game)) return blockedResult(game);
    }
    let turn = startIndex;
    for (let guard = 0; guard < 5000; guard++) {
      const player = game.players[turn];
      await playTurn(game, player, controllers[player.id], ui);
      if (hooks && hooks.onTurn) hooks.onTurn(game, player);
      // Someone may have run out by playing a double with nothing in the boneyard to draw. Once
      // that double has been covered (by the other player), they have gone out. If the covering
      // play was the other player's last tile too, both are out together: a tie, as in the opening.
      const out = game.players.filter(p => p.hand.length === 0);
      if (game.winner || (!game.openDouble && out.length)) {
        if (out.length > 1) { game.winner = null; return { winner: null, blocked: false, tie: true }; }
        if (!game.winner) game.winner = out[0];
        return { winner: game.winner, blocked: false };
      }
      if (isBlocked(game)) return blockedResult(game);
      turn = (turn + 1) % game.players.length;
    }
    throw new Error('Round did not finish');
  }

  /* SKILL LEVELS. Normal is the original heuristic. Hard and Easy were tuned by playing
   * thousands of duplicate deals (the same deal played twice with the seats swapped):
   *   Hard  = Normal + true pip counts (0-0 costs 50) + a lookahead that keeps long chains
   *           buildable. Beats Normal ~55% of rounds and leaves ~4 fewer pips in hand.
   *   Easy  = a random legal move 70% of the time, and a casual opening. Normal beats it ~63%.
   * (Counting unseen tiles and other opening values were tried and made no measurable difference.) */
  const LEVELS = ['easy', 'normal', 'hard'];
  const LEVEL_LABEL = { easy: 'Easy', normal: 'Medium', hard: 'Hard' };   // the key stays 'normal' so saved settings keep working
  const EASY_RANDOM = 0.7;       // chance Easy just plays a random legal move
  const EASY_STOP = 0.35;        // chance Easy stops building after each tile of its opening
  const HARD_LOOKAHEAD = 12;     // Hard: bonus per tile of the longest chain still buildable afterwards

  // The computer player's normal-turn heuristic: dump heavy tiles, only play a double it
  // can follow up, keep its own train extendable, and take its own marker off when it can.
  function cpuChoose(game, player, moves, level) {
    if (level === 'easy' && game.rng() < EASY_RANDOM) return moves[Math.floor(game.rng() * moves.length)];
    const hard = level === 'hard';
    let best = null, bestScore = -Infinity;
    for (const m of moves) {
      const rest = player.hand.filter(t => !sameTile(t, m.tile));
      let score = hard ? tilePips(m.tile) : m.tile[0] + m.tile[1];
      if (rest.length === 0 && !isDouble(m.tile)) score += 1000;      // going out (not on a double)
      if (isDouble(m.tile)) {                                          // a last-tile double cannot be followed up either
        const canFollowUp = rest.length > 0 && rest.some(t => t[0] === m.tile[0] || t[1] === m.tile[0]);
        score += canFollowUp ? 12 : -25;
      }
      if (m.trainId === player.id) {
        score += 3;
        if (game.trains[player.id].marker) score += 8;
      }
      score += 2 * rest.filter(t => t[0] === m.newEnd || t[1] === m.newEnd).length;
      if (hard) score += HARD_LOOKAHEAD * longestChain(rest, m.newEnd, isDouble(m.tile)).length;
      score += game.rng() * 0.5;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  /* How good is a move? The same evaluation the Hard computer plays by (true pip counts, the
   * lookahead for a long chain still to build, doubles it can cover, its own train...) but with
   * no random tie-break, so it never touches the game's random numbers. Used to rate the
   * human's plays so the computer can comment on them. */
  function moveValue(game, player, m) {
    const rest = player.hand.filter(t => !sameTile(t, m.tile));
    let score = tilePips(m.tile);
    if (rest.length === 0 && !isDouble(m.tile)) score += 1000;
    if (isDouble(m.tile)) {
      const canFollowUp = rest.length > 0 && rest.some(t => t[0] === m.tile[0] || t[1] === m.tile[0]);
      score += canFollowUp ? 12 : -25;
    }
    if (m.trainId === player.id) {
      score += 3;
      if (game.trains[player.id].marker) score += 8;
    }
    score += 2 * rest.filter(t => t[0] === m.newEnd || t[1] === m.newEnd).length;
    score += HARD_LOOKAHEAD * longestChain(rest, m.newEnd, isDouble(m.tile)).length;
    return score;
  }

  /* Rate the move `chosen` among the legal `moves`: how far below the best move it was
   * (gap, in evaluation points), its rank (1 = the best), and whether it was forced. */
  function rateMove(game, player, moves, chosen) {
    const vals = moves.map(m => moveValue(game, player, m));
    const best = Math.max(...vals);
    const i = moves.indexOf(chosen);
    const value = i >= 0 ? vals[i] : best;
    return {
      n: moves.length, forced: moves.length === 1, best, value, gap: best - value,
      rank: 1 + vals.filter(v => v > value + 1e-9).length,
    };
  }

  /* The longest train a hand can build from `startEnd`. Longest = most tiles; ties go to the
   * higher pip total (dump heavy tiles). A chain may not END on a double (it would be left
   * uncovered) unless it uses every tile in the hand. `startsAfterDouble` is true when the
   * train already ends in a double that still has to be covered. Exact search, memoised on
   * (tiles used, open end, last-was-double), which is tiny for a 15-tile hand.
   * Returns the tiles in play order, [] if no valid chain exists. */
  const CHAIN_TILE_CAP = 16;     // exact up to an opening hand plus one draw (hands are 8, 12 or 15)
  function longestChain(hand, startEnd, startsAfterDouble) {
    // The search remembers every set of tiles it has tried, which grows exponentially: a 19-tile
    // hand (a long game with many draws) never finished. A hand that big is searched using its
    // heaviest tiles only; that is plenty to judge a move or look ahead.
    if (hand.length > CHAIN_TILE_CAP) hand = hand.slice().sort((a, b) => tilePips(b) - tilePips(a)).slice(0, CHAIN_TILE_CAP);
    const n = hand.length;
    const memo = new Map();
    function best(mask, end, lastDouble) {
      const k = (mask << 5) | (end << 1) | (lastDouble ? 1 : 0);
      const hit = memo.get(k);
      if (hit) return hit;
      // a chain may not end on a double, even with every tile used: that could not go out
      let res = { score: lastDouble ? -Infinity : 0, next: -1 };
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) continue;
        const t = hand[i];
        let nextEnd;
        if (t[0] === end) nextEnd = t[1];
        else if (t[1] === end) nextEnd = t[0];
        else continue;
        const sub = best(mask | (1 << i), nextEnd, t[0] === t[1]);
        if (sub.score === -Infinity) continue;
        const score = 1000 + tilePips(t) + sub.score;
        if (score > res.score) res = { score, next: i };
      }
      memo.set(k, res);
      return res;
    }
    const chain = [];
    let mask = 0, end = startEnd, lastDouble = !!startsAfterDouble;
    if (best(0, end, lastDouble).score === -Infinity) return [];
    for (;;) {
      const r = best(mask, end, lastDouble);
      if (r.next < 0) break;
      const t = hand[r.next];
      chain.push(t);
      mask |= 1 << r.next;
      end = t[0] === end ? t[1] : t[0];
      lastDouble = t[0] === t[1];
    }
    return chain;
  }

  /* The longest train a player could have from EVERYTHING they hold: the tiles already on
   * their train plus the tiles in hand. */
  function longestFullChain(game, player) {
    const pool = player.hand.map(canon).concat(game.trains[player.id].tiles.map(canon));
    return longestChain(pool, game.engine, false);
  }

  /* The take-backs and plays that turn the player's current train into that longest train,
   * reusing whatever prefix already matches. */
  function buildSteps(game, player) {
    const have = game.trains[player.id].tiles.map(p => key(canon(p)));
    const want = longestFullChain(game, player).map(t => key(canon(t)));
    let common = 0;
    while (common < have.length && common < want.length && have[common] === want[common]) common++;
    const steps = [];
    for (let i = have.length; i > common; i--) steps.push({ type: 'undo' });
    for (let j = common; j < want.length; j++) steps.push({ type: 'play', key: want[j] });
    return steps;
  }

  /* Easy's opening: lays tiles one after another without planning, and often stops early. */
  function casualBuildAction(game, player, info) {
    if (info.canDraw) return { type: 'draw' };
    if (!info.canDone) {                                  // an uncovered double: cover it, or take it back
      const cover = info.moves[0];
      return cover ? { type: 'play', move: cover } : { type: 'undo' };
    }
    if (info.placed > 0 && game.rng() < EASY_STOP) return { type: 'done' };
    if (!info.moves.length) return { type: 'done' };
    return { type: 'play', move: info.moves[Math.floor(game.rng() * info.moves.length)] };
  }

  /* What the computer does in the opening: lay down its longest chain one tile at a time,
   * then say it is done. (It never ends on an uncovered double, so Done is always allowed.) */
  function cpuBuildAction(game, player, info, level) {
    if (level === 'easy') return casualBuildAction(game, player, info);
    if (info.canDraw) return { type: 'draw' };
    const train = game.trains[player.id];
    const last = train.tiles[train.tiles.length - 1];
    const plan = longestChain(player.hand, train.end, !!last && isDouble(last));
    if (plan.length) {
      const m = info.moves.find(x => sameTile(x.tile, plan[0]) && x.trainId === player.id);
      if (m) return { type: 'play', move: m };
    }
    if (info.canDone) return { type: 'done' };
    return { type: 'undo' };
  }

  /* ================================ SOUND ================================= */
  /* The "click" of two dominoes meeting, synthesised (no audio files). Two small hard tiles touch
   * for well under a millisecond and then ring at several kilohertz for a few milliseconds, which
   * is why the sound is high and crisp, not a low knock on a table. Here: a sharp bit of noise
   * with the lows removed at the moment of contact, four quickly fading resonances between about
   * 3 and 8.5 kHz, and a second, quieter and slightly higher contact a few milliseconds later as
   * the tile settles against the other. Nothing below about 1 kHz. renderClack is plain maths on
   * an array, so it can be checked without a browser or a speaker. */
  function clackGapMs(seed) { return 4.5 + mulberry32(seed)() * 5; }          // when the second contact lands (the first number drawn for a variant)

  function renderClack(sampleRate, seed) {
    const rnd = mulberry32(seed);
    const gap = sampleRate * (4.5 + rnd() * 5) / 1000;
    const n = Math.floor(sampleRate * 0.095);
    const out = new Float32Array(n);
    const TAU = Math.PI * 2;
    const jig = w => 1 - w + rnd() * 2 * w;                // every variant is slightly different
    // the resonances of a small hard tile: [frequency in Hz, strength, how fast it fades in seconds]
    const first = [[2900, 0.45, 0.0085], [4300, 0.55, 0.0055], [6100, 0.48, 0.0036], [8400, 0.30, 0.0022]]
      .map(([f, a, d]) => [f * jig(0.05), a * jig(0.12), d]);
    const second = first.map(([f, a, d]) => [f * (1.05 + rnd() * 0.08), a * 0.8, d * 0.8]);   // the other tile: a touch higher
    const ring = (t, modes, gain) => {
      if (t < 0) return 0;
      let v = 0;
      for (const [f, a, d] of modes) v += Math.sin(TAU * f * t) * Math.exp(-t / d) * a;
      return v * gain * Math.min(1, t / 0.00012);          // a very sharp start
    };
    // noise whose lows are taken out, for the instant of contact
    const tick = new Float32Array(n);
    let w1 = 0;
    for (let i = 0; i < n; i++) { const w = rnd() * 2 - 1; tick[i] = w - w1; w1 = w; }
    const hp = Math.exp(-TAU * 1100 / sampleRate);         // one-pole high-pass: keep nothing below about 1 kHz
    const fade = Math.max(1, Math.floor(sampleRate * 0.008));
    let px = 0, py = 0, peak = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate, tg = (i - gap) / sampleRate;
      let v = ring(t, first, 1) + ring(tg, second, 0.55);
      v += tick[i] * Math.min(1, t / 0.00006) * Math.exp(-t / 0.0004) * 0.9 + (tg >= 0 ? tick[i] * Math.min(1, tg / 0.00006) * Math.exp(-tg / 0.0003) * 0.45 : 0);
      v *= Math.min(1, (n - i) / fade);
      const y = hp * (py + v - px);
      px = v; py = y;
      out[i] = y;
      if (Math.abs(y) > peak) peak = Math.abs(y);
    }
    const g = peak > 0 ? 0.7 / peak : 1;
    for (let i = 0; i < n; i++) out[i] *= g;
    return out;
  }

  /* Plays the clack through Web Audio. Browsers only allow sound after a click or key press,
   * so unlock() must be called from one; until then (or with no audio at all) clack() quietly
   * does nothing and the game plays exactly the same. */
  /* The sound that says "it is your move": short and low, so it cannot be mistaken for a domino's
   * click (which is a high, sharp tick). A soft tone near 165 Hz sliding down a little as it fades,
   * with two quiet overtones, 0.22 seconds long. */
  function renderTurn(sampleRate) {
    const n = Math.floor(sampleRate * 0.22), out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      phase += 2 * Math.PI * (165 - 120 * t) / sampleRate;                         // 165 Hz gliding down to about 140 Hz
      const env = Math.min(1, t / 0.008) * Math.exp(-t / 0.05) * Math.min(1, (n - 1 - i) / (sampleRate * 0.02));   // quick attack, fade, no click at the end
      out[i] = env * (Math.sin(phase) + 0.35 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase)) / 1.47;           // never above 1
    }
    return out;
  }

  function createSound(AudioCtor, rng) {
    let ctx = null, buffers = [], turnBuffer = null;
    rng = rng || Math.random;
    function unlock() {
      if (!AudioCtor) return;
      try {
        if (!ctx) {
          ctx = new AudioCtor();
          for (let i = 0; i < 6; i++) {
            const data = renderClack(ctx.sampleRate, 101 + i * 7);
            const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
            buf.getChannelData(0).set(data);
            buffers.push(buf);
          }
          const tdata = renderTurn(ctx.sampleRate);
          turnBuffer = ctx.createBuffer(1, tdata.length, ctx.sampleRate);
          turnBuffer.getChannelData(0).set(tdata);
        }
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
        // iOS only starts audio from inside a gesture: play one silent sample right here
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(ctx.destination);
        s.start(0);
      } catch (e) { /* no audio available */ }
    }
    function clack() {
      if (!ctx || ctx.state !== 'running' || !buffers.length) return;
      try {
        const src = ctx.createBufferSource();
        src.buffer = buffers[Math.floor(rng() * buffers.length)];
        if (src.playbackRate) src.playbackRate.value = 0.95 + rng() * 0.1;
        const gain = ctx.createGain();
        gain.gain.value = 0.7;                       // a bright click sounds louder than a dull one at the same level
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start(0);
      } catch (e) { /* ignore */ }
    }
    // "it is your move": starts just after the click of the move that preceded it, so the two do not blur
    function turn() {
      if (!ctx || ctx.state !== 'running' || !turnBuffer) return;
      try {
        const src = ctx.createBufferSource();
        src.buffer = turnBuffer;
        const gain = ctx.createGain();
        gain.gain.value = 0.55;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start((ctx.currentTime || 0) + 0.12);
      } catch (e) { /* ignore */ }
    }
    return { unlock, clack, turn };
  }

  /* =============================== TILE ART =============================== */
  /* Each tile is one self-contained SVG. Pips are color-coded by number, the
   * way real double-12 sets are, so an 11 and a 12 are easy to tell apart. */

  const BONE = '#f6f0e0', BONE_EDGE = '#c9bd9c', GROOVE = '#8c8068', BRASS = '#d6a84f';
  const PIP_COLORS = ['#7b8489', '#1565c0', '#2e7d32', '#c62828', '#6a1b9a', '#ef6c00',
                      '#00838f', '#6d4c41', '#ad1457', '#37474f', '#8d8f12', '#283593', '#1c1c1c'];

  function pipPoints(n) {
    const L = 26, C = 50, R = 74, T = 26, M = 50, B = 74;
    switch (n) {
      case 0: return [];
      case 1: return [[C, M]];
      case 2: return [[R, T], [L, B]];
      case 3: return [[R, T], [C, M], [L, B]];
      case 4: return [[L, T], [R, T], [L, B], [R, B]];
      case 5: return [[L, T], [R, T], [C, M], [L, B], [R, B]];
      case 6: return [[L, T], [R, T], [L, M], [R, M], [L, B], [R, B]];
      case 7: return [[L, T], [R, T], [L, M], [C, M], [R, M], [L, B], [R, B]];
      case 8: return [[L, T], [C, T], [R, T], [L, M], [R, M], [L, B], [C, B], [R, B]];
      case 9: return [[L, T], [C, T], [R, T], [L, M], [C, M], [R, M], [L, B], [C, B], [R, B]];
      default: { // 10 to 12: three columns by four rows
        const xs = [27, 50, 73], ys = [16, 38.7, 61.3, 84];
        const pts = [];
        for (let r = 0; r < 4; r++) {
          for (let c = 0; c < 3; c++) {
            const keepCenter = n === 12 || (n === 11 && r !== 2) || (n === 10 && (r === 0 || r === 3));
            if (c === 1 && !keepCenter) continue;
            pts.push([xs[c], ys[r]]);
          }
        }
        return pts;
      }
    }
  }

  function halfMarkup(n, style) {
    const col = PIP_COLORS[n];
    if (style === 'numbers') {
      const size = n >= 10 ? 50 : 62;
      return `<text x="50" y="50" dy=".35em" text-anchor="middle" font-size="${size}" font-weight="700" ` +
             `font-family="Rockwell,Georgia,serif" fill="${col}">${n}</text>`;
    }
    const r = n >= 10 ? 7.6 : 9.5;
    return pipPoints(n).map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${r}" fill="${col}"/>`).join('');
  }

  /** orient: 'h' (lying along a train) or 'v' (upright; doubles cross the train). */
  function tileSVG(a, b, o) {
    o = o || {};
    const orient = o.orient || (a === b ? 'v' : 'h');
    const style = o.style || 'pips';
    const horiz = orient === 'h';
    const w = horiz ? 204 : 104, h = horiz ? 104 : 204;
    const groove = horiz
      ? `<line x1="102" y1="14" x2="102" y2="90" stroke="${GROOVE}" stroke-width="2.5" stroke-linecap="round"/>`
      : `<line x1="14" y1="102" x2="90" y2="102" stroke="${GROOVE}" stroke-width="2.5" stroke-linecap="round"/>`;
    const pin = horiz
      ? `<circle cx="102" cy="52" r="4.6" fill="${BRASS}" stroke="#8a6a24" stroke-width="1"/>`
      : `<circle cx="52" cy="102" r="4.6" fill="${BRASS}" stroke="#8a6a24" stroke-width="1"/>`;
    const second = horiz ? '102,2' : '2,102';
    return `<svg class="tile ${orient}${o.cls ? ' ' + o.cls : ''}" viewBox="0 0 ${w} ${h}" role="img"` +
      `${o.idx !== undefined ? ' data-idx="' + o.idx + '"' : ''} ` +
      `aria-label="${a} and ${b}" focusable="false">` +
      `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="12" fill="${BONE}" stroke="${BONE_EDGE}" stroke-width="3"/>` +
      groove +
      `<g transform="translate(2,2)">${halfMarkup(a, style)}</g>` +
      `<g transform="translate(${second})">${halfMarkup(b, style)}</g>` +
      pin + `</svg>`;
  }


  /* A face-down tile: what you see of the opponent's train while they are still building. */
  function tileBackSVG(orient, cls, idx) {
    const horiz = orient !== 'v';
    const w = horiz ? 204 : 104, h = horiz ? 104 : 204;
    return `<svg class="tile ${horiz ? 'h' : 'v'} back${cls ? ' ' + cls : ''}" viewBox="0 0 ${w} ${h}" role="img"` +
      `${idx !== undefined ? ' data-idx="' + idx + '"' : ''} ` +
      `aria-label="face-down tile" focusable="false">` +
      `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="12" fill="#2a6a60" stroke="#123d36" stroke-width="3"/>` +
      `<rect x="13" y="13" width="${w - 26}" height="${h - 26}" rx="8" fill="none" stroke="#8fc2b6" stroke-opacity="0.55" ` +
      `stroke-width="2.5" stroke-dasharray="7 6"/>` +
      `<circle cx="${w / 2}" cy="${h / 2}" r="5" fill="${BRASS}" stroke="#8a6a24" stroke-width="1"/></svg>`;
  }

  /* ================================ MOTION ================================ */
  /* Two bits of motion: dominoes flying onto the board, and dragging tiles around in your hand.
   * The geometry is plain maths (flightGeometry, slotAt, moveInOrder) so it can be checked
   * without a browser; createFx and createDrag are the thin layers that touch the real page. */

  /* Where a flying tile starts and how it must be turned and scaled to look like the tile it
   * came from. `from` and `to` are {left, top, width, height}. The source is an upright tile (one
   * in your hand, which lies down, or a face-down one in the opponent's hand, which stands up).
   * `rotate` is how far the landed tile must be turned to look like the source: 0, 90, -90 or 180.
   * Either way the long side of one becomes the long side of the other. */
  function flightGeometry(from, to, rotate) {
    const cxF = from.left + from.width / 2, cyF = from.top + from.height / 2;
    const cxT = to.left + to.width / 2, cyT = to.top + to.height / 2;
    const scale = Math.max(from.width, from.height) / Math.max(to.width, to.height);
    return { dx: cxF - cxT, dy: cyF - cyT, rotate, scale };
  }
  const flightStart = g => `translate(${g.dx}px, ${g.dy}px) rotate(${g.rotate}deg) scale(${g.scale})`;

  /* How to turn a tile that has landed on a train so that, in the air, it looks like the tile it
   * came from. A tile in your hand lies down with its lower number on the left; one of the
   * computer's stands up. On a train a double stands across it, any other tile lies along it
   * with the end that matched first on the left. */
  function flightRotation(placed, fromLyingDown) {
    if (placed[0] === placed[1]) return fromLyingDown ? 90 : 0;
    if (fromLyingDown) return placed[0] <= placed[1] ? 0 : 180;
    return placed[0] <= placed[1] ? 90 : -90;
  }

  /* Move `k` to position `toIndex` in an ordering (clamped); returns a new array. */
  function moveInOrder(order, k, toIndex) {
    const from = order.indexOf(k);
    if (from < 0) return order.slice();
    const to = Math.max(0, Math.min(order.length - 1, toIndex));
    const next = order.slice();
    next.splice(from, 1);
    next.splice(to, 0, k);
    return next;
  }

  /* Which tile the pointer is over (or nearest to): the index of the closest rectangle center. */
  function slotAt(rects, x, y) {
    let best = -1, bestD = Infinity;
    rects.forEach((r, i) => {
      const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  /* Where a dragged tile should go. The hand is several rows. Over a tile, it takes that tile's
   * place; past the last tile of a row (the empty cells at its end) it goes to the end of that
   * row; above or below everything it goes to the nearest row. `cur` is its present index. */
  function dropIndexAt(rects, x, y, cur) {
    if (!rects.length) return -1;
    const rows = [];
    rects.forEach((r, i) => {
      const row = rows.find(rw => Math.abs(rw.top - r.top) < r.height / 2);     // tiles raised or selected are still in their row
      if (row) { row.items.push(i); row.right = Math.max(row.right, r.left + r.width); row.bottom = Math.max(row.bottom, r.top + r.height); }
      else rows.push({ top: r.top, bottom: r.top + r.height, right: r.left + r.width, items: [i] });
    });
    let row = rows[0], best = Infinity;
    rows.forEach(rw => { const d = y < rw.top ? rw.top - y : (y > rw.bottom ? y - rw.bottom : 0); if (d < best) { best = d; row = rw; } });
    if (x > row.right) {
      const last = row.items[row.items.length - 1];
      return cur > last ? last + 1 : last;
    }
    return row.items[slotAt(row.items.map(i => rects[i]), x, y)];
  }

  /* Dominoes flying: onto the board when played, and from the boneyard into a hand when drawn.
   * capture*() is called just BEFORE the page is redrawn (while the tile is still where it was)
   * and land*() just AFTER, once the tile exists in its new place. The real tile is hidden until
   * the flying copy arrives, and hidden again if a redraw happens mid-flight. */
  function createFx(root, doc) {
    const flights = [];
    const ok = !!(doc && doc.createElement && doc.body && root.querySelector);
    const rectOf = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    // the last face-down tile in an opponent's row (with two opponents, each has a row of their own)
    const lastBack = pid => {
      const two = root.querySelector && root.querySelector('.cpu-hand[data-player="cpu2"]');
      const sel = pid === 'cpu2' ? '.cpu-hand[data-player="cpu2"] .back' : two ? '.cpu-hand[data-player="cpu"] .back' : '.cpu-hand .back';
      const b = root.querySelectorAll(sel);
      return b && b.length ? b[b.length - 1] : null;
    };

    // one flight: a copy built from `layers` ({face, back}) goes from `from` to `dest`
    function fly(find, dest, from, rotate, layers, duration) {
      const to = rectOf(dest);
      if (!(to.width > 0 && to.height > 0)) return;
      const g = flightGeometry(from, to, rotate);
      const wrap = doc.createElement('div');
      wrap.className = 'flying';
      wrap.style.left = to.left + 'px'; wrap.style.top = to.top + 'px';
      wrap.style.width = to.width + 'px'; wrap.style.height = to.height + 'px';
      const { face, back } = layers;
      if (face) wrap.appendChild(face);
      if (back) wrap.appendChild(back);
      if (face && back) face.style.opacity = '0';       // starts face down, turns over on the way
      doc.body.appendChild(wrap);
      dest.style.visibility = 'hidden';
      const flight = { find, wrap };
      flights.push(flight);
      const keyframes = [
        { transform: flightStart(g), filter: 'drop-shadow(0 10px 12px rgba(0,0,0,0.45))' },
        { offset: 0.72, transform: 'translate(' + g.dx * 0.06 + 'px, ' + (g.dy * 0.06 - 6) + 'px) rotate(' + g.rotate * 0.06 + 'deg) scale(1.1)',
          filter: 'drop-shadow(0 8px 10px rgba(0,0,0,0.4))' },
        { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.35))' },
      ];
      const finish = () => {
        const i = flights.indexOf(flight);
        if (i < 0) return;
        flights.splice(i, 1);
        if (wrap.remove) wrap.remove();
        const d = find();
        if (d) {
          d.style.visibility = '';
          if (d.animate) d.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 140, easing: 'ease-out' });
        }
      };
      const anim = wrap.animate ? wrap.animate(keyframes, { duration, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)', fill: 'forwards' }) : null;
      if (face && back && face.animate && back.animate) {
        face.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration, fill: 'forwards' });
        back.animate([{ opacity: 1 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration, fill: 'forwards' });
      }
      if (anim && anim.finished && anim.finished.then) anim.finished.then(finish, finish);
      else if (anim) anim.onfinish = finish;
      else finish();
    }
    const backLayer = orient => {
      const holder = doc.createElement('div');
      holder.innerHTML = tileBackSVG(orient);
      return holder.firstChild || null;
    };
    const cleanFace = el => { const f = el.cloneNode(true); if (f.classList) { f.classList.remove('pop'); f.classList.remove('reveal'); } return f; };

    /* ---- a tile played onto a train ---- */
    function capture(spec) {
      if (!ok) return null;
      let el = null;
      if (spec.playerId === 'human') el = root.querySelector('.tile-btn[data-key="' + spec.key + '"] .tile');
      else el = lastBack(spec.playerId);
      if (!el) return null;
      const r = rectOf(el);
      return r.width > 0 && r.height > 0 ? { from: r } : null;
    }
    function land(tok, spec, opts) {
      if (!ok || !tok) return;
      const find = () => root.querySelector('.scroller[data-train="' + spec.trainId + '"] .tile[data-idx="' + spec.index + '"]');
      const dest = find();
      if (!dest) return;
      // a computer tile that will be public on arrival starts face down and turns over in flight
      const turnsOver = (spec.playerId === 'cpu' || spec.playerId === 'cpu2') && !spec.hidden;
      const back = turnsOver ? backLayer(spec.placed[0] === spec.placed[1] ? 'v' : 'h') : null;
      const lyingDown = tok.from.width > tok.from.height;
      fly(find, dest, tok.from, flightRotation(spec.placed, lyingDown), { face: cleanFace(dest), back }, opts && opts.fast ? 260 : 440);
    }

    /* ---- a tile drawn from the boneyard ---- */
    function captureDraw() {
      if (!ok) return null;
      const el = root.querySelector('.boneyard .stack') || root.querySelector('.boneyard');
      if (!el) return null;
      const r = rectOf(el);
      return r.width > 0 && r.height > 0 ? { from: r } : null;
    }
    function landDraw(tok, spec) {
      if (!ok || !tok) return;
      if (spec.playerId === 'human') {
        const find = () => root.querySelector('.hand .tile-btn[data-key="' + spec.key + '"] .tile');
        const dest = find();
        if (!dest) return;
        fly(find, dest, tok.from, 0, { face: cleanFace(dest), back: backLayer('h') }, 480);   // arrives face down, turns face up in your hand
      } else {
        const dest = lastBack(spec.playerId);
        if (!dest) return;
        fly(() => lastBack(spec.playerId), dest, tok.from, 0, { face: null, back: backLayer('v') }, 480);         // the computer's draw stays face down
      }
    }

    // after any redraw: tiles still in flight must stay hidden where they will land
    function reapply() {
      flights.forEach(f => { const d = f.find(); if (d) d.style.visibility = 'hidden'; });
    }
    function cancelAll() {
      flights.splice(0).forEach(f => {
        if (f.wrap.remove) f.wrap.remove();
        const d = f.find();
        if (d) d.style.visibility = '';
      });
    }
    return { capture, land, captureDraw, landDraw, reapply, cancelAll, get active() { return flights.length; } };
  }

  /* Dragging tiles around in your hand with a mouse, finger or pen. Pointer events cover all three.
   * The dragged tile follows the pointer as a floating copy; the real tile takes the place of
   * whichever tile the pointer is over, so the others shuffle aside as you go. A press that does
   * not move is still an ordinary click. */
  function createDrag(root, app, doc) {
    const SLOP = 6;                                  // pixels of movement before a press becomes a drag
    let st = null, floatEl = null, suppress = false;
    const rectOf = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    const tileOf = e => (e.target && e.target.closest ? e.target.closest('.tile-btn') : null);

    function down(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (app.state.overlay || app.state.modal) return;
      const btn = tileOf(e);
      if (!btn) return;
      const svg = btn.querySelector ? btn.querySelector('.tile') : null;
      const r = rectOf(svg || btn);
      st = { id: e.pointerId, key: btn.dataset.key, x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, svg, active: false };
    }
    function move(e) {
      if (!st || e.pointerId !== st.id) return;
      if (!st.active) {
        if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) < SLOP) return;
        st.active = true;
        suppress = true;
        try { if (root.setPointerCapture) root.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        if (doc && doc.createElement && doc.body) {
          floatEl = doc.createElement('div');
          floatEl.className = 'dragfloat';
          floatEl.style.width = st.w + 'px'; floatEl.style.height = st.h + 'px';
          if (st.svg && st.svg.cloneNode) floatEl.appendChild(st.svg.cloneNode(true));
          doc.body.appendChild(floatEl);
          if (doc.body.classList) doc.body.classList.add('dragging');
        }
        app.dispatch({ type: 'dragStart', key: st.key });
      }
      if (floatEl) floatEl.style.transform = 'translate(' + (e.clientX - st.dx) + 'px, ' + (e.clientY - st.dy) + 'px) scale(1.06) rotate(-3deg)';
      const inside = (r, x, y) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
      // over a train? If this tile can be played there, dropping it plays it
      const tracks = root.querySelectorAll ? Array.from(root.querySelectorAll('.track')) : [];
      const hit = tracks.find(tr => inside(rectOf(tr), e.clientX, e.clientY));
      const legal = app.legalTrains ? app.legalTrains(st.key) : [];
      const over = hit && legal.includes(hit.dataset.train) ? hit.dataset.train : null;
      if (over !== st.over) { st.over = over; app.dispatch({ type: 'dragOver', train: over }); }
      if (hit) return;                                          // over a train: not rearranging the hand
      const tray = root.querySelector ? root.querySelector('.tray') : null;
      if (tray && tray.getBoundingClientRect && !inside(rectOf(tray), e.clientX, e.clientY)) return;   // out on the table: leave the hand alone
      const els = Array.from(root.querySelectorAll('.hand .tile-btn'));
      if (els.length) app.dispatch({ type: 'dragMove', index: dropIndexAt(els.map(rectOf), e.clientX, e.clientY, els.findIndex(el => el.dataset.key === st.key)) });
    }
    function up(e, cancelled) {
      if (!st || (e && e.pointerId !== undefined && e.pointerId !== st.id)) return;
      const wasDrag = st.active, over = cancelled ? null : st.over, k = st.key;
      const from = e && e.clientX !== undefined ? { left: e.clientX - st.dx, top: e.clientY - st.dy, width: st.w, height: st.h } : null;   // where it was let go
      st = null;
      if (!wasDrag) return;
      if (floatEl && floatEl.remove) floatEl.remove();
      floatEl = null;
      if (doc && doc.body && doc.body.classList) doc.body.classList.remove('dragging');
      try { if (root.releasePointerCapture && e) root.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (over) app.dispatch({ type: 'dropOnTrain', key: k, train: over, from });     // let go over a train: play it there
      else app.dispatch({ type: 'dragEnd' });
      setTimeout(() => { suppress = false; }, 0);    // swallow the click that follows a drag
    }
    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', e => up(e, true));
    return { consumeClick() { if (suppress) { suppress = false; return true; } return false; }, get dragging() { return !!(st && st.active); } };
  }

  /* ============================== TRASH TALK =============================== */
  /* The computer rates each of your moves against the best one available and comments. It is
   * rude in a cheeky, game-night way: it teases your play, never you, and keeps to mild language.
   * Comments can be switched off (the "Comments" button). Nothing here touches the game's random
   * numbers, so a game plays out identically with comments on or off. */

  // gap (in evaluation points) below the best available move
  const RATING = { great: 0.5, good: 8, poor: 16, awful: 32 };

  /* Which kind of comment (if any) a rated move deserves. */
  function commentKindFor(r) {
    if (r.forced) return 'forced';
    if (r.best >= 1000 && r.value < 1000) return 'missedOut';     // could have gone out and did not
    if (r.gap <= RATING.great) return 'great';
    if (r.gap <= RATING.good) return 'good';
    if (r.gap >= RATING.awful) return 'awful';
    if (r.gap >= RATING.poor) return 'poor';
    return null;                                                  // in the middle: not worth a remark
  }

  const LINES_NORMAL = {
    great: [
      'Fine, that was a decent move. Do not let it go to your head.',
      'Even a broken clock is right twice a day.',
      'Lucky guess, but sure, take the credit.',
      'Annoyingly good. I hate that.',
      'Okay, okay. One good move. Want a medal?',
      'Was that skill or an accident? I am betting accident.',
      'Hm. Not bad. Do not get used to my compliments.',
      'I would clap, but I am busy winning.',
      'That was suspiciously smart for you.',
      'Fine. You may stay at the table.',
    ],
    good: [
      'Acceptable. Barely.',
      'Not terrible. I would give it a participation ribbon.',
      'That will do, I suppose.',
      'A sensible move. I am as shocked as you are.',
      'Meh. I have seen better. I have seen worse.',
      'Adequate. Put it on your resume.',
      'Safe and boring. Very you.',
      'Okay. A solid B-minus.',
    ],
    poor: [
      'Wow. Bold choice. Wrong, but bold.',
      'Did you pick that tile with your eyes closed?',
      'I have seen better plays from a sack of potatoes.',
      'Interesting strategy. Is the plan to lose?',
      'My grandmother plays better, and she is a houseplant.',
      'Ooh, that hurts to watch.',
      'Was that a mistake, or do you just enjoy suffering?',
      'Keep going. I love it when you help me.',
      'Even the boneyard is embarrassed for you.',
      'A real head-scratcher. And not in a good way.',
      'You played that like the tiles owe you money.',
      'That move had so much confidence and so little reason.',
    ],
    awful: [
      'That might be the worst move I have seen all week.',
      'Please tell me that was a misclick.',
      'I almost feel sorry for you. Almost.',
      'Did a pigeon make that move for you?',
      'Were you trying to lose, or is it a natural talent?',
      'Incredible. You found the one move that helps me most.',
      'I have no words. Well, I have plenty, but none are kind.',
      'Somewhere, a domino is crying.',
      'Remind me to send flowers to your hand. It deserves better.',
      'That move should come with a warning label.',
    ],
    forced: [
      'That was your only move. Do not act like you planned it.',
      'Forced move. Genius, truly.',
      'You had exactly one option. Congratulations on finding it.',
      'Wow, picking the only tile that fits. Take a bow.',
      'A choice of one. Even you could not mess that up.',
      'That one was practically automatic. Like breathing.',
    ],
    missedOut: [
      'You could have gone OUT. Out! Do you even want to win?',
      'That was the winning move and you walked right past it.',
      'You had the win in your hand and chose chaos. Respect, sort of.',
      'You could have finished the round right there. Thank you, though.',
    ],
    slow1: [
      'Hello? Still with us?',
      'Take your time. Really. Glaciers are watching and feeling rushed.',
      'Are you thinking, or just staring at the tiles?',
      'The tiles are not going to play themselves.',
      'I could learn a language in the time you are taking.',
    ],
    slow2: [
      'I have aged a year waiting for you.',
      'Did you fall asleep on the tiles?',
      'Tick, tock. That is the sound of me winning.',
      'Is your brain buffering?',
      'I am starting to think the tiles frighten you.',
    ],
    slow3: [
      'I am filing a missing person report. Last seen: your turn.',
      'At this rate the game ends when the sun burns out.',
      'Just pick one! Any one! I will pretend it was clever.',
      'I have started a new hobby while waiting. Pottery, I think.',
      'Wake me when you have decided. I will be winning in my sleep.',
    ],
    draw: [
      'Nothing fits? Off to the boneyard with you.',
      'Shopping for tiles again? Your favorite.',
      'Out of moves already? Painful.',
      'The boneyard must know you by name now.',
      'Draw, draw, draw. It is your best skill.',
    ],
    pass: [
      'Passing? Bold. Silly, but bold.',
      'A marker on your train. How welcoming.',
      'Thanks for leaving the door open.',
      'A pass? I will happily take that train for a spin.',
    ],
    openBest: [
      'Longest train possible. Show-off.',
      'Fine, a proper opening. I am not impressed.',
      'You found the best train. Nobody likes a perfectionist.',
    ],
    openShort: [
      'You built {built} when you could have built {best}. Impressive laziness.',
      'That is it? {built} tiles, and you had {best} in you.',
      'A short train for a short attention span?',
      'You left tiles in your hand that could have gone down. Lazy.',
      'My train is going to run circles around yours.',
    ],
    openNone: [
      'You could have built a train and chose not to. Brave.',
      'No train at all? Minimalism, I respect it. Not really.',
    ],
  };

  // EASY: a cheerful beginner. Still rude, but clumsily: it teases you with its own mistakes, is
  // astonished when you play well, and gets bored and hungry when you take too long.
  const LINES_EASY = {
    great: [
      'Ooh, that was a good one. Now I feel silly.',
      'Hey, no fair being good at this!',
      'Okay, I will admit that was pretty clever.',
      'Wow. I did not see that coming. I rarely see anything coming.',
      'You are making this look easy, and it is not nice of you.',
      'Great move! I am telling everyone you cheated. Kidding. Maybe.',
      'Grr. I was hoping you would not notice that one.',
      'Show-off! I would clap, but I need both hands to count my tiles.',
    ],
    good: [
      'That seems fine? I honestly have no idea.',
      'Not bad! I think. I would not know.',
      'Looks reasonable to me, and I once played a tile upside down.',
      'Fine move. I am still figuring out which end is which.',
      'Okay, that works. Unlike most of mine.',
      'Solid! Probably! I am only guessing.',
      'Sure, go ahead, be sensible. See if I care.',
      'A decent move. I am only a little bit jealous.',
    ],
    poor: [
      'Hmm, even I would not have played that, and I am terrible.',
      'Oops. Was that on purpose? I am confused for you.',
      'I am not an expert, but that looked wrong.',
      'Oh no. My cat could have done better, and she is a cat.',
      'Bold! Questionable! But bold!',
      'That felt like one of MY moves. Welcome to the club.',
      'Did you mean to do that? Because I would not have.',
      'Ha! Finally someone plays worse than me. Almost.',
    ],
    awful: [
      'Wow. That might be worse than anything I have ever done, and I have done a lot.',
      'I am not mad, I am just amazed.',
      'Please say that was a slip of the finger.',
      'Yikes. Even I flinched.',
      'You have taken the title of worst player from me. I am almost proud.',
      'That was so bad I am going to take a nap to recover.',
      'Oh dear. Oh dear, oh dear, oh dear.',
      'I do not even have a joke for that one. It hurt too much.',
    ],
    forced: [
      'Only one move? Lucky! I never get those.',
      'That was the only one that fit, right? Right?',
      'Wow, you found the one tile that fits. So brave.',
      'No choice at all. Must be nice. Or boring.',
      'You had one option and you took it. Brilliant!',
    ],
    missedOut: [
      'Wait, you could have gone out! Why did you not go out?',
      'You had the win right there. I would have cried with joy.',
      'Hey, you could have finished! I was ready to lose!',
      'That was the winning move! I was braced for it!',
    ],
    slow1: [
      'Um, hello? Is it still your turn?',
      'Take your time! I am just looking at the ceiling.',
      'Are you thinking? I can hear nothing.',
      'I am getting a little bored, no pressure.',
      'I wonder what is for lunch. Still thinking over there?',
    ],
    slow2: [
      'I have counted all the tiles twice now. Twice!',
      'I think I just heard my stomach growl. Hurry up?',
      'Did you fall asleep? Should I wave?',
      'I have started naming the pips. This one is Gary.',
      'Still here! Still waiting! Still pretty bored!',
    ],
    slow3: [
      'I have given every tile a name and a backstory.',
      'I am going to go make a sandwich. Tell me when you are done.',
      'I have built a little fort out of the boneyard in my head.',
      'Hello?? I am running out of ceiling to stare at!',
      'Pick something! Anything! I promise I will not judge. Much.',
    ],
    draw: [
      'Nothing fits? Same! It happens to me constantly.',
      'Off to the boneyard! Bring snacks.',
      'Ooh, draw time. I love a surprise tile.',
      'Sorry, nothing to play? That is rough, buddy.',
      'Drawing again? Join the club.',
    ],
    pass: [
      'A pass? Do I get to play on your train now? Fun!',
      'Oh, a little train marker! Very festive.',
      'You passed! I do that all the time and it never helps.',
      'Passing, huh? Brave. Or lost.',
    ],
    openBest: [
      'Wow, that is a long train. Showing off again.',
      'The longest train possible? Who told you the trick?',
      'That is the best one! I am going to need a bigger train.',
    ],
    openShort: [
      'You built {built}. You could have built {best}. I am shocked!',
      'That is it? {built}? I would have tried for {best}.',
      'You left tiles behind. Did they do something to you?',
      'A short train! Shorter than mine, and mine is short.',
      'Hmm, I think you can do better than {built}.',
    ],
    openNone: [
      'No train at all? I mean, okay, it is a choice.',
      'You skipped the train completely? Bold.',
    ],
  };

  // HARD: smug and exact. It has already counted your tiles, it is never impressed, and it
  // treats every mistake of yours as something it planned for.
  const LINES_HARD = {
    great: [
      'Correct. I had that one in my calculations.',
      'Adequate. I will update my estimate of you slightly.',
      'Finally, a move worth my attention.',
      'Acceptable. Do not expect me to be impressed twice.',
      'That is the move I would have made. Do not make me regret noticing.',
      'Hm. You are not hopeless. Disappointing, really.',
      'Fine. Even a stopped clock, and so on.',
      'Precise. Irritatingly precise.',
    ],
    good: [
      'Passable. I already priced that in.',
      'Safe. Predictable. Fine.',
      'Serviceable. Nothing I did not expect.',
      'A reasonable move. I will allow it.',
      'Not an error. Not brilliant either.',
      'That will do. For now.',
      'Competent. In a modest sort of way.',
      'Fine. It changes nothing.',
    ],
    poor: [
      'A mistake. I already see three ways to punish it.',
      'That was a gift. I accept it.',
      'Careless. I counted on that.',
      'You had better options and you chose that. Remarkable.',
      'I would explain what you did wrong, but we would both be here all day.',
      'Thank you. That makes my next few turns much easier.',
      'That move had a flaw you could see from across the room.',
      'Every move tells me something. That one told me a lot.',
    ],
    awful: [
      'That is the sort of move I study to learn what not to do.',
      'You have handed me this round, gift-wrapped.',
      'I almost admire how thoroughly you threw that away.',
      'Impressive. I could not have blundered that well on purpose.',
      'The position was fine. You fixed that.',
      'I will remember that one. Probably fondly.',
      'Please, continue. I am enjoying this.',
      'There are bad moves, and then there is whatever that was.',
    ],
    forced: [
      'A forced move. Even the tiles knew you had no choice.',
      'One option. Naturally you found it.',
      'No decision required. Spare yourself the credit.',
      'That was the only play. Do not mistake it for skill.',
      'Forced. I could have played that for you.',
    ],
    missedOut: [
      'You could have gone out. I would not have missed that.',
      'The round was yours and you let it go. Noted.',
      'You had the win and walked away. I will take the points.',
      'Finishing was right there. A pity.',
    ],
    slow1: [
      'I solved this position a while ago. Whenever you are ready.',
      'Your move. Any time this year.',
      'My patience is a finite resource.',
      'I could finish this round in my head while you decide.',
      'Is there a plan, or are we improvising?',
    ],
    slow2: [
      'Tick, tock. I have already played this out four times.',
      'Every second you waste, I plan another way to win.',
      'The clock is not your friend.',
      'I am beginning to suspect you are stalling.',
      'Thinking harder will not make the position better.',
    ],
    slow3: [
      'At this point I am simply admiring the commitment to indecision.',
      'I have mentally won three games while you decided. Your move.',
      'Decision paralysis is a lovely look on you.',
      'I have time. You, apparently, are running out of it.',
      'Take as long as you like. The result does not change.',
    ],
    draw: [
      'Nothing to play? Predictable.',
      'To the boneyard. Where weak hands go.',
      'You planned poorly. The boneyard is your reward.',
      'Draw. And try thinking ahead this time.',
      'Out of options already. I am not surprised.',
    ],
    pass: [
      'A pass. Your train is now an open invitation.',
      'A train marker. How generous of you.',
      'You passed. I will use that.',
      'No play. Your train is mine to use now.',
    ],
    openBest: [
      'The longest train. That is the minimum standard.',
      'Correct opening. At least you can follow instructions.',
      'Maximum length. Expected. Not impressive.',
    ],
    openShort: [
      'You built {built} when {best} was available. Sloppy.',
      'Only {built}? The rest of your hand is dead weight.',
      'A short train. I will enjoy the difference.',
      'You left tiles in hand that you could have laid. Careless.',
      'The opening decides rounds. You just lost ground.',
    ],
    openNone: [
      'No train at all. A surrender before the game begins.',
      'You built nothing when you could have. Fascinating.',
    ],
  };

  // Every level has its own full set: the lines each computer player says depend on how good it is.
  const LINES = { easy: LINES_EASY, normal: LINES_NORMAL, hard: LINES_HARD };
  const linesFor = level => LINES[level] || LINES.normal;

  // NATIVE-LANGUAGE COMMENTS. A computer player whose name comes from a language written in another
  // alphabet sometimes says its comment in that language (Dmitri in Russian, Keiko in Japanese...),
  // with an English translation underneath. Each entry is [the line, its translation]. They are kept
  // neutral about the speaker's and your gender, and they cover the common reactions; anything
  // without a native line is said in English as usual.
  const NATIVE_LINES = {
    ru: {
      great: [['Неплохо. Не зазнавайся.', 'Not bad. Do not get a big head.'], ['Ладно, это был хороший ход. Один.', 'Fine, that was a good move. Just the one.'], ['Случайность или умение? Ставлю на случайность.', 'Luck or skill? I am betting on luck.']],
      good: [['Сойдёт.', 'It will do.'], ['Нормально. Скучно, но нормально.', 'Fine. Boring, but fine.'], ['Приемлемо. Могло быть хуже. У тебя бывало хуже.', 'Acceptable. It could be worse. You have done worse.']],
      poor: [['Ну и ход. Ты вообще на фишки смотришь?', 'What a move. Are you even looking at the tiles?'], ['Это была ошибка, или ты просто любишь страдать?', 'Was that a mistake, or do you just like suffering?'], ['Смело. Глупо, но смело.', 'Bold. Silly, but bold.']],
      awful: [['Это худший ход, который я видел за всю неделю.', 'That is the worst move I have seen all week.'], ['Скажи, что это была случайность.', 'Tell me that was an accident.'], ['Даже голубь сыграл бы лучше.', 'Even a pigeon would have played better.']],
      forced: [['Единственный ход. Не делай вид, что это был план.', 'The only move. Do not pretend it was a plan.'], ['Выбор из одного. Поздравляю.', 'A choice of one. Congratulations.']],
      missedOut: [['Партию можно было закончить! Зачем так?', 'The round could have been finished! Why do that?'], ['Победа была в руках, но ускользнула.', 'The win was in your hands, but it slipped away.']],
      slow: [['Эй, ты ещё здесь?', 'Hey, are you still there?'], ['Я успел состариться, пока ты думал.', 'I have grown old while you were thinking.'], ['Фишки сами не сыграют, знаешь ли.', 'The tiles will not play themselves, you know.'], ['Пойду заварю чай. Скажешь, когда решишь.', 'I will go and make tea. Tell me when you decide.']],
      draw: [['Ничего не подходит? Тяни из кучи.', 'Nothing fits? Draw from the pile.'], ['Опять тянешь? Это твой главный талант.', 'Drawing again? That is your greatest talent.']],
      pass: [['Пасуешь? Спасибо, что оставил дверь открытой.', 'Passing? Thanks for leaving the door open.'], ['Маркер на твоём поезде. Как мило.', 'A marker on your train. How sweet.']],
    },
    ja: {
      great: [['なかなかやるね。調子に乗らないでよ。', 'Not bad. Do not let it go to your head.'], ['まあ、いい手だったよ。認めてあげる。', 'Well, that was a good move. I will give you that.'], ['実力？それとも偶然？偶然に一票。', 'Skill or luck? I vote luck.']],
      good: [['悪くないね。ぎりぎり。', 'Not bad. Barely.'], ['まあまあだね。', 'So-so.'], ['無難な手。あなたらしい。', 'A safe move. Very you.']],
      poor: [['えっ、本気でそれ？目を閉じて選んだの？', 'Seriously, that one? Did you pick it with your eyes closed?'], ['大胆だね。間違ってるけど。', 'Bold. Though wrong.'], ['見てるこっちが痛いよ。', 'It hurts just to watch.']],
      awful: [['今週で一番ひどい手だよ。', 'That is the worst move of the week.'], ['お願いだから、クリックミスだったと言って。', 'Please tell me it was a misclick.'], ['ドミノが泣いてるよ。', 'The dominoes are crying.']],
      forced: [['それしか出せなかったでしょ。作戦じゃないよね。', 'That was your only move, right? It was not a strategy.'], ['選択肢が一つ。おめでとう。', 'One option. Congratulations.']],
      missedOut: [['上がれたのに！どうして上がらなかったの？', 'You could have gone out! Why did you not?'], ['勝ちが目の前にあったのに、見逃したね。', 'The win was right in front of you and you missed it.']],
      slow: [['もしもーし、まだいる？', 'Hello, are you still there?'], ['待ってる間に歳をとったよ。', 'I aged while waiting.'], ['ドミノは勝手に動かないよ。', 'The dominoes will not move by themselves.'], ['お茶を入れてくるね。決まったら教えて。', 'I will go and make tea. Tell me when you decide.']],
      draw: [['出せるのがないの？山から引いてきなよ。', 'Nothing to play? Go draw from the pile.'], ['また引くの？得意技だね。', 'Drawing again? Your specialty.']],
      pass: [['パス？扉を開けてくれてありがとう。', 'Pass? Thanks for leaving the door open.'], ['マーカーがついたよ。親切だね。', 'A marker on your train. How kind.']],
    },
    zh: {
      great: [['不错嘛，别得意。', 'Not bad, do not get cocky.'], ['好吧，这步走得挺好。就这一步。', 'Alright, that was a good move. Just that one.'], ['是实力还是运气？我押运气。', 'Skill or luck? I bet on luck.']],
      good: [['还行吧，勉强。', 'Okay, barely.'], ['一般般。', 'So-so.'], ['稳妥，但很无聊。', 'Safe, but boring.']],
      poor: [['这步棋……你是闭着眼睛选的吗？', 'That move... did you pick it with your eyes closed?'], ['够大胆，可惜是错的。', 'Bold enough, but sadly wrong.'], ['看得我都替你难受。', 'It hurts me just to watch.']],
      awful: [['这是我这周见过最糟的一步。', 'That is the worst move I have seen this week.'], ['拜托告诉我你点错了。', 'Please tell me you misclicked.'], ['连鸽子都比你走得好。', 'Even a pigeon would play better than you.']],
      forced: [['就这一张能出，别装成是计划。', 'That was the only one that fit, do not pretend it was a plan.'], ['只有一个选择，恭喜你找到了。', 'Only one choice, congratulations on finding it.']],
      missedOut: [['你本来可以出完的！为什么不出？', 'You could have gone out! Why did you not?'], ['胜利就在手里，你却放走了。', 'Victory was in your hand and you let it go.']],
      slow: [['喂，你还在吗？', 'Hey, are you still there?'], ['等你等得我都老了。', 'I have aged waiting for you.'], ['骨牌自己是不会动的哦。', 'Dominoes will not move by themselves, you know.'], ['我去泡杯茶，你想好了叫我。', 'I will go make tea, call me when you have decided.']],
      draw: [['没牌可出？去牌堆里摸吧。', 'Nothing to play? Go draw from the pile.'], ['又摸牌？这可是你的拿手好戏。', 'Drawing again? That is your specialty.']],
      pass: [['跳过？谢谢你替我开门。', 'A pass? Thanks for opening the door for me.'], ['你的牌路上放了标记，真贴心。', 'There is a marker on your train, how thoughtful.']],
    },
    ko: {
      great: [['꽤 잘하네. 우쭐대지는 마.', 'Pretty good. Do not get cocky.'], ['좋아, 방금은 괜찮은 수였어. 딱 한 번.', 'Okay, that was a decent move. Just once.'], ['실력이야 운이야? 난 운에 걸게.', 'Skill or luck? I bet on luck.']],
      good: [['나쁘진 않네. 겨우.', 'Not bad. Barely.'], ['그럭저럭이야.', 'It is so-so.'], ['안전한 수네. 참 너답다.', 'A safe move. Very you.']],
      poor: [['그걸 둔다고? 눈 감고 골랐어?', 'You play that? Did you pick it with your eyes closed?'], ['대담하네. 틀렸지만.', 'Bold. Though wrong.'], ['보는 내가 아프다.', 'It hurts me to watch.']],
      awful: [['이번 주에 본 최악의 수야.', 'The worst move I have seen this week.'], ['제발 잘못 눌렀다고 말해줘.', 'Please tell me you misclicked.'], ['비둘기도 더 잘 두겠다.', 'Even a pigeon would play better.']],
      forced: [['낼 수 있는 게 그것뿐이었잖아. 전략인 척하지 마.', 'That was the only one you could play. Do not pretend it was a strategy.'], ['선택지가 하나였네. 축하해.', 'You had one option. Congratulations.']],
      missedOut: [['끝낼 수 있었는데! 왜 안 끝냈어?', 'You could have finished! Why did you not?'], ['승리가 손안에 있었는데 놓쳤네.', 'Victory was in your hand and you let it slip.']],
      slow: [['여보세요, 아직 있어?', 'Hello, are you still there?'], ['기다리다 늙겠어.', 'I will grow old waiting.'], ['도미노는 저절로 안 움직여.', 'Dominoes do not move by themselves.'], ['차 한잔 하고 올게. 정하면 불러.', 'I will go have some tea. Call me when you decide.']],
      draw: [['낼 게 없어? 더미에서 뽑아.', 'Nothing to play? Draw from the pile.'], ['또 뽑아? 네 특기네.', 'Drawing again? Your specialty.']],
      pass: [['패스? 문을 열어줘서 고마워.', 'Pass? Thanks for opening the door.'], ['네 기차에 마커가 놓였네. 친절하기도 하지.', 'A marker on your train. How kind.']],
    },
    hi: {
      great: [['बुरा नहीं। ज़्यादा उड़ो मत।', 'Not bad. Do not get carried away.'], ['ठीक है, यह अच्छी चाल थी। बस एक।', 'Okay, that was a good move. Just one.'], ['हुनर था या किस्मत? मेरा दाँव किस्मत पर है।', 'Skill or luck? My bet is on luck.']],
      good: [['चलेगा।', 'It will do.'], ['ठीक-ठाक है, बस।', 'It is okay, that is all.'], ['सुरक्षित चाल। एकदम तुम्हारी तरह।', 'A safe move. Just like you.']],
      poor: [['यह क्या चाल थी? आँखें बंद करके चुनी क्या?', 'What kind of move was that? Did you pick it with your eyes closed?'], ['हिम्मत वाली चाल। गलत, पर हिम्मत वाली।', 'A brave move. Wrong, but brave.'], ['देखकर ही दर्द हो रहा है।', 'It hurts just to watch.']],
      awful: [['इस हफ़्ते की सबसे बुरी चाल यही है।', 'This is the worst move of the week.'], ['प्लीज़ कह दो कि गलती से क्लिक हो गया।', 'Please say it was clicked by mistake.'], ['कबूतर भी इससे अच्छा खेल लेता।', 'Even a pigeon could play better than this.']],
      forced: [['बस यही एक चाल थी। इसे योजना मत कहना।', 'This was the only move. Do not call it a plan.'], ['एक ही विकल्प था। बधाई हो!', 'There was only one option. Congratulations!']],
      missedOut: [['राउंड खत्म हो सकता था! आपने क्यों नहीं किया?', 'The round could have ended! Why did you not do it?'], ['जीत हाथ में थी और हाथ से निकल गई।', 'The win was in hand and slipped away.']],
      slow: [['अरे, कोई है?', 'Hey, is anyone there?'], ['इंतज़ार करते-करते उम्र निकल गई।', 'A whole lifetime has passed waiting.'], ['डोमिनो अपने आप नहीं चलते, पता है न?', 'Dominoes do not move by themselves, you know?'], ['चाय बन रही है। फ़ैसला हो जाए तो बताना।', 'Tea is brewing. Tell me when you have decided.']],
      draw: [['कुछ नहीं चल रहा? ढेर से उठा लो।', 'Nothing playable? Pick from the pile.'], ['फिर से उठा रहे हो? यही तुम्हारी खासियत है।', 'Drawing again? That is your specialty.']],
      pass: [['पास? दरवाज़ा खुला छोड़ने के लिए शुक्रिया।', 'Pass? Thanks for leaving the door open.'], ['तुम्हारी ट्रेन पर मार्कर लग गया। कितनी मेहरबानी!', 'A marker on your train. How kind!']],
    },
    ar: {
      great: [['ليس سيئًا. لا تغتر.', 'Not bad. Do not get conceited.'], ['حسنًا، كانت حركة جيدة. واحدة فقط.', 'Fine, that was a good move. Only one.'], ['مهارة أم حظ؟ أراهن على الحظ.', 'Skill or luck? I bet on luck.']],
      good: [['مقبول. بالكاد.', 'Acceptable. Barely.'], ['لا بأس بها.', 'It is alright.'], ['حركة آمنة ومملة. تشبهك.', 'A safe and boring move. Just like you.']],
      poor: [['ما هذه الحركة؟ هل اخترتها وعيناك مغمضتان؟', 'What is this move? Did you choose it with your eyes closed?'], ['جريئة، لكنها خاطئة.', 'Bold, but wrong.'], ['يؤلمني مجرد النظر إليها.', 'It hurts me just to look at it.']],
      awful: [['هذه أسوأ حركة رأيتها هذا الأسبوع.', 'This is the worst move I have seen this week.'], ['أتمنى أن تكون نقرة خاطئة.', 'I hope it was a misclick.'], ['حتى الحمامة كانت ستلعب أفضل.', 'Even a pigeon would have played better.']],
      forced: [['كانت الحركة الوحيدة الممكنة، وليست خطة.', 'It was the only possible move, not a plan.'], ['خيار واحد فقط. مبروك على إيجاده!', 'Only one choice. Congratulations on finding it!']],
      missedOut: [['كان بالإمكان إنهاء الجولة! لماذا لم يحدث ذلك؟', 'The round could have been finished! Why did that not happen?'], ['كان الفوز بين يديك فتركته يفلت.', 'The win was in your hands and you let it slip.']],
      slow: [['مرحبًا؟ هل ما زلت هنا؟', 'Hello? Are you still here?'], ['كبرتُ عامًا وأنا أنتظر.', 'I have aged a year while waiting.'], ['الأحجار لن تلعب نفسها.', 'The tiles will not play themselves.'], ['سأحضّر الشاي الآن، وسيكون جاهزًا قبل قرارك.', 'I will make tea now, and it will be ready before your decision.']],
      draw: [['لا شيء يصلح؟ حان وقت السحب من الكومة.', 'Nothing fits? Time to draw from the pile.'], ['سحب مرة أخرى؟ هذه موهبتك الكبرى.', 'Drawing again? That is your great talent.']],
      pass: [['تمرير؟ شكرًا على ترك الباب مفتوحًا.', 'Pass? Thanks for leaving the door open.'], ['مصباح على قطارك. يا للكرم!', 'A lamp on your train. How generous!']],
    },
  };
  // which computer players use which language (names from a Latin-script language stay in English)
  const NATIVE_LANG = {
    Dmitri: 'ru',
    Keiko: 'ja', Hiro: 'ja', Kenji: 'ja',
    Mei: 'zh', Wen: 'zh',
    Joon: 'ko',
    Ravi: 'hi', Priya: 'hi', Arjun: 'hi', Anil: 'hi', Sunita: 'hi',
    Omar: 'ar', Aisha: 'ar', Zainab: 'ar', Tariq: 'ar', Noor: 'ar',
  };
  const NATIVE_DIR = { ar: 'rtl' };
  const nativeLangOf = name => NATIVE_LANG[name] || null;

  // HUNGRY PLAYERS. While you take your time, a computer player may announce that it is hungry and
  // go off for something from its home country. Every player has a home country and three dishes
  // from it (`d`, in English); the players who speak a native language also have the dishes written
  // in it (`n`, same order). It escalates with the slow-player jabs: peckish, off to get some, back
  // and finished while you are still thinking.
  const FOOD = {
    // Easy
    Bea: { c: 'Spain', d: ['paella', 'tortilla española', 'churros with hot chocolate'] },
    Pablo: { c: 'Argentina', d: ['empanadas', 'asado', 'alfajores'] },
    Mei: { c: 'China', d: ['dumplings', 'steamed buns', 'zhajiangmian noodles'], n: ['饺子', '包子', '炸酱面'] },
    Rosa: { c: 'Mexico', d: ['tacos al pastor', 'tamales', 'chilaquiles'] },
    Lucia: { c: 'Italy', d: ['pizza', 'pasta', 'cannoli'] },
    Felix: { c: 'Germany', d: ['bratwurst', 'soft pretzels', 'schnitzel'] },
    Greta: { c: 'Sweden', d: ['meatballs', 'cinnamon buns', 'pickled herring'] },
    Noor: { c: 'Syria', d: ['shawarma', 'fattoush', 'kebab'], n: ['شاورما', 'فتوش', 'كباب'] },
    Anil: { c: 'India', d: ['poha', 'jalebi', 'pav bhaji'], n: ['पोहा', 'जलेबी', 'पाव भाजी'] },
    Tamsin: { c: 'England', d: ['Cornish pasties', 'fish and chips', 'scones with clotted cream'] },
    Wen: { c: 'China', d: ['soup dumplings', 'hotpot', 'wontons'], n: ['小笼包', '火锅', '馄饨'] },
    Imani: { c: 'Kenya', d: ['nyama choma', 'chapati', 'mandazi'] },
    Sunita: { c: 'India', d: ['khichdi', 'dal', 'aloo paratha'], n: ['खिचड़ी', 'दाल', 'आलू पराठा'] },
    Joon: { c: 'South Korea', d: ['kimchi stew', 'bibimbap', 'tteokbokki'], n: ['김치찌개', '비빔밥', '떡볶이'] },
    Yara: { c: 'Brazil', d: ['pão de queijo', 'feijoada', 'brigadeiros'] },
    Kofi: { c: 'Ghana', d: ['waakye', 'kelewele', 'fufu with light soup'] },
    // Medium
    Marta: { c: 'Poland', d: ['pierogi', 'bigos', 'kielbasa'] },
    Ravi: { c: 'India', d: ['samosas', 'parathas', 'chaat'], n: ['समोसा', 'पराठा', 'चाट'] },
    Keiko: { c: 'Japan', d: ['ramen', 'onigiri', 'udon'], n: ['ラーメン', 'おにぎり', 'うどん'] },
    Omar: { c: 'Egypt', d: ['koshari', 'ful medames', 'taameya'], n: ['كشري', 'فول', 'طعمية'] },
    Lena: { c: 'Austria', d: ['Wiener schnitzel', 'Sachertorte', 'apple strudel'] },
    Mateo: { c: 'Colombia', d: ['arepas', 'bandeja paisa', 'ajiaco'] },
    Priya: { c: 'India', d: ['dosa', 'idli', 'upma'], n: ['डोसा', 'इडली', 'उपमा'] },
    Jonah: { c: 'Israel', d: ['shakshuka', 'sabich', 'burekas'] },
    Aisha: { c: 'Jordan', d: ['mansaf', 'hummus', 'falafel'], n: ['منسف', 'حمص', 'فلافل'] },
    Hiro: { c: 'Japan', d: ['takoyaki', 'yakitori', 'sushi'], n: ['たこ焼き', '焼き鳥', 'お寿司'] },
    Sofia: { c: 'Greece', d: ['souvlaki', 'spanakopita', 'baklava'] },
    Nadia: { c: 'Portugal', d: ['pastéis de nata', 'bacalhau', 'francesinha'] },
    Freya: { c: 'Norway', d: ['waffles with brown cheese', 'lefse', 'smoked salmon'] },
    Bruno: { c: 'Brazil', d: ['coxinha', 'moqueca', 'açaí bowls'] },
    Callum: { c: 'Scotland', d: ['haggis with neeps and tatties', 'cullen skink', 'shortbread'] },
    Zainab: { c: 'Iraq', d: ['kubba', 'dolma', 'masgouf'], n: ['كبة', 'دولمة', 'مسقوف'] },
    // Hard
    Ingrid: { c: 'Denmark', d: ['smørrebrød', 'frikadeller', 'Danish pastries'] },
    Dmitri: { c: 'Russia', d: ['borscht', 'pelmeni', 'blini'], n: ['борщ', 'пельмени', 'блины'] },
    Arjun: { c: 'India', d: ['butter chicken', 'naan', 'biryani'], n: ['बटर चिकन', 'नान', 'बिरयानी'] },
    Kwame: { c: 'Ghana', d: ['kenkey', 'banku with tilapia', 'red red'] },
    Tariq: { c: 'Lebanon', d: ['kibbeh', 'tabbouleh', 'manakish'], n: ['كبة', 'تبولة', 'مناقيش'] },
    Elsa: { c: 'Finland', d: ['Karelian pies', 'salmon soup', 'cinnamon pulla'] },
    Diego: { c: 'Mexico', d: ['mole', 'elote', 'pozole'] },
    Stefan: { c: 'Hungary', d: ['goulash', 'langos', 'chimney cake'] },
    Chiara: { c: 'Italy', d: ['risotto', 'tiramisu', 'carbonara'] },
    Amara: { c: 'Nigeria', d: ['jollof rice', 'suya', 'egusi soup'] },
    Leon: { c: 'France', d: ['croissants', 'ratatouille', 'crêpes'] },
    Odile: { c: 'France', d: ['coq au vin', 'macarons', 'quiche lorraine'] },
    Rafael: { c: 'Portugal', d: ['caldo verde', 'sardines on toast', 'arroz de pato'] },
    Kenji: { c: 'Japan', d: ['tonkatsu', 'okonomiyaki', 'soba'], n: ['とんかつ', 'お好み焼き', 'そば'] },
    Selam: { c: 'Ethiopia', d: ['injera with doro wat', 'tibs', 'kitfo'] },
    Paloma: { c: 'Peru', d: ['ceviche', 'lomo saltado', 'anticuchos'] },
  };
  // What they say, by how long you have taken: [1] peckish, [2] off to get some, [3] back and finished.
  const FOOD_ENGLISH = [
    [
      'I am getting hungry. Some {dish} would be nice right now.',
      'My stomach is rumbling. I am thinking about {dish}, to be honest.',
      'Take your time. I am daydreaming about {dish} anyway.',
      'All this waiting is making me want {dish}.',
    ],
    [
      'That is it, I am hungry. I am going to get some {dish}. Do not move.',
      'I am off to find {dish}. Decide while I am gone.',
      'In {country} nobody plays on an empty stomach. I am getting some {dish}.',
      'Back in {country} I would have had {dish} by now. Be right back.',
    ],
    [
      'I went and got {dish}. All gone now. Still waiting.',
      'Back with {dish}. All gone now, and you are still thinking.',
      'I could have flown to {country} for {dish} by now.',
      'Two helpings of {dish} later, and still no move.',
    ],
  ];
  // the same, in their own language: [line, translation], with the dish in the language's own script
  const FOOD_NATIVE = {
    ru: [
      ['Я проголодался. Сейчас бы {dish}.', 'I am getting hungry. I could really go for {dish} right now.'],
      ['Всё, я голоден. Пойду возьму {dish}. Пока думай.', 'That is it, I am hungry. I am going to get some {dish}. Keep thinking in the meantime.'],
      ['Я уже сходил поесть: {dish}. А ты всё думаешь.', 'I have already been to eat: {dish}. And you are still thinking.'],
    ],
    ja: [
      ['お腹すいてきたなあ。{dish}が食べたい。', 'I am getting hungry. I want some {dish}.'],
      ['もうお腹ぺこぺこ。{dish}を食べてくるね。その間に考えててね。', 'I am starving. I am going to go and eat some {dish}. Keep thinking in the meantime.'],
      ['{dish}、食べ終わっちゃった。まだ考えてるの？', 'I finished my {dish}. Are you still thinking?'],
    ],
    zh: [
      ['我有点饿了。真想吃{dish}。', 'I am getting a bit hungry. I really want some {dish}.'],
      ['不行了，我饿坏了。去吃点{dish}，你慢慢想。', 'I cannot take it, I am starving. I am going to eat some {dish}, take your time.'],
      ['我{dish}都吃完了，你还没想好？', 'I have finished my {dish} and you still have not decided?'],
    ],
    ko: [
      ['배고파지네. {dish} 먹고 싶다.', 'I am getting hungry. I want to eat {dish}.'],
      ['더는 못 참겠어. {dish} 먹으러 갈게. 그동안 생각해.', 'I cannot stand it. I am going to eat {dish}. Think in the meantime.'],
      ['{dish} 다 먹었는데 아직도 고민 중이야?', 'I finished eating {dish} and you are still deciding?'],
    ],
    hi: [
      ['भूख लगने लगी है। {dish} खाने का मन है।', 'I am getting hungry. I feel like eating {dish}.'],
      ['अब बहुत भूख लगी है। {dish} लेने जाना है, तुम सोचते रहो।', 'I am very hungry now. I have to go and get {dish}, you keep thinking.'],
      ['{dish} खा भी लिया, और फ़ैसला अभी तक नहीं हुआ?', 'I have eaten the {dish} as well, and still no decision?'],
    ],
    ar: [
      ['بدأت أشعر بالجوع. أشتهي {dish} الآن.', 'I am starting to feel hungry. I am craving {dish} right now.'],
      ['جعت جدًا. سأذهب لأحضر {dish}، ولا داعي للعجلة.', 'I am very hungry. I will go and get {dish}, and there is no need to hurry.'],
      ['أكلت {dish} وانتهيت، وما زال القرار ينتظر.', 'I ate {dish} and finished, and the decision is still waiting.'],
    ],
  };

  /* A hungry remark for this player, for the given slow-player tier (1 to 3): in its own language
   * with a translation if it has one (and the dice say so), otherwise in English. Never the line
   * `last` that was just said. */
  function foodComment(name, tier, rng, nativeChance, last, dish) {
    const f = FOOD[name];
    if (!f) return null;
    const t = Math.min(3, Math.max(1, tier)) - 1;
    const pick = n => Math.min(n - 1, Math.floor(rng() * n));
    const lang = nativeLangOf(name);
    const native = !!(lang && f.n && FOOD_NATIVE[lang] && nativeChance > 0 && rng() < nativeChance);
    // `dish` is the dish already chosen during this wait (so it is the same one it went for and came back with)
    const i = dish !== undefined && dish !== null && dish < f.d.length ? dish : pick(f.d.length);
    const say = tplIndex => {
      if (native) {
        const [tn, te] = FOOD_NATIVE[lang][t];
        return { text: tn.replace('{dish}', f.n[i]), lang, trans: te.replace('{dish}', f.d[i]), dish: i };
      }
      return { text: FOOD_ENGLISH[t][tplIndex].replace('{dish}', f.d[i]).replace('{country}', f.c), dish: i };
    };
    for (let attempt = 0; attempt < 6; attempt++) {
      const out = say(native ? 0 : pick(FOOD_ENGLISH[t].length));
      if (out.text !== last) return out;
    }
    return say(0);
  }

  const CHAT = {
    chance: { great: 0.45, good: 0.3, poor: 0.8, awful: 1, forced: 0.22, missedOut: 1, draw: 0.2, pass: 0.35, openBest: 0.8, openShort: 1, openNone: 1 },
    cooldownMs: 7000,                                         // at least this long between ordinary comments
    bypass: { awful: true, missedOut: true, openShort: true, openNone: true },   // these always get through
    showMs: 6000,                                             // how long a speech bubble stays up
    reactDelayMs: [600, 1100],                                // a beat after your move before it reacts
    slowAfterMs: 25000,                                       // taking too long: the first jab...
    slowEveryMs: [20000, 26000],                              // ...and then another every 20-26 seconds, getting ruder
    nativeChance: 0.4,                                        // a player with a native language says this share of its comments in it
    foodChance: 0.4,                                          // a slow-player jab from a player with a home country is a hungry one this often
  };

  /* A random line of this kind that is not the one used last. */
  function pickLine(kind, rng, last, level) {
    const pool = linesFor(level)[kind] || [];
    if (!pool.length) return '';
    const choices = pool.length > 1 ? pool.filter(l => l !== last) : pool;
    return choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
  }
  const fillLine = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));

  /* ================================ VIEWS ================================= */

  const fmt = t => t[0] + '-' + t[1];
  const esc = t => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const cpuName = S => S.cpuName || 'Computer';
  /* Who is at the table, in the order the screen shows them: you, then the opponent(s). Two players is the
   * usual game; three is an online game with a computer as the third player. */
  const tableIds = S => (S.game && Array.isArray(S.game.players) && S.game.players.length === 3 ? ['human', 'cpu', 'cpu2'] : ['human', 'cpu']);
  const nameOf = (S, id) => (id === 'human' ? 'You' : id === 'cpu2' ? (S.cpu2Name || 'Computer') : cpuName(S));

  function trainName(S, id) {
    return id === 'human' ? 'Your train' : id === 'cpu' ? `${cpuName(S)}'s train` : id === 'cpu2' ? `${nameOf(S, 'cpu2')}'s train` : 'Mexican train';
  }

  function trainRef(S, id, actor) {
    if (id === 'mexican') return 'the Mexican train';
    if (id === actor) return actor === 'human' ? 'your train' : 'their own train';
    return actor === 'human' ? `${cpuName(S)}'s train` : 'your train';
  }

  function bannerText(S) {
    const a = S.awaiting, g = S.game, hints = hintsOn(S);
    if (S.notice) return S.notice;                              // "that tile cannot go there", after a try with hints off
    if (a && a.kind === 'build') {
      const lead = S.drawnKey ? `You drew ${S.drawnKey}. ` : '';
      if (a.canDraw && hints) return 'Nothing fits the engine. Draw a tile from the boneyard.';
      if (a.lastDouble) return 'Your last tile is a double. A double cannot go out, so it stays in your hand. Press Done.';
      if (!a.canDone) return 'A double needs a tile on top of it. Cover it, or take it back.';
      if (a.placed === 0) return hints ? `${lead}Everyone builds their train at the same time. Tap tiles to add them, or let the game build your longest train.` : `${lead}Everyone builds their train at the same time. Pick a tile, then tap your train.`;
      return 'Keep adding tiles, take the last one back, or press Done. You can take tiles back until you press Done.';
    }
    if (!hints && a && (a.kind === 'move' || a.kind === 'draw')) {
      const lead = S.drawnKey ? `You drew ${S.drawnKey}. ` : '';
      if (S.selectedKey) return `Playing ${S.selectedKey}: tap the train to play it on.`;
      if (g.openDouble) return `${lead}A double is open: play a tile showing ${g.openDouble.value} on the outlined train.`;
      return `${lead}Your turn. Pick a tile, then the train to play it on.`;
    }
    if (a && a.kind === 'move') {
      if (S.selectedKey) return soleTile(a.moves) === S.selectedKey
        ? `${S.selectedKey} is the only tile you can play. Tap a glowing train.`
        : `Playing ${S.selectedKey}: tap a glowing train.`;
      const lead = S.drawnKey ? `You drew ${S.drawnKey}. ` : '';
      if (g.openDouble) {
        return `${lead}A double is open. Play a tile showing ${g.openDouble.value} on the glowing train.`;
      }
      return `${lead}Your turn. Pick a tile that glows.`;
    }
    if (a && a.kind === 'draw') {
      if (g.openDouble && g.players[0].hand.length === 0) return 'Your last tile was a double, and a double cannot go out. Draw a tile to try to cover it.';
      return 'Nothing fits. Draw a tile from the boneyard.';
    }
    if (g && g.opening && g.opening.human.finished) {
      const waiting = tableIds(S).filter(id => id !== 'human' && g.opening[id] && !g.opening[id].finished).map(id => nameOf(S, id));
      if (waiting.length) return `Your train is set. Waiting for ${waiting.join(' and ')} to finish building.`;
    }
    return S.banner || '';
  }

  function viewBar(S) {
    const g = S.game, on = S.online;
    const round = g
      ? `<div class="round"><span>Round ${S.roundIndex + 1} of ${on ? on.rounds : S.opts.rounds}</span><span>Engine double-${g.engine}</span>${on ? `<span>Online game ${on.display}</span>` : `<span>Computer: ${LEVEL_LABEL[S.opts.level]}</span>`}</div>`
      : '';
    return `<header class="bar">
      <div class="brand"><h1>Mexican Train</h1><p class="sub">${on ? 'Double-12 online' : 'Double-12 against the computer'}</p></div>
      ${round}
      <div class="totals" role="group" aria-label="Scores, lowest wins">
        ${tableIds(S).map(id => `<div class="tot"><b>${S.totals[id] || 0}</b><span>${nameOf(S, id)}</span></div>`).join('\n        ')}
        <p class="hint">Lowest score wins</p>
      </div>
      <nav class="tools">
        <button class="btn" data-action="toggleSound" aria-pressed="${S.opts.sound ? 'false' : 'true'}" data-focus-id="tools-sound">${S.opts.sound ? 'Mute' : 'Unmute'}</button>
        <button class="btn" data-action="toggleStyle" data-focus-id="tools-style">${S.opts.style === 'numbers' ? 'Show pips' : 'Show numbers'}</button>
        <button class="btn" data-action="openRules" data-focus-id="tools-rules">Rules</button>
        ${on ? '<button class="btn" data-action="askLeave" data-focus-id="tools-new">Leave game</button>' : '<button class="btn" data-action="newGame" data-focus-id="tools-new">New game</button>'}
      </nav>
    </header>`;
  }

  function viewOpp(S) {
    const g = S.game;
    const a = S.awaiting;
    const ready = drawOnly(S) && hintsOn(S);               // flashes only when hints are on
    const clickable = ready || (!hintsOn(S) && !!a && (a.kind === 'move' || a.kind === 'build' || a.kind === 'draw'));   // with hints off you may try to draw on your turn
    const on = S.online;
    const c = on ? S.comment : (S.opts.chat ? S.comment : null);
    const ids = tableIds(S).slice(1);                       // the opponents: one, or two when a computer is the third player
    const rows = ids.map((id, i) => {
      const n = g.players.find(p => p.id === id).hand.length;
      const info = on && S.opps ? S.opps.find(o => o.id === id) : null;
      const who = on
        ? (info && info.computer
          ? `<span class="tag tag-${info.level}" title="${LEVEL_LABEL[info.level]} computer player">${LEVEL_LABEL[info.level]}</span>`
          : `<span class="net-dot ${on.oppConnected !== false ? 'up' : 'down'}" title="${on.oppConnected !== false ? 'connected' : 'disconnected'}"></span>`)
        : `<span class="tag tag-${S.opts.level}" title="${LEVEL_LABEL[S.opts.level]} computer player">${LEVEL_LABEL[S.opts.level]}</span>`;
      const toggle = i > 0 ? '' : (on
        ? `<button class="btn chat-toggle" data-action="toggleSay" aria-expanded="${S.sayOpen ? 'true' : 'false'}" data-focus-id="say">Say something</button>`
        : `<button class="btn chat-toggle" data-action="toggleChat" aria-pressed="${S.opts.chat ? 'true' : 'false'}" data-focus-id="chat">Comments: ${S.opts.chat ? 'on' : 'off'}</button>`);
      return `<div class="cpu-hand${i > 0 ? ' second' : ''}" data-player="${id}">
        <span class="who">${nameOf(S, id)}</span>
        ${who}
        <span class="backs" aria-hidden="true">${'<i class="back"></i>'.repeat(n)}</span>
        <span class="count">${n} ${n === 1 ? 'tile' : 'tiles'}</span>
        ${toggle}
      </div>`;
    }).join('\n      ');
    const panel = on && S.sayOpen
      ? `<div class="say-panel" role="group" aria-label="Quick phrases">${ONLINE_PHRASES.map((ph, i) => `<button class="btn say" data-action="sendChat" data-key="${i}">${esc(ph)}</button>`).join('')}</div>` : '';
    const mine = on && S.mySay ? `<div class="you-said">You said: ${esc(S.mySay.text)}</div>` : '';
    const speaker = c && c.from ? c.from : cpuName(S);
    return `<section class="opp${ids.length > 1 ? ' three' : ''}" aria-label="Opponent and boneyard">
      ${rows}
      <button class="boneyard${ready ? ' ready' : ''}" data-action="draw" data-focus-id="draw"${ready ? ` style="animation-delay:-${S.flashPhase || 0}ms"` : clickable ? '' : ' disabled'}
        aria-label="${ready ? 'Draw a tile. ' : ''}${g.boneyard.length} tiles in the boneyard">
        <span class="stack" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="yard-text"><span class="count"><b>${g.boneyard.length}</b> in the boneyard</span>${ready ? '<span class="cta">Draw a tile</span>' : ''}</span>
      </button>
      <div class="bubble-slot" aria-live="polite">${!c ? '' : c.lang
        ? `<div class="bubble native"><b>${esc(speaker)}</b><span lang="${c.lang}"${NATIVE_DIR[c.lang] ? ' dir="rtl"' : ''}>${esc(c.text)}</span><small class="trans" lang="en">${esc(c.trans)}</small></div>`
        : `<div class="bubble"><b>${esc(speaker)}</b><span>${esc(c.text)}</span></div>`}${mine}${panel}</div>
    </section>`;
  }

  /* Hints: which tiles can be played and where is shown. They are off if the player turned "Allow hints" off on the
   * main screen, or has switched "Show hints" off on their hand (the button only exists when hints are allowed). */
  const hintsOn = S => S.opts.allowHints !== false && S.showHints !== false;
  function targetsOf(S) {
    const a = S.awaiting;
    const set = {};
    if (hintsOn(S) && a && a.kind === 'move' && S.selectedKey) {
      a.moves.forEach(m => { if (key(m.tile) === S.selectedKey) set[m.trainId] = m; });
    }
    return set;
  }

  // Trains the hovered (or keyboard-focused) hand tile could be played on.
  function previewOf(S) {
    const a = S.awaiting, set = {};
    if (hintsOn(S) && S.hoverKey && a && (a.kind === 'move' || a.kind === 'build')) {
      a.moves.forEach(m => { if (key(m.tile) === S.hoverKey) set[m.trainId] = true; });
    }
    return set;
  }

  // The one tile the player can play, if exactly one tile is playable (it may still fit on several trains).
  function soleTile(moves) {
    const keys = new Set((moves || []).map(m => key(m.tile)));
    return keys.size === 1 ? [...keys][0] : null;
  }

  // True when the only thing the player can do is draw a tile.
  function drawOnly(S) {
    const a = S.awaiting;
    return !!(a && (a.kind === 'draw' || (a.kind === 'build' && a.canDraw)));
  }

  /* The marker on an open train: a small, shiny, 3D-looking toy locomotive in the colour of its player, sitting at the far
   * left of their train. (The physical game has a coloured train piece for each player to show their train is open.)
   * It is one colour: every shade in it (the lighter top, the darker underside, the wheels, the window) comes from the
   * player's colour, and the only other thing is the white shine. The body comes down to the middle of the wheels, so
   * only the lower half of each shows. Pure SVG; the colours come from CSS (.p-human, .p-cpu, .p-cpu2) and every gradient
   * has an id of its own. */
  function toyTrainSVG(id) {
    const g = n => `${n}-${id}`;
    const edge = 'stroke="var(--tc-lo)" stroke-width="0.9" stroke-linejoin="round"';
    return `<span class="toy-train p-${id}" aria-hidden="true"><svg viewBox="0 0 62 40" focusable="false">
      <defs>
        <linearGradient id="${g('tb')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--tc-hi)"/><stop offset="0.4" style="stop-color:var(--tc)"/><stop offset="1" style="stop-color:var(--tc-lo)"/></linearGradient>
        <linearGradient id="${g('tr')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--tc-hi)"/><stop offset="1" style="stop-color:var(--tc)"/></linearGradient>
        <linearGradient id="${g('tw')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--tc)"/><stop offset="1" style="stop-color:var(--tc-dk)"/></linearGradient>
        <linearGradient id="${g('tg')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--tc-lo)"/><stop offset="1" style="stop-color:var(--tc-dk)"/></linearGradient>
      </defs>
      <circle cx="14" cy="33" r="6.3" fill="url(#${g('tw')})" stroke="var(--tc-dk)" stroke-width="0.9"/>
      <circle cx="44" cy="33" r="6.3" fill="url(#${g('tw')})" stroke="var(--tc-dk)" stroke-width="0.9"/>
      <path d="M56 24 L61 33 L56 33 Z" fill="url(#${g('tb')})" ${edge}/>
      <path d="M42 14 v-7 l-2 -3 h10 l-2 3 v7 z" fill="url(#${g('tb')})" ${edge}/>
      <rect x="22" y="13" width="35" height="20" rx="5" fill="url(#${g('tb')})" ${edge}/>
      <path d="M30 13.3 a4.5 4.5 0 0 1 9 0 z" fill="url(#${g('tb')})" ${edge}/>
      <rect x="3" y="9" width="21" height="24" rx="2.5" fill="url(#${g('tb')})" ${edge}/>
      <rect x="1" y="4.5" width="25" height="5" rx="2.2" fill="url(#${g('tr')})" ${edge}/>
      <rect x="8" y="12" width="11" height="8" rx="1.8" fill="url(#${g('tg')})" stroke="var(--tc-dk)" stroke-width="0.8"/>
      <path d="M26 17.5 Q42 14.6 54 17.5" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M5 11.5 H21" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M9.5 14.2 H13.5" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M4.5 30.2 H55.5" fill="none" stroke="var(--tc-dk)" stroke-opacity="0.3" stroke-width="2.4" stroke-linecap="round"/>
    </svg></span>`;
  }

  function viewTrack(S, id) {
    const g = S.game, tr = g.trains[id];
    const targets = targetsOf(S);
    const target = !!targets[id];
    const must = !!(g.openDouble && g.openDouble.trainId === id);      // always shown, with or without hints: it is a rule of the game, not a hint
    const style = S.opts.style;
    // While the computer is still building, its tiles stay face down.
    const hidden = id !== 'human' && id !== 'mexican' && !!g.opening && !!g.opening[id] && !g.opening[id].finished;

    let note = '';
    if (id === 'mexican') note = '<span class="shared">Open to both players</span>';
    else if (hidden) note = '<span class="shared">Building, tiles face down</span>';
    else if (tr.marker) {
      note = `<span class="lamp"><span>${id === 'human' ? `Open: ${tableIds(S).slice(1).map(x => nameOf(S, x)).join(' and ')} can play here` : 'Open: you can play here'}</span></span>`;
    }
    const need = tr.end;
    const needs = hidden
      ? '<span class="needs">Needs <b class="num unknown">?</b></span>'
      : `<span class="needs">Needs <b class="num" style="--c:${PIP_COLORS[need]}">${need}</b></span>`;
    const label = `<div class="track-label">
        <div class="track-name">${trainName(S, id)}</div>
        <div class="track-info">${note}${needs}</div>
        ${must ? '<div class="cover">Cover the double here</div>' : ''}
      </div>`;

    const tiles = tr.tiles.map((t, i) => {
      const pop = S.lastPlay && S.lastPlay.trainId === id && S.lastPlay.index === i;
      if (hidden) return tileBackSVG(t[0] === t[1] ? 'v' : 'h', pop ? 'pop' : '', i);   // even face down, a double stands across the train
      const cls = [pop ? 'pop' : '', S.revealed === id ? 'reveal' : ''].join(' ').trim();
      return tileSVG(t[0], t[1], { style, cls, idx: i });
    }).join('');
    const engineTile = tileSVG(g.engine, g.engine, { style, cls: 'engine' });
    const ghost = target
      ? `<button class="ghost" data-action="playOn" data-train="${id}" data-focus-id="ghost-${id}"
           aria-label="Play ${S.selectedKey} on ${trainName(S, id).toLowerCase()}">
           ${tileSVG(targets[id].placed[0], targets[id].placed[1], { style })}<span>Play here</span></button>`
      : '';

    const preview = !target && !!previewOf(S)[id];
    const drop = S.dropTrain === id;
    const toy = id !== 'mexican' && !hidden && !!tr.marker;           // an open train wears its player's toy train
    return `<div class="track${target ? ' target' : ''}${must ? ' must' : ''}${preview ? ' preview' : ''}${drop ? ' drop' : ''}${toy ? ' has-toy' : ''}" data-train="${id}">
      ${label}
      <div class="rail">${toy ? toyTrainSVG(id) : ''}<div class="scroller" data-train="${id}"><div class="track-tiles">${engineTile}${tiles}${ghost}</div></div></div>
    </div>`;
  }

  function viewStatus(S) {
    const a = S.awaiting, g = S.game;
    let controls = '';
    if (a && a.kind === 'build') {
      const mine = g.trains.human.tiles;
      const lastT = mine[mine.length - 1];
      const n = a.buildCount;
      controls = '<div class="build">' +
        (a.canBuild && hintsOn(S) ? `<button class="btn primary" data-action="autoBuild" data-focus-id="autobuild">Build my longest train (${n} ${n === 1 ? 'tile' : 'tiles'})</button>` : '') +
        (a.canUndo && lastT ? `<button class="btn" data-action="undoTile" data-focus-id="undo">Take back ${fmt(lastT)}</button>` : '') +
        (a.canDone ? '<button class="btn" data-action="endBuild" data-focus-id="endbuild">Done</button>' : '') +
        '</div>';
    }
    return `<section class="status" role="status" aria-live="polite"><p class="msg">${bannerText(S)}</p>${controls}</section>`;
  }

  // The hand in the order it is shown: the player's own arrangement if they have made one,
  // otherwise heaviest first. A tile that was played and then taken back returns to its old spot;
  // tiles drawn since the arrangement go at the end.
  function orderedHand(S) {
    const hand = S.game.players[0].hand;
    const byKey = {};
    hand.forEach(t => { byKey[key(t)] = t; });
    const dflt = hand.slice().sort((x, y) => (y[0] + y[1]) - (x[0] + x[1]) || y[0] - x[0]);
    if (!S.handOrder) return dflt;
    const seen = {}, out = [];
    S.handOrder.forEach(k => { if (byKey[k] && !seen[k]) { out.push(byKey[k]); seen[k] = true; } });
    dflt.forEach(t => { if (!seen[key(t)]) out.push(t); });
    return out;
  }

  function viewTray(S) {
    const g = S.game, me = g.players[0];
    const a = S.awaiting;
    const hints = hintsOn(S);
    const moving = !!(a && (a.kind === 'move' || a.kind === 'build')) || drawOnly(S);
    const playable = {};
    if (moving && a.moves) a.moves.forEach(m => { playable[key(m.tile)] = true; });
    const style = S.opts.style;
    const tiles = orderedHand(S).map(t => {
      const k = key(t);
      const mode = moving ? (hints ? (playable[k] ? 'playable' : 'dim') : 'plain') : 'idle';   // with hints off nothing says which tiles can be played
      const sel = S.selectedKey === k;
      const label = `${t[0]} and ${t[1]}${mode === 'playable' ? ', playable' : ''}${sel ? ', selected' : ''}`;
      // not "disabled": every tile can be dragged, and a click on one that cannot be played does nothing
      return `<button class="tile-btn ${mode}${sel ? ' selected' : ''}${S.freshKey === k ? ' fresh' : ''}${S.dragKey === k ? ' drag-src' : ''}"
        data-action="selectTile" data-key="${k}" data-focus-id="t${k}" aria-pressed="${sel}"
        aria-label="${label}"${mode === 'playable' || mode === 'plain' ? '' : ' aria-disabled="true"'}>${tileSVG(t[0], t[1], { orient: 'h', style })}</button>`;
    }).join('');
    const tip = S.roundIndex === 0 && !S.handOrder ? '<span class="tip">Drag a tile onto a train to play it, or around your hand to rearrange</span>' : '';
    // only when hints are allowed (main screen): a switch to show or hide them during the game
    const hintBtn = S.opts.allowHints !== false ? `<button class="btn hints-toggle" data-action="toggleShowHints" aria-pressed="${hints ? 'true' : 'false'}" data-focus-id="hints">Show hints: ${hints ? 'on' : 'off'}</button>` : '';
    // Two or more rows: half the tiles (plus one spare spot) per row, at most 10 across. On a narrow
    // screen the grid simply wraps into more rows.
    const n = me.hand.length;
    const cols = Math.min(10, Math.max(1, Math.ceil((n + 1) / 2)));
    const canDraw = drawOnly(S) && hints;                  // (with hints off, the boneyard is the only way to draw: no flashing spot)
    const myTurn = !!a && (a.kind === 'move' || a.kind === 'build' || a.kind === 'draw');
    const spot = canDraw
      ? `<button class="slot-draw" data-action="draw" data-focus-id="slotdraw" aria-label="Draw a tile from the boneyard"
          style="animation-delay:-${S.flashPhase || 0}ms"><span>Draw</span></button>`
      : !hints                                              // hints off: the Draw button is always there, but never flashes (and is not clickable when it is not your turn)
        ? `<button class="slot-draw calm" data-action="draw" data-focus-id="slotdraw" aria-label="Draw a tile from the boneyard"${myTurn ? '' : ' disabled'}><span>Draw</span></button>`
        : '<div class="slot-empty" aria-hidden="true"></div>';
    return `<section class="tray" aria-label="Your hand">
      <div class="tray-head"><span>Your hand</span>${tip}${hintBtn}<span class="count">${n} ${n === 1 ? 'tile' : 'tiles'}</span></div>
      <div class="hand${canDraw ? ' can-draw' : ''}"${canDraw ? ' data-action="draw"' : ''}><div class="hand-grid" style="--cols:${cols}">${tiles}${spot}</div></div>
    </section>`;
  }

  function viewLog(S) {
    const lines = S.log.slice(-5);
    return `<section class="log" aria-label="Recent moves"><ol>${lines.map((l, i) =>
      `<li${i === lines.length - 1 ? ' class="latest"' : ''}>${l}</li>`).join('')}</ol></section>`;
  }

  const RULES_HTML = `
    <ul class="rules">
      <li>Each round starts from the engine, a double: 12-12 in round 1, then 11-11, and so on down to 0-0. Your train, your opponent's train and the shared Mexican train all begin from that number.</li>
      <li>At the start of every round, all players build their own trains at the same time. Tap tiles to add them one after another, or press Build my longest train. You can take back your last tile as often as you like until you press Done. Your opponent's tiles stay face down until they finish.</li>
      <li>To play a tile, tap it and then tap the train, or drag it onto the train you want (the trains it can go on light up). You can also arrange your hand any way you like by dragging tiles around it, or with Shift plus the left and right arrow keys. Sort hand puts it back in order.</li>
      <li>If nothing in your hand fits the engine, draw one tile. If it still does not fit, you pass and a toy train marker goes on your train.</li>
      <li>Then you take turns. Play one tile that matches the number a train needs: your own train, the Mexican train, or your opponent's train when it has a toy train marker on it.</li>
      <li>Nothing fits? Draw one tile. If it fits, play it. If not, you pass and a marker goes on your train, which lets your opponent play there until you next play on it yourself.</li>
      <li>After you play a double, you must play another tile onto it straight away. If you can't, the next player has to cover it before anything else is played.</li>
      <li>Play your last tile to win the round and score 0, but not with a double: a double has to be covered. If your last tile is a double, you draw a tile and cover it to go out, or pass if it does not fit. In the opening, a double cannot be your last tile down.</li>
      <li>Otherwise you score the pips left in your hand (the 0-0 tile counts 50). A blocked round scores both players their pips. The lowest total wins.</li>
    </ul>`;

  function optionList(values, current, labeler) {
    return values.map(v => `<option value="${v}"${String(v) === String(current) ? ' selected' : ''}>${labeler(v)}</option>`).join('');
  }

  const LEVEL_TEXT = { easy: 'Easy: plays casually', normal: 'Medium: plays sensibly', hard: 'Hard: plans ahead' };

  function viewSetup(S) {
    const o = S.opts;
    return `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">Mexican Train</h2>
      <p>Empty your hand before your opponent empties theirs. Play on your train, the shared Mexican train, or any train with a marker on it.</p>
      <div class="field"><label for="opt-rounds">Game length</label>
        <select id="opt-rounds">${optionList([1, 4, 13], o.rounds, v => v === 1 ? 'One round' : v === 4 ? 'Short game, 4 rounds' : 'Full game, 13 rounds')}</select></div>
      <div class="field"><label for="opt-hand">Tiles dealt to each player</label>
        <select id="opt-hand">${optionList([8, 12, 15], o.hand, v => v === 15 ? '15 (standard)' : String(v))}</select></div>
      <div class="field"><label for="opt-level">Computer skill</label>
        <select id="opt-level">${optionList(LEVELS, o.level, v => LEVEL_TEXT[v])}</select>
        <p class="field-note">Easy often plays at random and builds short trains. Hard plans ahead and keeps long chains available so it can go out sooner. Each level has its own computer players, who talk differently too.</p></div>
      <div class="field"><label for="opt-hints">Hints</label>
        <button type="button" id="opt-hints" class="btn toggle" data-action="toggleAllowHints" aria-pressed="${o.allowHints !== false ? 'true' : 'false'}">Allow hints: ${o.allowHints !== false ? 'on' : 'off'}</button>
        <p class="field-note">On: the tiles you can play and the trains they can go on are highlighted, and your hand gets a Show hints button to switch that off or on. Off: nothing is highlighted and nothing is played for you: you pick the tile and then the train.</p></div>
      <div class="field"><label for="opt-style">Tile faces</label>
        <select id="opt-style">${optionList(['pips', 'numbers'], o.style, v => v === 'pips' ? 'Colored pips' : 'Large numbers')}</select></div>
      <details class="how"><summary>How to play</summary>${RULES_HTML}</details>
      <div class="actions">
        ${S.matchActive ? '<button class="btn" data-action="closeOverlay">Keep playing</button>' : ''}
        <button class="btn" data-action="openHost">Host online game</button>
        <button class="btn" data-action="openJoin">Join online game</button>
        <button class="btn primary" data-action="startGame" data-primary="1">Start game</button>
      </div></div></div>`;
  }

  function viewRules() {
    return `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">How to play</h2>${RULES_HTML}
      <div class="actions"><button class="btn primary" data-action="closeOverlay" data-primary="1">Back to the game</button></div>
    </div></div>`;
  }

  function miniTiles(hand, style) {
    if (!hand.length) return '<span class="none">No tiles left</span>';
    return hand.slice().sort((x, y) => (y[0] + y[1]) - (x[0] + x[1]))
      .map(t => tileSVG(t[0], t[1], { orient: 'h', style })).join('');
  }

  function viewRoundEnd(S) {
    const m = S.modal;
    const cpu = cpuName(S);
    let title;
    if (m.blocked) title = m.winnerId ? (m.winnerId === 'human' ? 'Blocked, and you hold fewer pips' : `Blocked, and ${nameOf(S, m.winnerId)} holds fewer pips`) : 'Blocked, and it is a tie';
    else if (m.tie) title = tableIds(S).length === 2 ? 'You both played every tile' : 'More than one of you played every tile';
    else title = m.winnerId === 'human' ? 'You went out first' : `${nameOf(S, m.winnerId)} went out first`;
    const rows = m.rows.map(r => `<div class="row">
        <div class="who">${r.name}</div>
        <div class="mini">${miniTiles(r.hand, S.opts.style)}</div>
        <div class="pts"><b>+${r.pips}</b><span>this round</span></div>
        <div class="pts"><b>${m.totals[r.id]}</b><span>total</span></div>
      </div>`).join('');
    return `<div class="overlay"><div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">${title}</h2>
      <div class="rows">${rows}</div>
      <div class="actions"><button class="btn primary" data-action="dialogOk" data-primary="1">${m.last ? 'See final score' : 'Start round ' + (S.roundIndex + 2)}</button></div>
    </div></div>`;
  }

  function viewFinal(S) {
    const m = S.modal;
    const ids = tableIds(S), score = id => m.totals[id] || 0;
    const low = Math.min(...ids.map(score)), lows = ids.filter(id => score(id) === low);
    const title = lows.length === 1 ? (lows[0] === 'human' ? 'You win' : `${nameOf(S, lows[0])} wins`)
      : lows.length === ids.length ? 'A tie' : `A tie between ${lows.map(id => nameOf(S, id)).join(' and ')}`;
    const rivals = ids.slice(1).map(id => nameOf(S, id)).join(' and ');
    return `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">${title}</h2>
      <div class="final">${ids.map(id => `<div class="tot"><b>${score(id)}</b><span>${nameOf(S, id)}</span></div>`).join('')}</div>
      <p>Lowest score wins. ${S.online ? `You played ${rivals} online.` : `You played ${cpuName(S)} on ${LEVEL_LABEL[S.opts.level]}.`}</p>
      <div class="actions">${S.online ? '<button class="btn primary" data-action="onlineBack" data-primary="1">Back to the menu</button>' : '<button class="btn primary" data-action="newGame" data-primary="1">Play again</button>'}</div>
    </div></div>`;
  }

  /* Which dialog is showing, if any: the player's own choice first, then what the online game needs. */
  function overlayId(S) {
    if (S.overlay) return S.overlay;
    const o = S.online;
    if (o) {
      if (o.ended) return 'online-ended';
      if (o.phase === 'resuming' || o.conn !== 'open' || (o.phase === 'playing' && o.oppConnected === false)) return 'online-wait';
      if (o.phase === 'lobby') return 'online-lobby';
    }
    return (S.modal && S.modal.type) || null;
  }
  function viewOverlay(S) {
    switch (overlayId(S)) {
      case 'rules': return viewRules();
      case 'setup': return viewSetup(S);
      case 'online-host': return viewOnlineForm(S, true);
      case 'online-join': return viewOnlineForm(S, false);
      case 'online-leave': return viewOnlineLeave(S);
      case 'online-ended': return viewOnlineEnded(S);
      case 'online-wait': return viewOnlineWait(S);
      case 'online-lobby': return viewOnlineLobby(S);
      case 'roundEnd': return viewRoundEnd(S);
      case 'final': return viewFinal(S);
      default: return '';
    }
  }

  /* ---- online dialogs ---- */
  const clock = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  function viewOnlineForm(S, host) {
    const f = S.form || {}, busy = !!(S.online && S.online.phase === 'connecting');
    const err = S.onlineError ? `<p class="form-error" role="alert">${esc(S.onlineError)}</p>` : '';
    return `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">${host ? 'Host an online game' : 'Join an online game'}</h2>
      ${host
        ? '<p>This page must be opened from the game server on this computer (<code>node server.js</code>). You will get a join code to give to the other player, together with this computer\'s network address.</p>'
        : '<p>Ask the host for the server address and the join code.</p>'}
      ${host ? (() => {
        const hi = S.hostInfo || { state: 'none', address: '', addresses: [] };
        const note = hi.state === 'ready'
          ? 'This computer\'s address on your network. The server sets it, so it cannot be changed here; the other player uses it to join.' + (hi.addresses.length > 1 ? ' (This computer has other addresses too: ' + hi.addresses.slice(1).map(esc).join(', ') + '.)' : '')
          : hi.state === 'loading' ? 'Looking up this computer\'s address...'
            : 'The game server did not give its address. Open this page from the server: start it with node server.js and open the address it prints.';
        return `<div class="field"><label for="net-server">Server address</label>
        <input id="net-server" type="text" value="${esc(hi.address)}" readonly aria-readonly="true" class="fixed" placeholder="${hi.state === 'loading' ? 'Looking up...' : 'Not available'}" autocomplete="off" spellcheck="false">
        <p class="field-note">${note}</p></div>`;
      })() : `<div class="field"><label for="net-server">Server address</label>
        <input id="net-server" type="text" value="${esc(f.server || '')}" placeholder="192.168.1.23:8080" autocomplete="off" spellcheck="false" autocapitalize="off"></div>`}
      ${host ? '' : `<div class="field"><label for="net-code">Join code</label>
        <input id="net-code" type="text" value="${esc(f.code || '')}" placeholder="ABC-DEF" autocomplete="off" spellcheck="false" autocapitalize="characters" maxlength="12"></div>`}
      <div class="field"><label for="net-name">Your name</label>
        <input id="net-name" type="text" value="${esc(f.name || '')}" placeholder="${host ? 'Host' : 'Guest'}" autocomplete="nickname" maxlength="20"></div>
      ${host ? `<div class="field"><label for="net-rounds">Game length</label>
        <select id="net-rounds">${optionList([1, 4, 13], Number(f.rounds) || 4, v => v === 1 ? 'One round' : v === 4 ? 'Short game, 4 rounds' : 'Full game, 13 rounds')}</select></div>
      <div class="field"><label for="net-hand">Tiles dealt to each player</label>
        <select id="net-hand">${optionList([8, 12, 15], Number(f.hand) || 15, v => v === 15 ? '15 (standard)' : String(v))}</select></div>
      <div class="field"><label for="net-computer">Computer player</label>
        <select id="net-computer">${optionList(['none', 'easy', 'normal', 'hard'], f.computer || 'none', v => v === 'none' ? 'None: two players' : 'Add a ' + LEVEL_LABEL[v] + ' computer as a third player')}</select>
        <p class="field-note">With a computer player, all three are at the table from the start.</p></div>` : ''}
      ${err}
      <div class="actions">
        <button class="btn" data-action="closeOverlay">Back</button>
        <button class="btn primary" data-action="${host ? 'hostGame' : 'joinGame'}" data-primary="1"${busy || (host && !(S.hostInfo && S.hostInfo.state === 'ready')) ? ' disabled' : ''}>${busy ? 'Connecting...' : host ? 'Create game' : 'Join game'}</button>
      </div></div></div>`;
  }
  function viewOnlineLobby(S) {
    const o = S.online, host = o.host;
    const players = (o.settings.computer ? [0, 1, 2] : [0, 1]).map(i => {
      const p = o.players[i];
      return `<li class="${p ? (p.connected ? 'up' : 'down') : 'empty'}"><i class="net-dot ${p ? (p.connected ? 'up' : 'down') : ''}"></i><span>${p ? p.name + (i === o.seat ? ' (you)' : '') + (i === 0 ? ', host' : '') + (p.computer ? `, computer, ${LEVEL_LABEL[p.level || o.settings.computer]}` : '') : 'Waiting for a player...'}</span></li>`;
    }).join('');
    const qi = Math.min(Math.max(0, S.qrIndex || 0), Math.max(0, o.addresses.length - 1));
    const link = o.addresses.length ? `http://${o.addresses[qi]}/?join=${o.code}` : '';
    const qr = host && link
      ? `<div class="qrbox">${qrSvg(link, 'QR code: scan it to join the game')}
          <div class="qrtext"><p>Scan with a phone on the same network to join.</p><p class="field-note"><code>${esc(link)}</code></p>
          <button class="btn" data-action="copyLink" data-key="${esc(link)}">${S.copied === 'link' ? 'Copied' : 'Copy link'}</button></div></div>` : '';
    const addrs = host
      ? (o.addresses.length
        ? `${qr}<p>Or the other player opens one of these addresses in a browser, or enters it under <b>Join online game</b>:</p><ul class="addrs">${o.addresses.map((a, i) => `<li><code>${esc(a)}</code>${o.addresses.length > 1 ? ` <button class="btn small" data-action="selectQr" data-key="${i}" aria-pressed="${i === qi ? 'true' : 'false'}">${i === qi ? 'QR shown' : 'Show QR'}</button>` : ''}</li>`).join('')}</ul>`
        : '<p>This server is only reachable from this computer (it was started with <code>--local-only</code>, or has no network address).</p>')
      : '';
    const settings = host
      ? `<div class="field-row"><div class="field"><label for="net-rounds">Game length</label>
          <select id="net-rounds">${optionList([1, 4, 13], o.settings.rounds, v => v === 1 ? 'One round' : v === 4 ? '4 rounds' : '13 rounds')}</select></div>
        <div class="field"><label for="net-hand">Tiles each</label>
          <select id="net-hand">${optionList([8, 12, 15], o.settings.hand, v => String(v))}</select></div>
        <div class="field"><label for="net-computer">Computer player</label>
          <select id="net-computer">${optionList(['none', 'easy', 'normal', 'hard'], o.settings.computer || 'none', v => v === 'none' ? 'None' : LEVEL_LABEL[v])}</select></div></div>`
      : `<p>${o.settings.rounds === 1 ? 'One round' : o.settings.rounds + ' rounds'}, ${o.settings.hand} tiles each${o.settings.computer ? `, with a ${LEVEL_LABEL[o.settings.computer]} computer player` : ''}. ${o.players[0] ? o.players[0].name : 'The host'} will start the game.</p>`;
    return `<div class="overlay"><div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">Online game</h2>
      <p>Join code</p>
      <div class="codebox"><span class="code-big" aria-label="Join code ${esc(o.display)}">${o.display}</span>
        <button class="btn" data-action="copyCode" data-key="${esc(o.display)}">${S.copied === 'code' ? 'Copied' : 'Copy code'}</button></div>
      ${addrs}
      <ul class="players">${players}</ul>
      ${settings}
      <div class="actions">
        <button class="btn" data-action="confirmLeave">Leave</button>
        ${host ? `<button class="btn primary" data-action="startOnline" data-primary="1"${o.canStart ? '' : ' disabled'}>${o.canStart ? 'Start game' : 'Waiting for a player...'}</button>` : ''}
      </div></div></div>`;
  }
  function viewOnlineWait(S) {
    const o = S.online, opp = o.oppName || S.cpuName || 'The other player';
    let title, body;
    if (o.phase === 'resuming' && o.conn === 'open') { title = 'Rejoining your game'; body = '<p>Asking the server for your game...</p>'; }
    else if (o.conn !== 'open') {
      title = 'Connection lost';
      body = `<p>${o.conn === 'connecting' ? 'Connecting' : 'Trying to reconnect'} to <code>${esc(o.server)}</code>... The server keeps your seat for a few minutes, so you can carry on where you left off.</p>`;
    } else {
      title = 'Game paused';
      const left = o.graceUntil ? clock(o.graceUntil - (S.nowMs || 0)) : '';
      body = `<p>${opp} lost the connection. Waiting for them to come back${left ? ': <b>' + left + '</b> left' : ''}.</p><p class="field-note">If they do not return in time, the game ends.</p>`;
    }
    return `<div class="overlay"><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">${title}</h2>${body}
      <div class="actions"><button class="btn" data-action="confirmLeave" data-primary="1">Leave game</button></div>
    </div></div>`;
  }
  function viewOnlineEnded(S) {
    const e = S.online.ended;
    const title = e.reason === 'timeout' ? 'Game over' : e.reason === 'left' ? 'The game was left' : e.reason === 'error' ? 'The game had a problem' : e.reason === 'replaced' ? 'Opened somewhere else' : 'Game closed';
    return `<div class="overlay"><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">${title}</h2><p>${e.message}</p>
      <div class="actions"><button class="btn primary" data-action="onlineBack" data-primary="1">Back to the menu</button></div>
    </div></div>`;
  }
  function viewOnlineLeave(S) {
    return `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">Leave the game?</h2>
      <p>This ends the game for both players. (To take a break instead, just close the page: you have a few minutes to come back.)</p>
      <div class="actions"><button class="btn" data-action="closeOverlay" data-primary="1">Keep playing</button><button class="btn primary" data-action="confirmLeave">Leave game</button></div>
    </div></div>`;
  }

/* Mexican Train (double-12) - play against the computer in the browser.
 * Sections: ENGINE (rules + computer player), TILE ART (SVG), VIEWS (HTML strings),
 * APP (state + turn flow), BOOT. Everything is plain JavaScript, no libraries. */

  function viewApp(S) {
    const g = S.game;
    const body = g
      ? viewOpp(S) +
        `<section class="tracks" aria-label="Trains">${tableIds(S).slice(1).map(id => viewTrack(S, id)).join('')}${viewTrack(S, 'mexican')}${viewTrack(S, 'human')}</section>` +
        viewStatus(S) + viewTray(S) + viewLog(S)
      : '<section class="empty"><p>Choose your game settings to deal the first round.</p></section>';
    return `<div class="shell">${viewBar(S)}<main class="table">${body}</main>${viewOverlay(S)}</div>`;
  }

  /* ================================== QR CODE ================================== */
  /* A small QR code generator with no dependencies: byte mode, versions 1 to 10, error correction
   * level M. Enough for a link such as http://192.168.1.23:8080/?join=K7QF2M (up to 213 bytes).
   * qrEncode(text) -> a square array of rows of booleans (true = dark), or null if it is too long.
   * qrSvg(text) -> an <svg> string with the 4-module quiet zone the scanners need. */

  // [error-correction codewords per block, blocks in group 1, data codewords each, blocks in group 2, data codewords each]
  const QR_BLOCKS_M = {
    1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0],
    6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44],
  };
  const QR_ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  const QR_TOTAL_CODEWORDS = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };

  // arithmetic in GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1
  const GF_EXP = new Array(512), GF_LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  }());
  const gfMul = (a, b) => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0);

  /* The Reed-Solomon error-correction codewords for a block of data codewords. */
  function rsEncode(data, ecLen) {
    let gen = [1];                                         // the product of (x + alpha^i), highest power first
    for (let i = 0; i < ecLen; i++) {
      const next = new Array(gen.length + 1).fill(0);
      for (let k = 0; k <= gen.length; k++) next[k] = (k < gen.length ? gen[k] : 0) ^ (k > 0 ? gfMul(gen[k - 1], GF_EXP[i]) : 0);
      gen = next;
    }
    const rem = new Array(ecLen).fill(0);
    for (const d of data) {
      const factor = d ^ rem.shift();
      rem.push(0);
      for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
    }
    return rem;
  }

  function utf8Bytes(text) {
    const out = [];
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  const qrDataCapacity = v => { const b = QR_BLOCKS_M[v]; return b[1] * b[2] + b[3] * b[4]; };

  /* The data and error-correction codewords for some bytes, interleaved as the standard requires. */
  function qrCodewords(bytes, version) {
    const [ecLen, n1, d1, n2, d2] = QR_BLOCKS_M[version];
    const capacity = qrDataCapacity(version);
    const bits = [];
    const put = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    put(4, 4);                                             // byte mode
    put(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    put(0, Math.min(4, capacity * 8 - bits.length));       // terminator
    while (bits.length % 8) bits.push(0);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xEC; cw.length < capacity; pad ^= 0xEC ^ 0x11) cw.push(pad);
    const blocks = []; let at = 0;
    for (let b = 0; b < n1 + n2; b++) { const len = b < n1 ? d1 : d2; blocks.push(cw.slice(at, at + len)); at += len; }
    const ecs = blocks.map(blk => rsEncode(blk, ecLen));
    const out = [];
    for (let i = 0; i < Math.max(d1, d2); i++) blocks.forEach(blk => { if (i < blk.length) out.push(blk[i]); });
    for (let i = 0; i < ecLen; i++) ecs.forEach(e => out.push(e[i]));
    return out;
  }

  function qrEncode(text) {
    const bytes = utf8Bytes(text);
    let version = 0;
    for (let v = 1; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + 8 * bytes.length <= 8 * qrDataCapacity(v)) { version = v; break; }
    if (!version) return null;
    const codewords = qrCodewords(bytes, version);
    const size = 17 + 4 * version;
    const dark = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, v) => { dark[y][x] = v; fixed[y][x] = true; };
    const bit = (n, i) => ((n >>> i) & 1) !== 0;

    // the fixed patterns: timing, three finders with their separators, alignment patterns
    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    }
    const pos = QR_ALIGN[version], last = pos.length - 1;
    pos.forEach((cy, i) => pos.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    // the 15 format bits (error-correction level M and the mask), written twice
    const drawFormat = mask => {
      const data = mask;                                   // level M's two bits are 00
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
      setFn(8, 7, bit(bits, 6)); setFn(8, 8, bit(bits, 7)); setFn(7, 8, bit(bits, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
      setFn(8, size - 8, true);                            // the one module that is always dark
    };
    drawFormat(0);
    if (version >= 7) {                                    // the 18 version bits, written twice
      let rem = version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const bits = (version << 12) | rem;
      for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3); setFn(a, b, bit(bits, i)); setFn(b, a, bit(bits, i)); }
    }
    // the data, in pairs of columns zigzagging up and down from the bottom right
    let k = 0;
    const total = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
          if (!fixed[y][x] && k < total) { dark[y][x] = bit(codewords[k >>> 3], 7 - (k & 7)); k++; }
        }
      }
    }
    const MASKS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
    ];
    const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[m](x, y)) dark[y][x] = !dark[y][x]; };
    // the standard's four penalty rules, so the scanner-friendliest mask is the one used
    const penalty = () => {
      let score = 0;
      const lines = [];
      for (let a = 0; a < size; a++) { lines.push(dark[a].slice()); lines.push(dark.map(row => row[a])); }
      for (const line of lines) {
        let run = 1;
        for (let i = 1; i <= size; i++) {
          if (i < size && line[i] === line[i - 1]) run++;
          else { if (run >= 5) score += 3 + (run - 5); run = 1; }
        }
        for (let i = 0; i + 11 <= size; i++) {
          const w = line.slice(i, i + 11).map(Number).join('');
          if (w === '10111010000' || w === '00001011101') score += 40;
        }
      }
      for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) {
        const c = dark[y][x];
        if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3;
      }
      let count = 0; dark.forEach(row => row.forEach(c => { if (c) count++; }));
      score += 10 * Math.floor(Math.abs(count * 100 / (size * size) - 50) / 5);
      return score;
    };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const sc = penalty();
      if (sc < bestScore) { bestScore = sc; best = m; }
      applyMask(m);                                        // (undo)
    }
    applyMask(best); drawFormat(best);
    return dark;
  }

  function qrSvg(text, label) {
    const m = qrEncode(text);
    if (!m) return '';
    const quiet = 4, n = m.length + quiet * 2;
    let d = '';
    m.forEach((row, y) => row.forEach((c, x) => { if (c) d += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
    return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" role="img" aria-label="${esc(label || 'QR code')}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  /* ============================== ONLINE HELPERS ============================== */
  /* Shared by the page and by the game server (which loads this file for the rules), so each
   * rule about names, phrases and addresses is written once. */

  // Quick phrases instead of free chat: nothing a player types can reach the other screen.
  const ONLINE_PHRASES = [
    'Nice play!', 'Well played!', 'Good game!', 'Ouch!', 'Oops!', 'Hurry up!', 'Take your time.', 'Thanks!',
    'Ha, I needed that.', 'Nothing fits...', 'Your move!', 'One tile left!',
  ];

  /* Names end up in text on the other player's screen, so they are cleaned both where they are
   * made (the server) and where they arrive (the page): letters, digits, spaces and . _ - ' only,
   * at most 20 characters. */
  function cleanPlayerName(raw, fallback) {
    const s = String(raw === undefined || raw === null ? '' : raw).replace(/[^\p{L}\p{N} ._'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
    return s || fallback || 'Player';
  }

  /* "192.168.1.23:8080", "http://myhost:3000/", "ws://10.0.0.5" -> "192.168.1.23:8080" ... or null.
   * The port defaults to 8080, the server's default. */
  function parseServerAddress(raw) {
    let t = String(raw === undefined || raw === null ? '' : raw).trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
    if (!t || t.length > 255) return null;
    let host = t, port = '8080';
    const m = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(?::(\d{1,5}))?$/.exec(t);
    if (!m) return null;
    host = m[1];
    if (m[3] !== undefined) { if (Number(m[3]) < 1 || Number(m[3]) > 65535) return null; port = String(Number(m[3])); }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && host.split('.').some(n => Number(n) > 255)) return null;
    return host + ':' + port;
  }
  const ONLINE_SESSION_KEY = 'mt-online';

  /* ================================= APP ================================== */

  const DEFAULT_OPTS = { rounds: 4, hand: 15, style: 'pips', sound: true, level: 'normal', chat: true, allowHints: true };
  const FLASH_MS = 1100;   // length of the draw-button flash; must match the CSS animation

  // Names the computer player can pick from (none ends in "s", so "Name's train" reads well).
  // Each computer player has a level, and the same name always plays at the same level. The name
  // is drawn from the pool for the level you chose, and the level is shown next to it.
  const CPU_PLAYERS = {
    easy: ['Bea', 'Pablo', 'Mei', 'Rosa', 'Lucia', 'Felix', 'Greta', 'Noor', 'Anil', 'Tamsin', 'Wen', 'Imani', 'Sunita', 'Joon', 'Yara', 'Kofi'],
    normal: ['Marta', 'Ravi', 'Keiko', 'Omar', 'Lena', 'Mateo', 'Priya', 'Jonah', 'Aisha', 'Hiro', 'Sofia', 'Nadia', 'Freya', 'Bruno', 'Callum', 'Zainab'],
    hard: ['Ingrid', 'Dmitri', 'Arjun', 'Kwame', 'Tariq', 'Elsa', 'Diego', 'Stefan', 'Chiara', 'Amara', 'Leon', 'Odile', 'Rafael', 'Kenji', 'Selam', 'Paloma'],
  };
  const CPU_NAMES = [].concat(CPU_PLAYERS.easy, CPU_PLAYERS.normal, CPU_PLAYERS.hard);
  const levelOfName = name => LEVELS.find(l => CPU_PLAYERS[l].includes(name)) || null;

  function pickCpuName(level, rng, used) {
    const names = CPU_PLAYERS[LEVELS.includes(level) ? level : 'normal'];
    const free = names.filter(n => !used.has(n.toLowerCase()));
    const pool = free.length ? free : names;
    return pool[Math.floor(rng() * pool.length)];
  }

  // How long a person takes: [min, max] milliseconds, picked at random each time.
  const PACE = {
    place: [500, 4000],        // every tile the computer places, in the opening or on a normal turn
    finish: [1100, 2300],      // a last look before saying "done" in the opening
    draw: [900, 1700],
    settle: [450, 900],        // a beat after playing, so its tile can land before the turn passes
  };

  // A wait of this kind, for a random number r in [0, 1): uniform between its minimum and maximum.
  const paceFor = (kind, r) => PACE[kind][0] + r * (PACE[kind][1] - PACE[kind][0]);

  function createApp(env) {
    const root = env.root;
    const rng = env.rng || Math.random;
    const paceRng = env.paceRng || Math.random;
    const storage = env.storage || { get() { return null; }, set() {} };
    const reduced = !!env.reducedMotion;
    const sound = env.sound || { unlock() {}, clack() {} };
    const chatRng = env.chatRng || Math.random;       // kept apart from the game's random numbers on purpose
    const timer = env.timer || {
      set(fn, ms) { const id = setTimeout(fn, ms); if (id && id.unref) id.unref(); return id; },
      clear(id) { clearTimeout(id); },
    };
    const nativeChance = env.nativeChance !== undefined ? env.nativeChance : CHAT.nativeChance;
    const foodChance = env.foodChance !== undefined ? env.foodChance : CHAT.foodChance;
    const fx = env.fx && !env.reducedMotion ? env.fx : null;   // flying tiles; skipped when the player prefers reduced motion
    const defaultServer = env.defaultServer || '';              // where this page was served from, if from a game server
    const fetchImpl = env.fetch || null;                        // used to ask the game server for its own network address
    let infoToken = 0;
    const now = env.now || (() => Date.now());
    const doSleep = env.sleep || (ms => new Promise(res => setTimeout(res, ms)));
    const ABORT = { aborted: true };
    let token = 0;

    const humanPace = kind => paceFor(kind, paceRng());

    function sanitize(o) {
      const rounds = [1, 4, 13].includes(Number(o.rounds)) ? Number(o.rounds) : DEFAULT_OPTS.rounds;
      const hand = [8, 12, 15].includes(Number(o.hand)) ? Number(o.hand) : DEFAULT_OPTS.hand;
      const style = o.style === 'numbers' ? 'numbers' : 'pips';
      const snd = !(o.sound === false || o.sound === 'false');
      const level = LEVELS.includes(o.level) ? o.level : DEFAULT_OPTS.level;
      const chat = !(o.chat === false || o.chat === 'false');
      const allowHints = !(o.allowHints === false || o.allowHints === 'false');
      return { rounds, hand, style, sound: snd, level, chat, allowHints };
    }
    function loadOpts() {
      try { return sanitize(Object.assign({}, DEFAULT_OPTS, JSON.parse(storage.get('mt-opts') || '{}'))); }
      catch (e) { return Object.assign({}, DEFAULT_OPTS); }
    }
    function saveOpts() { try { storage.set('mt-opts', JSON.stringify(S.opts)); } catch (e) { /* ignore */ } }

    const S = {
      opts: null, overlay: 'setup', modal: null, matchActive: false,
      game: null, roundIndex: 0, startIndex: 0, totals: { human: 0, cpu: 0 }, cpuName: null,
      awaiting: null, selectedKey: null, drawnKey: null, freshKey: null, lastPlay: null, revealed: null, plan: null,
      hoverKey: null, flashPhase: 0, handOrder: null, dragKey: null,
      dropTrain: null, dropFrom: null, comment: null, pendingRating: null, lastCommentAt: -Infinity, lastLine: null,
      banner: '', log: [], lastCounts: {}, lastDialog: null,
      opps: null, cpu2Name: null, hostInfo: null, showHints: true, notice: '',
      online: null, onlineError: '', form: null, sayOpen: false, mySay: null, copied: false, qrIndex: 0,
    };
    S.opts = loadOpts();

    /* ---------- rendering ---------- */
    // While a settings/rules dialog is open, the match keeps running behind it. Re-drawing
    // the page then would wipe whatever the player is choosing, so background updates
    // are skipped; the actions that open/close dialogs pass force=true and redraw.
    function render(force) {
      if (!force && S.overlay && S.lastDialog === S.overlay) return;
      S.flashPhase = Math.floor(now() % FLASH_MS);   // re-drawing restarts CSS animations; this keeps the flash in step
      S.nowMs = now();                               // for the countdown shown while waiting for a dropped player
      const saved = {};
      if (root.querySelectorAll) root.querySelectorAll('.scroller').forEach(el => { saved[el.dataset.train] = el.scrollLeft; });
      const doc = root.ownerDocument;
      const active = doc && doc.activeElement && doc.activeElement.dataset ? doc.activeElement.dataset.focusId : null;

      root.innerHTML = viewApp(S);

      if (root.querySelectorAll) {
        const counts = {};
        if (S.game) Object.keys(S.game.trains).forEach(id => { counts[id] = S.game.trains[id].tiles.length; });
        root.querySelectorAll('.scroller').forEach(el => {
          const id = el.dataset.train;
          // no scroll bars: a train always follows its newest domino
          if (counts[id] !== S.lastCounts[id]) el.scrollLeft = el.scrollWidth;
          else if (saved[id] !== undefined) el.scrollLeft = saved[id];
          if (el.classList && el.classList.toggle) el.classList.toggle('more-left', el.scrollLeft > 4);   // soft fade: earlier tiles are out of sight
        });
        S.lastCounts = counts;

        const dialogId = overlayId(S);
        if (dialogId && dialogId !== S.lastDialog) {
          const primary = root.querySelector('[data-primary]');
          if (primary && primary.focus) primary.focus();
        } else if (active && root.querySelector) {
          const el = root.querySelector('[data-focus-id="' + active + '"]');
          if (el && el.focus && !el.disabled) el.focus();
        }
        S.lastDialog = dialogId;
      }
      if (fx) fx.reapply();
      S.lastPlay = null;
      S.revealed = null;
    }

    function clack() { if (S.opts.sound) sound.clack(); }
    function turnCue() { if (S.opts.sound && sound.turn) sound.turn(); }
    function say(text) { S.banner = text; S.log.push(text); }
    function setBanner(text) { S.banner = text; }

    /* ---------- the computer's comments ---------- */
    let commentTimers = [], commentId = 0, slowTimer = null, slowCount = 0, slowDish = null;
    function later(fn, ms) {
      const id = timer.set(() => { commentTimers = commentTimers.filter(x => x !== id); fn(); }, ms);
      commentTimers.push(id);
      return id;
    }
    function cancelSlow() { if (slowTimer !== null) { timer.clear(slowTimer); slowTimer = null; } }
    function clearChatTimers() {
      commentTimers.forEach(id => timer.clear(id));
      commentTimers = [];
      cancelSlow();
    }
    // put a speech bubble up (after `delay` ms) and take it down again a few seconds later
    function showComment(kind, vars, delay) {
      let text, extra = {};
      const lang = nativeLangOf(S.cpuName), pool = lang && NATIVE_LINES[lang][kind.indexOf('slow') === 0 ? 'slow' : kind];
      const tier = kind.indexOf('slow') === 0 ? Number(kind.slice(4)) : 0;
      const hungry = tier && FOOD[S.cpuName] && foodChance > 0 && chatRng() < foodChance
        ? foodComment(S.cpuName, tier, chatRng, nativeChance, S.lastLine, slowDish) : null;
      if (hungry) {                                                                       // hungry, and off for something from home
        text = hungry.text;
        slowDish = hungry.dish;
        if (hungry.lang) extra = { lang: hungry.lang, trans: hungry.trans };
      } else if (pool && pool.length && nativeChance > 0 && chatRng() < nativeChance) {        // in its own language, with a translation
        const choices = pool.length > 1 ? pool.filter(p => p[0] !== S.lastLine) : pool;
        const pair = choices[Math.min(choices.length - 1, Math.floor(chatRng() * choices.length))];
        text = pair[0]; extra = { lang, trans: pair[1] };
      } else text = fillLine(pickLine(kind, chatRng, S.lastLine, S.opts.level), vars);
      S.lastLine = text;
      const put = () => {
        if (!S.opts.chat || !S.game) return;
        const id = ++commentId;
        S.comment = Object.assign({ id, kind, text }, extra);
        render();
        later(() => { if (S.comment && S.comment.id === id) { S.comment = null; render(); } }, CHAT.showMs);
      };
      if (delay > 0) later(put, delay); else put();
    }
    // Decide, by chance and a cooldown, whether the computer says something about this.
    function maybeComment(kind, vars) {
      if (!S.opts.chat || !S.game) return false;
      const p = CHAT.chance[kind];
      if (p === undefined || chatRng() >= p) return false;
      if (!CHAT.bypass[kind] && now() - S.lastCommentAt < CHAT.cooldownMs) return false;
      S.lastCommentAt = now();
      showComment(kind, vars, CHAT.reactDelayMs[0] + chatRng() * (CHAT.reactDelayMs[1] - CHAT.reactDelayMs[0]));
      return true;
    }
    // You are taking too long: a jab after 25 s, then another every 20-26 s, each one ruder.
    function armSlow() {
      cancelSlow();
      if (!S.opts.chat) return;
      slowCount = 0; slowDish = null;                    // a new wait: a new dish, if it gets hungry
      const fire = () => {
        slowTimer = null;
        if (!S.awaiting || !S.opts.chat) return;
        if (!S.overlay && !S.modal) {                     // not while a dialog is covering the game
          slowCount++;
          S.lastCommentAt = now();
          showComment('slow' + Math.min(3, slowCount), {}, 0);
        }
        slowTimer = timer.set(fire, CHAT.slowEveryMs[0] + chatRng() * (CHAT.slowEveryMs[1] - CHAT.slowEveryMs[0]));
      };
      slowTimer = timer.set(fire, CHAT.slowAfterMs);
    }

    /* ---------- waiting for the player or the clock ---------- */
    async function pause(ms) {
      const t = token;
      await doSleep(reduced ? ms * 0.5 : ms);
      if (t !== token) throw ABORT;
    }
    function awaitUser(kind, extra) {
      return new Promise((resolve, reject) => {
        S.notice = '';
        if (!hintsOn(S)) S.selectedKey = null;               // with hints off, a tile picked up for one prompt does not stay armed for the next
        S.awaiting = Object.assign({
          kind, reject,
          resolve: v => { S.awaiting = null; cancelSlow(); resolve(v); },
        }, extra || {});
        if (kind === 'move' || kind === 'draw' || kind === 'build') armSlow();
        render();
      });
    }
    function abortMatch() {
      token++;
      const a = S.awaiting;
      S.awaiting = null;
      S.modal = null;
      S.matchActive = false;
      S.plan = null;
      S.handOrder = null; S.dragKey = null; S.dropTrain = null; S.dropFrom = null;
      S.comment = null; S.pendingRating = null;
      clearChatTimers();
      if (fx) fx.cancelAll();
      if (a) a.reject(ABORT);
    }

    /* ---------- hooks the rules engine calls ---------- */
    const ui = {
      // --- normal turns ---
      async onNeedDraw(game, player) {
        if (player.id === 'human') await awaitUser('draw');
        else {
          setBanner(player.hand.length === 0
            ? `${cpuName(S)} played a double as their last tile. It cannot go out, so they draw to cover it.`
            : `${cpuName(S)} has nothing to play and draws.`);
          render(); await pause(humanPace('draw'));
        }
      },
      async onDraw(game, player, tile) {
        if (player.id === 'human') { say(`You drew ${fmt(tile)}.`); S.drawnKey = key(tile); }
        else say(`${cpuName(S)} draws a tile.`);
        if (player.id === 'human') maybeComment('draw');
        const spec = { playerId: player.id, key: key(tile) };
        const tok = fx ? fx.captureDraw(spec) : null;
        render();
        if (fx) fx.landDraw(tok, spec);
        await pause(650);
      },
      async onPass(game, player) {
        if (player.id === 'human') {
          maybeComment('pass');
          S.drawnKey = null;
          say(player.hand.length === 0
            ? 'The boneyard is empty, so you cannot draw to cover your double. You pass. Once it is covered, you have gone out.'
            : game.boneyard.length === 0
              ? 'The boneyard is empty and nothing fits. You pass and a marker goes on your train.'
              : 'That tile does not fit. You pass and a marker goes on your train.');
        } else {
          say(player.hand.length === 0
            ? `${cpuName(S)} cannot draw to cover their double and passes. Once it is covered, they have gone out.`
            : `${cpuName(S)} cannot play and passes. A marker goes on their train: you can play there.`);
        }
        render();
        await pause(1200);
      },
      async onPlay(game, player, move, info) {
        const you = player.id === 'human';
        S.lastPlay = { trainId: move.trainId, index: game.trains[move.trainId].tiles.length - 1 };
        S.selectedKey = null; S.drawnKey = null; S.freshKey = null; S.hoverKey = null;
        clack();
        say(`${you ? 'You played' : `${cpuName(S)} played`} ${fmt(move.tile)} on ${trainRef(S, move.trainId, player.id)}.`);
        if (info.lastTileDouble) S.log.push(you
          ? 'That was your last tile, but a double cannot go out. Draw a tile to try to cover it.'
          : `That was ${cpuName(S)}'s last tile, but a double cannot go out. They must draw a tile to try to cover it.`);
        else if (info.doubleOpened) S.log.push(you ? 'A double: you must play another tile onto it.' : `A double: ${cpuName(S)} must play another tile onto it.`);
        if (info.doubleSatisfied) S.log.push('The double is covered.');
        if (player.hand.length === 1) S.log.push(you ? 'You have one tile left.' : `${cpuName(S)} has one tile left.`);
        if (you && S.pendingRating) {                   // the computer has an opinion of that move
          const kind = commentKindFor(S.pendingRating);
          S.pendingRating = null;
          if (kind) maybeComment(kind);
        }
        const spec = { playerId: player.id, trainId: move.trainId, index: S.lastPlay.index, key: key(move.tile), placed: move.placed, hidden: false };
        let tok = fx ? fx.capture(spec) : null;        // note where the tile is now, before the redraw
        if (fx && S.dropFrom && S.dropFrom.key === spec.key) tok = { from: S.dropFrom.rect };   // dragged: from where it was let go
        S.dropFrom = null;
        render();
        if (fx) fx.land(tok, spec);                     // ...then fly it from there to its place
        // A double that can be covered straight away needs no pause, for you or the computer: the cover comes at once.
        const coverNow = info.doubleOpened && !info.lastTileDouble && legalMoves(game, player).length > 0;
        if (!coverNow) await pause(you ? 380 : humanPace('settle'));
      },

      // --- the opening: everybody builds at once ---
      async onBuildPlay(game, player, move) {
        S.lastPlay = { trainId: player.id, index: game.trains[player.id].tiles.length - 1 };
        S.selectedKey = null; S.drawnKey = null; S.freshKey = null; S.hoverKey = null;
        clack();   // the computer's face-down tiles click too; that gives nothing away
        const spec = { playerId: player.id, trainId: player.id, index: S.lastPlay.index, key: key(move.tile), placed: move.placed, hidden: player.id === 'cpu' };
        let tok = fx ? fx.capture(spec) : null;
        if (fx && S.dropFrom && S.dropFrom.key === spec.key) tok = { from: S.dropFrom.rect };
        S.dropFrom = null;
        render();   // no log line: the computer's tiles are face down, yours are on the board
        if (fx) fx.land(tok, spec, { fast: !!S.plan });
      },
      async onBuildUndo(game, player, tile) {
        if (player.id === 'human') S.freshKey = key(tile);
        S.selectedKey = null; S.drawnKey = null;
        render();
      },
      async onBuildDraw(game, player, tile) {
        if (player.id === 'human') { say(`You drew ${fmt(tile)}.`); S.drawnKey = key(tile); S.freshKey = key(tile); }
        else S.log.push(`${cpuName(S)} draws a tile.`);
        if (player.id === 'human') maybeComment('draw');
        const spec = { playerId: player.id, key: key(tile) };
        const tok = fx ? fx.captureDraw(spec) : null;
        render();
        if (fx) fx.landDraw(tok, spec);
        await pause(560);
      },
      async onBuildPass(game, player) {
        if (player.id === 'human') {
          maybeComment('pass');
          S.drawnKey = null; S.freshKey = null;
          say(game.boneyard.length === 0 && !game.opening.human.drew
            ? 'The boneyard is empty and nothing fits the engine. You pass and a marker goes on your train.'
            : 'Nothing fits the engine. You pass and a marker goes on your train.');
        } else {
          S.revealed = 'cpu';
          S.log.push(`${cpuName(S)} cannot start a train and passes. A marker goes on their train: you can play there.`);
        }
        render();
        await pause(700);
      },
      async onBuildDone(game, player, count) {
        const you = player.id === 'human';
        if (you) { S.plan = null; }
        else S.revealed = 'cpu';
        S.selectedKey = null; S.drawnKey = null; S.freshKey = null;
        S.log.push(`${you ? 'You' : cpuName(S)} finished a train of ${count} ${count === 1 ? 'tile' : 'tiles'}.`);
        if (you) {                                       // was that the longest train you could have built?
          const best = longestFullChain(game, player).length;
          if (count === 0 && best > 0) maybeComment('openNone');
          else if (count < best) maybeComment('openShort', { built: count, best });
          else if (count >= 3) maybeComment('openBest');
        }
        render();
        await pause(300);
      },
      async onOpeningDone() {
        const first = S.startIndex === 0 ? 'You play' : `${cpuName(S)} plays`;
        say(`All trains are built. ${first} first.`);
        render();
        await pause(1000);
      },
    };

    /* ---------- the two players ---------- */
    async function humanAct(game, player, info) {
      // "Build my longest train" in progress: carry out its take-backs and plays one by one
      while (S.plan && S.plan.length) {
        const step = S.plan.shift();
        if (step.type === 'undo') {
          if (info.canUndo) { await pause(110); return { type: 'undo' }; }
        } else {
          const mv = info.moves.find(m => key(m.tile) === step.key);
          if (mv) { await pause(150); return { type: 'play', move: mv }; }
        }
        S.plan = null;   // something unexpected: hand control back to the player
      }
      S.plan = null;
      const chain = longestFullChain(game, player);
      return awaitUser('build', {
        moves: info.moves, placed: info.placed, canUndo: info.canUndo, canDraw: info.canDraw, canDone: info.canDone, lastDouble: !!info.lastDouble,
        canBuild: chain.length > (info.canDone ? info.placed : -1), buildCount: chain.length,
      });
    }

    async function cpuAct(game, player, info) {
      const action = cpuBuildAction(game, player, info, S.opts.level);
      const kind = action.type === 'done' ? 'finish' : action.type === 'draw' ? 'draw' : 'place';
      await pause(humanPace(kind));
      return action;
    }

    /* ---------- online play ---------- */
    // The game itself runs on a server (server.js). In an online game this page only shows what the
    // server sends and sends back what the player does: every tap that would play a tile becomes an
    // "intent" over a WebSocket, the server checks it against the rules, and answers with a new view
    // of the game for this player. The views are already from this player's side ("you" is always the
    // bottom player), so the screens draw them as they are.
    const WebSocketImpl = env.WebSocket || null;
    let ws = null, wsId = 0, lastSeq = -1, intentId = 0, tries = 0, pingN = 0;
    let reconnectTimer = null, pingTimer = null, pongTimer = null, tickTimer = null, pendingTimer = null;

    const clean = t => esc(String(t === undefined || t === null ? '' : t));   // all text from the network is escaped before it reaches the page
    function loadSession() { try { const v = storage.get(ONLINE_SESSION_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    function saveSession() {
      const o = S.online;
      if (o && o.token) { try { storage.set(ONLINE_SESSION_KEY, JSON.stringify({ server: o.server, code: o.code, token: o.token, seat: o.seat, name: o.name })); } catch (e) { /* ignore */ } }
    }
    function clearSession() { try { storage.set(ONLINE_SESSION_KEY, ''); } catch (e) { /* ignore */ } }

    function stopTimers() {
      [reconnectTimer, pingTimer, pongTimer, tickTimer, pendingTimer].forEach(t => { if (t !== null) timer.clear(t); });
      reconnectTimer = pingTimer = pongTimer = tickTimer = pendingTimer = null;
    }
    function netClose() {
      wsId++;                                         // anything the old socket says from now on is ignored
      stopTimers();
      const w = ws; ws = null;
      if (w) { try { w.close(); } catch (e) { /* ignore */ } }
    }
    function netSend(obj) {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }
    function onlineFailed(message) { S.online = null; S.onlineError = message; render(true); }

    function netConnect(first) {
      const o = S.online;
      if (!o) return;
      netClose();
      const id = wsId;
      if (!WebSocketImpl) return onlineFailed('This browser cannot open a network connection.');
      let sock;
      try { sock = new WebSocketImpl('ws://' + o.server + '/ws'); }
      catch (e) { return onlineFailed(`Could not open a connection to ${o.server}.`); }
      ws = sock; o.conn = 'connecting';
      sock.onopen = () => {
        if (id !== wsId) return;
        o.conn = 'open'; tries = 0;
        if (first) netSend(first); else if (o.token) netSend({ t: 'resume', code: o.code, token: o.token });
        schedulePing();
        render(true);
      };
      sock.onmessage = e => {
        if (id !== wsId) return;
        let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m && typeof m === 'object') { try { netMessage(m); } catch (err) { if (typeof console !== 'undefined') console.error(err); } }   // nothing the network says may break the page
      };
      sock.onclose = e => {
        if (id !== wsId) return;
        if (e && e.code === 4000 && S.online === o) {   // the server gave our seat to a newer window: do not fight over it
          netClose();
          o.ended = { reason: 'replaced', message: 'This game was opened in another window or tab, so it is closed here.' };
          render(true);
          return;
        }
        netClosed();
      };
      sock.onerror = () => {                          // a refused connection may report only an error, with no close after it
        if (id !== wsId) return;
        wsId++; ws = null;
        try { sock.close(); } catch (e) { /* ignore */ }
        netClosed();
      };
      render(true);
    }
    // the connection ended without us asking
    function netClosed() {
      const o = S.online;
      timer.clear(pingTimer); timer.clear(pongTimer); pingTimer = pongTimer = null;
      ws = null;
      if (!o || o.ended || o.leaving) return;
      if (o.conn === 'reconnecting' && reconnectTimer !== null) return;     // already waiting to try again
      if (o.phase === 'connecting') {                 // never got in: say why
        S.online = null;
        S.onlineError = `Could not reach ${o.server}. Check the address, that the server is running (node server.js), and that your firewall allows it.`;
        render(true);
        return;
      }
      o.conn = 'reconnecting';                        // in a game: keep trying, the server holds the seat for a while
      reconnectTimer = timer.set(() => { reconnectTimer = null; if (S.online === o && !o.ended) netConnect(null); }, Math.min(5000, 1000 * ++tries));
      startTick();
      render(true);
    }
    function schedulePing() {
      timer.clear(pingTimer);
      pingTimer = timer.set(() => {
        pingTimer = null;
        if (!ws) return;
        netSend({ t: 'ping', n: ++pingN });
        pongTimer = timer.set(() => {                 // no answer: the connection is dead even though nothing said so
          pongTimer = null;
          wsId++; const w = ws; ws = null;
          if (w) { try { w.close(); } catch (e) { /* ignore */ } }
          netClosed();
        }, 10000);
        schedulePing();
      }, 15000);
    }
    // a once-a-second redraw while a countdown is on screen
    function startTick() {
      if (tickTimer !== null) return;
      tickTimer = timer.set(function tickFn() {
        tickTimer = null;
        const o = S.online;
        if (!o || o.ended || (o.conn === 'open' && o.oppConnected !== false)) return;
        render();
        tickTimer = timer.set(tickFn, 1000);
      }, 1000);
    }

    // The page draws whatever view it is given, so a view is checked before it is used: a broken or
    // hostile server can make a game look wrong, but cannot make the page throw.
    function validOnlineView(v) {
      if (!v || typeof v !== 'object') return false;
      const tileOk = x => Array.isArray(x) && x.length === 2 && x.every(n => typeof n === 'number');
      const aw = v.awaiting;
      if (aw !== null && aw !== undefined && !(typeof aw === 'object' && typeof aw.kind === 'string' && (aw.moves === undefined || (Array.isArray(aw.moves) && aw.moves.every(mv => mv && tileOk(mv.tile) && tileOk(mv.placed) && typeof mv.trainId === 'string'))))) return false;
      const md = v.modal;
      if (md !== null && md !== undefined) {
        if (typeof md !== 'object' || typeof md.type !== 'string' || !md.totals) return false;
        if (md.type === 'roundEnd' && !(Array.isArray(md.rows) && md.rows.every(r => r && Array.isArray(r.hand) && r.hand.every(tileOk)))) return false;
      }
      const g = v.game;
      if (g === null || g === undefined) return true;
      const trainOk = t => t && Array.isArray(t.tiles) && t.tiles.every(tileOk);
      if (!Array.isArray(g.players) || (g.players.length !== 2 && g.players.length !== 3)) return false;
      const ids = PLAYER_IDS.slice(0, g.players.length);                       // human, cpu and (with a computer as the third player) cpu2
      return Number.isInteger(g.engine) && g.players.every((p, i) => p && p.id === ids[i] && Array.isArray(p.hand) && p.hand.every(tileOk))
        && Array.isArray(g.boneyard) && !!g.trains && ids.concat(['mexican']).every(id => trainOk(g.trains[id]))
        && (!g.opening || ids.every(id => g.opening[id])) && (!v.log || Array.isArray(v.log));
    }

    function netMessage(m) {
      const o = S.online;
      if (!o) return;
      switch (m.t) {
        case 'created':
        case 'joined':
        case 'resumed': {
          o.code = String(m.code || o.code); o.display = clean(m.display || ''); o.seat = m.seat === 1 ? 1 : 0; o.host = o.seat === 0;
          if (m.token) o.token = String(m.token);
          if (m.settings) o.settings = { rounds: Number(m.settings.rounds) || 4, hand: Number(m.settings.hand) || 15, computer: LEVELS.includes(m.settings.computer) ? m.settings.computer : null };
          if (Array.isArray(m.addresses)) o.addresses = m.addresses.map(String).slice(0, 8);
          o.phase = m.t === 'resumed' && m.state === 'playing' ? 'playing' : 'lobby';
          o.resuming = false; o.oppConnected = true; o.graceUntil = null;
          S.overlay = null; S.onlineError = '';
          saveSession();
          render(true);
          return;
        }
        case 'lobby': {
          o.players = (Array.isArray(m.players) ? m.players : []).slice(0, 3).map(p => (p && typeof p === 'object'
            ? { name: clean(p.name), connected: !!p.connected, computer: !!p.computer, level: LEVELS.includes(p.level) ? p.level : null } : null));
          while (o.players.length < 2) o.players.push(null);
          o.canStart = !!m.canStart;
          if (m.settings) o.settings = { rounds: Number(m.settings.rounds) || 4, hand: Number(m.settings.hand) || 15, computer: LEVELS.includes(m.settings.computer) ? m.settings.computer : null };
          if (Array.isArray(m.addresses)) o.addresses = m.addresses.map(String).slice(0, 8);
          if (m.state === 'playing') o.phase = 'playing';
          const other = o.players[1 - o.seat];
          o.oppName = other ? other.name : '';
          render();
          return;
        }
        case 'state': applyOnlineState(m); return;
        case 'presence':
          o.oppConnected = !!m.oppConnected; o.graceUntil = typeof m.graceUntil === 'number' ? m.graceUntil : null;
          if (!o.oppConnected) startTick();
          render();
          return;
        case 'chat': if (typeof m.text === 'string') showChat(m.text.slice(0, 60)); return;
        case 'ack':
          if (o.pending && o.pending.id === m.id) { if (m.ok) o.pending.ackSeq = Number(m.seq); else o.pending = null; }
          return;
        case 'pong': timer.clear(pongTimer); pongTimer = null; return;
        case 'ended':
          o.ended = { reason: String(m.reason || 'closed'), message: clean(m.message || 'The game is over.') };
          clearSession(); netClose(); render(true);
          return;
        case 'error':
          if (o.phase === 'connecting') { onlineFailed(String(m.message || 'Could not start the game.')); netClose(); return; }
          if (o.resuming && m.code === 'no_such_game') { clearSession(); netClose(); S.online = null; S.overlay = 'setup'; S.game = null; S.modal = null; S.awaiting = null; S.matchActive = false; render(true); return; }
          o.pending = null;
          S.banner = clean(m.message || 'That did not work.');
          render();
          return;
        default: return;
      }
    }

    // what the server sent about the game: tiles that moved, then the new state, then the flights
    function applyOnlineState(m) {
      const o = S.online;
      if (!o || typeof m.seq !== 'number' || m.seq < lastSeq || !validOnlineView(m.view)) return;
      lastSeq = m.seq;
      if (o.pending && o.pending.ackSeq !== undefined && o.pending.ackSeq !== null && m.seq > o.pending.ackSeq) { o.pending = null; timer.clear(pendingTimer); pendingTimer = null; }
      const v = m.view, evs = Array.isArray(m.events) ? m.events : [];
      const prevKind = S.awaiting ? S.awaiting.kind : null;

      // 1. where the tiles that are about to move are now, before the screen changes
      const flights = [];
      for (const ev of evs) {
        if (!ev || typeof ev !== 'object') continue;
        if (ev.e === 'play') {
          const spec = { playerId: ev.who === 'me' ? 'human' : ev.who === 'opp2' ? 'cpu2' : 'cpu', trainId: ev.train, index: ev.index, key: ev.tile ? key(ev.tile) : null, placed: ev.placed, hidden: !!ev.hidden };
          let tok = fx ? fx.capture(spec) : null;
          if (fx && ev.who === 'me' && S.dropFrom && S.dropFrom.key === spec.key) tok = { from: S.dropFrom.rect };   // dragged: from where it was let go
          if (ev.who === 'me') S.dropFrom = null;
          flights.push({ spec, tok, fast: evs.length > 1, draw: false });
        } else if (ev.e === 'draw') {
          const spec = { playerId: ev.who === 'me' ? 'human' : ev.who === 'opp2' ? 'cpu2' : 'cpu', key: ev.tile ? key(ev.tile) : null };
          flights.push({ spec, tok: fx ? fx.captureDraw(spec) : null, draw: true });
        }
      }
      // 2. what each event means for the screen
      for (const ev of evs) {
        if (!ev || typeof ev !== 'object') continue;
        if (ev.e === 'play') {
          clack();
          if (ev.who === 'me') { S.selectedKey = null; S.drawnKey = null; S.freshKey = null; S.hoverKey = null; }
          S.lastPlay = { trainId: ev.train, index: ev.index };
        } else if (ev.e === 'draw' && ev.who === 'me' && ev.tile) { S.drawnKey = key(ev.tile); S.freshKey = key(ev.tile); }
        else if (ev.e === 'pass' && ev.who === 'me') { S.drawnKey = null; S.freshKey = null; }
        else if (ev.e === 'reveal') S.revealed = ev.who === 'opp2' ? 'cpu2' : 'cpu';
      }
      // whose move came last, to tell a new turn from the rest of the same turn (covering your own double, playing a drawn tile)
      const g0 = v.game;
      const openingNow = !!(g0 && g0.opening && !g0.players.every(p => g0.opening[p.id].finished));
      if (!openingNow) for (const ev of evs) if (ev && (ev.e === 'play' || ev.e === 'draw' || ev.e === 'pass') && (ev.who === 'me' || ev.who === 'opp')) o.lastActor = ev.who;
      // 3. the new state
      if (o.round !== v.round) { S.handOrder = null; S.selectedKey = null; S.drawnKey = null; S.freshKey = null; o.round = v.round; o.lastActor = null; }
      o.rounds = Number(v.rounds) || o.rounds;
      o.phase = 'playing';
      S.game = v.game || null;
      // who the opponents are: one, or two when a computer is the third player (their names, and which one is the computer)
      const opps = (Array.isArray(v.opps) ? v.opps : [v.opp]).slice(0, 2).map((x, i) => ({
        id: i === 0 ? 'cpu' : 'cpu2', name: cleanPlayerName(x && x.name, 'Opponent'), computer: !!(x && x.computer), level: LEVELS.includes(x && x.level) ? x.level : 'normal',
      }));
      S.opps = opps;
      S.cpuName = opps[0].name;
      S.cpu2Name = opps[1] ? opps[1].name : null;
      const T = v.totals || {};
      S.totals = { human: Number(T.human) || 0, cpu: Number(T.cpu) || 0, cpu2: Number(T.cpu2) || 0 };
      S.roundIndex = Number(v.round) || 0;
      S.log = (v.log || []).map(clean);
      S.banner = clean(v.banner || '');
      S.modal = v.modal ? Object.assign({}, v.modal, v.modal.rows ? { rows: v.modal.rows.map(r => Object.assign({}, r, { name: clean(r.name) })) } : {}) : null;
      S.awaiting = v.awaiting ? makeOnlineAwaiting(v.awaiting) : null;
      S.notice = '';
      S.matchActive = !!v.game && v.over !== 'finished';
      const turnKind = k => k === 'move' || k === 'draw';
      if (S.awaiting && turnKind(S.awaiting.kind) && !turnKind(prevKind) && o.lastActor !== 'me') turnCue();     // your turn begins
      if (S.awaiting && S.awaiting.kind === 'move') {          // the same pre-selection rules as in a game against the computer
        const moves = S.awaiting.moves;
        const stillThere = S.selectedKey && moves.some(x => key(x.tile) === S.selectedKey);
        if (!hintsOn(S)) { if (prevKind !== 'move') S.selectedKey = null; }          // no hints: nothing is picked for you, and your own pick stays
        else if (prevKind !== 'move' || !stillThere) {
          const sole = soleTile(moves), dk = S.drawnKey;
          S.selectedKey = (sole && moves.length > 1) ? sole : ((dk && moves.filter(x => key(x.tile) === dk).length > 1) ? dk : null);
        }
      } else if (!S.awaiting || S.awaiting.kind !== 'build') S.selectedKey = null;
      if (S.overlay === 'setup' || S.overlay === 'online-host' || S.overlay === 'online-join') S.overlay = null;
      // 4. draw it, then fly the tiles from where they were to where they are now
      render();
      if (fx) for (const f of flights) { if (f.draw) fx.landDraw(f.tok, f.spec); else fx.land(f.tok, f.spec, { fast: f.fast }); }
    }

    // The prompt the server is waiting on, shaped like the ones the single-player game uses, so every
    // tap and drag works unchanged: answering it sends an intent instead of resuming the game loop.
    function makeOnlineAwaiting(av) {
      const kind = av.kind;
      return Object.assign({}, av, {
        reject() {},
        resolve: v => {
          if (kind === 'build') {
            if (v.type === 'play') onlineIntent({ a: 'play', tile: v.move.tile, train: v.move.trainId });
            else if (v.type === 'undo') onlineIntent({ a: 'undo' });
            else if (v.type === 'draw') onlineIntent({ a: 'draw' });
            else if (v.type === 'done') onlineIntent({ a: 'done' });
          } else if (kind === 'move') onlineIntent({ a: 'play', tile: v.tile, train: v.trainId });
          else if (kind === 'draw') onlineIntent({ a: 'draw' });
          else if (kind === 'modal') onlineIntent({ a: 'ok' });
        },
      });
    }
    // One intent at a time: until the server has answered, further taps are ignored (no double plays).
    function onlineIntent(a) {
      const o = S.online;
      if (!o || o.pending || o.conn !== 'open') return false;
      const id = ++intentId;
      o.pending = { id, ackSeq: null };
      timer.clear(pendingTimer);
      pendingTimer = timer.set(() => { pendingTimer = null; if (o.pending && o.pending.id === id) { o.pending = null; render(); } }, 5000);
      return netSend(Object.assign({ t: 'i', id }, a));
    }

    function showChat(text) {
      const id = ++commentId;
      const person = S.opps && S.opps.find(x => !x.computer);
      S.comment = { id, kind: 'chat', text: String(text), from: person ? person.name : null };
      render();
      later(() => { if (S.comment && S.comment.id === id) { S.comment = null; render(); } }, CHAT.showMs);
    }
    function sendChat(i) {
      const id = Number(i);
      if (!S.online || !Number.isInteger(id) || id < 0 || id >= ONLINE_PHRASES.length) return;
      if (!netSend({ t: 'chat', id })) return;
      const mid = ++commentId;
      S.mySay = { id: mid, text: ONLINE_PHRASES[id] }; S.sayOpen = false;
      later(() => { if (S.mySay && S.mySay.id === mid) { S.mySay = null; render(); } }, 4000);
      render();
    }

    function beginOnline(kind, a) {
      if (S.online) leaveOnline(true);
      abortMatch();
      const hosting = kind === 'create';
      const server = hosting ? (S.hostInfo && S.hostInfo.state === 'ready' ? parseServerAddress(S.hostInfo.address) : null) : parseServerAddress(a.server);
      S.form = { server: hosting && server ? server : String(a.server || ''), name: String(a.name || ''), code: String(a.code || ''), rounds: a.rounds, hand: a.hand, computer: a.computer };
      if (!server) { S.onlineError = hosting ? 'This computer\'s address is not known. Open this page from the game server: start it with node server.js and open the address it prints.' : 'Enter the server address, like 192.168.1.23:8080.'; render(true); return; }
      if (kind === 'join' && !String(a.code || '').trim()) { S.onlineError = 'Enter the join code you were given.'; render(true); return; }
      const name = cleanPlayerName(a.name, kind === 'create' ? 'Host' : 'Guest');
      try { storage.set('mt-name', name); storage.set('mt-server', server); } catch (e) { /* ignore */ }
      S.onlineError = '';
      lastSeq = -1; tries = 0; S.qrIndex = 0; S.showHints = true;
      S.online = { phase: 'connecting', kind, server, name, code: '', display: '', token: '', seat: kind === 'create' ? 0 : 1, host: kind === 'create', settings: { rounds: 4, hand: 15, computer: null }, players: [null, null], canStart: false, addresses: [], conn: 'connecting', oppConnected: true, graceUntil: null, ended: null, rounds: 4, pending: null, round: -1, oppName: '', lastActor: null };
      const first = kind === 'create' ? { t: 'create', name, rounds: Number(a.rounds), hand: Number(a.hand), computer: LEVELS.includes(a.computer) ? a.computer : null } : { t: 'join', code: String(a.code), name };
      netConnect(first);
    }
    function resumeOnline() {
      const sv = loadSession();
      if (!sv || !sv.server || !sv.code || !sv.token || !WebSocketImpl || S.online) return;
      abortMatch();
      lastSeq = -1; tries = 0;
      S.online = { phase: 'resuming', kind: 'resume', resuming: true, server: String(sv.server), name: String(sv.name || 'Player'), code: String(sv.code), display: '', token: String(sv.token), seat: sv.seat === 1 ? 1 : 0, host: sv.seat !== 1, settings: { rounds: 4, hand: 15 }, players: [null, null], canStart: false, addresses: [], conn: 'connecting', oppConnected: true, graceUntil: null, ended: null, rounds: 4, pending: null, round: -1, oppName: '', lastActor: null };
      S.overlay = null;
      netConnect(null);
    }
    // quiet: do not tell the server (the game is already over, or we never got in)
    function leaveOnline(quiet, keepSession) {
      const o = S.online;
      if (o) { o.leaving = true; if (!quiet && o.token) netSend({ t: 'leave' }); }
      netClose(); if (!keepSession) clearSession();      // (the window that took over still needs the saved game)
      S.online = null; S.game = null; S.modal = null; S.awaiting = null; S.matchActive = false;
      S.comment = null; S.mySay = null; S.sayOpen = false; S.log = []; S.banner = ''; S.totals = { human: 0, cpu: 0, cpu2: 0 }; S.opps = null; S.cpu2Name = null;
      S.selectedKey = null; S.drawnKey = null; S.freshKey = null; S.handOrder = null; S.dragKey = null; S.dropTrain = null; S.dropFrom = null;
      lastSeq = -1;
      clearChatTimers();
      if (fx) fx.cancelAll();
    }
    /* The host does not choose the address: the game server says what this computer's address on the network is
     * (a 192.168..., 10... or 172.16... address, not "localhost"), and the page shows it and uses it. */
    function loadHostInfo() {
      const mine = ++infoToken;
      S.hostInfo = { state: 'loading', address: '', addresses: [] };
      const fail = () => { if (mine === infoToken) { S.hostInfo = { state: 'none', address: '', addresses: [] }; if (S.overlay === 'online-host') render(true); } };
      if (!fetchImpl) { S.hostInfo.state = 'none'; return Promise.resolve(); }
      return Promise.resolve().then(() => fetchImpl(env.infoUrl || '/info', { cache: 'no-store' })).then(r => (r && r.ok ? r.json() : Promise.reject(new Error('no'))))
        .then(j => {
          if (mine !== infoToken) return;
          const list = (Array.isArray(j && j.addresses) ? j.addresses : []).map(parseServerAddress).filter(Boolean);
          const best = parseServerAddress(j && j.preferred) || list[0] || null;
          if (!best) return fail();
          S.hostInfo = { state: 'ready', address: best, addresses: list.length ? list : [best] };
          if (S.overlay === 'online-host') render(true);
        }).catch(fail);
    }
    function openOnlineDialog(which, code) {
      if (S.online && S.online.phase === 'connecting') leaveOnline(true);
      S.overlay = which; S.onlineError = '';
      if (which === 'online-host') loadHostInfo();
      if (!S.form) {                                  // the address of the server this page came from, else the one used last time
        let sv = '', nm = '';
        try { sv = String(storage.get('mt-server') || ''); nm = String(storage.get('mt-name') || ''); } catch (e) { /* ignore */ }
        S.form = { server: defaultServer || sv, name: nm, code: '', rounds: S.opts.rounds, hand: S.opts.hand, computer: 'none' };
      }
      if (code) {                                     // from a scanned link: the code is filled in, nothing else to type
        const c = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
        S.form.code = c.length === 6 ? c.slice(0, 3) + '-' + c.slice(3) : c;
      }
      render(true);
    }

    const controllers = {
      human: {
        act: humanAct,
        async choose(game, player, moves, drew) {
          const dk = drew ? key(drew) : null;
          // pre-select a just-drawn tile only when it has a choice of trains; otherwise one click plays it.
          // The only tile you can play is always selected: there is nothing else to choose, and it cannot be de-selected.
          const sole = soleTile(moves);
          S.selectedKey = !hintsOn(S) ? null : (sole && moves.length > 1) ? sole : ((dk && moves.filter(m => key(m.tile) === dk).length > 1) ? dk : null);
          const chosen = await awaitUser('move', { moves });
          try { S.pendingRating = S.opts.chat ? rateMove(game, player, moves, chosen) : null; }   // judged on the board as it was
          catch (e) { S.pendingRating = null; }                                                  // a comment must never be able to break the game
          return chosen;
        },
      },
      cpu: {
        act: cpuAct,
        async choose(game, player, moves) {
          // A double is open and the computer holds a tile that covers it (every legal move is a
          // cover): it just plays it, with no thinking time.
          if (game.openDouble) return cpuChoose(game, player, moves, S.opts.level);
          setBanner(`${cpuName(S)} is thinking...`);
          render();
          await pause(humanPace('place'));
          return cpuChoose(game, player, moves, S.opts.level);
        },
      },
    };

    /* ---------- the match ---------- */
    async function showModal(modal, wait) {
      S.modal = modal;
      if (wait) await awaitUser('modal'); else render();
    }

    async function runMatch() {
      S.matchActive = true;
      let startIndex = rng() < 0.5 ? 0 : 1;
      for (let r = 0; r < S.opts.rounds; r++) {
        S.roundIndex = r;
        S.startIndex = startIndex;
        const engine = MAX_PIP - r;
        S.game = newRound({ engine, handSize: S.opts.hand, rng, simultaneousOpening: true });
        S.game.players[1].name = cpuName(S);
        S.log = []; S.selectedKey = null; S.drawnKey = null; S.freshKey = null; S.lastPlay = null; S.plan = null; S.handOrder = null; S.dragKey = null;
        say(`Round ${r + 1}: the engine is double-${engine}. Everyone builds their train at the same time.`);
        S.log.push(`${startIndex === 0 ? 'You play' : `${cpuName(S)} plays`} first once the trains are built.`);
        render();
        await pause(800);

        const result = await playRound(S.game, startIndex, controllers, ui);
        setBanner(result.blocked ? 'The round is blocked.'
          : result.tie ? 'You both played every tile.'
          : `${result.winner.id === 'human' ? 'You' : cpuName(S)} played the last tile.`);
        render();
        await pause(1100);

        const rows = S.game.players.map(p => ({ id: p.id, name: p.name, hand: p.hand.map(t => t.slice()), pips: handPips(p) }));
        rows.forEach(row => { S.totals[row.id] += row.pips; });
        await showModal({
          type: 'roundEnd', blocked: result.blocked, tie: !!result.tie, winnerId: result.winner ? result.winner.id : null,
          rows, totals: { human: S.totals.human, cpu: S.totals.cpu }, last: r === S.opts.rounds - 1,
        }, true);
        startIndex = 1 - startIndex;
      }
      S.matchActive = false;
      await showModal({ type: 'final', totals: { human: S.totals.human, cpu: S.totals.cpu } }, false);
    }

    /* ---------- actions from the page ---------- */
    function startGame(a) {
      if (S.online) leaveOnline(true);
      abortMatch();
      S.opts = sanitize(Object.assign({}, a, { sound: S.opts.sound, chat: S.opts.chat, allowHints: a.allowHints === undefined ? S.opts.allowHints : a.allowHints }));   // the setup form has no sound field: keep the current setting
      S.showHints = true; S.notice = '';
      saveOpts();
      // a fresh random name for the computer: not one already at the table, and not last game's
      let previous = '';
      try { previous = String(storage.get('mt-last-cpu') || ''); } catch (e) { /* ignore */ }
      S.cpuName = pickCpuName(S.opts.level, rng, new Set(['you', previous.toLowerCase()]));
      try { storage.set('mt-last-cpu', S.cpuName); } catch (e) { /* ignore */ }
      S.overlay = null; S.modal = null; S.game = null;
      S.totals = { human: 0, cpu: 0 }; S.roundIndex = 0; S.log = []; S.banner = '';
      runMatch().catch(err => {
        if (err === ABORT) return;
        S.banner = 'Something went wrong: ' + (err && err.message ? err.message : err);
        render();
        if (typeof console !== 'undefined') console.error(err);
      });
    }

    function selectTile(k) {
      const a = S.awaiting;
      if (!a) return;
      if (!hintsOn(S)) {                       // no hints: any tile can be picked up, whether or not it can be played; nothing is played for you
        if (a.kind !== 'move' && a.kind !== 'build' && a.kind !== 'draw') return;
        S.selectedKey = S.selectedKey === k ? null : k; S.hoverKey = null; S.notice = '';
        render();
        return;
      }
      if (a.kind === 'build') {
        const mv = a.moves.find(m => key(m.tile) === k);
        if (mv) { S.hoverKey = null; a.resolve({ type: 'play', move: mv }); }
        return;
      }
      if (a.kind !== 'move') return;
      const mine = a.moves.filter(m => key(m.tile) === k);
      if (!mine.length) return;
      // Only one place this tile can go: just play it, no need to ask where.
      if (mine.length === 1) { S.selectedKey = null; S.hoverKey = null; a.resolve(mine[0]); return; }
      if (S.selectedKey === k) {
        if (soleTile(a.moves) === k) return;       // the only tile you can play stays selected
        S.selectedKey = null;
      } else S.selectedKey = k;
      render();
    }

    function playOn(trainId) {
      const a = S.awaiting;
      if (!hintsOn(S)) {                       // no hints: the player chose the tile and now the train; a wrong guess is just told so
        if (!a || !S.selectedKey || (a.kind !== 'move' && a.kind !== 'build' && a.kind !== 'draw')) return;
        const mv = (a.moves || []).find(x => key(x.tile) === S.selectedKey && x.trainId === trainId);
        if (!mv) { S.notice = 'That tile cannot be played on that train.'; render(); return; }
        S.selectedKey = null; S.notice = '';
        a.resolve(a.kind === 'build' ? { type: 'play', move: mv } : mv);
        return;
      }
      if (!a || a.kind !== 'move' || !S.selectedKey) return;
      const m = a.moves.find(x => key(x.tile) === S.selectedKey && x.trainId === trainId);
      if (!m) return;
      S.selectedKey = null;
      a.resolve(m);
    }

    function draw() {
      const a = S.awaiting;
      if (!a) return;
      if (a.kind === 'draw') a.resolve();
      else if (a.kind === 'build' && a.canDraw) a.resolve({ type: 'draw' });
      else if (!hintsOn(S) && (a.kind === 'move' || a.kind === 'build')) { S.notice = 'You cannot draw while you have a tile you can play.'; render(); }
    }

    function autoBuild() {
      const a = S.awaiting;
      if (!a || a.kind !== 'build' || !a.canBuild) return;
      if (S.online) { S.selectedKey = null; onlineIntent({ a: 'autoBuild' }); return; }       // online, the server lays the train
      const steps = buildSteps(S.game, S.game.players[0]);
      if (!steps.length) return;
      const first = steps.shift();
      let action;
      if (first.type === 'undo') action = { type: 'undo' };
      else {
        const mv = a.moves.find(m => key(m.tile) === first.key);
        if (!mv) return;
        action = { type: 'play', move: mv };
      }
      S.plan = steps;
      S.selectedKey = null;
      setBanner('Building your longest train...');
      a.resolve(action);
    }

    function undoTile() {
      const a = S.awaiting;
      if (a && a.kind === 'build' && a.canUndo) a.resolve({ type: 'undo' });
    }

    function endBuild() {
      const a = S.awaiting;
      if (a && a.kind === 'build' && a.canDone) a.resolve({ type: 'done' });
    }

    // Highlight where a hand tile could go. Done by toggling a class on the EXISTING track
    // elements, not by redrawing the page: redrawing under the pointer would replace the
    // very tile being hovered and could disturb focus.
    function hoverTile(k) {
      if (S.dragKey) return;                         // no preview while a tile is being dragged
      const next = k || null;
      if (S.hoverKey === next) return;
      S.hoverKey = next;
      const tracks = root.querySelectorAll ? root.querySelectorAll('.track') : [];
      if (!tracks.length) { render(); return; }
      const set = previewOf(S);
      tracks.forEach(el => {
        const on = !!set[el.dataset.train] && !(el.classList.contains && el.classList.contains('target'));
        el.classList.toggle('preview', on);
      });
    }

    /* ---------- arranging your hand ---------- */
    const handKeys = () => orderedHand(S).map(key);
    function dragStart(k) {
      if (!S.game) return;
      const order = handKeys();
      if (!order.includes(k)) return;
      S.prevHandOrder = S.handOrder;                  // dragging a tile out to play it must not rearrange the hand
      S.handOrder = order; S.dragKey = k; S.hoverKey = k;   // hoverKey lights the trains this tile could go on
      render();
    }
    function dragMove(index) {
      if (!S.dragKey || !S.handOrder || !(index >= 0)) return;
      const next = moveInOrder(S.handOrder, S.dragKey, index);
      if (next.join() === S.handOrder.join()) return;
      S.handOrder = next;
      render();
    }
    function dragEnd() {
      if (!S.dragKey) return;
      S.dragKey = null; S.dropTrain = null; S.hoverKey = null;
      render();
    }

    /* ---------- dragging a tile onto a train to play it ---------- */
    // the trains this tile could be played on right now (none while it is not your turn)
    function legalTrains(k) {
      const a = S.awaiting;
      if (!a || (a.kind !== 'move' && a.kind !== 'build') || !a.moves) return [];
      return a.moves.filter(m => key(m.tile) === k).map(m => m.trainId);
    }
    function dragOver(trainId) {
      const next = trainId || null;
      if (S.dropTrain === next) return;
      S.dropTrain = next;
      render();
    }
    function dropOnTrain(k, trainId, from) {
      S.dragKey = null; S.dropTrain = null; S.hoverKey = null;
      if (S.prevHandOrder !== undefined) { S.handOrder = S.prevHandOrder; S.prevHandOrder = undefined; }
      const a = S.awaiting;
      const mv = a && (a.kind === 'move' || a.kind === 'build') && a.moves ? a.moves.find(m => key(m.tile) === k && m.trainId === trainId) : null;
      if (!mv) {                                      // not a legal place for it: it simply goes back to the hand
        if (!hintsOn(S) && a && (a.kind === 'move' || a.kind === 'build' || a.kind === 'draw')) S.notice = 'That tile cannot be played on that train.';
        render(); return;
      }
      S.notice = '';
      S.dropFrom = from ? { key: k, rect: from } : null;   // the tile flies from where it was let go
      S.selectedKey = null;
      a.resolve(a.kind === 'build' ? { type: 'play', move: mv } : mv);
    }
    function moveTile(k, delta) {                    // keyboard: Shift + arrow keys on a focused tile
      if (!S.game) return;
      const order = handKeys(), i = order.indexOf(k);
      if (i < 0) return;
      S.handOrder = moveInOrder(order, k, i + delta);
      render();
    }

    // after the window changes size, keep every train showing its newest domino
    function snapTrains() {
      if (!root.querySelectorAll) return;
      root.querySelectorAll('.scroller').forEach(el => {
        el.scrollLeft = el.scrollWidth;
        if (el.classList && el.classList.toggle) el.classList.toggle('more-left', el.scrollLeft > 4);
      });
    }

    function toggleChat() {
      S.opts.chat = !S.opts.chat;
      saveOpts();
      if (!S.opts.chat) { S.comment = null; S.pendingRating = null; clearChatTimers(); }
      else if (S.awaiting && (S.awaiting.kind === 'move' || S.awaiting.kind === 'draw' || S.awaiting.kind === 'build')) armSlow();
      render(true);
    }

    function toggleSound() {
      S.opts.sound = !S.opts.sound;
      saveOpts();
      if (S.opts.sound) { sound.unlock(); sound.clack(); }   // a click so you can hear that it is back on
      render(true);
    }

    function dialogOk() {
      const a = S.awaiting;
      if (a && a.kind === 'modal') { S.modal = null; a.resolve(); if (S.online) S.awaiting = null; }
    }

    function dispatch(a) {
      switch (a.type) {
        case 'startGame': return startGame(a);
        case 'selectTile': return selectTile(a.key);
        case 'playOn': return playOn(a.train);
        case 'draw': return draw();
        case 'autoBuild': return autoBuild();
        case 'undoTile': return undoTile();
        case 'endBuild': return endBuild();
        case 'dialogOk': return dialogOk();
        case 'openRules': S.overlay = 'rules'; return render(true);
        case 'newGame': S.overlay = 'setup'; return render(true);
        case 'closeOverlay':
          if (S.overlay === 'online-host' || S.overlay === 'online-join') { if (S.online && S.online.phase === 'connecting') leaveOnline(true); S.overlay = 'setup'; render(true); return; }
          if (S.overlay === 'online-leave') { S.overlay = null; render(true); return; }
          if (S.overlay && (S.matchActive || S.overlay === 'rules')) { S.overlay = null; render(true); }
          return;
        case 'openHost': return openOnlineDialog('online-host');
        case 'openJoin': return openOnlineDialog('online-join', a.code);
        case 'hostGame':                                     // (waits for the server's address if it has not arrived yet)
          if (S.hostInfo && S.hostInfo.state === 'ready') return beginOnline('create', a);
          return loadHostInfo().then(() => beginOnline('create', a));
        case 'joinGame': return beginOnline('join', a);
        case 'startOnline': if (S.online && S.online.host) netSend({ t: 'start' }); return;
        case 'onlineSettings': if (S.online && S.online.host && S.online.phase === 'lobby') netSend({ t: 'settings', rounds: Number(a.rounds), hand: Number(a.hand), computer: LEVELS.includes(a.computer) ? a.computer : 'none' }); return;
        case 'sendChat': return sendChat(a.key);
        case 'toggleSay': S.sayOpen = !S.sayOpen; return render(true);
        case 'askLeave': S.overlay = 'online-leave'; return render(true);
        case 'confirmLeave': leaveOnline(false); S.overlay = 'setup'; return render(true);
        case 'onlineBack': leaveOnline(true, !!(S.online && S.online.ended && S.online.ended.reason === 'replaced')); S.overlay = 'setup'; return render(true);
        case 'resumeOnline': return resumeOnline();
        case 'copied': S.copied = a.which === 'copyLink' ? 'link' : 'code'; later(() => { S.copied = false; render(); }, 2000); return render();
        case 'selectQr': S.qrIndex = Math.max(0, Number(a.key) || 0); return render();
        case 'hoverTile': return hoverTile(a.key);
        case 'dragStart': return dragStart(a.key);
        case 'dragMove': return dragMove(a.index);
        case 'dragEnd': return dragEnd();
        case 'dragOver': return dragOver(a.train);
        case 'dropOnTrain': return dropOnTrain(a.key, a.train, a.from);
        case 'moveTile': return moveTile(a.key, a.delta);
        case 'snapTrains': return snapTrains();
        case 'toggleSound': return toggleSound();
        case 'toggleChat': return toggleChat();
        case 'toggleShowHints': S.showHints = S.showHints === false; S.hoverKey = null; S.notice = ''; return render(true);
        case 'setAllowHints': S.opts.allowHints = !!a.value; saveOpts(); S.hoverKey = null; S.notice = ''; return render();
        case 'toggleStyle': S.opts.style = S.opts.style === 'numbers' ? 'pips' : 'numbers'; saveOpts(); return render(true);
        case 'boot': return render(true);
        default: return undefined;
      }
    }

    return { dispatch, render, state: S, ui, controllers, sanitize, legalTrains };
  }

  /* ================================= BOOT ================================= */

  function boot() {
    const root = document.getElementById('app');
    let seed = null, joinCode = '';
    try { seed = new URLSearchParams(location.search).get('seed'); } catch (e) { /* ignore */ }
    try {                                              // a scanned QR code opens  http://host:port/?join=CODE
      const u = new URL(location.href);
      joinCode = u.searchParams.get('join') || '';
      if (joinCode) { u.searchParams.delete('join'); history.replaceState(null, '', u.pathname + u.search + u.hash); }   // so a reload does not open it again
    } catch (e) { /* ignore */ }
    const storage = {
      get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    };
    const reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const sound = createSound(global.AudioContext || global.webkitAudioContext);
    const canFly = typeof Element !== 'undefined' && Element.prototype && 'animate' in Element.prototype;
    const fx = canFly ? createFx(root, document) : null;
    // Served by a game server (http://...)? Then that server is the default for hosting and joining.
    let defaultServer = '';
    try { if (location.protocol === 'http:' && location.host) defaultServer = location.host; } catch (e) { /* ignore */ }
    const app = createApp({
      root, storage, reducedMotion: reduced, sound, fx,
      WebSocket: global.WebSocket, defaultServer, fetch: global.fetch ? global.fetch.bind(global) : null,
      rng: seed !== null && seed !== '' ? mulberry32(Number(seed)) : Math.random,
    });

    const drag = createDrag(root, app, document);
    root.addEventListener('click', e => {
      if (drag.consumeClick()) return;                // the click that ends a drag is not a play
      const el = e.target.closest ? e.target.closest('[data-action]') : null;
      if (el) {
        const d = el.dataset;
        if (d.action === 'toggleAllowHints') {            // the main-screen switch: it changes at once (and is remembered), without redrawing the dialog under the player's hands
          const on = !(el.getAttribute && el.getAttribute('aria-pressed') === 'true');
          if (el.setAttribute) { el.setAttribute('aria-pressed', String(on)); el.textContent = 'Allow hints: ' + (on ? 'on' : 'off'); }
          app.dispatch({ type: 'setAllowHints', value: on });
          return;
        }
        if (d.action === 'startGame') {
          const val = id => { const n = root.querySelector(id); return n ? n.value : undefined; };
          app.dispatch({ type: 'startGame', rounds: val('#opt-rounds'), hand: val('#opt-hand'), style: val('#opt-style'), level: val('#opt-level') });
        } else if (d.action === 'hostGame' || d.action === 'joinGame') {
          const val = id => { const n = root.querySelector(id); return n ? n.value : undefined; };
          app.dispatch({ type: d.action, server: val('#net-server'), name: val('#net-name'), code: val('#net-code'), rounds: val('#net-rounds'), hand: val('#net-hand'), computer: val('#net-computer') });
        } else if (d.action === 'copyCode' || d.action === 'copyLink') {
          try { if (global.navigator && global.navigator.clipboard) global.navigator.clipboard.writeText(String(d.key || '')).then(() => app.dispatch({ type: 'copied', which: d.action }), () => {}); } catch (err) { /* the text is selectable on screen */ }
        } else {
          app.dispatch({ type: d.action, key: d.key, train: d.train });
        }
        return;
      }
      // a tap on a train plays the picked-up tile there: on a glowing one with hints, on any train without
      const track = e.target.closest ? (e.target.closest('.track.target') || e.target.closest('.track')) : null;
      if (track && track.dataset) app.dispatch({ type: 'playOn', train: track.dataset.train });
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') app.dispatch({ type: 'closeOverlay' }); });
    // the host changes the game length or hand size in the lobby: tell the server straight away
    root.addEventListener('change', e => {
      const id = e.target && e.target.id;
      if (id !== 'net-rounds' && id !== 'net-hand' && id !== 'net-computer') return;
      const val = i => { const n = root.querySelector(i); return n ? n.value : undefined; };
      app.dispatch({ type: 'onlineSettings', rounds: val('#net-rounds'), hand: val('#net-hand'), computer: val('#net-computer') });
    });
    // Enter in a text box of the host/join form presses its main button
    root.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target || e.target.tagName !== 'INPUT' || !/^net-/.test(e.target.id || '')) return;
      const b = root.querySelector('[data-primary]');
      if (b && !b.disabled && b.click) { e.preventDefault(); b.click(); }
    });
    if (global.addEventListener) global.addEventListener('resize', () => app.dispatch({ type: 'snapTrains' }));

    // Browsers only allow sound after a click, tap or key press: unlock it on the first one.
    ['pointerdown', 'click', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, () => sound.unlock(), true));

    // Hovering (or tabbing to) a playable hand tile shows where it could go.
    const tileKey = el => {
      const b = el && el.closest ? el.closest('.tile-btn') : null;
      return b && b.classList && b.classList.contains('playable') ? b.dataset.key : null;
    };
    root.addEventListener('mouseover', e => app.dispatch({ type: 'hoverTile', key: tileKey(e.target) }));
    root.addEventListener('mouseleave', () => app.dispatch({ type: 'hoverTile', key: null }));
    root.addEventListener('focusin', e => app.dispatch({ type: 'hoverTile', key: tileKey(e.target) }));
    root.addEventListener('focusout', () => app.dispatch({ type: 'hoverTile', key: null }));
    // keyboard alternative to dragging: Shift + left/right arrow moves the focused tile
    root.addEventListener('keydown', e => {
      if (!e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const b = e.target && e.target.closest ? e.target.closest('.tile-btn') : null;
      if (!b) return;
      e.preventDefault();
      app.dispatch({ type: 'moveTile', key: b.dataset.key, delta: e.key === 'ArrowLeft' ? -1 : 1 });
    });

    app.dispatch({ type: 'boot' });
    if (joinCode) app.dispatch({ type: 'openJoin', code: joinCode });   // from a scanned link: the Join screen with the code filled in
    else app.dispatch({ type: 'resumeOnline' });                        // a page reload in the middle of an online game: go back to it
    global.MexicanTrainApp = app;
  }

  global.MexicanTrainGame = {
    Engine: {
      newRound, legalMoves, applyMove, undoLast, playTurn, buildPhase, playRound, isBlocked, cpuChoose,
      cpuBuildAction, longestChain, longestFullChain, buildSteps, handPips, tilePips, mulberry32, shuffle, key, LEVELS, LEVEL_LABEL,
      moveValue, rateMove,
    },
    tileSVG, tileBackSVG, pipPoints, viewApp, createApp, pickCpuName, PIP_COLORS, PACE, CPU_NAMES, renderClack, clackGapMs, renderTurn, createSound,
    flightGeometry, flightRotation, flightStart, moveInOrder, slotAt, dropIndexAt, createFx, createDrag, orderedHand,
    RATING, CHAT, LINES, commentKindFor, pickLine, fillLine, paceFor, soleTile, CPU_PLAYERS, levelOfName, NATIVE_LINES, NATIVE_LANG, nativeLangOf, FOOD, FOOD_ENGLISH, FOOD_NATIVE, foodComment,
    PLAYER_IDS, toyTrainSVG, ONLINE_PHRASES, cleanPlayerName, parseServerAddress, qrEncode, qrSvg, qrCodewords, rsEncode, QR_BLOCKS_M, QR_TOTAL_CODEWORDS,
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
