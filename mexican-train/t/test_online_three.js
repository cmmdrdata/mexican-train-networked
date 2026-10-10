'use strict';
const { OnlineMatch, SEATS } = require('../online-match.js');
const E = globalThis.MexicanTrainGame.Engine;
const { mulberry32, key } = E;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canon = t => [Math.min(t[0], t[1]), Math.max(t[0], t[1])];

/* A three-seat match: seats 0 and 1 are people, seat 2 is the computer. Every message sent is inspected. */
function harness(opts) {
  const h = { pushes: 0, problems: [], events: [[], [], []], sent: [[], [], []], match: null };
  const patterns = t => [`[${t[0]},${t[1]}]`, `[${t[1]},${t[0]}]`];
  h.match = new OnlineMatch(Object.assign({ names: ['Ann', 'Ben', 'Zed'], computer: { level: 'normal' }, rounds: 1, hand: 12, stepDelay: 0, sleep: async () => {}, rng: mulberry32(1) }, opts, {
    push(seat, msg) {
      h.pushes++; h.events[seat].push(...msg.events); h.sent[seat].push(msg);
      if (opts && opts.noWatch) return;
      const g = h.match.game, v = msg.view, json = JSON.stringify(msg);
      const said = [v.banner || '', ...(v.log || [])];
      for (const l of said) { const m = l.match(/^(.*) has nothing to play/); if (m) { if (m[1] === 'Zed') h.sawComputerLine = (h.sawComputerLine || 0) + 1; else h.problems.push(`seat ${seat} was told that ${m[1]} (a person) has nothing to play (seq ${msg.seq})`); } }
      if (!g) return;
      if (seat > 1) h.problems.push('a message was sent to the computer seat');
      if (!(v.modal && v.modal.type === 'roundEnd')) {
        const secret = [];
        g.players.forEach((p, i) => { if (i !== seat) p.hand.forEach(t => secret.push(t)); });          // everyone else's hand, the computer's included
        g.boneyard.forEach(t => secret.push(t));
        if (g.opening) g.players.forEach((p, i) => { if (i !== seat && !g.opening[p.id].finished) g.trains[p.id].tiles.forEach(t => secret.push(t)); });   // others' trains while face down
        const bad = secret.filter(t => patterns(t).some(p => json.includes(p)));
        if (bad.length) h.problems.push(`seat ${seat} was shown ${bad.map(t => t.join('-')).join(', ')} (seq ${msg.seq})`);
      }
      const all = [];
      g.players.forEach(p => p.hand.forEach(t => all.push(key(canon(t)))));
      g.boneyard.forEach(t => all.push(key(canon(t))));
      ['human', 'cpu', 'cpu2', 'mexican'].forEach(id => g.trains[id].tiles.forEach(t => all.push(key(canon(t)))));
      if (all.length !== 90 || new Set(all).size !== 90) h.problems.push(`tiles lost or duplicated (${all.length}, seq ${msg.seq})`);
    },
  }));
  return h;
}
function policy(rnd) {
  return v => {
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
async function playOut(h, pols, budget, hook) {
  const m = h.match, run = m.start();
  let steps = 0, stuck = 0;
  while (!m.over && steps < (budget || 30000)) {
    let acted = false;
    for (const seat of m.humans) {
      const v = m.viewFor(seat);
      if (v.awaiting && !m.paused) {
        const intent = pols[seat](v);
        const r = m.intent(seat, intent);
        if (!r.ok) { h.problems.push(`a legal-looking intent was refused: seat ${seat} ${JSON.stringify(intent)} -> ${r.code}`); return false; }
        acted = true; steps++;
      }
    }
    if (hook) hook(m, steps);
    await tick();
    stuck = acted ? 0 : stuck + 1;
    if (stuck > 600) { h.problems.push('the match stopped making progress'); break; }
  }
  if (!m.over) m.abort();
  await run;
  return m.over === 'finished';
}

(async () => {
  console.log('1. who is who on each screen');
  {
    const h = harness({ rng: mulberry32(3), hand: 8 });
    const m = h.match; m.start(); await tick(); await tick();
    ok(m.n === 3 && m.humans.join() === '0,1' && eq(m.computers, { 2: { level: 'normal' } }), 'three seats: two people and the computer in the third');
    const v0 = m.viewFor(0), v1 = m.viewFor(1);
    ok(v0.game.players.map(p => p.id).join() === 'human,cpu,cpu2' && v0.game.players.map(p => p.name).join() === 'You,Ben,Zed', 'Ann sees herself, then Ben ("cpu"), then the computer Zed ("cpu2")');
    ok(v1.game.players.map(p => p.id).join() === 'human,cpu,cpu2' && v1.game.players.map(p => p.name).join() === 'You,Zed,Ann', 'Ben sees himself, then Zed ("cpu"), then Ann ("cpu2"): each in table order after themselves');
    ok(eq(v0.opps, [{ id: 'cpu', name: 'Ben', seat: 1, computer: false, level: null }, { id: 'cpu2', name: 'Zed', seat: 2, computer: true, level: 'normal' }]), 'the view says which opponent is the computer, and its level');
    ok(v0.opp.name === 'Ben' && v1.opp.name === 'Zed', '(and "opp" is still the first opponent, as in a two-player game)');
    ok(Object.keys(v0.game.trains).join() === 'human,cpu,cpu2,mexican' && Object.keys(v0.totals).join() === 'human,cpu,cpu2', 'four trains and three scores on each screen');
    ok(m.viewFor(2) !== undefined && m.awaiting[2] === null, 'the computer seat is never asked anything by the players\' prompts');
    const bad = new OnlineMatch({ names: ['A', 'B', 'C'], computer: { level: 'impossible' }, push() {} });
    ok(bad.computers[2].level === 'normal', 'an unknown computer level becomes Medium');
    ok(new OnlineMatch({ names: ['A', 'B', 'C'], push() {} }).computers[2] === undefined && new OnlineMatch({ names: ['A', 'B', 'C'], push() {} }).humans.length === 3, 'three names and no computer would mean three people (not offered by the server, but it works)');
    ok(new OnlineMatch({ names: ['A', 'B'], computer: { level: 'hard' }, push() {} }).n === 2 && Object.keys(new OnlineMatch({ names: ['A', 'B'], computer: { level: 'hard' }, push() {} }).computers).length === 0, 'a computer cannot be added to a two-player match');
    m.abort(); await m.done;
  }

  console.log('2. whole matches: two people and a computer');
  let finished = 0, matches = 0, problems = [], pushes = 0, rounds = 0, thinking = 0, ties = 0, computerLines = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const level = ['easy', 'normal', 'hard'][seed % 3];
    const h = harness({ rng: mulberry32(seed), hand: [8, 12, 15][seed % 3], rounds: seed % 5 === 0 ? 4 : 1, computer: { level } });
    const done = await playOut(h, [policy(mulberry32(seed + 100)), policy(mulberry32(seed + 200))]);
    matches++; pushes += h.pushes; rounds += h.match.rounds; if (done) finished++;
    problems.push(...h.problems.slice(0, 2).map(p => `seed ${seed}: ${p}`));
    if (h.sent[0].some(x => /is thinking/.test(x.view.banner))) thinking++;
    computerLines += h.sawComputerLine || 0;
    if (h.sent[0].some(x => x.view.modal && x.view.modal.type === 'roundEnd' && x.view.modal.tie)) ties++;
  }
  console.log(`   ${matches} matches, ${rounds} rounds, ${pushes} messages inspected`);
  ok(finished === matches, `every match ran to the final score (${finished}/${matches}), with the computer playing its own turns`);
  ok(problems.length === 0, 'at every message: neither person was ever sent the other\'s hand, the computer\'s hand, the boneyard or a face-down train; no tile was lost or duplicated; every move offered was accepted' + (problems[0] ? ' (' + problems[0] + ')' : ''));
  ok(computerLines > 5, `neither person is ever told that the OTHER person has nothing to play, but the computer, whose situation is not a person's to keep private, still is ("Zed has nothing to play and draws.", ${computerLines} times)`);
  ok(thinking > 10, `the people are told when the computer is thinking ("Zed is thinking...") (${thinking} of ${matches} matches)`);

  console.log('3. the three views agree');
  {
    const h = harness({ rng: mulberry32(11), hand: 12, rounds: 4, noWatch: true });
    let checked = 0, mismatches = [];
    await playOut(h, [policy(mulberry32(5)), policy(mulberry32(6))], 30000, m => {
      const a = m.viewFor(0), b = m.viewFor(1);
      if (!a.game || !b.game) return;
      checked++;
      const chk = (cond, what) => { if (!cond) mismatches.push(what); };
      const hidden = (v, id) => v.game.opening && !v.game.opening[id].finished;
      // Ann: human = Ann, cpu = Ben, cpu2 = Zed.   Ben: human = Ben, cpu = Zed, cpu2 = Ann.
      chk(a.round === b.round && a.game.engine === b.game.engine && a.game.boneyard.length === b.game.boneyard.length, 'round, engine, boneyard count');
      chk(eq(a.game.trains.mexican, b.game.trains.mexican), 'the Mexican train is the same');
      if (!hidden(a, 'cpu')) chk(eq(a.game.trains.cpu, Object.assign({}, b.game.trains.human, { id: 'cpu' })), "Ben's train, seen by Ann and by Ben");
      if (!hidden(b, 'cpu2')) chk(eq(a.game.trains.human, Object.assign({}, b.game.trains.cpu2, { id: 'human' })), "Ann's train, seen by Ann and by Ben");
      if (!hidden(a, 'cpu2') && !hidden(b, 'cpu')) chk(eq(a.game.trains.cpu2, Object.assign({}, b.game.trains.cpu, { id: 'cpu2' })), "the computer's train, seen by both");
      chk(a.totals.human === b.totals.cpu2 && a.totals.cpu === b.totals.human && a.totals.cpu2 === b.totals.cpu, 'scores follow each player to their label on the other screen');
      chk(a.game.players[0].hand.length === b.game.players[2].hand.length && a.game.players[1].hand.length === b.game.players[0].hand.length && a.game.players[2].hand.length === b.game.players[1].hand.length, 'hand sizes follow each player');
      const od = (v, other) => v.game.openDouble && [v.game.openDouble.trainId, v.game.openDouble.value];
      chk(!!a.game.openDouble === !!b.game.openDouble && (!a.game.openDouble || a.game.openDouble.value === b.game.openDouble.value), 'an open double is open for both, with the same number');
      if (a.game.openDouble) chk(({ human: 'cpu2', cpu: 'human', cpu2: 'cpu', mexican: 'mexican' })[a.game.openDouble.trainId] === b.game.openDouble.trainId, 'and on the same train, labelled for each screen');
      chk(a.opps[0].name === 'Ben' && a.opps[1].name === 'Zed' && b.opps[0].name === 'Zed' && b.opps[1].name === 'Ann', 'names');
    });
    ok(checked > 120 && mismatches.length === 0, `${checked} paired views compared: all agree` + (mismatches[0] ? ' (' + mismatches[0] + ')' : ''));
  }

  console.log('4. the opening, with the computer building too');
  {
    const h = harness({ rng: mulberry32(21), hand: 15, rounds: 1 });
    const m = h.match; m.start();
    for (let i = 0; i < 20; i++) await tick();
    const v0 = m.viewFor(0);
    ok(v0.game.opening.cpu2.finished === true || m.game.trains.cpu2.tiles.length > 0 || m.game.opening.cpu2.finished, 'the computer builds its train by itself while the people are still deciding');
    ok(!v0.game.opening.human.finished && !v0.game.opening.cpu.finished, '(they have not done anything yet)');
    const seen = v0.game.trains.cpu2.tiles;
    ok(v0.game.opening.cpu2.finished ? seen.every(t => t[0] >= 0) : seen.every(t => t[0] < 0), 'its tiles are face down for the people until it has finished, then face up');
    ok(h.events[0].filter(e => e.e === 'play' && e.who === 'opp2').every(e => e.hidden === true && e.tile === null), 'the events about its opening plays carry no tile');
    ok(h.events[0].some(e => e.e === 'reveal' && e.who === 'opp2') === !!v0.game.opening.cpu2.finished, 'and when it finishes both people are told to turn its train over');
    m.abort(); await m.done;
  }

  console.log('5. the people can play on the computer\'s marker, and it can play on theirs');
  {
    let sawComputerTrainTarget = 0, humanTrainTargetByComputer = 0, refused = 0;
    for (let seed = 40; seed < 70; seed++) {
      const h = harness({ rng: mulberry32(seed), hand: 8, rounds: 1, noWatch: true });
      const watching = (seat, pol) => v => {                       // look at the prompt as the player gets it, then answer it
        const computerId = seat === 0 ? 'cpu2' : 'cpu';
        if (v.awaiting && v.awaiting.moves && v.awaiting.moves.some(mv => mv.trainId === computerId)) sawComputerTrainTarget++;
        return pol(v);
      };
      await playOut(h, [watching(0, policy(mulberry32(seed))), watching(1, policy(mulberry32(seed + 1)))], 30000, m => { if (m.game && m.game.trains.human.marker) humanTrainTargetByComputer++; });
      refused += h.problems.filter(p => /refused/.test(p)).length;
    }
    ok(sawComputerTrainTarget > 0, `people were offered the computer's train as a place to play (${sawComputerTrainTarget} times), under the right label on each screen`);
    ok(refused === 0, 'and every such move was accepted when they chose it');
    ok(humanTrainTargetByComputer > 0, 'markers on a person\'s own train occurred (so the computer could play there)');
  }

  console.log('6. pausing: the computer waits too');
  {
    const h = harness({ rng: mulberry32(8), hand: 15, rounds: 1, noWatch: true, sleep: ms => new Promise(r => setTimeout(r, 1)) });
    const m = h.match; m.start();
    const pols = [policy(mulberry32(1)), policy(mulberry32(2))];
    let guard = 0;
    while (!m.over && guard++ < 4000) {            // play until the computer is about to move (it is nobody's prompt)
      for (const seat of m.humans) { const v = m.viewFor(seat); if (v.awaiting) m.intent(seat, pols[seat](v)); }
      await new Promise(r => setTimeout(r, 2));
      if (m.game && !m.game.opening.cpu2.finished === false && m.humans.every(s => !m.awaiting[s])) break;
    }
    m.setPaused(true);
    await new Promise(r => setTimeout(r, 120));
    const seqAtPause = m.seq;
    await new Promise(r => setTimeout(r, 300));
    ok(m.seq === seqAtPause, 'while the game is paused for a dropped player, nothing happens (not even the computer moves)');
    m.setPaused(false);
    for (let i = 0; i < 60; i++) { for (const seat of m.humans) { const v = m.viewFor(seat); if (v.awaiting) m.intent(seat, pols[seat](v)); } await new Promise(r => setTimeout(r, 5)); }
    ok(m.seq > seqAtPause + 1, 'and when it resumes, the game carries on');
    m.abort(); await m.done;
  }

  console.log('7. a rigged first-train win, against two opponents');
  {
    const POOL = (() => { const t = []; for (let x = 0; x <= 12; x++) for (let y = x; y <= 12; y++) if (!(x === 12 && y === 12)) t.push([x, y]); return t; })();
    const CHAIN = [[11, 12], [10, 11], [10, 10], [9, 10], [9, 9], [8, 9], [7, 8], [6, 7], [5, 6], [4, 5], [3, 4], [2, 3], [1, 2], [0, 1], [0, 3]];
    const rig = (...hands) => {
      const mine = hands.map(h => h.map(canon)), used = new Set(mine.flat().map(key));
      if (used.size !== mine.flat().length) throw new Error('rigged deal reuses a tile');
      const rest = POOL.filter(t => !used.has(key(t))), target = [...mine.flat(), ...rest], w = POOL.map(t => t.slice()), vals = [];
      for (let i = target.length - 1; i >= 1; i--) { const j = w.slice(0, i + 1).findIndex(t => key(t) === key(target[i])); vals.push((j + 0.5) / (i + 1)); [w[i], w[j]] = [w[j], w[i]]; }
      const seq = [0.1, ...vals]; let n = 0; const fb = mulberry32(777);
      return () => (n < seq.length ? seq[n++] : fb());
    };
    const others = [[0, 2], [0, 4], [0, 6], [0, 8], [0, 10], [2, 4], [2, 6], [2, 8], [2, 10], [4, 6], [4, 8], [4, 10], [6, 8], [6, 10], [8, 10]];
    const third = [[1, 3], [1, 5], [1, 7], [1, 9], [1, 11], [3, 5], [3, 7], [3, 9], [3, 11], [5, 7], [5, 9], [5, 11], [7, 9], [7, 11], [9, 11]];
    const h = harness({ rng: rig(CHAIN, others, third), hand: 15, rounds: 1, computer: { level: 'hard' } });
    const m = h.match; m.start(); await tick(); await tick();
    ok(m.viewFor(0).awaiting.canBuild && m.viewFor(0).awaiting.buildCount === 15, 'Ann is dealt a complete train');
    m.intent(0, { a: 'autoBuild' });
    for (let i = 0; i < 80 && !(m.viewFor(0).awaiting && m.viewFor(0).awaiting.placed === 15); i++) await tick();
    m.intent(0, { a: 'done' });
    m.intent(1, { a: 'draw' });
    for (let k = 0; k < 20; k++) await tick();
    for (let k = 0; k < 12 && !m.viewFor(1).modal; k++) { const a = m.viewFor(1).awaiting; if (!a) { await tick(); continue; } m.intent(1, a.canDone ? { a: 'done' } : a.canDraw ? { a: 'draw' } : a.moves.length ? { a: 'play', tile: a.moves[0].tile, train: a.moves[0].trainId } : { a: 'undo' }); for (let i = 0; i < 20; i++) await tick(); }
    for (let i = 0; i < 60 && !m.viewFor(0).modal; i++) await tick();
    const r0 = m.viewFor(0).modal, r1 = m.viewFor(1).modal;
    ok(r0 && r0.type === 'roundEnd' && r0.winnerId === 'human' && !r0.tie, 'Ann goes out first on her first train');
    ok(r0.rows.map(r => r.name).join() === 'You,Ben,Zed' && r0.rows[0].pips === 0 && r0.rows[1].pips > 0 && r0.rows[2].pips > 0, 'the round-end table has all three, with Ann on 0 and the others holding points');
    ok(r1 && r1.winnerId === 'cpu2' && r1.rows.map(r => r.name).join() === 'You,Zed,Ann', 'Ben sees it from his side: the winner is his "cpu2" (Ann); rows: himself, Zed, Ann');
    ok(r0.totals.cpu === r1.totals.human && r0.totals.cpu2 === r1.totals.cpu && r0.totals.human === r1.totals.cpu2, 'with each score under the right label on each screen');
    ok(r0.rows.every(r => Array.isArray(r.hand)) && r0.rows[2].hand.length > 0, 'everyone\'s remaining tiles are shown at the end of the round, the computer\'s too');
    ok(m.viewFor(2) && m.modalOk[2] === true, 'the computer is always ready for the next round');
    m.intent(0, { a: 'ok' }); await tick();
    ok(m.viewFor(0).modal && m.viewFor(0).modal.type === 'final' && eq(Object.keys(m.viewFor(0).modal.totals), ['human', 'cpu', 'cpu2']) && m.viewFor(1).modal.type === 'roundEnd' && m.over !== 'finished', 'after the last round Ann presses OK and has the three final scores at once, without waiting for Ben, who still has his dialog (the computer needs no button)');
    m.intent(1, { a: 'ok' });
    for (let i = 0; i < 30 && m.over !== 'finished'; i++) await tick();
    ok(m.over === 'finished' && m.viewFor(0).modal.type === 'final' && eq(Object.keys(m.viewFor(0).modal.totals), ['human', 'cpu', 'cpu2']), 'once both people have pressed OK the match is over, with three final scores');
    m.abort(); await m.done;
  }

  console.log('8. seats and banners in a game with a computer');
  {
    const h = harness({ rng: mulberry32(4), hand: 8, rounds: 1, noWatch: true });
    const m = h.match; m.start(); await tick(); await tick();
    const v0 = m.viewFor(0), v1 = m.viewFor(1);
    ok(v0.me.seat === 0 && v0.opps.map(o => o.seat).join() === '1,2' && v1.me.seat === 1 && v1.opps.map(o => o.seat).join() === '2,0', 'every view says which seat each player has: the host 0, the guest 1, the computer 2, as each screen sees them');
    m.abort(); await m.done;
    const g = harness({ rng: mulberry32(2), hand: 8, rounds: 1, noWatch: true });
    const mm = g.match; mm.game = globalThis.MexicanTrainGame.Engine.newRound({ engine: 12, handSize: 8, rng: mulberry32(2), players: 3 });
    const ann = mm.game.players[0], zed = mm.game.players[2];
    const pa = mm.hooks.onNeedDraw(mm.game, ann);
    ok(mm.banners[1] === 'Ann is choosing a tile.', `a person who has to draw: the other person sees the plain "${mm.banners[1]}"`);
    mm.intent(0, { a: 'draw' }); await pa;
    await mm.hooks.onNeedDraw(mm.game, zed);
    ok(mm.banners[0] === 'Zed has nothing to play and draws.' && mm.banners[1] === 'Zed has nothing to play and draws.', 'the computer\'s situation is still told to both people');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
