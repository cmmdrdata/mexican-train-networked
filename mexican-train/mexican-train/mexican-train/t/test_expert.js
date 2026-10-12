'use strict';
// The new Hard rule (do not leave the other player something to play), what a pass tells everyone (game.noMatch), the Expert's look-ahead,
// and the fourth level wherever levels appear.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { newRound, playRound, legalMoves, cpuChoose, cpuChooseAsync, cpuBuildAction, tilesNotSeen, chanceHolds, guessHiddenTiles, mulberry32, handPips } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const noUi = () => ({ onNeedDraw() {}, onDraw() {}, onPass() {}, onPlay() {}, onBuildPlay() {}, onBuildUndo() {}, onBuildDraw() {}, onBuildPass() {}, onBuildDone() {}, onOpeningDone() {} });
const tid = t => (t[0] <= t[1] ? t[0] * 13 + t[1] : t[1] * 13 + t[0]);
const sorted = a => a.slice().sort((x, y) => x - y);

(async () => {
  console.log('1. what a pass tells everyone (game.noMatch)');
  {
    let checks = 0, shown = 0, bad = [], afterDraw = 0, afterDrawBad = 0, unseenBad = 0, unseenChecks = 0;
    for (let i = 0; i < 500; i++) {
      const n = i % 2 === 0 ? 2 : 3;
      const g = newRound({ engine: i % 13, handSize: [8, 12, 15][i % 3], rng: mulberry32(100 + i), simultaneousOpening: true, players: n });
      const ctl = { act: async (gm, p, info) => cpuBuildAction(gm, p, info, 'hard'), choose: async (gm, p, ms) => {
        for (const q of gm.players) {                                                  // at EVERY decision: what is said about anyone's hand is true
          const k = gm.noMatch && gm.noMatch[q.id];
          if (k) { shown++; checks++; if (!q.hand.every(t => !k.includes(t[0]) && !k.includes(t[1]))) bad.push(`round ${i}: ${q.id} was said to hold no ${k} but holds ${JSON.stringify(q.hand)}`); }
        }
        unseenChecks++;                                                                // ... and the tiles nobody can see add up
        const un = tilesNotSeen(gm, p);
        if (un.length !== gm.players.filter(x => x !== p).reduce((s, x) => s + x.hand.length, 0) + gm.boneyard.length) unseenBad++;
        return cpuChoose(gm, p, ms, 'hard');
      } };
      const ui = Object.assign(noUi(), { onDraw: async (gm, p) => { afterDraw++; if (gm.noMatch[p.id] !== null) afterDrawBad++; } });
      const controllers = {}; g.players.forEach(p => { controllers[p.id] = ctl; });
      await playRound(g, i % n, controllers, ui, {});
    }
    ok(shown > 1500, `many decisions had something known about a hand (${shown})`);
    ok(bad.length === 0, 'at every decision, whatever noMatch says a player does not hold, they do not hold' + (bad[0] ? ' (' + bad[0] + ')' : ''));
    ok(afterDraw > 500 && afterDrawBad === 0, `a draw always wipes what was known about that player (${afterDraw} draws)`);
    ok(unseenChecks > 3000 && unseenBad === 0, `the tiles nobody can see always add up to the others' hands plus the boneyard (${unseenChecks} decisions, two and three players)`);
  }
  {
    // a pass is recorded with exactly the ends that player could have played on
    const g = newRound({ engine: 12, handSize: 3, rng: mulberry32(1), players: 3 });
    g.players[0].hand = [[0, 1], [0, 2], [1, 2]]; g.players[1].hand = [[3, 4], [3, 5], [4, 5]]; g.players[2].hand = [[6, 7], [6, 8], [7, 8]];
    g.boneyard = [[9, 10]];
    g.trains.cpu.marker = true; g.trains.cpu.end = 3; g.trains.mexican.end = 12;       // cpu's train is open (they passed before)
    const seen = [];
    const ui = Object.assign(noUi(), { onPass: async (gm, p) => { if (!seen.length) seen.push([p.id, gm.noMatch[p.id].slice()]); } });
    const c = { act: async () => ({ type: 'done' }), choose: async (gm, p, ms) => ms[0] };
    await playRound(g, 0, { human: c, cpu: c, cpu2: c }, ui, {});
    ok(seen.length === 1 && seen[0][0] === 'human' && sorted(seen[0][1]).join() === '3,12,12', `a pass records the ends the player could have played on (their own, the shared train's, and the open train's): ${JSON.stringify(seen[0])}`);
  }

  console.log('2. the chance that someone holds a tile for a number');
  {
    const un = [[0, 1], [0, 2], [1, 2], [3, 4], [3, 5], [4, 5]];
    // exact answer by listing every possible hand of two
    const exact = nums => { let hit = 0, all = 0; for (let a = 0; a < un.length; a++) for (let b = a + 1; b < un.length; b++) { all++; if ([un[a], un[b]].some(t => nums.includes(t[0]) || nums.includes(t[1]))) hit++; } return hit / all; };
    for (const nums of [[0], [3], [0, 3], [1, 4], [9]]) ok(Math.abs(chanceHolds(2, nums, un, null) - exact(nums)) < 1e-9, `matches counting every possible hand for the numbers ${nums} (${exact(nums).toFixed(3)})`);
    ok(chanceHolds(0, [0], un, null) === 0 && chanceHolds(2, [9], un, null) === 0, 'no tiles in hand, or a number nobody can hold: no chance');
    ok(chanceHolds(6, [0], un, null) === 1 && chanceHolds(5, [0], un, null) === 1, 'holding everything that is unseen (or all but one tile), a number that is among them is certain here');
    ok(chanceHolds(2, [0], un, [0]) === 0, 'a number their last pass ruled out is no chance at all');
    ok(chanceHolds(2, [3], un, [0]) > chanceHolds(2, [3], un, null), 'and ruling out other numbers makes the remaining ones more likely (the tiles left to hold shrink)');
    let mono = true; for (let h = 1; h < 6; h++) if (chanceHolds(h + 1, [0, 3], un, null) < chanceHolds(h, [0, 3], un, null) - 1e-12) mono = false;
    ok(mono, 'the more tiles they hold, the more likely they have one');
  }

  console.log('3. Hard now weighs what a move leaves the other player');
  {
    // The computer holds [4,9] and [4,8]; the human\'s open train and the shared train both need a 4. Playing [4,9] is worth one pip more.
    // Either tile leaves a 4 where it was and puts a new number (9 or 8) on a train the human can play on. Which is better depends on what is left of 9 and 8.
    const position = (dead, known) => {
      const g = newRound({ engine: 12, handSize: 4, rng: mulberry32(3), players: 2 });
      const cpu = g.players[1];
      cpu.hand = [[4, 9], [4, 8], [0, 1], [0, 2]]; g.players[0].hand = [[1, 3], [2, 3], [6, 7], [10, 11]];
      g.trains.human.marker = true; g.trains.human.end = 4; g.trains.mexican.end = 4; g.trains.cpu.end = 12;
      g.trains.mexican.tiles = [];
      if (dead != null) for (let n = 0; n <= 12; n++) { const t = n <= dead ? [n, dead] : [dead, n]; if (!(t[0] === 4 && t[1] === 9) && !(t[0] === 4 && t[1] === 8)) g.trains.mexican.tiles.push(t); }
      if (known) g.noMatch = known;
      return g;
    };
    const pick = (dead, known, level, seed) => { const g = position(dead, known); g.rng = mulberry32(seed); const ms = legalMoves(g, g.players[1]); const m = cpuChoose(g, g.players[1], ms, level || 'hard'); return `${m.tile}`; };
    const tally = (dead, known, level) => { const t = {}; for (let s = 1; s <= 120; s++) { const k = pick(dead, known, level, s); t[k] = (t[k] || 0) + 1; } return t; };
    const base = tally(null, null);
    ok(base['4,9'] === 120, `with nothing special about 8 or 9, it plays the heavier tile, [4,9] (${JSON.stringify(base)})`);
    const dead8 = tally(8, null);
    ok(dead8['4,8'] === 120, `when every other 8 is already on the table (an 8 end is dead, a 9 end is not), it plays [4,8] every time, leaving the human nothing there: ${JSON.stringify(dead8)}`);
    const dead9 = tally(9, null);
    ok(dead9['4,9'] === 120, `and when it is 9 that is dead, it plays [4,9]: ${JSON.stringify(dead9)}`);
    const learned = tally(8, { human: [9] });
    ok(learned['4,9'] === 120, `if the human's last pass showed they hold no 9, a 9 is safe too, and the heavier tile wins again: ${JSON.stringify(learned)}`);
    const expert = tally(8, null, 'expert');
    ok(expert['4,8'] === 120, `the synchronous choice for an Expert is the same as Hard's: ${JSON.stringify(expert)}`);
    // what the rule sees: an 8 is certain to be dead (nobody can hold one), a 9 is not
    const g8 = position(8, null), un8 = tilesNotSeen(g8, g8.players[1]);
    ok(chanceHolds(4, [8], un8, null) === 0 && chanceHolds(4, [9], un8, null) > 0.3, 'the rule sees the 8 as certainly dead (no chance the human holds one) and the 9 as quite possible: ' + chanceHolds(4, [9], un8, null).toFixed(2));
  }

  console.log('4. the Expert');
  {
    const midGame = async seed => {                                  // a real two-player position, a few turns in
      const g = newRound({ engine: 12, handSize: 12, rng: mulberry32(seed), simultaneousOpening: true, players: 2 });
      let turns = 0, snap = null;
      const ctl = { act: async (gm, p, info) => cpuBuildAction(gm, p, info, 'hard'), choose: async (gm, p, ms) => {
        if (turns++ >= 6 && ms.length > 2 && p.id === 'cpu' && !snap) { snap = { g: gm, p, ms }; throw new Error('STOP'); }
        return cpuChoose(gm, p, ms, 'hard');
      } };
      try { await playRound(g, 0, { human: ctl, cpu: ctl }, noUi(), {}); } catch (e) { if (e.message !== 'STOP') throw e; }
      return snap;
    };
    const state = gm => JSON.stringify([gm.players.map(p => p.hand), gm.boneyard, gm.trains, gm.openDouble, gm.noMatch || null]);
    let legal = 0, untouched = 0, oneRng = 0, deterministic = 0, trials = 0, mexicoOk = 0;
    for (let seed = 1; seed <= 45; seed++) {
      const s = await midGame(seed); if (!s) continue; trials++;
      const before = state(s.g);
      let calls = 0; const r0 = s.g.rng; s.g.rng = () => { calls++; return r0(); };
      const m = await cpuChooseAsync(s.g, s.p, s.ms, 'expert');
      s.g.rng = r0;
      if (s.ms.includes(m)) legal++;
      if (state(s.g) === before) untouched++;
      if (calls === 1) oneRng++;
      const s2 = await midGame(seed), m2 = await cpuChooseAsync(s2.g, s2.p, s2.ms, 'expert');
      if (m2.tile.join() === m.tile.join() && m2.trainId === m.trainId) deterministic++;
    }
    ok(trials >= 20, `${trials} real positions to choose in`);
    ok(legal === trials, 'the Expert always returns one of the legal moves it was given');
    ok(untouched === trials, 'and thinking about the move leaves the real game exactly as it was (hands, boneyard, trains, what is known)');
    ok(oneRng === trials, 'and takes exactly one number from the game\'s random numbers (the rest of its guessing uses its own), so it does not disturb a seeded game');
    ok(deterministic === trials, 'in the same position with the same random numbers it makes the same choice');
    // it goes out when it can
    const g = newRound({ engine: 12, handSize: 2, rng: mulberry32(9), players: 2 });
    g.players[1].hand = [[12, 5], [5, 6]]; g.players[0].hand = [[1, 2], [3, 4]];
    g.trains.cpu.end = 12; g.trains.mexican.end = 6; g.trains.human.end = 11;
    const ms = legalMoves(g, g.players[1]);
    const mv = await cpuChooseAsync(g, g.players[1], ms, 'expert');
    ok(ms.length >= 2 && ms.includes(mv), 'with two moves available it picks one of them');
    // a lone legal move is returned at once
    const one = [ms[0]];
    ok((await cpuChooseAsync(g, g.players[1], one, 'expert')) === ms[0], 'a single legal move is simply returned');
    // three players: it plays as Hard (same random numbers, same answer)
    let same3 = 0, n3 = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g3 = newRound({ engine: 12, handSize: 10, rng: mulberry32(seed), players: 3 });
      const p = g3.players[0], moves = legalMoves(g3, p); if (moves.length < 2) continue;
      n3++;
      g3.rng = mulberry32(5); const a = await cpuChooseAsync(g3, p, moves, 'expert');
      g3.rng = mulberry32(5); const b = cpuChoose(g3, p, moves, 'hard');
      if (a === b) same3++;
    }
    ok(n3 >= 10 && same3 === n3, `at a table of three the Expert plays exactly as Hard does (${same3}/${n3} positions)`);
    // the guesses at the hidden tiles
    const s = await midGame(7);
    if (s) {
      const world = guessHiddenTiles(s.g, s.p, mulberry32(1));
      const opp = s.g.players.find(x => x !== s.p);
      const un = tilesNotSeen(s.g, s.p), mine = [].concat(world.hands[opp.id], world.boneyard);
      ok(world.hands[opp.id].length === opp.hand.length && world.boneyard.length === s.g.boneyard.length, 'a guess gives the other player a hand of the size they really have, and a boneyard of the real size');
      ok(sorted(mine.map(tid)).join() === sorted(un.map(tid)).join(), 'and uses exactly the tiles nobody can see, once each');
      s.g.noMatch = { [opp.id]: [3, 7] };
      let honoured = true; for (let k = 0; k < 40; k++) { const w = guessHiddenTiles(s.g, s.p, mulberry32(k)); if (w.hands[opp.id].some(t => t.includes(3) || t.includes(7))) honoured = false; }
      ok(honoured, 'and a guess never gives them a tile for a number their pass showed they do not hold');
    }
  }

  console.log('5. the fourth level, wherever levels appear');
  {
    ok(E.LEVELS.join() === 'easy,normal,hard,expert' && E.LEVEL_LABEL.expert === 'Expert' && E.LEVEL_LABEL.normal === 'Medium', 'the levels: Easy, Medium, Hard, Expert');
    const cl = G.CPU_PLAYERS;
    ok(cl.hard.length === 8 && cl.expert.length === 8 && cl.easy.length === 16 && cl.normal.length === 16, 'the classic players: 16 Easy, 16 Medium, the old 16 Hard shared out as 8 Hard and 8 Expert');
    ok(new Set(G.CPU_NAMES).size === G.CPU_NAMES.length && G.CPU_NAMES.length === 48, 'every one of the 48 players is at exactly one level');
    ok(G.levelOfName('Chiara') === 'expert' && G.levelOfName('Ingrid') === 'hard' && G.levelOfName('Kenji') === 'expert' && G.levelOfName('Stefan') === 'hard', 'a classic player\'s level is found from the name');
    ok(G.levelOfName('Gandalf', 'lotr') === 'expert' && G.levelOfName('Aragorn', 'lotr') === 'hard' && G.levelOfName('Saruman', 'lotr') === 'expert' && G.levelOfName('Elrond', 'lotr') === 'hard', 'and a themed character\'s too');
    const rnd = mulberry32(4); let allExpert = true, allThemedExpert = true;
    for (let i = 0; i < 60; i++) { if (!cl.expert.includes(G.pickCpuName('expert', rnd, new Set()))) allExpert = false; if (!G.THEMES.lotr.players.expert.includes(G.pickCpuName('expert', rnd, new Set(), 'lotr'))) allThemedExpert = false; }
    ok(allExpert && allThemedExpert, 'an Expert computer is always one of the Experts (classic or themed)');
    ok(G.LINES.expert === G.LINES.hard, 'an Expert talks like Hard');
    ok(typeof E.cpuChooseAsync === 'function' && typeof E.guessHiddenTiles === 'function', '(the engine exports what the page and the server use)');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
