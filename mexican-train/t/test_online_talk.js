'use strict';
// The online computer player talks: what it says, to whom, when, in whose voice, and that it changes nothing in play.
const { OnlineMatch } = require('../online-match.js');
const G = globalThis.MexicanTrainGame;
const E = G.Engine;
const { mulberry32 } = E;
const { createGameServer } = require('../server.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(4); } return f(); };
const T = G.THEMES.lotr;
const KINDS = Object.keys(G.LINES.normal);
const unesc = s => String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/* A fake clock for the comment timers: nothing fires until the test says so. */
function fakeTimer() {
  let id = 0, t = 0;
  const q = [];
  return {
    q, get now() { return t; },
    set(fn, ms) { q.push({ id: ++id, fn, at: t + ms, ms }); return id; },
    clear(x) { const i = q.findIndex(e => e.id === x); if (i >= 0) q.splice(i, 1); },
    // move the clock on, firing whatever falls due (including timers they set)
    advance(ms) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const e = q[0]; if (!e || e.at > end) break; q.shift(); t = e.at; e.fn(); } t = end; },
  };
}

function harness(opts) {
  const h = { said: [[], [], []], states: [0, 0, 0], timer: fakeTimer(), problems: [] };
  h.match = new OnlineMatch(Object.assign({ names: ['Ann', 'Ben', 'Gandalf'], computer: { level: 'hard' }, theme: 'lotr', rounds: 1, hand: 12, stepDelay: 0,
    sleep: async () => {}, rng: mulberry32(1), chatRng: mulberry32(77), timer: h.timer, now: () => h.timer.now }, opts, {
    push(seat, msg) {
      if (seat > 1) h.problems.push('a message was sent to the computer seat');
      if (msg.t === 'say') h.said[seat].push(msg); else if (msg.t === 'state') h.states[seat]++;
    },
  }));
  return h;
}
function policy(rnd) {
  return v => {
    const a = v.awaiting;
    if (a.kind === 'modal') return { a: 'ok' };
    if (a.kind === 'draw') return { a: 'draw' };
    const pick = () => a.moves[Math.floor(rnd() * a.moves.length)];
    if (a.kind === 'move') { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    if (a.canDraw) return { a: 'draw' };
    if (a.moves.length && rnd() < 0.6) { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    if (a.canDone) return { a: 'done' };
    if (a.moves.length) { const m = pick(); return { a: 'play', tile: m.tile, train: m.trainId }; }
    return { a: 'undo' };
  };
}
// play it out; after every step a little time passes, so the comments' short delays (well under the slow-player jabs) run
async function playOut(h, pols, step) {
  const m = h.match, run = m.start();
  for (let n = 0; !m.over && n < 30000; n++) {
    for (const seat of m.humans) {
      const v = m.viewFor(seat);
      if (v.awaiting && !m.paused) { const r = m.intent(seat, pols[seat](v)); if (!r.ok) h.problems.push('refused: ' + r.code); }
    }
    h.timer.advance(step === undefined ? 1500 : step);
    await tick();
  }
  if (!m.over) m.abort();
  await run;
  return m.over === 'finished';
}
const inVoice = (name, kind, text) => {
  const pool = T.voices[name][kind] || [];
  return pool.some(l => l === text || (l.includes('{') && new RegExp('^' + l.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{built\}|\{best\}/g, '\\d+').replace(/tiles/g, 'tiles?') + '$').test(text)));
};

(async () => {
  console.log('1. whole online matches with a talking computer character');
  let total = 0, bad = [], kinds = new Set(), perSeat = [0, 0], finished = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const level = ['easy', 'normal', 'hard'][seed % 3], name = T.players[level][seed % T.players[level].length];
    const h = harness({ rng: mulberry32(seed), chatRng: mulberry32(seed + 900), names: ['Ann', 'Ben', name], computer: { level }, hand: [8, 12, 15][seed % 3] });
    if (await playOut(h, [policy(mulberry32(seed + 1)), policy(mulberry32(seed + 2))])) finished++;
    bad.push(...h.problems);
    [0, 1].forEach(seat => h.said[seat].forEach(s => {
      total++; perSeat[seat]++; kinds.add(s.kind);
      if (s.from !== name) bad.push(`from ${s.from}, not ${name}`);
      if (!KINDS.includes(s.kind)) bad.push(`unknown kind ${s.kind}`);
      const food = T.food[name].d.some(d => s.text.includes(d));
      if (!inVoice(name, s.kind, s.text) && !(s.kind.startsWith('slow') && food)) bad.push(`${name} (${s.kind}) said "${s.text}"`);
      if (s.lang) bad.push('a character spoke in another language');
    }));
  }
  ok(finished === 12, 'all 12 matches finished');
  ok(total > 100 && perSeat.every(n => n > 20), `${total} comments, to both people (${perSeat.join(' and ')})`);
  ok(bad.length === 0, 'every comment comes from the computer character, in its own voice' + (bad[0] ? `: ${bad[0]}` : ''));
  ok(['great', 'good', 'poor', 'awful', 'draw', 'pass'].every(k => kinds.has(k)) && [...kinds].some(k => k.startsWith('open')), `it comments on moves, draws, passes and opening trains (${[...kinds].sort().join(', ')})`);

  console.log('2. each comment goes to the person it is about');
  {
    // Ann lays one tile and stops (a short opening is always remarked on); Ben builds his longest train. Find a deal where
    // Ann's longest train is longer than one tile.
    let found = false;
    for (let seed = 1; seed < 40 && !found; seed++) {
      const h = harness({ rng: mulberry32(seed), chatRng: () => 0, hand: 12 });      // chance 0: it says something whenever it may
      const m = h.match, run = m.start();
      await tick(); await tick();
      const va = m.viewFor(0);
      if (!va.awaiting || va.awaiting.canDraw || va.awaiting.buildCount < 2) { m.abort(); await run; continue; }
      found = true;
      m.intent(0, { a: 'play', tile: va.awaiting.moves[0].tile, train: 'human' });
      await tick();
      const v2 = m.viewFor(0);
      m.intent(0, v2.awaiting.canDone ? { a: 'done' } : { a: 'play', tile: v2.awaiting.moves[0].tile, train: 'human' });
      if (m.awaiting[0] && m.viewFor(0).awaiting.canDone) m.intent(0, { a: 'done' });
      await tick(); h.timer.advance(2000); await tick();
      const annOpen = h.said[0].filter(s => s.kind === 'openShort');
      ok(annOpen.length === 1, `Ann hears about her short opening: "${annOpen[0] && annOpen[0].text}"`);
      ok(!h.said[1].some(s => s.kind === 'openShort'), 'Ben, who has not finished, hears nothing about it');
      m.abort(); await run;
    }
    ok(found, '(a deal for it was found)');
  }

  console.log('3. taking too long');
  {
    const h = harness({ rng: mulberry32(8), chatRng: mulberry32(3), foodChance: 0.5, names: ['Ann', 'Ben', 'Sam'], computer: { level: 'normal' } });
    const m = h.match, run = m.start();
    await tick(); await tick();
    // Ben builds and finishes; Ann just sits there
    for (let g = 0; g < 200 && !m.game.opening.cpu.finished; g++) { const v = m.viewFor(1); if (v.awaiting) m.intent(1, v.awaiting.canDraw ? { a: 'draw' } : v.awaiting.canBuild ? { a: 'autoBuild' } : { a: 'done' }); h.timer.advance(5); await tick(); }
    h.timer.advance(1200);                                    // (the reactions to Ben's own opening land first)
    const a0 = h.said[0].length, b0 = h.said[1].length;
    h.timer.advance(23000);
    ok(h.said[0].length === a0, 'nothing in the first 25 seconds');
    h.timer.advance(1500);
    const first = h.said[0].slice(a0);
    ok(first.length === 1 && first[0].kind === 'slow1', `then a first jab to Ann: "${first[0] && first[0].text}"`);
    h.timer.advance(26000 * 6);
    const jabs = h.said[0].slice(a0);
    ok(jabs.length >= 6 && jabs.every((s, i) => s.kind === 'slow' + Math.min(3, i + 1)), `and one every 20 to 26 seconds, getting ruder (${jabs.map(s => s.kind).join(', ')})`);
    ok(h.said[1].length === b0, 'Ben hears none of it');
    const food = jabs.filter(s => T.food.Sam.d.some(d => s.text.includes(d)));
    const dishes = new Set(food.map(s => T.food.Sam.d.findIndex(d => s.text.includes(d))));
    ok(food.length >= 1 && dishes.size === 1, `Sam gets hungry for his own food, the same dish all wait (${food.map(s => s.text).join(' / ')})`);
    ok(jabs.filter(s => !food.includes(s)).every(s => inVoice('Sam', s.kind, s.text)), 'the rest are Sam\'s own slow-player lines');
    // Ann acts: the jabs stop for that wait
    const v = m.viewFor(0); m.intent(0, v.awaiting.canDraw ? { a: 'draw' } : { a: 'done' });
    const a1 = h.said[0].length;
    await tick(); h.timer.advance(10);
    const stillWaiting = !!m.awaiting[0];
    h.timer.advance(stillWaiting ? 0 : 60000);
    ok(stillWaiting || h.said[0].length - a1 <= 2, 'acting stops them');
    // paused: no jabs
    m.setPaused(true);
    h.timer.advance(1200);                                    // (any reaction already on its way)
    const a2 = h.said[0].length, b2 = h.said[1].length;
    h.timer.advance(200000);
    ok(h.said[0].length === a2 && h.said[1].length === b2, 'nobody is teased while the game is paused');
    m.setPaused(false);
    m.abort(); await run;
    ok(h.timer.q.length === 0, 'when the match ends, every comment timer is cleared');
  }

  console.log('4. classic players, other languages, and no computer');
  {
    const h = harness({ theme: 'classic', names: ['Ann', 'Ben', 'Dmitri'], computer: { level: 'hard' }, nativeChance: 1, foodChance: 0, chatRng: mulberry32(4) });
    await playOut(h, [policy(mulberry32(1)), policy(mulberry32(2))]);
    const all = h.said[0].concat(h.said[1]);
    const ru = all.filter(s => s.lang === 'ru');
    ok(all.length > 5 && ru.length > 0 && ru.every(s => /[а-яё]/i.test(s.text) && /^[\x20-\x7e]+$/.test(s.trans)), `a classic Dmitri speaks Russian with an English translation (${ru[0] && ru[0].text} / ${ru[0] && ru[0].trans})`);
    const en = all.filter(s => !s.lang);
    ok(en.every(s => Object.values(G.LINES.hard).flat().some(l => l === s.text || l.includes('{'))), 'and otherwise the Hard level\'s classic lines');
    const n = harness({ names: ['Ann', 'Ben'], computer: undefined });
    await playOut(n, [policy(mulberry32(1)), policy(mulberry32(2))], 60000);
    ok(n.said[0].length === 0 && n.said[1].length === 0, 'two people and no computer: nobody comments');
  }

  console.log('5. comments change nothing in play');
  {
    const runWith = async (chatRng, chance) => {
      const h = harness({ rng: mulberry32(31), chatRng, foodChance: chance, nativeChance: chance, hand: 15, rounds: 4 });
      await playOut(h, [policy(mulberry32(41)), policy(mulberry32(42))], 30000);
      return { totals: JSON.stringify(h.match.totals), log: JSON.stringify(h.match.logs), said: h.said[0].length + h.said[1].length };
    };
    const a = await runWith(() => 0, 1), b = await runWith(() => 0.999, 0);
    ok(a.said > 0 && b.said < a.said, `a chatty computer (${a.said} comments) and a nearly silent one (${b.said})...`);
    ok(a.totals === b.totals && a.log === b.log, '...play exactly the same game: same moves, same scores');
  }

  console.log('6. through the real server and page');
  {
    const PAGE = require('path').join(__dirname, '..', 'mexican-train.html');
    const srv = createGameServer({ pagePath: PAGE, stepDelay: 0, sleep: ms => wait(Math.min(ms, 60)),          // a little thinking time, so the game lasts long enough for comments
      log: () => {}, heartbeatMs: 60000, ratePerSecond: 5000, burst: 10000 });
    const port = await srv.listen(0, '127.0.0.1');
    const mk = () => {
      const c = { screens: [], store: {} };
      const root = { _h: '', set innerHTML(v) { this._h = v; c.screens.push(v); }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
      c.app = G.createApp({ root, rng: mulberry32(1), sleep: async () => {}, reducedMotion: true, now: () => Date.now(), chatRng: () => 1, nativeChance: 0, foodChance: 0,
        storage: { get: k => (k in c.store ? c.store[k] : null), set: (k, v) => { c.store[k] = v; } }, fetch: async () => ({ ok: true, json: async () => ({ addresses: [`127.0.0.1:${port}`], preferred: `127.0.0.1:${port}` }) }),
        infoUrl: `http://127.0.0.1:${port}/info`, WebSocket, sound: { unlock() {}, clack() {}, turn() {} }, defaultServer: `127.0.0.1:${port}` });
      c.S = c.app.state; c.d = a => c.app.dispatch(a); c.html = () => root.innerHTML;
      c.d({ type: 'boot' });
      return c;
    };
    const host = mk(), guest = mk();
    host.d({ type: 'openHost' }); await until(() => host.S.hostInfo && host.S.hostInfo.state === 'ready');
    host.d({ type: 'hostGame', server: `127.0.0.1:${port}`, name: 'Ann', rounds: 1, hand: 15, computer: 'easy', theme: 'lotr' });
    await until(() => host.S.online && host.S.online.phase === 'lobby' && host.S.online.code);
    guest.d({ type: 'openJoin' }); guest.d({ type: 'joinGame', server: `127.0.0.1:${port}`, name: 'Ben', code: host.S.online.display });
    await until(() => host.S.online.canStart);
    const who = host.S.online.players[2].name;
    host.d({ type: 'startOnline' });
    await until(() => host.S.game && guest.S.game);
    ok(/Say something/.test(host.html()) && /data-action="toggleChat"[^>]*>Comments: on</.test(host.html()) && /data-action="toggleChat"[^>]*>Comments: on</.test(guest.html()), 'each player has a Comments switch on the computer\'s row (and still Say something)');
    guest.d({ type: 'toggleChat' });
    ok(guest.S.opts.chat === false && /Comments: off/.test(guest.html()), 'Ben turns the computer\'s comments off');
    const pol = r => c => { const a = c.S.awaiting, o = c.S.online; if (!a || !o || o.pending || o.conn !== 'open') return; const pick = () => a.moves[Math.floor(r() * a.moves.length)];
      if (a.kind === 'modal') c.d({ type: 'dialogOk' }); else if (a.kind === 'draw') c.d({ type: 'draw' });
      else if (a.kind === 'move') { const mv = pick(); c.d({ type: 'selectTile', key: mv.tile.join('-') }); if (c.S.awaiting === a) c.d({ type: 'playOn', train: mv.trainId }); }
      else if (a.canDraw) c.d({ type: 'draw' }); else if (a.moves.length && r() < 0.5) { const mv = pick(); c.d({ type: 'selectTile', key: mv.tile.join('-') }); } else if (a.canDone) c.d({ type: 'endBuild' }); else c.d({ type: 'undoTile' }); };
    const pa = pol(mulberry32(3)), pb = pol(mulberry32(4));
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && !(host.S.modal && host.S.modal.type === 'final' && guest.S.modal && guest.S.modal.type === 'final')) { pa(host); pb(guest); await wait(3); }
    await wait(1300);
    const bubbles = c => c.screens.map(h => h.match(/<div class="bubble(?: native)?(?: in)?"><b>([^<]*)<\/b><span[^>]*>([^<]*)<\/span>/)).filter(Boolean).map(m => ({ from: unesc(m[1]), text: unesc(m[2]) }));
    const hb = bubbles(host).filter(b => b.from === who), gb = bubbles(guest).filter(b => b.from === who);
    ok(hb.length > 0 && hb.every(b => Object.values(T.voices[who]).flat().some(l => l === b.text || l.includes('{')) || T.food[who].d.some(d => b.text.includes(d))), `Ann sees ${who}'s comments in speech bubbles, in ${who}'s voice (${[...new Set(hb.map(b => b.text))].slice(0, 2).join(' / ')})`);
    ok(gb.length === 0, 'Ben, with comments off, sees none');
    srv.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
