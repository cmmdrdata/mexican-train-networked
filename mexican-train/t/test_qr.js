'use strict';
require('./game.js');
const G = globalThis.MexicanTrainGame;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

console.log('1. known answers (not computed by this code)');
{
  // the worked example in the widely used QR tutorial at thonky.com: "HELLO WORLD", version 1, level M
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  ok(G.rsEncode(data, 10).join(',') === '196,35,39,119,235,215,231,226,93,23', 'Reed-Solomon: the published error-correction codewords for that example come out exactly');
  ok(G.rsEncode([], 7).join(',') === '0,0,0,0,0,0,0' && G.rsEncode([0, 0, 0], 5).every(x => x === 0), 'all-zero data has all-zero error correction');
  // every version's block table adds up to its total number of codewords (a check against the standard's table)
  const rows = Object.keys(G.QR_BLOCKS_M).map(Number);
  ok(rows.length === 10 && rows.every(v => { const [ec, n1, d1, n2, d2] = G.QR_BLOCKS_M[v]; return (n1 + n2) * ec + n1 * d1 + n2 * d2 === G.QR_TOTAL_CODEWORDS[v]; }), 'the block tables of all ten versions add up to the standard\'s total codeword counts (26, 44, 70, 100, 134, 172, 196, 242, 292, 346)');
  const capacity = v => { const [, n1, d1, n2, d2] = G.QR_BLOCKS_M[v]; return n1 * d1 + n2 * d2; };
  const bytesFor = v => Math.floor((capacity(v) * 8 - 4 - (v < 10 ? 8 : 16)) / 8);
  ok(rows.map(bytesFor).join(',') === '14,26,42,62,84,106,122,152,180,213', 'and the byte capacities are the published ones for level M: 14, 26, 42, 62, 84, 106, 122, 152, 180, 213');
}

console.log('2. the shape of the code');
{
  const m = G.qrEncode('http://192.168.1.23:8080/?join=K7QF2M');
  const n = m.length;
  ok(n === 29 && m.every(r => r.length === n), 'a 38-character link is a 29 x 29 code (version 3)');
  const finder = (x0, y0) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) { const edge = x === 0 || y === 0 || x === 6 || y === 6, core = x >= 2 && x <= 4 && y >= 2 && y <= 4; if (m[y0 + y][x0 + x] !== (edge || core)) return false; } return true; };
  ok(finder(0, 0) && finder(n - 7, 0) && finder(0, n - 7), 'the three finder squares are where and what they should be');
  const sep = (x0, y0, dx, dy) => { for (let i = 0; i < 8; i++) { if (m[y0 + dy * (i === 7 ? 7 : 7)] === undefined) return true; } return true; };
  ok(m[n - 8][8] === true, 'the always-dark module is dark');
  let timing = true; for (let i = 8; i < n - 8; i++) if (m[6][i] !== (i % 2 === 0) || m[i][6] !== (i % 2 === 0)) timing = false;
  ok(timing, 'the timing lines alternate dark and light');
  ok(m[n - 7][n - 7] === true && m[n - 9][n - 9] === true && m[n - 7][n - 9] === true && m[n - 8][n - 8] === false, 'the alignment pattern sits where version 3 puts it (centre at 22, 22)');
  ok(G.qrEncode('x'.repeat(213)) !== null && G.qrEncode('x'.repeat(214)) === null, '213 bytes is the most it holds; 214 is refused (null), not mangled');
  ok(G.qrEncode('') !== null && G.qrEncode('').length === 21, 'even an empty text is a valid version 1 code');
  const again = G.qrEncode('http://192.168.1.23:8080/?join=K7QF2M');
  ok(JSON.stringify(again) === JSON.stringify(m), 'the same text always gives the same code');
  const other = G.qrEncode('http://192.168.1.23:8080/?join=K7QF2N');
  ok(JSON.stringify(other) !== JSON.stringify(m), 'one changed character changes it');
  const svg = G.qrSvg('hello', 'Scan me');
  ok(/^<svg [^>]*viewBox="0 0 29 29"/.test(svg) && /aria-label="Scan me"/.test(svg) && /<rect width="29" height="29" fill="#fff"\/>/.test(svg) && /fill="#000"/.test(svg), 'the SVG has a white 4-module border (21 + 8 = 29), black modules and an accessible label');
  ok(G.qrSvg('x'.repeat(300)) === '', 'too long: no picture');
  ok(!/[<>]/.test(G.qrSvg('hi', '<script>alert(1)</script>').replace(/<\/?(svg|rect|path)\b[^>]*>/g, '')), 'a hostile label cannot add markup to the SVG');
}

console.log('2b. the format and version bits, against the published tables');
{
  // the 15-bit format strings for level M with masks 0 to 7, as printed in the standard
  const published = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
  // ...and the same worked out afresh: a BCH(15,5) code with generator 0x537, then XOR 0x5412
  const worked = m => { let r = m; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); return (((m << 10) | r) ^ 0x5412).toString(2).padStart(15, '0'); };
  ok(published.every((s, m) => worked(m) === s), 'the eight published format strings match an independent calculation (so the table here is right)');
  const versionPublished = { 7: '000111110010010100', 8: '001000010110111100', 9: '001001101010011001', 10: '001010010011010011' };
  const versionWorked = v => { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25); return ((v << 12) | r).toString(2).padStart(18, '0'); };
  ok(Object.keys(versionPublished).every(v => versionWorked(Number(v)) === versionPublished[v]), 'and the four published version strings (7 to 10) match too');
  // now read them back out of real codes, both copies
  const sizesTried = [];
  const lens = [10, 20, 30, 50, 70, 100, 110, 130, 160, 190];
  for (const len of lens) {
    const m = G.qrEncode('a'.repeat(len)), n = m.length, v = (n - 17) / 4;
    const read = (pts) => pts.map(([x, y]) => (m[y][x] ? '1' : '0')).reduce((acc, ch, i) => ch + acc, '');   // bit 14 first
    const copy1 = [], copy2 = [];
    for (let i = 0; i <= 5; i++) copy1.push([8, i]); copy1.push([8, 7], [8, 8], [7, 8]); for (let i = 9; i < 15; i++) copy1.push([14 - i, 8]);
    for (let i = 0; i < 8; i++) copy2.push([n - 1 - i, 8]); for (let i = 8; i < 15; i++) copy2.push([8, n - 15 + i]);
    const f1 = read(copy1), f2 = read(copy2);
    sizesTried.push(v);
    ok(f1 === f2 && published.includes(f1), `version ${v}: both copies of the format information are one of the eight valid strings (${f1})`);
    if (v >= 7) {
      const vb = []; for (let i = 0; i < 18; i++) vb.push([n - 11 + (i % 3), Math.floor(i / 3)]);
      const vb2 = vb.map(([x, y]) => [y, x]);
      ok(read(vb) === versionPublished[v] && read(vb2) === versionPublished[v], `version ${v}: both copies of the version information are ${versionPublished[v]}`);
    }
  }
  ok(new Set(sizesTried).size === 10, '(all ten versions inspected)');
}

console.log('3. read back by an independent decoder (OpenCV)');
{
  const lengthsAroundEachVersion = [1, 5, 14, 15, 26, 27, 42, 43, 62, 63, 84, 85, 106, 107, 122, 123, 152, 153, 180, 181, 213];
  const cases = [];
  let seed = 99;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:/?=&._-~ ';
  for (const len of lengthsAroundEachVersion) { let t = ''; for (let i = 0; i < len; i++) t += alphabet[Math.floor(rnd() * alphabet.length)]; cases.push(t); }
  for (const a of ['192.168.1.23:8080', '10.0.0.5:3000', '172.16.254.1:8080', 'my-laptop.local:8080', '192.168.100.200:65535', '[fe80::1]:8080', 'localhost:8080'])
    for (const code of ['K7QF2M', 'ABCDEF', '23456Z']) cases.push(`http://${a}/?join=${code}`);
  cases.push('héllo wörld', '日本語のテスト', 'Привет, мир', 'مرحبا', 'emoji 🂡🁣 test', 'a'.repeat(100), '0'.repeat(60), '\u0001\u0002\u001f control', 'x', 'ab');   // (no NUL character: OpenCV returns C strings, which end at the first NUL)
  const uniq = Array.from(new Set(cases));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-'));
  const items = uniq.map((text, i) => ({ text, svg: G.qrSvg(text), version: (G.qrEncode(text).length - 17) / 4 }));
  fs.writeFileSync(path.join(tmp, 'cases.json'), JSON.stringify(items));
  fs.writeFileSync(path.join(tmp, 'decode.py'), `
import json, sys, re
import numpy as np
try:
    import cv2
except Exception:
    print('NOCV2'); sys.exit(0)
items = json.load(open(sys.argv[1]))
det = cv2.QRCodeDetector()
bad = []
for it in items:
    # draw the SVG's own path data: each "M x y h1 v1 h-1 z" is one dark module
    vb = re.search(r'viewBox="0 0 (\\d+) (\\d+)"', it['svg'])
    n = int(vb.group(1)); s = 8
    img = np.full((n * s, n * s), 255, np.uint8)
    for x, y in re.findall(r'M(\\d+) (\\d+)h1v1h-1z', it['svg']):
        x, y = int(x), int(y); img[y*s:(y+1)*s, x*s:(x+1)*s] = 0
    text, pts, _ = det.detectAndDecode(cv2.cvtColor(img, cv2.COLOR_GRAY2BGR))
    if text != it['text']:
        bad.append({'version': it['version'], 'len': len(it['text'].encode()), 'want': it['text'][:40], 'got': text[:40]})
print(json.dumps({'total': len(items), 'bad': bad}))
`);
  const r = spawnSync('python3', [path.join(tmp, 'decode.py'), path.join(tmp, 'cases.json')], { encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '').trim();
  if (r.error || /NOCV2/.test(out) || !out) {
    skipped++;
    console.log('   (skipped: python3 with OpenCV is not available here; the decode checks need it)');
  } else {
    const res = JSON.parse(out.split('\n').pop());
    const versions = new Set(items.map(i => i.version));
    ok(versions.size === 10, `the ${res.total} test codes cover all ten versions`);
    ok(res.bad.length === 0, `OpenCV's decoder reads back every one of the ${res.total} codes exactly` + (res.bad.length ? ': ' + JSON.stringify(res.bad.slice(0, 4)) : ''));
    console.log(`   decoded ${res.total - res.bad.length}/${res.total} by OpenCV (versions ${Array.from(versions).sort((a, b) => a - b).join(', ')})`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed${skipped ? ', ' + skipped + ' section skipped' : ''}`);
process.exit(fail ? 1 : 0);
