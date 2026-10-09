// The Lord of the Rings theme: its cast, their voices and food, the setting, and whole games played with it.
require('./game.js');
const G = globalThis.MexicanTrainGame;
const { mulberry32 } = G.Engine;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const unesc = s => String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const T = G.THEMES.lotr;
const LEVELS = ['easy', 'normal', 'hard'];
const cast = [].concat(...LEVELS.map(l => T.players[l]));
const KINDS = Object.keys(G.LINES.normal);

(async () => {
  console.log('the cast');
  ok(G.THEME_IDS.join() === 'classic,lotr', 'two themes: classic and The Lord of the Rings');
  ok(LEVELS.every(l => T.players[l].length >= 4), 'at least four characters per level (so two computers of one level still get different ones)');
  ok(new Set(cast).size === cast.length, 'nobody plays at two levels');
  ok(cast.every(n => !G.CPU_NAMES.includes(n)), 'no character shares a name with a classic player');
  ok(cast.every(n => !G.nativeLangOf(n)), 'no character is mistaken for a native-language speaker');
  ok(T.players.easy.includes('Pippin') && T.players.easy.includes('Gollum') && T.players.normal.includes('Sam') && T.players.hard.includes('Gandalf'), 'Pippin and Gollum are Easy, Sam Medium, Gandalf Hard');
  ok(Object.keys(T.voices).sort().join() === cast.slice().sort().join() && Object.keys(T.food).sort().join() === cast.slice().sort().join(), 'every character has a voice and food, and nobody else does');

  console.log('their voices');
  const blocked = /\b(fuck\w*|shit\w*|bitch\w*|cunt|nigg\w*|fag\w*|retard\w*|whore|slut|bastard|dick|cock|piss\w*|damn\w*|hell|crap|ass|asshole|kill|die|suicide|stupid|idiot|moron|ugly|fat)\b/i;
  const BRITISH = /\b(colours?|coloured|favourites?|greys?|neighbours?|honours?|behaviours?|organis\w+|realis\w+|centres?|whilst|amongst|learnt|spelt|practise[sd]?|judgement|armours?|flavours?|humours?)\b/i;
  const all = [];
  cast.forEach(n => KINDS.forEach(k => (T.voices[n][k] || []).forEach(l => all.push([n, k, l]))));
  ok(cast.every(n => KINDS.every(k => Array.isArray(T.voices[n][k]) && T.voices[n][k].length >= 2)), `every character has at least two lines for each of the ${KINDS.length} kinds of comment`);
  ok(cast.every(n => Object.keys(T.voices[n]).every(k => KINDS.includes(k))), 'and no kind the game does not use');
  ok(all.every(([, , l]) => typeof l === 'string' && l.length >= 4 && l.length <= 110), `${all.length} lines, each short enough for a speech bubble`);
  ok(all.every(([, k, l]) => k === 'openShort' || !/\{/.test(l)), 'only the short-opening lines have placeholders');
  ok(all.filter(([, k]) => k === 'openShort').every(([, , l]) => (l.match(/\{(\w+)\}/g) || []).every(p => p === '{built}' || p === '{best}')), 'and those use only {built} and {best}');
  ok(cast.every(n => T.voices[n].openShort.some(l => l.includes('{built}'))), 'every character can quote how many tiles you built');
  const rude = all.filter(([, , l]) => blocked.test(l));
  ok(rude.length === 0, 'mild language only' + (rude[0] ? ': ' + rude[0].join(' / ') : ''));
  const brit = all.filter(([, , l]) => BRITISH.test(l)).concat(cast.map(n => [n, 'food', T.food[n].c + ' ' + T.food[n].d.join(' ')]).filter(([, , l]) => BRITISH.test(l)));
  ok(brit.length === 0, 'American spelling' + (brit[0] ? ': ' + brit[0].join(' / ') : ''));
  const seen = {}, dup = [];
  all.forEach(([n, , l]) => { if (seen[l] && seen[l] !== n) dup.push(l); seen[l] = n; });
  ok(dup.length === 0, 'no two characters share a line' + (dup[0] ? ': ' + dup[0] : ''));
  const classic = new Set(Object.values(G.LINES).flatMap(L => Object.values(L).flat()));
  ok(all.every(([, , l]) => !classic.has(l)), 'and none of them is a classic line');
  ok(/precious|gollum/i.test(T.voices.Gollum.pass.concat(T.voices.Gollum.great).join(' ')) && /hoom/i.test(T.voices.Treebeard.good.join(' ')) && /beard/i.test(Object.values(T.voices.Gimli).flat().join(' ')), 'they sound like themselves (Gollum, Treebeard, Gimli)');

  console.log('picking lines and food');
  {
    const r = mulberry32(3);
    let fromVoice = 0;
    for (let i = 0; i < 300; i++) { const n = cast[i % cast.length], k = KINDS[i % KINDS.length]; if (T.voices[n][k].includes(G.pickLine(k, r, null, 'normal', n, 'lotr'))) fromVoice++; }
    ok(fromVoice === 300, 'a character always says its own lines');
    ok(G.LINES.normal.great.includes(G.pickLine('great', r, null, 'normal', 'Marta', 'classic')) && G.LINES.normal.great.includes(G.pickLine('great', r, null, 'normal')), 'a classic player still speaks by level');
    ok(G.LINES.hard.great.includes(G.pickLine('great', r, null, 'hard', 'Gandalf', 'classic')), 'and outside the theme a name means nothing special');
    const last = T.voices.Sam.great[0];
    ok(Array.from({ length: 40 }, () => G.pickLine('great', r, last, 'normal', 'Sam', 'lotr')).every(l => l !== last), 'never the line just said');
  }
  ok(cast.every(n => T.food[n].c.length >= 3 && T.food[n].d.length === 3 && T.food[n].d.every(d => d.length >= 3 && d.length <= 40)), 'every character has a home and three things to eat or drink');
  ok(cast.every(n => { for (let r = 0; r < 12; r++) for (let t = 1; t <= 3; t++) { const o = G.foodComment(n, t, mulberry32(r * 7 + t), 0, null, null, 'lotr'); if (!o || !T.food[n].d.some(d => o.text.includes(d)) || /\{/.test(o.text) || o.lang) return false; } return true; }), 'their hungry remarks name their own food, in English, with nothing left unfilled');
  ok(cast.some(n => { for (let r = 0; r < 40; r++) { if (G.foodComment(n, 2, mulberry32(r), 0, null, null, 'lotr').text.includes(T.food[n].c)) return true; } return false; }), 'and sometimes their home');
  ok(cast.every(n => { const a = G.foodComment(n, 1, mulberry32(5), 0, null, null, 'lotr'); const b = G.foodComment(n, 3, mulberry32(6), 0, null, a.dish, 'lotr'); return b.text.includes(T.food[n].d[a.dish]); }), 'the same dish through a whole wait');
  ok(T.foodLines.flat().every(l => !BRITISH.test(l) && !blocked.test(l)), 'the hungry lines are mild and American too');
  ok(G.foodComment('Marta', 1, mulberry32(1), 0, null, null, 'lotr').text.length > 0 && G.foodComment('Gandalf', 1, mulberry32(1), 0, null, null, 'classic') === null, 'classic players keep their food; outside the theme the characters have none');

  console.log('names');
  {
    const r = mulberry32(11);
    ok(LEVELS.every(l => Array.from({ length: 50 }, () => G.pickCpuName(l, r, new Set(), 'lotr')).every(n => T.players[l].includes(n))), 'the theme picks a character of the chosen level');
    ok(LEVELS.every(l => Array.from({ length: 50 }, () => G.pickCpuName(l, r, new Set())).every(n => G.CPU_PLAYERS[l].includes(n))), 'without it, a classic player as before');
    ok(Array.from({ length: 50 }, () => G.pickCpuName('easy', r, new Set(['pippin', 'merry', 'gollum']), 'lotr')).every(n => n === 'Treebeard'), 'names already at the table are skipped');
  }

  console.log('the golden ring');
  {
    const svg = G.ringSVG(1);
    ok(/class="toy-train ring c1"/.test(svg) && /aria-hidden="true"/.test(svg), 'it sits where the toy train does, hidden from screen readers');
    ok(/fill-rule="evenodd"/.test(svg) && /#f4c542/.test(svg), 'a gold band with a hole in it');
    const ids = [...svg.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    ok(ids.length === 2 && ids.every(id => svg.includes(`url(#${id})`)) && ids.every(id => !G.ringSVG(2).includes(`id="${id}"`)), 'its gradients have ids of their own for each seat');
  }

  // A whole game through the app, with every screen kept, and the comment timers run by hand.
  async function play(opts, seed, maxSteps) {
    const screens = [], store = {}, queue = [];
    const root = { _h: '', set innerHTML(v) { this._h = v; screens.push(v); }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    let id = 0;
    const timer = { set(fn) { queue.push({ fn, id: ++id }); return id; }, clear(x) { const i = queue.findIndex(q => q.id === x); if (i >= 0) queue.splice(i, 1); } };
    const cr = mulberry32(seed + 1000);
    const app = G.createApp({ root, rng: mulberry32(seed), sleep: async () => {}, reducedMotion: true, now: () => Date.now(), chatRng: cr, nativeChance: 0.4, foodChance: 0.5, timer, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
    app.dispatch({ type: 'newGame' });
    app.dispatch(Object.assign({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'normal' }, opts));
    const names = [app.state.cpuName, app.state.cpu2Name];
    for (let s = 0; s < (maxSteps || 4000) && !(app.state.modal && app.state.modal.type === 'roundEnd'); s++) {
      await tick();
      queue.splice(0).forEach(q => q.fn());
      const A = app.state.awaiting; if (!A) continue;
      if (s % 5 === 0) continue;                      // dawdle now and then, so the slow-player jabs fire too
      if (A.kind === 'draw') app.dispatch({ type: 'draw' });
      else if (A.kind === 'modal') app.dispatch({ type: 'dialogOk' });
      else if (A.kind === 'build') { if (A.canDraw) app.dispatch({ type: 'draw' }); else if (A.canBuild && s % 3) app.dispatch({ type: 'autoBuild' }); else if (A.canDone) app.dispatch({ type: 'endBuild' }); else app.dispatch({ type: 'undoTile' }); }
      else { const m = A.moves[A.moves.length - 1]; app.dispatch({ type: 'selectTile', key: m.tile.join('-') }); if (app.state.awaiting === A) app.dispatch({ type: 'playOn', train: m.trainId }); }
    }
    const bubbles = [];
    screens.forEach(h => { const m = h.match(/<div class="bubble(?: native)?">(?:<b>([^<]*)<\/b>)?<span[^>]*>([^<]*)<\/span>/); if (m) bubbles.push({ from: m[1] ? unesc(m[1]) : null, text: unesc(m[2]) }); });
    return { app, screens, names, bubbles, store };
  }

  console.log('whole games with the theme');
  const lotrLines = new Set(all.map(([, , l]) => l)), foodish = s => /hungry|stomach|belly|dreaming of|in mind of|off to find|going for|off for|had .* twice/.test(s);
  let ringScreens = 0, trainScreens = 0, games = 0, said = 0, wrongVoice = [], hungry = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const two = seed % 2 === 0;
    const g = await play({ theme: 'lotr', cpus: two ? 2 : 1, level: LEVELS[seed % 3], level2: LEVELS[(seed + 1) % 3] }, seed);
    games++;
    ok(T.players[LEVELS[seed % 3]].includes(g.names[0]) && (!two || (T.players[LEVELS[(seed + 1) % 3]].includes(g.names[1]) && g.names[1] !== g.names[0])), `game ${seed}: ${g.names.filter(Boolean).join(' and ')}, from the right levels`);
    g.screens.forEach(h => { if (/toy-train ring/.test(h)) ringScreens++; if (/<span class="toy-train c\d"/.test(h)) trainScreens++; });
    ok(g.screens.some(h => h.includes('Double-12 in Middle-earth')), `game ${seed}: the header says Middle-earth`);
    g.bubbles.forEach(b => {
      said++;
      const who = b.from || g.names[0];
      const filled = T.voices[who] && Object.values(T.voices[who]).flat().some(l => l === b.text || (l.includes('{') && new RegExp('^' + l.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{built\}|\{best\}/g, '\\d+').replace(/tiles/g, 'tiles?') + '$').test(b.text)));
      if (foodish(b.text) && T.food[who].d.some(d => b.text.includes(d))) hungry++;
      else if (!filled) wrongVoice.push(`${who}: ${b.text}`);
    });
    ok(JSON.parse(g.store['mt-opts']).theme === 'lotr', `game ${seed}: the theme is remembered`);
  }
  ok(said > 40 && wrongVoice.length === 0, `${said} speech bubbles over ${games} games, every one in the speaker's own voice` + (wrongVoice[0] ? ` (not: ${wrongVoice[0]})` : ''));
  ok(hungry > 0, `characters got hungry for their own food (${hungry} times)`);
  ok(ringScreens > 0 && trainScreens === 0, `open trains wear the golden ring (${ringScreens} screens), never a toy train`);

  console.log('the classic game is unchanged');
  {
    const g = await play({ cpus: 1, level: 'hard' }, 21);
    ok(G.CPU_PLAYERS.hard.includes(g.names[0]), 'with no theme chosen, a classic player');
    ok(g.screens.every(h => !/toy-train ring/.test(h)) && g.screens.some(h => /<span class="toy-train c\d"/.test(h)), 'and toy trains, not rings');
    ok(g.bubbles.every(b => !lotrLines.has(b.text)), 'and classic lines');
    ok(JSON.parse(g.store['mt-opts']).theme === 'lotr' || JSON.parse(g.store['mt-opts']).theme === 'classic', 'the setting is saved');
    const h = await play({ theme: 'classic', cpus: 1, level: 'easy' }, 22, 50);
    ok(G.CPU_PLAYERS.easy.includes(h.names[0]) && JSON.parse(h.store['mt-opts']).theme === 'classic', 'choosing Classic again goes back to the classic players');
    const bad = await play({ theme: 'narnia', cpus: 1 }, 23, 10);
    ok(bad.app.state.opts.theme === 'classic', 'an unknown theme falls back to Classic');
  }

  console.log('the setup form');
  {
    const g = await play({ theme: 'lotr' }, 31, 5);
    g.app.dispatch({ type: 'newGame' });
    const html = g.screens[g.screens.length - 1];
    ok(/<select id="opt-theme">/.test(html) && /<option value="classic">Classic<\/option>/.test(html) && /<option value="lotr" selected>The Lord of the Rings<\/option>/.test(html), 'a Theme choice, showing the current one');
    const page = require('fs').readFileSync('../mexican-train.html', 'utf8');
    ok(page.includes("theme: val('#opt-theme')"), 'the real page reads it when you press Start game');
    ok(/\.toy-train\.ring svg \{[^}]*drop-shadow/.test(page), 'and the stylesheet gives the ring its glow');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
