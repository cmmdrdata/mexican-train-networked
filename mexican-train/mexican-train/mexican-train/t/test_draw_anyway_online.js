'use strict';
// A hosted game: a draw you did not have to make (hints off on your page) is accepted by the server on the same terms as in the game against the computer.
const { OnlineMatch } = require('../online-match.js');         // (this loads the game's code; the match and this test must use the very same copy of it)
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32, key, legalMoves } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));

function fakeTimer() {
  let id = 0, t = 0; const q = [];
  return { q, get now() { return t; }, set(fn, ms) { q.push({ id: ++id, fn, at: t + ms, ms }); return id; }, clear(x) { const i = q.findIndex(e => e.id === x); if (i >= 0) q.splice(i, 1); },
    advance(ms) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const e = q[0]; if (!e || e.at > end) break; q.shift(); t = e.at; e.fn(); } t = end; } };
}
function harness(opts) {
  const h = { events: [[], [], []], timer: fakeTimer(), problems: [] };
  h.match = new OnlineMatch(Object.assign({ names: ['Ann', 'Ben', 'Marta'], computer: null, theme: 'classic', rounds: 1, hand: 12, stepDelay: 0, nativeChance: 0, foodChance: 0,
    sleep: async () => {}, rng: mulberry32(1), chatRng: () => 1, timer: h.timer, now: () => h.timer.now }, opts, {
    push(seat, msg) { if (msg && Array.isArray(msg.events)) h.events[seat].push(...msg.events); },
  }));
  return h;
}
const settle = async (h, n = 12) => { for (let i = 0; i < n; i++) { h.timer.advance(50); await tick(); } };
function moveFor(v, rnd) {
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
}
/* Play (both people, ordinary moves) until `pred(seat, view)` holds for somebody who is being asked something; returns that seat. */
async function reach(h, pred, rnd, limit = 4000) {
  const m = h.match;
  for (let n = 0; !m.over && n < limit; n++) {
    for (const seat of m.humans) {
      const v = m.viewFor(seat);
      if (v.awaiting && pred(seat, v)) return seat;
    }
    for (const seat of m.humans) { const v = m.viewFor(seat); if (v.awaiting && !m.paused) m.intent(seat, moveFor(v, rnd)); }
    h.timer.advance(300); await tick();
  }
  return null;
}
const mine = v => v.game.players[0].hand.length;

(async () => {
  console.log('1. the opening');
  {
    const h = harness({ rng: mulberry32(2) }); const m = h.match; m.start(); await settle(h);
    let seat = null; for (const s of m.humans) { const a = m.viewFor(s).awaiting; if (a && a.kind === 'build' && a.canDrawEarly && !a.canDraw && a.moves.length) { seat = s; break; } }
    ok(seat !== null, 'at the start of the opening somebody has a tile that fits and could draw anyway');
    const v0 = m.viewFor(seat), n0 = mine(v0), bone0 = v0.game.boneyard.length;
    const r = m.intent(seat, { a: 'draw' }); await settle(h);
    const v1 = m.viewFor(seat);
    ok(r.ok === true && mine(v1) === n0 + 1 && v1.game.boneyard.length === bone0 - 1, 'the server accepts the draw: a tile moves from the boneyard to that hand');
    ok(v1.awaiting && v1.awaiting.kind === 'build' && v1.awaiting.canDrawEarly === false && v1.awaiting.canDraw === false, 'and offers it no more (one draw only)');
    const r2 = m.intent(seat, { a: 'draw' });
    ok(r2.ok === false && r2.code === 'illegal' && /only draw before/.test(r2.message), 'a second draw is refused: "' + r2.message + '"');
    const mv = v1.awaiting.moves[0];
    ok(m.intent(seat, { a: 'play', tile: mv.tile, train: mv.trainId }).ok === true, 'a tile can be put down as ever'); await settle(h);
    const v2 = m.viewFor(seat);
    if (v2.awaiting && v2.awaiting.kind === 'build') { const r3 = m.intent(seat, { a: 'draw' }); ok(r3.ok === false && r3.code === 'illegal', 'and with a tile down there is no drawing'); } else ok(false, 'still building after the play');
    const other = m.humans.find(s => s !== seat), ev = h.events[other].filter(e => e.e === 'draw');
    ok(ev.length >= 1 && ev.every(e => e.who !== 'me' && e.tile === undefined), 'the other person is shown that a tile was drawn, not which one');
    m.abort();
  }
  console.log('2. a turn');
  {
    const h = harness({ rng: mulberry32(3) }); const m = h.match; m.start();
    const rnd = mulberry32(31);
    const seat = await reach(h, (s, v) => v.awaiting.kind === 'move' && !v.game.openDouble && v.game.boneyard.length > 3, rnd);
    ok(seat !== null, 'somebody is to move, with a play, and no double to cover');
    const v0 = m.viewFor(seat), n0 = mine(v0), bone0 = v0.game.boneyard.length, oldMoves = v0.awaiting.moves.map(x => key(x.tile) + '>' + x.trainId);
    const other = m.humans.find(s => s !== seat), evBefore = h.events[other].length, logBefore = m.viewFor(other).log.length;
    const r = m.intent(seat, { a: 'draw' }); await settle(h);
    const v1 = m.viewFor(seat);
    ok(r.ok === true && mine(v1) === n0 + 1 && v1.game.boneyard.length === bone0 - 1, 'the draw is accepted: a tile moves from the boneyard to the hand');
    ok(v1.awaiting && v1.awaiting.kind === 'move' && v1.awaiting.drewAnyway === true && oldMoves.every(x => v1.awaiting.moves.some(y => key(y.tile) + '>' + y.trainId === x)), 'and the turn goes on: asked for a move again, everything possible before still possible');
    ok(m.viewFor(seat).log.some(l => /^You drew \d+-\d+\.$/.test(l)), 'the person is told which tile they drew');
    const vo = m.viewFor(other);
    ok(vo.log.slice(logBefore).some(l => l === m.names[seat] + ' draws a tile.') && h.events[other].slice(evBefore).some(e => e.e === 'draw' && e.who !== 'me'), 'the other person sees "' + m.names[seat] + ' draws a tile." and a draw: exactly what any draw looks like to them (it says nothing of whether there was a play)');
    const r2 = m.intent(seat, { a: 'draw' });
    ok(r2.ok === false && r2.code === 'illegal' && /already drawn/.test(r2.message), 'a second draw in the same turn: refused: "' + r2.message + '"');
    ok(m.intent(other, { a: 'draw' }).ok === false, 'the other person, who is not being asked to move, cannot draw');
    const mv = v1.awaiting.moves[0];
    ok(m.intent(seat, { a: 'play', tile: mv.tile, train: mv.trainId }).ok === true, 'a tile can still be played'); await settle(h);
    ok(m.viewFor(seat).game.players[0].hand.length === n0, 'the hand is back to what it was (one drawn, one played)');
    m.abort();
  }
  console.log('3. when it is refused');
  {
    const h = harness({ rng: mulberry32(4) }); const m = h.match; m.start();
    const rnd = mulberry32(41);
    const seat = await reach(h, (s, v) => v.awaiting.kind === 'move' && !!v.game.openDouble, rnd);
    ok(seat !== null, 'somebody is to move with a double to cover');
    const v0 = m.viewFor(seat), n0 = mine(v0), bone0 = v0.game.boneyard.length;
    const r = m.intent(seat, { a: 'draw' }); await settle(h);
    ok(r.ok === false && r.code === 'illegal' && /double has to be covered/.test(r.message) && mine(m.viewFor(seat)) === n0 && m.viewFor(seat).game.boneyard.length === bone0, 'while a double has to be covered the draw is refused and nothing changes: "' + r.message + '"');
    const mv = v0.awaiting.moves[0];
    ok(m.intent(seat, { a: 'play', tile: mv.tile, train: mv.trainId }).ok === true, 'covering it works as ever');
    m.abort();
  }
  {
    const h = harness({ rng: mulberry32(5) }); const m = h.match; m.start();
    const rnd = mulberry32(51);
    const seat = await reach(h, (s, v) => v.awaiting.kind === 'move' && !v.game.openDouble, rnd);
    m.game.boneyard.length = 0;
    const n0 = mine(m.viewFor(seat));
    const r = m.intent(seat, { a: 'draw' });
    ok(r.ok === false && r.code === 'illegal' && /boneyard is empty/.test(r.message) && mine(m.viewFor(seat)) === n0, 'from an empty boneyard: refused: "' + r.message + '"');
    m.abort();
  }
  {
    const h = harness({ rng: mulberry32(6) }); const m = h.match; m.start();
    const rnd = mulberry32(61);
    const seat = await reach(h, (s, v) => v.awaiting.kind === 'draw', rnd);
    ok(seat !== null, 'somebody has nothing to play');
    const n0 = mine(m.viewFor(seat)); const r = m.intent(seat, { a: 'draw' }); await settle(h);
    ok(r.ok === true && mine(m.viewFor(seat)) === n0 + 1, 'the ordinary draw (nothing fits) works as ever');
    m.abort();
  }

  console.log('4. whole matches with draws you did not have to make');
  {
    let matches = 0, finished = 0, lost = 0, dup = 0, early = 0, refused = 0, problems = 0, doubleRefused = 0, offered = 0, fits = 0, stale = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const withComputer = seed % 3 === 0;
      const h = harness({ rng: mulberry32(seed), hand: [8, 12, 15][seed % 3], names: withComputer ? ['Ann', 'Ben', 'Gandalf'] : ['Ann', 'Ben', 'Cat'], computer: withComputer ? { level: 'normal' } : null, n: 3 });
      if (!withComputer) { /* two people and a computer is the usual room; with three people there is no computer */ }
      const m = h.match, rnd = mulberry32(seed + 100); const run = m.start(); matches++;
      let total = null;
      for (let n = 0; !m.over && n < 20000; n++) {
        for (const seat of m.humans) {
          const v = m.viewFor(seat);
          if (!v.awaiting || m.paused) continue;
          if (m.game) { const g = m.game, all = g.players.reduce((c, p) => c + p.hand.length, 0) + Object.values(g.trains).reduce((c, t) => c + t.tiles.length, 0) + g.boneyard.length; if (total === null) total = all; if (all !== total) lost++; const ks = [].concat(...g.players.map(p => p.hand.map(key)), ...Object.values(g.trains).map(t => t.tiles.map(key)), g.boneyard.map(key)); if (new Set(ks).size !== ks.length) dup++; }
          if ((v.awaiting.kind === 'move' || v.awaiting.kind === 'build') && rnd() < 0.25) {
            const dbl = v.awaiting.kind === 'move' && !!v.game.openDouble;
            const r = m.intent(seat, { a: 'draw' });
            if (r.ok) {
              early++;
              if (v.awaiting.kind === 'move') {                   // what the person is offered is exactly what the hand can now play, the new tile included
                const drawnTo = m.game.players[seat].hand.length;
                for (let w = 0; w < 6; w++) { h.timer.advance(50); await tick(); }
                const v2 = m.viewFor(seat);
                if (v2.awaiting && v2.awaiting.kind === 'move' && v2.awaiting.drewAnyway) {
                  offered++;
                  const want = new Set(legalMoves(m.game, m.game.players[seat]).map(x => key(x.tile))), got = new Set(v2.awaiting.moves.map(x => key(x.tile)));
                  if (want.size !== got.size || [...want].some(x => !got.has(x))) stale++;
                  if (v2.awaiting.moves.some(x => !v.awaiting.moves.some(y => key(y.tile) === key(x.tile)))) fits++;
                }
              }
            } else { refused++; if (dbl) doubleRefused++; if (r.code !== 'illegal') problems++; }
            continue;
          }
          const r = m.intent(seat, moveFor(v, rnd)); if (!r.ok) problems++;
        }
        h.timer.advance(300); await tick();
      }
      if (!m.over) m.abort(); await run; if (m.over === 'finished') finished++;
    }
    ok(finished === matches && problems === 0, `${matches} whole hosted matches (with and without a computer) were played to the end with draws thrown in: nothing unexpected refused, nothing broken (${problems} problems)`);
    ok(lost === 0 && dup === 0, `no tile was lost or made twice (${lost} counts off, ${dup} duplicates)`);
    ok(offered >= 20 && stale === 0 && fits >= 3, `after a draw, the plays the person is offered are exactly what the hand can play now: ${offered} turns checked, ${fits} where the new tile itself could be played, ${stale} out of date`);
    ok(early >= 40 && refused >= 5 && doubleRefused >= 1, `with every kind of case really happening: ${early} draws accepted, ${refused} refused (${doubleRefused} for a double to cover)`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
