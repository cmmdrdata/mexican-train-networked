'use strict';
/**
 * An authoritative Mexican Train match between two human players, for the game server.
 *
 * The rules are the game's own engine (game.js), run on the server. Each player is a "seat" (0 or 1)
 * that sends INTENTS ("play 5-7 on the Mexican train", "draw", "done"...). Every intent is checked
 * against what the rules allow right now; anything else changes nothing.
 *
 * Each player is sent a VIEW built for them, shaped like the game state the page already knows how
 * to draw ("you" are always the human seat, the other player is the opponent), and containing only
 * what they could see at a real table: their own hand in full, the opponent's hand and the boneyard
 * as counts, and the opponent's train as face-down placeholders until they finish building it (only
 * whether each tile is a double shows, as it does in the single-player game). Neither player's
 * browser ever receives a tile it should not see, the host's included.
 *
 *   const m = new OnlineMatch({ rounds: 4, hand: 15, names: ['Ann', 'Ben'], push(seat, msg) {...} });
 *   m.start();                 // runs the rounds; resolves when the match is over or aborted
 *   m.intent(seat, { a: 'play', tile: [5, 7], train: 'mexican' });
 *   m.viewFor(seat);           // the full current view (used for reconnecting)
 */
require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { newRound, playRound, longestFullChain, buildSteps, handPips, key, mulberry32 } = E;

const MAX_PIP = 12;
const SEATS = ['human', 'cpu'];               // the engine's two player ids: seat 0 and seat 1
const ABORT = { aborted: true };

// stand-ins for tiles the receiving player may not see: only "is it a double" is meaningful
const HIDDEN_DOUBLE = [-1, -1], HIDDEN_PLAIN = [-1, -2];

const sameTile = (a, b) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
const isTile = t => Array.isArray(t) && t.length === 2 && t.every(n => Number.isInteger(n) && n >= 0 && n <= MAX_PIP);
const fmt = t => t[0] + '-' + t[1];

/* Names and quick phrases are defined once, in game.js, and used by both the page and the server. */
const cleanName = G.cleanPlayerName;
const CHAT_PHRASES = G.ONLINE_PHRASES;

class OnlineMatch {
  constructor(opts) {
    this.rounds = [1, 4, 13].includes(Number(opts.rounds)) ? Number(opts.rounds) : 4;
    this.hand = [8, 12, 15].includes(Number(opts.hand)) ? Number(opts.hand) : 15;
    this.names = [cleanName(opts.names && opts.names[0], 'Player 1'), cleanName(opts.names && opts.names[1], 'Player 2')];
    this.rng = opts.rng || Math.random;
    this.push = opts.push || (() => {});
    this.sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.stepDelay = opts.stepDelay === undefined ? 90 : opts.stepDelay;   // between the plays of "Build my longest train"
    this.seq = 0;
    this.totals = { human: 0, cpu: 0 };
    this.roundIndex = 0;
    this.startIndex = 0;
    this.game = null;
    this.awaiting = [null, null];
    this.plans = [null, null];
    this.logs = [[], []];
    this.banners = ['', ''];
    this.modal = null;
    this.modalOk = [false, false];
    this.paused = false;
    this.over = null;                       // null while running; 'finished', 'aborted' or 'error'
    this.error = null;
    this.done = null;
    this.controllers = { human: this._controller(0), cpu: this._controller(1) };
    this.hooks = this._makeHooks();
  }

  /* ------------------------------ running the match ------------------------------ */
  start() {
    this.done = this._run().catch(err => {
      if (err === ABORT) { this.over = this.over || 'aborted'; return; }
      this.over = 'error'; this.error = err;                  // a fault in the game: free anyone waiting, and tell both players
      this.awaiting.forEach(a => { if (a) a.reject(ABORT); });
      this.awaiting = [null, null];
      this._broadcast([[], []]);
    });
    return this.done;
  }
  abort() {
    if (this.over) return;
    this.over = 'aborted';
    this.awaiting.forEach(a => { if (a) a.reject(ABORT); });
    this.awaiting = [null, null];
  }
  setPaused(on) { this.paused = !!on; this._broadcast([[], []]); }

  async _run() {
    let startIndex = this.rng() < 0.5 ? 0 : 1;
    for (let r = 0; r < this.rounds; r++) {
      this.roundIndex = r; this.startIndex = startIndex;
      const engine = MAX_PIP - r;
      this.game = newRound({ engine, handSize: this.hand, rng: this.rng, simultaneousOpening: true });
      this.game.players[0].name = this.names[0]; this.game.players[1].name = this.names[1];
      this.logs = [[], []]; this.plans = [null, null]; this.modal = null;
      this._say(() => `Round ${r + 1}: the engine is double-${engine}. Everyone builds their train at the same time.`);
      this._log(seat => `${startIndex === seat ? 'You play' : `${this.names[1 - seat]} plays`} first once the trains are built.`);
      this._broadcast([[], []]);

      const result = await playRound(this.game, startIndex, this.controllers, this.hooks);
      this._say(seat => result.blocked ? 'The round is blocked.'
        : result.tie ? 'You both played every tile.'
        : `${SEATS[seat] === result.winner.id ? 'You' : this.names[1 - seat]} played the last tile.`);
      const rows = this.game.players.map(p => ({ id: p.id, name: p.name, hand: p.hand.map(t => t.slice()), pips: handPips(p) }));
      rows.forEach(row => { this.totals[row.id] += row.pips; });
      this._broadcast([[], []]);
      await this._modal({
        type: 'roundEnd', blocked: result.blocked, tie: !!result.tie, winnerId: result.winner ? result.winner.id : null,
        rows, totals: { human: this.totals.human, cpu: this.totals.cpu }, last: r === this.rounds - 1,
      });
      startIndex = 1 - startIndex;
    }
    this.modal = { type: 'final', totals: { human: this.totals.human, cpu: this.totals.cpu } };
    this.over = 'finished';
    this._broadcast([[], []]);
  }

  /* Wait until a seat sends the intent that answers `kind`. Resolves with the engine-shaped answer. */
  _wait(seat, kind, extra) {
    return new Promise((resolve, reject) => {
      if (this.over) return reject(ABORT);
      this.awaiting[seat] = Object.assign({ kind, reject, resolve: v => { this.awaiting[seat] = null; resolve(v); } }, extra || {});
      this._broadcast([[], []]);
    });
  }
  async _modal(modal) {
    this.modal = modal; this.modalOk = [false, false];
    await Promise.all([0, 1].map(seat => this._wait(seat, 'modal')));
    this.modal = null;
  }

  /* ------------------------------ the players, as the engine sees them ------------------------------ */
  _controller(seat) {
    return {
      act: (game, player, info) => this._act(seat, game, player, info),
      choose: (game, player, moves) => {
        this.banners[1 - seat] = `${this.names[seat]} is choosing a tile.`;
        return this._wait(seat, 'move', { moves });
      },
    };
  }
  async _act(seat, game, player, info) {
    // "Build my longest train" in progress: carry out its take-backs and plays one by one
    while (this.plans[seat] && this.plans[seat].length) {
      const step = this.plans[seat].shift();
      if (step.type === 'undo') {
        if (info.canUndo) { await this.sleep(this.stepDelay); return { type: 'undo' }; }
      } else {
        const mv = info.moves.find(m => key(m.tile) === step.key);
        if (mv) { await this.sleep(this.stepDelay); return { type: 'play', move: mv }; }
      }
      this.plans[seat] = null;              // something unexpected: hand control back to the player
    }
    this.plans[seat] = null;
    const chain = longestFullChain(game, player);
    return this._wait(seat, 'build', { info, canBuild: chain.length > (info.canDone ? info.placed : -1), buildCount: chain.length });
  }
  _seat(player) { return SEATS.indexOf(player.id); }

  /* ------------------------------ what happens, told to each player in their own words ------------------------------ */
  _say(fn) { for (const seat of [0, 1]) { const t = fn(seat); this.banners[seat] = t; this.logs[seat].push(t); } }
  _log(fn) { for (const seat of [0, 1]) this.logs[seat].push(fn(seat)); }
  _logOne(seat, text) { this.logs[seat].push(text); this.banners[seat] = text; }

  _trainRef(seat, trainId, actorSeat) {
    if (trainId === 'mexican') return 'the Mexican train';
    const owner = SEATS.indexOf(trainId);
    if (seat === actorSeat) return owner === seat ? 'your train' : `${this.names[owner]}'s train`;
    return owner === actorSeat ? 'their own train' : 'your train';
  }

  _makeHooks() {
    const m = this;
    return {
      // --- normal turns ---
      async onNeedDraw(game, player) {
        const seat = m._seat(player);
        m.banners[1 - seat] = player.hand.length === 0
          ? `${m.names[seat]} played a double as their last tile. It cannot go out, so they draw to cover it.`
          : `${m.names[seat]} has nothing to play and draws.`;
        await m._wait(seat, 'draw');
      },
      async onDraw(game, player, tile) {
        const seat = m._seat(player);
        m._logOne(seat, `You drew ${fmt(tile)}.`);
        m._logOne(1 - seat, `${m.names[seat]} draws a tile.`);
        const ev = [[], []];
        ev[seat].push({ e: 'draw', who: 'me', tile: tile.slice() });
        ev[1 - seat].push({ e: 'draw', who: 'opp' });
        m._broadcast(ev);
      },
      async onPass(game, player) {
        const seat = m._seat(player);
        m._logOne(seat, player.hand.length === 0
          ? 'The boneyard is empty, so you cannot draw to cover your double. You pass. Once it is covered, you have gone out.'
          : game.boneyard.length === 0
            ? 'The boneyard is empty and nothing fits. You pass and a lantern goes on your train.'
            : 'That tile does not fit. You pass and a lantern goes on your train.');
        m._logOne(1 - seat, player.hand.length === 0
          ? `${m.names[seat]} cannot draw to cover their double and passes. Once it is covered, they have gone out.`
          : `${m.names[seat]} cannot play and passes. A lantern goes on their train: you can play there.`);
        const ev = [[], []];
        ev[0].push({ e: 'pass', who: seat === 0 ? 'me' : 'opp' }); ev[1].push({ e: 'pass', who: seat === 1 ? 'me' : 'opp' });
        m._broadcast(ev);
      },
      async onPlay(game, player, move, info) {
        const seat = m._seat(player);
        for (const s of [0, 1]) {
          const mine = s === seat;
          m._logOne(s, `${mine ? 'You played' : `${m.names[seat]} played`} ${fmt(move.tile)} on ${m._trainRef(s, move.trainId, seat)}.`);
          if (info.lastTileDouble) m.logs[s].push(mine
            ? 'That was your last tile, but a double cannot go out. Draw a tile to try to cover it.'
            : `That was ${m.names[seat]}'s last tile, but a double cannot go out. They must draw a tile to try to cover it.`);
          else if (info.doubleOpened) m.logs[s].push(mine ? 'A double: you must play another tile onto it.' : `A double: ${m.names[seat]} must play another tile onto it.`);
          if (info.doubleSatisfied) m.logs[s].push('The double is covered.');
          if (player.hand.length === 1) m.logs[s].push(mine ? 'You have one tile left.' : `${m.names[seat]} has one tile left.`);
        }
        m._broadcast(m._playEvents(seat, move, game.trains[move.trainId].tiles.length - 1, false));
      },

      // --- the opening: everybody builds at once ---
      async onBuildPlay(game, player, move) {
        const seat = m._seat(player);
        m._broadcast(m._playEvents(seat, move, game.trains[player.id].tiles.length - 1, true));
      },
      async onBuildUndo(game, player) {
        const seat = m._seat(player);
        const ev = [[], []];
        ev[seat].push({ e: 'undo', who: 'me' }); ev[1 - seat].push({ e: 'undo', who: 'opp' });
        m._broadcast(ev);
      },
      async onBuildDraw(game, player, tile) {
        const seat = m._seat(player);
        m._logOne(seat, `You drew ${fmt(tile)}.`);
        m.logs[1 - seat].push(`${m.names[seat]} draws a tile.`);
        const ev = [[], []];
        ev[seat].push({ e: 'draw', who: 'me', tile: tile.slice() });
        ev[1 - seat].push({ e: 'draw', who: 'opp' });
        m._broadcast(ev);
      },
      async onBuildPass(game, player) {
        const seat = m._seat(player);
        m._logOne(seat, game.boneyard.length === 0 && !game.opening[player.id].drew
          ? 'The boneyard is empty and nothing fits the engine. You pass and a lantern goes on your train.'
          : 'Nothing fits the engine. You pass and a lantern goes on your train.');
        m.logs[1 - seat].push(`${m.names[seat]} cannot start a train and passes. A lantern goes on their train: you can play there.`);
        const ev = [[], []];
        ev[0].push({ e: 'pass', who: seat === 0 ? 'me' : 'opp' }); ev[1].push({ e: 'pass', who: seat === 1 ? 'me' : 'opp' });
        ev[1 - seat].push({ e: 'reveal' });
        m._broadcast(ev);
      },
      async onBuildDone(game, player, count) {
        const seat = m._seat(player);
        m.plans[seat] = null;
        m.logs[seat].push(`You finished a train of ${count} ${count === 1 ? 'tile' : 'tiles'}.`);
        m.logs[1 - seat].push(`${m.names[seat]} finished a train of ${count} ${count === 1 ? 'tile' : 'tiles'}.`);
        const ev = [[], []];
        ev[1 - seat].push({ e: 'reveal' });
        m._broadcast(ev);
      },
      async onOpeningDone(game) {
        m._say(seat => `All trains are built. ${m.startIndex === seat ? 'You play' : `${m.names[1 - seat]} plays`} first.`);
        m._broadcast([[], []]);
      },
    };
  }

  /* The "a tile was played" event, for each player. In the opening the opponent's tile stays secret. */
  _playEvents(seat, move, index, opening) {
    const ev = [[], []];
    const trainFor = s => (move.trainId === 'mexican' ? 'mexican' : SEATS[s] === move.trainId ? 'human' : 'cpu');
    const isDouble = move.tile[0] === move.tile[1];
    ev[seat].push({ e: 'play', who: 'me', train: trainFor(seat), index, placed: move.placed.slice(), tile: move.tile.slice(), hidden: false });
    ev[1 - seat].push({
      e: 'play', who: 'opp', train: trainFor(1 - seat), index,
      placed: opening ? (isDouble ? HIDDEN_DOUBLE : HIDDEN_PLAIN).slice() : move.placed.slice(),
      tile: opening ? null : move.tile.slice(), hidden: !!opening,
    });
    return ev;
  }

  /* ------------------------------ sending views ------------------------------ */
  _broadcast(events) {
    const seq = ++this.seq;
    for (const seat of [0, 1]) this.push(seat, { t: 'state', seq, view: this.viewFor(seat), events: events[seat] || [] });
  }

  viewFor(seat) {
    const meId = SEATS[seat], oppId = SEATS[1 - seat];
    const cid = id => (id === 'mexican' ? 'mexican' : id === meId ? 'human' : 'cpu');
    const flipTotals = t => ({ human: t[meId], cpu: t[oppId] });
    const g = this.game;
    const aw = this.awaiting[seat];
    let awaiting = null;
    if (aw) {
      const flipMove = mv => ({ tile: mv.tile.slice(), trainId: cid(mv.trainId), placed: mv.placed.slice(), newEnd: mv.newEnd });
      if (aw.kind === 'build') {
        const i = aw.info;
        awaiting = { kind: 'build', moves: i.moves.map(flipMove), placed: i.placed, canUndo: !!i.canUndo, canDraw: !!i.canDraw, canDone: !!i.canDone, lastDouble: !!i.lastDouble, canBuild: !!aw.canBuild, buildCount: aw.buildCount };
      } else if (aw.kind === 'move') awaiting = { kind: 'move', moves: aw.moves.map(flipMove) };
      else awaiting = { kind: aw.kind };
    }
    let modal = null;
    if (this.modal && (this.modal.type === 'final' || !this.modalOk[seat])) {
      const md = this.modal;
      if (md.type === 'final') modal = { type: 'final', totals: flipTotals(md.totals) };
      else {
        const order = [meId, oppId];
        modal = {
          type: 'roundEnd', blocked: md.blocked, tie: md.tie, winnerId: md.winnerId ? cid(md.winnerId) : null,
          rows: order.map(id => { const r = md.rows.find(x => x.id === id); return { id: cid(id), name: id === meId ? 'You' : r.name, hand: r.hand.map(t => t.slice()), pips: r.pips }; }),
          totals: flipTotals(md.totals), last: md.last,
        };
      }
    }
    const view = {
      seq: this.seq, round: this.roundIndex, rounds: this.rounds,
      me: { name: this.names[seat] }, opp: { name: this.names[1 - seat] },
      totals: flipTotals(this.totals), paused: this.paused, over: this.over,
      log: this.logs[seat].slice(-8), banner: this.banners[seat], modal, awaiting, game: null,
    };
    if (!g) return view;
    const me = g.players.find(p => p.id === meId), opp = g.players.find(p => p.id === oppId);
    const hiddenOpp = !!g.opening && !g.opening[oppId].finished;
    const train = (t, hide) => ({
      id: cid(t.id), marker: !!t.marker,
      tiles: t.tiles.map(x => (hide ? (x[0] === x[1] ? HIDDEN_DOUBLE : HIDDEN_PLAIN).slice() : x.slice())),
      end: hide ? 0 : t.end,
    });
    view.game = {
      engine: g.engine,
      players: [
        { id: 'human', name: 'You', hand: me.hand.map(t => t.slice()) },
        { id: 'cpu', name: this.names[1 - seat], hand: opp.hand.map(() => HIDDEN_DOUBLE.slice()) },
      ],
      boneyard: g.boneyard.map(() => HIDDEN_DOUBLE.slice()),
      trains: { human: train(g.trains[meId], false), cpu: train(g.trains[oppId], hiddenOpp), mexican: train(g.trains.mexican, false) },
      openDouble: g.openDouble ? { trainId: cid(g.openDouble.trainId), value: g.openDouble.value } : null,
      opening: g.opening ? {
        human: { finished: g.opening[meId].finished, drew: g.opening[meId].drew, lastDrew: g.opening[meId].lastDrew ? g.opening[meId].lastDrew.slice() : null },
        cpu: { finished: g.opening[oppId].finished, drew: g.opening[oppId].drew, lastDrew: null },
      } : null,
    };
    return view;
  }

  /* ------------------------------ intents ------------------------------ */
  intent(seat, msg) {
    const bad = (code, message) => ({ ok: false, code, message });
    if (this.over) return bad('over', 'The game is over.');
    if (!msg || typeof msg !== 'object') return bad('bad_message', 'That was not understood.');
    if (this.paused) return bad('paused', 'The game is paused.');
    const aw = this.awaiting[seat];
    if (!aw) return bad('not_now', 'It is not your turn to act.');
    const a = msg.a;
    const engineTrain = id => (id === 'mexican' ? 'mexican' : id === 'human' ? SEATS[seat] : id === 'cpu' ? SEATS[1 - seat] : null);
    const findMove = moves => {
      if (!isTile(msg.tile)) return null;
      const tid = engineTrain(msg.train);
      return tid ? moves.find(m => sameTile(m.tile, msg.tile) && m.trainId === tid) || null : null;
    };
    switch (aw.kind) {
      case 'build': {
        const i = aw.info;
        if (a === 'play') { const mv = findMove(i.moves); if (!mv) return bad('illegal', 'You cannot play that tile there.'); aw.resolve({ type: 'play', move: mv }); return { ok: true }; }
        if (a === 'undo') { if (!i.canUndo) return bad('illegal', 'There is nothing to take back.'); aw.resolve({ type: 'undo' }); return { ok: true }; }
        if (a === 'draw') { if (!i.canDraw) return bad('illegal', 'You cannot draw now.'); aw.resolve({ type: 'draw' }); return { ok: true }; }
        if (a === 'done') { if (!i.canDone) return bad('illegal', 'Cover the double or take it back first.'); aw.resolve({ type: 'done' }); return { ok: true }; }
        if (a === 'autoBuild') {
          if (!aw.canBuild) return bad('illegal', 'There is no longer train to build.');
          const player = this.game.players[seat];
          const steps = buildSteps(this.game, player);
          if (!steps.length) return bad('illegal', 'There is no longer train to build.');
          const first = steps.shift();
          let action;
          if (first.type === 'undo') action = { type: 'undo' };
          else { const mv = i.moves.find(m => key(m.tile) === first.key); if (!mv) return bad('illegal', 'That train cannot be built now.'); action = { type: 'play', move: mv }; }
          this.plans[seat] = steps;
          this._logOne(seat, 'Building your longest train...');
          aw.resolve(action);
          return { ok: true };
        }
        return bad('bad_message', 'That is not something you can do right now.');
      }
      case 'move': {
        if (a !== 'play') return bad('bad_message', 'Play a tile.');
        const mv = findMove(aw.moves);
        if (!mv) return bad('illegal', 'You cannot play that tile there.');
        aw.resolve(mv);
        return { ok: true };
      }
      case 'draw':
        if (a !== 'draw') return bad('bad_message', 'Draw a tile.');
        aw.resolve();
        return { ok: true };
      case 'modal':
        if (a !== 'ok') return bad('bad_message', 'Press OK to go on.');
        this.modalOk[seat] = true;
        this._logOne(seat, this.modal && this.modal.last ? 'Waiting for the final score.' : `Waiting for ${this.names[1 - seat]} to be ready for the next round.`);
        aw.resolve();
        this._broadcast([[], []]);                              // her dialog goes away at once and she sees she is waiting
        return { ok: true };
      default:
        return bad('bad_message', 'That is not something you can do right now.');
    }
  }
}

module.exports = { OnlineMatch, cleanName, CHAT_PHRASES, HIDDEN_DOUBLE, HIDDEN_PLAIN, sameTile, SEATS };
