require('./game.js');
const G = globalThis.MexicanTrainGame;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

require('./game_before_sound.js');
const BEFORE = globalThis.MexicanTrainGame;                          // the build with the old, low "clack"
require('./game.js');                                                // (this one defines the global again: back to the current build)
const Gnow = globalThis.MexicanTrainGame;
console.log('1. the synthesised click, checked as numbers');

// a plain DFT of the first N samples, as power per bin
function spectrum(x, sr, N) {
  const re = new Float64Array(N / 2);
  for (let k = 1; k < N / 2; k++) {
    let a = 0, b = 0;
    for (let i = 0; i < Math.min(N, x.length); i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); a += x[i] * w * Math.cos(2 * Math.PI * k * i / N); b -= x[i] * w * Math.sin(2 * Math.PI * k * i / N); }
    re[k] = a * a + b * b;
  }
  return { re, hz: k => k * sr / N };
}
function measure(x, sr) {
  const N = 4096, sp = spectrum(x, sr, N);
  let tot = 0, cen = 0, below1k = 0, mid = 0, above4k = 0, dom = 0, domV = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = sp.hz(k), p = sp.re[k];
    tot += p; cen += p * f;
    if (f < 1000) below1k += p;
    if (f >= 2000 && f <= 9500) mid += p;
    if (f >= 4000) above4k += p;
    if (k > 20 && p > domV) { domV = p; dom = f; }
  }
  return { centroid: cen / tot, below1k: below1k / tot, mid: mid / tot, above4k: above4k / tot, dominant: dom };
}
// the envelope of the high-passed signal in 0.25 ms windows (to look for the two contacts)
function envelope(x, sr) { const w = Math.floor(sr * 0.00025), out = []; for (let i = 0; i + w <= x.length; i += w) { let m = 0; for (let j = 1; j < w; j++) m = Math.max(m, Math.abs(x[i + j] - x[i + j - 1])); out.push(m); } return out; }

for (const sr of [44100, 48000]) {
  const x = G.renderClack(sr, 101);
  const n = x.length, dur = n / sr;
  let peak = 0, bad = 0, sum = 0;
  for (let i = 0; i < n; i++) { if (!Number.isFinite(x[i])) bad++; peak = Math.max(peak, Math.abs(x[i])); sum += x[i]; }
  ok(bad === 0, `${sr}Hz: all samples are finite numbers`);
  ok(dur > 0.07 && dur < 0.12, `${sr}Hz: a very short sound (${(dur * 1000).toFixed(0)} ms)`);
  ok(peak > 0.6 && peak <= 0.71, `${sr}Hz: loud enough but never clipping (peak ${peak.toFixed(2)})`);
  ok(Math.abs(x[0]) < 0.05 && Math.abs(x[n - 1]) < 0.001, `${sr}Hz: starts and ends at (almost) silence, so no pop`);
  ok(Math.abs(sum / n) < 0.002, `${sr}Hz: no DC offset`);
  // a click: nearly all the energy at the start, almost none in the last half
  const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
  ok(rms(Math.floor(n * 0.5), n) < 0.02 * rms(0, Math.floor(n * 0.25)), `${sr}Hz: gone within half its length (the second half is under 2% of the attack)`);
  const m = measure(x, sr);
  ok(m.centroid > 2800 && m.centroid < 5000, `${sr}Hz: high and bright: the centre of the sound is at ${m.centroid.toFixed(0)} Hz`);
  ok(m.below1k < 0.005, `${sr}Hz: nothing low: ${(100 * m.below1k).toFixed(2)}% of the energy is below 1 kHz (no thud, no knock)`);
  ok(m.mid > 0.97, `${sr}Hz: ${(100 * m.mid).toFixed(0)}% of the energy is between 2 and 9.5 kHz, where a small hard tile rings`);
  ok(m.above4k > 0.15, `${sr}Hz: and ${(100 * m.above4k).toFixed(0)}% is above 4 kHz: a crisp click, not a dull tone`);
  // how fast it dies: the envelope falls 40 dB (to 1%) within 40 ms of the peak
  const e = envelope(x, sr), top = Math.max(...e), iTop = e.indexOf(top);
  let tEnd = e.length; for (let i = iTop; i < e.length; i++) if (e[i] < top * 0.01 && e.slice(i).every(v => v < top * 0.012)) { tEnd = i; break; }
  ok((tEnd - iTop) * 0.25 < 40, `${sr}Hz: down 40 dB within ${((tEnd - iTop) * 0.25).toFixed(0)} ms`);
}

// much higher than the old sound
{
  const sr = 44100, oldM = measure(BEFORE.renderClack(sr, 101), sr), newM = measure(G.renderClack(sr, 101), sr);
  ok(oldM.centroid < 500 && oldM.below1k > 0.9, `the old sound was a low knock: centre ${oldM.centroid.toFixed(0)} Hz, ${(100 * oldM.below1k).toFixed(0)}% below 1 kHz`);
  ok(newM.centroid > 8 * oldM.centroid, `the new one is far higher: centre ${newM.centroid.toFixed(0)} Hz, over ${(newM.centroid / oldM.centroid).toFixed(0)} times the old`);
  ok(G.renderClack(sr, 101).length < BEFORE.renderClack(sr, 101).length * 0.7, 'and shorter');
}

// two dominoes: a second, quieter contact a few milliseconds after the first, in every variant
{
  const sr = 44100;
  let found = 0, total = 0, minRatio = 9, maxRatio = 0;
  const gaps = [];
  for (let seed = 101; seed < 101 + 7 * 40; seed += 7) {
    const x = G.renderClack(sr, seed), e = envelope(x, sr), first = Math.max(...e.slice(0, 8));
    const gapMs = G.clackGapMs(seed); gaps.push(gapMs);
    const i = Math.floor(gapMs / 0.25);                              // the 0.25 ms window that contains the second contact
    // the second tap shows as a fresh rise in the high-frequency envelope right at the gap
    const before = Math.max(...e.slice(i - 4, i)), after = Math.max(e[i], e[i + 1], e[i + 2]);
    total++;
    if (after > before * 1.2 && after > first * 0.08) { found++; minRatio = Math.min(minRatio, after / first); maxRatio = Math.max(maxRatio, after / first); }
  }
  ok(found === total, `a clear second contact (at least 1.2 times the level just before it) is there at the expected moment in all ${found} of ${total} variants`);
  ok(maxRatio < 0.95 && minRatio > 0.2, `and it is quieter than the first (${minRatio.toFixed(2)} to ${maxRatio.toFixed(2)} of its strength)`);
  ok(Math.min(...gaps) >= 4.5 && Math.max(...gaps) <= 9.5 && Math.max(...gaps) - Math.min(...gaps) > 3, `it lands between 4.5 and 9.5 ms later, a little different each time (${Math.min(...gaps).toFixed(1)} to ${Math.max(...gaps).toFixed(1)} ms)`);
}

// variants: always high, never identical
{
  const sr = 44100, doms = [], cents = [];
  for (let seed = 101; seed < 101 + 7 * 12; seed += 7) { const m = measure(G.renderClack(sr, seed), sr); doms.push(m.dominant); cents.push(m.centroid); }
  ok(Math.min(...cents) > 2800 && Math.max(...cents) < 5000, `every variant stays high (centre ${Math.min(...cents).toFixed(0)} to ${Math.max(...cents).toFixed(0)} Hz)`);
  ok(Math.max(...doms) / Math.min(...doms) > 1.03, `but the pitch differs from one to the next (${Math.min(...doms).toFixed(0)} to ${Math.max(...doms).toFixed(0)} Hz)`);
  const rates = [44100, 48000].map(sr => measure(G.renderClack(sr, 115), sr).centroid);
  ok(Math.abs(rates[0] - rates[1]) / rates[0] < 0.08, `the same sound at either sample rate (${rates[0].toFixed(0)} and ${rates[1].toFixed(0)} Hz)`);
}
const a = G.renderClack(48000, 101), b = G.renderClack(48000, 101), c = G.renderClack(48000, 108);
ok(a.every((v, i) => v === b[i]), 'same seed gives the identical sound');
ok(a.some((v, i) => Math.abs(v - c[i]) > 0.05), 'different seeds give audibly different variants');
ok(G.clackGapMs(101) === G.clackGapMs(101) && G.clackGapMs(101) !== G.clackGapMs(108), 'the gap between the two contacts belongs to the variant');

console.log('2. the Web Audio player (against a mock audio context)');
function mockCtx() {
  const calls = { created: 0, resumed: 0, sources: [], buffers: 0 };
  class Ctx {
    constructor() { calls.created++; this.sampleRate = 44100; this.state = 'suspended'; this.destination = { dest: true }; this.currentTime = 0; }
    resume() { calls.resumed++; this.state = 'running'; return Promise.resolve(); }
    createBuffer(ch, len, sr) { calls.buffers++; const d = new Float32Array(len); return { length: len, sampleRate: sr, getChannelData: () => d }; }
    createBufferSource() { const s = { buffer: null, playbackRate: { value: 1 }, connected: [], started: 0, connect(x) { this.connected.push(x); }, start() { this.started++; } }; calls.sources.push(s); return s; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
  }
  return { Ctx, calls };
}
{
  const { Ctx, calls } = mockCtx();
  const snd = G.createSound(Ctx, () => 0.5);
  snd.clack();
  ok(calls.created === 0 && calls.sources.length === 0, 'before any click/key press nothing is created and clack() is silent');
  snd.unlock();
  ok(calls.created === 1 && calls.resumed === 1, 'unlock creates the audio context once and resumes it');
  ok(calls.buffers >= 6, 'the clack variants are rendered up front');
  const before = calls.sources.length;
  snd.clack();
  const played = calls.sources[calls.sources.length - 1];
  ok(calls.sources.length === before + 1 && played.started === 1 && played.buffer && played.buffer.length > 3000, 'clack() plays one buffer');
  ok(played.playbackRate.value >= 0.95 && played.playbackRate.value <= 1.05, 'with a small pitch variation');
  snd.unlock(); snd.unlock();
  ok(calls.created === 1, 'unlocking again never creates a second context');
  const { Ctx: C2 } = mockCtx();
  const quiet = G.createSound(function () { throw new Error('no audio'); });
  quiet.unlock(); quiet.clack();
  ok(true, 'a browser that throws on AudioContext does not break anything');
  const none = G.createSound(undefined);
  none.unlock(); none.clack();
  ok(true, 'no AudioContext at all: silent, no errors');
  // a context that stays suspended (autoplay blocked) simply stays quiet
  class Stuck { constructor() { this.sampleRate = 44100; this.state = 'suspended'; this.destination = {}; } resume() {} createBuffer(c, l) { const d = new Float32Array(l); return { getChannelData: () => d }; } createBufferSource() { return { connect() {}, start() {}, playbackRate: { value: 1 } }; } createGain() { return { gain: {}, connect() {} }; } }
  const stuck = G.createSound(Stuck);
  stuck.unlock(); stuck.clack();
  ok(true, 'a context that stays suspended just stays silent');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
