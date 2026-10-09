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
const { newRound, playRound, longestFullChain, buildSteps, handPips, key, legalMoves, cpuChoose, cpuBuildAction } = E;

const MAX_PIP = 12;
const SEATS = G.PLAYER_IDS;                   // the engine's player ids: seat 0 "human", seat 1 "cpu", seat 2 "cpu2"
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
  /* opts: rounds, hand, names (two or three; with three, the third seat is the computer when `computer` is
   * given), computer: { level } | undefined, rng, push(seat, message), sleep(ms), paceRng, and stepDelay: the pause between
   * the tiles of "Build my longest train", either a number of milliseconds or a [min, max] range to pick from at random
   * (default 0.5 to 3 seconds, so the others see the train go down at a person's pace). */
  constructor(opts) {
    this.rounds = [1, 4, 13].includes(Number(opts.rounds)) ? Number(opts.rounds) : 4;
    this.hand = [8, 12, 15].includes(Number(opts.hand)) ? Number(opts.hand) : 15;
    this.n = opts.names && opts.names.length === 3 ? 3 : 2;
    this.names = Array.from({ length: this.n }, (_, i) => cleanName(opts.names && opts.names[i], `Player ${i + 1}`));
    this.computers = {};                                   // seat -> { level }: seats played by the computer
    if (this.n === 3 && opts.computer) this.computers[2] = { level: E.LEVELS.includes(opts.computer.level) ? opts.computer.level : 'normal' };
    this.humans = [];
    for (let i = 0; i < this.n; i++) if (!this.computers[i]) this.humans.push(i);
    this.rng = opts.rng || Math.random;
    this.paceRng = opts.paceRng || Math.random;            // kept apart from the deal, as in the game against the computer
    this.push = opts.push || (() => {});
    this.sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.stepDelay = opts.stepDelay === undefined ? [500, 3000] : opts.stepDelay;   // between the plays of "Build my longest train"
    this.seq = 0;
    this.totals = {};
    SEATS.slice(0, this.n).forEach(id => { this.totals[id] = 0; });
    this.roundIndex = 0;
    this.startIndex = 0;
    this.game = null;
    const blank = f => Array.from({ length: this.n }, f);
    this.awaiting = blank(() => null);
    this.plans = blank(() => null);
    this.logs = blank(() => []);
    this.banners = blank(() => '');
    this.modal = null;
    this.modalOk = blank(() => false);
    this.paused = false;
    this.over = null;                       // null while running; 'finished', 'aborted' or 'error'
    this.error = null;
    this.done = null;
    this.controllers = {};
    SEATS.slice(0, this.n).forEach((id, seat) => { this.controllers[id] = this._controller(seat); });
    this.hooks = this._makeHooks();
  }

  /* The other seats as seen from `seat`, in table order: the first is that player's "cpu", the second their "cpu2". */
  others(seat) { const out = []; for (let k = 1; k < this.n; k++) out.push((seat + k) % this.n); return out; }
  /* The id a train or player has on `viewer`'s screen: "human" for themselves, then "cpu" and "cpu2", or "mexican". */
  cid(viewer, engineId) {
    if (engineId === 'mexican') return 'mexican';
    const seat = SEATS.indexOf(engineId);
    return seat === viewer ? 'human' : (this.others(viewer).indexOf(seat) === 0 ? 'cpu' : 'cpu2');
  }
  who(viewer, actor) { return actor === viewer ? 'me' : (this.others(viewer).indexOf(actor) === 0 ? 'opp' : 'opp2'); }
  noEvents() { return Array.from({ length: this.n }, () => []); }

  /* ------------------------------ running the match ------------------------------ */
  start() {
    this.done = this._run().catch(err => {
      if (err === ABORT) { this.over = this.over || 'aborted'; return; }
      this.over = 'error'; this.error = err;                  // a fault in the game: free anyone waiting, and tell the players
      this.awaiting.forEach(a => { if (a) a.reject(ABORT); });
      this.awaiting = this.awaiting.map(() => null);
      this._broadcast(this.noEvents());
    });
    return this.done;
  }
  abort() {
    if (this.over) return;
    this.over = 'aborted';
    this.awaiting.forEach(a => { if (a) a.reject(ABORT); });
    this.awaiting = this.awaiting.map(() => null);
  }
  setPaused(on) { this.paused = !!on; this._broadcast(this.noEvents()); }

  async _run() {
    let startIndex = this.n === 2 ? (this.rng() < 0.5 ? 0 : 1) : Math.floor(this.rng() * this.n);
    for (let r = 0; r < this.rounds; r++) {
      this.roundIndex = r; this.startIndex = startIndex;
      const engine = MAX_PIP - r;
      this.game = newRound({ engine, handSize: this.hand, rng: this.rng, simultaneousOpening: true, players: this.n });
      this.game.players.forEach((p, i) => { p.name = this.names[i]; });
      this.logs = this.logs.map(() => []); this.plans = this.plans.map(() => null); this.modal = null;
      this._say(() => `Round ${r + 1}: the engine is double-${engine}. Everyone builds their train at the same time.`);
      this._log(seat => `${startIndex === seat ? 'You play' : `${this.names[startIndex]} plays`} first once the trains are built.`);
      this._broadcast(this.noEvents());

      const result = await playRound(this.game, startIndex, this.controllers, this.hooks);
      const winnerSeat = result.winner ? SEATS.indexOf(result.winner.id) : -1;
      this._say(seat => result.blocked ? 'The round is blocked.'
        : result.tie ? (this.n === 2 ? 'You both played every tile.' : 'More than one of you played every tile.')
        : `${winnerSeat === seat ? 'You' : this.names[winnerSeat]} played the last tile.`);
      const rows = this.game.players.map(p => ({ id: p.id, name: p.name, hand: p.hand.map(t => t.slice()), pips: handPips(p) }));
      rows.forEach(row => { this.totals[row.id] += row.pips; });
      this._broadcast(this.noEvents());
      await this._modal({
        type: 'roundEnd', blocked: result.blocked, tie: !!result.tie, winnerId: result.winner ? result.winner.id : null,
        rows, totals: Object.assign({}, this.totals), last: r === this.rounds - 1,
      });
      startIndex = (startIndex + 1) % this.n;
    }
    this.modal = { type: 'final', totals: Object.assign({}, this.totals) };
    this.over = 'finished';
    this._broadcast(this.noEvents());
  }

  /* Wait until a seat sends the intent that answers `kind`. Resolves with the engine-shaped answer. */
  _wait(seat, kind, extra) {
    return new Promise((resolve, reject) => {
      if (this.over) return reject(ABORT);
      this.awaiting[seat] = Object.assign({ kind, reject, resolve: v => { this.awaiting[seat] = null; resolve(v); } }, extra || {});
      this._broadcast(this.noEvents());
    });
  }
  async _modal(modal) {
    this.modal = modal;
    this.modalOk = this.modalOk.map((_, seat) => !!this.computers[seat]);   // the computer is always ready for the next round
    await Promise.all(this.humans.map(seat => this._wait(seat, 'modal')));
    this.modal = null;
  }

  /* The computer thinks for as long as a person would. While the game is paused (a player dropped) it waits. */
  async _pauseFor(ms) {
    await this.sleep(Math.round(ms));
    while (this.paused && !this.over) await new Promise(r => setTimeout(r, 40));
    if (this.over) throw ABORT;
  }
  _think(kind) { return this._pauseFor(G.paceFor(kind, this.paceRng())); }
  /* How long to wait before the next tile of "Build my longest train": random, like a person laying them down. */
  _stepMs() { const d = this.stepDelay; return Array.isArray(d) ? d[0] + this.paceRng() * (d[1] - d[0]) : Number(d) || 0; }

  /* ------------------------------ the players, as the engine sees them ------------------------------ */
  _controller(seat) {
    const cpu = this.computers[seat];
    if (cpu) {
      return {
        act: async (game, player, info) => {
          const action = cpuBuildAction(game, player, info, cpu.level);
          await this._think(action.type === 'done' ? 'finish' : action.type === 'draw' ? 'draw' : 'place');
          return action;
        },
        choose: async (game, player, moves) => {
          if (game.openDouble) return cpuChoose(game, player, moves, cpu.level);     // a cover is played at once, with no thinking time
          this.humans.forEach(s => { this.banners[s] = `${this.names[seat]} is thinking...`; });
          this._broadcast(this.noEvents());
          await this._think('place');
          return cpuChoose(game, player, moves, cpu.level);
        },
      };
    }
    return {
      act: (game, player, info) => this._act(seat, game, player, info),
      choose: (game, player, moves) => {
        this.others(seat).forEach(s => { if (!this.computers[s]) this.banners[s] = `${this.names[seat]} is choosing a tile.`; });
        return this._wait(seat, 'move', { moves });
      },
    };
  }
  async _act(seat, game, player, info) {
    // "Build my longest train" in progress: carry out its take-backs and plays one by one
    while (this.plans[seat] && this.plans[seat].length) {
      const step = this.plans[seat].shift();
      if (step.type === 'undo') {
        if (info.canUndo) { await this._pauseFor(this._stepMs()); return { type: 'undo' }; }
      } else {
        const mv = info.moves.find(m => key(m.tile) === step.key);
        if (mv) { await this._pauseFor(this._stepMs()); return { type: 'play', move: mv }; }
      }
      this.plans[seat] = null;              // something unexpected: hand control back to the player
    }
    this.plans[seat] = null;
    const chain = longestFullChain(game, player);
    return this._wait(seat, 'build', { info, canBuild: chain.length > (info.canDone ? info.placed : -1), buildCount: chain.length });
  }
  _seat(player) { return SEATS.indexOf(player.id); }

  /* ------------------------------ what happens, told to each player in their own words ------------------------------ */
  _say(fn) { for (const seat of this.humans) { const t = fn(seat); this.banners[seat] = t; this.logs[seat].push(t); } }
  _log(fn) { for (const seat of this.humans) this.logs[seat].push(fn(seat)); }
  _logOne(seat, text) { this.logs[seat].push(text); this.banners[seat] = text; }
  _tell(except, text) { for (const seat of this.humans) if (seat !== except) this._logOne(seat, text); }   // everybody but one player
  _tellLog(except, text) { for (const seat of this.humans) if (seat !== except) this.logs[seat].push(text); }

  _trainRef(viewer, trainId, actor) {
    if (trainId === 'mexican') return 'the Mexican train';
    const owner = SEATS.indexOf(trainId);
    if (viewer === actor) return owner === viewer ? 'your train' : `${this.names[owner]}'s train`;
    return owner === actor ? 'their own train' : owner === viewer ? 'your train' : `${this.names[owner]}'s train`;
  }

  _makeHooks() {
    const m = this;
    const cpuPause = async (seat, kind) => { if (m.computers[seat]) await m._think(kind); };
    return {
      // --- normal turns ---
      async onNeedDraw(game, player) {
        const seat = m._seat(player);
        // A person who has nothing to play is not announced to the others (it would tell them what is in that hand before the
        // person has even drawn): they see the same line as for any other turn. The draw itself, once it happens, is public.
        // (A double played as the last tile is different: everybody can see the hand is empty. And the computer is just told.)
        const text = player.hand.length === 0
          ? `${m.names[seat]} played a double as their last tile. It cannot go out, so they draw to cover it.`
          : m.computers[seat] ? `${m.names[seat]} has nothing to play and draws.` : `${m.names[seat]} is choosing a tile.`;
        for (const s of m.humans) if (s !== seat) m.banners[s] = text;
        if (m.computers[seat]) { m._broadcast(m.noEvents()); await m._think('draw'); }
        else await m._wait(seat, 'draw');
      },
      async onDraw(game, player, tile) {
        const seat = m._seat(player);
        if (!m.computers[seat]) m._logOne(seat, `You drew ${fmt(tile)}.`);
        m._tell(seat, `${m.names[seat]} draws a tile.`);
        const ev = m.noEvents();
        for (const s of m.humans) ev[s].push(s === seat ? { e: 'draw', who: 'me', tile: tile.slice() } : { e: 'draw', who: m.who(s, seat) });
        m._broadcast(ev);
        if (m.computers[seat]) await m.sleep(650);
      },
      async onPass(game, player) {
        const seat = m._seat(player);
        if (!m.computers[seat]) m._logOne(seat, player.hand.length === 0
          ? 'The boneyard is empty, so you cannot draw to cover your double. You pass. Once it is covered, you have gone out.'
          : game.boneyard.length === 0
            ? 'The boneyard is empty and nothing fits. You pass and a marker goes on your train.'
            : 'That tile does not fit. You pass and a marker goes on your train.');
        m._tell(seat, player.hand.length === 0
          ? `${m.names[seat]} cannot draw to cover their double and passes. Once it is covered, they have gone out.`
          : `${m.names[seat]} cannot play and passes. A marker goes on their train: you can play there.`);
        const ev = m.noEvents();
        for (const s of m.humans) ev[s].push({ e: 'pass', who: m.who(s, seat) });
        m._broadcast(ev);
        await cpuPause(seat, 'draw');
      },
      async onPlay(game, player, move, info) {
        const seat = m._seat(player);
        for (const s of m.humans) {
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
        // a cover that can be played straight away needs no pause, for anyone
        const coverNow = info.doubleOpened && !info.lastTileDouble && legalMoves(game, player).length > 0;
        if (!coverNow) await cpuPause(seat, 'settle');
      },

      // --- the opening: everybody builds at once ---
      async onBuildPlay(game, player, move) {
        const seat = m._seat(player);
        m._broadcast(m._playEvents(seat, move, game.trains[player.id].tiles.length - 1, true));
      },
      async onBuildUndo(game, player) {
        const seat = m._seat(player);
        const ev = m.noEvents();
        for (const s of m.humans) ev[s].push({ e: 'undo', who: m.who(s, seat) });
        m._broadcast(ev);
      },
      async onBuildDraw(game, player, tile) {
        const seat = m._seat(player);
        if (!m.computers[seat]) m._logOne(seat, `You drew ${fmt(tile)}.`);
        m._tellLog(seat, `${m.names[seat]} draws a tile.`);
        const ev = m.noEvents();
        for (const s of m.humans) ev[s].push(s === seat ? { e: 'draw', who: 'me', tile: tile.slice() } : { e: 'draw', who: m.who(s, seat) });
        m._broadcast(ev);
      },
      async onBuildPass(game, player) {
        const seat = m._seat(player);
        if (!m.computers[seat]) m._logOne(seat, game.boneyard.length === 0 && !game.opening[player.id].drew
          ? 'The boneyard is empty and nothing fits the engine. You pass and a marker goes on your train.'
          : 'Nothing fits the engine. You pass and a marker goes on your train.');
        m._tellLog(seat, `${m.names[seat]} cannot start a train and passes. A marker goes on their train: you can play there.`);
        const ev = m.noEvents();
        for (const s of m.humans) { ev[s].push({ e: 'pass', who: m.who(s, seat) }); if (s !== seat) ev[s].push({ e: 'reveal', who: m.who(s, seat) }); }
        m._broadcast(ev);
      },
      async onBuildDone(game, player, count) {
        const seat = m._seat(player);
        m.plans[seat] = null;
        const word = `${count} ${count === 1 ? 'tile' : 'tiles'}`;
        if (!m.computers[seat]) m.logs[seat].push(`You finished a train of ${word}.`);
        m._tellLog(seat, `${m.names[seat]} finished a train of ${word}.`);
        const ev = m.noEvents();
        for (const s of m.humans) if (s !== seat) ev[s].push({ e: 'reveal', who: m.who(s, seat) });
        m._broadcast(ev);
      },
      async onOpeningDone(game) {
        m._say(seat => `All trains are built. ${m.startIndex === seat ? 'You play' : `${m.names[m.startIndex]} plays`} first.`);
        m._broadcast(m.noEvents());
      },
    };
  }

  /* The "a tile was played" event, for each human player. In the opening the other players' tiles stay secret. */
  _playEvents(seat, move, index, opening) {
    const ev = this.noEvents();
    const isDouble = move.tile[0] === move.tile[1];
    for (const s of this.humans) {
      const train = this.cid(s, move.trainId);
      if (s === seat) ev[s].push({ e: 'play', who: 'me', train, index, placed: move.placed.slice(), tile: move.tile.slice(), hidden: false });
      else ev[s].push({
        e: 'play', who: this.who(s, seat), train, index,
        placed: opening ? (isDouble ? HIDDEN_DOUBLE : HIDDEN_PLAIN).slice() : move.placed.slice(),
        tile: opening ? null : move.tile.slice(), hidden: !!opening,
      });
    }
    return ev;
  }

  /* ------------------------------ sending views ------------------------------ */
  _broadcast(events) {
    const seq = ++this.seq;
    for (const seat of this.humans) this.push(seat, { t: 'state', seq, view: this.viewFor(seat), events: events[seat] || [] });
  }

  viewFor(seat) {
    const cid = id => this.cid(seat, id);
    const order = [seat, ...this.others(seat)];                  // this player first, then the others in table order
    const flipTotals = t => { const out = {}; order.forEach(sx => { out[cid(SEATS[sx])] = t[SEATS[sx]]; }); return out; };
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
        modal = {
          type: 'roundEnd', blocked: md.blocked, tie: md.tie, winnerId: md.winnerId ? cid(md.winnerId) : null,
          rows: order.map(sx => { const r = md.rows.find(x => x.id === SEATS[sx]); return { id: cid(r.id), name: sx === seat ? 'You' : r.name, hand: r.hand.map(t => t.slice()), pips: r.pips }; }),
          totals: flipTotals(md.totals), last: md.last,
        };
      }
    }
    const opps = this.others(seat).map((sx, i) => ({ id: i === 0 ? 'cpu' : 'cpu2', name: this.names[sx], seat: sx, computer: !!this.computers[sx], level: this.computers[sx] ? this.computers[sx].level : null }));
    const view = {
      seq: this.seq, round: this.roundIndex, rounds: this.rounds,
      me: { name: this.names[seat], seat }, opp: { name: opps[0].name }, opps,
      totals: flipTotals(this.totals), paused: this.paused, over: this.over,
      log: this.logs[seat].slice(-8), banner: this.banners[seat], modal, awaiting, game: null,
    };
    if (!g) return view;
    const hiddenOf = sx => !!g.opening && sx !== seat && !g.opening[SEATS[sx]].finished;       // another player's train, while they are still building
    const train = (t, hide) => ({
      id: cid(t.id), marker: !!t.marker,
      tiles: t.tiles.map(x => (hide ? (x[0] === x[1] ? HIDDEN_DOUBLE : HIDDEN_PLAIN).slice() : x.slice())),
      end: hide ? 0 : t.end,
    });
    const trains = {};
    order.forEach(sx => { trains[cid(SEATS[sx])] = train(g.trains[SEATS[sx]], hiddenOf(sx)); });
    trains.mexican = train(g.trains.mexican, false);
    const opening = g.opening ? {} : null;
    if (opening) order.forEach(sx => { const o = g.opening[SEATS[sx]]; opening[cid(SEATS[sx])] = { finished: o.finished, drew: o.drew, lastDrew: sx === seat && o.lastDrew ? o.lastDrew.slice() : null }; });
    view.game = {
      engine: g.engine,
      players: order.map(sx => { const p = g.players[sx]; return sx === seat ? { id: 'human', name: 'You', hand: p.hand.map(t => t.slice()) } : { id: cid(p.id), name: this.names[sx], hand: p.hand.map(() => HIDDEN_DOUBLE.slice()) }; }),
      boneyard: g.boneyard.map(() => HIDDEN_DOUBLE.slice()),
      trains,
      openDouble: g.openDouble ? { trainId: cid(g.openDouble.trainId), value: g.openDouble.value } : null,
      opening,
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
    const others = this.others(seat);
    const engineTrain = id => (id === 'mexican' ? 'mexican' : id === 'human' ? SEATS[seat] : id === 'cpu' ? SEATS[others[0]] : id === 'cpu2' && others[1] !== undefined ? SEATS[others[1]] : null);
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
        this._logOne(seat, this.modal && this.modal.last ? 'Waiting for the final score.'
          : this.n === 2 ? `Waiting for ${this.names[1 - seat]} to be ready for the next round.` : 'Waiting for the others to be ready for the next round.');
        aw.resolve();
        this._broadcast(this.noEvents());                       // her dialog goes away at once and she sees she is waiting
        return { ok: true };
      default:
        return bad('bad_message', 'That is not something you can do right now.');
    }
  }
}

module.exports = { OnlineMatch, cleanName, CHAT_PHRASES, HIDDEN_DOUBLE, HIDDEN_PLAIN, sameTile, SEATS };
