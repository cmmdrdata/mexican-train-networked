'use strict';
// The computer notices when you try to put a tile where it does not go, and remarks on it (in every voice); nothing else changes.
const { OnlineMatch } = require('../online-match.js');
const G = globalThis.MexicanTrainGame;
const { mulberry32, key } = G.Engine;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => setImmediate(r));

async function page(opts) {
  const store = {};
  const root = { set innerHTML(v) { this.h = v; }, get innerHTML() { return this.h || ''; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const app = G.createApp({ root, rng: mulberry32(5), paceRng: () => 0, chatRng: () => 0, nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  app.dispatch({ type: 'boot' });
  app.dispatch(Object.assign({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'normal' }, opts));
  for (let i = 0; i < 200 && !(app.state.awaiting && app.state.awaiting.kind === 'build'); i++) await wait(5);
  return app;
}
(async () => {
console.log('1. the lines');
{
  for (const lvl of ['easy', 'normal', 'hard', 'expert']) { const L = G.LINES[lvl].invalid; ok(Array.isArray(L) && L.length >= 3 && new Set(L).size === L.length && L.every(x => x.length < 90), `${lvl}: at least three different short lines`); }
  ok(G.LINES.easy.invalid.join() !== G.LINES.normal.invalid.join() && G.LINES.normal.invalid.join() !== G.LINES.hard.invalid.join(), 'each level has its own');
  for (const lang of Object.keys(G.NATIVE_LINES)) { const L = G.NATIVE_LINES[lang].invalid; ok(L && L.length >= 2 && L.every(p => p.length === 2 && p[0] && /[A-Za-z]{4}/.test(p[1]) && p[0] !== p[1]), `${lang}: lines in its own script, each with an English translation`); }
  const seen = new Map(); let n = 0;
  for (const [name, th] of Object.entries(G.THEMES.lotr.voices || {})) { const L = th.invalid; if (L && L.length >= 3) n++; (L || []).forEach(l => { if (seen.has(l)) seen.get(l).push(name); else seen.set(l, [name]); }); }
  ok(n === 14, `all 14 characters have at least three lines of their own (${n})`);
  ok([...seen.values()].every(v => v.length === 1) && ![...seen.keys()].some(l => Object.values(G.LINES).some(L => (L.invalid || []).includes(l))), 'none shared with another character or with the generic lines');
  const all = [].concat(...Object.values(G.LINES).map(L => L.invalid), ...Object.values(G.NATIVE_LINES).map(L => L.invalid.map(p => p[1])), [...seen.keys()]);
  ok(all.every(l => !/\d/.test(l) && !/only move|no choice|your hand|you hold|you have a/i.test(l)), 'no line quotes a number or says anything about what you hold');
  ok(G.CHAT.chance.invalid > 0 && !G.CHAT.bypass.invalid, 'it comes by chance and the usual cooldown (a run of bad tries is not a run of remarks)');
}

console.log('2. on this page');
{
  const bad = A => { const a = A.state.awaiting; const t = a.moves[0].tile; return { key: key(t), tile: t }; };
  // hints off: select a tile, press a train it cannot go on
  let A = await page({ allowHints: false });
  let m = bad(A);
  A.dispatch({ type: 'selectTile', key: m.key }); A.dispatch({ type: 'playOn', train: 'mexican' });
  ok(/cannot be played/.test(A.state.notice), 'hints off: the page says the tile cannot be played there (as before)');
  await wait(1500);
  ok(A.state.comment && A.state.comment.kind === 'invalid' && G.LINES.normal.invalid.includes(A.state.comment.text), `and the computer remarks on it: "${A.state.comment && A.state.comment.text}"`);
  // a second try straight away: the cooldown
  A.state.comment = null; A.dispatch({ type: 'selectTile', key: m.key }); A.dispatch({ type: 'playOn', train: 'mexican' });
  await wait(1500);
  ok(!A.state.comment, 'a second bad try straight away: no second remark (cooldown)');
  // a good play is not remarked on as invalid
  A = await page({ allowHints: false });
  const a = A.state.awaiting, mv = a.moves[0];
  A.dispatch({ type: 'selectTile', key: key(mv.tile) }); A.dispatch({ type: 'playOn', train: mv.trainId });
  await wait(1500);
  ok(!(A.state.comment && A.state.comment.kind === 'invalid'), 'a legal play is never remarked on as invalid');
  // hints on: a tile let go over a train it cannot go on
  A = await page({});
  m = bad(A);
  A.dispatch({ type: 'dropOnTrain', key: m.key, train: 'mexican' });
  await wait(1500);
  ok(A.state.comment && A.state.comment.kind === 'invalid', 'hints on: a tile let go over a train it cannot go on is remarked on too');
  // the same through the drag (the page tells the app when a tile is let go over a train that cannot take it)
  A = await page({});
  A.dispatch({ type: 'invalidTry' }); await wait(1500);
  ok(A.state.comment && A.state.comment.kind === 'invalid', 'the "invalidTry" action (sent when a drag ends over a train it cannot go on) gets the remark');
  // comments switched off: silence
  A = await page({}); A.dispatch({ type: 'toggleChat' });
  A.dispatch({ type: 'invalidTry' }); await wait(1500);
  ok(!A.state.comment, 'with Comments off, nothing is said');
  // not on the computer's turn / nothing awaited
  A = await page({}); A.state.awaiting = null;
  A.dispatch({ type: 'invalidTry' }); await wait(1500);
  ok(!A.state.comment, 'when nothing is being asked of you, nothing is said');
}

console.log('3. a hosted game: the computer at the table remarks');
{
  const q = []; let t = 0;
  const timer = { set(fn, ms) { q.push({ fn, at: t + ms }); return q.length; }, clear() {}, advance(ms) { t += ms; q.filter(e => e.at <= t).forEach(e => { q.splice(q.indexOf(e), 1); e.fn(); }); } };
  const said = [[], [], []];
  const mk = (names, computer) => new OnlineMatch({ names, computer, rounds: 1, hand: 8, stepDelay: 0, sleep: async () => {}, rng: mulberry32(2), chatRng: () => 0, timer, now: () => t, nativeChance: 0, foodChance: 0, push(seat, msg) { if (msg.t === 'say' && msg.kind === 'invalid') said[seat].push(msg); } });
  const m = mk(['Ann', 'Ben', 'Zed'], { level: 'hard' });
  m.start(); await tick(); await tick(); await tick();
  ok(!!m.awaiting[0], 'Ann is being asked for a move');
  t += 30000; m.tried(0); timer.advance(3000);
  ok(said[0].length === 1 && said[0][0].kind === 'invalid' && G.LINES.hard.invalid.includes(said[0][0].text) && said[1].length === 0, `Ann hears the computer: "${said[0][0] && said[0][0].text}" (and Ben, who did nothing, hears nothing)`);
  m.tried(0); timer.advance(3000);
  ok(said[0].length === 1, 'a second try straight away: the cooldown');
  t += 20000; m.awaiting[1] = null; m.tried(1); timer.advance(3000);
  ok(said[1].length === 0, 'someone who is not being asked for anything is not remarked on');
  m.tried(2); m.tried(7); m.tried(-1); timer.advance(3000);
  ok(said[2].length === 0, 'the computer seat and nonsense seats are ignored');
  m.abort(); await m.done;
  const n = mk(['Ann', 'Ben'], undefined); said[0].length = 0;
  n.start(); await tick(); await tick(); await tick(); n.tried(0); timer.advance(3000);
  ok(said[0].length === 0, 'with no computer at the table nobody remarks');
  n.abort(); await n.done;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
