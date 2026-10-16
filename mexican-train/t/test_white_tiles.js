'use strict';
// The back of a domino is the same off-white as the face of a blank tile (the game's bone colour), with no line and no dot; and the end-of-round dialog shows its tiles, that same off-white, on a contrasting colour from the game's palette.
const fs = require('fs'), path = require('path');
require('./game.js');
const G = globalThis.MexicanTrainGame;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'mexican-train.html'), 'utf8');
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = hex => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rule = sel => { const i = css.indexOf(sel + ' {'); if (i < 0) return null; return css.slice(i, css.indexOf('}', i) + 1); };

console.log('1. the back of a tile (the SVG one, in a train)');
for (const orient of ['h', 'v']) {
  const svg = G.tileBackSVG(orient, 'pop', 3);
  const parts = svg.replace(/<svg[^>]*>/, '').replace('</svg>', '');
  ok((svg.match(/<rect/g) || []).length === 1 && /fill="#f6f0e0"/.test(svg) && !/#ffffff/i.test(svg), `${orient}: one shape, filled with the off-white of a blank tile's face (#f6f0e0), not pure white`);
  ok(!/stroke|<circle|<line|<path|<polygon|<ellipse|<text|dasharray|<g\b/.test(svg), `${orient}: no outline, no dot, no line, nothing else at all`);
  ok(parts.split('<').length === 2, `${orient}: the only thing inside the tile is that rectangle`);
  ok(/aria-label="face-down tile"/.test(svg) && /class="tile [hv] back pop"/.test(svg) && /data-idx="3"/.test(svg), `${orient}: and it is still a face-down tile to everything that finds it (class, label, index)`);
}
ok(!/#2a6a60|#123d36|#8fc2b6|stroke-dasharray="7 6"/.test(html) && !/#2f7468|#1e5149|#0a2c27/.test(html), 'the old teal of the backs, their dark outline, their dashed border and the dark rim of the small ones are gone from the page');

console.log('2. the other backs: the small ones in the opponent\'s row, and the boneyard');
{
  const back = rule('.back'), stack = rule('.boneyard .stack i');
  ok(back && /background:\s*var\(--bone\)/.test(back) && /border:\s*0/.test(back) && !/gradient/.test(back), 'the small backs in the opponent\'s row: the bone off-white (the palette\'s own --bone), no border');
  ok(stack && /background:\s*var\(--bone\)/.test(stack) && /border:\s*0/.test(stack) && !/gradient/.test(stack), 'the boneyard\'s stack of backs: the bone off-white, no border');
  ok(/box-shadow:[^;]*rgba\(0, 0, 0/.test(back) && /box-shadow:[^;]*rgba\(0, 0, 0/.test(stack), 'each with a soft shadow, so that the tiles are told apart from one another without a line drawn on them');
  ok(/\.tile \{[^}]*drop-shadow/.test(css), '(and the tiles of a train have theirs)');
  ok((css.match(/class="back"/g) || []).length === 0, '(no other style for a back is left to disagree)');
}

console.log('3. the end-of-round dialog: the ordinary off-white tiles');
{
  const b = G.tileSVG(3, 5, { orient: 'h', style: 'pips' }), back = G.tileBackSVG('h');
  ok(/<rect[^>]*fill="#f6f0e0"/i.test(b) && !/#ffffff/i.test(b), 'a tile\'s face is the bone off-white');
  ok(back.match(/fill="(#[0-9a-f]{6})"/i)[1].toLowerCase() === b.match(/<rect[^>]*fill="(#[0-9a-f]{6})"/i)[1].toLowerCase(), 'and the back of a tile is exactly the same colour as the face of a blank tile');
  ok(/<line/.test(b) && (b.match(/<circle/g) || []).length >= 8 && /<circle[^>]*fill="#d6a84f"/.test(b), 'the face still has its middle line, its pips and its brass pin (only the back is bare)');
  ok(!/white/.test(G.tileSVG.toString()), '(and there is no longer a special white face: the round-end tiles are the ordinary ones)');
}
{
  // the real dialog, through the real page
  const makeRoot = () => ({ _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} });
  for (const style of ['pips', 'numbers']) {
    const root = makeRoot(), store = {};
    const app = G.createApp({ root, rng: G.Engine.mulberry32(3), sleep: async () => {}, reducedMotion: true, chatRng: () => 1, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } });
    app.dispatch({ type: 'startGame', rounds: 2, hand: 8, style, level: 'easy' });
    app.state.modal = { type: 'roundEnd', blocked: false, tie: false, winnerId: 'cpu', last: false, totals: { human: 40, cpu: 10 }, rows: [{ id: 'human', name: 'You', hand: [[3, 4], [6, 6], [0, 9], [12, 11]], pips: 40 }, { id: 'cpu', name: 'Nadia', hand: [], pips: 0 }] };
    app.render(true);
    const h = root.innerHTML, mini = (h.match(/<div class="mini"[^>]*>([^]*?)<\/div>/g) || []).join('');
    const faces = Array.from(mini.matchAll(/<svg class="tile[^>]*>\s*<rect [^>]*fill="(#[0-9a-f]{6})"/gi)).map(m => m[1].toLowerCase());
    ok(/class="dialog wide roundend"/.test(h), `${style}: the end-of-round dialog has its own look (class "roundend")`);
    ok(faces.length === 4 && faces.every(f => f === '#f6f0e0'), `${style}: all four of the tiles shown in it have the off-white face of a blank tile (${faces.join(' ')})`);
    ok(!/#ffffff/i.test(mini), `${style}: and none is pure white`);
    ok(/No tiles left/.test(h) && /<b data-pips="0" aria-hidden="true">\+40<\/b>/.test(h), `${style}: the rest of the dialog is as it was (the points, "No tiles left")`);
    // the dialog that shows the final score is not changed
    app.state.modal = { type: 'final', totals: { human: 40, cpu: 10 } }; app.render(true);
    ok(!/roundend/.test(root.innerHTML) && /class="dialog"/.test(root.innerHTML), `${style}: the final-score dialog keeps its own look`);
    // the hand in the game itself is still bone
    app.state.modal = null; app.render(true);
    ok(/class="tile h[^"]*"[^>]*>\s*<rect [^>]*fill="#f6f0e0"/i.test(root.innerHTML), `${style}: and the tiles in the game itself (the hand, the trains) are that same bone colour`);
  }
}

console.log('4. the colour behind them, from the game\'s palette');
{
  const v = (name, scope) => { const m = (scope || css).match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})')); return m && m[1].toLowerCase(); };
  const light = v('felt-deep', css.slice(0, css.indexOf('@media'))), dark = v('felt-deep', css.slice(css.indexOf('@media'))), bone = v('bone');
  const r = rule('.dialog.roundend') || '';
  ok(/--dlg-bg:\s*var\(--felt-deep\)/.test(r), 'the dialog\'s background is the deep felt green, the game\'s own colour (--felt-deep), not a new one');
  ok(/--dlg-ink:\s*var\(--bone\)/.test(r), 'its writing is the game\'s bone colour');
  const muted = (r.match(/--dlg-muted:\s*(#[0-9a-fA-F]{6})/) || [])[1], focus = (r.match(/--dlg-focus:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  ok(light === '#164a42' && dark === '#0d342e' && bone === '#f6f0e0', `the palette values: felt-deep ${light} (light) / ${dark} (dark), bone ${bone}`);
  for (const [mode, bg] of [['light', light], ['dark', dark]]) {
    ok(contrast(bone, bg) >= 7, `${mode}: the off-white tiles against it: ${contrast(bone, bg).toFixed(1)}:1 (at least 7:1)`);
    ok(contrast(bone, bg) >= 7, `${mode}: the writing (bone) against it: ${contrast(bone, bg).toFixed(1)}:1`);
    ok(contrast(muted, bg) >= 4.5, `${mode}: the smaller grey-green writing against it: ${contrast(muted, bg).toFixed(1)}:1 (at least 4.5:1)`);
    ok(contrast(focus, bg) >= 3, `${mode}: the focus outline against it: ${contrast(focus, bg).toFixed(1)}:1 (at least 3:1)`);
  }
  ok(contrast(bone, '#f6f0e0') === 1, '(on the old cream background the tiles were the same colour as it: ' + contrast(bone, '#f6f0e0').toFixed(2) + ':1, which is why the dialog\'s background changed)');
  ok(!/\.dialog\.wide\s*\{[^}]*--dlg/.test(css) && /\.dialog \{[^}]*background: var\(--dlg-bg\)/.test(css), 'and every other dialog keeps the cream (or dark) it had');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
