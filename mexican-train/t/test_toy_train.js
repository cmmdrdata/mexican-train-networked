'use strict';
// The marker on an open train is a toy train in its player's colour (it used to be a lantern).
require('./game.js');
const fs = require('fs');
const G = globalThis.MexicanTrainGame;
const { mulberry32, key } = G.Engine;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const css = fs.readFileSync('../style.css', 'utf8');
const gameSrc = fs.readFileSync('../game.js', 'utf8');

console.log('1. the drawing');
{
  const ids = [0, 1, 2, 3];                                    // the colour of a seat at the table
  const svgs = ids.map(id => G.toyTrainSVG(id));
  ok(svgs.every((s, i) => s.startsWith(`<span class="toy-train c${ids[i]}" aria-hidden="true"><svg viewBox="0 0 62 40"`) && s.endsWith('</svg></span>')), 'a decorative <svg> in a span carrying the player\'s colour class, hidden from screen readers (the "Open: ..." text says it for them)');
  const wellFormed = s => { const st = []; for (const m of s.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) { if (m[4] === '/') continue; if (m[1]) { if (st.pop() !== m[2]) return false; } else st.push(m[2]); } return st.length === 0; };
  ok(svgs.every(wellFormed), 'the markup is well formed');
  const idsOf = s => Array.from(s.matchAll(/ id="([^"]+)"/g)).map(m => m[1]);
  const refsOf = s => Array.from(s.matchAll(/url\(#([^)]+)\)/g)).map(m => m[1]);
  ok(svgs.every(s => refsOf(s).length >= 8 && refsOf(s).every(r => idsOf(s).includes(r))), 'every gradient it refers to is defined in the drawing (shaded, not flat)');
  const all = svgs.flatMap(idsOf);
  ok(new Set(all).size === all.length && all.length === 16, 'each colour\'s four gradients have ids of their own (several trains on one page must not borrow each other\'s shades): ' + all.length + ' different ids');
  // one colour: every shade is made from the player's own colour variables; the only other thing is white shine
  ok(svgs.every(s => Array.from(s.matchAll(/stop-color:([^"]+)"/g)).length >= 9 && Array.from(s.matchAll(/stop-color:([^"]+)"/g)).every(m => /^var\(--tc(-hi|-lo|-dk)?\)$/.test(m[1]))), 'every shade in the gradients is the player\'s colour (lighter or darker): var(--tc), --tc-hi, --tc-lo or --tc-dk');
  ok(svgs.every(s => Array.from(s.matchAll(/ fill="([^"]*)"/g)).every(m => m[1] === 'none' || /^url\(#[\w-]+\)$/.test(m[1]))), 'every fill is one of those gradients');
  ok(svgs.every(s => Array.from(s.matchAll(/ stroke="([^"]*)"/g)).every(m => /^var\(--tc-(lo|dk)\)$/.test(m[1]) || m[1] === '#fff')) && svgs.every(s => (s.match(/#[0-9a-fA-F]{3,6}\b/g) || []).every(c => c === '#fff') && !/rgb|hsl|cream|black|white/i.test(s)), 'and every outline is a darker shade of it, or white shine: no second colour anywhere');
  const shine = s => Array.from(s.matchAll(/stroke="#fff" stroke-opacity="([\d.]+)"/g)).map(m => +m[1]);
  ok(svgs.every(s => shine(s).length >= 3 && shine(s).every(o => o > 0 && o < 1)), 'with several see-through white shine strokes on top of the shading (the gloss)');
  // the wheels, and the body that covers half of them
  const circles = s => Array.from(s.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)).map(m => ({ cx: +m[1], cy: +m[2], r: +m[3], at: m.index }));
  const rects = s => Array.from(s.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)).map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], at: m.index }));
  ok(svgs.every(s => circles(s).length === 2) && svgs.every(s => { const [a, b] = circles(s); return a.cy === b.cy && a.r === b.r && a.cx !== b.cx; }), 'exactly two wheels, the same size, side by side on the same level');
  ok(svgs.every(s => { const cy = circles(s)[0].cy; return rects(s).filter(r => Math.abs(r.y + r.h - cy) < 0.01).length >= 2; }), 'the body (cab and boiler) comes down exactly to the middle of the wheels, so it covers the top half of each');
  ok(svgs.every(s => circles(s).every(c => rects(s).filter(r => Math.abs(r.y + r.h - c.cy) < 0.01).every(r => c.at < r.at))), 'and the wheels are drawn first, so the body is in front of them and only the lower half of each shows');
  ok(svgs.every(s => circles(s).every(c => c.cy + c.r > 38.5 && c.cy + c.r <= 40)) && svgs.every(s => { const m = s.match(/M42 14 v-7 l-2 -3/); return !!m; }), 'the overall height is unchanged: the stack still starts at the top (y 4) and the wheels still reach the bottom (y 39.3) of the 40-high drawing');
  ok(!/lantern/i.test(svgs.join('')), '(and there is no lantern in it)');
  ok(G.toyTrainSVG(0) === G.toyTrainSVG(0) && G.toyTrainSVG(0) !== G.toyTrainSVG(1), '(it is the same every time, and differs by colour)');
}

console.log('2. the colours and the size');
{
  const rule = cls => { const m = css.match(new RegExp('\\.toy-train\\.' + cls + '\\s*\\{([^}]*)\\}')); return m ? m[1] : ''; };
  const get = (r, v) => (r.match(new RegExp('--' + v + ':\\s*(#[0-9a-f]{6})', 'i')) || [])[1];
  const sets = ['c0', 'c1', 'c2', 'c3'].map(c => { const r = rule(c); return { base: get(r, 'tc'), hi: get(r, 'tc-hi'), lo: get(r, 'tc-lo'), dk: get(r, 'tc-dk') }; });
  ok(sets.every(s => s.base && s.hi && s.lo && s.dk), 'each player has a colour with a highlight shade, a shadow shade and a deep shade');
  const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  ok(sets.every(s => lum(s.hi) > lum(s.base) && lum(s.base) > lum(s.lo) && lum(s.lo) > lum(s.dk)), 'the shades step from light to dark: highlight, colour, shadow, deep (the sheen and the rounded, 3D look)');
  const hue = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return 0; const d = mx - mn; const hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (hh * 60 + 360) % 360; };
  const gap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  ok(sets.every(s => [s.hi, s.lo, s.dk].every(c => gap(hue(c), hue(s.base)) < 14)), 'all the shades of a player\'s train are the same hue as its colour, so it stays one solid colour, just lit and shadowed');
  const hs = sets.map(s => hue(s.base));
  ok(new Set(sets.map(s => s.base)).size === 4 && gap(hs[0], hs[1]) > 60 && gap(hs[0], hs[2]) > 30 && gap(hs[1], hs[2]) > 60 && [0, 1, 2].every(i => gap(hs[3], hs[i]) > 30), `the seats' colours are far apart on the colour wheel (red ${hs[0].toFixed(0)}°, blue ${hs[1].toFixed(0)}°, yellow ${hs[2].toFixed(0)}°, green ${hs[3].toFixed(0)}°)`);
  ok(/\.toy-train\s*\{[^}]*pointer-events:\s*none/.test(css) && /\.toy-train\s*\{[^}]*position:\s*absolute/.test(css), 'the toy train never catches a click (a tap on it is a tap on the train) and sits over the row at its left edge');
  const sz = css.match(/\.toy-train svg\s*\{[^}]*height:\s*calc\(var\(--s\) \* ([\d.]+)\);\s*width:\s*calc\(var\(--s\) \* ([\d.]+)\)/);
  const h = sz && +sz[1], w = sz && +sz[2], OLD_H = 1.25, OLD_W = 2.58;
  ok(sz && Math.abs(h / OLD_H - 0.67) < 0.02 && Math.abs(w / OLD_W - 0.5) < 0.02, `the size is unchanged: ${h} x the tile size high and ${w} wide (a third smaller and half as long as the first design)`);
  ok(sz && Math.abs(w / h - 62 / 40) < 0.02, 'in the drawing\'s own proportions (62 x 40), so nothing is squashed');
  ok(new RegExp('\\.track\\.has-toy \\.track-tiles\\s*\\{\\s*padding-left:\\s*calc\\(var\\(--s\\) \\* ' + w + ' \\+ 22px\\)').test(css), 'and the row leaves exactly the room it takes, so it never covers the first domino');
}

(async () => {
console.log('3. when it appears (every screen of whole games)');
function makeApp(seed) {
  const c = { renders: [], html: '' };
  const root = { set innerHTML(v) { c.html = v; if (c.S && c.S.game) c.renders.push({ html: v, markers: ['human', 'cpu', 'cpu2', 'mexican'].filter(id => c.S.game.trains[id]).map(id => [id, !!c.S.game.trains[id].marker]), hidden: ['cpu', 'cpu2'].filter(id => c.S.game.opening && c.S.game.opening[id] && !c.S.game.opening[id].finished) }); }, get innerHTML() { return c.html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  c.app = G.createApp({ root, rng: mulberry32(seed), paceRng: () => 0, sleep: async () => {}, reducedMotion: true, chatRng: () => 1, storage: { get: () => null, set() {} } });
  c.S = c.app.state; c.d = a => c.app.dispatch(a); c.app.dispatch({ type: 'boot' });
  return c;
}
const tracksOf = html => html.split(/<div class="track(?=[ "])/).slice(1).map(b => ({ id: (b.match(/data-train="(\w+)"/) || [])[1], block: b, has: /\bhas-toy\b/.test(b.slice(0, b.indexOf('>'))), toy: (b.match(/class="toy-train (c\d)"/) || [])[1] || null, label: ((b.match(/class="track-name">([^<]*)</) || [])[1] || '') }));
{
  let screens = 0, withToy = 0, wrong = [], mexican = 0;
  for (const seed of [3, 5, 8, 12, 21, 30]) {
    const c = makeApp(seed); c.d({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: ['easy', 'normal', 'hard'][seed % 3] });
    let guard = 0;
    while (!(c.S.modal && c.S.modal.type === 'roundEnd') && guard++ < 5000) {
      const a = c.S.awaiting;
      if (a && a.kind === 'move') { const m = a.moves[0]; c.d({ type: 'selectTile', key: key(m.tile) }); if (c.S.awaiting === a) c.d({ type: 'playOn', train: m.trainId }); }
      else if (a && a.kind === 'draw') c.d({ type: 'draw' });
      else if (a && a.kind === 'build') c.d({ type: a.canDraw ? 'draw' : a.canBuild ? 'autoBuild' : a.canDone ? 'endBuild' : 'undoTile' });
      await wait(0);
    }
    for (const r of c.renders) {
      screens++;
      const tr = tracksOf(r.html);
      for (const [id, marker] of r.markers) {
        if (id === 'mexican') { if (tr.find(t => t.id === 'mexican').toy) mexican++; continue; }
        const t = tr.find(x => x.id === id);
        const want = marker && !r.hidden.includes(id);
        const colour = id === 'human' ? 'c0' : 'c1';                    // against the computer: you are red, it is blue
        if ((want ? t.toy !== colour : t.toy !== null) || t.has !== want) wrong.push(`seed ${seed}: ${id} marker ${marker}, drawn ${t.toy}`);
        if (want) withToy++;
      }
    }
  }
  ok(screens > 500 && withToy > 20, `${screens} screens in six whole games; the toy train was drawn on ${withToy} train-screens`);
  ok(wrong.length === 0, 'on every screen: a train has its toy train exactly when its marker is on (and it is not still being built), you in red (c0) and the computer in blue (c1), and nowhere else' + (wrong[0] ? ' (' + wrong[0] + ')' : ''));
  ok(mexican === 0, 'the Mexican train, which is always open, never has one');
}

console.log('4. wording: no lantern anywhere');
{
  const c = makeApp(5); c.d({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'normal' });
  ok(!/lantern/i.test(gameSrc), 'the word does not appear anywhere in the game\'s code, text or jokes');
  ok(!/lantern/i.test(fs.readFileSync('../online-match.js', 'utf8')) && /A marker goes on their train/.test(fs.readFileSync('../online-match.js', 'utf8')), 'nor in the online game\'s messages, which now say "A marker goes on their train: you can play there."');
  c.d({ type: 'openRules' });
  ok(/toy train marker/.test(c.html) && !/lantern/i.test(c.html), 'the Rules screen explains markers');
  ok(!/lantern/i.test(JSON.stringify(G.LINES)) && !/lantern/i.test(JSON.stringify(G.NATIVE_LINES)), 'and none of the computer players\' lines (English or native-language) mention lanterns');
  ok(/Маркер/.test(JSON.stringify(G.NATIVE_LINES)) && /マーカー/.test(JSON.stringify(G.NATIVE_LINES)) && /标记/.test(JSON.stringify(G.NATIVE_LINES)) && /마커/.test(JSON.stringify(G.NATIVE_LINES)) && /मार्कर/.test(JSON.stringify(G.NATIVE_LINES)), '(the five native-language pass remarks were reworded in their own scripts)');
}

console.log('5. online, with three players');
{
  class FakeWS { constructor() { this.readyState = 0; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); } send() {} close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
  let html = '';
  const root = { set innerHTML(v) { html = v; }, get innerHTML() { return html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const app = G.createApp({ root, sleep: async () => {}, reducedMotion: true, storage: { get: () => null, set() {} }, WebSocket: FakeWS, fetch: async () => ({ ok: true, json: async () => ({ addresses: ['fake:1'], preferred: 'fake:1' }) }) });
  app.dispatch({ type: 'boot' }); app.dispatch({ type: 'openHost' }); await wait(5); app.dispatch({ type: 'hostGame', server: 'x', name: 'Me', rounds: 4, hand: 15 }); await wait(10);
  FakeWS.last.say({ t: 'created', code: 'ABCDEF', display: 'ABC-DEF', token: 't', seat: 0, settings: { rounds: 4, hand: 15 }, addresses: [] });
  const T = (a, b) => [a, b], tr = (id, marker) => ({ id, marker: !!marker, tiles: [], end: 12 });
  // a view as the server sends it: `seats` are the table seats of [you, first opponent, second opponent]; `names` are theirs
  const view = (m, seats = [0, 1, 2], names = ['Me', 'Ben', 'Zed']) => ({ seq: ++view.n, round: 0, rounds: 4, me: { name: names[0], seat: seats[0] }, opp: { name: names[1] }, opps: [{ id: 'cpu', name: names[1], seat: seats[1], computer: false }, { id: 'cpu2', name: names[2], seat: seats[2], computer: true, level: 'normal' }], totals: { human: 0, cpu: 0, cpu2: 0 }, paused: false, over: null, log: [], banner: '', modal: null, awaiting: null,
    game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [T(1, 2)] }, { id: 'cpu', name: names[1], hand: [T(-1, -1)] }, { id: 'cpu2', name: names[2], hand: [T(-1, -1)] }], boneyard: [T(-1, -1)], trains: { human: tr('human', m.human), cpu: tr('cpu', m.cpu), cpu2: tr('cpu2', m.cpu2), mexican: tr('mexican') }, openDouble: null, opening: null } });
  view.n = 0;
  FakeWS.last.say({ t: 'state', seq: 1, view: view({ human: true, cpu: true, cpu2: true }), events: [] });
  let t = tracksOf(html);
  ok(t.find(x => x.id === 'human').toy === 'c0' && t.find(x => x.id === 'cpu').toy === 'c1' && t.find(x => x.id === 'cpu2').toy === 'c2' && !t.find(x => x.id === 'mexican').toy, 'with all three players\' trains open, each wears a toy train of its seat\'s colour (seats 0, 1, 2: red, blue, yellow), and the Mexican train none');
  const byOwner = (html, you) => { const o = {}; tracksOf(html).forEach(x => { if (x.toy) o[x.label === 'Your train' ? you : x.label.replace(/'s train$/, '')] = x.toy; }); return o; };
  const annScreen = byOwner(html, 'Ann');
  // ...and the same game on the other person's screen: Ben is in seat 1, so on his screen the computer (seat 2) comes first, then Ann (seat 0)
  FakeWS.last.say({ t: 'state', seq: 2, view: view({ human: true, cpu: true, cpu2: true }, [0, 1, 2], ['Ann', 'Ben', 'Zed']), events: [] });
  const ann = byOwner(html, 'Ann');
  FakeWS.last.say({ t: 'state', seq: 3, view: view({ human: true, cpu: true, cpu2: true }, [1, 2, 0], ['Ben', 'Zed', 'Ann']), events: [] });
  const ben = byOwner(html, 'Ben');
  ok(ann.Ann === 'c0' && ann.Ben === 'c1' && ann.Zed === 'c2' && ben.Ann === ann.Ann && ben.Ben === ann.Ben && ben.Zed === ann.Zed, `the same player has the same colour on everybody's screen, although each screen labels the players differently: Ann's screen ${JSON.stringify(ann)}, Ben's screen ${JSON.stringify(ben)}`);
  ok(new Set(Object.values(ben)).size === 3, '(and the three players have three different colours on each)');
  // a view that does not say (an old server), or says something impossible: the usual colours, never an exception
  FakeWS.last.say({ t: 'state', seq: 4, view: Object.assign(view({ human: true, cpu: true }, [2, 2, 1]), {}), events: [] });
  ok(byOwner(html, 'Me').Me === 'c0' && byOwner(html, 'Me').Ben === 'c1', 'seats that clash (two players in one seat) are ignored: the usual colours are used instead');
  const noSeats = view({ human: true, cpu: true }); delete noSeats.me.seat; noSeats.opps.forEach(o => { delete o.seat; });
  FakeWS.last.say({ t: 'state', seq: 5, view: noSeats, events: [] });
  ok(byOwner(html, 'Me').Me === 'c0' && byOwner(html, 'Me').Ben === 'c1', 'a view with no seats (an older server) gets the usual colours too');
  FakeWS.last.say({ t: 'state', seq: 6, view: view({ human: true, cpu: true, cpu2: true }), events: [] });
  FakeWS.last.say({ t: 'state', seq: 10, view: view({ cpu2: true }), events: [] });
  t = tracksOf(html);
  ok(t.filter(x => x.toy).length === 1 && t.find(x => x.id === 'cpu2').toy === 'c2', 'when only the computer\'s train is open, only that one has it, in the computer\'s seat colour');
  ok(/Open: you can play here/.test(html), '(and its note still says it is open)');
  // states the real engine never sends, to show the page cannot be talked into drawing one in the wrong place
  const odd = view({ cpu: true }); odd.game.trains.mexican.marker = true; odd.game.trains.cpu.marker = true;
  odd.game.opening = { human: { finished: true }, cpu: { finished: false }, cpu2: { finished: true } };
  FakeWS.last.say({ t: 'state', seq: 11, view: odd, events: [] });
  t = tracksOf(html);
  ok(!t.find(x => x.id === 'mexican').toy && !t.find(x => x.id === 'cpu').toy, 'a marker flagged on the Mexican train, or on a train its owner is still building face down, is not drawn');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
