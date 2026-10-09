/* Mexican Train (double-12) - play against the computer in the browser.
 * Sections: ENGINE (rules + computer player), TILE ART (SVG), VIEWS (HTML strings),
 * APP (state + turn flow), BOOT. Everything is plain JavaScript, no libraries. */
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

  /* simultaneousOpening: every player builds their own train at the same time before the
   * first normal turn (see buildPhase). Off by default so the plain rules stay testable. */
  function newRound({ engine, handSize, rng, simultaneousOpening }) {
    const tiles = [];
    for (let a = 0; a <= MAX_PIP; a++) {
      for (let b = a; b <= MAX_PIP; b++) {
        if (!(a === engine && b === engine)) tiles.push([a, b]);
      }
    }
    shuffle(tiles, rng);
    return {
      engine,
      players: [
        { id: 'human', name: 'You', hand: tiles.splice(0, handSize) },
        { id: 'cpu', name: 'CPU', hand: tiles.splice(0, handSize) },
      ],
      boneyard: tiles,
      trains: {
        human: newTrain('human', engine),
        cpu: newTrain('cpu', engine),
        mexican: newTrain('mexican', engine),
      },
      openDouble: null,
      winner: null,
      rng,
      opening: simultaneousOpening
        ? { human: { finished: false, drew: false, lastDrew: null }, cpu: { finished: false, drew: false, lastDrew: null } }
        : null,
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
   * lantern (marker) goes on their train, exactly as on a normal turn. */
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

  function blockedResult(game) {
    const [a, b] = game.players;
    const pa = handPips(a), pb = handPips(b);
    return { winner: pa === pb ? null : (pa < pb ? a : b), blocked: true };
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
  // can follow up, keep its own train extendable, and close its own lantern when it can.
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
  /* The "clack" of a domino meeting the table, synthesised (no audio files): a sharp noise
   * tick, a few quickly fading wood resonances and a soft low thud. renderClack is plain
   * maths on an array, so it can be checked without a browser or a speaker. */
  function renderClack(sampleRate, seed) {
    const rnd = mulberry32(seed);
    const n = Math.floor(sampleRate * 0.16);
    const out = new Float32Array(n);
    const jig = () => 0.93 + rnd() * 0.14;                 // every variant is slightly different
    const f1 = 780 * jig(), f2 = 1680 * jig(), f3 = 3150 * jig(), fLow = 190 * jig();
    const TAU = Math.PI * 2;
    const fade = Math.max(1, Math.floor(sampleRate * 0.01));
    let prevW = 0, lp = 0, peak = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const w = rnd() * 2 - 1;
      lp += ((w - prevW) * 0.5 - lp) * 0.6;                // noise with the lows removed, rounded off a little
      prevW = w;
      const tick = lp * Math.exp(-t / 0.0022) * 1.4;
      const body = Math.sin(TAU * f1 * t) * Math.exp(-t / 0.016) * 0.5 +
                   Math.sin(TAU * f2 * t) * Math.exp(-t / 0.008) * 0.32 +
                   Math.sin(TAU * f3 * t) * Math.exp(-t / 0.0035) * 0.16;
      const thud = Math.sin(TAU * fLow * t) * Math.exp(-t / 0.03) * 0.32;
      const v = (tick + body + thud) * Math.min(1, t / 0.0004) * Math.min(1, (n - i) / fade);
      out[i] = v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    const g = peak > 0 ? 0.7 / peak : 1;
    for (let i = 0; i < n; i++) out[i] *= g;
    return out;
  }

  /* Plays the clack through Web Audio. Browsers only allow sound after a click or key press,
   * so unlock() must be called from one; until then (or with no audio at all) clack() quietly
   * does nothing and the game plays exactly the same. */
  function createSound(AudioCtor, rng) {
    let ctx = null, buffers = [];
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
        gain.gain.value = 0.8;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start(0);
      } catch (e) { /* ignore */ }
    }
    return { unlock, clack };
  }

  /* =============================== TILE ART =============================== */
  /* Each tile is one self-contained SVG. Pips are colour-coded by number, the
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

  /* Which tile the pointer is over (or nearest to): the index of the closest rectangle centre. */
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
    const lastBack = () => { const b = root.querySelectorAll('.cpu-hand .back'); return b && b.length ? b[b.length - 1] : null; };

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
      else el = lastBack();
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
      const turnsOver = spec.playerId === 'cpu' && !spec.hidden;
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
        const dest = lastBack();
        if (!dest) return;
        fly(lastBack, dest, tok.from, 0, { face: null, back: backLayer('v') }, 480);         // the computer's draw stays face down
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
      'Shopping for tiles again? Your favourite.',
      'Out of moves already? Painful.',
      'The boneyard must know you by name now.',
      'Draw, draw, draw. It is your best skill.',
    ],
    pass: [
      'Passing? Bold. Silly, but bold.',
      'A lantern on your train. How welcoming.',
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
      'Oh, a lantern! Very festive.',
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
      'A lantern. How generous of you.',
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
      pass: [['Пасуешь? Спасибо, что оставил дверь открытой.', 'Passing? Thanks for leaving the door open.'], ['Фонарь на твоём поезде. Как мило.', 'A lantern on your train. How sweet.']],
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
      pass: [['パス？扉を開けてくれてありがとう。', 'Pass? Thanks for leaving the door open.'], ['ランタンがついたよ。親切だね。', 'A lantern on your train. How kind.']],
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
      pass: [['跳过？谢谢你替我开门。', 'A pass? Thanks for opening the door for me.'], ['你的牌路上亮灯了，真贴心。', 'There is a lantern on your train, how thoughtful.']],
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
      pass: [['패스? 문을 열어줘서 고마워.', 'Pass? Thanks for opening the door.'], ['네 기차에 랜턴이 켜졌네. 친절하기도 하지.', 'A lantern on your train. How kind.']],
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
      pass: [['पास? दरवाज़ा खुला छोड़ने के लिए शुक्रिया।', 'Pass? Thanks for leaving the door open.'], ['तुम्हारी ट्रेन पर लालटेन जल गई। कितनी मेहरबानी!', 'A lantern lit on your train. How kind!']],
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

  function trainName(S, id) {
    return id === 'human' ? 'Your train' : id === 'cpu' ? `${cpuName(S)}'s train` : 'Mexican train';
  }

  function trainRef(S, id, actor) {
    if (id === 'mexican') return 'the Mexican train';
    if (id === actor) return actor === 'human' ? 'your train' : 'their own train';
    return actor === 'human' ? `${cpuName(S)}'s train` : 'your train';
  }

  function bannerText(S) {
    const a = S.awaiting, g = S.game;
    if (a && a.kind === 'build') {
      const lead = S.drawnKey ? `You drew ${S.drawnKey}. ` : '';
      if (a.canDraw) return 'Nothing fits the engine. Draw a tile from the boneyard.';
      if (a.lastDouble) return 'Your last tile is a double. A double cannot go out, so it stays in your hand. Press Done.';
      if (!a.canDone) return 'A double needs a tile on top of it. Cover it, or take it back.';
      if (a.placed === 0) return `${lead}Everyone builds their train at the same time. Tap tiles to add them, or let the game build your longest train.`;
      return 'Keep adding tiles, take the last one back, or press Done. You can take tiles back until you press Done.';
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
    if (g && g.opening && g.opening.human.finished && !g.opening.cpu.finished) {
      return `Your train is set. Waiting for ${cpuName(S)} to finish building.`;
    }
    return S.banner || '';
  }

  function viewBar(S) {
    const g = S.game;
    const round = g
      ? `<div class="round"><span>Round ${S.roundIndex + 1} of ${S.opts.rounds}</span><span>Engine double-${g.engine}</span><span>Computer: ${LEVEL_LABEL[S.opts.level]}</span></div>`
      : '';
    return `<header class="bar">
      <div class="brand"><h1>Mexican Train</h1><p class="sub">Double-12 against the computer</p></div>
      ${round}
      <div class="totals" role="group" aria-label="Scores, lowest wins">
        <div class="tot"><b>${S.totals.human}</b><span>You</span></div>
        <div class="tot"><b>${S.totals.cpu}</b><span>${cpuName(S)}</span></div>
        <p class="hint">Lowest score wins</p>
      </div>
      <nav class="tools">
        <button class="btn" data-action="toggleSound" aria-pressed="${S.opts.sound ? 'false' : 'true'}" data-focus-id="tools-sound">${S.opts.sound ? 'Mute' : 'Unmute'}</button>
        <button class="btn" data-action="toggleStyle" data-focus-id="tools-style">${S.opts.style === 'numbers' ? 'Show pips' : 'Show numbers'}</button>
        <button class="btn" data-action="openRules" data-focus-id="tools-rules">Rules</button>
        <button class="btn" data-action="newGame" data-focus-id="tools-new">New game</button>
      </nav>
    </header>`;
  }

  function viewOpp(S) {
    const g = S.game;
    const n = g.players[1].hand.length;
    const a = S.awaiting;
    const ready = drawOnly(S);
    const c = S.opts.chat ? S.comment : null;
    return `<section class="opp" aria-label="Opponent and boneyard">
      <div class="cpu-hand">
        <span class="who">${cpuName(S)}</span>
        <span class="tag tag-${S.opts.level}" title="${LEVEL_LABEL[S.opts.level]} computer player">${LEVEL_LABEL[S.opts.level]}</span>
        <span class="backs" aria-hidden="true">${'<i class="back"></i>'.repeat(n)}</span>
        <span class="count">${n} ${n === 1 ? 'tile' : 'tiles'}</span>
        <button class="btn chat-toggle" data-action="toggleChat" aria-pressed="${S.opts.chat ? 'true' : 'false'}" data-focus-id="chat">Comments: ${S.opts.chat ? 'on' : 'off'}</button>
      </div>
      <button class="boneyard${ready ? ' ready' : ''}" data-action="draw" data-focus-id="draw"${ready ? ` style="animation-delay:-${S.flashPhase || 0}ms"` : ' disabled'}
        aria-label="${ready ? 'Draw a tile. ' : ''}${g.boneyard.length} tiles in the boneyard">
        <span class="stack" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="yard-text"><span class="count"><b>${g.boneyard.length}</b> in the boneyard</span>${ready ? '<span class="cta">Draw a tile</span>' : ''}</span>
      </button>
      <div class="bubble-slot" aria-live="polite">${!c ? '' : c.lang
        ? `<div class="bubble native"><b>${esc(cpuName(S))}</b><span lang="${c.lang}"${NATIVE_DIR[c.lang] ? ' dir="rtl"' : ''}>${esc(c.text)}</span><small class="trans" lang="en">${esc(c.trans)}</small></div>`
        : `<div class="bubble"><b>${esc(cpuName(S))}</b><span>${esc(c.text)}</span></div>`}</div>
    </section>`;
  }

  function targetsOf(S) {
    const a = S.awaiting;
    const set = {};
    if (a && a.kind === 'move' && S.selectedKey) {
      a.moves.forEach(m => { if (key(m.tile) === S.selectedKey) set[m.trainId] = m; });
    }
    return set;
  }

  // Trains the hovered (or keyboard-focused) hand tile could be played on.
  function previewOf(S) {
    const a = S.awaiting, set = {};
    if (S.hoverKey && a && (a.kind === 'move' || a.kind === 'build')) {
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

  function viewTrack(S, id) {
    const g = S.game, tr = g.trains[id];
    const targets = targetsOf(S);
    const target = !!targets[id];
    const must = !!(g.openDouble && g.openDouble.trainId === id);
    const style = S.opts.style;
    // While the computer is still building, its tiles stay face down.
    const hidden = id === 'cpu' && !!g.opening && !g.opening.cpu.finished;

    let note = '';
    if (id === 'mexican') note = '<span class="shared">Open to both players</span>';
    else if (hidden) note = '<span class="shared">Building, tiles face down</span>';
    else if (tr.marker) {
      note = `<span class="lamp"><i class="lantern" aria-hidden="true"></i><span>${id === 'human' ? `Open: ${cpuName(S)} can play here` : 'Open: you can play here'}</span></span>`;
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
      if (hidden) return tileBackSVG('h', pop ? 'pop' : '', i);
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
    return `<div class="track${target ? ' target' : ''}${must ? ' must' : ''}${preview ? ' preview' : ''}${drop ? ' drop' : ''}" data-train="${id}">
      ${label}
      <div class="scroller" data-train="${id}"><div class="track-tiles">${engineTile}${tiles}${ghost}</div></div>
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
        (a.canBuild ? `<button class="btn primary" data-action="autoBuild" data-focus-id="autobuild">Build my longest train (${n} ${n === 1 ? 'tile' : 'tiles'})</button>` : '') +
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
    const moving = !!(a && (a.kind === 'move' || a.kind === 'build')) || drawOnly(S);
    const playable = {};
    if (moving && a.moves) a.moves.forEach(m => { playable[key(m.tile)] = true; });
    const style = S.opts.style;
    const tiles = orderedHand(S).map(t => {
      const k = key(t);
      const mode = moving ? (playable[k] ? 'playable' : 'dim') : 'idle';
      const sel = S.selectedKey === k;
      const label = `${t[0]} and ${t[1]}${mode === 'playable' ? ', playable' : ''}${sel ? ', selected' : ''}`;
      // not "disabled": every tile can be dragged, and a click on one that cannot be played does nothing
      return `<button class="tile-btn ${mode}${sel ? ' selected' : ''}${S.freshKey === k ? ' fresh' : ''}${S.dragKey === k ? ' drag-src' : ''}"
        data-action="selectTile" data-key="${k}" data-focus-id="t${k}" aria-pressed="${sel}"
        aria-label="${label}"${mode === 'playable' ? '' : ' aria-disabled="true"'}>${tileSVG(t[0], t[1], { orient: 'h', style })}</button>`;
    }).join('');
    const tip = S.roundIndex === 0 && !S.handOrder ? '<span class="tip">Drag a tile onto a train to play it, or around your hand to rearrange</span>' : '';
    const sort = S.handOrder ? '<button class="btn sort-btn" data-action="sortHand" data-focus-id="sort">Sort hand</button>' : '';
    // Two or more rows: half the tiles (plus one spare spot) per row, at most 10 across. On a narrow
    // screen the grid simply wraps into more rows.
    const n = me.hand.length;
    const cols = Math.min(10, Math.max(1, Math.ceil((n + 1) / 2)));
    const canDraw = drawOnly(S);
    const spot = canDraw
      ? `<button class="slot-draw" data-action="draw" data-focus-id="slotdraw" aria-label="Draw a tile from the boneyard"
          style="animation-delay:-${S.flashPhase || 0}ms"><span>Draw</span></button>`
      : '<div class="slot-empty" aria-hidden="true"></div>';
    return `<section class="tray" aria-label="Your hand">
      <div class="tray-head"><span>Your hand</span>${tip}${sort}<span class="count">${n} ${n === 1 ? 'tile' : 'tiles'}</span></div>
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
      <li>If nothing in your hand fits the engine, draw one tile. If it still does not fit, you pass and a lantern goes on your train.</li>
      <li>Then you take turns. Play one tile that matches the number a train needs: your own train, the Mexican train, or your opponent's train when it shows a red lantern.</li>
      <li>Nothing fits? Draw one tile. If it fits, play it. If not, you pass and a lantern goes on your train, which lets your opponent play there until you next play on it yourself.</li>
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
      <p>Empty your hand before your opponent empties theirs. Play on your train, the shared Mexican train, or any train showing a lantern.</p>
      <div class="field"><label for="opt-rounds">Game length</label>
        <select id="opt-rounds">${optionList([1, 4, 13], o.rounds, v => v === 1 ? 'One round' : v === 4 ? 'Short game, 4 rounds' : 'Full game, 13 rounds')}</select></div>
      <div class="field"><label for="opt-hand">Tiles dealt to each player</label>
        <select id="opt-hand">${optionList([8, 12, 15], o.hand, v => v === 15 ? '15 (standard)' : String(v))}</select></div>
      <div class="field"><label for="opt-level">Computer skill</label>
        <select id="opt-level">${optionList(LEVELS, o.level, v => LEVEL_TEXT[v])}</select>
        <p class="field-note">Easy often plays at random and builds short trains. Hard plans ahead and keeps long chains available so it can go out sooner. Each level has its own computer players, who talk differently too.</p></div>
      <div class="field"><label for="opt-style">Tile faces</label>
        <select id="opt-style">${optionList(['pips', 'numbers'], o.style, v => v === 'pips' ? 'Coloured pips' : 'Large numbers')}</select></div>
      <details class="how"><summary>How to play</summary>${RULES_HTML}</details>
      <div class="actions">
        ${S.matchActive ? '<button class="btn" data-action="closeOverlay">Keep playing</button>' : ''}
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
    if (m.blocked) title = m.winnerId ? (m.winnerId === 'human' ? 'Blocked, and you hold fewer pips' : `Blocked, and ${cpu} holds fewer pips`) : 'Blocked, and it is a tie';
    else if (m.tie) title = 'You both played every tile';
    else title = m.winnerId === 'human' ? 'You went out first' : `${cpu} went out first`;
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
    const you = m.totals.human, cpu = m.totals.cpu;
    const title = you === cpu ? 'A tie' : you < cpu ? 'You win' : `${cpuName(S)} wins`;
    return `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">${title}</h2>
      <div class="final"><div class="tot"><b>${you}</b><span>You</span></div><div class="tot"><b>${cpu}</b><span>${cpuName(S)}</span></div></div>
      <p>Lowest score wins. You played ${cpuName(S)} on ${LEVEL_LABEL[S.opts.level]}.</p>
      <div class="actions"><button class="btn primary" data-action="newGame" data-primary="1">Play again</button></div>
    </div></div>`;
  }

  function viewOverlay(S) {
    if (S.overlay === 'rules') return viewRules();
    if (S.overlay === 'setup') return viewSetup(S);
    if (S.modal && S.modal.type === 'roundEnd') return viewRoundEnd(S);
    if (S.modal && S.modal.type === 'final') return viewFinal(S);
    return '';
  }

  function viewApp(S) {
    const g = S.game;
    const body = g
      ? viewOpp(S) +
        `<section class="tracks" aria-label="Trains">${viewTrack(S, 'cpu')}${viewTrack(S, 'mexican')}${viewTrack(S, 'human')}</section>` +
        viewStatus(S) + viewTray(S) + viewLog(S)
      : '<section class="empty"><p>Choose your game settings to deal the first round.</p></section>';
    return `<div class="shell">${viewBar(S)}<main class="table">${body}</main>${viewOverlay(S)}</div>`;
  }

  /* ================================= APP ================================== */

  const DEFAULT_OPTS = { rounds: 4, hand: 15, style: 'pips', sound: true, level: 'normal', chat: true };
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
      return { rounds, hand, style, sound: snd, level, chat };
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
    };
    S.opts = loadOpts();

    /* ---------- rendering ---------- */
    // While a settings/rules dialog is open, the match keeps running behind it. Re-drawing
    // the page then would wipe whatever the player is choosing, so background updates
    // are skipped; the actions that open/close dialogs pass force=true and redraw.
    function render(force) {
      if (!force && S.overlay && S.lastDialog === S.overlay) return;
      S.flashPhase = Math.floor(now() % FLASH_MS);   // re-drawing restarts CSS animations; this keeps the flash in step
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

        const dialogId = S.overlay || (S.modal && S.modal.type) || null;
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
              ? 'The boneyard is empty and nothing fits. You pass and a lantern goes on your train.'
              : 'That tile does not fit. You pass and a lantern goes on your train.');
        } else {
          say(player.hand.length === 0
            ? `${cpuName(S)} cannot draw to cover their double and passes. Once it is covered, they have gone out.`
            : `${cpuName(S)} cannot play and passes. A lantern goes on their train: you can play there.`);
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
            ? 'The boneyard is empty and nothing fits the engine. You pass and a lantern goes on your train.'
            : 'Nothing fits the engine. You pass and a lantern goes on your train.');
        } else {
          S.revealed = 'cpu';
          S.log.push(`${cpuName(S)} cannot start a train and passes. A lantern goes on their train: you can play there.`);
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

    const controllers = {
      human: {
        act: humanAct,
        async choose(game, player, moves, drew) {
          const dk = drew ? key(drew) : null;
          // pre-select a just-drawn tile only when it has a choice of trains; otherwise one click plays it.
          // The only tile you can play is always selected: there is nothing else to choose, and it cannot be de-selected.
          const sole = soleTile(moves);
          S.selectedKey = (sole && moves.length > 1) ? sole : ((dk && moves.filter(m => key(m.tile) === dk).length > 1) ? dk : null);
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
      abortMatch();
      S.opts = sanitize(Object.assign({}, a, { sound: S.opts.sound, chat: S.opts.chat }));   // the setup form has no sound field: keep the current setting
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
    }

    function autoBuild() {
      const a = S.awaiting;
      if (!a || a.kind !== 'build' || !a.canBuild) return;
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
      if (!mv) { render(); return; }                  // not a legal place for it: it simply goes back to the hand
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
    function sortHand() { S.handOrder = null; render(); }

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
      if (a && a.kind === 'modal') { S.modal = null; a.resolve(); }
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
        case 'closeOverlay': if (S.overlay && (S.matchActive || S.overlay === 'rules')) { S.overlay = null; render(true); } return;
        case 'hoverTile': return hoverTile(a.key);
        case 'dragStart': return dragStart(a.key);
        case 'dragMove': return dragMove(a.index);
        case 'dragEnd': return dragEnd();
        case 'dragOver': return dragOver(a.train);
        case 'dropOnTrain': return dropOnTrain(a.key, a.train, a.from);
        case 'moveTile': return moveTile(a.key, a.delta);
        case 'sortHand': return sortHand();
        case 'snapTrains': return snapTrains();
        case 'toggleSound': return toggleSound();
        case 'toggleChat': return toggleChat();
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
    let seed = null;
    try { seed = new URLSearchParams(location.search).get('seed'); } catch (e) { /* ignore */ }
    const storage = {
      get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    };
    const reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const sound = createSound(global.AudioContext || global.webkitAudioContext);
    const canFly = typeof Element !== 'undefined' && Element.prototype && 'animate' in Element.prototype;
    const fx = canFly ? createFx(root, document) : null;
    const app = createApp({
      root, storage, reducedMotion: reduced, sound, fx,
      rng: seed !== null && seed !== '' ? mulberry32(Number(seed)) : Math.random,
    });

    const drag = createDrag(root, app, document);
    root.addEventListener('click', e => {
      if (drag.consumeClick()) return;                // the click that ends a drag is not a play
      const el = e.target.closest ? e.target.closest('[data-action]') : null;
      if (el) {
        const d = el.dataset;
        if (d.action === 'startGame') {
          const val = id => { const n = root.querySelector(id); return n ? n.value : undefined; };
          app.dispatch({ type: 'startGame', rounds: val('#opt-rounds'), hand: val('#opt-hand'), style: val('#opt-style'), level: val('#opt-level') });
        } else {
          app.dispatch({ type: d.action, key: d.key, train: d.train });
        }
        return;
      }
      const track = e.target.closest ? e.target.closest('.track.target') : null;
      if (track) app.dispatch({ type: 'playOn', train: track.dataset.train });
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') app.dispatch({ type: 'closeOverlay' }); });
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
    global.MexicanTrainApp = app;
  }

  global.MexicanTrainGame = {
    Engine: {
      newRound, legalMoves, applyMove, undoLast, playTurn, buildPhase, playRound, isBlocked, cpuChoose,
      cpuBuildAction, longestChain, longestFullChain, buildSteps, handPips, tilePips, mulberry32, shuffle, key, LEVELS, LEVEL_LABEL,
      moveValue, rateMove,
    },
    tileSVG, tileBackSVG, pipPoints, viewApp, createApp, pickCpuName, PIP_COLORS, PACE, CPU_NAMES, renderClack, createSound,
    flightGeometry, flightRotation, flightStart, moveInOrder, slotAt, dropIndexAt, createFx, createDrag, orderedHand,
    RATING, CHAT, LINES, commentKindFor, pickLine, fillLine, paceFor, soleTile, CPU_PLAYERS, levelOfName, NATIVE_LINES, NATIVE_LANG, nativeLangOf, FOOD, FOOD_ENGLISH, FOOD_NATIVE, foodComment,
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
