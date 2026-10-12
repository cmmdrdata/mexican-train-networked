require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const failMsgs = {};
const ok = (c, m) => { if (c) pass++; else { fail++; failMsgs[m] = (failMsgs[m] || 0) + 1; if (failMsgs[m] === 1) console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SCRIPT = {
  ru: /^\p{Script=Cyrillic}$/u, ja: /^(\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}|\u30FC)$/u, zh: /^\p{Script=Han}$/u,
  ko: /^\p{Script=Hangul}$/u, hi: /^\p{Script=Devanagari}$/u, ar: /^\p{Script=Arabic}$/u,
};
const blocked = /\b(fuck\w*|shit\w*|bitch\w*|cunt|nigg\w*|fag\w*|retard\w*|whore|slut|bastard|dick|cock|piss\w*|damn\w*|hell|crap|ass|asshole|kill|die|suicide|stupid|idiot|moron|ugly|fat)\b/i;
const latinLine = /^[\p{Script=Latin}0-9 .,:;!?'\-]+$/u;

(async () => {
  console.log('1. the data: every player has a home country and dishes from it');
  const names = G.CPU_NAMES;
  ok(names.every(n => G.FOOD[n]), 'all 48 computer players have a home country and food');
  ok(Object.keys(G.FOOD).length === 48 && Object.keys(G.FOOD).every(n => names.includes(n)), 'and nobody else');
  ok(names.every(n => typeof G.FOOD[n].c === 'string' && G.FOOD[n].c.length >= 3 && Array.isArray(G.FOOD[n].d) && G.FOOD[n].d.length === 3 && G.FOOD[n].d.every(x => typeof x === 'string' && x.length >= 3)), 'a country and three dishes each');
  ok(names.every(n => G.FOOD[n].d.every(x => latinLine.test(x) && x.length <= 40)), 'dishes are written in Latin letters (with their proper accents) in English');
  // the native-language players also have the dishes in their own script, in the same order
  const natives = names.filter(n => G.nativeLangOf(n));
  ok(natives.length === 17 && natives.every(n => Array.isArray(G.FOOD[n].n) && G.FOOD[n].n.length === 3), 'every player who speaks a native language has the dishes in it too');
  ok(names.filter(n => !G.nativeLangOf(n)).every(n => !G.FOOD[n].n), 'and nobody else does');
  const bad = natives.filter(n => G.FOOD[n].n.some(x => [...x].some(ch => /\p{L}/u.test(ch) && !SCRIPT[G.nativeLangOf(n)].test(ch))));
  ok(bad.length === 0, 'the native dishes use only their own alphabet' + (bad[0] ? ': ' + bad[0] : ''));
  // "specific to their country": no dish belongs to two countries
  const owner = {}; let shared = [];
  names.forEach(n => G.FOOD[n].d.forEach(d => { const k = d.toLowerCase(); if (owner[k] && owner[k] !== G.FOOD[n].c) shared.push(`${d} (${owner[k]} / ${G.FOOD[n].c})`); owner[k] = G.FOOD[n].c; }));
  ok(shared.length === 0, 'no dish is claimed by two countries' + (shared[0] ? ': ' + shared[0] : ''));
  const countries = new Set(names.map(n => G.FOOD[n].c));
  ok(countries.size >= 28, `${countries.size} different home countries`);
  ok(G.FOOD.Dmitri.c === 'Russia' && G.FOOD.Dmitri.d.includes('borscht') && G.FOOD.Dmitri.n[0] === 'борщ', 'Dmitri: Russia, borscht (борщ)');
  ok(G.FOOD.Keiko.c === 'Japan' && G.FOOD.Pablo.c === 'Argentina' && G.FOOD.Selam.d[0].includes('injera') && G.FOOD.Amara.d.includes('jollof rice'), 'Keiko is Japanese, Pablo Argentinian, Selam Ethiopian (injera), Amara Nigerian (jollof)');
  // players with the same name-language but different homes eat differently (not all "Arabic" food is one dish)
  ok(new Set(['Omar', 'Aisha', 'Zainab', 'Tariq', 'Noor'].map(n => G.FOOD[n].c)).size === 5, 'the five Arabic speakers come from five different countries, with their own dishes');

  console.log('2. the lines');
  ok(G.FOOD_ENGLISH.length === 3 && G.FOOD_ENGLISH.every(t => t.length >= 4), 'English: four or more lines for each stage (peckish, going, back)');
  ok(G.FOOD_ENGLISH.flat().every(t => /\{dish\}/.test(t) && !/[<>&"]/.test(t)), 'every English line mentions the dish');
  ok(G.FOOD_ENGLISH.flat().some(t => /\{country\}/.test(t)), 'some mention the country');
  ok(['ru', 'ja', 'zh', 'ko', 'hi', 'ar'].every(l => G.FOOD_NATIVE[l] && G.FOOD_NATIVE[l].length === 3 && G.FOOD_NATIVE[l].every(p => p.length === 2 && /\{dish\}/.test(p[0]) && /\{dish\}/.test(p[1]))), 'six languages, three stages each, line and translation both carry the dish');
  for (const l of Object.keys(G.FOOD_NATIVE)) {
    const wrong = G.FOOD_NATIVE[l].flatMap(p => [...p[0].replace('{dish}', '')].filter(ch => /\p{L}/u.test(ch) && !SCRIPT[l].test(ch)));
    ok(wrong.length === 0, `${l}: the native line is entirely in its own script`);
  }
  // render everything every player could say, and check it
  let rendered = 0, longest = 0, problems = [];
  for (const n of names) for (let tier = 1; tier <= 3; tier++) for (const nc of [0, 1]) for (let r = 0; r < 12; r++) {
    const rr = mulberry32(n.length * 100 + tier * 10 + r);
    const out = G.foodComment(n, tier, rr, nc, null);
    rendered++;
    const all = out.trans ? out.trans : out.text;
    longest = Math.max(longest, out.text.length);
    if (/\{\w+\}/.test(out.text) || (out.trans && /\{\w+\}/.test(out.trans))) problems.push(`placeholder left in ${n}: ${out.text}`);
    if (!out.lang && !latinLine.test(out.text)) problems.push(`odd English: ${out.text}`);
    if (out.lang && !(out.trans && /^[\p{Script=Latin}0-9 .,:;!?'\-]+$/u.test(out.trans))) problems.push(`odd translation: ${out.trans}`);
    if (blocked.test(all)) problems.push(`blocked: ${all}`);
    if (out.text.length > 120) problems.push(`too long: ${out.text}`);
    if (out.lang && out.lang !== G.nativeLangOf(n)) problems.push(`wrong language for ${n}`);
    if (!out.lang && !G.FOOD[n].d.some(d => out.text.includes(d))) problems.push(`no dish in ${n}: ${out.text}`);
    if (out.lang && !G.FOOD[n].n.some(d => out.text.includes(d))) problems.push(`no native dish in ${n}: ${out.text}`);
    if (out.lang && !G.FOOD[n].d.some(d => out.trans.includes(d))) problems.push(`translation lacks the dish for ${n}: ${out.trans}`);
    if (out.text.includes(G.FOOD[n].c) === false && /\{country\}/.test('') ) problems.push('x');
  }
  ok(problems.length === 0, `${rendered} possible remarks all render cleanly` + (problems[0] ? ': ' + problems[0] : ''));
  ok(longest <= 120, 'and none is long');
  // the country actually appears when a line asks for it
  const gotCountry = names.some(n => { for (let r = 0; r < 60; r++) { const o = G.foodComment(n, 2, mulberry32(r), 0, null); if (o.text.includes(G.FOOD[n].c)) return true; } return false; });
  ok(gotCountry, 'the home country is named in some of them');
  // players without native lines are never given a native one; chance 0 means English
  ok(['Pablo', 'Ingrid', 'Selam', 'Kofi'].every(n => { for (let r = 0; r < 40; r++) if (G.foodComment(n, 1, mulberry32(r), 1, null).lang) return false; return true; }), 'a Latin-script player never switches language, even with the chance at one');
  ok(natives.every(n => { for (let r = 0; r < 40; r++) if (G.foodComment(n, 1, mulberry32(r), 0, null).lang) return false; return true; }) && natives.every(n => G.foodComment(n, 1, mulberry32(3), 1, null).lang === G.nativeLangOf(n)), 'with the native chance at zero they use English; at one, always their language');
  ok(G.foodComment('Nobody', 1, Math.random, 0, null) === null, 'an unknown player says nothing about food');
  // the three stages say different things
  const stage = t => new Set(Array.from({ length: 40 }, (_, r) => G.foodComment('Marta', t, mulberry32(r), 0, null).text.replace(/pierogi|bigos|kielbasa|Poland/g, 'X')));
  ok([...stage(1)].every(t => !stage(2).has(t) && !stage(3).has(t)) && [...stage(2)].every(t => !stage(3).has(t)), 'peckish, going and back are three different sets of lines');
  // never the same line twice in a row
  let reps = 0, last = null;
  for (let r = 0; r < 500; r++) { const o = G.foodComment('Dmitri', 1 + (r % 3), mulberry32(r), 0.5, last); if (o.text === last) reps++; last = o.text; }
  ok(reps === 0, 'it avoids repeating the line it just said');

  // the dish is chosen once and kept: the one it goes for is the one it comes back with
  ok(natives.concat(names.slice(0, 20)).every(n => { for (let r = 0; r < 20; r++) { const a = G.foodComment(n, 2, mulberry32(r), 0, null); const b = G.foodComment(n, 3, mulberry32(r + 99), 0, null, a.dish); if (!b.text.includes(G.FOOD[n].d[a.dish])) return false; } return true; }), 'given the dish it chose earlier, the later stages use the same one');
  ok(G.foodComment('Marta', 1, mulberry32(1), 0, null, 2).text.includes('kielbasa') && G.foodComment('Dmitri', 1, mulberry32(1), 1, null, 1).text.includes('пельмени') && G.foodComment('Dmitri', 3, mulberry32(1), 1, null, 1).trans.includes('pelmeni'), 'a chosen dish carries over into the native language and its translation too');
  ok(G.foodComment('Marta', 2, mulberry32(1), 0, null, 99).dish < 3, 'a nonsense dish number is ignored');
  ok(!G.FOOD_ENGLISH.flat().some(t => /\bit\b/i.test(t) && /finished it|gone now\./.test(t)), 'no "finished it" after a plural dish');

  console.log('3. in a game (fake clock)');
  function fakeTimer() {
    let id = 0, clock = 0; const q = [];
    return { set(fn, ms) { q.push({ id: ++id, fn, at: clock + ms }); return id; }, clear(i) { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); },
      advance(ms) { const end = clock + ms; for (;;) { q.sort((a, b) => a.at - b.at); const nx = q[0]; if (!nx || nx.at > end) break; q.shift(); clock = nx.at; nx.fn(); } clock = end; }, get clock() { return clock; } };
  }
  function makeApp(seed, nativeChance, foodChance, rngFn) {
    const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const store = {}, timer = fakeTimer(), ctl = { rng: 0.5 };
    const app = G.createApp({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, chatRng: rngFn || (() => ctl.rng), nativeChance, foodChance, timer, now: () => 1e6 + timer.clock,
      storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
    return { app, root, timer, ctl, S: app.state };
  }
  async function atMovePrompt(a, level) {
    a.app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips', level: level || 'normal' });
    for (let g = 0; g < 4000; g++) {
      await tick(); const A = a.S.awaiting; if (!A) continue;
      if (A.kind === 'move') return A;
      if (A.kind === 'draw') a.app.dispatch({ type: 'draw' });
      else if (A.kind === 'modal') a.app.dispatch({ type: 'dialogOk' });
      else if (A.kind === 'build') { if (A.canDraw) a.app.dispatch({ type: 'draw' }); else if (A.canBuild) a.app.dispatch({ type: 'autoBuild' }); else if (A.canDone) a.app.dispatch({ type: 'endBuild' }); else a.app.dispatch({ type: 'undoTile' }); }
    }
    return null;
  }
  const bubbleOf = h => { const m = h.match(/<div class="bubble( native)?"><b>([^<]*)<\/b><span(?: lang="(\w+)")?(?: dir="rtl")?>([^<]*)<\/span>(?:<small class="trans" lang="en">([^<]*)<\/small>)?<\/div>/); return m ? { native: !!m[1], who: m[2], lang: m[3], text: m[4], trans: m[5] } : null; };
  const unesc = t => t.replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const standard = new Set(Object.values(G.LINES).flatMap(L => [...L.slow1, ...L.slow2, ...L.slow3]));
  const nativeSlow = new Set(Object.values(G.NATIVE_LINES).flatMap(L => L.slow.map(p => p[0])));

  // every player, all three stages, hungry for certain
  for (const name of names) {
    const a = makeApp(4, 0, 1); await atMovePrompt(a, G.levelOfName(name)); a.S.cpuName = name;
    const seen = [];
    a.timer.advance(G.CHAT.slowAfterMs); seen.push(bubbleOf(a.root.innerHTML));
    a.timer.advance(23000); seen.push(bubbleOf(a.root.innerHTML));
    a.timer.advance(23000); seen.push(bubbleOf(a.root.innerHTML));
    ok(seen.every(Boolean) && seen.every(b => !b.native && G.FOOD[name].d.some(d => unesc(b.text).includes(d))), `${name}: all three jabs are about ${G.FOOD[name].c} food (${seen[0] && unesc(seen[0].text)})`);
    ok(seen.every(b => b && !standard.has(unesc(b.text))), `${name}: and none is an ordinary slow line`);
    const dishesUsed = new Set(seen.map(b => G.FOOD[name].d.findIndex(d => unesc(b.text).includes(d))));
    ok(dishesUsed.size === 1 && !dishesUsed.has(-1), `${name}: the same dish through the whole wait (${[...dishesUsed].map(i => G.FOOD[name].d[i]).join(', ')})`);
  }
  // in their own language, with a translation
  for (const name of natives) {
    const a = makeApp(4, 1, 1); await atMovePrompt(a, G.levelOfName(name)); a.S.cpuName = name;
    a.timer.advance(G.CHAT.slowAfterMs);
    const b = bubbleOf(a.root.innerHTML);
    ok(b && b.native && b.lang === G.nativeLangOf(name) && G.FOOD[name].n.some(d => unesc(b.text).includes(d)) && G.FOOD[name].d.some(d => unesc(b.trans).includes(d)), `${name}: hungry in ${G.nativeLangOf(name)}, the dish in its own script, with an English translation: ${b && unesc(b.text)} / ${b && unesc(b.trans)}`);
  }
  {
    // chance zero: never about food
    const a = makeApp(4, 0, 0); await atMovePrompt(a, 'hard'); a.S.cpuName = 'Dmitri';
    a.timer.advance(G.CHAT.slowAfterMs);
    const b = bubbleOf(a.root.innerHTML);
    ok(b && standard.has(unesc(b.text)), 'with the food chance at zero, the jab is an ordinary one');
    // only slow jabs are hungry: a reaction to a move is not
    const A = await atMovePrompt(a, 'normal'); a.S.cpuName = 'Marta';
    const rated = A.moves.map(m => ({ m, r: E.rateMove(a.S.game, a.S.game.players[0], A.moves, m) }));
    a.ctl.rng = 0; a.app.dispatch({ type: 'selectTile', key: key(A.moves[0].tile) }); if (a.S.awaiting === A) a.app.dispatch({ type: 'playOn', train: A.moves[0].trainId });
    for (let i = 0; i < 20; i++) await tick();
  }
  {
    const a = makeApp(4, 0, 1); await atMovePrompt(a, 'normal'); a.S.cpuName = 'Marta';
    a.ctl.rng = 0;
    const A = a.S.awaiting;
    a.app.dispatch({ type: 'selectTile', key: key(A.moves[0].tile) }); if (a.S.awaiting === A) a.app.dispatch({ type: 'playOn', train: A.moves[0].trainId });
    for (let i = 0; i < 20; i++) await tick();
    a.timer.advance(1200);
    const b = bubbleOf(a.root.innerHTML);
    ok(!b || !G.FOOD.Marta.d.some(d => unesc(b.text).includes(d)), 'a reaction to your move is never about food, even with the food chance at one (' + (b ? unesc(b.text) : 'no comment') + ')');
  }
  {
    // "may mention": about two in five slow jabs, over many
    const rr = mulberry32(21);
    const a = makeApp(4, 0, G.CHAT.foodChance, () => rr()); await atMovePrompt(a, 'normal'); a.S.cpuName = 'Marta';
    let food = 0, total = 0, lastId = null;
    for (let i = 0; i < 9000 && total < 300; i++) {
      a.timer.advance(1000);
      const cm = a.S.comment;
      if (cm && cm.id !== lastId) { lastId = cm.id; total++; if (G.FOOD.Marta.d.some(d => cm.text.includes(d))) food++; }
    }
    const share = food / total;
    ok(total >= 300 && Math.abs(share - G.CHAT.foodChance) < 0.08, `about ${Math.round(G.CHAT.foodChance * 100)}% of slow jabs are about food (${(100 * share).toFixed(0)}% of ${total})`);
    ok(food > 60 && total - food > 100, 'both hungry and ordinary jabs occur');
  }
  {
    // together with the native chance: Dmitri's mix
    const rr = mulberry32(8);
    const a = makeApp(4, G.CHAT.nativeChance, G.CHAT.foodChance, () => rr()); await atMovePrompt(a, 'hard'); a.S.cpuName = 'Dmitri';
    const kinds = { foodRu: 0, foodEn: 0, otherRu: 0, otherEn: 0 }; let total = 0, lastId = null;
    for (let i = 0; i < 12000 && total < 400; i++) {
      a.timer.advance(1000);
      const cm = a.S.comment;
      if (cm && cm.id !== lastId) { lastId = cm.id; total++; const isFood = G.FOOD.Dmitri.d.some(d => (cm.trans || cm.text).includes(d)); kinds[(isFood ? 'food' : 'other') + (cm.lang ? 'Ru' : 'En')]++; }
    }
    ok(Object.values(kinds).every(v => v > 15), `Dmitri mixes all four: hungry or not, Russian or English (${JSON.stringify(kinds)})`);
  }
  {
    // the page: a hungry remark in a native script shows the translation beneath
    const a = makeApp(4, 1, 1); await atMovePrompt(a, 'hard'); a.S.cpuName = 'Dmitri';
    a.timer.advance(G.CHAT.slowAfterMs);
    ok(/<div class="bubble native"><b>Dmitri<\/b><span lang="ru">[^<]*(борщ|пельмени|блины)[^<]*<\/span><small class="trans" lang="en">[^<]*(borscht|pelmeni|blini)[^<]*<\/small>/.test(a.root.innerHTML), 'Dmitri\'s hungry remark is in Russian with the translation underneath');
    const b = makeApp(4, 0, 1); await atMovePrompt(b, 'hard'); b.S.cpuName = 'Ingrid';
    b.timer.advance(G.CHAT.slowAfterMs);
    ok(/<div class="bubble"><b>Ingrid<\/b><span>[^<]*(smørrebrød|frikadeller|Danish pastries)[^<]*<\/span><\/div>/.test(b.root.innerHTML), 'Ingrid\'s is plain English, with the accents on her Danish dishes');
  }

  {
    // a new wait, a new craving: over many turns it does not always want the same thing
    const rr = mulberry32(77);
    const a = makeApp(6, 0, 1, () => rr()); await atMovePrompt(a, 'normal'); a.S.cpuName = 'Marta';
    const dishes = []; let waits = 0;
    for (let g = 0; g < 8000 && waits < 40; g++) {
      await tick();
      const A = a.S.awaiting; if (!A) continue;
      if (a.S.modal && a.S.modal.type === 'final') break;
      if (A.kind === 'move') {
        a.timer.advance(G.CHAT.slowAfterMs);                         // you dither: it gets hungry
        const b = bubbleOf(a.root.innerHTML);
        if (b) { const i = G.FOOD.Marta.d.findIndex(d => unesc(b.text).includes(d)); if (i >= 0) { dishes.push(i); waits++; } }
        const m = A.moves[0]; a.app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (a.S.awaiting === A) a.app.dispatch({ type: 'playOn', train: m.trainId });
      } else if (A.kind === 'draw') a.app.dispatch({ type: 'draw' });
      else if (A.kind === 'modal') a.app.dispatch({ type: 'dialogOk' });
      else if (A.kind === 'build') { if (A.canDraw) a.app.dispatch({ type: 'draw' }); else if (A.canBuild) a.app.dispatch({ type: 'autoBuild' }); else if (A.canDone) a.app.dispatch({ type: 'endBuild' }); else a.app.dispatch({ type: 'undoTile' }); }
    }
    ok(waits >= 30 && new Set(dishes).size === 3, `over ${waits} separate waits it went for each of its three dishes (${[0, 1, 2].map(i => dishes.filter(x => x === i).length).join(' / ')})`);
  }

  Object.keys(failMsgs).forEach(m => failMsgs[m] > 1 && console.log(`  (x${failMsgs[m]}) ${m}`));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
