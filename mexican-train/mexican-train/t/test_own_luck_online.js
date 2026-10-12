'use strict';
// The computer in a HOSTED game grumbling about its own luck: the same remarks as against the computer on one's own, said to everybody at the table.
const { OnlineMatch } = require('../online-match.js');         // (this loads the game's code; the match and this test must use the very same copy of it)
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32 } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const T = G.THEMES.lotr;
const OWN = ['ownDraw', 'ownDrawAgain', 'ownBlocked', 'ownShort', 'roundBlocked'];
const fill = (t, vars) => G.fillLine(t, vars || {});
const esc = n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fakeTimer() {
  let id = 0, t = 0; const q = [];
  return { q, get now() { return t; }, set(fn, ms) { q.push({ id: ++id, fn, at: t + ms, ms }); return id; }, clear(x) { const i = q.findIndex(e => e.id === x); if (i >= 0) q.splice(i, 1); },
    advance(ms) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const e = q[0]; if (!e || e.at > end) break; q.shift(); t = e.at; e.fn(); } t = end; } };
}
function harness(opts) {
  const h = { said: [[], [], []], timer: fakeTimer(), problems: [] };
  h.match = new OnlineMatch(Object.assign({ names: ['Ann', 'Ben', 'Gandalf'], computer: { level: 'hard' }, theme: 'classic', rounds: 1, hand: 8, stepDelay: 0, nativeChance: 0, foodChance: 0,
    sleep: async () => {}, rng: mulberry32(1), chatRng: () => 0, timer: h.timer, now: () => h.timer.now }, opts, {
    push(seat, msg) { if (seat > 1) h.problems.push('a message was sent to seat ' + seat); if (msg.t === 'say') h.said[seat].push(Object.assign({ at: h.timer.now }, msg)); },
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
    if (a.moves.length && rnd() < 0.6) { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    if (a.canDone) return { a: 'done' };
    if (a.moves.length) { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    return { a: 'undo' };
  };
}
/* Play the match out. After every step, what the computer did (from the log the people see) is turned into the remarks it should have made. */
async function playOut(h, pols, name, stepMs) {
  const m = h.match, run = m.start(), exp = []; const streak = { n: 0 }; let seen = 0, cover = false, blocked = false, covers = 0;
  const reEnd = new RegExp('^' + esc(name) + ' finished a train of (\\d+) tiles?\\.');
  const scan = () => {
    const log = m.logs[0];
    if (log.length < seen) seen = 0;
    for (; seen < log.length; seen++) {
      const line = log[seen].replace(/&#39;/g, "'");
      if (/^All trains are built\./.test(line)) streak.n = 0;
      else if (line.startsWith(name + ' played ')) streak.n = 0;
      else if (line.startsWith(`That was ${name}'s last tile, but a double cannot go out`)) cover = true;
      else if (line === name + ' draws a tile.') { if (cover) { cover = false; covers++; } else { streak.n++; exp.push({ kind: streak.n === 1 ? 'ownDraw' : 'ownDrawAgain' }); } }
      else if (line.startsWith(name + ' cannot draw to cover their double and passes')) { cover = false; covers++; }
      else if (line.startsWith(name + ' cannot play and passes') || line.startsWith(name + ' cannot start a train and passes')) exp.push({ kind: 'ownBlocked' });
      else { const mm = line.match(reEnd); if (mm && +mm[1] >= 1 && +mm[1] <= G.OWN_SHORT) exp.push({ kind: 'ownShort', built: +mm[1] }); }
    }
  };
  for (let n = 0; !m.over && n < 30000; n++) {
    for (const seat of m.humans) {
      const v = m.viewFor(seat);
      if (v.awaiting && !m.paused) { const r = m.intent(seat, pols[seat](v)); if (!r.ok) h.problems.push('refused: ' + r.code); }
    }
    scan();                                                   // (what happened this step first, then the end of the round that it led to)
    if (m.modal && m.modal.type === 'roundEnd' && !blocked) { blocked = true; if (m.modal.blocked) exp.push({ kind: 'roundBlocked' }); }
    h.timer.advance(stepMs === undefined ? 1500 : stepMs);
    scan();
    await tick();
  }
  scan();
  if (!m.over) m.abort();
  await run;
  return { finished: m.over === 'finished', exp, covers };
}
const lineOk = (level, theme, name, kind, text) => {
  const pool = theme === 'lotr' ? (T.voices[name][kind] || []) : (G.LINES[level][kind] || []);
  return pool.some(l => kind === 'ownShort' ? [1, 2].some(b => fill(l, { built: b }) === text) : l === text);
};

(async () => {
  const COOL = G.CHAT.cooldownMs; G.CHAT.cooldownMs = 0;
  console.log('1. whole hosted matches: the right remark on each event, said to everybody, and on no other');
  const tally = { ownDraw: 0, ownDrawAgain: 0, ownBlocked: 0, ownShort: 0, roundBlocked: 0 };
  let matches = 0, finished = 0, mismatched = 0, notSame = 0, wrongLine = 0, wrongSpeaker = 0, problems = [], covers = 0, first = null, other = 0;
  for (const [level, theme] of [['easy', 'classic'], ['normal', 'classic'], ['hard', 'classic'], ['easy', 'lotr'], ['normal', 'lotr'], ['hard', 'lotr']]) {
    for (let seed = 1; seed <= 30; seed++) {
      const name = theme === 'lotr' ? T.players[level][seed % T.players[level].length] : 'Marta';
      const h = harness({ rng: mulberry32(seed), names: ['Ann', 'Ben', name], computer: { level }, theme, hand: [8, 12, 15][seed % 3] });
      const r = await playOut(h, [policy(mulberry32(seed + 1)), policy(mulberry32(seed + 2))], name);
      matches++; if (r.finished) finished++; problems.push(...h.problems); covers += r.covers;
      const own = s => h.said[s].filter(x => OWN.includes(x.kind));
      const a = own(0), b = own(1);
      if (JSON.stringify(a.map(x => [x.kind, x.text, x.from])) !== JSON.stringify(b.map(x => [x.kind, x.text, x.from]))) notSame++;
      const e = r.exp.map(x => x.kind).join(), g = a.map(x => x.kind).join();
      if (e !== g) { mismatched++; if (!first) first = `${level}/${theme}/seed ${seed}: expected [${e}] heard [${g}]`; }
      r.exp.forEach(x => { tally[x.kind]++; });
      a.forEach(x => { if (x.from !== name) wrongSpeaker++; if (!lineOk(level, theme, name, x.kind, x.text)) wrongLine++; });
      other += h.said[0].filter(x => !OWN.includes(x.kind)).length;
    }
  }
  ok(finished === matches && problems.length === 0, `${matches} whole hosted matches (Easy, Medium and Hard, classic and Lord of the Rings) were played to the end, with nothing refused and nothing sent to the computer's seat${problems[0] ? ': ' + problems[0] : ''}`);
  ok(mismatched === 0, `in all of them the computer said the right own-luck remark on each event and none on any other (${mismatched} matches that differed)${first ? ': ' + first : ''}`);
  ok(notSame === 0, `and each remark reached BOTH people, the same words, in the same order (${notSame} matches where they heard different things)`);
  ok(wrongSpeaker === 0 && wrongLine === 0, `from the computer character, in the voice of its own level (or its own, in the Lord of the Rings): ${wrongSpeaker} from someone else, ${wrongLine} not in the voice`);
  ok(tally.ownDraw >= 100 && tally.ownDrawAgain >= 50 && tally.ownBlocked >= 100 && tally.ownShort >= 10 && tally.roundBlocked >= 3, `with every kind really happening: ${JSON.stringify(tally)}`);
  ok(covers >= 1, `including draws and passes only to cover a last double, which earn no remark (${covers})`);
  ok(other > 100, `(alongside the usual remarks about each person's own play: ${other} of those to the first person)`);

  console.log('2. when it says nothing');
  {
    const h = harness({ names: ['Ann', 'Ben', 'Marta'], rng: mulberry32(3), chatRng: () => 0.999 });
    await playOut(h, [policy(mulberry32(4)), policy(mulberry32(5))], 'Marta');
    ok([0, 1].every(s => h.said[s].filter(x => OWN.includes(x.kind)).length === 0), 'with the dice against it (a high roll) the computer says nothing about its own luck: not even the rare kinds that skip the cooldown (a few remarks about a person\'s own play always get through, as before)');
  }
  {
    const h = new OnlineMatch({ names: ['Ann', 'Ben', 'Cat'], rounds: 1, hand: 8, stepDelay: 0, sleep: async () => {}, rng: mulberry32(2), chatRng: () => 0, timer: fakeTimer(), now: () => 0, push: (seat, msg) => { if (msg.t === 'say') h.say = (h.say || 0) + 1; } });
    const run = h.start();
    for (let n = 0; !h.over && n < 20000; n++) { for (const seat of h.humans) { const v = h.viewFor(seat); if (v.awaiting && !h.paused) h.intent(seat, policy(mulberry32(seat + 9))(v)); } await tick(); }
    if (!h.over) h.abort(); await run;
    ok(!h.say, 'in a game of three people (no computer) nothing is ever said');
  }

  console.log('3. the cooldown is shared by everybody at the table');
  {
    G.CHAT.cooldownMs = COOL;
    let ordinaryAll = 0, tooClose = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const h = harness({ names: ['Ann', 'Ben', 'Marta'], computer: { level: 'easy' }, rng: mulberry32(seed), hand: 12 });
      await playOut(h, [policy(mulberry32(seed + 1)), policy(mulberry32(seed + 2))], 'Marta', 500);
      for (const seat of [0, 1]) {
        const ordinary = h.said[seat].filter(x => !G.CHAT.bypass[x.kind] && !String(x.kind).startsWith('slow'));
        ordinaryAll += ordinary.length;
        for (let i = 1; i < ordinary.length; i++) if (ordinary[i].at - ordinary[i - 1].at < COOL - 600) tooClose++;
      }
    }
    ok(ordinaryAll >= 12 && tooClose === 0, `with the cooldown on, each person hears the ordinary remarks (${ordinaryAll} in all, their own and the computer's about itself together) at least ${COOL / 1000} seconds apart`);
    G.CHAT.cooldownMs = 0;
  }
  G.CHAT.cooldownMs = COOL;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
