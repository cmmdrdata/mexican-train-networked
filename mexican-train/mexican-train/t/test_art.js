'use strict';
// The Lord of the Rings board scenery: the files, the build, and where the page uses it. (How it LOOKS and how readable the board stays is measured on
// real pixels in test_browser_lotr_bg.py.)
const fs = require('fs'), path = require('path');
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(2); } return f(); };
const ROOT = path.join(__dirname, '..');

console.log('1. the artwork files');
const names = ['lotr-top', 'lotr-ring', 'lotr-bottom'];
let total = 0;
for (const n of names) {
  const f = path.join(ROOT, 'art', n + '.svg');
  ok(fs.existsSync(f), `${n}.svg exists`);
  const svg = fs.readFileSync(f, 'utf8').trim();
  total += svg.length;
  ok(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[\d ]+"/.test(svg) && /<\/svg>$/.test(svg), `${n}: a plain SVG`);
  ok(!/<script|<image|<foreignObject|<a\b|href=|\son[a-z]+=|<style|@import|url\(\s*["']?(?!#)/i.test(svg), `${n}: nothing in it that could run, link to or load anything else`);
  ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(svg), `${n}: no address but the SVG namespace`);
  ok(!/<text|<tspan|font/i.test(svg), `${n}: no text and no fonts (just shapes)`);
  ok(svg.length < 8000, `${n}: small (${svg.length} bytes)`);
  const opens = (svg.match(/<(?!\/|!)[a-zA-Z]/g) || []).length, selfs = (svg.match(/\/>/g) || []).length, closes = (svg.match(/<\/[a-zA-Z]/g) || []).length;
  ok(opens === selfs + closes, `${n}: every tag is closed (${opens} opened, ${selfs} self-closed, ${closes} closed)`);
}
ok(total < 12000, `the three together are small (${total} bytes)`);
// the colours they use: nothing brighter than the felt (the one rule the artwork is drawn by); gold only at a low opacity
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const FELT_CENTRE = lum('#1d5c52');
for (const n of names) {
  const svg = fs.readFileSync(path.join(ROOT, 'art', n + '.svg'), 'utf8');
  const fills = Array.from(svg.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-fA-F]{6})"/g)).map(m => m[1]).filter(h => h.toLowerCase() !== '#ffffff' && h.toLowerCase() !== '#000000');
  const bright = fills.filter(h => lum(h) > FELT_CENTRE + 0.0005 && h.toLowerCase() !== '#d6a84f');
  ok(bright.length === 0, `${n}: no colour brighter than the classic felt's centre (${(FELT_CENTRE).toFixed(3)})${bright.length ? ': ' + bright.join(',') : ''}`);
  if (/#d6a84f/i.test(svg)) ok(Array.from(svg.matchAll(/stroke="#d6a84f"[^>]*?stroke-opacity="([\d.]+)"/gi)).every(m => +m[1] <= 0.1), `${n}: the gold of the ring is at most 10% opaque`);
}

console.log('2. the build');
const html = fs.readFileSync(path.join(ROOT, 'mexican-train.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
ok(names.every(n => css.includes(`url(art:${n})`)), 'the stylesheet asks for each by name');
ok(!/url\(art:/.test(html), 'the built page has none of those names left');
ok((html.match(/url\("data:image\/svg\+xml,%3Csvg/g) || []).length === 3, 'it has each of the three, inlined (the page is still one file with nothing to fetch)');
ok(!/url\(["']?https?:/.test(html), 'and no picture is fetched from anywhere');
const stamp = (html.match(/window\.MT_BUILD = "([0-9a-f]+)"/) || [])[1];
const art0 = fs.readFileSync(path.join(ROOT, 'art', 'lotr-ring.svg'), 'utf8');
{
  const { spawnSync } = require('child_process'), os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-art-'));
  for (const f of ['build.py', 'template.html', 'style.css', 'game.js']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  fs.mkdirSync(path.join(tmp, 'art'));
  for (const f of fs.readdirSync(path.join(ROOT, 'art')).filter(f => /\.(svg|png)$/.test(f))) fs.copyFileSync(path.join(ROOT, 'art', f), path.join(tmp, 'art', f));
  const b0 = spawnSync('python3', ['build.py'], { cwd: tmp }).stdout.toString().match(/build ([0-9a-f]+)/);
  fs.writeFileSync(path.join(tmp, 'art', 'lotr-ring.svg'), art0.replace('<circle', '<circle data-changed="1"'));
  const b1 = spawnSync('python3', ['build.py'], { cwd: tmp }).stdout.toString().match(/build ([0-9a-f]+)/);
  ok(b0 && b1 && b0[1] === stamp && b1[1] !== b0[1], 'the page\'s version stamp covers the artwork: change a picture and the stamp changes (so an old tab is told to reload)');
  fs.writeFileSync(path.join(tmp, 'art', 'lotr-bottom.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const bad = spawnSync('python3', ['build.py'], { cwd: tmp });
  ok(bad.status !== 0, 'the build refuses a picture that contains a script');
  fs.rmSync(tmp, { recursive: true, force: true });
}
ok(/@media \(prefers-contrast: more\) \{ \.table\.art-lotr \{ background: radial-gradient/.test(css), 'a person who has asked for more contrast gets the plain board (no pictures)');

console.log('3. where the page uses it');
function makeApp(seed, opts) {
  const c = { store: {}, html: '' };
  const root = { set innerHTML(v) { c.html = v; }, get innerHTML() { return c.html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  c.app = G.createApp({ root, rng: E.mulberry32(seed), paceRng: () => 0, chatRng: () => 1, nativeChance: 0, foodChance: 0, sleep: async () => {}, reducedMotion: true, storage: { get: k => (k in c.store ? c.store[k] : null), set: (k, v) => { c.store[k] = v; } } });
  c.S = c.app.state; c.d = a => c.app.dispatch(a);
  c.d({ type: 'boot' });
  return c;
}
(async () => {
  for (const [theme, want] of [['lotr', true], ['classic', false]]) {
    const c = makeApp(7);
    c.d({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy', theme });
    await until(() => c.S.awaiting && c.S.game);
    c.app.render(true);
    ok(want ? /<main class="table art-lotr">/.test(c.html) : (/<main class="table">/.test(c.html) && !/art-lotr/.test(c.html)), `a ${theme} game: the board ${want ? 'has' : 'does not have'} the Lord of the Rings scenery`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
