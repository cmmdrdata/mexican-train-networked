'use strict';
// A player who cannot play (after drawing, if there is anything to draw) puts the marker on THEIR OWN train, and nothing else
// changes. This is checked in the engine over thousands of rounds, especially with the boneyard empty or nearly empty, on every
// hosted player's screen, and in hand-made cases of the awkward situations.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { OnlineMatch } = require('../online-match.js');
const { newRound, playRound, cpuChoose, cpuBuildAction, mulberry32 } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const SEATS = ['human', 'cpu', 'cpu2'];
const noUi = () => ({ onNeedDraw() {}, onDraw() {}, onPass() {}, onPlay() {}, onBuildPlay() {}, onBuildUndo() {}, onBuildDraw() {}, onBuildPass() {}, onBuildDone() {}, onOpeningDone() {} });

(async () => {
  console.log('1. the engine, over many rounds');
  {
    const bad = []; let rounds = 0, passes = 0, afterDrawing = 0, nothingToDraw = 0, byBoneyard = { empty: 0, one_to_four: 0, five_plus: 0 };
    for (let i = 0; i < 1500; i++) {
      const n = i % 3 === 0 ? 3 : 2, hand = [8, 12, 15][(i % 3 === 0 ? i / 3 : i) % 3 | 0];
      const g = newRound({ engine: i % 13, handSize: hand, rng: mulberry32(7000 + i), simultaneousOpening: true, players: n });
      const trim = [0, 0, 1, 2, 3, 5, 8][i % 7], ids = g.players.map(p => p.id), level = ['easy', 'normal', 'hard'][i % 3];
      let drew = false, before = null, passed = false, playedOwn = false, playedOther = false;
      const snap = () => ids.concat(['mexican']).map(id => g.trains[id].marker);
      const ctl = { act: async (gm, p, info) => cpuBuildAction(gm, p, info, level), choose: async (gm, p, m) => { before = before || snap(); return cpuChoose(gm, p, m, level); } };
      const controllers = {}; ids.forEach(id => { controllers[id] = ctl; });
      const ui = Object.assign(noUi(), {
        onNeedDraw: async () => { before = snap(); }, onDraw: async () => { drew = true; },
        onPass: async () => { passed = true; if (before === null) before = snap(); },
        onPlay: async (gm, p, mv) => { if (before === null) before = snap(); if (mv.trainId === p.id) playedOwn = true; else playedOther = true; },
        onOpeningDone: async gm => { if (i % 2 === 0) while (gm.boneyard.length > trim) gm.boneyard.pop(); },          // a shortage, as in a long game
      });
      const hooks = { onTurn: (gm, p) => {
        const after = snap(), k = ids.indexOf(p.id);
        if (before === null) before = after;
        for (let j = 0; j < after.length; j++) {
          let want = before[j];
          if (j === k && passed) want = true; else if (j === k && playedOwn) want = false;
          if (after[j] !== want) bad.push(`round ${i} (${n} players, boneyard ${gm.boneyard.length}): ${p.id}'s turn changed the marker of ${(ids.concat(['mexican']))[j]} from ${before[j]} to ${after[j]}`);
        }
        if (passed) { passes++; drew ? afterDrawing++ : nothingToDraw++; byBoneyard[gm.boneyard.length === 0 ? 'empty' : gm.boneyard.length < 5 ? 'one_to_four' : 'five_plus']++; }
        before = null; drew = false; passed = false; playedOwn = false; playedOther = false;
      } };
      await playRound(g, i % n, controllers, ui, hooks);
      rounds++;
    }
    console.log(`   ${rounds} rounds, ${passes} passes: ${afterDrawing} after drawing, ${nothingToDraw} with nothing to draw; boneyard empty ${byBoneyard.empty}, 1-4 tiles ${byBoneyard.one_to_four}, 5 or more ${byBoneyard.five_plus}`);
    ok(passes > 5000 && afterDrawing > 1000 && nothingToDraw > 300 && byBoneyard.empty > 500 && byBoneyard.one_to_four > 300, 'the rounds covered what matters: passes after drawing, passes with nothing to draw, and an empty or nearly empty boneyard');
    ok(bad.length === 0, 'after every turn of every round: a pass puts the marker on the passing player\'s own train and changes nothing else; playing on your own train takes your marker off; no other turn changes any marker; the Mexican train never has one' + (bad[0] ? ' (' + bad[0] + ')' : ''));
  }

  console.log('2. hand-made: a player who must draw, with the boneyard nearly empty');
  const rig = (hands, boneyard, players) => {
    const g = newRound({ engine: 12, handSize: 3, rng: mulberry32(1), players });
    hands.forEach((h, i) => { g.players[i].hand = h.map(t => t.slice()); });
    g.boneyard = boneyard.map(t => t.slice());
    return g;
  };
  const marks = g => SEATS.map(id => (g.trains[id] ? (g.trains[id].marker ? 'M' : '-') : '')).join('') + (g.trains.mexican.marker ? 'M' : '-');
  const ctlOwn = { act: async () => ({ type: 'done' }), choose: async (gm, p, m) => m.find(x => x.trainId === p.id) || m[0] };
  {
    // A: nobody holds a 12 (every train needs one), and the boneyard holds exactly one tile, which is no 12 either
    const g = rig([[[0, 1], [0, 2], [0, 3]], [[1, 2], [1, 3], [2, 3]], [[4, 5], [4, 6], [5, 6]]], [[3, 4]], 3);
    const events = [], after = [];
    const ui = Object.assign(noUi(), { onNeedDraw: async (gm, p) => events.push(`${p.id} must draw`), onDraw: async (gm, p, tile) => events.push(`${p.id} drew ${tile}`), onPass: async (gm, p) => { events.push(`${p.id} passed`); after.push(marks(gm)); } });
    const res = await playRound(g, 0, { human: ctlOwn, cpu: ctlOwn, cpu2: ctlOwn }, ui, {});
    ok(events.join(' | ') === 'human must draw | human drew 3,4 | human passed', 'the first player must draw, takes the last tile, still cannot play, and passes: ' + events.join(' | '));
    ok(after.join(' ') === 'M---', 'the marker goes on THEIR OWN train, and nobody else\'s (human, cpu, cpu2, Mexican): ' + after.join(' '));
    ok(res.blocked === true && g.boneyard.length === 0, 'and since nobody can play any more, the round is blocked at once');
  }
  {
    // B: the boneyard is empty. The first two cannot play and pass without drawing; the third holds a 12 and plays.
    const g = rig([[[0, 1], [0, 2], [0, 3]], [[1, 2], [1, 3], [2, 3]], [[12, 5], [4, 6], [5, 6]]], [], 3);
    const events = [], seen = [];
    const ui = Object.assign(noUi(), { onNeedDraw: async (gm, p) => events.push(`${p.id} must draw`), onDraw: async (gm, p) => events.push(`${p.id} drew`), onPass: async (gm, p) => { events.push(`${p.id} passed`); seen.push(marks(gm)); }, onPlay: async (gm, p, mv) => { events.push(`${p.id} played ${mv.tile} on ${mv.trainId}`); seen.push(marks(gm)); } });
    let turns = 0;
    await playRound(g, 0, { human: ctlOwn, cpu: ctlOwn, cpu2: ctlOwn }, ui, { onTurn: () => { turns++; } });
    ok(events.slice(0, 3).join(' | ') === 'human passed | cpu passed | cpu2 played 12,5 on cpu2', 'with nothing to draw, the first two pass at once (no draw), and the third plays: ' + events.slice(0, 3).join(' | '));
    ok(seen.slice(0, 3).join(' ') === 'M--- MM-- MM--', 'the markers: human\'s train after the first pass, then cpu\'s as well, and the third player (who played on their own train) has none: ' + seen.slice(0, 3).join(' '));
  }
  {
    // C: the player draws the last tile and it FITS: it is played, and no marker goes anywhere
    const g = rig([[[0, 1], [0, 2]], [[1, 2], [1, 3]]], [[12, 5]], 2);
    const events = [], first = [];
    const ui = Object.assign(noUi(), { onNeedDraw: async () => events.push('must draw'), onDraw: async (gm, p, tile) => events.push('drew ' + tile), onPass: async () => events.push('PASSED'), onPlay: async (gm, p, mv) => { if (events.length < 4) events.push(`played ${mv.tile} on ${mv.trainId}`); } });
    await playRound(g, 0, { human: ctlOwn, cpu: ctlOwn }, ui, { onTurn: (gm) => { if (!first.length) first.push(marks(gm)); } });
    ok(events.slice(0, 3).join(' | ') === 'must draw | drew 12,5 | played 12,5 on human' && first[0] === '---', 'a player who draws a tile that fits plays it, and no marker goes anywhere: ' + events.slice(0, 3).join(' | ') + ' / ' + first[0]);
  }

  console.log('3. hand-made: the opening is simultaneous, so two players can want the last tile');
  for (const tilesLeft of [1, 2]) {
    const g = newRound({ engine: 12, handSize: 3, rng: mulberry32(2), simultaneousOpening: true, players: 3 });
    const no12 = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 6], [3, 4], [3, 5]];
    g.players[0].hand = [no12[0], no12[1], no12[2]]; g.players[1].hand = [no12[3], no12[4], no12[5]]; g.players[2].hand = [no12[6], no12[7], no12[8]];
    g.boneyard = [no12[9], no12[10]].slice(0, tilesLeft);
    const total = () => g.players.reduce((a, p) => a + p.hand.length, 0) + g.boneyard.length;
    const before = total(), passes = [];
    const ui = Object.assign(noUi(), { onBuildPass: async (gm, p) => passes.push(p.id) });
    const ctl = { act: async (gm, p, info) => (info.canDraw ? { type: 'draw' } : { type: 'done' }), choose: async (gm, p, m) => m[0] };
    let thrown = null, res = null;
    try { res = await playRound(g, 0, { human: ctl, cpu: ctl, cpu2: ctl }, ui, {}); } catch (e) { thrown = e; }
    const drawers = g.players.filter(p => p.hand.length === 4).length;
    ok(thrown === null, `${tilesLeft} tile${tilesLeft > 1 ? 's' : ''} left for three players who all want one: no crash` + (thrown ? ' (' + thrown.message + ')' : ''));
    ok(g.players.every(p => p.hand.every(t => Array.isArray(t) && t.length === 2 && t.every(Number.isInteger))), `...and no hand holds a tile that is not there`);
    ok(total() === before && drawers === tilesLeft, `...${tilesLeft} player${tilesLeft > 1 ? 's' : ''} drew, in turn, and no tile was lost or made up (${drawers} drew)`);
    ok(SEATS.every(id => g.trains[id].marker === true) && g.players.every(p => g.opening[p.id].finished), '...everybody ended up passing, each with the marker on their own train');
    ok(res && res.blocked === true, '...and the round is blocked (nobody can play)');
  }

  console.log('4. hosted games: every player\'s own screen, after every pass');
  {
    const bad = []; let matches = 0, passes = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const withComputer = seed % 2 === 0, rnd = mulberry32(seed + 5000), trim = [0, 1, 2, 3, 5][seed % 5];
      const m = new OnlineMatch({ rounds: 1, hand: [8, 12, 15][seed % 3], names: withComputer ? ['Ann', 'Ben', 'Zed'] : ['Ann', 'Ben'], computer: withComputer ? { level: ['easy', 'normal', 'hard'][seed % 3] } : undefined,
        rng: mulberry32(seed), sleep: async () => {}, stepDelay: 0, paceRng: () => 0, push() {}, theme: seed % 4 === 0 ? 'lotr' : 'classic' });
      const oDone = m.hooks.onOpeningDone;
      m.hooks.onOpeningDone = async function (g) { while (g.boneyard.length > trim) g.boneyard.pop(); return oDone.apply(this, arguments); };
      let before = null;
      const oPass = m.hooks.onPass, oNeed = m.hooks.onNeedDraw, oPlay = m.hooks.onPlay, marks = g => SEATS.slice(0, m.n).map(id => g.trains[id].marker);
      m.hooks.onNeedDraw = async function (g) { before = before || marks(g); return oNeed.apply(this, arguments); };
      m.hooks.onPlay = async function (g) { before = before || marks(g); const r = await oPlay.apply(this, arguments); before = null; return r; };
      m.hooks.onPass = async function (g, p) {
        const prev = before || marks(g); before = null;
        const r = await oPass.apply(this, arguments); passes++;
        const passer = SEATS.indexOf(p.id);
        for (const seat of m.humans) {
          const v = m.viewFor(seat);
          SEATS.slice(0, m.n).forEach((id, idx) => {
            const shown = v.game.trains[m.cid(seat, id)].marker, want = idx === passer ? true : prev[idx];
            if (shown !== want) bad.push(`seed ${seed}: ${m.names[seat]}'s screen shows ${shown} on ${m.names[idx]}'s train after ${m.names[passer]} passed (expected ${want})`);
          });
        }
        return r;
      };
      m.start();
      for (let guard = 0; !m.over && guard < 20000; guard++) {
        for (const s of m.humans) {
          const aw = m.awaiting[s]; if (!aw) continue;
          const play = mv => m.intent(s, { a: 'play', tile: mv.tile, train: m.cid(s, mv.trainId) });
          if (aw.kind === 'modal') m.intent(s, { a: 'ok' }); else if (aw.kind === 'draw') m.intent(s, { a: 'draw' });
          else if (aw.kind === 'move') play(aw.moves[Math.floor(rnd() * aw.moves.length)]);
          else if (aw.kind === 'build') { const i = aw.info; if (i.canDraw) m.intent(s, { a: 'draw' }); else if (i.canBuild && rnd() < 0.4) m.intent(s, { a: 'autoBuild' }); else if (i.moves.length && rnd() < 0.6) play(i.moves[Math.floor(rnd() * i.moves.length)]); else m.intent(s, { a: i.canDone ? 'done' : 'undo' }); }
        }
        await tick();
      }
      matches++;
    }
    ok(matches === 100 && passes > 600, `${matches} hosted matches (two people, and two with a computer; both themes; the boneyard cut to 0-5 tiles after the opening): ${passes} passes, each checked on every person's screen`);
    ok(bad.length === 0, 'after every pass, every person\'s screen shows the marker on the train of the player who passed, and the others as they were' + (bad[0] ? ' (' + bad[0] + ')' : ''));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
