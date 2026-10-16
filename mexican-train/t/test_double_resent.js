'use strict';
// A computer that has to draw because of YOUR double says it resents it (in every voice); a draw for its own double, or a plain draw, does not.
const { OnlineMatch } = require('../online-match.js');
const G = globalThis.MexicanTrainGame;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
console.log('1. the lines');
for (const lvl of ['easy', 'normal', 'hard', 'expert']) { const L = G.LINES[lvl].doubleResent; ok(Array.isArray(L) && L.length >= 3 && new Set(L).size === L.length && L.every(x => x.length < 90), `${lvl}: at least three different short lines`); }
ok(G.LINES.easy.doubleResent.join() !== G.LINES.normal.doubleResent.join() && G.LINES.normal.doubleResent.join() !== G.LINES.hard.doubleResent.join(), 'each level has its own');
for (const lang of Object.keys(G.NATIVE_LINES)) { const L = G.NATIVE_LINES[lang].doubleResent; ok(L && L.length >= 2 && L.every(p => p.length === 2 && p[0] && /[A-Za-z]{4}/.test(p[1]) && p[0] !== p[1]), `${lang}: its own script with a translation`); }
const voices = Object.values(G.THEMES.lotr.voices || {});
ok(voices.length === 14 && voices.every(v => v.doubleResent && v.doubleResent.length >= 2), 'all 14 characters have lines of their own');
ok(G.CHAT.chance.doubleResent >= 0.5 && !G.CHAT.bypass.doubleResent, 'it is likely, and waits its turn like the other own-luck remarks');
const all = [].concat(...Object.values(G.LINES).map(L => L.doubleResent), ...voices.map(v => v.doubleResent));
ok(all.every(l => !/\d/.test(l) && !/your hand|you hold|\byou\b|\byour\b/i.test(l.replace('when it is your turn to draw', ''))), 'no line quotes a number or points at you (it may be another computer\'s double)');

console.log('2. on this page: a double of yours that a computer must draw for');
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const store = {};
  const root = { set innerHTML(v) { this.h = v; }, get innerHTML() { return this.h || ''; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const app = G.createApp({ root, rng: G.Engine.mulberry32(5), paceRng: () => 0, chatRng: () => 0, nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  app.dispatch({ type: 'boot' });
  app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'normal' });
  for (let i = 0; i < 200 && !(app.state.awaiting && app.state.awaiting.kind === 'build'); i++) await wait(5);
  const S = app.state;
  // drive the engine hooks directly: the human opened a double, the computer must draw
  S.doubleBy = 'human';
  const g = S.game; g.openDouble = { trainId: 'human', value: 5 };
  S.lastCommentAt = -1e9; S.comment = null;
  const cpu = g.players.find(p => p.id === 'cpu');
  const tile = g.boneyard[0];
  await app.ui.onDraw(g, cpu, tile);
  await wait(1500);
  ok(S.comment && S.comment.kind === 'computer' || (S.comment && G.LINES.normal.doubleResent.includes(S.comment.text)), `it resents the double: "${S.comment && S.comment.text}"`);
  ok(S.comment && G.LINES.normal.doubleResent.includes(S.comment.text), 'with a line of that kind');
  // another computer's double: resented too
  S.comment = null; S.lastCommentAt = -1e9; S.doubleBy = 'cpu2'; S.coverDraw = false; S.unlucky = {};
  await app.ui.onDraw(g, cpu, g.boneyard[0]);
  await wait(1500);
  ok(S.comment && G.LINES.normal.doubleResent.includes(S.comment.text), 'another computer\'s double: resented too');
  // its own double: no resentment
  S.comment = null; S.lastCommentAt = -1e9; S.doubleBy = 'cpu'; S.coverDraw = false; S.unlucky = {};
  await app.ui.onDraw(g, cpu, g.boneyard[0]);
  await wait(1500);
  ok(!S.comment || !G.LINES.normal.doubleResent.includes(S.comment.text), 'its own double: no resentment');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
