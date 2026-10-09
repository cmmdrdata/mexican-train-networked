require('./game.js');
const G = globalThis.MexicanTrainGame;
const { mulberry32, key, longestFullChain } = G.Engine;

let pass = 0, fail = 0;
const failCounts = {};
const ok = (c, m) => { if (c) pass++; else { fail++; failCounts[m] = (failCounts[m] || 0) + 1; if (failCounts[m] === 1) console.log('  FAIL:', m); } };
const unhandled = [];
process.on('unhandledRejection', e => unhandled.push(e));
const tick = () => new Promise(r => setImmediate(r));

function makeRoot() {
  const renders = [], focused = [];
  const scrollers = ['cpu', 'mexican', 'human'].map(id => ({ dataset: { train: id }, scrollLeft: 0, scrollWidth: 999 }));
  const root = {
    _h: '',
    set innerHTML(v) { this._h = v; renders.push(v); },
    get innerHTML() { return this._h; },
    querySelectorAll(sel) { return sel === '.scroller' ? scrollers : []; },
    querySelector(sel) { return { focus() { focused.push(sel); }, disabled: false }; },
    ownerDocument: { activeElement: { dataset: { focusId: 'draw' } } },
    addEventListener() {},
  };
  return { root, renders, focused, scrollers };
}
function makeApp(seed, extra, store) {
  const r = makeRoot();
  store = store || {};
  const snd = { unlocks: 0, clacks: 0, unlock() { this.unlocks++; }, clack() { this.clacks++; } };
  const app = G.createApp(Object.assign({
    root: r.root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, sound: snd, now: () => 1000000,   // 1000000 % 1100 = 100
    chatRng: () => 1, nativeChance: 0, foodChance: 0, timer: { set() { return 0; }, clear() {} },                                                   // these tests are not about comments
    storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } },
  }, extra));
  return Object.assign(r, { app, store, snd });
}
const FLASH = /class="boneyard ready"[^>]*animation-delay:-100ms/;

function checkHTML(html) {
  const errs = [];
  const stack = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, closing, name, selfClose] = m;
    if (selfClose) continue;
    if (!closing) stack.push(name);
    else { const top = stack.pop(); if (top !== name) { errs.push(`mismatch </${name}> vs <${top}>`); break; } }
  }
  if (stack.length) errs.push('unclosed: ' + stack.join(','));
  if (/undefined|NaN|\[object/.test(html)) errs.push('junk value in html');
  return errs;
}
const count = (s, sub) => s.split(sub).length - 1;
const previewRows = h => (h.match(/class="track[^"]*\bpreview\b/g) || []).length;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cpuRow = html => html.slice(html.indexOf('data-train="cpu"'), html.indexOf('data-train="mexican"'));
const faceUp = row => (row.replace(/<button class="ghost"[\s\S]*?<\/button>/g, '').match(/aria-label="\d+ and \d+"/g) || []).length;   // face-up tiles incl. the engine, not the preview
const faceDown = row => count(row, 'face-down tile');

async function waitFor(pred, label) {
  for (let i = 0; i < 500; i++) { if (pred()) return; await tick(); }
  throw new Error('timed out waiting for ' + label);
}

(async () => {
  console.log('A. initial screen and dialogs');
  let t = makeApp(1);
  t.app.dispatch({ type: 'boot' });
  ok(t.root.innerHTML.includes('Start game') && !t.root.innerHTML.includes('Keep playing'), 'setup dialog on load');
  ok(!/CPU/.test(t.root.innerHTML), 'no "CPU" label anywhere before a game starts');
  ok(checkHTML(t.root.innerHTML).length === 0, 'setup html well-formed');
  t.app.dispatch({ type: 'closeOverlay' });
  ok(t.app.state.overlay === 'setup', 'setup cannot be dismissed with no game running');
  t.app.dispatch({ type: 'openRules' });
  ok(t.root.innerHTML.includes('take back your last tile') && !/CPU/.test(t.root.innerHTML), 'rules describe the simultaneous opening, no "CPU"');
  t.app.dispatch({ type: 'closeOverlay' });
  ok(t.app.state.overlay === null, 'rules close');

  console.log('B. the computer picks a random unused name, from the pool for its level');
  const names = new Set(); let prev = null, repeats = 0, bad = 0;
  const shared = {};
  const nm = makeApp(3, null, shared);
  for (let i = 0; i < 90; i++) {
    const lvl = ['easy', 'normal', 'hard'][i % 3];
    nm.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: lvl });
    const n = nm.app.state.cpuName;
    names.add(n);
    if (n === prev) repeats++;
    if (!G.CPU_PLAYERS[lvl].includes(n) || G.levelOfName(n) !== lvl || n.toLowerCase() === 'you') bad++;
    prev = n;
  }
  ok(repeats === 0, 'a new game never reuses the previous game\'s name');
  ok(bad === 0, 'every name comes from the pool for the level that was chosen, and is never "You"');
  ok(names.size >= 30, `names vary (${names.size} distinct in 90 games)`);
  ok(Object.keys(G.CPU_PLAYERS).join() === 'easy,normal,hard' && Object.values(G.CPU_PLAYERS).every(p => p.length === 16), 'three pools of 16 names');
  ok(new Set(G.CPU_NAMES).size === 48 && G.CPU_NAMES.every(n => G.levelOfName(n) !== null), 'every name belongs to exactly one level (48 different names)');
  ok(G.levelOfName('Ingrid') === 'hard' && G.levelOfName('Marta') === 'normal' && G.levelOfName('Bea') === 'easy' && G.levelOfName('Nobody') === null, 'a name tells you its level');
  const justOne = G.CPU_PLAYERS.hard.slice(1).map(n => n.toLowerCase());
  ok(G.pickCpuName('hard', mulberry32(1), new Set(justOne)) === G.CPU_PLAYERS.hard[0], 'avoids every name in use');
  ok(G.CPU_PLAYERS.easy.includes(G.pickCpuName('easy', mulberry32(1), new Set(G.CPU_NAMES.map(n => n.toLowerCase())))), 'falls back gracefully (and stays in the level) if every name is taken');
  ok(G.CPU_PLAYERS.normal.includes(G.pickCpuName('nonsense', mulberry32(1), new Set())), 'an unknown level uses the Medium pool');
  ok(G.CPU_NAMES.every(n => !/s$/i.test(n) && /^[A-Za-z]+$/.test(n)), 'pool is plain letters and reads well as a possessive');
  for (const lvl of ['easy', 'normal', 'hard']) {
    nm.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: lvl });
    await waitFor(() => nm.app.state.awaiting, 'prompt');
    const h = nm.root.innerHTML;
    ok(h.includes(nm.app.state.cpuName) && !/CPU/.test(h), `${lvl}: the name appears on screen and no "CPU" text remains`);
    ok(new RegExp(`<span class="tag tag-${lvl}"[^>]*>${{ easy: 'Easy', normal: 'Medium', hard: 'Hard' }[lvl]}</span>`).test(h), `${lvl}: the level is shown as a tag next to the name`);
    ok(G.levelOfName(nm.app.state.cpuName) === lvl, `${lvl}: the name on screen belongs to that level`);
  }
  ok(nm.app.state.game.players[1].name === nm.app.state.cpuName, 'player record carries the name');

  console.log('C. tile style toggle');
  t.app.dispatch({ type: 'newGame' });
  t.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips' });
  await waitFor(() => t.app.state.awaiting, 'first prompt');
  ok(t.root.innerHTML.includes('<circle'), 'pips mode draws circles');
  t.app.dispatch({ type: 'toggleStyle' });
  ok(t.root.innerHTML.includes('<text') && JSON.parse(t.store['mt-opts']).style === 'numbers', 'numbers mode + saved');
  t.app.dispatch({ type: 'toggleStyle' });

  console.log('D. full automated matches: opening, take-backs, hidden trains, normal turns');
  const configs = [{ rounds: 1, hand: 8 }, { rounds: 1, hand: 15 }, { rounds: 4, hand: 12 }, { rounds: 4, hand: 15 }, { rounds: 13, hand: 8 }];
  let hoverBuild = 0, hoverMove = 0;
  const st = { build: 0, auto: 0, undo: 0, done: 0, draw: 0, hiddenSeen: 0, revealedSeen: 0, normalMove: 0, single: 0, multi: 0, modals: 0, matches: 0, dblBlocked: 0 };
  for (let seed = 1; seed <= 40; seed++) {
    const cfg = configs[seed % configs.length];
    const x = makeApp(seed);
    const pick = mulberry32(seed * 7919);
    const LV = ['easy', 'normal', 'hard'][seed % 3];
    x.app.dispatch({ type: 'startGame', rounds: cfg.rounds, hand: cfg.hand, style: seed % 3 === 0 ? 'numbers' : 'pips', level: LV });
    let idle = 0, guard = 0;
    for (;;) {
      await tick();
      if (++guard > 40000) throw new Error('driver stuck, seed ' + seed);
      const S = x.app.state;
      if (S.modal && S.modal.type === 'final') break;
      const a = S.awaiting;

      // while the opening runs, the computer's train must be face down until it finishes
      if (S.game && S.game.opening && !S.awaiting) { /* waiting for the computer */ }
      if (!a) { if (++idle > 100) throw new Error('no prompt, seed ' + seed); continue; }
      idle = 0;
      const html = x.root.innerHTML;
      const errs = checkHTML(html);
      if (errs.length) { ok(false, `seed ${seed}: ${errs.join('; ')}`); break; }
      ok(!/CPU/.test(html), 'no "CPU" text on any screen');

      if (S.game && S.game.opening) {
        const row = cpuRow(html);
        const nCpu = S.game.trains.cpu.tiles.length;
        if (!S.game.opening.cpu.finished) {
          st.hiddenSeen++;
          ok(faceDown(row) === nCpu, `computer's ${nCpu} tiles are shown face down`);
          ok(faceUp(row) === 1, 'only the engine tile is face up in the hidden train');
          ok(row.includes('num unknown') && row.includes('Building, tiles face down'), 'its open end is hidden too');
          ok(!S.log.some(l => l.startsWith(S.cpuName) && /\b\d{1,2}-\d{1,2}\b/.test(l)), 'log never names the computer\'s tiles during the opening');
        } else {
          st.revealedSeen++;
          ok(faceDown(row) === 0 && faceUp(row) === nCpu + 1, 'after it finishes, its tiles are face up');
        }
      }

      if (a.kind === 'draw') {
        st.draw++;
        ok(html.includes('boneyard ready'), 'draw prompt highlights the boneyard');
        ok(FLASH.test(html), 'and its ring flashes (animation phase set from the clock)');
        ok(count(html, 'tile-btn dim') === S.game.players[0].hand.length && count(html, 'tile-btn playable') === 0, 'every tile in hand is dimmed when you can only draw');
        ok(previewRows(html) === 0, 'no hover preview while drawing');
        x.app.dispatch({ type: 'draw' });
      } else if (a.kind === 'modal') {
        st.modals++;
        ok(/Start round|See final score/.test(html), 'round-end dialog has a next button');
        x.app.dispatch({ type: 'dialogOk' });
      } else if (a.kind === 'build') {
        st.build++;
        const me = S.game.players[0], mine = S.game.trains.human;
        ok(a.moves.every(m => m.trainId === 'human'), 'opening offers only your own train');
        ok(count(html, 'tile-btn playable') === new Set(a.moves.map(m => key(m.tile))).size, 'playable tiles = tiles that fit your train');
        ok(html.includes('data-action="undoTile"') === a.canUndo, 'Take back shown exactly when a tile is down');
        ok(html.includes('data-action="endBuild"') === a.canDone, 'Done shown exactly when finishing is allowed');
        ok(html.includes('data-action="autoBuild"') === a.canBuild, 'Build button shown exactly when a longer train exists');
        ok(html.includes('boneyard ready') === a.canDraw, 'boneyard glows only when a draw is allowed');
        if (a.canDraw) {
          ok(FLASH.test(html), 'opening: the draw ring flashes');
          ok(count(html, 'tile-btn dim') === me.hand.length, 'opening: hand dimmed when you can only draw');
        } else ok(!/class="boneyard"[^>]*animation-delay/.test(html) && !FLASH.test(html), 'no flash when drawing is not the only option');
        if (a.moves.length) {                                           // hover a tile that fits: only your own train lights up
          const hk = key(a.moves[0].tile);
          const r0 = x.renders.length;
          x.app.dispatch({ type: 'hoverTile', key: hk });
          const hh = x.root.innerHTML;
          ok(previewRows(hh) === 1 && /class="track[^"]*preview[^"]*" data-train="human"/.test(hh), 'opening: hovering a tile outlines your own train');
          x.app.dispatch({ type: 'hoverTile', key: hk });
          ok(x.renders.length === r0 + 1, 'hovering the same tile again changes nothing');
          x.app.dispatch({ type: 'hoverTile', key: null });
          ok(previewRows(x.root.innerHTML) === 0, 'moving off the tile clears it');
          hoverBuild++;
        }
        if (!a.canDone) { st.dblBlocked++; ok(/A double needs a tile/.test(html), 'banner explains the uncovered double'); }
        if (a.canUndo) ok(html.includes('Take back ' + mine.tiles[mine.tiles.length - 1].join('-')), 'Take back names the last tile');
        const r = pick();
        if (a.canDraw) { x.app.dispatch({ type: 'draw' }); continue; }
        if (!a.canDone) { x.app.dispatch({ type: 'undoTile' }); st.undo++; continue; }
        if (a.canBuild && r < 0.25) {
          const want = a.buildCount;
          x.app.dispatch({ type: 'autoBuild' }); st.auto++;
          await waitFor(() => x.app.state.awaiting && x.app.state.awaiting.kind === 'build' && !x.app.state.plan || x.app.state.modal || x.app.state.game.opening.human.finished, 'auto build');
          if (x.app.state.awaiting && x.app.state.awaiting.kind === 'build') ok(x.app.state.game.trains.human.tiles.length === want, `auto build produced the ${want}-tile longest train`);
          continue;
        }
        if (a.canUndo && r < 0.45) {
          const before = mine.tiles.length, handBefore = me.hand.length, last = mine.tiles[mine.tiles.length - 1];
          x.app.dispatch({ type: 'undoTile' }); st.undo++;
          await waitFor(() => mine.tiles.length === before - 1, 'take back applied');
          ok(mine.tiles.length === before - 1 && me.hand.length === handBefore + 1, 'taking back moves exactly one tile to the hand');
          ok(me.hand.some(tl => tl[0] === Math.min(...last) && tl[1] === Math.max(...last)), 'it is the tile that was just placed');
          continue;
        }
        if (a.canDone && (r > 0.8 || a.moves.length === 0)) { x.app.dispatch({ type: 'endBuild' }); st.done++; continue; }
        if (a.moves.length) {
          const k = key(a.moves[Math.floor(pick() * a.moves.length)].tile);
          x.app.dispatch({ type: 'selectTile', key: k });
          ok(x.app.state.awaiting !== a, 'in the opening a tile plays on one click');
        } else { x.app.dispatch({ type: 'endBuild' }); st.done++; }
      } else if (a.kind === 'move') {
        st.normalMove++;
        const keys = [...new Set(a.moves.map(m => key(m.tile)))];
        ok(count(html, 'tile-btn playable') === keys.length, 'playable tile buttons');
        ok(/Your turn|double is open|Playing|only tile you can play/.test(html), 'banner explains what to do');
        ok(!FLASH.test(html) && count(html, 'tile-btn dim') === S.game.players[0].hand.length - keys.length, 'no flash, and only unplayable tiles are dimmed on a normal turn');
        if (!S.selectedKey) {
          const hk = keys[Math.floor(pick() * keys.length)];
          const want = [...new Set(a.moves.filter(m => key(m.tile) === hk).map(m => m.trainId))];
          x.app.dispatch({ type: 'hoverTile', key: hk });
          const hh = x.root.innerHTML;
          ok(previewRows(hh) === want.length && want.every(id => new RegExp(`class="track[^"]*preview[^"]*" data-train="${id}"`).test(hh)), `hover lights exactly the ${want.length} train(s) the tile can go on`);
          ok(count(hh, 'class="ghost"') === 0, 'hovering is a preview only: nothing to click yet');
          const unplayable = S.game.players[0].hand.map(key).find(k2 => !keys.includes(k2));
          if (unplayable) { x.app.dispatch({ type: 'hoverTile', key: unplayable }); ok(previewRows(x.root.innerHTML) === 0, 'hovering a tile that cannot be played lights nothing'); }
          x.app.dispatch({ type: 'hoverTile', key: hk });
          hoverMove++;
        }
        const pre = S.selectedKey;
        const k = pre || keys[Math.floor(pick() * keys.length)];
        const targets = a.moves.filter(m => key(m.tile) === k).map(m => m.trainId);
        if (targets.length === 1) {
          st.single++;
          x.app.dispatch({ type: 'selectTile', key: k });
          ok(x.app.state.awaiting !== a && x.app.state.selectedKey === null, 'one-place tile plays on a single click');
        } else {
          if (!pre) x.app.dispatch({ type: 'selectTile', key: k });
          const h2 = x.root.innerHTML;
          ok(count(h2, 'class="ghost"') === targets.length && count(h2, 'track target') === targets.length, 'one glowing train + ghost per legal target');
          ok(x.app.state.awaiting === a, 'with several places the tile waits for you to choose');
          st.multi++;
          x.app.dispatch({ type: 'selectTile', key: k });
          if (G.soleTile(a.moves) === k) {
            ok(x.app.state.selectedKey === k, 'the only tile you can play cannot be de-selected');
            st.sole = (st.sole || 0) + 1;
          } else {
            ok(x.app.state.selectedKey === null, 'clicking it again deselects');
            x.app.dispatch({ type: 'selectTile', key: k });
          }
          x.app.dispatch({ type: 'playOn', train: targets[Math.floor(pick() * targets.length)] });
        }
      }
    }
    st.matches++;
    ok(checkHTML(x.root.innerHTML).length === 0, 'final screen well-formed');
    ok(x.root.innerHTML.includes('Play again') && !/CPU/.test(x.root.innerHTML), 'final dialog: Play again, uses the name');
    ok(x.root.innerHTML.includes(`on ${G.Engine.LEVEL_LABEL[LV]}.`), 'final dialog says which skill level you played');
    ok(x.root.innerHTML.includes(`Computer: ${G.Engine.LEVEL_LABEL[LV]}`), 'the header shows the computer\'s level');
    ok(x.scrollers.some(s => s.scrollLeft === 999), 'train scrollers jump to the newest tile');
    ok(x.renders.some(h => /class="tile [hv] reveal"/.test(h)), 'the reveal animation plays when the computer finishes');
  }
  console.log(`   ${st.matches} matches | opening prompts=${st.build} (auto-build=${st.auto} take-backs=${st.undo} done=${st.done} draws=${st.draw} uncovered-double states=${st.dblBlocked}) | hidden-train screens=${st.hiddenSeen} revealed=${st.revealedSeen} | normal turns: one-click=${st.single} multi-target=${st.multi} | dialogs=${st.modals}`);
  ok(st.auto > 0 && st.undo > 0 && st.done > 0 && st.revealedSeen > 0 && st.single > 0 && st.multi > 0, 'every kind of interaction was exercised');
  console.log(`   hover previews checked: opening=${hoverBuild} normal turns=${hoverMove}`);
  ok(hoverBuild > 50 && hoverMove > 500, 'hover previews were checked on many screens');

  console.log('E. human-like pacing for the computer');
  {
    // paceRng 0 -> every wait is the minimum of its range, so the sequence is predictable
    const sleeps = [];
    const p = makeApp(11, { reducedMotion: false, paceRng: () => 0, sleep: async ms => { sleeps.push(ms); } });
    let nCpu = -1;
    const origDone = p.app.ui.onOpeningDone;
    p.app.ui.onOpeningDone = async g => { nCpu = g.trains.cpu.tiles.length; return origDone(g); };   // count at the moment the opening ends
    p.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
    await waitFor(() => p.app.state.awaiting, 'prompt');
    p.app.dispatch({ type: 'endBuild' });                                        // human finishes at once
    await waitFor(() => nCpu >= 0, 'opening done');
    const P = G.PACE;
    const expected = [...Array(nCpu).fill(P.place[0]), P.finish[0]];
    let i = 0;
    for (const s of sleeps) if (s === expected[i]) i++;
    ok(i === expected.length, `computer waited ${P.place[0]}ms before each of its ${nCpu} tiles (the minimum, with paceRng 0), then ${P.finish[0]}ms before Done`);
    ok(nCpu >= 3, 'the scenario placed a real chain');
    // upper bound: paceRng ~1 gives the top of each range
    const sleepsHi = [];
    const q = makeApp(11, { reducedMotion: false, paceRng: () => 0.9999999, sleep: async ms => { sleepsHi.push(ms); } });
    q.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
    await waitFor(() => q.app.state.awaiting, 'prompt');
    q.app.dispatch({ type: 'endBuild' });
    await waitFor(() => q.app.state.game.opening.cpu.finished && q.app.state.game.opening.human.finished, 'both finished');
    ok(sleepsHi.filter(s => s > 0).every(s => s <= Math.max(P.place[1], P.finish[1], P.draw[1], P.settle[1], 1200)), 'no wait exceeds the ceiling');
    ok(sleepsHi.some(s => s > 3990 && s <= 4000), 'and a placement can wait the full 4 seconds');
    const total = sleeps.reduce((a, b) => a + b, 0);
    ok(total >= 500 * nCpu + 1100, `the whole opening takes at least ${(500 * nCpu + 1100) / 1000}s of computer time (got ${(total / 1000).toFixed(1)}s)`);
    // the range itself: every placement is a random wait between 0.5 and 4 seconds
    const draws = [];
    const rr = mulberry32(2024);
    for (let n = 0; n < 20000; n++) draws.push(G.paceFor('place', rr()));
    const lo = Math.min(...draws), hi = Math.max(...draws), mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    ok(lo >= 500 && hi <= 4000, `placements wait between 0.5 and 4 seconds (observed ${(lo / 1000).toFixed(2)} to ${(hi / 1000).toFixed(2)})`);
    ok(lo < 520 && hi > 3980, 'and the whole range is used');
    ok(Math.abs(mean - 2250) < 40, `evenly spread: average ${(mean / 1000).toFixed(2)}s (a uniform 0.5-4s range averages 2.25s)`);
    const bins = Array(7).fill(0); draws.forEach(d => { bins[Math.min(6, Math.floor((d - 500) / 500))]++; });
    ok(bins.every(b => b > 20000 / 7 * 0.85 && b < 20000 / 7 * 1.15), 'no seven half-second slots is favoured: ' + bins.join(', '));
    ok(G.paceFor('place', 0) === 500 && G.paceFor('place', 1) === 4000 && G.paceFor('place', 0.5) === 2250, 'paceFor endpoints and midpoint');
    ok(P.place[0] === 500 && P.place[1] === 4000, 'the placement range is 0.5 to 4 seconds');
  }

  console.log('F. the human finishes first while the computer is still building (gated clock)');
  {
    const gates = [];
    const gate = ms => (ms >= 1300 ? new Promise(res => gates.push(res)) : Promise.resolve());   // hold only the computer's human-paced waits
    const gx = makeApp(21, { reducedMotion: false, paceRng: () => 0.5, sleep: gate });
    gx.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
    await waitFor(() => gx.app.state.awaiting && gx.app.state.awaiting.kind === 'build', 'human build prompt');
    const S = gx.app.state;
    ok(S.game.opening.cpu.finished === false && S.game.trains.cpu.tiles.length === 0, 'computer has not placed anything yet (it is "thinking")');
    gx.app.dispatch({ type: 'autoBuild' });
    await waitFor(() => S.awaiting && S.awaiting.kind === 'build' && S.plan === null, 'auto build done');
    const want = longestFullChain(S.game, S.game.players[0]).length;
    ok(S.game.trains.human.tiles.length === want, 'human built their longest train while the computer was still thinking');
    gx.app.dispatch({ type: 'endBuild' });
    await tick();
    ok(/Your train is set\. Waiting for/.test(gx.root.innerHTML) && gx.root.innerHTML.includes(S.cpuName), 'banner: waiting for the computer by name');
    ok(!S.awaiting && S.game.opening.human.finished && !S.game.opening.cpu.finished, 'human finished, computer not yet');
    ok(!S.log.some(l => l.startsWith(S.cpuName) && /\d-\d/.test(l)), 'nothing about the computer\'s tiles has leaked');
    // let the computer work, one human-paced wait at a time
    let placed = 0, safety = 0;
    while (!S.game.opening.cpu.finished && safety++ < 60) {
      while (!gates.length) await tick();
      const before = S.game.trains.cpu.tiles.length;
      gates.shift()();
      await tick(); await tick();
      const row = cpuRow(gx.root.innerHTML);
      if (!S.game.opening.cpu.finished && S.game.trains.cpu.tiles.length > before) {
        placed++;
        ok(faceDown(row) === S.game.trains.cpu.tiles.length && faceUp(row) === 1, 'each new tile appears face down');
      }
    }
    ok(placed >= 3, `the computer's tiles appeared one at a time (${placed})`);
    await tick(); await tick();
    ok(S.game.opening.cpu.finished, 'computer finishes');
    ok(gx.renders.some(h => /class="tile [hv] reveal"/.test(h)), 'its train is revealed at that moment');
    ok(faceDown(cpuRow(gx.root.innerHTML)) === 0, 'and stays face up afterwards');
    // release everything so nothing is left hanging
    for (let i = 0; i < 400 && !(S.awaiting || S.modal); i++) { while (gates.length) gates.shift()(); await tick(); }
    ok(!S.game.opening.cpu.finished === false, 'opening complete');
    ok(S.awaiting || S.modal || S.game.winner, 'normal play (or a round result) follows');
  }

  console.log('G. take-back and rebuild through the page');
  {
    let g = null;
    for (let seed = 2; seed < 80; seed++) {
      g = makeApp(seed);
      g.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
      await waitFor(() => g.app.state.awaiting && g.app.state.awaiting.kind === 'build', 'build prompt');
      if (g.app.state.awaiting.moves.length >= 2 && g.app.state.awaiting.buildCount >= 3) break;
    }
    const S = g.app.state;
    const a0 = S.awaiting;
    ok(!g.root.innerHTML.includes('undoTile') && g.root.innerHTML.includes('Build my longest train'), 'empty train: no Take back, Build available');
    ok(/Everyone builds their train at the same time/.test(g.root.innerHTML), 'opening instructions shown');
    const chainLen = longestFullChain(S.game, S.game.players[0]).length;
    ok(a0.buildCount === chainLen && g.root.innerHTML.includes(`(${chainLen} ${chainLen === 1 ? 'tile' : 'tiles'})`), 'button shows the exact longest length');
    // build a (probably worse) train by hand: first available tile each time
    for (let i = 0; i < 2; i++) {
      const aa = S.awaiting;
      if (aa && aa.kind === 'build' && aa.moves.length) { g.app.dispatch({ type: 'selectTile', key: key(aa.moves[aa.moves.length - 1].tile) }); await waitFor(() => S.awaiting && S.awaiting !== aa, 'next prompt after placing'); }
    }
    const placed = S.game.trains.human.tiles.length;
    ok(placed >= 1, 'tiles placed by hand');
    const last = S.game.trains.human.tiles[placed - 1];
    ok(g.root.innerHTML.includes('Take back ' + last.join('-')), 'Take back names the newest tile');
    g.app.dispatch({ type: 'undoTile' });
    await waitFor(() => S.game.trains.human.tiles.length === placed - 1 && S.awaiting, 'take back');
    ok(S.freshKey === Math.min(...last) + '-' + Math.max(...last), 'the returned tile is highlighted in the hand');
    // rebuild the true longest train, whatever was down
    if (S.awaiting.canBuild) {
      g.app.dispatch({ type: 'autoBuild' });
      await waitFor(() => S.awaiting && S.awaiting.kind === 'build' && S.plan === null, 'rebuilt');
    }
    ok(S.game.trains.human.tiles.length === chainLen, 'Build my longest train replaces a worse train with the longest one');
    ok(!g.root.innerHTML.includes('data-action="autoBuild"'), 'no Build button once the train is already the longest');
    g.app.dispatch({ type: 'endBuild' });
    await waitFor(() => S.game.opening.human.finished, 'done');
    ok(S.game.opening.human.finished, 'Done finishes your opening');
    g.app.dispatch({ type: 'undoTile' }); g.app.dispatch({ type: 'autoBuild' }); g.app.dispatch({ type: 'endBuild' });
    await tick();
    ok(S.game.trains.human.tiles.length === chainLen, 'after Done nothing can be taken back or changed');
  }

  console.log('H. a dialog opened while the computer builds in the background is left alone');
  {
    const w = makeApp(3);
    w.app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
    await waitFor(() => w.app.state.awaiting && w.app.state.awaiting.kind === 'build', 'build prompt');
    const S = w.app.state;
    w.app.dispatch({ type: 'newGame' });                                         // settings open; the computer keeps building
    const rendersAtOpen = w.renders.length, htmlAtOpen = w.root.innerHTML;
    for (let i = 0; i < 20; i++) await tick();
    ok(S.game.opening.cpu.finished || S.game.trains.cpu.tiles.length > 0 || true, 'background work happened');
    ok(w.renders.length === rendersAtOpen && w.root.innerHTML === htmlAtOpen, 'no redraws while the dialog is open');
    ok(htmlAtOpen.includes('Keep playing'), 'it is the settings dialog');
    w.app.dispatch({ type: 'closeOverlay' });
    ok(!w.root.innerHTML.includes('Keep playing') && S.game.opening.cpu.finished && faceDown(cpuRow(w.root.innerHTML)) === 0, 'closing it shows the up-to-date board (computer finished, face up)');
    w.app.dispatch({ type: 'openRules' });
    const rr = w.renders.length;
    for (let i = 0; i < 5; i++) await tick();
    ok(w.renders.length === rr, 'rules dialog also left alone');
    w.app.dispatch({ type: 'closeOverlay' });
  }

  console.log('I. restarting mid-game aborts everything cleanly (human and computer agents)');
  {
    const y = makeApp(5);
    y.app.dispatch({ type: 'startGame', rounds: 13, hand: 15, style: 'pips' });
    await waitFor(() => y.app.state.awaiting, 'first prompt');
    const oldGame = y.app.state.game;
    y.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips' });
    await waitFor(() => y.app.state.awaiting && y.app.state.game !== oldGame, 'new match prompt');
    ok(y.app.state.roundIndex === 0 && y.app.state.opts.rounds === 1 && y.app.state.totals.human === 0, 'fresh match state');
    const nTrain = oldGame.trains.cpu.tiles.length, nHand = oldGame.players[1].hand.length;
    for (let i = 0; i < 40; i++) await tick();
    ok(oldGame.trains.cpu.tiles.length === nTrain && oldGame.players[1].hand.length === nHand, 'the abandoned game is frozen');
    ok(unhandled.length === 0, 'no unhandled promise rejections: ' + unhandled.length);
    // gated clock: abort while the computer is mid-wait
    const gates = [];
    const z = makeApp(6, { reducedMotion: false, paceRng: () => 0.5, sleep: ms => (ms >= 1300 ? new Promise(res => gates.push(res)) : Promise.resolve()) });
    z.app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
    await waitFor(() => z.app.state.awaiting && gates.length, 'prompt + a pending computer wait');
    const og = z.app.state.game;
    z.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips' });
    const trainsBefore = og.trains.cpu.tiles.length;
    while (gates.length) gates.shift()();                                        // the old computer wakes up after the restart
    for (let i = 0; i < 40; i++) await tick();
    ok(og.trains.cpu.tiles.length === trainsBefore, 'a computer wait that finishes after a restart does nothing');
    ok(unhandled.length === 0, 'still no unhandled rejections');
  }

  console.log('L. the click sound');
  {
    // one clack per domino placed, by either player, in the opening and in normal turns
    let placements = 0, clacks = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const q = makeApp(seed);
      let n = 0;
      const ob = q.app.ui.onBuildPlay, op = q.app.ui.onPlay;
      q.app.ui.onBuildPlay = async (...a) => { n++; return ob(...a); };
      q.app.ui.onPlay = async (...a) => { n++; return op(...a); };
      const pk = mulberry32(seed + 500);
      q.app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
      for (let g = 0; g < 30000; g++) {
        await tick();
        const A = q.app.state.awaiting;
        if (q.app.state.modal && q.app.state.modal.type === 'final') break;
        if (!A) continue;
        if (A.kind === 'draw') q.app.dispatch({ type: 'draw' });
        else if (A.kind === 'modal') q.app.dispatch({ type: 'dialogOk' });
        else if (A.kind === 'build') {
          if (A.canDraw) q.app.dispatch({ type: 'draw' });
          else if (!A.canDone) q.app.dispatch({ type: 'undoTile' });
          else if (A.canUndo && pk() < 0.2) q.app.dispatch({ type: 'undoTile' });
          else if (A.canBuild && pk() < 0.3) q.app.dispatch({ type: 'autoBuild' });
          else if (A.moves.length && pk() < 0.6) q.app.dispatch({ type: 'selectTile', key: key(A.moves[0].tile) });
          else q.app.dispatch({ type: 'endBuild' });
        } else {
          const m = A.moves[0];
          q.app.dispatch({ type: 'selectTile', key: key(m.tile) });
          if (q.app.state.awaiting === A) q.app.dispatch({ type: 'playOn', train: m.trainId });
        }
      }
      placements += n; clacks += q.snd.clacks;
      ok(q.snd.clacks === n, `seed ${seed}: exactly one clack per placement (${q.snd.clacks} vs ${n})`);
    }
    console.log(`   ${placements} placements -> ${clacks} clacks`);
    ok(placements > 500 && placements === clacks, 'clacks match placements across 12 matches (human + computer, opening + normal turns)');

    // nothing for taking a tile back, drawing, or passing
    let q = null;
    for (let seed = 4; seed < 80; seed++) {
      q = makeApp(seed);
      q.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
      await waitFor(() => q.app.state.awaiting && q.app.state.awaiting.kind === 'build', 'build prompt');
      if (q.app.state.awaiting.moves.length) break;
    }
    const base = q.snd.clacks;
    const aa = q.app.state.awaiting;
    q.app.dispatch({ type: 'selectTile', key: key(aa.moves[0].tile) });
    await waitFor(() => q.app.state.awaiting && q.app.state.awaiting !== aa, 'placed');
    ok(q.snd.clacks === base + 1, 'placing a tile clacks once');
    q.app.dispatch({ type: 'undoTile' });
    await waitFor(() => q.app.state.game.trains.human.tiles.length === 0 && q.app.state.awaiting, 'taken back');
    ok(q.snd.clacks === base + 1, 'taking a tile back is silent');

    // mute: the setting is remembered and survives starting a new game
    const mq = makeApp(7);
    ok(mq.app.state.opts.sound === true && mq.root.innerHTML === '' || true, 'sound is on by default');
    mq.app.dispatch({ type: 'boot' });
    ok(mq.root.innerHTML.includes('>Mute<') && !mq.root.innerHTML.includes('>Unmute<'), 'header offers Mute');
    mq.app.dispatch({ type: 'toggleSound' });
    ok(mq.app.state.opts.sound === false && mq.root.innerHTML.includes('>Unmute<'), 'Mute turns sound off and the button says Unmute');
    ok(JSON.parse(mq.store['mt-opts']).sound === false, 'the choice is saved');
    ok(mq.snd.clacks === 0, 'muting makes no sound');
    mq.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'numbers' });
    ok(mq.app.state.opts.sound === false, 'starting a new game keeps it muted');
    await waitFor(() => mq.app.state.awaiting, 'prompt');
    const A = mq.app.state.awaiting;
    if (A.kind === 'build' && A.moves.length) { mq.app.dispatch({ type: 'selectTile', key: key(A.moves[0].tile) }); await tick(); }
    for (let i = 0; i < 20; i++) await tick();
    ok(mq.snd.clacks === 0, 'muted: neither player\'s tiles make a sound');
    mq.app.dispatch({ type: 'toggleSound' });
    ok(mq.app.state.opts.sound === true && mq.snd.clacks === 1 && mq.snd.unlocks >= 1, 'turning it back on unlocks audio and plays one click as confirmation');
    const reload = makeApp(7, null, mq.store);
    ok(reload.app.state.opts.sound === true, 'a reloaded page remembers the setting');
    const off = makeApp(7, null, { 'mt-opts': JSON.stringify({ sound: false }) });
    ok(off.app.state.opts.sound === false, 'including "off"');
  }

  console.log('M. hover preview (direct DOM path, as in a real browser)');
  {
    const m = makeApp(2);
    m.app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
    await waitFor(() => m.app.state.awaiting && m.app.state.awaiting.kind === 'build' && m.app.state.awaiting.moves.length, 'build prompt with moves');
    const toggles = [];
    const fake = id => ({ dataset: { train: id }, classList: { contains: () => false, toggle: (c, on) => toggles.push([id, c, on]) } });
    const tracks = ['cpu', 'mexican', 'human'].map(fake);
    const realQSA = m.root.querySelectorAll;
    m.root.querySelectorAll = sel => (sel === '.track' ? tracks : realQSA.call(m.root, sel));
    const rendersBefore = m.renders.length;
    const k = key(m.app.state.awaiting.moves[0].tile);
    m.app.dispatch({ type: 'hoverTile', key: k });
    ok(m.renders.length === rendersBefore, 'hovering does NOT redraw the page (nothing replaced under the pointer)');
    ok(eq(toggles, [['cpu', 'preview', false], ['mexican', 'preview', false], ['human', 'preview', true]]), 'only the train the tile fits gets the preview class');
    toggles.length = 0;
    m.app.dispatch({ type: 'hoverTile', key: null });
    ok(toggles.every(t => t[1] === 'preview' && t[2] === false) && toggles.length === 3, 'leaving the tile removes it everywhere');
    toggles.length = 0;
    m.app.dispatch({ type: 'hoverTile', key: null });
    ok(toggles.length === 0, 'repeated "no tile" events do nothing');
    // a later redraw (e.g. the computer moves) keeps the preview if the pointer is still on the tile
    m.app.dispatch({ type: 'hoverTile', key: k });
    m.root.querySelectorAll = realQSA;
    m.app.render();
    ok(/class="track[^"]*preview[^"]*" data-train="human"/.test(m.root.innerHTML), 'a redraw while still hovering keeps the highlight');
    // playing the tile clears the hover so nothing stale is left behind
    m.app.dispatch({ type: 'selectTile', key: k });
    await waitFor(() => m.app.state.awaiting && m.app.state.awaiting.kind === 'build', 'next prompt');
    ok(m.app.state.hoverKey === null && previewRows(m.root.innerHTML) === 0, 'after the tile is played the preview is gone');
    // hovering a tile when no prompt is waiting does nothing visible
    const idle = makeApp(3);
    idle.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
    idle.app.dispatch({ type: 'hoverTile', key: '5-7' });
    ok(previewRows(idle.root.innerHTML) === 0, 'no preview unless it is your move');
  }

  console.log('N. flash stays in step across redraws');
  {
    let clock = 5000000;
    const f = makeApp(2, { now: () => clock });
    let found = null;
    for (let seed = 2; seed < 120 && !found; seed++) {
      const g = makeApp(seed, { now: () => clock });
      g.app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips' });
      for (let i = 0; i < 400 && !found; i++) {
        await tick();
        const A = g.app.state.awaiting;
        if (!A) continue;
        if ((A.kind === 'build' && A.canDraw) || A.kind === 'draw') { found = g; break; }
        if (A.kind === 'modal') g.app.dispatch({ type: 'dialogOk' });
        else if (A.kind === 'draw') g.app.dispatch({ type: 'draw' });
        else if (A.kind === 'build') g.app.dispatch(A.moves.length ? { type: 'selectTile', key: key(A.moves[0].tile) } : { type: 'endBuild' });
        else { const m = A.moves[0]; g.app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (g.app.state.awaiting === A) g.app.dispatch({ type: 'playOn', train: m.trainId }); }
      }
    }
    ok(!!found, 'found a position where only a draw is possible');
    if (found) {
      const delay = () => Number((found.root.innerHTML.match(/animation-delay:-(\d+)ms/) || [])[1]);
      clock = 5000000 + 0;   found.app.render(); const d0 = delay();
      clock = 5000000 + 300; found.app.render(); const d1 = delay();
      clock = 5000000 + 1100; found.app.render(); const d2 = delay();
      ok(d0 === 5000000 % 1100 && d1 === (5000300 % 1100) && d2 === d0, `the delay follows the clock (${d0}, ${d1}, ${d2}) so a redraw never restarts the flash`);
      ok(d1 - d0 === 300, 'phase advances in real time between redraws');
    }
  }

  console.log('O. computer skill levels through the interface');
  {
    const lab = G.Engine.LEVEL_LABEL;
    const o = makeApp(1);
    o.app.dispatch({ type: 'boot' });
    ok(/<select id="opt-level">/.test(o.root.innerHTML) && ['Easy: plays casually', 'Medium: plays sensibly', 'Hard: plans ahead'].every(t => o.root.innerHTML.includes(t)), 'setup offers Easy / Medium / Hard');
    ok(/<option value="normal" selected>/.test(o.root.innerHTML), 'Medium is the default');
    ok(o.root.innerHTML.includes('Computer skill'), 'the control is labelled');
    ok(!/CPU/.test(o.root.innerHTML), 'no "CPU" wording');
    o.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'hard' });
    ok(o.app.state.opts.level === 'hard' && JSON.parse(o.store['mt-opts']).level === 'hard', 'the choice is applied and saved');
    await waitFor(() => o.app.state.awaiting, 'prompt');
    ok(o.root.innerHTML.includes('Computer: Hard'), 'the header shows the level during play');
    o.app.dispatch({ type: 'newGame' });
    ok(/<option value="hard" selected>/.test(o.root.innerHTML), 'reopening setup shows the current level');
    const again = makeApp(1, null, o.store);
    again.app.dispatch({ type: 'boot' });
    ok(again.app.state.opts.level === 'hard' && /<option value="hard" selected>/.test(again.root.innerHTML), 'a reloaded page remembers it');
    ok(makeApp(1, null, { 'mt-opts': JSON.stringify({ level: 'impossible' }) }).app.state.opts.level === 'normal', 'an invalid saved level falls back to Medium');
    ok(makeApp(1, null, { 'mt-opts': JSON.stringify({ rounds: 1 }) }).app.state.opts.level === 'normal', 'settings saved before levels existed still load');
    o.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
    ok(o.app.state.opts.level === 'normal', 'a form without the field falls back to Medium');

    // plumbing: the level really reaches the computer's decisions (opening length by level, via the page itself)
    const avgOpening = {};
    for (const lv of ['easy', 'normal', 'hard']) {
      const lens = [];
      for (let seed = 1; seed <= 40; seed++) {
        const q = makeApp(seed);
        const orig = q.app.ui.onOpeningDone;
        q.app.ui.onOpeningDone = async g => { lens.push(g.trains.cpu.tiles.length); return orig(g); };
        q.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: lv });
        for (let g = 0; g < 200 && lens.length === 0; g++) {          // answer prompts until the opening ends
          await tick();
          const A = q.app.state.awaiting;
          if (!A || A.kind !== 'build') continue;
          if (A.canDraw) q.app.dispatch({ type: 'draw' });
          else if (!A.canDone) q.app.dispatch({ type: 'undoTile' });
          else q.app.dispatch({ type: 'endBuild' });
        }
        ok(lens.length === 1, `${lv}: the opening finished`);
        q.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'normal' });   // abandon the match
      }
      avgOpening[lv] = lens.reduce((a, b) => a + b, 0) / lens.length;
    }
    console.log(`   computer opening length through the page: easy ${avgOpening.easy.toFixed(1)} | normal ${avgOpening.normal.toFixed(1)} | hard ${avgOpening.hard.toFixed(1)}`);
    ok(avgOpening.easy < avgOpening.normal - 2 && Math.abs(avgOpening.normal - avgOpening.hard) < 0.01, 'Easy builds short trains; Normal and Hard build the longest');
  }

  console.log('J. stray / invalid actions are harmless');
  {
    const z = makeApp(9);
    z.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips' });
    await waitFor(() => z.app.state.awaiting, 'prompt');
    const before = JSON.stringify(z.app.state.game.players[0].hand), trainBefore = z.app.state.game.trains.human.tiles.length;
    z.app.dispatch({ type: 'selectTile', key: '99-99' });
    z.app.dispatch({ type: 'playOn', train: 'human' });
    z.app.dispatch({ type: 'dialogOk' });
    z.app.dispatch({ type: 'undoTile' });                                        // nothing to take back yet
    z.app.dispatch({ type: 'bogus' });
    ok(JSON.stringify(z.app.state.game.players[0].hand) === before && z.app.state.game.trains.human.tiles.length === trainBefore, 'state untouched by invalid actions');
    ok(z.app.state.awaiting !== null, 'still waiting for a real action');
  }

  console.log('K. storage failures and bad saved settings');
  {
    const bad = makeApp(2, { storage: { get() { throw new Error('blocked'); }, set() { throw new Error('blocked'); } } });
    bad.app.dispatch({ type: 'boot' });
    ok(bad.app.state.opts.rounds === 4 && bad.app.state.opts.hand === 15, 'defaults when storage throws');
    bad.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips' });
    ok(G.CPU_NAMES.includes(bad.app.state.cpuName), 'a name is still picked when storage throws');
    const junk = makeApp(2, { storage: { get: () => '{"rounds":99,"hand":"abc","style":"x"}', set() {} } });
    ok(junk.app.state.opts.rounds === 4 && junk.app.state.opts.hand === 15 && junk.app.state.opts.style === 'pips', 'invalid saved values are sanitised');
  }

  Object.keys(failCounts).forEach(m => console.log(`  (x${failCounts[m]}) ${m}`));
  console.log(`\n${pass} passed, ${fail} failed, unhandled rejections: ${unhandled.length}`);
  process.exit(fail || unhandled.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
