'use strict';
// The computer player's remarks in hosted games.
require('./game.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const OM = require('../online-match.js').OnlineMatch;
const { mulberry32, key } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await wait(0); };

function fakeTime() {
  let clock = 0, idc = 0; const timers = [];
  const timer = { set: (fn, ms) => { const id = ++idc; timers.push({ id, at: clock + ms, fn }); return id; }, clear: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); } };
  const advance = ms => { const end = clock + ms; for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > end) break; const t = timers.shift(); clock = t.at; t.fn(); } clock = end; };
  return { timer, advance, now: () => clock, pending: () => timers.length };
}
function mk(opts) {
  const t = fakeTime(), sent = [[], [], []];
  const m = new OM(Object.assign({ rounds: 1, hand: 8, names: ['Ann', 'Ben', 'Zed'], computer: { level: 'normal' }, rng: mulberry32(3), sleep: async () => {}, stepDelay: 0, paceRng: () => 0,
    remarks: true, chatRng: () => 0.5, nativeChance: 0, foodChance: 0, timer: t.timer, now: t.now, push: (seat, msg) => sent[seat].push(Object.assign({ at: t.now() }, msg)) }, opts || {}));
  return { m, t, sent, comments: s => sent[s].filter(x => x.t === 'comment') };
}

(async () => {
  console.log('1. choosing the words (shared by the game against the computer and the server)');
  {
    const base = { level: 'normal', rng: () => 0.5, nativeChance: 0, foodChance: 0, last: '', dish: null };
    const nativeName = Object.keys(G.NATIVE_LANG)[0], lang = G.NATIVE_LANG[nativeName];
    const englishName = G.CPU_PLAYERS && G.CPU_PLAYERS.length ? G.CPU_PLAYERS.map(p => p.name).find(n => !G.NATIVE_LANG[n]) : 'Zed';
    const r = G.composeRemark('great', {}, Object.assign({}, base, { name: englishName }));
    ok(typeof r.text === 'string' && r.text && G.LINES.normal.great.includes(r.text) && Object.keys(r.extra).length === 0, 'an ordinary remark is a line of its skill level, in English');
    const hard = G.composeRemark('poor', {}, Object.assign({}, base, { name: englishName, level: 'hard' }));
    ok(G.LINES.hard.poor.includes(hard.text), 'and a Hard computer uses its own lines');
    const n = G.composeRemark('great', {}, Object.assign({}, base, { name: nativeName, nativeChance: 1 }));
    ok(n.extra.lang === lang && typeof n.extra.trans === 'string' && n.extra.trans && G.NATIVE_LINES[lang].great.some(p => p[0] === n.text && p[1] === n.extra.trans), `a player with a native language ("${nativeName}", ${lang}) can answer in it, with a translation`);
    const off = G.composeRemark('great', {}, Object.assign({}, base, { name: nativeName, nativeChance: 0 }));
    ok(Object.keys(off.extra).length === 0, 'and does not when that is switched off');
    const food = Object.keys(G.FOOD)[0];
    const h = G.composeRemark('slow2', {}, Object.assign({}, base, { name: food, foodChance: 1 }));
    ok(typeof h.text === 'string' && h.text.length > 5 && !!h.dish, `a slow-player jab can be a hungry one (${food}: "${h.text.slice(0, 50)}...")`);
    const h2 = G.composeRemark('slow2', {}, Object.assign({}, base, { name: food, foodChance: 1, dish: h.dish }));
    ok(h2.dish === h.dish, 'and keeps to the same dish during one wait');
    const v = G.composeRemark('openShort', { built: 2, best: 5 }, Object.assign({}, base, { name: englishName }));
    ok(!/[{}]/.test(v.text), 'blanks in a line are filled in');
    const seq = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8]; let i1 = 0, i2 = 0;
    const a = G.composeRemark('good', {}, Object.assign({}, base, { name: englishName, rng: () => seq[i1++ % seq.length] }));
    const b = G.composeRemark('good', {}, Object.assign({}, base, { name: englishName, rng: () => seq[i2++ % seq.length] }));
    ok(a.text === b.text && i1 === i2, 'the same random numbers give the same words, and use the same number of them');
  }

  console.log('2. "you are taking too long": jabs, to the person who is slow');
  {
    const { m, t, sent, comments } = mk();
    m.start(); await settle();
    ok(m.awaiting[0] && m.awaiting[0].kind === 'build' && m.awaiting[1] && m.awaiting[1].kind === 'build', 'both people are building their trains (so both are being waited for)');
    t.advance(24900);
    ok(comments(0).length === 0 && comments(1).length === 0, 'nothing is said in the first 25 seconds');
    t.advance(200);
    const c0 = comments(0)[0], c1 = comments(1)[0];
    ok(c0 && c1 && c0.kind === 'slow1' && c1.kind === 'slow1' && c0.from === 'Zed' && G.LINES.normal.slow1.includes(c0.text), `after 25 s each person who is slow gets the first jab, from the computer ("${c0 && c0.text}")`);
    t.advance(23000);
    t.advance(23000);
    t.advance(23000);
    t.advance(23000);
    const kinds = comments(0).map(x => x.kind);
    ok(kinds.join() === 'slow1,slow2,slow3,slow3,slow3', `then another every 20-26 s, ruder each time, and no ruder than the third (${kinds.join(', ')})`);
    ok(comments(0).every(x => G.LINES.normal[x.kind].includes(x.text)) && new Set(comments(0).map(x => x.text)).size >= 3, 'each in the voice of its tier, and not the same line over again');
    ok(sent[2].length === 0, 'nothing is ever sent to the computer\'s own seat');
    ok(sent[0].every(x => x.t === 'comment' || x.t === 'state') && comments(0).every(x => x.t === 'comment' && typeof x.text === 'string'), 'and the messages are the ordinary ones plus these');
    m.intent(1, { a: 'done' }); await settle();
    const slowOf = s => comments(s).filter(x => /^slow/.test(x.kind)).length;
    const before0 = slowOf(0), before1 = slowOf(1);
    t.advance(60000);
    ok(slowOf(0) > before0 && slowOf(1) === before1, 'when one person has moved on, the jabs go on for the one still taking their time, and stop for the other');
    m.abort(); await m.done;
    ok(t.pending() === 0, 'when the game ends nothing is left waiting');
    const after = sent[0].length; t.advance(120000);
    ok(sent[0].length === after, 'and nothing more is said');
  }
  {
    const { m, t, sent, comments } = mk({ remarks: false });
    m.start(); await settle(); t.advance(120000);
    ok(comments(0).length === 0 && comments(1).length === 0 && t.pending() === 0, 'with remarks switched off, the computer says nothing and no timers are used');
    m.abort(); await m.done;
  }
  {
    const { m, t, sent, comments } = mk({ names: ['Ann', 'Ben'], computer: undefined });
    m.start(); await settle(); t.advance(120000);
    ok(m.remarks === false && comments(0).length === 0 && comments(1).length === 0, 'with no computer player there is nobody to comment');
    m.abort(); await m.done;
  }
  {
    const { m, t, comments } = mk();
    m.start(); await settle();
    m.setPaused(true); t.advance(25100);
    ok(comments(0).length === 0, 'while the game is paused (someone dropped) it says nothing');
    m.setPaused(false); t.advance(24000);
    ok(comments(0).length >= 1, 'and carries on when it resumes');
    m.abort(); await m.done;
  }

  console.log('3. reactions to what a person does');
  {
    const { m, t, sent, comments } = mk({ chatRng: () => 0 });          // every chance succeeds, and the shortest delay
    m.start(); await settle();
    const g = m.game, p0 = g.players[0];
    await m.hooks.onDraw(g, p0, [3, 4]);
    t.advance(500);
    ok(comments(0).length === 0, 'a reaction comes a beat after the move, not at once');
    t.advance(200);
    ok(comments(0).length === 1 && comments(0)[0].kind === 'draw' && comments(1).length === 0, 'Ann drew a tile: the computer says something to Ann, and Ben is told nothing');
    await m.hooks.onDraw(g, p0, [3, 5]); t.advance(2000);
    ok(comments(0).length === 1, 'a second remark within 7 seconds is held back (the cooldown)');
    t.advance(7000); await m.hooks.onDraw(g, p0, [3, 6]); t.advance(700);
    ok(comments(0).length === 2, 'and allowed once the cooldown has passed');
    await m.hooks.onPass(g, g.players[1]); t.advance(700);
    ok(comments(1).length === 1 && comments(1)[0].kind === 'pass' && comments(0).length === 2, 'Ben passing: the remark goes to Ben only');
    await m.hooks.onDraw(g, g.players[2], [1, 2]); t.advance(5000);
    ok(comments(0).length === 2 && comments(1).length === 1, 'and what the computer itself does draws no remark');
    m.abort(); await m.done;
  }
  {
    // the opening: a person who finished far short of their longest train is told so, whatever the cooldown
    let found = false;
    for (let seed = 1; seed <= 30 && !found; seed++) {
      const { m, t, sent, comments } = mk({ chatRng: () => 0, rng: mulberry32(seed) });
      m.start(); await settle();
      const g = m.game, p0 = g.players[0];
      if (E.longestChain(p0.hand.map(x => x.slice()), g.engine, false).length < 2) { m.abort(); await m.done; continue; }
      found = true;
      await m.hooks.onDraw(g, p0, [3, 4]); t.advance(700);                       // (the cooldown is now running)
      const n = comments(0).length;
      await m.hooks.onBuildDone(g, p0, 0); t.advance(700);
      const c = comments(0);
      ok(c.length === n + 1 && c[c.length - 1].kind === 'openNone' && comments(1).length === 0, 'finishing the opening with no train when one was possible always gets a remark (even inside the cooldown), to that person only');
      m.abort(); await m.done;
    }
    ok(found, '(a deal was found where this could be staged)');
  }
  {
    // the opinion of a person's move: rated on the board as it was, said to them after they play
    const { m, t, sent, comments } = mk({ chatRng: () => 0 });
    m.start(); await settle();
    const g = m.game, p0 = g.players[0];
    // the engine plays: get a real move for Ann by finishing the opening quickly and waiting for her first turn
    let guard = 0; let aw;
    while (guard++ < 400 && !(aw = m.awaiting[0], aw && aw.kind === 'move') && !(m.awaiting[1] && m.awaiting[1].kind === 'move')) {
      for (const s of [0, 1]) { const a = m.awaiting[s]; if (a && a.kind === 'build') m.intent(s, { a: a.info.canDraw ? 'draw' : 'done' }); else if (a && a.kind === 'draw') m.intent(s, { a: 'draw' }); }
      await settle(2);
    }
    const seat = m.awaiting[0] && m.awaiting[0].kind === 'move' ? 0 : 1, a = m.awaiting[seat];
    ok(a && a.kind === 'move', 'a normal turn was reached');
    const mv = a.moves[0];
    t.advance(2000);                                  // (let what was already on its way, about their earlier draws, arrive first)
    const before = comments(seat).length, beforeOther = comments(1 - seat).filter(x => !/^slow/.test(x.kind)).length;
    m.intent(seat, { a: 'play', tile: mv.tile, train: m.cid(seat, mv.trainId) }); await settle();
    ok(m.rated[seat] === null, 'the move was rated and the rating used up');
    t.advance(3000);
    const kind = (comments(seat)[before] || {}).kind;
    ok(comments(seat).length >= before, `(the move was rated; the computer ${kind ? 'said something: ' + kind : 'had nothing to say about it, which is also allowed'})`);
    ok(comments(1 - seat).filter(x => !/^slow/.test(x.kind)).length === beforeOther, 'and the other person heard nothing about it');
    m.abort(); await m.done;
  }

  console.log('4. whole matches: every remark goes to the person it is about, and only then');
  {
    const names = ['Ann', 'Ben', 'Zed'];
    const act = (m, seat, rnd) => {
      const aw = m.awaiting[seat]; if (!aw) return false;
      if (aw.kind === 'modal') { m.intent(seat, { a: 'ok' }); return true; }
      if (aw.kind === 'draw') { m.intent(seat, { a: 'draw' }); return true; }
      const play = mv => m.intent(seat, { a: 'play', tile: mv.tile, train: m.cid(seat, mv.trainId) });
      if (aw.kind === 'move') { play(aw.moves[Math.floor(rnd() * aw.moves.length)]); return true; }
      if (aw.kind === 'build') {
        const i = aw.info;
        if (i.canDraw) { m.intent(seat, { a: 'draw' }); return true; }
        if (i.moves.length && rnd() < 0.7) { play(i.moves[Math.floor(rnd() * i.moves.length)]); return true; }
        m.intent(seat, { a: i.canDone ? 'done' : 'undo' }); return true;
      }
      return false;
    };
    let total = 0, kinds = new Set(), bad = [], matches = 0, gaps = [], toOther = 0;
    for (let seed = 1; seed <= 14; seed++) {
      const level = ['easy', 'normal', 'hard'][seed % 3];
      const crng = mulberry32(seed + 500), rnd = mulberry32(seed + 9);
      const { m, t, sent } = mk({ rounds: 1, hand: seed % 2 ? 8 : 12, computer: { level }, rng: mulberry32(seed), chatRng: crng, nativeChance: 0.3, foodChance: 0.3 });
      // what each person has done since the computer last spoke to them
      const did = [{ draw: 0, pass: 0, play: 0 }, { draw: 0, pass: 0, play: 0 }];
      const orig = m.push; const comments = [[], []];
      m.push = (seat, msg) => {
        orig(seat, msg);
        if (msg.t === 'state') { for (const evs of [msg.events || []]) for (const e of evs) if (e.who === 'me') { if (e.e === 'draw') did[seat].draw++; if (e.e === 'pass') did[seat].pass++; if (e.e === 'play') did[seat].play++; } }
        if (msg.t === 'comment') {
          comments[seat].push({ at: t.now(), kind: msg.kind });
          if (seat > 1) bad.push('sent to the computer');
          if (msg.from !== 'Zed') bad.push(`from ${msg.from}`);
          if (!msg.text || typeof msg.text !== 'string') bad.push('no text');
          if (msg.lang && (typeof msg.trans !== 'string' || !G.NATIVE_LINES[msg.lang])) bad.push('bad language');
          const k = msg.kind;
          if (['great', 'good', 'poor', 'awful', 'forced', 'missedOut'].includes(k) && did[seat].play === 0) bad.push(`seat ${seat}: "${k}" with no move of theirs`);
          if (k === 'draw' && did[seat].draw === 0) bad.push(`seat ${seat}: "draw" with no draw of theirs`);
          if (k === 'pass' && did[seat].pass === 0) bad.push(`seat ${seat}: "pass" with no pass of theirs`);
          kinds.add(k); total++;
        }
      };
      m.start();
      let guard = 0;
      while (!m.over && guard++ < 6000) { let acted = false; for (const s of [0, 1]) if (act(m, s, rnd)) acted = true; await settle(2); t.advance(acted ? 250 : 2500); }
      matches++;
      for (const s of [0, 1]) for (let i = 1; i < comments[s].length; i++) { const c = comments[s][i]; if (!['awful', 'missedOut', 'openShort', 'openNone'].includes(c.kind) && !/^slow/.test(c.kind)) gaps.push(c.at - comments[s][i - 1].at); }
      if (!m.over) bad.push(`seed ${seed}: the match did not finish`);
      if (t.pending() !== 0) bad.push(`seed ${seed}: ${t.pending()} timers left over`);
    }
    ok(matches === 14 && total > 25, `${matches} whole matches (with Easy, Medium and Hard computers): ${total} remarks made, of ${kinds.size} different kinds (${[...kinds].sort().join(', ')})`);
    ok(bad.length === 0, 'every remark came from the computer, to a person (never to the computer), with real text, and a remark about a move, a draw or a pass only ever followed that same person doing it' + (bad[0] ? ' (' + bad[0] + ')' : ''));
    ok(gaps.length > 5 && Math.min(...gaps) >= 5000, `ordinary remarks to one person are at least 7 s apart (allowing for the reaction delay): the closest were ${Math.round(Math.min(...gaps))} ms`);
    ok(['great', 'good', 'poor', 'awful', 'draw', 'pass', 'openBest', 'openShort', 'openNone', 'forced', 'missedOut'].filter(k => kinds.has(k)).length >= 4, 'and a good variety of reasons to speak');
  }

  console.log('5. the page: receiving and showing a remark');
  {
    class FakeWS { constructor() { this.readyState = 0; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); } send() {} close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
    const t = fakeTime();
    const root = { html: '', gen: 0, bubble: null, adds: 0,
      set innerHTML(v) { root.html = v; root.gen++; root.bubble = /class="bubble/.test(v) ? { classList: { add: () => { root.adds++; } } } : null; }, get innerHTML() { return root.html; },
      querySelectorAll() { return []; }, querySelector(sel) { return sel === '.bubble' ? root.bubble : { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const store = {};
    const app = G.createApp({ root, sleep: async () => {}, reducedMotion: true, timer: t.timer, now: t.now, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } }, WebSocket: FakeWS, fetch: async () => ({ ok: true, json: async () => ({ addresses: ['fake:1'], preferred: 'fake:1' }) }) });
    const S = app.state; app.dispatch({ type: 'boot' }); app.dispatch({ type: 'openHost' }); await wait(5); app.dispatch({ type: 'hostGame', server: 'x', name: 'Ann', rounds: 4, hand: 15, computer: 'normal' }); await wait(10);
    FakeWS.last.say({ t: 'created', code: 'ABCDEF', display: 'ABC-DEF', token: 't', seat: 0, settings: { rounds: 4, hand: 15, computer: 'normal' }, addresses: [] });
    const T = (a, b) => [a, b], tr = id => ({ id, marker: false, tiles: [], end: 12 });
    const view = (seq, computer) => ({ seq, round: 0, rounds: 4, me: { name: 'Ann', seat: 0 }, opp: { name: 'Ben' },
      opps: computer ? [{ id: 'cpu', name: 'Ben', seat: 1, computer: false }, { id: 'cpu2', name: 'Zed', seat: 2, computer: true, level: 'normal' }] : [{ id: 'cpu', name: 'Ben', seat: 1, computer: false }],
      totals: { human: 0, cpu: 0, cpu2: 0 }, paused: false, over: null, log: ['x'], banner: '', modal: null, awaiting: null,
      game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [T(1, 2)] }, { id: 'cpu', name: 'Ben', hand: [T(-1, -1)] }].concat(computer ? [{ id: 'cpu2', name: 'Zed', hand: [T(-1, -1)] }] : []), boneyard: [T(-1, -1)], trains: { human: tr('human'), cpu: tr('cpu'), cpu2: tr('cpu2'), mexican: tr('mexican') }, openDouble: null, opening: null } });
    FakeWS.last.say({ t: 'comment', text: 'Too early.', from: 'Zed' });
    ok(S.comment === null || S.comment === undefined, 'a remark that arrives before the game has started is ignored');
    FakeWS.last.say({ t: 'state', seq: 1, view: view(1, true), events: [] });
    const n = (html, re) => (html.match(re) || []).length;
    ok(n(root.html, /data-action="toggleChat"/g) === 1 && /Comments: on/.test(root.html), 'in a hosted game with a computer, there is a Comments button, on the computer\'s row');
    FakeWS.last.say({ t: 'comment', kind: 'slow1', text: 'Any day now.', from: 'Zed' });
    ok(/<div class="bubble"><b>Zed<\/b><span>Any day now\.<\/span><\/div>/.test(root.html) && root.adds === 1, 'a remark appears as a speech bubble in the computer\'s name and fades in once');
    for (let i = 2; i <= 5; i++) FakeWS.last.say({ t: 'state', seq: i, view: view(i, true), events: [] });
    ok(/Any day now\./.test(root.html) && root.adds === 1, 'and stays steady through the moves that follow');
    t.advance(6100);
    ok(!/Any day now\./.test(root.html), 'and goes away after a few seconds');
    FakeWS.last.say({ t: 'comment', text: 'Privet, drug.', from: 'Zed', lang: 'ru', trans: 'Hello, friend.' });
    ok(/<span lang="ru">Privet, drug\.<\/span><small class="trans" lang="en">Hello, friend\.<\/small>/.test(root.html), 'a remark in the computer\'s own language is shown with its translation');
    t.advance(6100);
    const hostile = '<img src=x onerror=alert(1)>';
    FakeWS.last.say({ t: 'comment', text: hostile, from: '<b>Evil</b>' });
    ok(!root.html.includes('<img src=x') && /&lt;img src=x onerror=alert\(1\)&gt;/.test(root.html) && !root.html.includes('<b>Evil</b>'), 'text and a name containing markup are shown as plain text, never as markup');
    t.advance(6100);
    FakeWS.last.say({ t: 'comment', text: 'Hi', from: 'Zed', lang: '"><script>alert(1)</script>', trans: 'x' });
    ok(!/<script>/.test(root.html) && !/lang="&quot;/.test(root.html) && !/ lang="[^"]*script/.test(root.html), 'a language that is not one of ours is ignored (it is never put in the page)');
    t.advance(6100);
    FakeWS.last.say({ t: 'comment', text: 'x'.repeat(5000), from: 'Zed' });
    ok((root.html.match(/<span>(x+)<\/span>/) || [, ''])[1].length === 160, 'an enormous remark is cut to 160 characters');
    t.advance(6100);
    for (const bad of [{ t: 'comment' }, { t: 'comment', text: 42 }, { t: 'comment', text: '' }, { t: 'comment', text: { a: 1 } }, { t: 'comment', text: null }]) FakeWS.last.say(bad);
    ok(S.comment === null, 'remarks with no text, or text that is not text, are ignored');
    FakeWS.last.say({ t: 'comment', text: 'A', from: null });
    ok(/<b>Computer<\/b><span>A<\/span>/.test(root.html), '(a remark with no name is credited to "Computer")');
    t.advance(6100);
    app.dispatch({ type: 'toggleChat' });
    ok(/Comments: off/.test(root.html), 'the Comments button turns them off');
    FakeWS.last.say({ t: 'comment', text: 'Should not show.', from: 'Zed' });
    ok(!/Should not show/.test(root.html) && !S.comment, 'and with Comments off, nothing is shown');
    app.dispatch({ type: 'toggleChat' });
    FakeWS.last.say({ t: 'state', seq: 20, view: view(20, false), events: [] });
    ok(n(root.html, /data-action="toggleChat"/g) === 0, 'in a hosted game with no computer there is no Comments button');
    app.dispatch({ type: 'leaveOnline' });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
