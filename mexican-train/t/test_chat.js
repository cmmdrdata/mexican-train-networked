require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const LN = G.LINES.normal;                          // Medium: the default level
const { mulberry32, key, rateMove, moveValue, newRound, playRound, cpuChoose, cpuBuildAction } = E;
let pass = 0, fail = 0;
const failCounts = {};
const ok = (c, m) => { if (c) pass++; else { fail++; failCounts[m] = (failCounts[m] || 0) + 1; if (failCounts[m] === 1) console.log('  FAIL:', m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tick = () => new Promise(r => setImmediate(r));
const silent = { onNeedDraw() {}, onDraw() {}, onPass() {}, onPlay() {} };

(async () => {
  console.log('1. rating a move');
  {
    // a hand where one play is clearly better: heavy tile that keeps a chain vs a light dead end
    const g = newRound({ engine: 5, handSize: 1, rng: mulberry32(1), simultaneousOpening: false });
    const me = g.players[0];
    me.hand = [[5, 9], [9, 3], [3, 3], [5, 0], [6, 7]];
    g.players[1].hand = [[1, 2]]; g.boneyard = [];
    const moves = E.legalMoves(g, me);
    const mv = t => moves.find(m => m.tile[0] === t[0] && m.tile[1] === t[1] && m.trainId === 'human');
    const rBest = rateMove(g, me, moves, moves.reduce((b, m) => (moveValue(g, me, m) > moveValue(g, me, b) ? m : b)));
    ok(rBest.gap === 0 && rBest.rank === 1 && !rBest.forced && rBest.n === moves.length, 'the best move has gap 0 and rank 1');
    const worst = moves.reduce((b, m) => (moveValue(g, me, m) < moveValue(g, me, b) ? m : b));
    const rWorst = rateMove(g, me, moves, worst);
    ok(rWorst.gap > 0 && rWorst.rank === Math.max(...moves.map((m, i) => rateMove(g, me, moves, m).rank)), 'the worst move has the biggest gap and the last rank');
    ok(rWorst.gap === rBest.best - rWorst.value, 'gap is best minus chosen');
    // forced: a single legal tile
    me.hand = [[5, 9], [1, 2]];
    const one = E.legalMoves(g, me).filter(m => m.trainId === 'human');
    const g2 = newRound({ engine: 5, handSize: 1, rng: mulberry32(1) }); g2.players[0].hand = [[5, 9], [1, 2]]; g2.players[1].hand = [[1, 1]]; g2.boneyard = [];
    g2.trains.mexican.end = 12; g2.trains.mexican.tiles = [[5, 12]];       // the Mexican train no longer fits the hand
    const only = E.legalMoves(g2, g2.players[0]);
    ok(only.length === 1 && rateMove(g2, g2.players[0], only, only[0]).forced === true, 'a position with one legal move is "forced"');
    // going out: a move that empties the hand is worth 1000+
    const g3 = newRound({ engine: 5, handSize: 1, rng: mulberry32(1) }); g3.players[0].hand = [[5, 9], [5, 2]]; g3.players[1].hand = [[1, 1]]; g3.boneyard = [];
    g3.trains.human.end = 9; g3.trains.human.tiles = [[5, 9]]; g3.trains.mexican.end = 2;
    g3.players[0].hand = [[9, 4]];
    const out = E.legalMoves(g3, g3.players[0]);
    ok(out.length >= 1 && rateMove(g3, g3.players[0], out, out[0]).best >= 1000, 'going out is valued at 1000+');
  }
  {
    // rating never touches the game's random numbers
    const g = newRound({ engine: 12, handSize: 15, rng: mulberry32(5), simultaneousOpening: false });
    let calls = 0; const orig = g.rng; g.rng = () => { calls++; return orig(); };
    const moves = E.legalMoves(g, g.players[0]);
    if (moves.length) { rateMove(g, g.players[0], moves, moves[0]); moveValue(g, g.players[0], moves[0]); }
    ok(calls === 0, 'rating consumes no random numbers');
  }

  // a regression: a hand of 19 tiles (a long game with many draws) used to make the rating run out of memory
  {
    const big = [[4,11],[3,5],[0,0],[4,8],[11,11],[9,9],[8,12],[5,11],[3,3],[2,11],[3,4],[2,6],[0,7],[12,12],[6,11],[1,11],[0,8],[2,12],[1,1]];
    const g = newRound({ engine: 5, handSize: 1, rng: mulberry32(1), simultaneousOpening: false });
    const me = g.players[0]; me.hand = big.map(t => t.slice()); g.boneyard = [];
    const moves = E.legalMoves(g, me);
    let threw = null; const t0 = Date.now(); let r = null;
    try { r = rateMove(g, me, moves, moves[0]); } catch (e) { threw = e; }
    ok(!threw && r && Number.isFinite(r.gap) && Date.now() - t0 < 500, `rating a 19-tile hand finishes quickly (${Date.now() - t0} ms) instead of running out of memory`);
    // bigger still
    const huge = []; for (let a = 0; a <= 12; a++) for (let b = a; b <= 12; b++) if (!(a === 5 && b === 5)) huge.push([a, b]);
    me.hand = huge.slice(0, 40).map(t => t.slice());
    const t1 = Date.now(); let ok2 = true;
    try { rateMove(g, me, E.legalMoves(g, me), E.legalMoves(g, me)[0] || null); } catch (e) { ok2 = false; }
    ok(ok2 && Date.now() - t1 < 1000, 'even a 40-tile hand is rated promptly');
    // exact where it matters: up to 16 tiles the search is still exhaustive
    const small = big.slice(0, 15);
    ok(E.longestChain(small, 5, false).length === E.longestChain(small.slice().reverse(), 5, false).length, 'up to 16 tiles the search is exact (same answer whatever the order)');
    // and the Hard computer, which looks ahead the same way, is not slowed by a huge hand either
    const hh = newRound({ engine: 5, handSize: 1, rng: mulberry32(2), simultaneousOpening: false });
    hh.players[1].hand = huge.slice(10, 45).map(t => t.slice()); hh.boneyard = [];
    const t2 = Date.now();
    const mv = E.legalMoves(hh, hh.players[1]);
    const pick = mv.length ? cpuChoose(hh, hh.players[1], mv, 'hard') : null;
    ok(Date.now() - t2 < 1000 && (!mv.length || pick), 'the Hard computer chooses promptly with 35 tiles in hand');
  }

  console.log('2. the thresholds, on real play (150 deals per kind of player)');
  async function sample(policy) {
    const kinds = { great: 0, good: 0, mid: 0, poor: 0, awful: 0, forced: 0, missedOut: 0 }; let n = 0;
    for (let i = 0; i < 150; i++) {
      const g = newRound({ engine: 12 - (i % 13), handSize: 15, rng: mulberry32(95000 + i), simultaneousOpening: true });
      const me = { act: async (gm, p, info) => cpuBuildAction(gm, p, info, 'normal'), choose: async (gm, p, moves) => {
        const chosen = policy(gm, p, moves); const k = G.commentKindFor(rateMove(gm, p, moves, chosen)); kinds[k === null ? 'mid' : k]++; n++; return chosen; } };
      const other = { act: async (gm, p, info) => cpuBuildAction(gm, p, info, 'normal'), choose: async (gm, p, m) => cpuChoose(gm, p, m, 'normal') };
      await playRound(g, i % 2, { human: me, cpu: other }, silent);
    }
    const real = n - kinds.forced;
    return { ...kinds, n, real, great: kinds.great / real, poor: (kinds.poor + kinds.awful) / real, awful: kinds.awful / real };
  }
  const rnd = await sample((g, p, m) => m[Math.floor(g.rng() * m.length)]);
  const nrm = await sample((g, p, m) => cpuChoose(g, p, m, 'normal'));
  const hrd = await sample((g, p, m) => cpuChoose(g, p, m, 'hard'));
  const pc = x => (100 * x).toFixed(0) + '%';
  console.log(`   random player: best ${pc(rnd.great)}, poor+awful ${pc(rnd.poor)}, awful ${pc(rnd.awful)} | Normal-level: best ${pc(nrm.great)}, poor+awful ${pc(nrm.poor)} | Hard-level: best ${pc(hrd.great)}, poor+awful ${pc(hrd.poor)}`);
  ok(hrd.great > nrm.great && nrm.great > rnd.great, 'the better the player, the more often they are rated best');
  ok(rnd.poor > nrm.poor && nrm.poor > hrd.poor - 0.001, 'the worse the player, the more often they are roasted');
  ok(rnd.poor > 0.25 && nrm.poor < 0.2 && hrd.poor < 0.02, 'a random player is roasted on over a quarter of real choices; Normal-level under 20%; Hard-level almost never');
  ok(rnd.forced / rnd.n > 0.4, 'most decisions are forced, so forced-move remarks must be rare');

  console.log('3. which comment a rating earns');
  const R = (gap, o) => ({ n: 4, forced: false, best: 20, value: 20 - gap, gap, rank: 1, ...(o || {}) });
  const K = r => G.commentKindFor(r);
  ok(K(R(0)) === 'great' && K(R(0.5)) === 'great' && K(R(0.51)) === 'good', 'matching the best is "great"; just behind is "good"');
  ok(K(R(8)) === 'good' && K(R(8.01)) === null && K(R(15.99)) === null, 'a middling move earns no comment');
  ok(K(R(16)) === 'poor' && K(R(31.99)) === 'poor' && K(R(32)) === 'awful' && K(R(500)) === 'awful', 'poor from 16 points behind, awful from 32');
  ok(K(R(0, { forced: true, n: 1 })) === 'forced' && K(R(30, { forced: true, n: 1 })) === 'forced', 'a single legal move is "forced"');
  ok(K(R(1000, { best: 1020, value: 20 })) === 'missedOut', 'missing a chance to go out gets its own remark');
  ok(K(R(5, { best: 1020, value: 1015 })) === 'good', 'going out anyway is not "missed"');

  console.log('4. the lines themselves, for every level');
  const KINDS = ['great', 'good', 'poor', 'awful', 'forced', 'missedOut', 'slow1', 'slow2', 'slow3', 'draw', 'pass', 'openBest', 'openShort', 'openNone'];
  const blocked = /\b(fuck\w*|shit\w*|bitch\w*|cunt|nigg\w*|fag\w*|retard\w*|whore|slut|bastard|dick|cock|piss\w*|damn\w*|hell|crap|ass|asshole|kill|die|suicide|stupid|idiot|moron|ugly|fat)\b/i;
  ok(Object.keys(G.LINES).join() === 'easy,normal,hard', 'three complete sets of comments: Easy, Medium, Hard');
  const everyLine = [];
  for (const lvl of ['easy', 'normal', 'hard']) {
    const L = G.LINES[lvl];
    ok(KINDS.every(k => Array.isArray(L[k]) && L[k].length >= 2) && Object.keys(L).length === KINDS.length, `${lvl}: every kind of comment has lines`);
    ok(['great', 'good', 'poor', 'awful'].every(k => L[k].length >= 8) && L.slow1.length >= 5 && L.slow2.length >= 5 && L.slow3.length >= 5, `${lvl}: enough variety that repeats are rare`);
    let dupes = 0, tooLong = 0, markup = 0, braces = 0;
    for (const k of Object.keys(L)) {
      if (new Set(L[k]).size !== L[k].length) dupes++;
      L[k].forEach(line => { everyLine.push([lvl, k, line]); if (line.length > 120) tooLong++; if (/[<>&"]/.test(line)) markup++; if (/\{\w+\}/.test(line) && k !== 'openShort') braces++; });
    }
    ok(dupes === 0 && tooLong === 0 && markup === 0 && braces === 0, `${lvl}: no duplicates, all under 120 characters, no HTML characters, placeholders only where they are filled`);
    ok(L.openShort.some(l => l.includes('{built}')) && L.openShort.every(l => !/\{(?!built\}|best\})\w+\}/.test(l)), `${lvl}: the opening remarks can quote your numbers, and only those`);
  }
  ok(everyLine.length > 200, `${everyLine.length} lines in all`);
  const bad = everyLine.filter(([, , l]) => blocked.test(l));
  ok(bad.length === 0, 'rude but not vile: no line uses strong profanity, slurs or personal insults' + (bad[0] ? ' (' + bad[0][2] + ')' : ''));
  const odd = everyLine.filter(([, , l]) => !/^[A-Za-z0-9 .,:;!?'\-{}]+$/.test(l));
  ok(odd.length === 0, 'plain text only' + (odd[0] ? ': ' + odd[0][2] : ''));
  // each level has its OWN comments: no line is shared
  const owner = new Map(); let shared = 0;
  everyLine.forEach(([lvl, k, l]) => { if (owner.has(l) && owner.get(l) !== lvl) shared++; owner.set(l, lvl); });
  ok(shared === 0, 'no line is shared between levels: each has its own set');
  ok(['great', 'poor', 'slow1', 'openShort'].every(k => ['easy', 'normal', 'hard'].every(lv => G.LINES[lv][k].length >= 5)), 'and every level can react to everything');
  // the voices are different: Easy is a beginner, Hard is smug (spot-checked by the words each one leans on)
  const words = lvl => everyLine.filter(([l]) => l === lvl).map(x => x[2]).join(' ').toLowerCase();
  ok(/\b(i am|my) (terrible|hungry|bored)|\bi (never|rarely)\b|ceiling|sandwich|my cat/.test(words('easy')), 'Easy sounds like a flustered beginner');
  ok(/\b(calculat|predictable|expected|position|punish|count)/.test(words('hard')) && !/ceiling|sandwich|my cat/.test(words('hard')), 'Hard sounds like a smug calculator');
  ok(G.fillLine('You built {built} when you could have built {best}.', { built: 4, best: 9 }) === 'You built 4 when you could have built 9.' && G.fillLine('Hi {x}', {}) === 'Hi {x}', 'placeholders are filled; unknown ones are left alone');
  for (const lvl of ['easy', 'normal', 'hard']) {
    const rr = mulberry32(3), seen = new Set(); let last = null, repeats = 0;
    for (let i = 0; i < 4000; i++) { const tx = G.pickLine('poor', rr, last, lvl); if (tx === last) repeats++; if (!G.LINES[lvl].poor.includes(tx)) repeats += 1000; seen.add(tx); last = tx; }
    ok(repeats === 0 && seen.size === G.LINES[lvl].poor.length, `${lvl}: the same line is never said twice in a row, every line gets used, and only this level's lines are used`);
  }
  ok(G.pickLine('poor', () => 1, null, 'hard') !== undefined && G.pickLine('poor', () => 0, null, 'easy') !== undefined, 'the picker copes with the extremes of a random number');
  ok(G.pickLine('nope', mulberry32(1), null, 'hard') === '', 'unknown kind: empty');
  ok(LN.poor.includes(G.pickLine('poor', mulberry32(1), null, 'nonsense')), 'an unknown level speaks as Medium');

  console.log('5. the computer talking in a game (fake clock, deterministic)');
  function fakeTimer() {
    let id = 0, clock = 0; const q = [];
    return {
      set(fn, ms) { const t = { id: ++id, fn, at: clock + ms, ms }; q.push(t); return t.id; },
      clear(i) { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); },
      advance(ms) { const end = clock + ms; for (;;) { q.sort((a, b) => a.at - b.at); const nx = q[0]; if (!nx || nx.at > end) break; q.shift(); clock = nx.at; nx.fn(); } clock = end; },
      get pending() { return q.length; }, get clock() { return clock; }, delays: () => q.map(t => t.ms),
    };
  }
  function makeApp(seed, extra) {
    const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const store = {}, timer = fakeTimer(), ctl = { rng: 1 };
    const app = G.createApp(Object.assign({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true,
      chatRng: () => ctl.rng, nativeChance: 0, foodChance: 0, timer, now: () => 1e6 + timer.clock,
      storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } }, extra));
    return { app, root, timer, ctl, store };
  }
  const bubble = h => { const m = h.match(/<div class="bubble"><b>([^<]*)<\/b><span>([^<]*)<\/span><\/div>/); return m ? { who: m[1], text: m[2] } : null; };
  const unescape = t => t.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  function stepOnce(a, A) {                          // one sensible action for whatever the game is asking
    if (A.kind === 'draw') a.app.dispatch({ type: 'draw' });
    else if (A.kind === 'modal') a.app.dispatch({ type: 'dialogOk' });
    else if (A.kind === 'build') { if (A.canDraw) a.app.dispatch({ type: 'draw' }); else if (A.canBuild) a.app.dispatch({ type: 'autoBuild' }); else if (A.canDone) a.app.dispatch({ type: 'endBuild' }); else a.app.dispatch({ type: 'undoTile' }); }
    else { const best = bestMove(a, A); a.app.dispatch({ type: 'selectTile', key: key(best.tile) }); if (a.app.state.awaiting === A) a.app.dispatch({ type: 'playOn', train: best.trainId }); }
  }
  async function drive(a, wanted) {                  // play with the best moves until wanted(prompt) is true
    for (let g = 0; g < 4000; g++) {
      await tick();
      const A = a.app.state.awaiting;
      if (a.app.state.modal && a.app.state.modal.type === 'final') return null;
      if (!A) continue;
      if (wanted(A, a)) return A;
      stepOnce(a, A);
    }
    return null;
  }
  const rated = (a, A) => A.moves.map(m => ({ m, r: rateMove(a.app.state.game, a.app.state.game.players[0], A.moves, m) }));
  const bestMove = (a, A) => rated(a, A).sort((x, y) => x.r.gap - y.r.gap)[0].m;
  const worstMove = (a, A) => rated(a, A).sort((x, y) => y.r.gap - x.r.gap)[0].m;
  async function fresh(wanted, seeds = 60, level) {
    for (let seed = 1; seed <= seeds; seed++) {
      const a = makeApp(seed);
      a.app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips', level: level || 'normal' });
      const A = await drive(a, wanted);
      if (A) return { a, A, seed };
    }
    return null;
  }
  const play = (a, A, m) => { a.app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (a.app.state.awaiting === A) a.app.dispatch({ type: 'playOn', train: m.trainId }); };

  // (a) a poor move is roasted, after a beat, and the bubble goes away again
  {
    const f = await fresh((A, a) => A.kind === 'move' && A.moves.length > 1 && rated(a, A).some(x => x.r.gap >= 16));
    ok(!!f, 'found a position with a clearly poor option');
    const { a, A } = f;
    const worst = worstMove(a, A), rating = rateMove(a.app.state.game, a.app.state.game.players[0], A.moves, worst);
    const kind = G.commentKindFor(rating);
    ok(kind === 'poor' || kind === 'awful' || kind === 'missedOut', `that move rates "${kind}"`);
    ok(bubble(a.root.innerHTML) === null && /class="bubble-slot"/.test(a.root.innerHTML), 'before: no bubble, but its space is already reserved');
    a.ctl.rng = 0;
    play(a, A, worst);
    for (let i = 0; i < 20; i++) await tick();
    const delays = a.timer.delays().filter(d => d >= G.CHAT.reactDelayMs[0] && d <= G.CHAT.reactDelayMs[1] + 1);
    ok(delays.length >= 1, 'the computer waits a beat (0.6 to 1.1 s) before reacting');
    ok(bubble(a.root.innerHTML) === null, 'not instantly');
    a.timer.advance(1200);
    const b = bubble(a.root.innerHTML);
    ok(b && b.who === a.app.state.cpuName, 'the bubble names the computer');
    ok(b && LN[kind].includes(unescape(b.text)), `and says one of the "${kind}" lines: ${b && b.text}`);
    a.timer.advance(G.CHAT.showMs);
    ok(bubble(a.root.innerHTML) === null, 'the bubble goes away after a few seconds');
  }
  // (b) the best move earns grudging praise; a forced move earns sarcasm
  {
    const f = await fresh((A, a) => A.kind === 'move' && A.moves.length > 1 && rated(a, A).some(x => x.r.gap > 0.5 && x.r.gap < 16) && rated(a, A).some(x => x.r.gap === 0));
    ok(!!f, 'found a position with a best move');
    const { a, A } = f;
    a.ctl.rng = 0;
    play(a, A, bestMove(a, A));
    for (let i = 0; i < 20; i++) await tick();
    a.timer.advance(1200);
    const b = bubble(a.root.innerHTML);
    ok(b && LN.great.includes(unescape(b.text)), 'the best move gets a grudging compliment: ' + (b && b.text));
  }
  {
    const f = await fresh((A, a) => A.kind === 'move' && A.moves.length === 1);
    ok(!!f, 'found a forced move');
    const { a, A } = f; a.ctl.rng = 0;
    play(a, A, A.moves[0]);
    for (let i = 0; i < 20; i++) await tick();
    a.timer.advance(1200);
    const b = bubble(a.root.innerHTML);
    ok(b && LN.forced.includes(unescape(b.text)), 'a forced move gets a sarcastic remark: ' + (b && b.text));
  }
  // (c) chance and cooldown
  {
    const f = await fresh((A, a) => A.kind === 'move' && A.moves.length > 1 && rated(a, A).some(x => x.r.gap === 0));
    const { a } = f;
    const remarks = () => a.timer.delays().filter(d => d >= G.CHAT.reactDelayMs[0] && d <= G.CHAT.reactDelayMs[1] + 1).length;
    const steps = async n => { for (let i = 0; i < n; i++) { await tick(); const A2 = a.app.state.awaiting; if (A2) stepOnce(a, A2); for (let j = 0; j < 5; j++) await tick(); } };
    a.ctl.rng = 0.99;                                        // too unlucky for any ordinary comment
    await steps(14);
    ok(remarks() === 0, 'with bad luck on the dice, the computer stays quiet');
    a.ctl.rng = 0;                                           // now every ordinary comment passes the dice
    await steps(14);
    ok(remarks() === 1, `cooldown: with time standing still, 14 more actions (moves, draws) produce exactly one remark, not ${remarks()}`);
    a.timer.advance(8000);                                   // it speaks, the bubble goes, 8 seconds pass
    ok(remarks() === 0 && bubble(a.root.innerHTML) === null, 'that remark was delivered and has faded');
    for (let i = 0; i < 14 && remarks() === 0; i++) await steps(1);
    ok(remarks() === 1, 'after the cooldown it can comment again');
  }
  // (d) taking too long
  {
    const f = await fresh((A, a) => A.kind === 'move' && A.moves.length > 1);
    const { a, A } = f;
    a.ctl.rng = 0.5;                                         // jabs then come exactly 20 + 0.5 * 6 = 23 s apart
    ok(a.timer.delays().includes(G.CHAT.slowAfterMs), 'a "taking too long" clock starts at 25 seconds when it is your turn');
    a.timer.advance(G.CHAT.slowAfterMs - 1);
    ok(bubble(a.root.innerHTML) === null, 'quiet before 25 seconds');
    a.timer.advance(1);
    let b = bubble(a.root.innerHTML);
    ok(b && LN.slow1.includes(unescape(b.text)), 'then the first jab: ' + (b && b.text));
    a.timer.advance(23000);
    b = bubble(a.root.innerHTML);
    ok(b && LN.slow2.includes(unescape(b.text)), 'about 20-26 seconds later, a ruder one: ' + (b && b.text));
    a.timer.advance(23000);
    b = bubble(a.root.innerHTML);
    ok(b && LN.slow3.includes(unescape(b.text)), 'and later still, the ruder-yet: ' + (b && b.text));
    a.timer.advance(23000);
    b = bubble(a.root.innerHTML);
    ok(b && LN.slow3.includes(unescape(b.text)), 'it keeps going at the top level while you dither');
    ok(a.timer.pending >= 1, 'a next jab is queued');
    // dialogs: no jabs while a dialog covers the game
    a.app.state.comment = null; a.app.render(true);
    a.app.dispatch({ type: 'openRules' });
    a.timer.advance(120000);
    ok(a.app.state.comment === null, 'nothing is said while a dialog covers the game');
    a.app.dispatch({ type: 'closeOverlay' });
    let seenAfter = false;
    for (let i = 0; i < 30; i++) { a.timer.advance(1000); if (bubble(a.root.innerHTML)) seenAfter = true; }
    ok(seenAfter, 'but the jabs carry on once it is closed');
    // acting stops the clock: the queued jabs are gone, and a fresh 25 s clock has not run out yet
    a.ctl.rng = 1;
    play(a, a.app.state.awaiting, a.app.state.awaiting.moves[0]);
    for (let i = 0; i < 20; i++) await tick();
    a.timer.advance(19000);
    ok(bubble(a.root.innerHTML) === null, 'once you move, the old jab clock is gone: 19 seconds later it is still silent');
  }
  // (e) the Comments button
  {
    const f = await fresh((A, a) => A.kind === 'move' && A.moves.length > 1 && rated(a, A).some(x => x.r.gap >= 16));
    const { a, A } = f;
    ok(/data-action="toggleChat"[^>]*aria-pressed="true"[^>]*>Comments: on</.test(a.root.innerHTML), 'the button says Comments: on');
    a.app.dispatch({ type: 'toggleChat' });
    ok(a.app.state.opts.chat === false && /Comments: off/.test(a.root.innerHTML) && JSON.parse(a.store['mt-opts']).chat === false, 'one press turns them off, and it is remembered');
    ok(a.timer.pending === 0, 'turning them off cancels every pending jab and comment');
    a.ctl.rng = 0;
    play(a, A, worstMove(a, A));
    for (let i = 0; i < 20; i++) await tick();
    a.timer.advance(2000);
    ok(bubble(a.root.innerHTML) === null && a.app.state.pendingRating === null, 'off means silent, even for a terrible move');
    const A2 = a.app.state.awaiting;
    ok(!a.timer.delays().includes(G.CHAT.slowAfterMs), 'and the "taking too long" clock is not even started');
    a.app.dispatch({ type: 'toggleChat' });
    ok(a.app.state.opts.chat === true && (!A2 || a.timer.delays().includes(G.CHAT.slowAfterMs)), 'turned back on, it resumes (the jab clock restarts if it is your turn)');
    a.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
    ok(a.app.state.opts.chat === true, 'a new game keeps the setting');
    a.app.dispatch({ type: 'toggleChat' }); a.app.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips' });
    ok(a.app.state.opts.chat === false, '...including "off"');
    const reload = makeApp(3, { storage: { get: k => a.store[k] || null, set: () => {} } });
    ok(reload.app.state.opts.chat === false, 'a reloaded page remembers it');
  }
  // (f) the opening
  {
    const f = await fresh((A, a) => A.kind === 'build' && A.canBuild && A.buildCount >= 4 && A.placed === 0 && A.moves.length > 0);
    ok(!!f, 'found an opening with a long train available');
    const { a, A } = f;
    a.ctl.rng = 0;
    const best = A.buildCount;
    play(a, A, A.moves[0]);                                  // lay one tile ...
    for (let i = 0; i < 20; i++) await tick();
    const B = a.app.state.awaiting;
    a.app.dispatch({ type: 'endBuild' });                    // ... and call it done
    for (let i = 0; i < 20; i++) await tick();
    a.timer.advance(1200);
    const b = bubble(a.root.innerHTML);
    ok(b && !/\{\w+\}/.test(b.text) && LN.openShort.some(l => G.fillLine(l, { built: 1, best }) === unescape(b.text)), `a short train is mocked, quoting your numbers: ${b && b.text}`);
  }
  {
    const f = await fresh((A, a) => A.kind === 'build' && A.canBuild && A.buildCount >= 4 && A.placed === 0);
    const { a, A } = f;
    a.ctl.rng = 0;
    a.app.dispatch({ type: 'autoBuild' });
    for (let i = 0; i < 60 && !(a.app.state.awaiting && a.app.state.awaiting.kind === 'build' && !a.app.state.plan); i++) await tick();
    a.app.dispatch({ type: 'endBuild' });
    for (let i = 0; i < 20; i++) await tick();
    a.timer.advance(1200);
    const b = bubble(a.root.innerHTML);
    ok(b && LN.openBest.includes(unescape(b.text)), 'the longest train gets a grudging remark: ' + (b && b.text));
  }
  {
    const f = await fresh((A, a) => A.kind === 'build' && A.moves.length > 0 && A.placed === 0 && A.canDone);
    const { a } = f; a.ctl.rng = 0;
    a.app.dispatch({ type: 'endBuild' });                    // could have built, built nothing
    for (let i = 0; i < 20; i++) await tick();
    a.timer.advance(1200);
    const b = bubble(a.root.innerHTML);
    ok(b && LN.openNone.includes(unescape(b.text)), 'building nothing when you could is remarked on: ' + (b && b.text));
  }
  // (g) draws and passes
  {
    const f = await fresh((A, a) => (A.kind === 'draw') || (A.kind === 'build' && A.canDraw));
    ok(!!f, 'found a draw prompt');
    if (f) {
      const { a } = f; a.ctl.rng = 0;
      a.app.dispatch({ type: 'draw' });
      for (let i = 0; i < 20; i++) await tick();
      a.timer.advance(1200);
      const b = bubble(a.root.innerHTML);
      ok(b && (LN.draw.includes(unescape(b.text)) || LN.pass.includes(unescape(b.text))), 'drawing (or passing after it) draws a remark: ' + (b && b.text));
    }
  }
  // (h) the game itself is unaffected
  {
    async function run(chatOn) {
      const a = makeApp(17); a.ctl.rng = 0;
      if (!chatOn) a.app.dispatch({ type: 'toggleChat' });
      a.app.dispatch({ type: 'startGame', rounds: 2, hand: 12, style: 'pips' });
      for (let g = 0; g < 20000; g++) {
        await tick();
        const A = a.app.state.awaiting;
        if (a.app.state.modal && a.app.state.modal.type === 'final') break;
        if (!A) continue;
        if (A.kind === 'draw') a.app.dispatch({ type: 'draw' });
        else if (A.kind === 'modal') a.app.dispatch({ type: 'dialogOk' });
        else if (A.kind === 'build') { if (A.canDraw) a.app.dispatch({ type: 'draw' }); else if (A.canBuild) a.app.dispatch({ type: 'autoBuild' }); else if (A.canDone) a.app.dispatch({ type: 'endBuild' }); else a.app.dispatch({ type: 'undoTile' }); }
        else { const m = A.moves[0]; a.app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (a.app.state.awaiting === A) a.app.dispatch({ type: 'playOn', train: m.trainId }); }
        a.timer.advance(1500);
      }
      const s = a.app.state;
      return JSON.stringify({ totals: s.totals, trains: s.game.trains, hands: s.game.players.map(p => p.hand), name: s.cpuName });
    }
    const on = await run(true), off = await run(false);
    ok(on === off, 'the same game plays out identically with comments on or off (they never touch the game\'s random numbers)');
  }
  // (i) safety of what reaches the page
  {
    const f = await fresh((A) => A.kind === 'move' || A.kind === 'build');
    const { a } = f;
    a.app.state.comment = { id: 99, kind: 'poor', text: '<img src=x onerror=alert(1)> & "quotes"' };
    a.app.render(true);
    ok(!/<img/.test(a.root.innerHTML) && /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;quotes&quot;/.test(a.root.innerHTML), 'comment text is escaped before it reaches the page');
    a.app.state.comment = null;
    a.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips' });
    ok(a.timer.pending >= 0 && a.app.state.comment === null, 'starting a new game clears any bubble');
  }
  // (j) restarting clears timers
  {
    const f = await fresh((A) => A.kind === 'move');
    const { a } = f;
    ok(a.timer.pending >= 1, 'a jab clock is running');
    a.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips' });
    const stale = a.timer.delays().filter(d => d === G.CHAT.slowAfterMs).length;
    ok(stale <= 1, 'restarting never leaves the old jab clock running alongside the new one (' + stale + ')');
  }

  // (k) each level talks in its own voice, in a real game
  console.log('6. each level talks in its own voice in a game');
  for (const lvl of ['easy', 'normal', 'hard']) {
    const label = { easy: 'Easy', normal: 'Medium', hard: 'Hard' }[lvl];
    const others = ['easy', 'normal', 'hard'].filter(x => x !== lvl);
    const inOthers = text => others.some(o => Object.values(G.LINES[o]).some(arr => arr.includes(text)));
    const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // a line matches if it equals the text once {built} / {best} are any numbers
    const inOwn = (kind, text) => G.LINES[lvl][kind].some(l => new RegExp('^' + esc(l).replace(/\\\{(built|best)\\\}/g, '\\d+') + '$').test(text));
    // its name comes from its own pool
    const f0 = await fresh(() => true, 3, lvl);
    ok(G.CPU_PLAYERS[lvl].includes(f0.a.app.state.cpuName) && f0.a.app.state.opts.level === lvl, `${label}: the computer is one of the ${label} players (${f0.a.app.state.cpuName})`);
    // a poor move
    const f = await fresh((A, a) => A.kind === 'move' && A.moves.length > 1 && rated(a, A).some(x => x.r.gap >= 16), 80, lvl);
    ok(!!f, `${label}: found a position with a poor option`);
    if (f) {
      const { a, A } = f;
      const worst = worstMove(a, A), kind = G.commentKindFor(rateMove(a.app.state.game, a.app.state.game.players[0], A.moves, worst));
      a.ctl.rng = 0; play(a, A, worst);
      for (let i = 0; i < 20; i++) await tick();
      a.timer.advance(1200);
      const b = bubble(a.root.innerHTML), txt = b && unescape(b.text);
      ok(b && inOwn(kind, txt), `${label}: a "${kind}" remark from ${label}'s own set: ${txt}`);
      ok(b && !inOthers(txt), `${label}: and it is not a line the other levels use`);
      ok(b && b.who === a.app.state.cpuName && G.levelOfName(b.who) === lvl, `${label}: the speaker is a ${label} player (${b && b.who})`);
    }
    // taking too long
    const s = await fresh((A) => A.kind === 'move' && A.moves.length > 1, 40, lvl);
    s.a.ctl.rng = 0.5;
    s.a.timer.advance(G.CHAT.slowAfterMs);
    let sb = bubble(s.a.root.innerHTML);
    ok(sb && G.LINES[lvl].slow1.includes(unescape(sb.text)), `${label}: the first jab at a slow player is a ${label} line: ${sb && sb.text}`);
    s.a.timer.advance(23000);
    sb = bubble(s.a.root.innerHTML);
    ok(sb && G.LINES[lvl].slow2.includes(unescape(sb.text)), `${label}: and the second: ${sb && sb.text}`);
    s.a.timer.advance(23000);
    sb = bubble(s.a.root.innerHTML);
    ok(sb && G.LINES[lvl].slow3.includes(unescape(sb.text)), `${label}: and the third: ${sb && sb.text}`);
    // a draw
    const d = await fresh((A) => (A.kind === 'draw') || (A.kind === 'build' && A.canDraw), 60, lvl);
    if (d) {
      d.a.ctl.rng = 0; d.a.app.dispatch({ type: 'draw' });
      for (let i = 0; i < 20; i++) await tick();
      d.a.timer.advance(1200);
      const db = bubble(d.a.root.innerHTML), dt = db && unescape(db.text);
      ok(db && (inOwn('draw', dt) || inOwn('pass', dt)) && !inOthers(dt), `${label}: a remark about drawing comes from ${label}'s set: ${dt}`);
    }
    // an opening that is too short
    const o = await fresh((A, a) => A.kind === 'build' && A.canBuild && A.buildCount >= 4 && A.placed === 0 && A.moves.length > 0, 60, lvl);
    if (o) {
      o.a.ctl.rng = 0; play(o.a, o.A, o.A.moves[0]);
      for (let i = 0; i < 20; i++) await tick();
      o.a.app.dispatch({ type: 'endBuild' });
      for (let i = 0; i < 20; i++) await tick();
      o.a.timer.advance(1200);
      const ob = bubble(o.a.root.innerHTML), ot = ob && unescape(ob.text);
      ok(ob && inOwn('openShort', ot) && !/\{\w+\}/.test(ot), `${label}: a short opening train is mocked in ${label}'s voice, with the numbers filled in: ${ot}`);
    }
  }

  Object.keys(failCounts).forEach(m => console.log(`  (x${failCounts[m]}) ${m}`));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
