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
        if (player.hand.length === 0) info.lastTileDouble = true;
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
   *    take it back) unless that double was your very last tile.
   * If nothing is down, nothing fits, and no draw is possible, the player passes and a
   * lantern (marker) goes on their train, exactly as on a normal turn. */
  async function buildPhase(game, player, agent, ui) {
    const st = game.opening[player.id];
    const train = game.trains[player.id];
    while (!st.finished) {
      const all = legalMoves(game, player, { ownOnly: true });
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

  // The computer player's normal-turn heuristic: dump heavy tiles, only play a double it
  // can follow up, keep its own train extendable, and close its own lantern when it can.
  function cpuChoose(game, player, moves) {
    let best = null, bestScore = -Infinity;
    for (const m of moves) {
      const rest = player.hand.filter(t => !sameTile(t, m.tile));
      let score = m.tile[0] + m.tile[1];
      if (rest.length === 0) score += 1000;
      if (isDouble(m.tile) && rest.length > 0) {
        const canFollowUp = rest.some(t => t[0] === m.tile[0] || t[1] === m.tile[0]);
        score += canFollowUp ? 12 : -25;
      }
      if (m.trainId === player.id) {
        score += 3;
        if (game.trains[player.id].marker) score += 8;
      }
      score += 2 * rest.filter(t => t[0] === m.newEnd || t[1] === m.newEnd).length;
      score += game.rng() * 0.5;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  /* The longest train a hand can build from `startEnd`. Longest = most tiles; ties go to the
   * higher pip total (dump heavy tiles). A chain may not END on a double (it would be left
   * uncovered) unless it uses every tile in the hand. `startsAfterDouble` is true when the
   * train already ends in a double that still has to be covered. Exact search, memoised on
   * (tiles used, open end, last-was-double), which is tiny for a 15-tile hand.
   * Returns the tiles in play order, [] if no valid chain exists. */
  function longestChain(hand, startEnd, startsAfterDouble) {
    const n = hand.length;
    const memo = new Map();
    function best(mask, end, lastDouble) {
      const k = (mask << 5) | (end << 1) | (lastDouble ? 1 : 0);
      const hit = memo.get(k);
      if (hit) return hit;
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

  /* What the computer does in the opening: lay down its longest chain one tile at a time,
   * then say it is done. (It never ends on an uncovered double, so Done is always allowed.) */
  function cpuBuildAction(game, player, info) {
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
    return `<svg class="tile ${orient}${o.cls ? ' ' + o.cls : ''}" viewBox="0 0 ${w} ${h}" role="img" ` +
      `aria-label="${a} and ${b}" focusable="false">` +
      `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="12" fill="${BONE}" stroke="${BONE_EDGE}" stroke-width="3"/>` +
      groove +
      `<g transform="translate(2,2)">${halfMarkup(a, style)}</g>` +
      `<g transform="translate(${second})">${halfMarkup(b, style)}</g>` +
      pin + `</svg>`;
  }


  /* A face-down tile: what you see of the opponent's train while they are still building. */
  function tileBackSVG(orient, cls) {
    const horiz = orient !== 'v';
    const w = horiz ? 204 : 104, h = horiz ? 104 : 204;
    return `<svg class="tile ${horiz ? 'h' : 'v'} back${cls ? ' ' + cls : ''}" viewBox="0 0 ${w} ${h}" role="img" ` +
      `aria-label="face-down tile" focusable="false">` +
      `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="12" fill="#2a6a60" stroke="#123d36" stroke-width="3"/>` +
      `<rect x="13" y="13" width="${w - 26}" height="${h - 26}" rx="8" fill="none" stroke="#8fc2b6" stroke-opacity="0.55" ` +
      `stroke-width="2.5" stroke-dasharray="7 6"/>` +
      `<circle cx="${w / 2}" cy="${h / 2}" r="5" fill="${BRASS}" stroke="#8a6a24" stroke-width="1"/></svg>`;
  }

  /* ================================ VIEWS ================================= */

  const fmt = t => t[0] + '-' + t[1];
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
      if (!a.canDone) return 'A double needs a tile on top of it. Cover it, or take it back.';
      if (a.placed === 0) return `${lead}Everyone builds their train at the same time. Tap tiles to add them, or let the game build your longest train.`;
      return 'Keep adding tiles, take the last one back, or press Done. You can take tiles back until you press Done.';
    }
    if (a && a.kind === 'move') {
      if (S.selectedKey) return `Playing ${S.selectedKey}: tap a glowing train.`;
      const lead = S.drawnKey ? `You drew ${S.drawnKey}. ` : '';
      if (g.openDouble) {
        return `${lead}A double is open. Play a tile showing ${g.openDouble.value} on the glowing train.`;
      }
      return `${lead}Your turn. Pick a tile that glows.`;
    }
    if (a && a.kind === 'draw') return 'Nothing fits. Draw a tile from the boneyard.';
    if (g && g.opening && g.opening.human.finished && !g.opening.cpu.finished) {
      return `Your train is set. Waiting for ${cpuName(S)} to finish building.`;
    }
    return S.banner || '';
  }

  function viewBar(S) {
    const g = S.game;
    const round = g
      ? `<div class="round"><span>Round ${S.roundIndex + 1} of ${S.opts.rounds}</span><span>Engine double-${g.engine}</span></div>`
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
    const ready = !!(a && (a.kind === 'draw' || (a.kind === 'build' && a.canDraw)));
    return `<section class="opp" aria-label="Opponent and boneyard">
      <div class="cpu-hand">
        <span class="who">${cpuName(S)}</span>
        <span class="backs" aria-hidden="true">${'<i class="back"></i>'.repeat(n)}</span>
        <span class="count">${n} ${n === 1 ? 'tile' : 'tiles'}</span>
      </div>
      <button class="boneyard${ready ? ' ready' : ''}" data-action="draw" data-focus-id="draw"${ready ? '' : ' disabled'}
        aria-label="${ready ? 'Draw a tile. ' : ''}${g.boneyard.length} tiles in the boneyard">
        <span class="stack" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="count"><b>${g.boneyard.length}</b> in the boneyard</span>
        ${ready ? '<span class="cta">Draw a tile</span>' : ''}
      </button>
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
      if (hidden) return tileBackSVG('h', pop ? 'pop' : '');
      const cls = [pop ? 'pop' : '', S.revealed === id ? 'reveal' : ''].join(' ').trim();
      return tileSVG(t[0], t[1], { style, cls });
    }).join('');
    const engineTile = tileSVG(g.engine, g.engine, { style, cls: 'engine' });
    const ghost = target
      ? `<button class="ghost" data-action="playOn" data-train="${id}" data-focus-id="ghost-${id}"
           aria-label="Play ${S.selectedKey} on ${trainName(S, id).toLowerCase()}">
           ${tileSVG(targets[id].placed[0], targets[id].placed[1], { style })}<span>Play here</span></button>`
      : '';

    return `<div class="track${target ? ' target' : ''}${must ? ' must' : ''}" data-train="${id}">
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

  function viewTray(S) {
    const g = S.game, me = g.players[0];
    const a = S.awaiting;
    const moving = !!(a && (a.kind === 'move' || a.kind === 'build'));
    const playable = {};
    if (moving) a.moves.forEach(m => { playable[key(m.tile)] = true; });
    const sorted = me.hand.slice().sort((x, y) => (y[0] + y[1]) - (x[0] + x[1]) || y[0] - x[0]);
    const style = S.opts.style;
    const tiles = sorted.map(t => {
      const k = key(t);
      const mode = moving ? (playable[k] ? 'playable' : 'dim') : 'idle';
      const sel = S.selectedKey === k;
      const label = `${t[0]} and ${t[1]}${mode === 'playable' ? ', playable' : ''}${sel ? ', selected' : ''}`;
      return `<button class="tile-btn ${mode}${sel ? ' selected' : ''}${S.freshKey === k ? ' fresh' : ''}"
        data-action="selectTile" data-key="${k}" data-focus-id="t${k}" aria-pressed="${sel}"
        aria-label="${label}"${mode === 'playable' ? '' : ' disabled'}>${tileSVG(t[0], t[1], { orient: 'v', style })}</button>`;
    }).join('');
    return `<section class="tray" aria-label="Your hand">
      <div class="tray-head"><span>Your hand</span><span class="count">${me.hand.length} ${me.hand.length === 1 ? 'tile' : 'tiles'}</span></div>
      <div class="hand">${tiles}</div>
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
      <li>If nothing in your hand fits the engine, draw one tile. If it still does not fit, you pass and a lantern goes on your train.</li>
      <li>Then you take turns. Play one tile that matches the number a train needs: your own train, the Mexican train, or your opponent's train when it shows a red lantern.</li>
      <li>Nothing fits? Draw one tile. If it fits, play it. If not, you pass and a lantern goes on your train, which lets your opponent play there until you next play on it yourself.</li>
      <li>After you play a double, you must play another tile onto it straight away. If you can't, the next player has to cover it before anything else is played.</li>
      <li>Play your last tile to win the round and score 0. Otherwise you score the pips left in your hand (the 0-0 tile counts 50). A blocked round scores both players their pips. The lowest total wins.</li>
    </ul>`;

  function optionList(values, current, labeler) {
    return values.map(v => `<option value="${v}"${String(v) === String(current) ? ' selected' : ''}>${labeler(v)}</option>`).join('');
  }

  function viewSetup(S) {
    const o = S.opts;
    return `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">Mexican Train</h2>
      <p>Empty your hand before your opponent empties theirs. Play on your train, the shared Mexican train, or any train showing a lantern.</p>
      <div class="field"><label for="opt-rounds">Game length</label>
        <select id="opt-rounds">${optionList([1, 4, 13], o.rounds, v => v === 1 ? 'One round' : v === 4 ? 'Short game, 4 rounds' : 'Full game, 13 rounds')}</select></div>
      <div class="field"><label for="opt-hand">Tiles dealt to each player</label>
        <select id="opt-hand">${optionList([8, 12, 15], o.hand, v => v === 15 ? '15 (standard)' : String(v))}</select></div>
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
      <p>Lowest score wins.</p>
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

  const DEFAULT_OPTS = { rounds: 4, hand: 15, style: 'pips' };

  // Names the computer player can pick from (none ends in "s", so "Name's train" reads well).
  const CPU_NAMES = ['Marta', 'Ravi', 'Keiko', 'Omar', 'Lena', 'Mateo', 'Priya', 'Jonah', 'Aisha', 'Hiro',
    'Ingrid', 'Kofi', 'Sofia', 'Nadia', 'Dmitri', 'Lucia', 'Arjun', 'Freya', 'Bruno', 'Yara', 'Felix', 'Kwame',
    'Mei', 'Callum', 'Zainab', 'Pablo', 'Greta', 'Anil', 'Rosa', 'Tariq', 'Elsa', 'Diego', 'Noor', 'Stefan',
    'Chiara', 'Amara', 'Leon', 'Sunita', 'Odile', 'Rafael', 'Tamsin', 'Wen', 'Bea', 'Kenji', 'Imani', 'Selam', 'Paloma', 'Joon'];

  /* A random name that nobody at the table is already using. `used` holds lower-case names. */
  function pickCpuName(rng, used) {
    const free = CPU_NAMES.filter(n => !used.has(n.toLowerCase()));
    const pool = free.length ? free : CPU_NAMES;
    return pool[Math.floor(rng() * pool.length)];
  }

  // How long a person takes: [min, max] milliseconds, picked at random each time.
  const PACE = {
    firstTile: [2000, 3600],   // looking over the hand before the first tile
    nextTile: [900, 2100],     // each further tile of a train
    finish: [1100, 2300],      // a last look before saying "done"
    draw: [900, 1700],
    think: [1000, 2400],       // choosing a play on a normal turn
    settle: [450, 900],        // a beat after playing before the turn passes
  };

  function createApp(env) {
    const root = env.root;
    const rng = env.rng || Math.random;
    const paceRng = env.paceRng || Math.random;
    const storage = env.storage || { get() { return null; }, set() {} };
    const reduced = !!env.reducedMotion;
    const doSleep = env.sleep || (ms => new Promise(res => setTimeout(res, ms)));
    const ABORT = { aborted: true };
    let token = 0;

    const humanPace = kind => PACE[kind][0] + paceRng() * (PACE[kind][1] - PACE[kind][0]);

    function sanitize(o) {
      const rounds = [1, 4, 13].includes(Number(o.rounds)) ? Number(o.rounds) : DEFAULT_OPTS.rounds;
      const hand = [8, 12, 15].includes(Number(o.hand)) ? Number(o.hand) : DEFAULT_OPTS.hand;
      const style = o.style === 'numbers' ? 'numbers' : 'pips';
      return { rounds, hand, style };
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
      banner: '', log: [], lastCounts: {}, lastDialog: null,
    };
    S.opts = loadOpts();

    /* ---------- rendering ---------- */
    // While a settings/rules dialog is open, the match keeps running behind it. Re-drawing
    // the page then would wipe whatever the player is choosing, so background updates
    // are skipped; the actions that open/close dialogs pass force=true and redraw.
    function render(force) {
      if (!force && S.overlay && S.lastDialog === S.overlay) return;
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
          if (counts[id] !== S.lastCounts[id]) el.scrollLeft = el.scrollWidth;
          else if (saved[id] !== undefined) el.scrollLeft = saved[id];
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
      S.lastPlay = null;
      S.revealed = null;
    }

    function say(text) { S.banner = text; S.log.push(text); }
    function setBanner(text) { S.banner = text; }

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
          resolve: v => { S.awaiting = null; resolve(v); },
        }, extra || {});
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
      if (a) a.reject(ABORT);
    }

    /* ---------- hooks the rules engine calls ---------- */
    const ui = {
      // --- normal turns ---
      async onNeedDraw(game, player) {
        if (player.id === 'human') await awaitUser('draw');
        else { setBanner(`${cpuName(S)} has nothing to play and draws.`); render(); await pause(humanPace('draw')); }
      },
      async onDraw(game, player, tile) {
        if (player.id === 'human') { say(`You drew ${fmt(tile)}.`); S.drawnKey = key(tile); }
        else say(`${cpuName(S)} draws a tile.`);
        render();
        await pause(650);
      },
      async onPass(game, player) {
        if (player.id === 'human') {
          S.drawnKey = null;
          say(game.boneyard.length === 0
            ? 'The boneyard is empty and nothing fits. You pass and a lantern goes on your train.'
            : 'That tile does not fit. You pass and a lantern goes on your train.');
        } else {
          say(`${cpuName(S)} cannot play and passes. A lantern goes on their train: you can play there.`);
        }
        render();
        await pause(1200);
      },
      async onPlay(game, player, move, info) {
        const you = player.id === 'human';
        S.lastPlay = { trainId: move.trainId, index: game.trains[move.trainId].tiles.length - 1 };
        S.selectedKey = null; S.drawnKey = null; S.freshKey = null;
        say(`${you ? 'You played' : `${cpuName(S)} played`} ${fmt(move.tile)} on ${trainRef(S, move.trainId, player.id)}.`);
        if (info.doubleOpened) S.log.push(you ? 'A double: you must play another tile onto it.' : `A double: ${cpuName(S)} must play another tile onto it.`);
        if (info.doubleSatisfied) S.log.push('The double is covered.');
        if (player.hand.length === 1) S.log.push(you ? 'You have one tile left.' : `${cpuName(S)} has one tile left.`);
        render();
        await pause(you ? 380 : humanPace('settle'));
      },

      // --- the opening: everybody builds at once ---
      async onBuildPlay(game, player) {
        S.lastPlay = { trainId: player.id, index: game.trains[player.id].tiles.length - 1 };
        S.selectedKey = null; S.drawnKey = null; S.freshKey = null;
        render();   // no log line: the computer's tiles are face down, yours are on the board
      },
      async onBuildUndo(game, player, tile) {
        if (player.id === 'human') S.freshKey = key(tile);
        S.selectedKey = null; S.drawnKey = null;
        render();
      },
      async onBuildDraw(game, player, tile) {
        if (player.id === 'human') { say(`You drew ${fmt(tile)}.`); S.drawnKey = key(tile); S.freshKey = key(tile); }
        else S.log.push(`${cpuName(S)} draws a tile.`);
        render();
        await pause(400);
      },
      async onBuildPass(game, player) {
        if (player.id === 'human') {
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
        moves: info.moves, placed: info.placed, canUndo: info.canUndo, canDraw: info.canDraw, canDone: info.canDone,
        canBuild: chain.length > (info.canDone ? info.placed : -1), buildCount: chain.length,
      });
    }

    async function cpuAct(game, player, info) {
      const action = cpuBuildAction(game, player, info);
      const kind = action.type === 'done' ? 'finish' : action.type === 'draw' ? 'draw' : (info.placed === 0 ? 'firstTile' : 'nextTile');
      await pause(humanPace(kind));
      return action;
    }

    const controllers = {
      human: {
        act: humanAct,
        async choose(game, player, moves, drew) {
          const dk = drew ? key(drew) : null;
          // pre-select a just-drawn tile only when it has a choice of trains; otherwise one click plays it
          S.selectedKey = (dk && moves.filter(m => key(m.tile) === dk).length > 1) ? dk : null;
          return awaitUser('move', { moves });
        },
      },
      cpu: {
        act: cpuAct,
        async choose(game, player, moves) {
          setBanner(`${cpuName(S)} is thinking...`);
          render();
          await pause(humanPace('think'));
          return cpuChoose(game, player, moves);
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
        S.log = []; S.selectedKey = null; S.drawnKey = null; S.freshKey = null; S.lastPlay = null; S.plan = null;
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
      S.opts = sanitize(a);
      saveOpts();
      // a fresh random name for the computer: not one already at the table, and not last game's
      let previous = '';
      try { previous = String(storage.get('mt-last-cpu') || ''); } catch (e) { /* ignore */ }
      S.cpuName = pickCpuName(rng, new Set(['you', previous.toLowerCase()]));
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
        if (mv) a.resolve({ type: 'play', move: mv });
        return;
      }
      if (a.kind !== 'move') return;
      const mine = a.moves.filter(m => key(m.tile) === k);
      if (!mine.length) return;
      // Only one place this tile can go: just play it, no need to ask where.
      if (mine.length === 1) { S.selectedKey = null; a.resolve(mine[0]); return; }
      S.selectedKey = S.selectedKey === k ? null : k;
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
        case 'toggleStyle': S.opts.style = S.opts.style === 'numbers' ? 'pips' : 'numbers'; saveOpts(); return render(true);
        case 'boot': return render(true);
        default: return undefined;
      }
    }

    return { dispatch, render, state: S, ui, controllers, sanitize };
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
    const app = createApp({
      root, storage, reducedMotion: reduced,
      rng: seed !== null && seed !== '' ? mulberry32(Number(seed)) : Math.random,
    });

    root.addEventListener('click', e => {
      const el = e.target.closest ? e.target.closest('[data-action]') : null;
      if (el) {
        const d = el.dataset;
        if (d.action === 'startGame') {
          const val = id => { const n = root.querySelector(id); return n ? n.value : undefined; };
          app.dispatch({ type: 'startGame', rounds: val('#opt-rounds'), hand: val('#opt-hand'), style: val('#opt-style') });
        } else {
          app.dispatch({ type: d.action, key: d.key, train: d.train });
        }
        return;
      }
      const track = e.target.closest ? e.target.closest('.track.target') : null;
      if (track) app.dispatch({ type: 'playOn', train: track.dataset.train });
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') app.dispatch({ type: 'closeOverlay' }); });

    app.dispatch({ type: 'boot' });
    global.MexicanTrainApp = app;
  }

  global.MexicanTrainGame = {
    Engine: {
      newRound, legalMoves, applyMove, undoLast, playTurn, buildPhase, playRound, isBlocked, cpuChoose,
      cpuBuildAction, longestChain, longestFullChain, buildSteps, handPips, tilePips, mulberry32, shuffle, key,
    },
    tileSVG, tileBackSVG, pipPoints, viewApp, createApp, pickCpuName, PIP_COLORS, PACE, CPU_NAMES,
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
