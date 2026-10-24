'use strict';
// What a computer calls the person it is talking to: the name they entered, not "Player".
require('./game.js');
const G = globalThis.MexicanTrainGame;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

// every line, in every theme, that addresses the person by name
const lines = [];
const walk = (voices, theme) => Object.keys(voices).forEach(n => Object.keys(voices[n]).forEach(k => (voices[n][k] || []).forEach(l => { if (typeof l === 'string' && /\{[mM]e\}/.test(l)) lines.push({ theme, n, k, l }); })));
Object.keys(G.THEMES).forEach(t => G.THEMES[t].voices && walk(G.THEMES[t].voices, t));
ok(lines.length >= 5, `${lines.length} lines address the person by name`);
ok(lines.every(x => !/\bPlayer\b|\bthe player\b/.test(x.l)), 'none of them says "Player" or "the player" itself');
for (const x of lines) {
  const named = G.fillLine(x.l, { me: 'Ann', Me: 'Ann' }), unnamed = G.fillLine(x.l, { me: 'player', Me: 'Player' });
  ok(named.includes('Ann') && !/[{}]/.test(named) && !/player/i.test(named.replace(/players/i, '')), `${x.n}/${x.k}: with a name: ${named}`);
  ok(!/[{}]/.test(unnamed), `${x.n}/${x.k}: with no name: ${unnamed}`);
}

// composeComment fills it in, from `me` (whatever vars say)
const seen = new Set();
for (const x of lines) {
  for (let i = 0; i < 40 && !seen.has(x.l); i++) {
    const rng = (() => { let a = i * 7919 + 13; return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
    const r = G.composeComment(x.k, {}, { me: 'Bartholomew', name: x.n, level: G.Engine && undefined, theme: x.theme, rng, nativeChance: 0, foodChance: 0, last: null, dish: null });
    if (/Bartholomew/.test(r.text)) seen.add(x.l);
    ok(!/[{}]/.test(r.text), 'no placeholder is ever left in what is said: ' + r.text);
  }
}
ok(seen.size > 0, 'at least one comment really was spoken with the entered name');
const none = G.composeComment(lines[0].k, {}, { name: lines[0].n, theme: lines[0].theme, rng: Math.random, nativeChance: 0, foodChance: 0, last: null, dish: null });
ok(!/[{}]/.test(none.text), 'with no name at all nothing breaks: ' + none.text);
ok(G.fillLine('a {me} b', { me: 'x' }) === 'a x b', 'fillLine fills it');

// the hosted game passes the person's own name too (the server composes those comments)
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'online-match.js'), 'utf8');
ok(/composeComment\(kind, vars, \{ me: this\.names\[seat\]/.test(src), 'a hosted game tells the computer the name of the person it is talking to');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
