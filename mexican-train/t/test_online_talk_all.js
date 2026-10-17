'use strict';
// Online, every computer at the table talks (not only the first one): each grumbles about its own luck in its own voice, and the rest of the talk is shared out among them.
require('./game.js');
const { OnlineMatch } = require('../online-match.js');
const G = globalThis.MexicanTrainGame;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

function make(chatVals) {
  const said = [[], []]; let i = 0;
  const q = []; const timer = { set(fn) { q.push(fn); return q.length; }, clear() {} };
  const m = new OnlineMatch({ names: ['Ann', 'Ben', 'Zed', 'Yan'], computers: [{ level: 'easy' }, { level: 'hard' }], theme: 'classic', rounds: 1, hand: 8, nativeChance: 0, foodChance: 0, sleep: async () => {},
    chatRng: () => (chatVals ? chatVals[i++ % chatVals.length] : 0), timer, now: (() => { let t = 0; return () => (t += 100000); })(), push(seat, msg) { if (msg && msg.t === 'say') said[seat].push(msg); } });
  const flush = () => { while (q.length) q.shift()(); };
  return { m, said, flush };
}
console.log('1. each computer grumbles about its own luck');
{
  const { m, said, flush } = make();
  ok(m.talkers.join() === '2,3' && m.humans.join() === '0,1', 'two people and two computers');
  m._ownLuck(2, 'draw'); flush();
  m._ownLuck(3, 'draw'); flush();
  const froms = said[0].map(x => x.from);
  ok(froms.join() === 'Zed,Yan', `the first computer, then the second: ${froms.join()}`);
  ok(G.LINES.easy.ownDraw.includes(said[0][0].text) && G.LINES.hard.ownDraw.includes(said[0][1].text), 'each in the voice of its own level');
  ok(said[1].map(x => x.from).join() === 'Zed,Yan', 'and the other person at the table hears the same');
  m._ownLuck(3, 'draw'); flush();
  ok(said[0][2] && G.LINES.hard.ownDrawAgain.includes(said[0][2].text), 'a second bad draw in a row by the second computer is "again" (each keeps its own run)');
  m._ownLuck(2, 'play'); m._ownLuck(3, 'play');
  m._ownLuck(2, 'draw'); flush();
  ok(G.LINES.easy.ownDraw.includes(said[0][3].text), 'after a play the run starts over');
}
console.log('2. talk about a person\'s move is shared out');
{
  const { m, said, flush } = make([0, 0.9, 0]);
  const who = new Set();
  for (let k = 0; k < 20; k++) { m._maybeSay(0, 'awful'); flush(); }
  said[0].forEach(x => who.add(x.from));
  ok(who.has('Zed') && who.has('Yan'), `both computers get to speak (${[...who].join(', ')})`);
  const one = new OnlineMatch({ names: ['Ann', 'Ben', 'Zed'], computer: { level: 'easy' }, push() {} });
  ok(one._speaker() === one.talker, 'with one computer, that one speaks');
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
