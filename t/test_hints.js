'use strict';
require('./game.js');
const G = globalThis.MexicanTrainGame;
const { mulberry32, key } = G.Engine;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* An app whose every screen is recorded, with a storage we can look at. */
function makeApp(opts) {
  opts = opts || {};
  const store = opts.store || {};
  const c = { renders: [], html: '', store };
  const root = { set innerHTML(v) { c.html = v; c.renders.push({ html: v, aw: c.app && c.app.state.awaiting ? c.app.state.awaiting.kind : null, game: !!(c.app && c.app.state.game), dbl: c.app && c.app.state.game && c.app.state.game.openDouble ? c.app.state.game.openDouble.trainId : null }); }, get innerHTML() { return c.html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  c.app = G.createApp(Object.assign({ root, rng: mulberry32(opts.seed || 7), paceRng: () => 0, sleep: async () => {}, reducedMotion: true, chatRng: () => 1, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } }, opts.env || {}));
  c.S = c.app.state; c.d = a => c.app.dispatch(a);
  c.app.dispatch({ type: 'boot' });
  return c;
}
const until = async (f, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(1); } return f(); };
// everything that tells a player which tiles can be played and where
const HINTS = [
  [/class="tile-btn playable/, 'a highlighted playable tile'], [/class="tile-btn dim/, 'tiles dimmed because they cannot be played'], [/aria-label="[^"]*playable/, '"playable" in a tile\'s spoken label'],
  [/class="track[^"]*\btarget\b/, 'a glowing train'], [/class="ghost"/, 'a "Play here" slot'], [/class="track[^"]*\bpreview\b/, 'a preview outline'],
  // (not hints, so not listed: the outline and label on the train with a double to cover, and the plain unflashing Draw button on the hand)
  [/data-action="autoBuild"/, 'the build-my-longest-train button'], [/class="boneyard ready/, 'a flashing boneyard'], [/class="slot-draw"/, 'the flashing Draw spot'],
  [/glow/i, 'the word "glow"'], [/Nothing fits/, '"nothing fits"'], [/class="cta">Draw a tile/, 'the boneyard\'s draw prompt'], [/aria-label="Draw a tile\. /, 'the boneyard\'s spoken draw prompt'],
];
const hintsIn = html => HINTS.filter(([re]) => re.test(html)).map(([, name]) => name);
const startGame = (c, o) => c.d(Object.assign({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'normal' }, o || {}));
const trainsOf = S => ['human', 'cpu', 'mexican'];
const handKeys = S => S.game.players[0].hand.map(key).sort().join();

(async () => {
  console.log('1. the main screen');
  {
    const c = makeApp();
    ok(/id="opt-hints"[^>]*aria-pressed="true">Allow hints: on</.test(c.html), 'the main screen has an "Allow hints" toggle, on by default (the game works as it always did)');
    ok(/Off: nothing is highlighted and nothing is played for you/.test(c.html), 'with a line saying what off means');
    c.d({ type: 'setAllowHints', value: false });
    ok(c.S.opts.allowHints === false && /"allowHints":false/.test(c.store['mt-opts']), 'turning it off is remembered');
    c.d({ type: 'newGame' });
    ok(/id="opt-hints"[^>]*aria-pressed="false">Allow hints: off</.test(c.html), 'and the main screen then shows it off');
    const again = makeApp({ store: c.store });
    ok(again.S.opts.allowHints === false && /Allow hints: off/.test(again.html), 'a fresh page load comes back with hints still off');
    again.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    ok(again.S.opts.allowHints === false, 'starting a game without saying otherwise keeps it off');
    again.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy', allowHints: true });
    ok(again.S.opts.allowHints === true, 'and a game can start with it on');
    ok(G.createApp && makeApp({ store: { 'mt-opts': JSON.stringify({ allowHints: 'false' }) } }).S.opts.allowHints === false && makeApp({ store: { 'mt-opts': JSON.stringify({ rounds: 4 }) } }).S.opts.allowHints === true && makeApp({ store: { 'mt-opts': '{broken' } }).S.opts.allowHints === true, 'saved settings from before this option existed, or damaged ones, mean hints on');
  }

  console.log('2. hints allowed: as before, plus a Show hints button on the hand');
  {
    const c = makeApp(); startGame(c);
    await until(() => c.S.awaiting);
    ok(/data-action="toggleShowHints" aria-pressed="true"[^>]*>Show hints: on</.test(c.html), 'the hand has a "Show hints: on" button');
    // a turn of the opening with something to play
    let tries = 0; while (c.S.awaiting && c.S.awaiting.kind === 'build' && !c.S.awaiting.moves.length && tries++ < 5) { c.d({ type: c.S.awaiting.canDraw ? 'draw' : 'endBuild' }); await wait(3); }
    const a = c.S.awaiting;
    if (a && a.moves && a.moves.length) {
      ok(/class="tile-btn playable/.test(c.html) && /data-action="autoBuild"/.test(c.html), 'hints on: the playable tiles are highlighted, and "Build my longest train" is offered');
      c.d({ type: 'toggleShowHints' });
      ok(/Show hints: off/.test(c.html) && /aria-pressed="false"[^>]*>Show hints: off/.test(c.html), 'pressing it switches hints off, and it says so');
      ok(hintsIn(c.html).length === 0, 'at once: every highlight disappears from the screen' + (hintsIn(c.html)[0] ? ' (still there: ' + hintsIn(c.html).join(', ') + ')' : ''));
      c.d({ type: 'toggleShowHints' });
      ok(/class="tile-btn playable/.test(c.html) && /Show hints: on/.test(c.html), 'and pressing it again brings them back');
    } else ok(false, 'no tile to play was found in the opening');
    ok(c.S.showHints === true && !/"showHints"/.test(c.store['mt-opts']), '(the Show hints switch is for this game only: not saved)');
    startGame(c);
    ok(c.S.showHints === true, 'a new game starts with hints showing again');
  }

  console.log('3. hints not allowed: no hints anywhere, in whole games');
  {
    const c = makeApp({ seed: 11 }); startGame(c, { allowHints: false, hand: 15 });
    ok(!/Show hints/.test(c.html), 'there is no Show hints button on the hand');
    const rnd = mulberry32(3);
    let wrong = 0, right = 0, drawRefused = 0, guard = 0, mixed = 0, lastPrompt = null, newPrompts = 0, preselected = 0;
    while (!(c.S.modal && c.S.modal.type === 'roundEnd') && guard++ < 6000) {
      const a = c.S.awaiting;
      if (!a) { await wait(0); continue; }
      if (a.kind === 'modal') { c.d({ type: 'dialogOk' }); continue; }
      if (a !== lastPrompt) { lastPrompt = a; newPrompts++; if (c.S.selectedKey !== null) preselected++; }     // a new prompt starts with nothing picked
      const hand = c.S.game.players[0].hand, before = handKeys(c.S), boneBefore = c.S.game.boneyard.length;
      const legal = a.moves || [];
      const mode = rnd();
      if (a.kind === 'move' || a.kind === 'build') {
        if (mode < 0.15) {                                    // try to draw while a move exists
          c.d({ type: 'draw' });
          if (legal.length) { if (c.S.game.boneyard.length === boneBefore && /cannot draw/.test(c.html)) drawRefused++; else mixed++; }
          if (a.kind === 'build' && a.canDraw) continue;
        }
        if (legal.length && mode < 0.65) {                    // a right guess: the tile, then its train
          const m = legal[Math.floor(rnd() * legal.length)];
          if (c.S.selectedKey !== key(m.tile)) c.d({ type: 'selectTile', key: key(m.tile) });     // (tapping a picked-up tile puts it back)
          if (c.S.awaiting !== a) mixed++;                     // picking up a tile must never play it
          c.d({ type: 'playOn', train: m.trainId });
          if (handKeys(c.S) === before && c.S.awaiting === a) mixed++; else right++;
        } else {                                              // a wrong guess: any tile, any train
          const t = hand[Math.floor(rnd() * hand.length)], tr = trainsOf()[Math.floor(rnd() * 3)];
          const isLegal = legal.some(m => key(m.tile) === key(t) && m.trainId === tr);
          if (c.S.selectedKey !== key(t)) c.d({ type: 'selectTile', key: key(t) });
          if (c.S.awaiting !== a) mixed++;
          c.d({ type: 'playOn', train: tr });
          if (!isLegal) { if (handKeys(c.S) === before && c.S.awaiting === a && /cannot be played/.test(c.html)) wrong++; else mixed++; }
          else right++;
        }
        if (c.S.awaiting === a && a.kind === 'build' && !legal.length) { if (a.canDraw) c.d({ type: 'draw' }); else if (a.canDone) c.d({ type: 'endBuild' }); else c.d({ type: 'undoTile' }); }
        else if (c.S.awaiting === a && a.kind === 'build' && rnd() < 0.2 && a.canDone) c.d({ type: 'endBuild' });
      } else if (a.kind === 'draw') {
        c.d({ type: 'selectTile', key: key(hand[0]) }); c.d({ type: 'playOn', train: 'mexican' });          // nothing can be played: any guess is refused
        if (handKeys(c.S) !== before) mixed++;
        c.d({ type: 'draw' }); if (c.S.game.boneyard.length !== boneBefore - 1 && c.S.awaiting === a) mixed++;
      }
      await wait(0);
    }
    const screens = c.renders.filter(r => r.game);
    const leaks = {}; screens.forEach(r => hintsIn(r.html).forEach(h => { leaks[h] = (leaks[h] || 0) + 1; }));
    ok(screens.length > 200, `${screens.length} screens were drawn in a whole game with hints off`);
    {
      const withHand = screens.filter(r => /class="tile-btn/.test(r.html));
      const calm = r => /<button class="slot-draw calm" data-action="draw"[^>]*><span>Draw<\/span><\/button>/.test(r.html);
      ok(withHand.length > 150 && withHand.every(calm), `the hand keeps its Draw button, with the word Draw on it, on every one of ${withHand.length} screens`);
      ok(withHand.every(r => !/class="slot-draw"/.test(r.html) && !/slot-draw[^>]*style="animation-delay/.test(r.html)), 'and it is never the flashing, highlighted version');
      const mine = r => r.aw === 'move' || r.aw === 'build' || r.aw === 'draw';
      ok(withHand.every(r => /class="slot-draw calm"[^>]*disabled/.test(r.html) === !mine(r)), 'it can be pressed on your turn and only then (disabled while you wait)');
      const withDouble = screens.filter(r => r.dbl);
      ok(withDouble.length > 20, `a double was open on ${withDouble.length} screens of this game`);
      ok(withDouble.every(r => new RegExp('class="track[^"]*\\bmust\\b[^"]*" data-train="' + r.dbl + '"').test(r.html) && (r.html.match(/class="track[^"]*\bmust\b/g) || []).length === 1 && /Cover the double here/.test(r.html)), 'on every one of them the train with the double to cover is outlined and labelled "Cover the double here" (and only that train), although hints are off');
      ok(screens.filter(r => !r.dbl).every(r => !/class="track[^"]*\bmust\b/.test(r.html) && !/Cover the double here/.test(r.html)), '(and nothing is outlined when no double is open)');
    }
    ok(Object.keys(leaks).length === 0, 'on every one of them: no playable highlight, no dimmed unplayable tiles, no glowing or previewed train, no "Play here" slot, no cover-the-double glow, no build-my-longest-train button, no flashing draw, no "glow" or "nothing fits" text' + (Object.keys(leaks)[0] ? ' (found: ' + JSON.stringify(leaks) + ')' : ''));
    ok(wrong > 10 && right > 20, `the round was played by guessing tile and train: ${right} plays, ${wrong} wrong guesses`);
    ok(mixed === 0, 'every wrong guess changed nothing (the tile stayed in the hand, the same prompt stayed) and said "That tile cannot be played on that train."; picking up a tile never played it, not even when it had only one place to go; a right guess always played' + (mixed ? ` (${mixed} exceptions)` : ''));
    ok(newPrompts > 30 && preselected === 0, `at the start of each of the ${newPrompts} prompts nothing was picked for the player (not even a tile that had only one place to go)`);
    ok(drawRefused > 2, `trying to draw while having a move was refused with a message (${drawRefused} times)`);
    ok(c.S.modal && c.S.modal.type === 'roundEnd', 'and the round reached its end with a proper result');
    {
      const k0 = c.S.game.players[0].hand.map(key)[0];
      const had = c.S.awaiting; if (had && (had.kind === 'move' || had.kind === 'build' || had.kind === 'draw')) { c.d({ type: 'selectTile', key: k0 }); const on = c.S.selectedKey === k0; c.d({ type: 'selectTile', key: k0 }); ok(on && c.S.selectedKey === null, 'tapping a picked-up tile again puts it back'); }
    }
    const sel = screens.filter(r => /tile-btn[^"]* selected/.test(r.html)).length;
    ok(sel > 20, `a picked-up tile shows as selected (${sel} screens)`);
  }

  console.log('4. the same hints-off game, but hints switched off during the game');
  {
    const c = makeApp({ seed: 13 }); startGame(c, { hand: 15 });
    await until(() => c.S.awaiting);
    c.d({ type: 'toggleShowHints' });
    let guard = 0, leaks = 0;
    const before = c.renders.length;
    while (!(c.S.modal && c.S.modal.type === 'roundEnd') && guard++ < 4000) {
      const a = c.S.awaiting;
      if (a && a.kind === 'modal') { c.d({ type: 'dialogOk' }); continue; }
      if (a && (a.kind === 'move' || a.kind === 'build') && a.moves.length) { const m = a.moves[0]; c.d({ type: 'selectTile', key: key(m.tile) }); c.d({ type: 'playOn', train: m.trainId }); }
      else if (a && a.kind === 'build') c.d({ type: a.canDraw ? 'draw' : a.canDone ? 'endBuild' : 'undoTile' });
      else if (a && a.kind === 'draw') c.d({ type: 'draw' });
      await wait(0);
    }
    c.renders.slice(before).filter(r => r.game).forEach(r => { if (hintsIn(r.html).length) leaks++; });
    ok(leaks === 0, 'switching hints off with the button gives the same hint-free screens for the rest of the game');
    ok(/Show hints: off/.test(c.html) || c.S.modal, '(and the button keeps saying so)');
  }

  console.log('5. the opening, with hints off');
  {
    const c = makeApp({ seed: 5 }); startGame(c, { allowHints: false, hand: 15 });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    let a = c.S.awaiting, n = 0;
    while (a && a.kind === 'build' && !a.moves.length && n++ < 4) { c.d({ type: a.canDraw ? 'draw' : 'endBuild' }); await wait(3); a = c.S.awaiting; }
    ok(!/data-action="autoBuild"/.test(c.html) && !/Build my longest/.test(c.html), 'there is no "Build my longest train" button (it would play the best answer for you)');
    ok(/Pick a tile, then tap your train/.test(c.html) || /Pick a tile/.test(c.html), 'the instruction says to pick a tile and then the train');
    if (a && a.kind === 'build' && a.moves.length) {
      const m = a.moves[0], placed = c.S.game.trains.human.tiles.length;
      c.d({ type: 'selectTile', key: key(m.tile) });
      ok(c.S.game.trains.human.tiles.length === placed && c.S.selectedKey === key(m.tile), 'tapping a tile in the opening only picks it up (before, it was laid straight away)');
      c.d({ type: 'selectTile', key: key(m.tile) });
      ok(c.S.selectedKey === null, 'tapping the picked-up tile again puts it back');
      c.d({ type: 'selectTile', key: key(m.tile) });
      c.d({ type: 'playOn', train: 'mexican' });
      ok(c.S.game.trains.human.tiles.length === placed && /cannot be played/.test(c.html), 'tapping the Mexican train in the opening is refused');
      c.d({ type: 'playOn', train: 'human' }); await wait(5);
      ok(c.S.game.trains.human.tiles.length === placed + 1, 'tapping your own train lays it');
    } else ok(false, 'no tile fitting the engine in this deal');
    const handNow = handKeys(c.S), anyTile = c.S.game.players[0].hand[0];
    c.d({ type: 'dropOnTrain', key: key(anyTile), train: 'cpu', from: null });
    ok(handKeys(c.S) === handNow, 'a tile dropped on the opponent\'s train in the opening stays in the hand');
  }

  console.log('6. dragging a tile with hints off');
  {
    const c = makeApp({ seed: 17 }); startGame(c, { allowHints: false, hand: 12 });
    await until(() => c.S.awaiting && c.S.awaiting.kind === 'build');
    let a = c.S.awaiting, n = 0;
    while (a && a.kind === 'build' && !a.moves.length && n++ < 4) { c.d({ type: a.canDraw ? 'draw' : 'endBuild' }); await wait(3); a = c.S.awaiting; }
    if (a && a.moves && a.moves.length) {
      const m = a.moves[0], before = handKeys(c.S);
      c.d({ type: 'dragStart', key: key(m.tile) });
      ok(hintsIn(c.html).length === 0 && !/class="track[^"]*\bpreview\b/.test(c.html), 'while a tile is being dragged no train lights up to show where it could go');
      c.d({ type: 'dropOnTrain', key: key(m.tile), train: 'mexican', from: { left: 1, top: 1, width: 40, height: 20 } });
      ok(handKeys(c.S) === before && /cannot be played/.test(c.html), 'dropping it on a train it cannot go on sends it back to the hand, with a message');
      c.d({ type: 'dragStart', key: key(m.tile) });
      c.d({ type: 'dropOnTrain', key: key(m.tile), train: m.trainId, from: { left: 1, top: 1, width: 40, height: 20 } }); await wait(5);
      ok(handKeys(c.S) !== before, 'dropping it on its own train plays it');
    } else ok(false, 'no tile fitting the engine in this deal');
  }

  console.log('7. online, with hints off');
  {
    class FakeWS { constructor() { this.readyState = 0; this.sent = []; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); } send(d) { this.sent.push(JSON.parse(d)); } close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
    const c = makeApp({ store: { 'mt-opts': JSON.stringify({ allowHints: false }) }, env: { WebSocket: FakeWS, fetch: async () => ({ ok: true, json: async () => ({ addresses: ['fake:1'], preferred: 'fake:1' }) }) } });
    c.d({ type: 'openHost' }); await wait(5); c.d({ type: 'hostGame', server: 'x', name: 'Me', rounds: 4, hand: 15 }); await wait(10);
    const ws = FakeWS.last;
    ws.say({ t: 'created', code: 'ABCDEF', display: 'ABC-DEF', token: 't', seat: 0, settings: { rounds: 4, hand: 15 }, addresses: [] });
    const T = (a, b) => [a, b], tr = id => ({ id, marker: false, tiles: [], end: 12 });
    let seq = 0;
    const view = aw => ({ seq: ++seq, round: 0, rounds: 4, me: { name: 'Me' }, opp: { name: 'Zed' }, totals: { human: 0, cpu: 0 }, paused: false, over: null, log: [], banner: '', modal: null, awaiting: aw,
      game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [T(12, 1), T(3, 4), T(5, 6)] }, { id: 'cpu', name: 'Zed', hand: [T(-1, -1)] }], boneyard: [T(-1, -1)], trains: { human: tr('human'), cpu: tr('cpu'), mexican: tr('mexican') }, openDouble: null, opening: { human: { finished: true }, cpu: { finished: true } } } });
    const move = { kind: 'move', moves: [{ tile: T(12, 1), trainId: 'human', placed: T(12, 1), newEnd: 1 }, { tile: T(12, 1), trainId: 'mexican', placed: T(12, 1), newEnd: 1 }] };
    ws.say({ t: 'state', seq: 1, view: view(move), events: [] });
    ok(hintsIn(c.html).length === 0 && !/Show hints/.test(c.html), 'online with hints not allowed: the same hint-free screen, no Show hints button' + (hintsIn(c.html)[0] ? ' (' + hintsIn(c.html).join(', ') + ')' : ''));
    ok(c.S.selectedKey === null, 'and no tile is picked for you');
    c.d({ type: 'selectTile', key: '3-4' });
    ok(c.S.selectedKey === '3-4', 'any tile can be picked up, including one that cannot be played');
    c.d({ type: 'playOn', train: 'human' });
    ok(!ws.sent.some(m => m.t === 'i') && /cannot be played/.test(c.html), 'putting it on a train sends nothing to the server, and says so');
    c.d({ type: 'selectTile', key: '3-4' }); c.d({ type: 'selectTile', key: '12-1' });
    ok(!ws.sent.some(m => m.t === 'i') && c.S.selectedKey === '12-1', 'picking up the tile that can be played does not play it, though it has two places to go');
    c.d({ type: 'playOn', train: 'cpu' });
    ok(!ws.sent.some(m => m.t === 'i'), 'the opponent\'s train is refused');
    c.d({ type: 'playOn', train: 'mexican' });
    const sent = ws.sent.filter(m => m.t === 'i');
    ok(sent.length === 1 && sent[0].a === 'play' && sent[0].train === 'mexican' && eq(sent[0].tile, [12, 1]), 'the right tile on a right train is sent to the server as a move');
    ws.say({ t: 'state', seq: 90, view: Object.assign(view(move), { game: Object.assign(view(move).game, { openDouble: { trainId: 'cpu', value: 5 } }) }), events: [] });
    ok(/class="track must" data-train="cpu"/.test(c.html) && /Cover the double here/.test(c.html) && !/class="track[^"]*\btarget\b/.test(c.html), 'online with hints off: the train with the open double is still outlined and labelled, and no train glows as a target');
    ok(/<button class="slot-draw calm" data-action="draw"[^>]*><span>Draw<\/span><\/button>/.test(c.html), 'and the hand has its plain Draw button on your turn');
    c.d({ type: 'draw' });
    ok(!ws.sent.some(m => m.a === 'draw'), 'asking to draw while a move exists is refused on the page: nothing is sent to the server');
  }
  function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
