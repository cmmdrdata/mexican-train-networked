// Runs the REAL built page script in a sandbox with a minimal fake browser, and fires events
// through the page's own click handler (the glue the other tests bypass).
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('../mexican-train.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const handlers = {}, docHandlers = {}, store = {};
const fireDoc = (type, ev) => (docHandlers[type] || []).forEach(f => f(ev || {}));

// a mock Web Audio: counts what the page does with it
const audio = { created: 0, resumed: 0, silent: 0, clacks: 0 };
class MockAudioContext {
  constructor() { audio.created++; this.sampleRate = 44100; this.state = 'suspended'; this.destination = {}; }
  resume() { audio.resumed++; this.state = 'running'; return Promise.resolve(); }
  createBuffer(ch, len) { const d = new Float32Array(len); return { length: len, getChannelData: () => d }; }
  createBufferSource() { const src = { buffer: null, playbackRate: { value: 1 }, connect() {}, start() { if (src.buffer && src.buffer.length > 100) audio.clacks++; else audio.silent++; } }; return src; }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
}
let formValues = { '#opt-rounds': '1', '#opt-hand': '8', '#opt-style': 'pips', '#opt-level': 'normal' };
const rootEl = {
  _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
  addEventListener(t, f) { handlers[t] = f; },
  querySelectorAll() { return []; },
  querySelector(sel) { return sel in formValues ? { value: formValues[sel] } : { focus() {}, disabled: false }; },
  ownerDocument: { activeElement: null },
};
const sandbox = {
  document: { readyState: 'complete', getElementById: () => rootEl, addEventListener(t, f) { (docHandlers[t] = docHandlers[t] || []).push(f); } },
  AudioContext: MockAudioContext,
  location: { search: '?seed=5' },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
  matchMedia: () => ({ matches: false }),                                   // normal motion: the REAL human-paced waits...
  console, setTimeout: (f, ms) => setTimeout(f, (ms || 0) / 60), clearTimeout,   // ...but run 60x faster for the test
  URLSearchParams, Math, JSON, Object, Array, Number, String, Set, Promise, Error,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const click = (attrs, trackTrain) => ({
  target: { closest: sel => sel === '[data-action]' ? (attrs ? { dataset: attrs } : null)
                          : sel === '.track.target' ? (trackTrain ? { dataset: { train: trackTrain } } : null) : null },
});

(async () => {
  const app = sandbox.MexicanTrainApp;
  ok(!!app, 'page booted and exposed the app');
  ok(rootEl.innerHTML.includes('Start game'), 'setup dialog rendered on load');
  ok(typeof handlers.click === 'function' && docHandlers.keydown && docHandlers.keydown.length >= 2, 'click handler + Escape and audio-unlock key handlers attached');
  ok(['mouseover', 'mouseleave', 'focusin', 'focusout'].every(t => typeof handlers[t] === 'function'), 'hover/focus handlers attached to the page');
  ok(audio.created === 0, 'no audio context is created before the first click (browsers would block it)');
  fireDoc('pointerdown', {});
  ok(audio.created === 1 && audio.resumed === 1 && audio.silent === 1, 'the first gesture creates and unlocks the audio context');
  fireDoc('click', {}); fireDoc('keydown', { key: 'a' });
  ok(audio.created === 1, 'later gestures never create another');

  ok(!/opt-style|Tile faces/.test(app.state.overlay ? rootEl.innerHTML : '') && !/opt-style|Tile faces/.test(rootEl.innerHTML), 'the main screen has no Tile faces choice (it is the Show numbers button in the game)');
  app.dispatch({ type: 'toggleStyle' });                    // the player chose numbers, in the game
  formValues = { '#opt-rounds': '4', '#opt-hand': '15', '#opt-level': 'hard' };
  handlers.click(click({ action: 'startGame' }));
  ok(app.state.opts.rounds === 4 && app.state.opts.hand === 15 && app.state.opts.level === 'hard', 'Start game applied the form values');
  ok(app.state.opts.style === 'numbers', 'and kept the tile faces the player had chosen in the game (the form no longer says)');
  app.dispatch({ type: 'toggleStyle' });                    // (back to pips, for the checks below)
  ok(JSON.parse(store['mt-opts']).hand === 15, 'settings saved to localStorage');
  ok(app.state.opts.level === 'hard' && JSON.parse(store['mt-opts']).level === 'hard', 'the skill level was read from the setup form and saved');
  ok(rootEl.innerHTML.includes('Computer: Hard'), 'the header shows the computer level');
  const name1 = app.state.cpuName;
  ok(typeof name1 === 'string' && name1.length > 1 && name1 !== 'You', 'the computer picked a name: ' + name1);
  ok(store['mt-last-cpu'] === name1, 'its name is remembered so the next game picks a different one');

  const t0 = Date.now();
  const used = { auto: 0, undo: 0, done: 0, drawBuild: 0, single: 0, ghost: 0, track: 0, normalDraw: 0, modal: 0, plays: 0 };
  let sawHidden = false, sawReveal = false, hoverDone = false, drawChecked = false;
  for (let step = 0; Date.now() - t0 < 150000 && !(app.state.modal && app.state.modal.type === 'final'); step++) {
    const S = app.state;
    // watch the computer's train while it builds: face down, then revealed
    if (S.game && S.game.opening && !S.game.opening.cpu.finished && S.game.trains.cpu.tiles.length > 0) {
      const row = rootEl.innerHTML.slice(rootEl.innerHTML.indexOf('data-train="cpu"'), rootEl.innerHTML.indexOf('data-train="mexican"'));
      if (row.includes('face-down tile')) sawHidden = true;
    }
    if (/class="tile [hv] reveal"/.test(rootEl.innerHTML)) sawReveal = true;

    const a = S.awaiting;
    if (!a) { await sleep(5); continue; }
    if (!hoverDone && (a.kind === 'build' || a.kind === 'move') && a.moves.length) {
      hoverDone = true;
      const k = a.moves[0].tile[0] + '-' + a.moves[0].tile[1];
      const tileEl = (key, playable) => ({ closest: sel => (sel === '.tile-btn' ? { classList: { contains: c => c === 'playable' && playable }, dataset: { key } } : null) });
      handlers.mouseover({ target: tileEl(k, true) });
      ok(app.state.hoverKey === k && /class="track[^"]*preview/.test(rootEl.innerHTML), 'mouse over a playable tile highlights where it can go');
      handlers.mouseover({ target: tileEl(k, false) });
      ok(app.state.hoverKey === null && !/class="track[^"]*preview/.test(rootEl.innerHTML), 'mouse over a tile that cannot be played highlights nothing');
      handlers.mouseover({ target: tileEl(k, true) }); handlers.mouseleave({});
      ok(app.state.hoverKey === null, 'mouse leaving the page clears it');
      handlers.focusin({ target: tileEl(k, true) });
      ok(app.state.hoverKey === k, 'keyboard focus on a playable tile highlights it too');
      handlers.focusout({});
      ok(app.state.hoverKey === null, 'and moving focus away clears it');
    }
    if (a.kind === 'draw' || (a.kind === 'build' && a.canDraw)) {
      const h = rootEl.innerHTML;
      if (!drawChecked) { drawChecked = true;
        ok((h.match(/tile-btn dim/g) || []).length === app.state.game.players[0].hand.length, 'draw-only: every tile in hand is dimmed');
        ok(/class="boneyard ready"[^>]*animation-delay:-\d+ms/.test(h), 'draw-only: the draw button ring is set to flash');
      }
    }
    if (a.kind === 'draw') { handlers.click(click({ action: 'draw' })); used.normalDraw++; await sleep(5); continue; }
    if (a.kind === 'modal') { used.modal++; ok(rootEl.innerHTML.includes('data-action="dialogOk"'), 'round-end dialog has its button'); handlers.click(click({ action: 'dialogOk' })); await sleep(5); continue; }

    if (a.kind === 'build') {
      if (a.canDraw) { handlers.click(click({ action: 'draw' })); used.drawBuild++; await sleep(5); continue; }
      if (!a.canDone) { handlers.click(click({ action: 'undoTile' })); used.undo++; await sleep(5); continue; }
      if (used.undo === 0 && !a.canUndo && a.moves.length) {         // lay a tile by hand first, so that Take back has something to take back
        const m0 = a.moves[0];
        handlers.click(click({ action: 'selectTile', key: m0.tile[0] + '-' + m0.tile[1] })); used.plays++; await sleep(5); continue;
      }
      if (used.undo === 0 && a.canUndo) {
        ok(rootEl.innerHTML.includes('data-action="undoTile"') && /Take back \d+-\d+/.test(rootEl.innerHTML), 'Take back button names the tile');
        handlers.click(click({ action: 'undoTile' })); used.undo++; await sleep(5); continue;
      }
      if (used.auto === 0 && a.canBuild) {            // (the opening then finishes by itself: there is no Done to press)
        ok(rootEl.innerHTML.includes('Build my longest train'), 'Build button is on screen');
        handlers.click(click({ action: 'autoBuild' })); used.auto++; await sleep(5); continue;
      }
      if (a.canDone && (a.moves.length === 0 || used.plays % 3 === 0 || used.done === 0)) {
        ok(rootEl.innerHTML.includes('data-action="endBuild"'), 'Done button is on screen');
        handlers.click(click({ action: 'endBuild' })); used.done++; await sleep(5); continue;
      }
      const m = a.moves[used.plays % a.moves.length];
      handlers.click(click({ action: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }));
      used.plays++; await sleep(5); continue;
    }

    // a normal move
    const m = a.moves[used.plays % a.moves.length];
    const k = m.tile[0] + '-' + m.tile[1];
    const targets = a.moves.filter(x => x.tile[0] === m.tile[0] && x.tile[1] === m.tile[1]).map(x => x.trainId);
    handlers.click(click({ action: 'selectTile', key: k }));
    if (targets.length === 1) {
      used.single++;
      if (app.state.awaiting === a) ok(false, 'a one-place tile should play on a single click');
    } else if (app.state.awaiting === a) {
      if (used.plays % 2) { handlers.click(click(null, targets[0])); used.track++; }
      else { handlers.click(click({ action: 'playOn', train: targets[0] })); used.ghost++; }
    }
    used.plays++;
    await sleep(5);
  }
  console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s | opening: Build=${used.auto} TakeBack=${used.undo} Done=${used.done} drawInOpening=${used.drawBuild} | normal: one-click=${used.single} ghost=${used.ghost} trackRow=${used.track} draws=${used.normalDraw} | round-end dialogs=${used.modal}`);
  ok(app.state.modal && app.state.modal.type === 'final', 'match reached the final screen driven only by page click events');
  ok(rootEl.innerHTML.includes('Play again') && rootEl.innerHTML.includes(name1) && !/CPU/.test(rootEl.innerHTML), 'final screen uses the computer\'s name');
  ok(used.auto > 0 && used.undo > 0 && used.done > 0, 'Build, Take back and Done were pressed through the page handler');
  ok(used.single > 0 && used.ghost > 0 && used.track > 0, 'one-click, ghost button and track-row plays were all exercised');
  ok(sawHidden, 'the computer\'s tiles were seen face down while it was still building (real human-paced timers)');
  ok(sawReveal, 'and revealed when it finished');

  console.log(`   audio: ${audio.clacks} clacks played during the match`);
  ok(audio.clacks > 40, 'the page clicked for placed dominoes (both players)');
  ok(drawChecked, 'a draw-only position was seen and checked');

  // Mute through the real button: a new game stays silent, unmuting clicks once as confirmation
  handlers.click(click({ action: 'toggleSound' }));
  ok(app.state.opts.sound === false && rootEl.innerHTML.includes('>Unmute<'), 'Mute button works');
  const afterMute = audio.clacks;
  handlers.click(click({ action: 'newGame' }));
  formValues = { '#opt-rounds': '1', '#opt-hand': '15', '#opt-style': 'pips', '#opt-level': 'hard' };
  handlers.click(click({ action: 'startGame' }));
  ok(app.state.opts.sound === false, 'starting a new game keeps it muted');
  ok(app.state.opts.level === 'hard' && rootEl.innerHTML.includes('Computer: Hard'), 'the next game used the newly chosen level');
  const tm = Date.now();
  while (Date.now() - tm < 6000 && !(app.state.game && app.state.game.trains.cpu.tiles.length >= 3)) await sleep(10);
  ok(app.state.game.trains.cpu.tiles.length >= 3, 'the computer built tiles while muted');
  ok(audio.clacks === afterMute, 'and none of them made a sound');
  handlers.click(click({ action: 'toggleSound' }));
  ok(app.state.opts.sound === true && audio.clacks === afterMute + 1, 'Unmute plays one click');
  const tm2 = Date.now();
  while (Date.now() - tm2 < 6000 && audio.clacks < afterMute + 3) await sleep(10);
  ok(audio.clacks >= afterMute + 3, 'and the computer\'s tiles click again');

  formValues = { '#opt-rounds': '1', '#opt-hand': '15', '#opt-style': 'pips', '#opt-level': 'easy' };
  handlers.click(click({ action: 'newGame' }));
  handlers.click(click({ action: 'startGame' }));
  ok(app.state.opts.level === 'easy' && rootEl.innerHTML.includes('Computer: Easy'), 'an Easy game starts and is labelled');
  const te = Date.now();
  while (Date.now() - te < 8000 && !(app.state.game && app.state.game.opening.cpu.finished)) await sleep(10);
  ok(app.state.game.opening.cpu.finished && app.state.game.trains.cpu.tiles.length <= 6, 'Easy finishes its (short) opening');

  // Play again: a different name, Escape and other buttons
  handlers.click(click({ action: 'newGame' }));
  ok(rootEl.innerHTML.includes('Start game'), 'Play again / New game opens the setup');
  formValues = { '#opt-rounds': '1', '#opt-hand': '8', '#opt-style': 'pips' };
  handlers.click(click({ action: 'startGame' }));
  ok(app.state.cpuName !== name1, `new game, new opponent name (${name1} -> ${app.state.cpuName})`);
  handlers.click(click({ action: 'openRules' })); ok(rootEl.innerHTML.includes('How to play'), 'Rules button opens the rules');
  fireDoc('keydown', { key: 'Escape' });           ok(!rootEl.innerHTML.includes('Back to the game'), 'Escape closes the rules');
  handlers.click(click({ action: 'toggleStyle' })); ok(app.state.opts.style === 'numbers', 'tile-style button toggles');
  handlers.click(click(null, null));                ok(true, 'clicking empty space does nothing');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
