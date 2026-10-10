require('./game.js');
const G = globalThis.MexicanTrainGame;
const { mulberry32 } = G.Engine;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
// British spellings that should read the American way for a player in Texas
const BRITISH = /\b(colours?|coloured|colourful|favourites?|greys?|greyed|neighbours?|honours?|behaviours?|organis\w+|recognis\w+|realis\w+|analys(e|ed|es|ing)|apologis\w+|catalogues?|programmes?|centres?|whilst|amongst|learnt|spelt|dreamt|practise[sd]?|licen[cs]e[sd]?|judgement|ageing|cosy|mould|storeys?|theatres?|metres?|litres?|fibres?|defences?|offences?|flavours?|humours?|rumours?|armours?|labours?|harbours?|tumours?)\b/i;
const bad = (label, s) => { const m = String(s).match(BRITISH); if (m) { ok(false, `${label}: "${m[0]}" in "${String(s).slice(0, 80)}"`); return 1; } return 0; };

(async () => {
  console.log('the scanner itself');
  ok(['Coloured pips', 'Your favourite.', 'the grey tile', 'centre of the board', 'a neighbour', 'colour-coded'].every(s => BRITISH.test(s)), 'it flags British spellings (coloured, favourite, grey, centre/neighbour/colour...)');
  ok(['Colored pips', 'Your favorite.', 'the gray tile', 'a neighbor', 'color-coded', 'Large numbers', 'Hello, are you still there?'].every(s => !BRITISH.test(s)), 'and accepts the American ones, and ordinary text');
  console.log('everything the player can read, in American spelling');
  let checked = 0, found = 0;
  // 1. the computer's lines, every level
  for (const [lvl, L] of Object.entries(G.LINES)) for (const [k, arr] of Object.entries(L)) arr.forEach(l => { checked++; found += bad(`LINES.${lvl}.${k}`, l); });
  // 2. the translations that go with the native-language lines, and the food lines
  for (const [lang, L] of Object.entries(G.NATIVE_LINES)) for (const [k, arr] of Object.entries(L)) arr.forEach(([, en]) => { checked++; found += bad(`NATIVE.${lang}.${k}`, en); });
  G.FOOD_ENGLISH.flat().forEach(l => { checked++; found += bad('FOOD_ENGLISH', l); });
  for (const L of Object.values(G.FOOD_NATIVE)) L.forEach(([, en]) => { checked++; found += bad('FOOD_NATIVE', en); });
  for (const [n, f] of Object.entries(G.FOOD)) { checked++; found += bad('FOOD.' + n, f.c + ' ' + f.d.join(' ')); }
  ok(checked > 400 && found === 0, `${checked} lines of the computer's chatter: no British spellings`);

  // 3. every screen and dialog of the real game
  const screens = [];
  const root = { _h: '', set innerHTML(v) { this._h = v; screens.push(v); }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {};
  const app = G.createApp({ root, rng: mulberry32(9), sleep: async () => {}, reducedMotion: true, now: () => 1, chatRng: () => 0, nativeChance: 0, foodChance: 0.5, timer: { set() { return 0; }, clear() {} }, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
  app.dispatch({ type: 'newGame' }); app.dispatch({ type: 'openRules' }); app.dispatch({ type: 'closeOverlay' });
  app.dispatch({ type: 'startGame', rounds: 4, hand: 15, style: 'pips', level: 'normal' });
  for (let g = 0; g < 3000 && !(app.state.modal && app.state.modal.type === 'roundEnd'); g++) {
    await tick(); const A = app.state.awaiting; if (!A) continue;
    if (A.kind === 'draw') app.dispatch({ type: 'draw' });
    else if (A.kind === 'modal') app.dispatch({ type: 'dialogOk' });
    else if (A.kind === 'build') { if (A.canDraw) app.dispatch({ type: 'draw' }); else if (A.canBuild) app.dispatch({ type: 'autoBuild' }); else if (A.canDone) app.dispatch({ type: 'endBuild' }); else app.dispatch({ type: 'undoTile' }); }
    else { const m = A.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile.join('-') }); if (app.state.awaiting === A) app.dispatch({ type: 'playOn', train: m.trainId }); }
  }
  app.dispatch({ type: 'openRules' }); app.dispatch({ type: 'newGame' });
  const text = html => html.replace(/<[^>]*>/g, ' ');
  let screenHits = 0;
  new Set(screens.map(text)).forEach(t => { const m = t.match(BRITISH); if (m) { screenHits++; ok(false, `a screen says "${m[0]}"`); } });
  ok(screens.length > 20 && screenHits === 0, `${screens.length} screens and dialogs (setup, rules, play, round end): no British spellings`);

  // 4. the setup label says what it should
  {
    const r2 = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const st2 = {};
    const fresh = G.createApp({ root: r2, rng: mulberry32(1), sleep: async () => {}, reducedMotion: true, now: () => 1, timer: { set() { return 0; }, clear() {} }, storage: { get: k => (k in st2 ? st2[k] : null), set: (k, v) => { st2[k] = v; } } });
    fresh.dispatch({ type: 'newGame' });
    ok(!/Tile faces|opt-style|<option[^>]*>(Colored|Coloured) pips/.test(r2.innerHTML) && !/Coloured/i.test(r2.innerHTML) && /How to play/.test(r2.innerHTML), 'the setup dialog has no tile-style choice any more (it is the Show numbers button in the game), and nothing in it is spelled the British way');
  }
  // 5. and the built page as a whole (the text a person could ever see, not the code comments)
  const page = require('fs').readFileSync('../mexican-train.html', 'utf8');
  const strings = [...page.matchAll(/'([^'\n]{6,}?)'|`([^`\n]{6,}?)`/g)].map(m => m[1] || m[2]).filter(s => /[a-z]{3,} [a-z]{3,}/i.test(s));
  const hits = strings.filter(s => BRITISH.test(s));
  ok(hits.length === 0, `${strings.length} text strings in the built page: none with British spellings` + (hits[0] ? ' (' + hits[0] + ')' : ''));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
