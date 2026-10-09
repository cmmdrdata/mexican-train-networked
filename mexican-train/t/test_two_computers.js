'use strict';
require('./game.js');
const fs = require('fs');
const vm = require('vm');
const G = globalThis.MexicanTrainGame;
const { mulberry32, key, handPips } = G.Engine;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const LABEL = { easy: 'Easy', normal: 'Medium', hard: 'Hard' };
const canon = t => [Math.min(t[0], t[1]), Math.max(t[0], t[1])];

/* An app whose every screen is recorded. */
function makeApp(seed, env, store) {
  const c = { renders: [], html: '', store: store || {} };
  const root = { set innerHTML(v) { c.html = v; if (c.S && c.S.game) c.renders.push({ html: v, aw: c.S.awaiting ? c.S.awaiting.kind : null, round: c.S.roundIndex, startIndex: c.S.startIndex, log: c.S.log.slice(), tiles: tileCount(c.S.game), revealed: c.S.revealed, comment: c.S.comment ? Object.assign({}, c.S.comment) : null }); }, get innerHTML() { return c.html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  c.app = G.createApp(Object.assign({ root, rng: mulberry32(seed), paceRng: () => 0, chatRng: mulberry32(seed + 1000), nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in c.store ? c.store[k] : null), set: (k, v) => { c.store[k] = v; } } }, env || {}));
  c.S = c.app.state; c.d = a => c.app.dispatch(a); c.app.dispatch({ type: 'boot' });
  return c;
}
function tileCount(g) { const all = []; g.players.forEach(p => p.hand.forEach(t => all.push(key(canon(t))))); g.boneyard.forEach(t => all.push(key(canon(t)))); Object.keys(g.trains).forEach(id => g.trains[id].tiles.forEach(t => all.push(key(canon(t))))); return { n: all.length, unique: new Set(all).size }; }
// the person plays at random through the screens
function act(c, rnd) {
  const a = c.S.awaiting; if (!a) return false;
  const d = x => c.d(x);
  if (a.kind === 'modal') { d({ type: 'dialogOk' }); return true; }
  if (a.kind === 'draw') { d({ type: 'draw' }); return true; }
  if (a.kind === 'move') { const m = a.moves[Math.floor(rnd() * a.moves.length)]; d({ type: 'selectTile', key: key(m.tile) }); if (c.S.awaiting === a) d({ type: 'playOn', train: m.trainId }); return true; }
  if (a.canDraw) { d({ type: 'draw' }); return true; }
  if (a.moves.length && rnd() < 0.6) { const m = a.moves[Math.floor(rnd() * a.moves.length)]; d({ type: 'selectTile', key: key(m.tile) }); return true; }
  if (a.canDone) { d({ type: 'endBuild' }); return true; }
  d({ type: 'undoTile' }); return true;
}
async function playGame(c, rnd, until) {
  let guard = 0;
  while (guard++ < 40000) {
    if (until(c)) return true;
    act(c, rnd);
    await wait(0);
  }
  return false;
}
const rowsOf = html => html.split('<div class="cpu-hand').slice(1).map(b => ({ player: (b.match(/data-player="(\w+)"/) || [])[1], who: (b.match(/<span class="who">([^<]*)</) || [])[1], tag: (b.match(/class="tag tag-(\w+)"/) || [])[1], count: +((b.match(/class="count">(\d+) tile/) || [])[1]) }));
const tracksOf = html => html.split(/<div class="track(?=[ "])/).slice(1).map(b => ({ id: (b.match(/data-train="(\w+)"/) || [])[1], label: (b.match(/class="track-name">([^<]*)</) || [])[1] || '', toy: (b.match(/class="toy-train (c\d)"/) || [])[1] || null }));

(async () => {
  console.log('1. the setup screen');
  {
    const c = makeApp(1);
    ok(/<select id="opt-cpus">[\s\S]*<option value="1" selected>One computer player<\/option>[\s\S]*<option value="2">Two computer players<\/option>/.test(c.html), 'the setup screen offers "One computer player" (the default) or "Two computer players"');
    ok(/id="field-level2" hidden>/.test(c.html) && /id="opt-level2"/.test(c.html), 'the second computer\'s skill is there but hidden while there is one computer');
    c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy', cpus: 2, level2: 'hard' });
    ok(c.S.opts.cpus === 2 && c.S.opts.level === 'easy' && c.S.opts.level2 === 'hard', 'two computers, Easy and Hard, are what the game starts with');
    ok(/"cpus":2/.test(c.store['mt-opts']) && /"level2":"hard"/.test(c.store['mt-opts']), 'and are remembered');
    c.d({ type: 'newGame' });
    ok(/<option value="2" selected>Two computer players/.test(c.html) && !/id="field-level2" hidden/.test(c.html) && /<select id="opt-level2">[\s\S]*<option value="hard" selected>/.test(c.html), 'the next time, the setup screen shows two computers with the second skill chosen, and the second skill is visible');
    ok(/Second computer&#39;s skill|Second computer's skill/.test(c.html), 'labelled "Second computer\'s skill"');
    c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'normal' });
    ok(c.S.opts.cpus === 2 && c.S.opts.level2 === 'hard', 'a start that does not mention them keeps the saved choice');
    c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'normal', cpus: 1 });
    ok(c.S.opts.cpus === 1, 'and one computer can be chosen again');
    ok(makeApp(2, {}, { 'mt-opts': JSON.stringify({ cpus: 7, level2: 'godlike', level: 'hard' }) }).S.opts.cpus === 1 && makeApp(2, {}, { 'mt-opts': JSON.stringify({ cpus: 7, level2: 'godlike' }) }).S.opts.level2 === 'normal' && makeApp(2, {}, { 'mt-opts': '{broken' }).S.opts.cpus === 1, 'saved settings that are nonsense or damaged (or from before this option existed) mean one computer and a Medium second skill');
    ok(makeApp(1).S.opts.cpus === 1 && makeApp(1).S.opts.level2 === 'normal', 'the defaults are one computer, with the second skill Medium');
    ok(G.createApp && (() => { const x = makeApp(3); x.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy', cpus: 'banana', level2: 'impossible' }); return x.S.opts.cpus === 1 && x.S.opts.level2 === 'normal'; })(), 'nonsense for either setting becomes one computer / Medium');
    ok((() => { const x = makeApp(3); x.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy', cpus: '2' }); return x.S.opts.cpus === 2; })(), '(a "2" from the form\'s text box means two)');
  }

  console.log('2. the real page: the form values reach the game, and the second skill appears and disappears');
  {
    const html = fs.readFileSync('../mexican-train.html', 'utf8');
    const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const handlers = {}, els = {}, store = {};
    const form = { '#opt-rounds': '1', '#opt-hand': '8', '#opt-style': 'pips', '#opt-level': 'easy', '#opt-cpus': '2', '#opt-level2': 'hard' };
    let page = '';
    const rootEl = { set innerHTML(v) { page = v; }, get innerHTML() { return page; }, addEventListener(t, f) { handlers[t] = f; }, querySelectorAll() { return []; },
      querySelector(sel) { if (sel in form) return { value: form[sel] }; if (!els[sel]) els[sel] = { hidden: false, focus() {} }; return els[sel]; }, ownerDocument: { activeElement: null } };
    const sandbox = { document: { readyState: 'complete', getElementById: () => rootEl, addEventListener() {} }, location: { href: 'http://x/', search: '', host: 'x', protocol: 'http:', pathname: '/', hash: '' }, history: { replaceState() {} }, navigator: {}, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } }, matchMedia: () => ({ matches: true }), console, setTimeout, clearTimeout, URL, URLSearchParams, Math, JSON, Object, Array, Number, String, Set, Promise, Error };
    sandbox.window = sandbox; vm.createContext(sandbox); vm.runInContext(code, sandbox);
    const app = sandbox.MexicanTrainApp;
    handlers.click({ target: { closest: s => (s === '[data-action]' ? { dataset: { action: 'startGame' } } : null) } });
    ok(app.state.opts.cpus === 2 && app.state.opts.level === 'easy' && app.state.opts.level2 === 'hard', 'pressing Start Game with Two computer players, Easy and Hard, in the form starts that game');
    ok(app.state.cpuName && app.state.cpu2Name && app.state.cpuName !== app.state.cpu2Name && G.levelOfName(app.state.cpuName) === 'easy' && G.levelOfName(app.state.cpu2Name) === 'hard', `with two different names, each from its own skill's list: ${app.state.cpuName} (Easy) and ${app.state.cpu2Name} (Hard)`);
    els['#field-level2'] = { hidden: false };
    handlers.change({ target: { id: 'opt-cpus', value: '1' } });
    ok(els['#field-level2'].hidden === true, 'choosing One computer player in the form hides the second skill');
    handlers.change({ target: { id: 'opt-cpus', value: '2' } });
    ok(els['#field-level2'].hidden === false, 'and choosing Two shows it again, without redrawing the form (so nothing already chosen is lost)');
    app.dispatch({ type: 'newGame' });
  }

  console.log('3. who is who');
  {
    let bad = 0, total = 0;
    for (const [l1, l2] of [['easy', 'easy'], ['easy', 'hard'], ['hard', 'easy'], ['normal', 'normal'], ['hard', 'hard'], ['normal', 'hard'], ['easy', 'normal']]) {
      for (let seed = 1; seed <= 12; seed++) {
        const c = makeApp(seed); c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: l1, cpus: 2, level2: l2 }); total++;
        const n1 = c.S.cpuName, n2 = c.S.cpu2Name;
        if (!n1 || !n2 || n1 === n2 || G.levelOfName(n1) !== l1 || G.levelOfName(n2) !== l2) bad++;
        c.d({ type: 'newGame' });
      }
    }
    ok(total === 84 && bad === 0, `in ${total} games with every mix of skills, the two computers have different names, each from the list for its own skill`);
    const c = makeApp(5); c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'normal' });
    ok(c.S.cpu2Name === null && Object.keys(c.S.totals).join() === 'human,cpu', 'with one computer there is no second name, and only two scores (exactly as before)');
  }

  console.log('4. whole games with two computers: every screen');
  {
    let screens = 0; const bad = [], levelsSeen = new Set(); let finalsOk = 0, games = 0;
    for (const [seed, l1, l2, rounds, hand] of [[3, 'easy', 'hard', 4, 12], [4, 'hard', 'easy', 4, 15], [5, 'normal', 'normal', 13, 8], [6, 'hard', 'hard', 4, 8], [7, 'easy', 'easy', 4, 15], [8, 'normal', 'hard', 4, 12]]) {
      const c = makeApp(seed); c.d({ type: 'startGame', rounds, hand, style: 'pips', level: l1, cpus: 2, level2: l2 }); games++;
      const names = [c.S.cpuName, c.S.cpu2Name];
      const done = await playGame(c, mulberry32(seed + 50), x => x.S.modal && x.S.modal.type === 'final');
      if (!done) bad.push(`seed ${seed}: the game did not finish`);
      for (const r of c.renders) {
        screens++;
        const rows = rowsOf(r.html);
        if (rows.length !== 2 || rows[0].player !== 'cpu' || rows[1].player !== 'cpu2') { bad.push(`seed ${seed}: opponent rows ${JSON.stringify(rows.map(x => x.player))}`); break; }
        if (rows[0].who !== names[0] || rows[1].who !== names[1]) { bad.push(`seed ${seed}: names ${rows.map(x => x.who)}`); break; }
        if (rows[0].tag !== l1 || rows[1].tag !== l2) { bad.push(`seed ${seed}: tags ${rows.map(x => x.tag)} not ${l1}, ${l2}`); break; }
        if (!r.html.includes('Double-12 against two computers')) { bad.push(`seed ${seed}: the subtitle still says one computer`); break; }
        if (!r.html.includes(`Computers: ${LABEL[l1]} and ${LABEL[l2]}`)) { bad.push(`seed ${seed}: the header does not name both skills`); break; }
        if ((r.html.match(/class="tot"><b>/g) || []).length < 3) { bad.push(`seed ${seed}: fewer than three scores`); break; }
        if (r.tiles.n !== 90 || r.tiles.unique !== 90) { bad.push(`seed ${seed}: ${r.tiles.n} tiles, ${r.tiles.unique} different`); break; }
        if (r.html.includes('undefined') || /\bComputer\b[^s]/.test(r.log.join(' '))) { bad.push(`seed ${seed}: a name is missing: ${r.log.find(l => /Computer|undefined/.test(l))}`); break; }
      }
      // the rounds and the end
      const starts = [], seen = new Set();
      c.renders.forEach(r => { if (!seen.has(r.round)) { seen.add(r.round); starts.push(r.startIndex); } });
      if (!starts.every((s, i) => i === 0 || s === (starts[i - 1] + 1) % 3)) bad.push(`seed ${seed}: who plays first does not go round the table: ${starts}`);
      if (c.S.modal && c.S.modal.type === 'final') {
        const t = c.S.modal.totals, ids = Object.keys(t);
        const low = Math.min(...ids.map(i => t[i])), lows = ids.filter(i => t[i] === low);
        const title = (c.html.match(/id="dlg-title">([^<]*)</) || [])[1];
        const expect = lows.length === 1 ? (lows[0] === 'human' ? 'You win' : `${lows[0] === 'cpu' ? names[0] : names[1]} wins`) : lows.length === 3 ? 'A tie' : null;
        if (ids.join() === 'human,cpu,cpu2' && (expect === null ? /^A tie between/.test(title) : title === expect)) finalsOk++; else bad.push(`seed ${seed}: final title "${title}" for ${JSON.stringify(t)}`);
        if (!new RegExp(`You played ${names[0]} \\(${LABEL[l1]}\\) and ${names[1]} \\(${LABEL[l2]}\\)\\.`).test(c.html)) bad.push(`seed ${seed}: the final screen does not say who was played`);
      }
      levelsSeen.add(l1 + '/' + l2);
    }
    console.log(`   ${games} games, ${screens} screens inspected`);
    ok(screens > 2000 && games === 6, 'six whole games, one of them 13 rounds, with different skills, hand sizes and numbers of rounds');
    ok(bad.length === 0, 'on every screen: two opponent rows with the right names and skill tags, the header names both skills, three scores, all 90 tiles accounted for, no missing names; the first player goes round the table; the final dialog names the right winner (or a tie) and says who was played' + (bad[0] ? ' (' + bad[0] + ')' : ''));
    ok(finalsOk === games, `and every one of the ${games} games ended with a correct final result (${finalsOk})`);
  }

  console.log('4b. the narration names whichever computer acted');
  {
    const specs = [];
    const fx = { capture: () => ({ from: { left: 0, top: 0, width: 10, height: 10 } }), land: (tok, spec) => specs.push(spec), captureDraw: () => ({}), landDraw: (tok, spec) => specs.push(Object.assign({ draw: true }, spec)), reapply() {}, cancelAll() {} };
    const c = makeApp(21, { fx, reducedMotion: false }); c.d({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'easy', cpus: 2, level2: 'hard' });
    for (let i = 0; i < 8000 && !(c.S.awaiting && c.S.awaiting.kind === 'build'); i++) await wait(0);
    const n1 = c.S.cpuName, n2 = c.S.cpu2Name, g = c.S.game, hooks = c.app.ui;
    const last = () => c.S.log[c.S.log.length - 1];
    for (const [id, name, other] of [['cpu', n1, n2], ['cpu2', n2, n1]]) {
      const p = g.players.find(x => x.id === id);
      await hooks.onDraw(g, p, [3, 4]);          ok(last() === `${name} draws a tile.`, `${name} (${id}) drawing: "${last()}"`);
      await hooks.onPass(g, p);                  ok(new RegExp(`^${name} cannot (play|draw)`).test(last()) && !last().includes(other), `${name} passing: "${last()}"`);
      await hooks.onNeedDraw(g, p);              ok(new RegExp(`^${name} (has nothing to play|played a double)`).test(c.S.banner), `${name} having to draw: "${c.S.banner}"`);
      await hooks.onBuildPass(g, p);             ok(last().startsWith(`${name} cannot start a train and passes.`) && c.renders[c.renders.length - 1].revealed === id, `${name} unable to start a train: "${last()}", and its train is turned over on that screen (revealed ${c.renders[c.renders.length - 1].revealed})`);
      await hooks.onBuildDone(g, p, 3);          ok(last() === `${name} finished a train of 3 tiles.` && c.renders[c.renders.length - 1].revealed === id, `${name} finishing: "${last()}", and its train is turned over on that screen`);
    }
    c.S.startIndex = 2; await hooks.onOpeningDone();
    ok(/^All trains are built\. .+ plays first\.$/.test(c.S.banner) && c.S.banner.includes(n2), 'and when the third player starts, it is named: "' + c.S.banner + '"');
    // the flying tiles of BOTH computers leave face down in the opening (that gives nothing away: their numbers are hidden)
    const move = { tile: [12, 3], trainId: 'cpu2', placed: [12, 3] };
    await hooks.onBuildPlay(g, g.players.find(x => x.id === 'cpu2'), Object.assign({}, move, { trainId: 'cpu2' }));
    await hooks.onBuildPlay(g, g.players.find(x => x.id === 'cpu'), Object.assign({}, move, { trainId: 'cpu' }));
    const open = specs.filter(s => !s.draw).slice(-2);
    ok(open.length === 2 && open.every(s => s.hidden === true) && open.map(s => s.playerId).sort().join() === 'cpu,cpu2', 'in the opening, the tiles of both computers fly face down');
    ok(specs.filter(s => !s.draw && s.playerId === 'human').every(s => s.hidden === false), '(and yours never do)');
  }

  console.log('5. each computer plays at its own skill (in either seat)');
  {
    // The opening shows the skill most clearly: Easy builds short, casual trains; Hard builds long ones.
    const lens = { easy: [], hard: [], normal: [] };
    for (const [l1, l2] of [['easy', 'hard'], ['hard', 'easy']]) {
      const mine = { cpu: [], cpu2: [] };
      for (let seed = 1; seed <= 30; seed++) {
        const c = makeApp(seed * 7); c.d({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: l1, cpus: 2, level2: l2 });
        const names = { cpu: c.S.cpuName, cpu2: c.S.cpu2Name };
        let done = false, guard = 0;
        while (!done && guard++ < 4000) { const a = c.S.awaiting; if (a && a.kind === 'build') c.d({ type: a.canDraw ? 'draw' : 'endBuild' }); else if (a) act(c, mulberry32(seed)); await wait(0); done = (c.S.game && c.S.game.opening && ['cpu', 'cpu2'].every(i => c.S.game.opening[i].finished) && c.S.game.opening.human.finished) || (c.S.modal && c.S.modal.type === 'roundEnd'); }
        for (const id of ['cpu', 'cpu2']) mine[id].push(c.S.game.trains[id].tiles.length);
        c.d({ type: 'newGame' });
      }
      const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
      lens[l1].push(avg(mine.cpu)); lens[l2].push(avg(mine.cpu2));
      console.log(`   (${l1} first, ${l2} second: first computer's average opening train ${avg(mine.cpu).toFixed(2)} tiles, second's ${avg(mine.cpu2).toFixed(2)})`);
      if (l1 === 'easy') ok(avg(mine.cpu) < avg(mine.cpu2) * 0.9, `with Easy as computer 1 and Hard as computer 2, the Easy one builds clearly shorter opening trains (${avg(mine.cpu).toFixed(2)} against ${avg(mine.cpu2).toFixed(2)}): each has its own skill`);
      else ok(avg(mine.cpu2) < avg(mine.cpu) * 0.9, `and the other way round (Hard first, Easy second): the second, Easy, one builds the shorter trains (${avg(mine.cpu2).toFixed(2)} against ${avg(mine.cpu).toFixed(2)}): the skills are not swapped or shared`);
    }
  }

  console.log('6. the comments: one computer speaks at a time, in its own name');
  {
    // a fake clock, so the "you are taking too long" jabs can be waited for
    let clock = 0; const timers = []; let idc = 0;
    const timer = { set: (fn, ms) => { const id = ++idc; timers.push({ id, at: clock + ms, fn }); return id; }, clear: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); } };
    const advance = ms => { const end = clock + ms; for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > end) break; const t = timers.shift(); clock = t.at; t.fn(); } clock = end; };
    const c = makeApp(9, { timer, now: () => clock, chatRng: mulberry32(77) });
    c.d({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'easy', cpus: 2, level2: 'hard' });
    const n1 = c.S.cpuName, n2 = c.S.cpu2Name;
    for (let i = 0; i < 6000 && !(c.S.awaiting && c.S.awaiting.kind === 'build'); i++) await wait(0);
    const speakers = [];
    for (let wait_ = 0; wait_ < 6; wait_++) {                         // six separate times, the person dithers for four minutes
      const heard = [];
      let last = null; for (let step = 0; step < 24; step++) { advance(10000); if (c.S.comment && c.S.comment.id !== (last && last.id)) { last = c.S.comment; heard.push(c.S.comment); } }
      speakers.push(heard);
      // take a turn so a new wait starts
      const a = c.S.awaiting; if (a && a.kind === 'build') c.d({ type: a.canDraw ? 'draw' : 'endBuild' }); else if (a) act(c, mulberry32(wait_)); for (let i = 0; i < 400; i++) { await wait(0); advance(100); if (c.S.awaiting) break; }
    }
    const all = speakers.flat();
    ok(all.length > 8 && all.every(x => x.from === n1 || x.from === n2), `${all.length} comments were heard, each credited to one of the two computers (${n1}, ${n2})`);
    ok(all.some(x => x.from === n1) && all.some(x => x.from === n2), 'and both computers spoke at some point');
    const waits = speakers.filter(h => h.filter(x => /^slow/.test(x.kind)).length >= 2);
    ok(waits.length > 0 && waits.every(h => new Set(h.filter(x => /^slow/.test(x.kind)).map(x => x.from)).size === 1), `during one long wait, all the "you are taking too long" jabs come from the same computer, and it escalates (${waits.length} waits checked)`);
    const one = makeApp(9, { chatRng: mulberry32(77) }); one.d({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'easy' });
    ok(one.S.cpu2Name === null, '(with one computer nothing changes: no second speaker)');
  }

  console.log('7. the toy trains of the two computers');
  {
    const c = makeApp(13); c.d({ type: 'startGame', rounds: 4, hand: 15, style: 'pips', level: 'normal', cpus: 2, level2: 'normal' });
    await playGame(c, mulberry32(3), x => x.S.modal && x.S.modal.type === 'final');
    const colours = {}; let seen = 0;
    for (const r of c.renders) for (const t of tracksOf(r.html)) if (t.toy) { colours[t.id] = (colours[t.id] || new Set()).add(t.toy); seen++; }
    ok(seen > 20 && ['human', 'cpu', 'cpu2'].every(id => !colours[id] || (colours[id].size === 1)), `every train always wears one colour (${seen} toy trains seen)`);
    ok((!colours.human || [...colours.human][0] === 'c0') && (!colours.cpu || [...colours.cpu][0] === 'c1') && (!colours.cpu2 || [...colours.cpu2][0] === 'c2') && !colours.mexican, 'you are red, the first computer blue, the second yellow, and the Mexican train has none');
    ok(Object.keys(colours).length >= 2, `(trains of at least two different players were open in this game: ${Object.keys(colours).join(', ')})`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
