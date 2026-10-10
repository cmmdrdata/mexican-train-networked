'use strict';
// The REAL built page, run in a sandbox with a fake browser: what happens when a phone scans the
// host's QR code (a link ending in ?join=CODE), and the QR code and Copy link button in the lobby.
const fs = require('fs'), vm = require('vm'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const html = fs.readFileSync('../mexican-train.html', 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

function boot(href, store, extra) {
  const u = new URL(href);
  const handlers = {}, sockets = [], replaced = [], clipboard = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); }
    send(d) { this.sent.push(JSON.parse(d)); }
    close() { this.readyState = 3; }
    say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); }
  }
  let form = {};
  const rootEl = {
    _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
    addEventListener(t, f) { handlers[t] = f; }, querySelectorAll() { return []; },
    querySelector(sel) { return sel in form ? { value: form[sel] } : { focus() {}, disabled: false }; }, ownerDocument: { activeElement: null },
  };
  const sandbox = {
    document: Object.assign({ readyState: 'complete', getElementById: () => rootEl, addEventListener() {} }, (extra && extra.document) || {}),
    location: { href: u.href, search: u.search, host: u.host, protocol: u.protocol, pathname: u.pathname, hash: u.hash },
    history: { replaceState: (a, b, url) => replaced.push(url) },
    navigator: extra && 'navigator' in extra ? extra.navigator : { clipboard: { writeText: t => { clipboard.push(t); return Promise.resolve(); } } },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    matchMedia: () => ({ matches: true }), WebSocket: FakeWS,
    fetch: async url => { sandbox.fetched.push(url); return { ok: true, json: async () => ({ addresses: ['192.168.1.23:8080', '10.0.0.7:8080'], preferred: '192.168.1.23:8080' }) }; },
    fetched: [],
    console, setTimeout, clearTimeout, URL, URLSearchParams, Math, JSON, Object, Array, Number, String, Set, Promise, Error,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const click = (attrs) => handlers.click({ target: { closest: sel => (sel === '[data-action]' ? { dataset: attrs } : null) } });
  return { app: sandbox.MexicanTrainApp, sandbox, root: rootEl, sockets, replaced, clipboard, click, setForm: f => { form = f; }, html: () => rootEl.innerHTML };
}

(async () => {
  console.log('1. scanning the host\'s QR code on a phone');
  {
    const p = boot('http://192.168.1.23:8080/?join=k7qf2m', {});
    const h = p.html();
    ok(/Join an online game/.test(h), 'the page opens straight onto the Join screen');
    ok(/id="net-code" type="text" value="K7Q-F2M"/.test(h), 'with the code already filled in, tidied to upper case: K7Q-F2M');
    ok(/id="net-server" type="text" value="192\.168\.1\.23:8080"/.test(h), 'and the server address filled in from the link it was opened from');
    ok(/id="net-name"/.test(h), '(the player only has to type a name and tap Join)');
    ok(p.replaced.length === 1 && p.replaced[0] === '/', 'the ?join= part is removed from the address bar, so a reload does not reopen the screen');
    ok(p.sockets.length === 0, 'nothing connects until the player taps Join');
    p.setForm({ '#net-server': '192.168.1.23:8080', '#net-code': 'K7Q-F2M', '#net-name': 'Phone' });
    p.click({ action: 'joinGame' });
    await wait(20);
    ok(p.sockets.length === 1 && p.sockets[0].url === 'ws://192.168.1.23:8080/ws', 'tapping Join connects to the address in the link');
    ok(p.sockets[0].sent.some(m => m.t === 'join' && m.code === 'K7Q-F2M' && m.name === 'Phone'), 'and asks to join with that code and name');
  }
  {
    const p = boot('http://10.0.0.5:3000/index.html?seed=3&join=abc-def#top', {});
    ok(/value="ABC-DEF"/.test(p.html()) && p.replaced[0] === '/index.html?seed=3#top', 'other parts of the link are kept when ?join= is removed (here ?seed=3 and #top)');
    const q = boot('http://h:1/?join=%3Cscript%3Ealert(1)%3C%2Fscript%3E', {});
    ok(/Join an online game/.test(q.html()) && !/<script>alert/.test(q.html()) && /id="net-code" type="text" value="SCRIPTALERT1"/.test(q.html()), 'a hostile code in the link is reduced to letters and digits (and cut to 12 characters)');
    const e = boot('http://h:1/?join=', {});
    ok(/Start game/.test(e.html()) && !/Join an online game/.test(e.html()) && e.replaced.length === 0, 'an empty ?join= is ignored: the normal start screen');
    const n = boot('http://h:1/', {});
    ok(/Start game/.test(n.html()) && n.replaced.length === 0, 'and no parameter: the normal start screen, the address bar left alone');
    const short = boot('http://h:1/?join=AB', {});
    ok(/value="AB"/.test(short.html()), 'a code of the wrong length is shown as it is (the server will say it is wrong)');
  }
  {
    // a saved game and a scanned link: the link wins, and the saved game is not thrown away
    const sess = JSON.stringify({ server: '192.168.1.23:8080', code: 'ZZZZZZ', token: 'a'.repeat(32), seat: 1, name: 'Old' });
    const p = boot('http://192.168.1.23:8080/?join=K7QF2M', { 'mt-online': sess });
    ok(/Join an online game/.test(p.html()) && p.sockets.length === 0, 'a scanned link is not overridden by a saved game: no automatic rejoin');
    const r = boot('http://192.168.1.23:8080/', { 'mt-online': sess });
    ok(r.sockets.length === 1 && /Rejoining|Connecting|Connection/.test(r.html()), 'without a link, the saved game is rejoined on load (as before)');
  }

  console.log('2. the lobby: QR code and Copy link');
  const store = {};
  const p = boot('http://localhost:8080/', store);
  p.setForm({ '#net-server': 'localhost:8080', '#net-name': 'Ann', '#net-rounds': '4', '#net-hand': '15' });
  p.click({ action: 'openHost' });
  await wait(20);
  ok(p.sandbox.fetched.length === 1 && p.sandbox.fetched[0] === '/info', 'opening the Host screen asks the page\'s own server for its address (/info)');
  ok(/id="net-server" type="text" value="192\.168\.1\.23:8080" readonly/.test(p.html()) && !/value="localhost/.test(p.html()), 'the Host screen shows the network address (192.168.1.23:8080), not localhost, in a read-only field, even though the page was opened as localhost');
  p.click({ action: 'hostGame' });
  await wait(20);
  ok(p.sockets.length === 1 && p.sockets[0].url === 'ws://192.168.1.23:8080/ws', 'Create connects to that address, not to the "localhost:8080" that was in the form');
  const ws = p.sockets[0];
  const lobby = addresses => ({ t: 'lobby', code: 'K7QF2M', seat: 0, settings: { rounds: 4, hand: 15 }, players: [{ name: 'Ann', connected: true }, null], canStart: false, addresses, state: 'lobby' });
  ws.say({ t: 'created', code: 'K7QF2M', display: 'K7Q-F2M', token: 'tok', seat: 0, settings: { rounds: 4, hand: 15 }, addresses: ['192.168.1.23:8080'] });
  ws.say(lobby(['192.168.1.23:8080']));
  let h = p.html();
  const LINK = 'http://192.168.1.23:8080/?join=K7QF2M';
  ok(/<svg class="qr"/.test(h) && /aria-label="QR code: scan it to join the game"/.test(h), 'the host\'s lobby shows a QR code');
  ok(h.includes(`<code>${LINK}</code>`), 'with the link it contains printed underneath, to read or type');
  ok(/Scan with a phone on the same network/.test(h), 'and a line saying what it is for');
  ok(!/data-action="selectQr"/.test(h), 'with one network address there is nothing to choose between');
  ok(new RegExp(`data-action="copyLink" data-key="${LINK.replace(/[.?]/g, '\\$&')}">Copy link`).test(h) && !/copyCode|Copy code/.test(h), 'a Copy link button, and no Copy code button');
  ok(/<span class="code-big"[^>]*>K7Q-F2M<\/span>/.test(h), '(the join code itself is still shown, large)');
  p.click({ action: 'copyLink', key: LINK });
  await wait(20);
  ok(p.clipboard[0] === LINK, 'Copy link puts the full link on the clipboard');
  ok(/data-action="copyLink"[^>]*>Copied/.test(p.html()), 'and the button says "Copied" for a moment');

  console.log('2b. Copy link on a page where navigator.clipboard does not exist (the game is served over plain http on the network)');
  const hostLobby = async extra => {
    const q = boot('http://192.168.1.23:8080/', {}, extra);
    q.setForm({ '#net-server': '192.168.1.23:8080', '#net-name': 'Ann', '#net-rounds': '4', '#net-hand': '15' });
    q.click({ action: 'openHost' }); await wait(20); q.click({ action: 'hostGame' }); await wait(20);
    q.sockets[0].say({ t: 'created', code: 'K7QF2M', display: 'K7Q-F2M', token: 'tok', seat: 0, settings: { rounds: 4, hand: 15 }, addresses: ['192.168.1.23:8080'] });
    q.sockets[0].say({ t: 'lobby', code: 'K7QF2M', seat: 0, settings: { rounds: 4, hand: 15 }, players: [{ name: 'Ann', connected: true }, null], canStart: false, addresses: ['192.168.1.23:8080'], state: 'lobby' });
    return q;
  };
  // a document that records what is done to it: a hidden box is added, selected and copied, then removed
  const spyDoc = execResult => {
    const log = { boxes: [], selected: null, range: null, copies: 0, removed: 0, refocused: 0, order: [] };
    const active = { focus() { log.refocused++; log.order.push('refocus'); } };
    const doc = { activeElement: active,
      body: { appendChild: b => { if (b.tag !== 'textarea') return; log.boxes.push(b); b.parentNode = { removeChild: () => { log.removed++; log.order.push('remove'); } }; log.order.push('add'); } },
      createElement: tag => ({ tag, value: '', style: {}, attrs: {}, parentNode: null, setAttribute(k, v) { this.attrs[k] = v; }, focus() { log.order.push('focus-box'); }, select() { log.selected = this.value; log.order.push('select'); }, setSelectionRange(a, b) { log.range = [a, b]; } }),
      execCommand: cmd => { log.copies++; log.cmd = cmd; log.copiedText = log.selected; log.order.push('copy'); if (execResult instanceof Error) throw execResult; return execResult; } };
    return { doc, log };
  };
  {
    const { doc, log } = spyDoc(true);
    const q = await hostLobby({ navigator: {}, document: doc });                    // no clipboard API at all
    q.click({ action: 'copyLink', key: LINK }); await wait(30);
    ok(log.cmd === 'copy' && log.copies === 1 && log.copiedText === LINK && log.range[0] === 0 && log.range[1] === LINK.length, 'the link is selected in a hidden box and copied with the older method, which works on any page: "' + log.copiedText + '"');
    ok(log.boxes[0].attrs.readonly === '' && log.boxes[0].tag === 'textarea', '(a read-only text box, so a phone does not open its keyboard)');
    ok(log.order.join() === 'add,focus-box,select,copy,remove,refocus', 'the box is removed afterwards and keyboard focus goes back to where it was: ' + log.order.join(' > '));
    ok(/data-action="copyLink"[^>]*>Copied/.test(q.html()), 'and the button says "Copied"');
  }
  {
    const { doc, log } = spyDoc(false);
    const q = await hostLobby({ navigator: {}, document: doc });                    // nothing can copy
    q.click({ action: 'copyLink', key: LINK }); await wait(30);
    ok(/data-action="copyLink"[^>]*>Not copied: select the link above and copy it/.test(q.html()) && q.html().includes(`<code>${LINK}</code>`), 'if nothing works, the button says so (instead of silently doing nothing), and the link is still on the screen to copy by hand');
    ok(log.removed === 1 && log.refocused === 1, '(and the box was still removed and focus restored)');
  }
  {
    const { doc, log } = spyDoc(new Error('not allowed'));
    const q = await hostLobby({ document: doc });                                   // the old method throws; the clipboard API is there
    q.click({ action: 'copyLink', key: LINK }); await wait(30);
    ok(q.clipboard[0] === LINK && /data-action="copyLink"[^>]*>Copied/.test(q.html()) && log.removed === 1, 'if the old method throws, the clipboard API is the second chance (and the box is still removed)');
  }
  {
    const q = await hostLobby({ document: spyDoc(false).doc, navigator: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } } });
    q.click({ action: 'copyLink', key: LINK }); await wait(30);
    ok(/>Not copied: select the link above and copy it/.test(q.html()), 'if the clipboard API refuses too, it says it did not copy');
  }
  {
    const q = await hostLobby({ document: spyDoc(false).doc, navigator: { clipboard: { writeText: () => { throw new Error('boom'); } } } });
    q.click({ action: 'copyLink', key: LINK }); await wait(30);
    ok(/>Not copied/.test(q.html()), '...or throws');
  }
  {
    const copyText = p.sandbox.MexicanTrainGame.copyText;
    ok(typeof copyText === 'function' && await copyText('x', { document: spyDoc(true).doc, navigator: {} }) === true, 'copyText: copies with the old method');
    ok(await copyText('x', { document: {}, navigator: {} }) === false && await copyText('x', {}) === false && await copyText('x') === false, '...and a page with neither way, or no page at all, just says false');
    ok(await copyText('x', { document: spyDoc(false).doc, navigator: { clipboard: { writeText: () => Promise.resolve() } } }) === true, '...and uses the clipboard API when the old method does not work');
  }

  // the QR in the real page, read by an independent decoder
  const svg = (p.html().match(/<svg class="qr"[\s\S]*?<\/svg>/) || [''])[0];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jl-'));
  fs.writeFileSync(path.join(tmp, 'svg.json'), JSON.stringify([{ svg, text: LINK }]));
  fs.writeFileSync(path.join(tmp, 'd.py'), `
import json, re, sys
import numpy as np
try:
    import cv2
except Exception:
    print('NOCV2'); sys.exit(0)
it = json.load(open(sys.argv[1]))[0]
n = int(re.search(r'viewBox="0 0 (\\d+) (\\d+)"', it['svg']).group(1)); s = 8
img = np.full((n*s, n*s), 255, np.uint8)
for x, y in re.findall(r'M(\\d+) (\\d+)h1v1h-1z', it['svg']): img[int(y)*s:(int(y)+1)*s, int(x)*s:(int(x)+1)*s] = 0
t, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.cvtColor(img, cv2.COLOR_GRAY2BGR))
print(json.dumps({'text': t}))
`);
  const r = spawnSync('python3', [path.join(tmp, 'd.py'), path.join(tmp, 'svg.json')], { encoding: 'utf8', timeout: 60000 });
  if (r.error || /NOCV2/.test(r.stdout) || !r.stdout.trim()) { skipped++; console.log('   (skipped: OpenCV is not available here)'); }
  else ok(JSON.parse(r.stdout.trim().split('\n').pop()).text === LINK, 'the QR code drawn in the real page decodes (OpenCV) to exactly that link');
  fs.rmSync(tmp, { recursive: true, force: true });

  // several network addresses (Wi-Fi and a VPN, say): one QR at a time, and a way to switch
  ws.say(lobby(['192.168.1.23:8080', '100.64.0.7:8080']));
  h = p.html();
  ok((h.match(/data-action="selectQr"/g) || []).length === 2 && /QR shown/.test(h) && h.includes('<code>http://192.168.1.23:8080/?join=K7QF2M</code>'), 'with two addresses, each gets a "Show QR" button, and the first one\'s link is shown');
  p.click({ action: 'selectQr', key: '1' });
  h = p.html();
  ok(h.includes('<code>http://100.64.0.7:8080/?join=K7QF2M</code>') && !h.includes('<code>http://192.168.1.23:8080/?join=K7QF2M</code>'), 'choosing the second one swaps the QR code and the link to that address');
  ok(/aria-pressed="true">QR shown<\/button>/.test(h), '(and marks which one is showing)');
  ws.say(lobby(['100.64.0.7:8080']));
  p.click({ action: 'selectQr', key: '7' });
  ws.say(lobby(['100.64.0.7:8080']));
  ok(p.html().includes('<code>http://100.64.0.7:8080/?join=K7QF2M</code>'), 'a stale choice (an address that is gone) falls back to one that exists');
  ws.say(lobby([]));
  h = p.html();
  ok(!/<svg class="qr"/.test(h) && /only reachable from this computer/.test(h), 'with no network address (local-only server) there is no QR code, and the lobby says why');

  // the guest never sees a QR code
  const g = boot('http://localhost:8080/', {});
  g.setForm({ '#net-server': 'localhost:8080', '#net-name': 'Ben', '#net-code': 'K7Q-F2M' });
  g.click({ action: 'openJoin' }); g.click({ action: 'joinGame' });
  await wait(20);
  g.sockets[0].say({ t: 'joined', code: 'K7QF2M', display: 'K7Q-F2M', token: 't', seat: 1, settings: { rounds: 4, hand: 15 }, addresses: ['192.168.1.23:8080'] });
  g.sockets[0].say({ t: 'lobby', code: 'K7QF2M', seat: 1, settings: { rounds: 4, hand: 15 }, players: [{ name: 'Ann', connected: true }, { name: 'Ben', connected: true }], canStart: true, addresses: ['192.168.1.23:8080'], state: 'lobby' });
  ok(!/<svg class="qr"/.test(g.html()) && /Ann will start the game/.test(g.html()), 'the guest\'s lobby has no QR code (they already got in)');

  console.log(`\n${pass} passed, ${fail} failed${skipped ? ', ' + skipped + ' check skipped' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
