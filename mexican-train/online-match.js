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
const LOG_SENT = 120;                 // how many of the latest lines of the game's history every update carries (with where in the whole history they begin: the page keeps what it has been sent)
const { newRound, playRound, longestFullChain, buildSteps, handPips, key, legalMoves, cpuChoose, cpuChooseAsync, cpuBuildAction, invalidAttempt, rateMove, drawAnyway } = E;
const CHAT = G.CHAT;

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
   * (default 0.5 to 3 seconds, so the others see the train go down at a person's pace).
   * The computer player talks, as it does in the game against the computer: theme ('classic' or 'lotr'), chatRng, now(),
   * timer { set(fn, ms), clear(id) }, nativeChance and foodChance (all optional) shape what it says and when. */
  constructor(opts) {
    this.rounds = [1, 4, 13].includes(Number(opts.rounds)) ? Number(opts.rounds) : 4;
    this.hand = [8, 12, 15].includes(Number(opts.hand)) ? Number(opts.hand) : 15;
    this.allowHints = opts.allowHints !== false;                    // the host's choice for the whole table: with it off nobody is shown (or can ask for) the longest train
    this.n = opts.names && (opts.names.length === 3 || opts.names.length === 4) ? opts.names.length : 2;
    this.names = Array.from({ length: this.n }, (_, i) => cleanName(opts.names && opts.names[i], `Player ${i + 1}`));
    this.computers = {};                                   // seat -> { level }: seats played by the computer
    // the computers sit in the last seats: one (as before, at a table of three), or two (a table of four with two people), or one at a table of three people
    const comps = (Array.isArray(opts.computers) ? opts.computers : opts.computer ? [opts.computer] : []).slice(0, this.n - 2);
    if (this.n >= 3) comps.slice(0, this.n - 2).forEach((c, k) => { this.computers[this.n - comps.length + k] = { level: E.LEVELS.includes(c && c.level) ? c.level : 'normal' }; });
    this.humans = [];
    for (let i = 0; i < this.n; i++) if (!this.computers[i]) this.humans.push(i);
    this.rng = opts.rng || Math.random;
    this.paceRng = opts.paceRng || Math.random;            // kept apart from the deal, as in the game against the computer
    this.push = opts.push || (() => {});
    this.sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.stepDelay = opts.stepDelay === undefined ? [500, 3000] : opts.stepDelay;   // between the plays of "Build my longest train"
    this.gameLog = opts.gameLog || null;                   // where this game's log goes: { write(events) } (see gamelog.js), or nothing: no log
    const held = G.createRoundBuffer(events => { if (this.gameLog) this.gameLog.write(events); });
    // NOTHING of a round is written while it is being played (the log holds every hand and the boneyard: it must not be readable during the round): the events of a round
    // are held here and written together when it ends, and the last ones when the game ends or is stopped (that round is dead then)
    this.rec = this.gameLog ? G.createRecorder(ev => held.push(ev)) : null;
    this._logEnded = false;
    this.seq = 0;
    this.totals = {};
    SEATS.slice(0, this.n).forEach(id => { this.totals[id] = 0; });
    this.roundIndex = 0;
    this.startIndex = 0;
    this.startedAt = Date.now();
    this.roundsPlayed = 0;
    this.roundWins = {};                                  // rounds each seat went out first in (a tie or a blocked round with a tie counts for nobody)
    this.game = null;
    const blank = f => Array.from({ length: this.n }, f);
    this.awaiting = blank(() => null);
    this.plans = blank(() => null);
    this.logs = blank(() => []);
    this.banners = blank(() => '');
    this.modal = null;
    this.modalOk = blank(() => false);
    this.unlucky = {}; this.coverDraw = false;     // how many turns in a row each computer has drawn without playing; and whether this draw is only to cover a last double
    this.paused = false;
    this.over = null;                       // null while running; 'finished', 'aborted' or 'error'
    this.error = null;
    this.done = null;
    this.controllers = {};
    SEATS.slice(0, this.n).forEach((id, seat) => { this.controllers[id] = this._controller(seat); });
    this.hooks = this._makeHooks();
    // --- the computer player's comments ---
    this.theme = G.THEME_IDS.includes(opts.theme) ? opts.theme : 'classic';
    this.talkers = Object.keys(this.computers).map(Number);                // every computer takes part in the talk
    this.talker = this.talkers[0];                                          // (undefined: nobody to talk)
    this.chatRng = opts.chatRng || Math.random;                             // never the game's random numbers: comments change nothing in play
    this.now = opts.now || (() => Date.now());
    this.timer = opts.timer || { set(fn, ms) { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; }, clear(t) { clearTimeout(t); } };
    this.nativeChance = opts.nativeChance !== undefined ? opts.nativeChance : CHAT.nativeChance;
    this.foodChance = opts.foodChance !== undefined ? opts.foodChance : CHAT.foodChance;
    this.talk = blank(() => ({ last: null, at: -Infinity, slow: null, slowCount: 0, dish: null }));   // per person: what it said last, when, the slow-jab timer
    this.chatTimers = new Set();
  }

  /* The other seats as seen from `seat`, in table order: the first is that player's "cpu", the second their "cpu2". */
  others(seat) { const out = []; for (let k = 1; k < this.n; k++) out.push((seat + k) % this.n); return out; }
  /* The id a train or player has on `viewer`'s screen: "human" for themselves, then "cpu" and "cpu2", or "mexican". */
  cid(viewer, engineId) {
    if (engineId === 'mexican') return 'mexican';
    const seat = SEATS.indexOf(engineId);
    return seat === viewer ? 'human' : ['cpu', 'cpu2', 'cpu3'][this.others(viewer).indexOf(seat)];
  }
  who(viewer, actor) { return actor === viewer ? 'me' : ['opp', 'opp2', 'opp3'][this.others(viewer).indexOf(actor)]; }
  noEvents() { return Array.from({ length: this.n }, () => []); }

  /* ------------------------------ running the match ------------------------------ */
  start() {
    this.done = this._run().catch(err => {
      if (err === ABORT) { this.over = this.over || 'aborted'; this._endLog('aborted'); return; }
      this.over = 'error'; this.error = err; this._endLog('error');                  // a fault in the game: free anyone waiting, and tell the players
      this._hush();
      this.awaiting.forEach(a => { if (a) a.reject(ABORT); });
      this.awaiting = this.awaiting.map(() => null);
      this._broadcast(this.noEvents());
    });
    return this.done;
  }
  /* The game's log ends (once): how it ended, and the totals at that point. */
  _endLog(how) { if (this.rec && !this._logEnded) { this._logEnded = true; this.rec.gameEnd(this.totals, how); } }
  /* What the server keeps of this game once it is over (see history.js). */
  summary() {
    return {
      startedAt: this.startedAt, endedAt: Date.now(), result: this.over === 'finished' ? 'finished' : 'stopped', rounds: this.rounds, roundsPlayed: this.roundsPlayed, hand: this.hand, theme: this.theme,
      players: SEATS.slice(0, this.n).map((id, i) => ({ name: this.names[i], computer: !!this.computers[i], level: this.computers[i] ? this.computers[i].level : undefined, score: this.totals[id], roundsWon: this.roundWins[id] || 0 })),
    };
  }
  abort() {
    if (this.over) return;
    this._endLog('aborted');
    this.over = 'aborted';
    this._hush();
    this.awaiting.forEach(a => { if (a) a.reject(ABORT); });
    this.awaiting = this.awaiting.map(() => null);
  }
  setPaused(on) { this.paused = !!on; this._broadcast(this.noEvents()); }

  async _run() {
    if (this.rec) this.rec.game({ mode: 'hosted', startedAt: new Date().toISOString(), rounds: this.rounds, hand: this.hand, theme: this.theme, allowHints: this.allowHints,
      players: SEATS.slice(0, this.n).map((id, i) => ({ id, name: this.names[i], kind: this.computers[i] ? 'computer' : 'human', level: this.computers[i] ? this.computers[i].level : undefined })) });
    let startIndex = this.n === 2 ? (this.rng() < 0.5 ? 0 : 1) : Math.floor(this.rng() * this.n);
    for (let r = 0; r < this.rounds; r++) {
      this.roundIndex = r; this.startIndex = startIndex;
      const engine = MAX_PIP - r;
      this.game = newRound({ engine, handSize: this.hand, rng: this.rng, simultaneousOpening: true, players: this.n });
      this.game.players.forEach((p, i) => { p.name = this.names[i]; });
      if (this.rec) this.rec.round(this.game, r, startIndex);                  // (the boneyard and every hand, as dealt)
      this.plans = this.plans.map(() => null); this.modal = null; this.unlucky = {};       // (the history is kept from round to round: each round's first line says where it begins)
      this._say(() => `Round ${r + 1}: the engine is double-${engine}. Everyone builds their train at the same time.`);
      this._log(seat => `${startIndex === seat ? 'You play' : `${this.names[startIndex]} plays`} first once the trains are built.`);
      this._broadcast(this.noEvents());

      const result = await playRound(this.game, startIndex, this.controllers, this.rec ? G.recordingUi(this.hooks, this.rec) : this.hooks);
      const winnerSeat = result.winner ? SEATS.indexOf(result.winner.id) : -1;
      if (result.blocked) this._sayOwn('roundBlocked', undefined, this._speaker());
      this._say(seat => result.blocked ? 'The round is blocked.'
        : result.tie ? (this.n === 2 ? 'You both played every tile.' : 'More than one of you played every tile.')
        : `${winnerSeat === seat ? 'You' : this.names[winnerSeat]} played the last tile.`);
      const rows = this.game.players.map(p => ({ id: p.id, name: p.name, hand: p.hand.map(t => t.slice()), pips: handPips(p) }));
      rows.forEach(row => { this.totals[row.id] += row.pips; });
      this.roundsPlayed++;
      if (result.winner && !result.tie) this.roundWins[result.winner.id] = (this.roundWins[result.winner.id] || 0) + 1;
      if (this.rec) this.rec.roundEnd(this.game, result, this.totals);
      this._broadcast(this.noEvents());
      await this._modal({
        type: 'roundEnd', blocked: result.blocked, tie: !!result.tie, winnerId: result.winner ? result.winner.id : null,
        rows, totals: Object.assign({}, this.totals), last: r === this.rounds - 1,
      });
      startIndex = (startIndex + 1) % this.n;
    }
    this._endLog('finished');
    this.modal = { type: 'final', totals: Object.assign({}, this.totals) };
    this.over = 'finished';
    this._hush();
    this._broadcast(this.noEvents());
  }

  /* Someone who has already seen the final score has left, and the other has not pressed the button yet: they are told, and the game
   * carries on until they have. */
  seatLeft(seat) { this._tell(seat, `${this.names[seat]} has gone. Press the button to see the final score.`); this._broadcast(this.noEvents()); }

  /* Wait until a seat sends the intent that answers `kind`. Resolves with the engine-shaped answer. */
  _wait(seat, kind, extra) {
    return new Promise((resolve, reject) => {
      if (this.over) return reject(ABORT);
      this.awaiting[seat] = Object.assign({ kind, reject, resolve: v => { this.awaiting[seat] = null; this._cancelSlow(seat); resolve(v); } }, extra || {});
      if (kind === 'move' || kind === 'draw' || kind === 'build') this._armSlow(seat);
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
          const second = game.opening && game.opening[player.id] && game.opening[player.id].lastWobble;       // (it has just taken a tile back because it changed its mind)
          if (action.type === 'play') {                         // sometimes it tries the wrong train first: everybody sees the tile go there and come back
            const t = invalidAttempt(game, player, info, cpu.level);
            if (t) {
              const ev = this.noEvents();
              for (const s of this.humans) ev[s].push({ e: 'try', who: this.who(s, seat), train: this.cid(s, t.trainId) });
              this._broadcast(ev);
              await this._pauseFor(1000);
            }
          }
          await this._think(action.type === 'done' ? 'finish' : action.type === 'draw' ? 'draw' : action.type === 'undo' ? 'undo' : second ? 'replace' : 'place');
          return action;
        },
        choose: async (game, player, moves) => {
          if (game.openDouble) return cpuChooseAsync(game, player, moves, cpu.level);     // a cover is played at once, with no thinking time
          this.humans.forEach(s => { this.banners[s] = `${this.names[seat]} is thinking...`; });
          this._broadcast(this.noEvents());
          await this._think('place');
          return cpuChooseAsync(game, player, moves, cpu.level);
        },
      };
    }
    return {
      act: (game, player, info) => this._act(seat, game, player, info),
      choose: async (game, player, moves, drew) => {
        this.others(seat).forEach(s => { if (!this.computers[s]) this.banners[s] = `${this.names[seat]} is choosing a tile.`; });
        let list = moves, drewThisTurn_ = !!drew;                  // (a turn that began with the ordinary draw, because nothing fitted, has had its one draw)
        for (;;) {
          const chosen = await this._wait(seat, 'move', { moves: list, drewThisTurn: drewThisTurn_ });
          if (chosen && chosen.extraDraw) {                    // a draw the person did not have to make (hints off on their page): the tile joins their hand and the turn goes on
            const tile = drawAnyway(game, player);
            if (tile) { drewThisTurn_ = true; list = legalMoves(game, player); if (this.rec) this.rec.onDraw(game, player, tile); await this.hooks.onDraw(game, player, tile); }       // (this draw is made here, not by the engine, so the game log is told of it here)
            continue;
          }
          if (this.talker !== undefined) {                     // the computer has an opinion of that move (judged on the board as it was)
            try { const kind = G.commentKindFor(rateMove(game, player, list, chosen)); if (kind) this._maybeSay(seat, kind); }
            catch (e) { /* a comment must never be able to break the game */ }
          }
          return chosen;
        }
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
    const finished = !!(this.plans[seat] && this.plans[seat].length === 0);       // the plan ran to its end: the longest train is down
    this.plans[seat] = null;
    if (finished && info.canDone) { await this._pauseFor(this._stepMs()); return { type: 'done' }; }     // so the opening is finished too: no Done to press
    const chain = longestFullChain(game, player);
    return this._wait(seat, 'build', { info, canBuild: this.allowHints && chain.length > (info.canDone ? info.placed : -1), buildCount: this.allowHints ? chain.length : 0 });
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
        m.coverDraw = player.hand.length === 0;                        // (a draw to cover a last double: nothing to grumble about)
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
        if (!m.computers[seat]) { m._logOne(seat, `You drew ${fmt(tile)}.`); m._maybeSay(seat, 'draw'); }
        else if (!m.coverDraw) m._ownLuck(seat, game.openDouble && m.doubleBy !== undefined && m.doubleBy !== null && m.doubleBy !== seat ? 'doubleResent' : 'draw');
        m._tell(seat, `${m.names[seat]} draws a tile.`);
        const ev = m.noEvents();
        for (const s of m.humans) ev[s].push(s === seat ? { e: 'draw', who: 'me', tile: tile.slice() } : { e: 'draw', who: m.who(s, seat) });
        m._broadcast(ev);
        if (m.computers[seat]) await m.sleep(650);
      },
      async onPass(game, player) {
        const seat = m._seat(player);
        if (!m.computers[seat]) m._maybeSay(seat, 'pass');
        else if (player.hand.length > 0) m._ownLuck(seat, 'blocked');
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
        m._ownLuck(seat, 'play');
        if (info.doubleOpened) m.doubleBy = seat; else if (info.doubleSatisfied) m.doubleBy = null;
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
        if (!m.computers[seat]) { m._logOne(seat, `You drew ${fmt(tile)}.`); m._maybeSay(seat, 'draw'); }
        else m._ownLuck(seat, 'draw');
        m._tellLog(seat, `${m.names[seat]} draws a tile.`);
        const ev = m.noEvents();
        for (const s of m.humans) ev[s].push(s === seat ? { e: 'draw', who: 'me', tile: tile.slice() } : { e: 'draw', who: m.who(s, seat) });
        m._broadcast(ev);
      },
      async onBuildPass(game, player) {
        const seat = m._seat(player);
        if (!m.computers[seat]) m._maybeSay(seat, 'pass');
        else m._ownLuck(seat, 'blocked');
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
        if (!m.computers[seat]) {
          m.logs[seat].push(`You finished a train of ${word}.`);
          if (m.talker !== undefined) {                       // was that the longest train they could have built?
            const best = longestFullChain(game, player).length;
            if (count === 0 && best > 0) m._maybeSay(seat, 'openNone');
            else if (count < best) m._maybeSay(seat, 'openShort', { built: count, best });
            else if (count >= 3) m._maybeSay(seat, 'openBest');
          }
        }
        if (m.computers[seat] && count >= 1 && count <= G.OWN_SHORT) m._ownLuck(seat, 'short', { built: count });       // a very short train of its own
        m._tellLog(seat, `${m.names[seat]} finished a train of ${word}.`);
        const ev = m.noEvents();
        for (const s of m.humans) if (s !== seat) ev[s].push({ e: 'reveal', who: m.who(s, seat) });
        m._broadcast(ev);
      },
      async onOpeningDone(game) {
        m.unlucky = {};                                             // the normal turns start with a clean slate
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

  /* ------------------------------ the computer player talks ------------------------------ */
  /* As in the game against the computer: it comments on a person's moves, draws, passes and opening train, and teases a
   * person who takes too long (getting hungrier). Every comment is about one person and goes only to them, as
   * { t: 'say', from, kind, text, lang?, trans? }. It uses its own random numbers, so the game plays out the same. */
  _later(fn, ms) {
    const id = this.timer.set(() => { this.chatTimers.delete(id); if (!this.over) fn(); }, ms);
    this.chatTimers.add(id);
    return id;
  }
  /* Which computer speaks when something is said about a person's move: any of them, by chance (with one computer, that one). */
  _speaker() { return this.talkers.length > 1 ? this.talkers[Math.min(this.talkers.length - 1, Math.floor(this.chatRng() * this.talkers.length))] : this.talker; }
  _say1(seat, kind, vars, delay, speaker) {
    if (this.talker === undefined || this.over || !this.humans.includes(seat)) return;
    const who = speaker !== undefined ? speaker : this._speaker();
    const st = this.talk[seat], name = this.names[who];
    const said = G.composeComment(kind, vars, { name, level: this.computers[who].level, theme: this.theme, rng: this.chatRng,
      nativeChance: this.nativeChance, foodChance: this.foodChance, last: st.last, dish: st.dish });
    if (said.dish !== undefined) st.dish = said.dish;
    st.last = said.text;
    const msg = Object.assign({ t: 'say', from: name, kind, text: said.text }, said.lang ? { lang: said.lang, trans: said.trans } : {});
    if (delay > 0) this._later(() => this.push(seat, msg), delay); else this.push(seat, msg);
  }
  /* Whether it says something about this, by chance and a cooldown (some kinds always get through). */
  _maybeSay(seat, kind, vars) {
    if (this.talker === undefined || this.over) return false;
    const p = CHAT.chance[kind], st = this.talk[seat];
    if (p === undefined || this.chatRng() >= p) return false;
    if (!CHAT.bypass[kind] && this.now() - st.at < CHAT.cooldownMs) return false;
    st.at = this.now();
    this._say1(seat, kind, vars, CHAT.reactDelayMs[0] + this.chatRng() * (CHAT.reactDelayMs[1] - CHAT.reactDelayMs[0]), undefined);
    return true;
  }
  /* The computer grumbling about ITS OWN luck (a tile that does not fit, a run of bad draws, no move at all, a very short opening train, a blocked round): it knows its own
   * hand and the table, never yours. Everybody at the table sees the same remark, so it is decided once (by chance and the cooldown, which is shared by all of them). */
  _sayOwn(kind, vars, speaker) {
    if (this.talker === undefined || this.over || !this.humans.length) return false;
    const who = speaker !== undefined ? speaker : this.talker;
    const p = CHAT.chance[kind];
    if (p === undefined || this.chatRng() >= p) return false;
    const now = this.now();
    if (!CHAT.bypass[kind] && this.humans.some(h => now - this.talk[h].at < CHAT.cooldownMs)) return false;
    this.humans.forEach(h => { this.talk[h].at = now; });
    const name = this.names[who], lead = this.talk[this.humans[0]];
    const said = G.composeComment(kind, vars, { name, level: this.computers[who].level, theme: this.theme, rng: this.chatRng,
      nativeChance: this.nativeChance, foodChance: 0, last: lead.last, dish: null });
    this.humans.forEach(h => { this.talk[h].last = said.text; });
    const msg = Object.assign({ t: 'say', from: name, kind, text: said.text }, said.lang ? { lang: said.lang, trans: said.trans } : {});
    const send = () => this.humans.forEach(h => this.push(h, msg));
    const delay = CHAT.reactDelayMs[0] + this.chatRng() * (CHAT.reactDelayMs[1] - CHAT.reactDelayMs[0]);
    if (delay > 0) this._later(send, delay); else send();
    return true;
  }
  _ownLuck(seat, event, vars) {                                       // (each computer grumbles about its own luck)
    if (!this.computers[seat]) return;
    if (event === 'play') { this.unlucky[seat] = 0; return; }        // a tile went down: the bad run is over
    if (event === 'draw') { const n = this.unlucky[seat] = (this.unlucky[seat] || 0) + 1; this._sayOwn(n === 1 ? 'ownDraw' : 'ownDrawAgain', undefined, seat); }
    else if (event === 'doubleResent') { this.unlucky[seat] = (this.unlucky[seat] || 0) + 1; this._sayOwn('doubleResent', undefined, seat); }      // it had to draw to cover somebody else's double
    else if (event === 'blocked') this._sayOwn('ownBlocked', undefined, seat);
    else if (event === 'short') this._sayOwn('ownShort', vars, seat);
  }
  /* Taking too long: a jab after 25 seconds, then another every 20 to 26 seconds, each one ruder. Not while paused. */
  _armSlow(seat) {
    if (this.talker === undefined || !this.humans.includes(seat)) return;
    this._cancelSlow(seat);
    const st = this.talk[seat];
    st.slowCount = 0; st.dish = null; st.speaker = this._speaker();      // a new wait: a new dish, if it gets hungry (and one computer does the talking)
    const fire = () => {
      st.slow = null;
      if (this.over || !this.awaiting[seat]) return;
      if (!this.paused && !this.modal) { st.slowCount++; st.at = this.now(); this._say1(seat, 'slow' + Math.min(3, st.slowCount), {}, 0, st.speaker); }
      st.slow = this.timer.set(fire, CHAT.slowEveryMs[0] + this.chatRng() * (CHAT.slowEveryMs[1] - CHAT.slowEveryMs[0]));
    };
    st.slow = this.timer.set(fire, CHAT.slowAfterMs);
  }
  _cancelSlow(seat) { const st = this.talk && this.talk[seat]; if (st && st.slow !== null) { this.timer.clear(st.slow); st.slow = null; } }
  _hush() {
    if (!this.talk) return;
    this.talk.forEach((_, seat) => this._cancelSlow(seat));
    this.chatTimers.forEach(id => this.timer.clear(id));
    this.chatTimers.clear();
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
        awaiting = { kind: 'build', moves: i.moves.map(flipMove), placed: i.placed, canUndo: !!i.canUndo, canDraw: !!i.canDraw, canDrawEarly: !!i.canDrawEarly, canDone: !!i.canDone, lastDouble: !!i.lastDouble, canBuild: !!aw.canBuild, buildCount: aw.buildCount };
      } else if (aw.kind === 'move') awaiting = { kind: 'move', moves: aw.moves.map(flipMove), drewThisTurn: !!aw.drewThisTurn };
      else awaiting = { kind: aw.kind };
    }
    let modal = null;
    // After the LAST round there is nothing left to wait for the other person about: whoever presses "See the final score" gets it at once
    const early = !!(this.modal && this.modal.type === 'roundEnd' && this.modal.last && this.modalOk[seat]);
    if (this.modal && (this.modal.type === 'final' || early || !this.modalOk[seat])) {
      const md = this.modal;
      if (md.type === 'final' || early) modal = { type: 'final', totals: flipTotals(md.totals) };
      else {
        modal = {
          type: 'roundEnd', blocked: md.blocked, tie: md.tie, winnerId: md.winnerId ? cid(md.winnerId) : null,
          rows: order.map(sx => { const r = md.rows.find(x => x.id === SEATS[sx]); return { id: cid(r.id), name: sx === seat ? 'You' : r.name, hand: r.hand.map(t => t.slice()), pips: r.pips }; }),
          totals: flipTotals(md.totals), last: md.last,
        };
      }
    }
    const opps = this.others(seat).map((sx, i) => ({ id: ['cpu', 'cpu2', 'cpu3'][i], name: this.names[sx], seat: sx, computer: !!this.computers[sx], level: this.computers[sx] ? this.computers[sx].level : null }));
    const view = {
      seq: this.seq, round: this.roundIndex, rounds: this.rounds,
      me: { name: this.names[seat], seat }, opp: { name: opps[0].name }, opps,
      totals: flipTotals(this.totals), paused: this.paused, over: early ? 'finished' : this.over,
      log: this.logs[seat].slice(-LOG_SENT), logFrom: Math.max(0, this.logs[seat].length - LOG_SENT), banner: this.banners[seat], modal, awaiting, game: null,
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
  /* A person tried to put a tile where it does not go (their page noticed): the computer may remark on it. Only on their turn, and only if there is a computer. */
  tried(seat, train) {
    if (this.over || this.paused || !this.humans.includes(seat) || !this.awaiting[seat]) return;
    // the tile they tried goes to that train and comes back on everybody else's screen too (`train` is the id on THEIR screen)
    const engineId = train === 'mexican' ? 'mexican' : ['human', 'cpu', 'cpu2', 'cpu3'].includes(train) ? SEATS[train === 'human' ? seat : this.others(seat)[['cpu', 'cpu2', 'cpu3'].indexOf(train)]] : undefined;
    if (engineId && this.game && this.game.trains[engineId]) {
      const ev = this.noEvents();
      for (const s of this.humans) if (s !== seat) ev[s].push({ e: 'try', who: this.who(s, seat), train: this.cid(s, engineId) });
      if (this.humans.some(s => s !== seat)) this._broadcast(ev);
    }
    this._maybeSay(seat, 'invalid');
  }
  intent(seat, msg) {
    const bad = (code, message) => ({ ok: false, code, message });
    if (this.over) return bad('over', 'The game is over.');
    if (!msg || typeof msg !== 'object') return bad('bad_message', 'That was not understood.');
    if (this.paused) return bad('paused', 'The game is paused.');
    const aw = this.awaiting[seat];
    if (!aw) return bad('not_now', 'It is not your turn to act.');
    const a = msg.a;
    const others = this.others(seat);
    const engineTrain = id => (id === 'mexican' ? 'mexican' : id === 'human' ? SEATS[seat] : id === 'cpu' ? SEATS[others[0]] : id === 'cpu2' && others[1] !== undefined ? SEATS[others[1]] : id === 'cpu3' && others[2] !== undefined ? SEATS[others[2]] : null);
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
        if (a === 'draw') { if (!i.canDraw && !i.canDrawEarly) return bad('illegal', 'You can only draw before you have put a tile down, and only once.'); aw.resolve({ type: 'draw' }); return { ok: true }; }
        if (a === 'done') { if (!i.canDone) return bad('illegal', 'Cover the double or take it back first.'); aw.resolve({ type: 'done' }); return { ok: true }; }
        if (a === 'autoBuild') {
          if (!this.allowHints) return bad('illegal', 'The host has turned hints off, so the game does not build a train for you.');
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
        if (a === 'draw') {                                   // a draw the person did not have to make (the game does not refuse it because they have a play)
          if (this.game.openDouble) return bad('illegal', 'A double has to be covered first.');
          if (aw.drewThisTurn) return bad('illegal', 'You have already drawn a tile this turn.');
          if (this.game.boneyard.length === 0) return bad('illegal', 'The boneyard is empty.');
          aw.resolve({ extraDraw: true });
          return { ok: true };
        }
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
        if (!(this.modal && this.modal.last)) this._logOne(seat, this.n === 2 ? `Waiting for ${this.names[1 - seat]} to be ready for the next round.` : 'Waiting for the others to be ready for the next round.');
        aw.resolve();
        this._broadcast(this.noEvents());                       // her dialog goes away at once and she sees she is waiting
        return { ok: true };
      default:
        return bad('bad_message', 'That is not something you can do right now.');
    }
  }
}

module.exports = { OnlineMatch, cleanName, CHAT_PHRASES, HIDDEN_DOUBLE, HIDDEN_PLAIN, sameTile, SEATS };
