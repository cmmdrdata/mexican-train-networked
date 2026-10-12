'use strict';
// The computer players' remarks about THEIR OWN luck (a tile that does not fit, a run of bad draws, no move at all, a very short train, a blocked round) in their own
// voices, and the removal of any remark that the player's move was their "only" one (the computer cannot see your hand).
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const OWN = ['ownDraw', 'ownDrawAgain', 'ownBlocked', 'ownShort', 'roundBlocked'];
const fill = (t, vars) => G.fillLine(t, vars || {});

console.log('1. nothing says or implies that your move was your only one');
const REVEAL = /\bonly (move|choice|option|play)\b|\bsingle (move|choice|option)\b|\bforced (move|play)\b|\bchoice of one\b|\bone option\b|\bno choice at all\b|\bonly one (tile|way|path|road|move)\b|\byou (had|have) (only|just)? ?(one|no) (option|choice|move)\b|\byour only\b/i;      // (about the PLAYER's move: the computer saying it has no choice but to draw is its own business)
const pools = [];                                          // every line the computers can say: [where, kind, line]
for (const [lvl, L] of Object.entries(G.LINES)) for (const [k, arr] of Object.entries(L)) arr.forEach(l => pools.push([`generic ${lvl}`, k, l]));
for (const [lang, L] of Object.entries(G.NATIVE_LINES)) for (const [k, arr] of Object.entries(L)) arr.forEach(([n, t]) => { pools.push([`${lang}`, k, t]); });
const T = G.THEMES.lotr;
for (const [who, V] of Object.entries(T.voices)) for (const [k, arr] of Object.entries(V)) arr.forEach(l => pools.push([who, k, l]));
ok(pools.length > 1000, `${pools.length} lines in all, in every voice, language and theme`);
const bad = pools.filter(([w, k, l]) => REVEAL.test(l));
ok(bad.length === 0, `not one of them says it was your only move, a forced move or that you had no choice${bad.length ? ': ' + bad.slice(0, 3).map(b => `${b[0]}/${b[1]}: ${b[2]}`).join(' | ') : ''}`);
ok(!pools.some(([w, k]) => k === 'forced'), 'and there is no longer a "forced" kind of remark anywhere (generic, the six languages, every character)');
ok(!('forced' in G.CHAT.chance) && G.commentKindFor({ forced: true, best: 5, value: 5, gap: 0, n: 1 }) === null && G.commentKindFor({ forced: true, best: 2000, value: 0, gap: 2000, n: 1 }) === null, 'a forced move is given no remark by the rating, however it scores');
ok(OWN.every(k => typeof G.CHAT.chance[k] === 'number' && G.CHAT.chance[k] > 0 && G.CHAT.chance[k] <= 1) && G.CHAT.bypass.ownShort && G.CHAT.bypass.roundBlocked && !G.CHAT.bypass.ownDraw && !G.CHAT.bypass.ownDrawAgain && !G.CHAT.bypass.ownBlocked, 'the five own-luck kinds have a chance each; the rare ones (a very short train, a blocked round) always get through, the others wait their turn');
ok(G.CHAT.chance.ownDrawAgain > G.CHAT.chance.ownDraw, 'and a run of bad draws gets a remark more readily than the first');

console.log('2. in every voice');
for (const lvl of ['easy', 'normal', 'hard', 'expert']) {
  const L = G.LINES[lvl];
  ok(OWN.every(k => Array.isArray(L[k]) && L[k].length >= 3 && new Set(L[k]).size === L[k].length && L[k].every(l => l.length <= 100 && !/[<>&"]/.test(l))), `${lvl}: three or more distinct, short lines for each of the five`);
  ok(L.ownShort.some(l => l.includes('{built}')) && OWN.filter(k => k !== 'ownShort').every(k => L[k].every(l => !/\{/.test(l))), `${lvl}: only the short-train lines quote a number`);
}
ok(G.LINES.easy.ownDraw.join() !== G.LINES.normal.ownDraw.join() && G.LINES.normal.ownDraw.join() !== G.LINES.hard.ownDraw.join() && G.LINES.expert === G.LINES.hard, 'Easy, Medium and Hard each have their own voice (and Expert, as everywhere, speaks like Hard)');
{
  const SCRIPT = { ru: /[\u0400-\u04FF]/, ja: /[\u3040-\u30FF\u4E00-\u9FFF]/, zh: /[\u4E00-\u9FFF]/, ko: /[\uAC00-\uD7AF]/, hi: /[\u0900-\u097F]/, ar: /[\u0600-\u06FF]/ };
  const NOT = { zh: /[\u3040-\u30FF]/ };                   // (Chinese has no kana)
  let all = 0, wrongScript = 0, noTrans = 0, dupes = 0;
  for (const lang of Object.keys(SCRIPT)) for (const k of OWN) {
    const arr = G.NATIVE_LINES[lang][k]; all += arr.length;
    if (!arr || arr.length < 2 || new Set(arr.map(p => p[0])).size !== arr.length) dupes++;
    arr.forEach(([n, t]) => { if (!SCRIPT[lang].test(n) || (NOT[lang] && NOT[lang].test(n)) || /[A-Za-z]/.test(n)) wrongScript++; if (!/^[A-Za-z]/.test(t) || /[^\x20-\x7E]/.test(t)) noTrans++; });
  }
  ok(all === 60 && wrongScript === 0 && noTrans === 0 && dupes === 0, `the six languages (Russian, Japanese, Chinese, Korean, Hindi, Arabic) have two lines each for each of the five (${all}), each in its own script with an English translation`);
  const names = { Dmitri: 'ru', Keiko: 'ja', Mei: 'zh', Joon: 'ko', Ravi: 'hi', Omar: 'ar' };
  let good = 0, total = 0;
  for (const [name, lang] of Object.entries(names)) for (const k of OWN) { total++; const said = G.composeComment(k, { built: 2 }, { name, level: 'hard', theme: 'classic', rng: () => 0, nativeChance: 1, foodChance: 0, last: null }); if (said.lang === lang && SCRIPT[lang].test(said.text) && /^[A-Za-z]/.test(said.trans) && G.NATIVE_LINES[lang][k].some(p => p[0] === said.text)) good++; }
  ok(good === total, `a computer player with a native language says these in it, with a translation (${good} of ${total})`);
}
{
  const cast = Object.keys(T.voices), seen = new Map();
  ok(cast.length === 14 && OWN.every(k => cast.every(n => Array.isArray(T.voices[n][k]) && T.voices[n][k].length >= 2 && new Set(T.voices[n][k]).size === T.voices[n][k].length)), 'every one of the 14 Lord of the Rings characters has two or more lines of their own for each of the five');
  let shared = 0; for (const n of cast) for (const k of OWN) for (const l of T.voices[n][k]) { if (seen.has(l) && seen.get(l) !== n) shared++; seen.set(l, n); }
  ok(shared === 0, 'and no line is shared between two characters: each speaks in their own voice');
  ok(cast.every(n => OWN.every(k => T.voices[n][k].every(l => !G.LINES.normal[k].includes(l) && !G.LINES.easy[k].includes(l) && !G.LINES.hard[k].includes(l)))), 'nor is any a generic line: they are not the classic players\' words');
  ok(cast.every(n => T.voices[n].ownShort.some(l => l.includes('{built}')) && OWN.filter(k => k !== 'ownShort').every(k => T.voices[n][k].every(l => !/\{/.test(l)))), 'each character can say how many tiles its short train has, and nothing else carries a number');
  let fromVoice = 0, total = 0;
  for (const n of cast) for (const k of OWN) for (let i = 0; i < 6; i++) { total++; const said = G.composeComment(k, { built: 1 }, { name: n, level: 'normal', theme: 'lotr', rng: mulberry32(i * 31 + 7), nativeChance: 0, foodChance: 0, last: null }); if (T.voices[n][k].map(l => fill(l, { built: 1 })).includes(said.text) && !/\{/.test(said.text)) fromVoice++; }
  ok(fromVoice === total, `a character says these in their own voice, with the number filled in (${fromVoice} of ${total})`);
  const gimli = new Set(), gandalf = new Set(); for (let i = 0; i < 40; i++) { gimli.add(G.composeComment('ownBlocked', {}, { name: 'Gimli', level: 'normal', theme: 'lotr', rng: mulberry32(i), nativeChance: 0, foodChance: 0, last: null }).text); gandalf.add(G.composeComment('ownBlocked', {}, { name: 'Gandalf', level: 'expert', theme: 'lotr', rng: mulberry32(i), nativeChance: 0, foodChance: 0, last: null }).text); }
  ok([...gimli].every(t => !gandalf.has(t)) && gimli.size >= 2, 'Gimli and Gandalf, blocked, do not sound alike');
}

console.log('3. in real games: the right remark, from the right computer, on the right event, and on no other');
function fakeTimer() {
  let id = 0, clock = 0; const q = [];
  return { set(fn, ms) { const t = { id: ++id, fn, at: clock + ms, ms }; q.push(t); return t.id; }, clear(i) { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); },
    advance(ms) { const end = clock + ms; for (;;) { q.sort((a, b) => a.at - b.at); const nx = q[0]; if (!nx || nx.at > end) break; q.shift(); clock = nx.at; nx.fn(); } clock = end; }, get clock() { return clock; } };
}
function makeApp(seed) {
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {}, timer = fakeTimer();
  const app = G.createApp({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, chatRng: () => 0, nativeChance: 0, foodChance: 0, timer, now: () => 1e6 + timer.clock, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  return { app, root, timer };
}
function step(a, A) {
  const d = x => a.app.dispatch(x);
  if (A.kind === 'draw') d({ type: 'draw' });
  else if (A.kind === 'modal') d({ type: 'dialogOk' });
  else if (A.kind === 'build') { if (A.canDraw) d({ type: 'draw' }); else if (A.canBuild) d({ type: 'autoBuild' }); else if (A.canDone) d({ type: 'endBuild' }); else d({ type: 'undoTile' }); }
  else { const m = A.moves[0]; d({ type: 'selectTile', key: key(m.tile) }); if (a.app.state.awaiting === A) d({ type: 'playOn', train: m.trainId }); }
}
/* Every bubble the page puts up, in order (a bubble that is replaced a moment later would be missed by looking now and then). */
function watch(S) {
  const list = []; let cur = S.comment;
  Object.defineProperty(S, 'comment', { configurable: true, enumerable: true, get() { return cur; }, set(v) { cur = v; if (v) list.push({ id: v.id, kind: v.kind, text: v.text, from: v.from }); } });
  return list;
}
/* Play one round and return what the computers said about their own luck, and what the game's own log says should have made them say it. */
async function playGame(seed, o) {
  const a = makeApp(seed); const S = a.app.state; const bubbles = watch(S);
  a.app.dispatch(Object.assign({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' }, o || {}));
  const names = () => [S.cpuName, S.cpu2Name].filter(Boolean);
  const exp = [], got = [], all = []; const streak = {}, coverPending = {}; const covers = { draws: 0, passes: 0 };
  let lastId = 0, logSeen = 0, blockedRound = false, ended = false;
  const poll = () => {
    for (; lastId < bubbles.length; lastId++) { const c = bubbles[lastId]; const who = c.from || S.cpuName; all.push({ kind: c.kind, text: c.text, who }); if (OWN.includes(c.kind)) got.push({ kind: c.kind, who, text: c.text.replace(/&#39;/g, "'") }); }
    if (S.log.length < logSeen) logSeen = 0;
    for (; logSeen < S.log.length; logSeen++) {
      const line = S.log[logSeen].replace(/&#39;/g, "'");
      if (/^All trains are built\./.test(line)) for (const n of names()) streak[n] = 0;
      for (const n of names()) {
        if (line.startsWith(n + ' played ')) streak[n] = 0;
        else if (line.startsWith(`That was ${n}'s last tile, but a double cannot go out`)) coverPending[n] = true;
        else if (line === n + ' draws a tile.') { if (coverPending[n]) { coverPending[n] = false; covers.draws++; } else { streak[n] = (streak[n] || 0) + 1; exp.push({ kind: streak[n] === 1 ? 'ownDraw' : 'ownDrawAgain', who: n }); } }
        else if (line.startsWith(n + ' cannot draw to cover their double and passes')) { coverPending[n] = false; covers.passes++; }
        else if (line.startsWith(n + ' cannot play and passes') || line.startsWith(n + ' cannot start a train and passes')) exp.push({ kind: 'ownBlocked', who: n });
        else { const m = line.match(new RegExp('^' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' finished a train of (\\d+) tiles?\\.')); if (m && +m[1] >= 1 && +m[1] <= 2) exp.push({ kind: 'ownShort', who: n, built: +m[1] }); }
      }
    }
  };
  for (let i = 0; i < 9000 && !ended; i++) {
    await tick(); a.timer.advance(100); poll();
    if (S.modal && S.modal.type === 'roundEnd') { blockedRound = !!S.modal.blocked; if (blockedRound) exp.push({ kind: 'roundBlocked' }); ended = true; break; }
    const A = S.awaiting; if (A) step(a, A);
  }
  for (let i = 0; i < 40; i++) { await tick(); a.timer.advance(100); poll(); }
  return { exp, got, all, covers, blockedRound, names: names(), levels: [S.cpuName && G.levelOfName(S.cpuName), S.cpu2Name && G.levelOfName(S.cpu2Name)], S, ended };
}
const COOL = G.CHAT.cooldownMs; G.CHAT.cooldownMs = 0;      // (so each event is judged by itself: the cooldown has its own check below)
const tally = { ownDraw: 0, ownDrawAgain: 0, ownBlocked: 0, ownShort: 0, roundBlocked: 0 }; let games = 0, mismatched = 0, wrongSpeaker = 0, wrongLine = 0, unfinished = 0, coverDraws = 0, coverPasses = 0, firstMismatch = null;
(async () => {
  for (const [level, hand] of [['easy', 8], ['easy', 12], ['normal', 8], ['hard', 12], ['easy', 15]]) {
    for (let seed = 1; seed <= 24; seed++) {
      const r = await playGame(seed, { level, hand }); games++;
      if (!r.ended) unfinished++;
      const e = r.exp.map(x => x.kind + ':' + (x.who || '*')).join(), g = r.got.map(x => x.kind + ':' + (x.who || '*')).join();
      const eNorm = r.exp.map(x => x.kind === 'roundBlocked' ? 'roundBlocked:*' : x.kind + ':' + x.who).join(), gNorm = r.got.map(x => x.kind === 'roundBlocked' ? 'roundBlocked:*' : x.kind + ':' + x.who).join();
      if (eNorm !== gNorm) { mismatched++; if (!firstMismatch) firstMismatch = `${level}/${hand}/seed ${seed}: expected [${eNorm}] but heard [${gNorm}]`; }
      r.exp.forEach(x => { tally[x.kind]++; });
      coverDraws += r.covers.draws; coverPasses += r.covers.passes;
      r.got.forEach((x, i) => {
        const lv = r.levels[0]; const pool = G.LINES[lv][x.kind] || [];
        const built = (r.exp.find(y => y.kind === 'ownShort') || {}).built;
        const okLine = pool.some(l => x.kind === 'ownShort' ? [1, 2].some(b => fill(l, { built: b }) === x.text) : l === x.text);
        if (!okLine) wrongLine++;
      });
    }
  }
  ok(unfinished === 0, `${games} real games were played to the end of their round (${unfinished} that were not)`);
  ok(mismatched === 0, `in all of them the computer said the right own-luck remark on each event, and none on any other: a bad draw, a run of them, no move, a very short opening train, a blocked round (${mismatched} games that differed)${firstMismatch ? ': ' + firstMismatch : ''}`);
  ok(wrongLine === 0, `and every remark was one of the lines of that computer's own level (${wrongLine} that were not)`);
  ok(tally.ownDraw >= 30 && tally.ownDrawAgain >= 8 && tally.ownBlocked >= 8 && tally.ownShort >= 10 && tally.roundBlocked >= 8, `with every kind really happening: ${JSON.stringify(tally)}`);
  ok(coverDraws + coverPasses >= 1, `including a computer that drew or passed only to cover its last double, which is no cause to grumble (${coverDraws} draws, ${coverPasses} passes: no remark for any)`);

  console.log('4. two computers at the table: the one it happened to is the one that speaks');
  {
    let g2 = 0, mis = 0, speakers = new Set(), events = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const r = await playGame(seed, { level: 'easy', level2: 'hard', cpus: 2, hand: 8 }); g2++;
      const eN = r.exp.map(x => x.kind === 'roundBlocked' ? 'roundBlocked:*' : x.kind + ':' + x.who), gN = r.got.map(x => x.kind === 'roundBlocked' ? 'roundBlocked:*' : x.kind + ':' + x.who);
      if (eN.join() !== gN.join()) mis++;
      r.got.forEach(x => { if (x.kind !== 'roundBlocked') { speakers.add(x.who); events++; } });
      // each one speaks in the voice of its own level
      r.got.forEach(x => { if (x.kind === 'roundBlocked') return; const lv = G.levelOfName(x.who); const pool = G.LINES[lv][x.kind]; if (!pool.some(l => x.kind === 'ownShort' ? [1, 2].some(b => fill(l, { built: b }) === x.text) : l === x.text)) mis++; });
    }
    ok(mis === 0 && g2 === 24, `in ${g2} games with an Easy and a Hard computer, each own-luck remark came from the computer it happened to, in the voice of its own level (${mis} that did not)`);
    ok(speakers.size > 8, `(and both of them did the talking: ${events} remarks from ${speakers.size} different players)`);
  }

  console.log('5. the Lord of the Rings theme: each character in their own voice');
  {
    let games3 = 0, bad3 = 0, heard = 0, chars = new Set();
    for (let seed = 1; seed <= 24; seed++) {
      const r = await playGame(seed, { level: 'normal', hand: 8, theme: 'lotr' }); games3++;
      for (const x of r.got) { heard++; if (x.kind === 'roundBlocked') { if (!Object.values(T.voices).some(v => v.roundBlocked.includes(x.text))) bad3++; continue; } chars.add(x.who); const v = T.voices[x.who]; if (!v || !v[x.kind].some(l => x.kind === 'ownShort' ? [1, 2].some(b => fill(l, { built: b }) === x.text) : l === x.text)) bad3++; }
    }
    ok(bad3 === 0 && heard >= 20, `${heard} remarks in ${games3} Lord of the Rings games, every one from the voice of the character who spoke (${bad3} that were not)`);
  }

  console.log('6. the Comments switch, the dice and the cooldown');
  {
    const a = makeApp(3); a.app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    a.app.dispatch({ type: 'toggleChat' });
    const S = a.app.state; ok(S.opts.chat === false, 'comments switched off');
    let any = 0;
    for (let i = 0; i < 4000 && !(S.modal && S.modal.type === 'roundEnd'); i++) { await tick(); a.timer.advance(100); if (S.comment) any++; const A = S.awaiting; if (A) step(a, A); }
    ok(any === 0, 'with the Comments switch off the computer says nothing, about its own luck or anything else');
  }
  {
    const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const timer = fakeTimer(), store = {};
    const app = G.createApp({ root, rng: mulberry32(5), sleep: async () => {}, reducedMotion: true, chatRng: () => 0.999, nativeChance: 0, foodChance: 0, timer, now: () => 1e6 + timer.clock, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
    app.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' });
    const S = app.state; let seen = 0;
    for (let i = 0; i < 4000 && !(S.modal && S.modal.type === 'roundEnd'); i++) { await tick(); timer.advance(100); if (S.comment && OWN.includes(S.comment.kind)) seen++; const A = S.awaiting; if (A) step({ app }, A); }
    ok(seen === 0, 'with the dice against it (a high roll) the computer stays quiet about its own luck, except what always gets through');
  }
  {
    G.CHAT.cooldownMs = COOL;
    let ordinaryAll = 0, tooClose = 0, kinds = new Set();
    for (let seed = 1; seed <= 6; seed++) {
      const a = makeApp(seed); const S = a.app.state; const bubbles = watch(S); const at = [];
      a.app.dispatch({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'easy' });
      let seen = 0;
      for (let i = 0; i < 5000 && !(S.modal && S.modal.type === 'roundEnd'); i++) { await tick(); a.timer.advance(500); for (; seen < bubbles.length; seen++) at.push({ kind: bubbles[seen].kind, at: a.timer.clock }); const A = S.awaiting; if (A) step(a, A); }      // (half a second of the game's time for each action)
      const ordinary = at.filter(p => !G.CHAT.bypass[p.kind] && !String(p.kind).startsWith('slow'));
      ordinaryAll += ordinary.length; ordinary.forEach(p => kinds.add(p.kind));
      for (let i = 1; i < ordinary.length; i++) if (ordinary[i].at - ordinary[i - 1].at < G.CHAT.cooldownMs - 550) tooClose++;
    }
    ok(ordinaryAll >= 6 && tooClose === 0, `with the cooldown on, the ordinary remarks (${ordinaryAll} of them: ${[...kinds].join(', ')}) are at least ${COOL / 1000} seconds apart; only the rare kinds may come closer`);
    G.CHAT.cooldownMs = 0;
  }
  G.CHAT.cooldownMs = COOL;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
