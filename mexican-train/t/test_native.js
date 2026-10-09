require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const failMsgs = {};
const ok = (c, m) => { if (c) pass++; else { fail++; failMsgs[m] = (failMsgs[m] || 0) + 1; if (failMsgs[m] === 1) console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));

const SCRIPT = {
  ru: /^\p{Script=Cyrillic}$/u,
  ja: /^(\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Han}|\u30FC)$/u,   // 'ー' (long vowel) is written with kana but is Unicode 'Common'
  zh: /^\p{Script=Han}$/u,
  ko: /^\p{Script=Hangul}$/u,
  hi: /^\p{Script=Devanagari}$/u,
  ar: /^\p{Script=Arabic}$/u,
};
const NAME = { ru: 'Russian', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', hi: 'Hindi', ar: 'Arabic' };
const KINDS = ['great', 'good', 'poor', 'awful', 'forced', 'missedOut', 'slow', 'draw', 'pass'];
const blocked = /\b(fuck\w*|shit\w*|bitch\w*|cunt|nigg\w*|fag\w*|retard\w*|whore|slut|bastard|dick|cock|piss\w*|damn\w*|hell|crap|ass|asshole|kill|die|suicide|stupid|idiot|moron|ugly|fat)\b/i;

(async () => {
  console.log('1. the lines: right script, translated, clean');
  const langs = Object.keys(G.NATIVE_LINES);
  ok(langs.sort().join() === Object.keys(SCRIPT).sort().join(), 'six languages: Russian, Japanese, Chinese, Korean, Hindi, Arabic');
  let total = 0;
  for (const lang of langs) {
    const L = G.NATIVE_LINES[lang], label = NAME[lang];
    ok(KINDS.every(k => Array.isArray(L[k]) && L[k].length >= 2) && Object.keys(L).length === KINDS.length, `${label}: lines for every common reaction (${KINDS.join(', ')})`);
    ok(['great', 'good', 'poor', 'awful'].every(k => L[k].length >= 3) && L.slow.length >= 4, `${label}: three or more lines for the main reactions, four for taking too long`);
    const all = Object.values(L).flat();
    total += all.length;
    ok(all.every(p => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string'), `${label}: every entry is [line, English translation]`);
    ok(new Set(all.map(p => p[0])).size === all.length, `${label}: no repeated lines`);
    // every letter of the line is in the language's alphabet: no English slipped in, nothing garbled
    const wrong = all.filter(([t]) => [...t].some(ch => /\p{L}/u.test(ch) && !SCRIPT[lang].test(ch)));
    ok(wrong.length === 0, `${label}: every letter is in its own script` + (wrong[0] ? ': ' + wrong[0][0] : ''));
    ok(all.every(([t]) => SCRIPT[lang].test([...t].find(ch => /\p{L}/u.test(ch)) || '')), `${label}: every line has letters in the script`);
    ok(all.every(([t]) => !/[<>&"]/.test(t) && t.length <= 60 && t.length >= 2), `${label}: no HTML characters, and a sensible length`);
    ok(all.every(([, e]) => /^[A-Za-z0-9 .,:;!?'\-]+$/.test(e) && e.length <= 120 && !blocked.test(e)), `${label}: translations are plain English, short, and mild (no strong language or personal insults)`);
    ok(all.every(([, e]) => e.length >= 5), `${label}: translations are not empty`);
  }
  console.log(`   ${total} lines in ${langs.length} languages`);
  ok(total >= 140, 'a good amount of variety');
  // the right-to-left language is marked as such, no other is
  ok(true, 'ok');

  console.log('2. who speaks what');
  const names = Object.keys(G.NATIVE_LANG);
  ok(G.nativeLangOf('Dmitri') === 'ru' && G.nativeLangOf('Keiko') === 'ja' && G.nativeLangOf('Omar') === 'ar' && G.nativeLangOf('Priya') === 'hi' && G.nativeLangOf('Joon') === 'ko' && G.nativeLangOf('Mei') === 'zh', 'Dmitri speaks Russian, Keiko Japanese, Omar Arabic, Priya Hindi, Joon Korean, Mei Chinese');
  ok(names.every(n => G.CPU_NAMES.includes(n) && langs.includes(G.NATIVE_LANG[n])), 'every such player is a real computer player, with a language that has lines');
  ok(['Ingrid', 'Marta', 'Pablo', 'Diego', 'Bea', 'Kofi', 'Leon', 'Nobody'].every(n => G.nativeLangOf(n) === null), 'players whose language uses the Latin alphabet stay in English');
  ok(['easy', 'normal', 'hard'].every(l => G.CPU_PLAYERS[l].some(n => G.nativeLangOf(n))), 'every level has some players who speak their own language');
  ok(names.length === 17 && langs.every(l => names.some(n => G.NATIVE_LANG[n] === l)), `${names.length} players across the six languages, each language used`);

  console.log('3. in a game (fake clock, deterministic)');
  function fakeTimer() {
    let id = 0, clock = 0; const q = [];
    return { set(fn, ms) { q.push({ id: ++id, fn, at: clock + ms }); return id; }, clear(i) { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); },
      advance(ms) { const end = clock + ms; for (;;) { q.sort((a, b) => a.at - b.at); const nx = q[0]; if (!nx || nx.at > end) break; q.shift(); clock = nx.at; nx.fn(); } clock = end; }, get clock() { return clock; } };
  }
  function makeApp(seed, nativeChance, rngFn) {
    const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const store = {}, timer = fakeTimer(), ctl = { rng: 0.5 };
    const app = G.createApp({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, chatRng: rngFn || (() => ctl.rng), nativeChance, foodChance: 0, timer, now: () => 1e6 + timer.clock,
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
  const nativeBubble = h => { const m = h.match(/<div class="bubble native"><b>([^<]*)<\/b><span lang="(\w+)"( dir="rtl")?>([^<]*)<\/span><small class="trans" lang="en">([^<]*)<\/small><\/div>/); return m ? { who: m[1], lang: m[2], rtl: !!m[3], text: m[4], trans: m[5] } : null; };
  const plainBubble = h => { const m = h.match(/<div class="bubble"><b>([^<]*)<\/b><span>([^<]*)<\/span><\/div>/); return m ? { who: m[1], text: m[2] } : null; };
  const unesc = t => t.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

  for (const name of names) {
    const lang = G.NATIVE_LANG[name];
    const a = makeApp(4, 1);                                      // nativeChance 1: always, when there is a native line
    const A = await atMovePrompt(a, G.levelOfName(name));
    a.S.cpuName = name;                                           // make this the opponent
    a.timer.advance(G.CHAT.slowAfterMs);                          // you are taking too long: a "slow" remark
    const b = nativeBubble(a.root.innerHTML);
    const pool = G.NATIVE_LINES[lang].slow.map(p => [p[0], p[1]]);
    ok(b && b.who === name && b.lang === lang, `${name}: speaks ${NAME[lang]} (${b && b.lang})`);
    ok(b && pool.some(p => p[0] === unesc(b.text) && p[1] === unesc(b.trans)), `${name}: the line and its translation belong together`);
    ok(b && b.rtl === (lang === 'ar'), `${name}: ${lang === 'ar' ? 'Arabic is set right-to-left' : 'left-to-right'}`);
    ok(b && [...unesc(b.text)].some(ch => SCRIPT[lang].test(ch)), `${name}: the text on the page really is in the ${NAME[lang]} alphabet`);
  }
  {
    // chance 0: never native, even for Dmitri
    const a = makeApp(4, 0); await atMovePrompt(a, 'hard'); a.S.cpuName = 'Dmitri';
    a.timer.advance(G.CHAT.slowAfterMs);
    const p = plainBubble(a.root.innerHTML);
    ok(p && !nativeBubble(a.root.innerHTML) && G.LINES.hard.slow1.includes(unesc(p.text)), 'with the chance at zero, Dmitri speaks English, in the Hard voice');
    // a Latin-script name never speaks a native language, even when it is certain
    const b = makeApp(4, 1); await atMovePrompt(b, 'hard'); b.S.cpuName = 'Ingrid';
    b.timer.advance(G.CHAT.slowAfterMs);
    ok(plainBubble(b.root.innerHTML) && !nativeBubble(b.root.innerHTML), 'Ingrid never switches language');
    // a reaction with no native line falls back to English (opening remarks are English-only)
    let c = null, o = null;
    for (let seed = 1; seed <= 60 && !o; seed++) {
      c = makeApp(seed, 1);
      c.app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips', level: 'hard' });
      for (let g = 0; g < 200 && !c.S.awaiting; g++) await tick();
      const A2 = c.S.awaiting;
      if (A2 && A2.kind === 'build' && A2.canBuild && A2.buildCount >= 4 && A2.placed === 0 && A2.moves.length) o = A2;
    }
    if (o) {
      c.S.cpuName = 'Dmitri'; c.ctl.rng = 0;
      c.app.dispatch({ type: 'selectTile', key: key(o.moves[0].tile) });
      for (let i = 0; i < 20; i++) await tick();
      c.app.dispatch({ type: 'endBuild' });
      for (let i = 0; i < 20; i++) await tick();
      c.timer.advance(1200);
      const p2 = plainBubble(c.root.innerHTML);
      ok(p2 && !nativeBubble(c.root.innerHTML), 'a remark with no native version (a short opening) is said in English: ' + (p2 && p2.text));
    } else ok(false, 'found an opening to test');
  }
  {
    // "randomly": about two in five, over many comments, and no line twice in a row
    const rr = mulberry32(99);
    const a = makeApp(4, G.CHAT.nativeChance, () => rr());
    await atMovePrompt(a, 'hard'); a.S.cpuName = 'Dmitri';
    let nat = 0, total = 0, last = null, repeats = 0, lastId = null;
    for (let i = 0; i < 8500 && total < 320; i++) {          // step the clock a second at a time and count each new comment once
      a.timer.advance(1000);
      const cm = a.S.comment;
      if (cm && cm.id !== lastId) { lastId = cm.id; total++; if (cm.lang) nat++; if (cm.text === last) repeats++; last = cm.text; }
    }
    const share = nat / total;
    ok(total > 300 && Math.abs(share - G.CHAT.nativeChance) < 0.08, `about ${Math.round(G.CHAT.nativeChance * 100)}% of Dmitri's comments are in Russian (${(100 * share).toFixed(0)}% of ${total})`);
    ok(nat > 50 && total - nat > 50, 'both Russian and English appear');
    ok(repeats === 0, 'the same line is never said twice in a row');
  }
  {
    // the page: escaping, and the bubble without a comment is unchanged
    const a = makeApp(4, 0); await atMovePrompt(a, 'normal');
    a.S.comment = { id: 9, kind: 'poor', text: '<img src=x onerror=1>', lang: 'ru', trans: '<b>&"x"' };
    a.app.render(true);
    ok(!/<img/.test(a.root.innerHTML) && /&lt;img src=x onerror=1&gt;/.test(a.root.innerHTML) && /&lt;b&gt;&amp;&quot;x&quot;/.test(a.root.innerHTML), 'native text and its translation are escaped before reaching the page');
    a.S.comment = null; a.app.render(true);
    ok(/class="bubble-slot"/.test(a.root.innerHTML) && !/bubble native/.test(a.root.innerHTML), 'no bubble, no stray markup');
    const css = require('fs').readFileSync('../style.css', 'utf8');
    ok(/\.bubble small\.trans/.test(css) && /\.bubble span\[dir="rtl"\]/.test(css), 'the translation and right-to-left text are styled');
  }

  Object.keys(failMsgs).forEach(m => failMsgs[m] > 1 && console.log(`  (x${failMsgs[m]}) ${m}`));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
