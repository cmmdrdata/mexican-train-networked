'use strict';
// The tab icon: a generic (not themed) domino on the felt, in the page's head as inlined pictures. The PNGs are really decoded here.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
const { spawnSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f));
const css = read('style.css').toString(), html = read('mexican-train.html').toString(), game = read('game.js').toString(), tmpl = read('template.html').toString();

function decodePNG(buf) {                                          // 8-bit RGBA, not interlaced: all this icon is
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  let pos = 8, ihdr = null; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.slice(pos + 4, pos + 8).toString(), data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || ihdr.color !== 6 || ihdr.interlace !== 0) return Object.assign({ unsupported: true }, ihdr);
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = ihdr.w * bpp, px = Buffer.alloc(ihdr.h * stride);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)], line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += Math.floor((a + b) / 2);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      px[y * stride + x] = v & 255;
    }
  }
  return Object.assign(ihdr, { px, at: (x, y) => { const i = (Math.round(y) * ihdr.w + Math.round(x)) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; } });
}
const near = (c, hex, tol) => [1, 3, 5].every((i, k) => Math.abs(c[k] - parseInt(hex.slice(i, i + 2), 16)) <= tol);
const FELT = '#1d5c52', BONE = '#f6f0e0', INK = '#1b2523', BRASS = '#a07a26';

console.log('1. the files');
const svg = read('art/favicon.svg').toString().trim();
ok(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32">/.test(svg) && /<\/svg>$/.test(svg) && svg.length < 1500, `favicon.svg is a small plain SVG (${svg.length} bytes)`);
ok(!/<script|<image|<foreignObject|<a\b|href=|\son[a-z]+=|<style|@import|<text|font|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(svg), 'with nothing in it that could run, load anything, or say anything (no text, no fonts, no addresses)');
const colours = Array.from(new Set(Array.from(svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)).map(m => m[1].toLowerCase())));
ok(colours.sort().join() === [FELT, BONE, INK, BRASS].sort().join(), `it uses four colours, the game's own: ${colours.join(' ')}`);
const cssVar = n => (css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];
ok(cssVar('felt') === FELT && cssVar('bone') === BONE && cssVar('page') === '#0f3a33', 'and the felt and the bone are the stylesheet\'s own --felt and --bone');
const shapes = (svg.match(/<(rect|circle|path|g|polygon|line|ellipse)\b/g) || []).length;
ok(shapes <= 9, `not too much detail: ${shapes} shapes in all (the felt, the tile, the divider and four pips)`);
ok(((svg.match(/<circle/g)) || []).length === 4 && !/rotate|transform/.test(svg), 'a plain upright domino with four big pips, nothing tilted or fine');
ok(!/#d6a84f|ring|mountain|tree/i.test(svg), 'and nothing from the Lord of the Rings theme: it is the generic game\'s icon');

for (const size of [32, 180]) {
  const png = decodePNG(read(`art/favicon-${size}.png`));
  ok(png && !png.unsupported && png.w === size && png.h === size, `favicon-${size}.png is a ${size} x ${size} PNG (8-bit RGBA)`);
  if (!png || png.unsupported) continue;
  const k = size / 32;
  ok(png.at(0, 0)[3] < 40 && png.at(size - 1, 0)[3] < 40 && png.at(0, size - 1)[3] < 40 && png.at(size - 1, size - 1)[3] < 40, `${size}: the corners are transparent (the square is rounded)`);
  ok(near(png.at(16 * k, 3 * k), FELT, 8) && png.at(16 * k, 3 * k)[3] === 255, `${size}: the felt is felt-coloured above the tile`);
  ok(near(png.at(5 * k, 16 * k), BONE, 8), `${size}: the tile is bone-coloured`);
  ok(near(png.at(16 * k, 16 * k), BRASS, 14), `${size}: the divider is brass`);
  ok([[8.6, 11.6], [11.6, 20.4], [20.4, 11.6], [23.4, 20.4]].every(([x, y]) => near(png.at(x * k, y * k), INK, 14)), `${size}: all four pips are where they should be, in the pip colour`);
}

console.log('2. the page\'s head');
const head = html.slice(0, html.indexOf('</head>'));
const links = Array.from(head.matchAll(/<link rel="([^"]+)"([^>]*)>/g)).map(m => ({ rel: m[1], attrs: m[2] }));
ok(links.length === 3 && links[0].rel === 'icon' && /type="image\/svg\+xml"/.test(links[0].attrs) && /sizes="any"/.test(links[0].attrs), 'the head has the SVG icon first, for sizes of any kind');
ok(links[1] && links[1].rel === 'icon' && /type="image\/png"/.test(links[1].attrs) && /sizes="32x32"/.test(links[1].attrs), 'then the 32 x 32 PNG, for a browser that takes no SVG icon');
ok(links[2] && links[2].rel === 'apple-touch-icon' && /sizes="180x180"/.test(links[2].attrs), 'and the 180 x 180 one for a phone\'s home screen');
ok(/<meta name="theme-color" content="#0f3a33">/.test(head), 'with the page\'s own colour for a phone\'s browser bar');
ok(!/href="art:/.test(html) && links.every(l => /href="data:image\/(svg\+xml,|png;base64,)/.test(l.attrs)), 'every icon is inlined (the page is still one file, and the browser asks for nothing)');
const svgUri = (links[0].attrs.match(/href="data:image\/svg\+xml,([^"]+)"/) || [])[1];
ok(svgUri && decodeURIComponent(svgUri).replace(/>\s+</g, '><') === svg.replace(/>\s+</g, '><'), 'the inlined SVG is exactly favicon.svg');
for (const [i, size] of [[1, 32], [2, 180]]) {
  const b64 = (links[i].attrs.match(/base64,([^"]+)"/) || [])[1];
  ok(b64 && Buffer.compare(Buffer.from(b64, 'base64'), read(`art/favicon-${size}.png`)) === 0, `and the inlined ${size} PNG is exactly favicon-${size}.png`);
}
const iconBytes = links.reduce((n, l) => n + l.attrs.length, 0);
ok(iconBytes < 12000, `the icons add little to the page (${iconBytes} bytes for all three)`);
ok(!/rel=["']?(shortcut )?icon|favicon|apple-touch-icon/.test(game) && !/lotr|ring|middle/i.test(links.map(l => l.rel + l.attrs.replace(/base64,[^"]+|svg\+xml,[^"]+/g, '')).join(' ')), 'the page\'s code never changes the icon, and nothing about the icon mentions any theme: it is the same for every theme');
ok(/<link rel="icon"[^>]*href="art:favicon\.svg"/.test(tmpl) && /href="art:favicon-32\.png"/.test(tmpl) && /href="art:favicon-180\.png"/.test(tmpl), 'the template asks for them by name');

console.log('3. the build');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-fav-'));
  for (const f of ['build.py', 'template.html', 'style.css', 'game.js']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  fs.mkdirSync(path.join(tmp, 'art'));
  for (const f of fs.readdirSync(path.join(ROOT, 'art')).filter(f => /\.(svg|png)$/.test(f))) fs.copyFileSync(path.join(ROOT, 'art', f), path.join(tmp, 'art', f));
  const run = () => spawnSync('python3', ['build.py'], { cwd: tmp });
  const stamp = r => (r.stdout.toString().match(/build ([0-9a-f]+)/) || [])[1];
  const b0 = stamp(run());
  ok(b0 === (html.match(/window\.MT_BUILD = "([0-9a-f]+)"/) || [])[1], 'the build in a clean copy gives the same page stamp');
  fs.writeFileSync(path.join(tmp, 'art', 'favicon.svg'), svg.replace('rx="7"', 'rx="8"'));
  ok(stamp(run()) !== b0, 'the page\'s version stamp covers the icon: change the icon and the stamp changes (so an old tab is told to reload)');
  fs.writeFileSync(path.join(tmp, 'art', 'favicon.svg'), svg);
  fs.writeFileSync(path.join(tmp, 'art', 'favicon-32.png'), Buffer.from('this is not a PNG'));
  ok(run().status !== 0, 'the build refuses an icon that is not really a PNG');
  fs.copyFileSync(path.join(ROOT, 'art', 'favicon-32.png'), path.join(tmp, 'art', 'favicon-32.png'));
  fs.writeFileSync(path.join(tmp, 'art', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  ok(run().status !== 0, 'and one that contains a script');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
