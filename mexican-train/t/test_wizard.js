'use strict';
// The wizarding theme: its cast and voices, the guardian-animal markers, the two boards (picked at random for each game, the same on every screen of a hosted game),
// the artwork files, and whole games played with it.
const fs = require('fs'), path = require('path');
require('./game.js');
const G = globalThis.MexicanTrainGame;
const { mulberry32 } = G.Engine;
const { createGameServer } = require('../server.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(4); } return f(); };
const ROOT = path.join(__dirname, '..');
const T = G.THEMES.wizard, LEVELS = G.Engine.LEVELS;
const cast = [].concat(...LEVELS.map(l => T.players[l]));
const KINDS = Object.keys(G.LINES.normal);

(async () => {
  console.log('1. the cast');
  ok(G.THEME_IDS.includes('wizard') && G.THEME_IDS.join() === 'classic,lotr,wizard', 'the theme is one of the choices, after Classic and The Lord of the Rings');
  ok(T.label === 'The wizarding world', 'its name in the menus');
  ok(LEVELS.join() === 'easy,normal,hard,expert' && T.players.easy.join() === 'Neville,Hagrid,Ron,Dobby' && T.players.normal.join() === 'Harry,Ginny,Luna,Fred,Draco' && T.players.hard.join() === 'McGonagall,Sirius,Snape' && T.players.expert.join() === 'Dumbledore,Hermione,Voldemort', 'fifteen characters: four Easy, five Medium, three Hard, three Expert');
  ok(LEVELS.every(l => T.players[l].length >= 3), 'at least three per level, so three computers of one skill still get different characters');
  ok(new Set(cast).size === cast.length && cast.every(n => !G.CPU_NAMES.includes(n) && !G.THEMES.lotr.players.easy.concat(G.THEMES.lotr.players.normal, G.THEMES.lotr.players.hard, G.THEMES.lotr.players.expert).includes(n)), 'nobody plays at two levels and no name is also a classic player or a Middle-earth character');
  ok(cast.every(n => n.length <= 10 && G.cleanPlayerName(n, '') === n), 'every name fits in the 10 letters a name may have');
  ok(cast.every(n => !G.nativeLangOf(n)), 'no character is mistaken for a native-language speaker');
  ok(Object.keys(T.voices).sort().join() === cast.slice().sort().join() && Object.keys(T.food).sort().join() === cast.slice().sort().join(), 'every character has a voice and food, and nobody else does');

  console.log('2. their voices');
  const blocked = /\b(fuck\w*|shit\w*|bitch\w*|cunt|nigg\w*|fag\w*|retard\w*|whore|slut|bastard|dick|cock|piss\w*|damn\w*|hell|crap|ass|asshole|kill|die|dead|suicide|stupid|idiot|moron|ugly|fat)\b/i;
  const BRITISH = /\b(colours?|coloured|favourites?|greys?|neighbours?|honours?|behaviours?|organis\w+|realis\w+|centres?|whilst|amongst|learnt|spelt|practise[sd]?|judgement|armours?|flavours?|humours?)\b/i;
  const all = [];
  cast.forEach(n => KINDS.forEach(k => (T.voices[n][k] || []).forEach(l => all.push([n, k, l]))));
  ok(cast.every(n => KINDS.every(k => Array.isArray(T.voices[n][k]) && T.voices[n][k].length >= 2)), `every character has at least two lines for each of the ${KINDS.length} kinds of comment`);
  ok(cast.every(n => Object.keys(T.voices[n]).every(k => KINDS.includes(k))), 'and no kind the game does not use');
  ok(all.every(([, , l]) => typeof l === 'string' && l.length >= 4 && l.length <= 110), `${all.length} lines, each short enough for a speech bubble`);
  ok(all.every(([, k, l]) => k === 'openShort' || k === 'ownShort' || !/\{/.test(l)), 'only the short-train lines have placeholders');
  ok(all.filter(([, k]) => k === 'ownShort').every(([, , l]) => !/\{(?!built\})\w+\}/.test(l)) && cast.every(n => T.voices[n].ownShort.some(l => l.includes('{built}'))), 'a character remarking on its own short train can say how many tiles, and only that');
  ok(all.filter(([, k]) => k === 'openShort').every(([, , l]) => (l.match(/\{(\w+)\}/g) || []).every(p => p === '{built}' || p === '{best}')) && cast.every(n => T.voices[n].openShort.some(l => l.includes('{built}'))), 'the opening-short lines use only {built} and {best}, and each character can quote what you built');
  const rude = all.filter(([, , l]) => blocked.test(l));
  ok(rude.length === 0, 'mild language only' + (rude[0] ? ': ' + rude[0].join(' / ') : ''));
  const brit = all.filter(([, , l]) => BRITISH.test(l)).concat(cast.map(n => [n, 'food', T.food[n].c + ' ' + T.food[n].d.join(' ')]).filter(([, , l]) => BRITISH.test(l)));
  ok(brit.length === 0, 'American spelling' + (brit[0] ? ': ' + brit[0].join(' / ') : ''));
  const seen = {}, dup = [];
  all.forEach(([n, , l]) => { if (seen[l] && seen[l] !== n) dup.push(l); seen[l] = n; });
  ok(dup.length === 0, 'no two characters share a line' + (dup[0] ? ': ' + dup[0] : ''));
  const others = new Set(Object.values(G.LINES).flatMap(L => Object.values(L).flat()).concat(Object.values(G.THEMES.lotr.voices).flatMap(v => Object.values(v).flat())));
  ok(all.every(([, , l]) => !others.has(l)), 'and none is a classic line or a Middle-earth line');
  ok(all.every(([, , l]) => !/\bquidditch|avada|crucio|expecto|wingardium|horcrux|azkaban\b/i.test(l)), 'no spells or special terms lifted from the books (the lines are original)');
  ok(/boneyard/i.test(T.voices.Hagrid.draw.join(' ')) && /Dobby/.test(T.voices.Dobby.slow1.join(' ')) && /chapter|odds|probab/i.test(Object.values(T.voices.Hermione).flat().join(' ')) && /remember|pitiful|insolent/i.test(Object.values(T.voices.Voldemort).flat().join(' ')), 'they sound like themselves');

  console.log('3. picking lines and food');
  {
    const r = mulberry32(3); let fromVoice = 0;
    for (let i = 0; i < 300; i++) { const n = cast[i % cast.length], k = KINDS[i % KINDS.length]; if (T.voices[n][k].includes(G.pickLine(k, r, null, 'normal', n, 'wizard'))) fromVoice++; }
    ok(fromVoice === 300, 'a character always says its own lines');
    ok(G.LINES.normal.great.includes(G.pickLine('great', r, null, 'normal', 'Harry', 'classic')), 'outside the theme a name means nothing special');
  }
  ok(cast.every(n => T.food[n].c.length >= 3 && T.food[n].d.length === 3 && T.food[n].d.every(d => d.length >= 3 && d.length <= 40)), 'every character has a home and three things to eat or drink');
  ok(cast.every(n => { for (let r = 0; r < 12; r++) for (let t = 1; t <= 3; t++) { const o = G.foodComment(n, t, mulberry32(r * 7 + t), 0, null, null, 'wizard'); if (!o || !T.food[n].d.some(d => o.text.includes(d)) || /\{/.test(o.text) || o.lang) return false; } return true; }), 'their hungry remarks name their own food, in English');
  ok(T.foodLines.length === 3 && T.foodLines.every(L => L.length >= 3) && T.foodLines.flat().every(l => !BRITISH.test(l) && !blocked.test(l)), 'three stages of hunger, three remarks each, mild');

  console.log('4. names');
  {
    const r = mulberry32(11);
    ok(LEVELS.every(l => Array.from({ length: 50 }, () => G.pickCpuName(l, r, new Set(), 'wizard')).every(n => T.players[l].includes(n))), 'the theme picks a character of the chosen level');
    const used = new Set(); const got = [];
    for (let i = 0; i < 3; i++) { const n = G.pickCpuName('hard', r, used, 'wizard'); got.push(n); used.add(n.toLowerCase()); }
    ok(new Set(got).size === 3 && got.every(n => T.players.hard.includes(n)), `three Hard computers at one table are three different Hard characters (${got.join(', ')})`);
  }

  console.log('5. the guardian animals');
  const animals = Object.values(T.patronus);
  ok(G.PATRONUS && Object.keys(G.PATRONUS).length === 8 && animals.every(a => G.PATRONUS[a]), 'eight animals are drawn, and every character that has one has it drawn');
  ok(T.patronus.Harry === 'stag' && T.patronus.Hermione === 'otter' && T.patronus.Ron === 'terrier' && T.patronus.Luna === 'hare' && T.patronus.Ginny === 'horse' && T.patronus.Dumbledore === 'phoenix' && T.patronus.Snape === 'doe' && T.patronus.McGonagall === 'cat' && Object.keys(T.patronus).every(n => cast.includes(n)), 'the stag, otter, terrier, hare, horse, phoenix, doe and cat, for the characters they belong to');
  for (const a of Object.keys(G.PATRONUS)) {
    const svg = G.patronusSVG(a, 1);
    ok(/^<span class="toy-train patronus c1" aria-hidden="true"><svg viewBox="0 0 300 200"/.test(svg) && /<\/svg><\/span>$/.test(svg) && !/<script|href=|\son[a-z]+=|<image/i.test(svg), `${a}: a plain marker in the place of the toy train`);
    const opens = (svg.match(/<(?!\/|!)[a-zA-Z]/g) || []).length, selfs = (svg.match(/\/>/g) || []).length, closes = (svg.match(/<\/[a-zA-Z]/g) || []).length;
    ok(opens === selfs + closes, `${a}: every tag is closed`);
  }
  ok(G.patronusSVG('dragon', 0).includes('pg-stag-r0'), 'an unknown animal falls back to the stag');
  {
    const S = { game: { players: [1, 2, 3, 4] }, myName: '', online: null, cpuName: 'Harry', cpu2Name: 'Hermione', cpu3Name: 'Dobby', seats: null, opts: {} };
    const ids = ['human', 'cpu', 'cpu2', 'cpu3'];
    const pick = ids.map(i => G.patronusFor(S, i));
    ok(pick[1] === 'stag' && pick[2] === 'otter', `a character wears its own animal (Harry: ${pick[1]}, Hermione: ${pick[2]})`);
    ok(new Set(pick).size === 4, `and no two trains at a table share one (${pick.join(', ')})`);
    S.cpuName = 'Neville'; S.cpu2Name = 'Draco'; S.cpu3Name = 'Fred';
    const p2 = ids.map(i => G.patronusFor(S, i));
    ok(new Set(p2).size === 4 && p2.every(a => G.PATRONUS[a]), `characters without an animal still get different ones (${p2.join(', ')})`);
  }

  console.log('6. the two boards');
  ok(G.BACKDROPS.join() === 'hall,forest', 'a hall and a forest');
  function makeApp(seed) {
    const c = { store: {}, html: '' };
    const root = { set innerHTML(v) { c.html = v; }, get innerHTML() { return c.html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    c.app = G.createApp({ root, rng: mulberry32(seed), paceRng: () => 0, chatRng: () => 1, nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in c.store ? c.store[k] : null), set: (k, v) => { c.store[k] = v; } } });
    c.S = c.app.state; c.d = a => c.app.dispatch(a);
    c.d({ type: 'boot' });
    return c;
  }
  {
    const realRandom = Math.random, got = new Set(), classes = [];
    for (const rv of [0.1, 0.9]) {
      Math.random = () => rv;
      const c = makeApp(5);
      c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy', theme: 'wizard' });
      await until(() => c.S.awaiting && c.S.game);
      c.app.render(true);
      Math.random = realRandom;
      got.add(c.S.backdrop); classes.push((c.html.match(/<main class="table([^"]*)">/) || [])[1]);
    }
    ok(got.size === 2 && got.has('hall') && got.has('forest'), `both boards come up (${[...got]})`);
    ok(classes.join('|') === ' art-wizard bk-hall| art-wizard bk-forest', `and the page carries the matching class (${classes.join('|')})`);
    const c = makeApp(5);
    c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy', theme: 'wizard', backdrop: 'forest' });
    await until(() => c.S.awaiting && c.S.game); c.app.render(true);
    ok(c.S.backdrop === 'forest' && /art-wizard bk-forest/.test(c.html), 'a game can be told which board to use (for tests)');
    const dealt = JSON.stringify(c.S.game.players.map(p => p.hand));
    const d = makeApp(5); Math.random = () => 0.1;
    d.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy', theme: 'wizard' }); await until(() => d.S.awaiting && d.S.game); Math.random = realRandom;
    ok(JSON.stringify(d.S.game.players.map(p => p.hand)) === dealt, 'the choice of board never changes the deal (it does not use the game\'s dice)');
    const cl = makeApp(5);
    cl.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy', theme: 'classic' }); await until(() => cl.S.awaiting && cl.S.game); cl.app.render(true);
    ok(/<main class="table">/.test(cl.html) && !/art-wizard/.test(cl.html), 'a classic game has no wizard board');
    ok(/Double-12 with the wizards/.test(c.html) && !/Middle-earth/.test(c.html), 'the heading says whose game it is');
    ok(/data-train=/.test(c.html) && !/toy-train ring/.test(c.html), 'and no golden ring');
    c.d({ type: 'playAgain' }); await until(() => c.S.game && c.S.awaiting);
    ok(G.BACKDROPS.includes(c.S.backdrop), 'playing again picks a board again');
  }

  console.log('7. a hosted game: the server picks the board, and everyone sees the same one');
  {
    const srv = createGameServer({ pagePath: path.join(ROOT, 'mexican-train.html'), stepDelay: 0, sleep: async () => {}, log: () => {}, heartbeatMs: 60000, softGraceMs: 0, ratePerSecond: 5000, burst: 10000 });
    const port = await srv.listen(0, '127.0.0.1');
    class Raw {
      constructor() { this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); this.q = []; this.ws.onmessage = e => this.q.push(JSON.parse(e.data)); }
      open() { return new Promise(r => { this.ws.onopen = r; }); }
      send(o) { this.ws.send(JSON.stringify(o)); }
      async next(pred, ms) { return until(() => { const i = this.q.findIndex(pred); return i >= 0 ? this.q.splice(i, 1)[0] : null; }, ms || 3000); }
      close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
    }
    const mk = async () => { const c = new Raw(); await c.open(); await c.next(m => m.t === 'hello'); return c; };
    const h = await mk(); h.send({ t: 'create', name: 'Ann', rounds: 1, hand: 8, computer: 'hard', theme: 'wizard' });
    const cr = await h.next(m => m.t === 'created');
    ok(cr.settings.theme === 'wizard', 'the room is a wizarding room');
    const g = await mk(); g.send({ t: 'join', code: cr.code, name: 'Ben' }); await g.next(m => m.t === 'joined');
    h.send({ t: 'start' });
    const lob = async c => { let m = await c.next(x => x.t === 'lobby' && x.state === 'playing'); return m; };
    const lh = await lob(h), lg = await lob(g);
    ok(G.BACKDROPS.includes(lh.settings.backdrop) && lh.settings.backdrop === lg.settings.backdrop, `both players are told the same board (${lh.settings.backdrop})`);
    const comp = (lh.players.find(p => p && p.computer) || {}).name;
    ok(T.players.hard.includes(comp), `the computer is a Hard character (${comp})`);
    srv.close && srv.close();
    h.close(); g.close();
  }

  console.log('8. the artwork');
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const html = fs.readFileSync(path.join(ROOT, 'mexican-train.html'), 'utf8'), css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  for (const n of ['wizard-hall', 'wizard-forest']) {
    const svg = fs.readFileSync(path.join(ROOT, 'art', n + '.svg'), 'utf8').trim();
    ok(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1200 800"/.test(svg) && /<\/svg>$/.test(svg), `${n}: a plain SVG`);
    ok(!/<script|<image|<foreignObject|<a\b|href=|\son[a-z]+=|<style|@import|<text|font/i.test(svg) && !/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(svg), `${n}: nothing that could run, link to or load anything, and no text`);
    ok(svg.length < 14000, `${n}: small (${svg.length} bytes)`);
    const opens = (svg.match(/<(?!\/|!)[a-zA-Z]/g) || []).length, selfs = (svg.match(/\/>/g) || []).length, closes = (svg.match(/<\/[a-zA-Z]/g) || []).length;
    ok(opens === selfs + closes, `${n}: every tag is closed`);
    const cols = Array.from(svg.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-fA-F]{6})"/g)).map(m => m[1].toLowerCase());
    const solid = Array.from(svg.matchAll(/<(?:rect|path|ellipse|circle)[^>]*?fill="(#[0-9a-fA-F]{6})"(?![^>]*fill-opacity)/g)).map(m => m[1].toLowerCase());
    ok(solid.every(h => lum(h) <= lum('#2a1a30') + 0.001), `${n}: every fully solid colour is dark (nothing above the plum of the hall's centre)${solid.filter(h => lum(h) > lum('#2a1a30') + 0.001).join(',')}`);
    const lit = Array.from(svg.matchAll(/fill="(#[0-9a-fA-F]{6})"[^>]*?fill-opacity="([\d.]+)"/g)).filter(m => lum(m[1]) > lum('#2a1a30')).map(m => +m[2]);
    ok(lit.every(o => o <= 0.5), `${n}: the lighter colours (candle flames, fireflies, the moon) are at most half opaque (the most: ${Math.max(0, ...lit)})`);
    ok(css.includes(`url(art:${n})`) && (html.match(new RegExp('url\\("data:image/svg\\+xml,', 'g')) || []).length === 5 && !/url\(art:/.test(html), `${n}: the stylesheet asks for it by name, and the built page has it inlined`);
  }
  ok(/@media \(prefers-contrast: more\) \{[^@]*\.table\.art-wizard\.bk-hall \{ background: radial-gradient/.test(css), 'a person who asks for more contrast gets plain boards');

  console.log('9. whole games');
  for (const level of LEVELS) {
    const c = makeApp(40 + LEVELS.indexOf(level));
    c.d({ type: 'startGame', rounds: 1, hand: 6, style: 'pips', level, theme: 'wizard' });
    await until(() => c.S.awaiting && c.S.game, 8000);
    ok(T.players[level].includes(c.S.cpuName) && !!c.S.game, `a ${level} game starts against ${c.S.cpuName}`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
