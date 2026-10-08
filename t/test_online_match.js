'use strict';
const { OnlineMatch, cleanName, CHAT_PHRASES, SEATS } = require('../online-match.js');
const E = globalThis.MexicanTrainGame.Engine;
const { mulberry32, key } = E;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canon = t => [Math.min(t[0], t[1]), Math.max(t[0], t[1])];

/* ---------------------------------------------------------------------------------------------
 * A harness: a match with both seats played by a policy, and a watcher on EVERY message sent.
 * ------------------------------------------------------------------------------------------- */
function harness(opts) {
  const h = { pushes: 0, problems: [], last: [null, null], events: [[], []], match: null, sent: [[], []] };
  const patterns = t => [`[${t[0]},${t[1]}]`, `[${t[1]},${t[0]}]`];
  const leaks = (json, tiles) => tiles.filter(t => patterns(t).some(p => json.includes(p)));
  h.match = new OnlineMatch(Object.assign({ names: ['Ann', 'Ben'], rounds: 1, hand: 12, stepDelay: 0, sleep: async () => {}, rng: mulberry32(1) }, opts, {
    push(seat, msg) {
      h.pushes++; h.last[seat] = msg; h.events[seat].push(...msg.events); h.sent[seat].push(msg);
      if (opts && opts.noWatch) return;
      const json = JSON.stringify(msg);
      const g = h.match.game, v = msg.view;
      if (g && !(v.modal && v.modal.type === 'roundEnd')) {
        const meId = SEATS[seat], oppId = SEATS[1 - seat];
        const secret = [];
        g.players.find(p => p.id === oppId).hand.forEach(t => secret.push(t));       // their hand
        g.boneyard.forEach(t => secret.push(t));                                      // the boneyard
        if (g.opening && !g.opening[oppId].finished) g.trains[oppId].tiles.forEach(t => secret.push(t));   // their train while it is face down
        const bad = leaks(json, secret);
        if (bad.length) h.problems.push(`seat ${seat} was shown ${bad.map(t => t.join('-')).join(', ')} (seq ${msg.seq})`);
      }
      if (g) {                                                                       // no tile is ever lost or invented
        const all = [];
        g.players.forEach(p => p.hand.forEach(t => all.push(key(canon(t)))));
        g.boneyard.forEach(t => all.push(key(canon(t))));
        ['human', 'cpu', 'mexican'].forEach(id => g.trains[id].tiles.forEach(t => all.push(key(canon(t)))));
        if (all.length !== 90 || new Set(all).size !== 90) h.problems.push(`tiles lost or duplicated: ${all.length} tiles, ${new Set(all).size} different (seq ${msg.seq})`);
      }
    },
  }));
  return h;
}

function randomPolicy(rnd) {
  return (seat, v) => {
    const a = v.awaiting;
    if (a.kind === 'modal') return { a: 'ok' };
    if (a.kind === 'draw') return { a: 'draw' };
    const pick = () => a.moves[Math.floor(rnd() * a.moves.length)];
    if (a.kind === 'move') { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    if (a.canDraw) return { a: 'draw' };
    if (a.canBuild && rnd() < 0.25) return { a: 'autoBuild' };
    if (a.moves.length && rnd() < 0.7) { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    if (a.canDone && rnd() < 0.5) return { a: 'done' };
    if (a.canUndo && rnd() < 0.3) return { a: 'undo' };
    if (a.canDone) return { a: 'done' };
    if (a.moves.length) { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    return { a: 'undo' };
  };
}

// play both seats until the match is over (or a step budget runs out)
async function playOut(h, policy, budget, hooks) {
  const m = h.match;
  const run = m.start();
  let steps = 0, stuck = 0;
  while (!m.over && steps < (budget || 20000)) {
    let acted = false;
    for (const seat of [0, 1]) {
      const v = m.viewFor(seat);
      if (v.awaiting && !m.paused) {
        const intent = policy(seat, v);
        const r = m.intent(seat, intent);
        if (!r.ok) { h.problems.push(`a legal-looking intent was refused: ${JSON.stringify(intent)} -> ${r.code}`); return false; }
        acted = true; steps++;
      }
    }
    if (hooks) hooks(m, steps);
    await tick();
    stuck = acted ? 0 : stuck + 1;
    if (stuck > 400) { h.problems.push('the match stopped making progress'); break; }
  }
  if (!m.over) m.abort();
  await run;
  return m.over === 'finished';
}

/* ---------------------------------------------------------------------------------------------
 * A deal of our choosing, by running the game's Fisher-Yates shuffle backwards (see test_first_turn_win).
 * ------------------------------------------------------------------------------------------- */
const ENGINE = 12;
const POOL = (() => { const t = []; for (let a = 0; a <= 12; a++) for (let b = a; b <= 12; b++) if (!(a === ENGINE && b === ENGINE)) t.push([a, b]); return t; })();
function dealRng({ seat0, seat1, hand, start = 0 }) {
  const mine = seat0.map(canon), theirs = seat1.map(canon);
  const used = new Set([...mine, ...theirs].map(key));
  if (used.size !== mine.length + theirs.length || mine.length !== hand || theirs.length !== hand) throw new Error('the rigged deal gives a tile to both players, or the wrong number of tiles');
  const rest = POOL.filter(t => !used.has(key(t)));
  const target = [...mine, ...theirs, ...rest];
  const w = POOL.map(t => t.slice()), values = [];
  for (let i = target.length - 1; i >= 1; i--) {
    const j = w.slice(0, i + 1).findIndex(t => key(t) === key(target[i]));
    values.push((j + 0.5) / (i + 1));
    [w[i], w[j]] = [w[j], w[i]];
  }
  const fallback = mulberry32(777);
  const seq = [start === 0 ? 0.1 : 0.9, ...values];                       // who goes first, then the shuffle
  let n = 0;
  return () => (n < seq.length ? seq[n++] : fallback());
}
const CHAIN_A = [[11, 12], [10, 11], [10, 10], [9, 10], [9, 9], [8, 9], [7, 8], [6, 7], [5, 6], [4, 5], [3, 4], [2, 3], [1, 2], [0, 1], [0, 3]];
const CHAIN_B = [[8, 12], [8, 11], [7, 11], [7, 10], [6, 10], [6, 9], [5, 9], [5, 8], [4, 8], [4, 7], [3, 7], [3, 6], [2, 6], [2, 5], [1, 5]];
const EVENS = [[0, 2], [0, 4], [0, 6], [0, 8], [0, 10], [2, 4], [2, 6], [2, 8], [2, 10], [4, 6], [4, 8], [4, 10], [6, 8], [6, 10], [8, 10]];

(async () => {
  console.log('1. names and phrases');
  ok(cleanName('Ann') === 'Ann' && cleanName('  Mary   Jane ') === 'Mary Jane', 'ordinary names are kept, spaces tidied');
  ok(cleanName('<script>alert(1)</script>') === 'scriptalert1script', 'angle brackets, parentheses and slashes are stripped');
  ok(cleanName('a"b&c<d>e`f') === 'abcdef' && !/[<>&"`]/.test(cleanName('x<y>"&z`')), 'quotes, ampersands, backticks and brackets are stripped');
  ok(cleanName("O'Brien-Smith_Jr.") === "O'Brien-Smith_Jr.", "apostrophe, hyphen, underscore and dot are allowed");
  ok(cleanName('Дмитрий') === 'Дмитрий' && cleanName('山田 太郎') === '山田 太郎' && cleanName('José') === 'José', 'letters from any alphabet are allowed');
  ok(cleanName('x'.repeat(100)).length === 20, 'at most 20 characters');
  ok(cleanName('') === 'Player' && cleanName(null, 'Fallback') === 'Fallback' && cleanName('<>', 'Guest') === 'Guest' && cleanName(undefined) === 'Player', 'an empty or all-stripped name falls back');
  ok(cleanName('\u0000\u202e evil \u200b') === 'evil', 'control and direction-override characters are removed');
  ok(cleanName({ toString() { return 'obj'; } }) === 'obj' && cleanName(12345) === '12345', 'non-strings are converted safely');
  ok(CHAT_PHRASES.length >= 8 && new Set(CHAT_PHRASES).size === CHAT_PHRASES.length && CHAT_PHRASES.every(p => p.length < 30 && !/[<>&"]/.test(p)), 'a fixed list of quick phrases, all short and plain');

  console.log('2. whole matches between two random players: secrecy, consistency, no lost tiles');
  let matches = 0, totalPushes = 0, rounds = 0, allProblems = [], finished = 0, breadth = { hand8: 0, hand12: 0, hand15: 0 };
  for (let seed = 1; seed <= 36; seed++) {
    const hand = [8, 12, 15][seed % 3];
    const h = harness({ rng: mulberry32(seed), hand, rounds: seed % 4 === 0 ? 4 : 1 });
    const rnd = mulberry32(seed + 500);
    const done = await playOut(h, randomPolicy(rnd));
    matches++; totalPushes += h.pushes; rounds += h.match.rounds; if (done) finished++;
    breadth['hand' + hand]++;
    allProblems.push(...h.problems.slice(0, 3).map(p => `seed ${seed}: ${p}`));
  }
  console.log(`   ${matches} matches, ${rounds} rounds, ${totalPushes} messages inspected`);
  ok(finished === matches, `every match ran to the end (${finished}/${matches})`);
  ok(allProblems.length === 0, 'at every message: no secret tile was ever sent, and no tile was ever lost or duplicated' + (allProblems[0] ? ' (' + allProblems[0] + ')' : ''));
  ok(breadth.hand8 > 5 && breadth.hand12 > 5 && breadth.hand15 > 5, 'with hands of 8, 12 and 15 tiles');

  console.log('3. the two players\' views agree about everything they share');
  {
    const h = harness({ rng: mulberry32(11), hand: 12, rounds: 4, noWatch: true });
    let checked = 0, mismatches = [];
    await playOut(h, randomPolicy(mulberry32(5)), 20000, m => {
      const a = m.viewFor(0), b = m.viewFor(1);
      if (!a.game || !b.game) return;
      checked++;
      const chk = (cond, what) => { if (!cond) mismatches.push(what); };
      chk(a.round === b.round && a.rounds === b.rounds, 'round');
      chk(a.totals.human === b.totals.cpu && a.totals.cpu === b.totals.human, 'totals mirrored');
      chk(a.game.engine === b.game.engine, 'engine');
      chk(a.game.boneyard.length === b.game.boneyard.length, 'boneyard count');
      chk(a.game.players[0].hand.length === b.game.players[1].hand.length && a.game.players[1].hand.length === b.game.players[0].hand.length, 'hand counts mirrored');
      chk(eq(a.game.trains.mexican, b.game.trains.mexican), 'the Mexican train is the same for both');
      chk(a.game.trains.human.marker === b.game.trains.cpu.marker && a.game.trains.cpu.marker === b.game.trains.human.marker, 'markers mirrored');
      const aHid = a.game.opening && !a.game.opening.cpu.finished, bHid = b.game.opening && !b.game.opening.cpu.finished;
      if (!aHid) chk(eq(a.game.trains.cpu.tiles, b.game.trains.human.tiles) && a.game.trains.cpu.end === b.game.trains.human.end, 'their train, once public, is the same tiles both ways');
      if (!bHid) chk(eq(b.game.trains.cpu.tiles, a.game.trains.human.tiles), 'and the other way round');
      chk(eq(a.game.openDouble && [a.game.openDouble.trainId, a.game.openDouble.value], b.game.openDouble && [b.game.openDouble.trainId === 'human' ? 'cpu' : b.game.openDouble.trainId === 'cpu' ? 'human' : 'mexican', b.game.openDouble.value]) || (!a.game.openDouble && !b.game.openDouble), 'an open double is seen from both sides');
      chk(a.me.name === b.opp.name && a.opp.name === b.me.name, 'names mirrored');
      chk(!(a.awaiting && b.awaiting && a.awaiting.kind === 'move' && b.awaiting.kind === 'move'), 'never both players on turn at once in normal play');
    });
    ok(checked > 250 && mismatches.length === 0, `${checked} paired views compared: all agree` + (mismatches[0] ? ' (' + mismatches[0] + ')' : ''));
    const a = h.match.viewFor(0);
    ok(a.game.players[0].id === 'human' && a.game.players[1].id === 'cpu' && a.game.players[0].name === 'You', 'each player always sees themselves as "human"/"You" and the opponent as the other seat');
  }

  console.log('4. the opening: your opponent\'s train is face down until they finish');
  {
    const h = harness({ rng: dealRng({ seat0: CHAIN_A, seat1: EVENS, hand: 15 }), hand: 15, rounds: 1, names: ['Ann', 'Ben'] });
    h.match.start();
    await tick(); await tick();
    ok(h.match.viewFor(0).awaiting && h.match.viewFor(0).awaiting.kind === 'build', 'Ann is asked to build');
    for (const t of CHAIN_A.slice(0, 5)) { const r = h.match.intent(0, { a: 'play', tile: t, train: 'human' }); await tick(); await tick(); if (!r.ok) ok(false, 'Ann could not play ' + t); }
    const benView = h.match.viewFor(1);
    ok(benView.game.opening.cpu.finished === false && benView.game.trains.cpu.tiles.length === 5, 'Ben sees that Ann has laid 5 tiles...');
    ok(benView.game.trains.cpu.tiles.every(t => t[0] < 0), '...but only as face-down placeholders: no number of hers is in his view');
    ok(eq(benView.game.trains.cpu.tiles.map(t => t[0] === t[1]), CHAIN_A.slice(0, 5).map(t => t[0] === t[1])), 'except which of them are doubles (10-10 is the third), as in the single-player game');
    ok(benView.game.trains.cpu.end === 0, 'and the number her train needs is not sent');
    const annsEvents = h.events[1].filter(e => e.e === 'play' && e.who === 'opp');
    ok(annsEvents.length === 5 && annsEvents.every(e => e.hidden === true && e.tile === null && e.placed[0] < 0), 'the events telling Ben about her plays carry no tile either');
    ok(h.events[0].filter(e => e.e === 'play' && e.who === 'me').length === 5 && h.events[0].filter(e => e.e === 'play').every(e => e.tile && e.placed[0] >= 0), 'her own events carry the real tiles');
    ok(!JSON.stringify(h.sent[1]).includes('[11,12]') && !JSON.stringify(h.sent[1]).includes('[10,11]'), 'scanning every message ever sent to Ben: none of her tiles');
    for (const t of CHAIN_A.slice(5)) { h.match.intent(0, { a: 'play', tile: t, train: 'human' }); await tick(); await tick(); }
    ok(h.match.viewFor(1).game.trains.cpu.tiles.length === 15 && h.match.viewFor(1).game.trains.cpu.tiles.every(t => t[0] < 0), 'all 15 down and still hidden from Ben');
    h.match.intent(0, { a: 'done' });
    await tick(); await tick();
    const after = h.match.viewFor(1);
    ok(after.game.opening.cpu.finished === true && after.game.trains.cpu.tiles.length === 15 && after.game.trains.cpu.tiles.every(t => t[0] >= 0), 'when she presses Done, her train turns face up for him');
    ok(h.events[1].some(e => e.e === 'reveal'), 'and he is told to play the reveal animation');
    ok(after.game.trains.cpu.end === 3, 'and the number it needs is now sent (3)');
    h.match.abort(); await h.match.done;
  }

  console.log('5. using every tile on your first train (rigged deal)');
  {
    const run = async (seat0, seat1, who) => {
      const h = harness({ rng: dealRng({ seat0, seat1, hand: 15 }), hand: 15, rounds: 4 });
      h.match.start(); await tick(); await tick();
      return h;
    };
    // seat 0 holds a complete train and builds it with the longest-train helper
    let h = await run(CHAIN_A, EVENS);
    const v0 = h.match.viewFor(0);
    ok(v0.awaiting.canBuild && v0.awaiting.buildCount === 15 && eq(v0.game.players[0].hand.map(key).sort(), CHAIN_A.map(t => key(canon(t))).sort()), 'Ann is dealt the full train and is offered all 15');
    ok(h.match.intent(0, { a: 'autoBuild' }).ok === true, '"Build my longest train" is accepted');
    for (let i = 0; i < 60 && !(h.match.viewFor(0).awaiting && h.match.viewFor(0).awaiting.placed === 15); i++) await tick();
    ok(h.match.viewFor(0).game.players[0].hand.length === 0 && h.match.viewFor(0).game.trains.human.tiles.length === 15, 'all 15 are laid, one after another');
    ok(h.events[0].filter(e => e.e === 'play').length === 15, 'each play was announced as its own event (so each can animate)');
    // Ben is still building: nothing ends until both are done
    ok(h.match.viewFor(0).modal === null, 'the round does not end while Ben is still building');
    h.match.intent(0, { a: 'done' });
    await tick(); await tick();
    ok(h.match.viewFor(0).modal === null, 'Ann pressing Done is not enough: Ben has not finished building');
    h.match.intent(1, { a: 'draw' });                                    // Ben has no 12 in his hand: he draws
    for (let i = 0; i < 20; i++) await tick();
    let bv = h.match.viewFor(1);
    for (let i = 0; i < 6 && bv.awaiting && !bv.modal; i++) { const a = bv.awaiting; h.match.intent(1, a.canDone ? { a: 'done' } : a.canDraw ? { a: 'draw' } : a.moves.length ? { a: 'play', tile: a.moves[0].tile, train: a.moves[0].trainId } : { a: 'undo' }); for (let k = 0; k < 20; k++) await tick(); bv = h.match.viewFor(1); }
    const annEnd = h.match.viewFor(0), benEnd = h.match.viewFor(1);
    ok(annEnd.modal && annEnd.modal.type === 'roundEnd' && annEnd.modal.winnerId === 'human' && !annEnd.modal.tie && !annEnd.modal.blocked, 'Ann: "you went out first"');
    ok(benEnd.modal && benEnd.modal.type === 'roundEnd' && benEnd.modal.winnerId === 'cpu', 'Ben sees the same result from his side: the other player won');
    ok(annEnd.modal.rows[0].name === 'You' && annEnd.modal.rows[0].pips === 0 && annEnd.modal.rows[1].name === 'Ben' && annEnd.modal.rows[1].pips > 0, 'Ann\'s row: 0 points; Ben\'s row: his leftover pips');
    ok(benEnd.modal.rows[0].name === 'You' && benEnd.modal.rows[0].pips === annEnd.modal.rows[1].pips && benEnd.modal.rows[1].name === 'Ann', 'Ben\'s dialog lists him first as "You", with the same points');
    ok(annEnd.totals.human === 0 && annEnd.totals.cpu === annEnd.modal.rows[1].pips && benEnd.totals.human === annEnd.totals.cpu && benEnd.totals.cpu === 0, 'the scores, mirrored for each player');
    ok(h.problems.length === 0, 'and nothing leaked on the way' + (h.problems[0] ? ': ' + h.problems[0] : ''));
    // both press OK: round 2 starts
    h.match.intent(0, { a: 'ok' }); await tick(); await tick();
    ok(h.match.viewFor(0).modal === null && /Waiting for Ben/.test(h.match.viewFor(0).banner), 'after Ann presses OK she waits for Ben');
    ok(h.match.viewFor(1).modal && h.match.viewFor(1).modal.type === 'roundEnd', '(Ben\'s dialog is still up)');
    h.match.intent(1, { a: 'ok' });
    for (let i = 0; i < 30 && h.match.viewFor(0).round !== 1; i++) await tick();
    ok(h.match.viewFor(0).round === 1 && h.match.viewFor(0).game.engine === 11 && h.match.viewFor(1).game.engine === 11, 'then round 2 begins (engine 11) for both');
    ok(h.match.viewFor(0).totals.cpu === annEnd.totals.cpu, 'with the scores carried over');
    h.match.abort(); await h.match.done;

    // both hold complete trains: a tie
    h = await run(CHAIN_A, CHAIN_B);
    h.match.intent(0, { a: 'autoBuild' }); h.match.intent(1, { a: 'autoBuild' });
    for (let i = 0; i < 80 && !(h.match.viewFor(0).awaiting && h.match.viewFor(0).awaiting.placed === 15 && h.match.viewFor(1).awaiting && h.match.viewFor(1).awaiting.placed === 15); i++) await tick();
    h.match.intent(0, { a: 'done' }); h.match.intent(1, { a: 'done' });
    for (let i = 0; i < 40 && !h.match.viewFor(0).modal; i++) await tick();
    const t0 = h.match.viewFor(0).modal, t1 = h.match.viewFor(1).modal;
    ok(t0 && t0.tie === true && t0.winnerId === null && t1.tie === true, 'both use every tile: a tie, for both players');
    ok(t0.rows.every(r => r.pips === 0 && r.hand.length === 0) && h.match.viewFor(0).totals.human === 0 && h.match.viewFor(0).totals.cpu === 0, 'nobody scores');
    h.match.abort(); await h.match.done;

    // seat 1 holds the complete train
    h = await run(EVENS, CHAIN_A);
    h.match.intent(1, { a: 'autoBuild' });
    for (let i = 0; i < 80 && !(h.match.viewFor(1).awaiting && h.match.viewFor(1).awaiting.placed === 15); i++) await tick();
    h.match.intent(1, { a: 'done' });
    h.match.intent(0, { a: 'draw' });
    for (let i = 0; i < 20; i++) await tick();
    for (let k = 0; k < 8 && !h.match.viewFor(0).modal; k++) { const a = h.match.viewFor(0).awaiting; if (!a) { await tick(); continue; } h.match.intent(0, a.canDone ? { a: 'done' } : a.canDraw ? { a: 'draw' } : a.moves.length ? { a: 'play', tile: a.moves[0].tile, train: a.moves[0].trainId } : { a: 'undo' }); for (let i = 0; i < 20; i++) await tick(); }
    const s1 = h.match.viewFor(1).modal, s0 = h.match.viewFor(0).modal;
    ok(s1 && s1.winnerId === 'human' && s0 && s0.winnerId === 'cpu' && h.match.viewFor(1).totals.human === 0, 'the second seat can win the same way: they see themselves as the winner');
    h.match.abort(); await h.match.done;
  }

  console.log('6. what a player may and may not do');
  {
    const h = harness({ rng: dealRng({ seat0: CHAIN_A, seat1: EVENS, hand: 15 }), hand: 15, rounds: 1 });
    h.match.start(); await tick(); await tick();
    const m = h.match;
    const bad = (seat, msg) => m.intent(seat, msg);
    ok(bad(0, { a: 'play', tile: [5, 7], train: 'human' }).code === 'illegal', 'a tile you do not hold: refused');
    ok(bad(0, { a: 'play', tile: [10, 11], train: 'human' }).code === 'illegal', 'a tile you hold that does not fit yet: refused');
    ok(bad(0, { a: 'play', tile: [11, 12], train: 'cpu' }).code === 'illegal', 'playing on the opponent\'s train in the opening: refused');
    ok(bad(0, { a: 'play', tile: [11, 12], train: 'nonsense' }).code === 'illegal', 'an unknown train: refused');
  }
  {
    const h = harness({ rng: dealRng({ seat0: CHAIN_A, seat1: EVENS, hand: 15 }), hand: 15, rounds: 1 });
    h.match.start(); await tick(); await tick();
    const m = h.match;
    const codes = msgs => msgs.map(x => m.intent(0, x).code);
    ok(codes([null, undefined, 5, 'play', [], true]).every(c => c === 'bad_message'), 'garbage instead of an intent (null, undefined, a number, a string, an array, a boolean): refused');
    const wrong = codes([{ a: 'play' }, { a: 'play', tile: 'x', train: 'human' }, { a: 'play', tile: [1], train: 'human' }, { a: 'play', tile: [1, 2, 3], train: 'human' }, { a: 'play', tile: [1.5, 2], train: 'human' }, { a: 'play', tile: [-1, 2], train: 'human' }, { a: 'play', tile: [13, 2], train: 'human' }, { a: 'play', tile: ['11', '12'], train: 'human' }, { a: 'play', tile: [11, 12], train: 7 }, { a: 'play', tile: [11, 12] }, { a: 'play', tile: [null, null], train: 'human' }, { a: 'play', tile: [1e99, 1], train: 'human' }, { a: 'play', tile: [NaN, 1], train: 'human' }, { a: 'play', tile: { 0: 11, 1: 12, length: 2 }, train: 'human' }]);
    ok(wrong.every(c => c === 'illegal'), 'malformed tiles and trains (wrong shapes, floats, negatives, out of range, strings, NaN, objects): all refused, none crash');
    ok(eq(codes([{ a: 'fly' }, { a: 'ok' }, { a: 'draw' }, { a: 'undo' }, {}]), ['bad_message', 'bad_message', 'illegal', 'illegal', 'bad_message']), 'actions that do not fit the current moment (an unknown action, a dialog answer, drawing with a tile that fits, taking back nothing, an empty message): refused');
    ok(m.intent(1, { a: 'ok' }).code === 'bad_message' && m.viewFor(1).awaiting.kind === 'build', 'the other seat, also building, cannot send a dialog answer');
    ok(m.intent(0, { a: 'play', tile: [11, 12], train: 'human' }).ok === true, 'a correct play is accepted');
    ok(m.intent(0, { a: 'play', tile: [10, 11], train: 'human' }).code === 'not_now', 'a second intent before the game has moved on: "not now"');
    for (let i = 0; i < 10; i++) await tick();
    ok(m.viewFor(0).awaiting && m.viewFor(0).awaiting.placed === 1, 'and the game has moved on to Ann\'s next choice');
    // the double that cannot be last
    m.setPaused(true);
    ok(m.intent(0, { a: 'play', tile: [10, 11], train: 'human' }).code === 'paused', 'while the game is paused every intent is refused');
    ok(m.viewFor(0).paused === true && m.viewFor(1).paused === true, 'and both players are told it is paused');
    m.setPaused(false);
    ok(m.intent(0, { a: 'play', tile: [10, 11], train: 'human' }).ok === true, 'unpaused: play goes on');
    for (let i = 0; i < 10; i++) await tick();
    m.abort(); await m.done;
    ok(m.over === 'aborted' && m.intent(0, { a: 'undo' }).code === 'over', 'after the game is over, nothing is accepted');
  }
  {
    // an uncovered double blocks Done; a double cannot be the last tile of the opening
    const free = EVENS.filter(t => !CHAIN_B.some(u => key(canon(u)) === key(t)));          // even tiles that are not in the other chain
    const hand = CHAIN_A.slice(0, 3).concat(free.slice(0, 12));
    const h = harness({ rng: dealRng({ seat0: hand, seat1: CHAIN_B, hand: 15 }), hand: 15, rounds: 1, noWatch: true });
    h.match.start(); await tick(); await tick();
    const m = h.match;
    m.intent(0, { a: 'play', tile: [11, 12], train: 'human' }); await tick(); await tick();
    m.intent(0, { a: 'play', tile: [10, 11], train: 'human' }); await tick(); await tick();
    m.intent(0, { a: 'play', tile: [10, 10], train: 'human' }); await tick(); await tick();
    ok(m.viewFor(0).awaiting.canDone === false && m.intent(0, { a: 'done' }).code === 'illegal', 'with a double down and nothing to cover it, Done is refused');
    ok(m.intent(0, { a: 'undo' }).ok === true, 'but it can be taken back');
    m.abort(); await m.done;
  }

  console.log('7. reconnecting: the full state can be asked for at any moment');
  {
    const h = harness({ rng: mulberry32(3), hand: 12, rounds: 1, noWatch: true });
    h.match.start();
    let ok2 = true, n = 0;
    const rnd = mulberry32(9), pol = randomPolicy(rnd);
    while (!h.match.over && n < 5000) {
      for (const seat of [0, 1]) { const v = h.match.viewFor(seat); if (v.awaiting) h.match.intent(seat, pol(seat, v)); }
      await tick(); n++;
      if (n % 7 === 0) {
        for (const seat of [0, 1]) {
          const v = h.match.viewFor(seat), again = JSON.parse(JSON.stringify(v));
          if (!eq(v, again)) ok2 = false;                             // plain JSON, nothing lost in the trip
          if (v.game && (!v.game.trains || !v.game.players || v.game.players.length !== 2)) ok2 = false;
        }
      }
    }
    ok(ok2 && h.match.over === 'finished', 'a view taken at any point of a whole match is complete plain JSON (what a player who reloads would be sent)');
    ok(h.match.viewFor(0).modal && h.match.viewFor(0).modal.type === 'final' && h.match.viewFor(0).over === 'finished', 'the final dialog is part of the state, so a reload after the end still shows it');
  }

  console.log('8. an engine fault is contained');
  {
    const h = harness({ rng: mulberry32(2), hand: 12, rounds: 1, noWatch: true });
    const orig = h.match.hooks.onPlay;
    h.match.hooks.onPlay = async () => { throw new Error('boom'); };
    h.match.hooks.onBuildPlay = async () => { throw new Error('boom'); };
    h.match.start(); await tick(); await tick();
    const v = h.match.viewFor(0);
    if (v.awaiting && v.awaiting.moves.length) h.match.intent(0, { a: 'play', tile: v.awaiting.moves[0].tile, train: v.awaiting.moves[0].trainId });
    for (let i = 0; i < 10; i++) await tick();
    await h.match.done;
    ok(h.match.over === 'error' && h.match.error && h.match.error.message === 'boom', 'a crash inside the game ends the match cleanly as an error (the server can tell both players) instead of hanging');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
