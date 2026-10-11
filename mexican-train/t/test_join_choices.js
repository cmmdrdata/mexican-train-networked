'use strict';
// The Host screen's "How will the others join?" (this network / over the internet / type an address) and what the lobby then offers.
require('./game.js');
const G = globalThis.MexicanTrainGame;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

class FakeWS { constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWS.all.push(this); FakeWS.last = this; setTimeout(() => { if (FakeWS.unreachable && String(url).includes(FakeWS.unreachable)) { this.readyState = 3; this.onerror && this.onerror({}); this.onclose && this.onclose({ code: 1006 }); return; } this.readyState = 1; this.onopen && this.onopen(); }, 1); } send(d) { this.sent.push(JSON.parse(d)); } close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
FakeWS.all = [];

function make(opts) {
  opts = opts || {};
  const els = {}, c = { fetches: [], renders: 0, html: '' };
  const clock = { t: 1e9 }, timers = [];
  c.timer = { set: (fn, ms) => { timers.push({ fn, at: clock.t + ms }); return timers.length; }, clear() {} };
  c.advance = ms => { const end = clock.t + ms; for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > end) break; const x = timers.shift(); clock.t = x.at; x.fn(); } clock.t = end; };
  c.el = sel => (els[sel] = els[sel] || { innerHTML: '', disabled: false, checked: false, hidden: false, value: '', focus() {} });
  c.els = els;
  const root = { set innerHTML(v) { c.html = v; c.renders++; Object.keys(els).forEach(k => delete els[k]); }, get innerHTML() { return c.html; }, querySelectorAll() { return []; }, querySelector: sel => c.el(sel), ownerDocument: {}, addEventListener() {} };
  const store = {};
  const fetch = async url => new Promise((resolve, reject) => {
    const rec = { url, resolve: j => resolve({ ok: true, json: async () => j }), fail: () => reject(new Error('offline')), http: status => resolve({ ok: false, status, json: async () => ({}) }) };
    c.fetches.push(rec);
    if (url === '/info' && !opts.manualInfo) rec.resolve({ addresses: opts.addresses || ['192.168.1.23:8080'], preferred: (opts.addresses || ['192.168.1.23:8080'])[0] });
  });
  c.app = G.createApp({ root, sleep: async () => {}, reducedMotion: true, timer: c.timer, now: () => clock.t, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } }, WebSocket: FakeWS, fetch, defaultServer: opts.origin !== undefined ? opts.origin : '192.168.1.23:8080' });
  c.S = c.app.state; c.d = a => c.app.dispatch(a);
  c.d({ type: 'boot' });
  c.publicReq = () => c.fetches.find(f => f.url === '/publicip');
  c.lobby = async (join, extra) => {
    c.d(Object.assign({ type: 'hostGame', server: 'x', name: 'Ann', rounds: 4, hand: 15 }, join || {}));
    await wait(10);
    if (!c.S.online) return false;
    const ws = FakeWS.last;
    ws.say({ t: 'created', code: 'K7QF2M', display: 'K7Q-F2M', token: 't', seat: 0, settings: { rounds: 4, hand: 15 }, addresses: (extra && extra.addresses) || ['192.168.1.23:8080', '10.8.0.2:8080'] });
    ws.say({ t: 'lobby', code: 'K7QF2M', seat: 0, settings: { rounds: 4, hand: 15 }, players: [{ name: 'Ann', connected: true }, null], canStart: false, addresses: (extra && extra.addresses) || ['192.168.1.23:8080', '10.8.0.2:8080'], state: 'lobby' });
    return true;
  };
  return c;
}
const PUBLIC = { state: 'ok', ip: '203.0.113.9', address: '203.0.113.9:8080', via: 'api.ipify.org' };
const listOf = c => { const html = c.html; return Array.from(html.matchAll(/<li><code>([^<]+)<\/code> <span class="field-note">([^<]+)<\/span>/g)).map(m => `${m[1]} (${m[2]})`); };
const linkOf = c => (c.html.match(/<p class="field-note"><code>(http[^<]+)<\/code>/) || [, null])[1];

(async () => {
  console.log('1. what an address typed by hand may be');
  {
    const P = G.parseJoinAddress;
    const good = [['203.0.113.9:8080', '203.0.113.9:8080'], ['203.0.113.9:9000', '203.0.113.9:9000'], ['203.0.113.9', '203.0.113.9:3000'], ['  203.0.113.9:80  ', '203.0.113.9:80'], ['http://203.0.113.9:9000/', '203.0.113.9:9000'], ['http://203.0.113.9/', '203.0.113.9:3000'], ['example.com:7777', 'example.com:7777'], ['my-pc.example.org', 'my-pc.example.org:3000'], ['[2001:db8::1]:8080', '[2001:db8::1]:8080'], ['[2001:db8::1]', '[2001:db8::1]:3000'], ['203.0.113.9:8080/?join=ABC', '203.0.113.9:8080']];
    for (const [typed, want] of good) ok(P(typed, 3000) === want, `"${typed}" is ${want}: ${P(typed, 3000)}`);
    for (const bad of ['', '   ', 'a b', '999.1.1.1:80', '203.0.113.9:0', '203.0.113.9:70000', '203.0.113.9:80:90', 'javascript:alert(1)', '<script>', 'x"><img src=x onerror=1>', '203.0.113.9:port', ':8080', 'a'.repeat(300), '2001:db8::1', null, undefined, 42]) ok(P(bad, 3000) === null || (typeof bad === 'number'), `not an address: ${JSON.stringify(bad)}`);
  }

  console.log('2. the Host screen');
  {
    const c = make({ manualInfo: true });
    c.d({ type: 'openHost' });
    let h = c.html;
    ok(/<legend>How will the others join\?<\/legend>/.test(h) && /name="net-via" id="via-local" value="local" checked/.test(h) && /id="via-public" value="public" disabled/.test(h) && /id="via-manual" value="manual"/.test(h), 'three choices: this network (chosen), over the internet (not yet usable), and a typed address');
    ok(/On this network: looking up/.test(h) && /Over the internet: looking up this computer's public address/.test(h) && /id="join-manual-box" class="manual-box" hidden/.test(h), 'while it looks: both say so, and the box for a typed address is hidden');
    ok(/id="net-server" type="hidden" value=""/.test(h) && !/id="net-server" type="text"/.test(h), '(the address the page itself connects with is no longer a field)');
    ok(/data-action="hostGame"[^>]*disabled/.test(h), 'and Create game waits');
    await wait(5);
    ok(c.fetches.map(f => f.url).join() === '/info', 'only the local address has been asked for so far');
    c.fetches[0].resolve({ addresses: ['192.168.1.23:8080', '10.8.0.2:8080'], preferred: '192.168.1.23:8080' });
    await wait(10);
    h = c.html;
    ok(/On this network: <code>192\.168\.1\.23:8080<\/code>/.test(h) && /other addresses too: 10\.8\.0\.2:8080/.test(h) && /id="net-server" type="hidden" value="192\.168\.1\.23:8080"/.test(h) && !/data-action="hostGame"[^>]*disabled/.test(h), 'the local address arrives: it is offered, the others are mentioned, and Create game is available');
    ok(c.publicReq() && c.fetches.map(f => f.url).join() === '/info,/publicip', 'and only then is the public address asked for');
    ok(/id="via-public" value="public" disabled/.test(h) && /looking up this computer's public address/.test(h), 'which can take a while: the choice stays unavailable and says it is looking');
  }

  console.log('3. the public address arrives (the form must not be redrawn)');
  {
    const c = make();
    c.d({ type: 'openHost' }); await wait(10);
    const rendersBefore = c.renders;
    c.publicReq().resolve(PUBLIC); await wait(10);
    ok(c.S.hostInfo.public.state === 'ok' && c.S.hostInfo.public.address === '203.0.113.9:8080', 'the answer is kept');
    ok(c.renders === rendersBefore, 'but the Host screen was NOT redrawn: whatever the host has typed (a name, an address) is left alone');
    const lab = c.el('#via-public-text'), rad = c.el('#via-public');
    ok(/Over the internet: <code>203\.0\.113\.9:8080<\/code>/.test(lab.innerHTML) && /found with api\.ipify\.org/.test(lab.innerHTML) && /forward port 8080 to this computer/.test(lab.innerHTML) && rad.disabled === false, 'only that one choice changed: it now shows the address, where it was found, that the router must forward the port, and can be chosen');
    // the screen opened again starts afresh
    c.d({ type: 'closeOverlay' }); c.d({ type: 'openHost' }); await wait(10);
    ok(c.S.hostInfo.public.state === 'checking' && c.fetches.filter(f => f.url === '/publicip').length === 2 && /id="via-public" value="public" disabled/.test(c.html), 'opening the screen again starts a fresh lookup (the earlier answer is not assumed to still be true)');
  }
  for (const [label, respond, want, textRe] of [
    ['could not be found', r => r.resolve({ state: 'unavailable' }), 'unavailable', /could not be found/],
    ['switched off on the server', r => r.resolve({ state: 'off' }), 'off', /not offered[^]*--no-public-ip/],
    ['the request fails', r => r.fail(), 'unavailable', /could not be found/],
    ['an error status', r => r.http(500), 'unavailable', /could not be found/],
    ['not an address at all', r => r.resolve({ state: 'ok', address: 'evil.example.com:80', via: 'x' }), 'unavailable', /could not be found/],
    ['no address in the answer', r => r.resolve({ state: 'ok' }), 'unavailable', /could not be found/],
    ['junk', r => r.resolve('<html>'), 'unavailable', /could not be found/],
    ['markup instead of an address', r => r.resolve({ state: 'ok', address: '<img src=x onerror=1>:80', via: '<b>' }), 'unavailable', /could not be found/],
  ]) {
    const c = make();
    c.d({ type: 'openHost' }); await wait(10);
    c.S.form.joinVia = 'public';                                       // (it had been chosen)
    respond(c.publicReq()); await wait(10);
    ok(c.S.hostInfo.public.state === want && c.el('#via-public').disabled === true && textRe.test(c.el('#via-public-text').innerHTML) && !/<img|<b>/.test(c.el('#via-public-text').innerHTML), `${label}: it says so, the choice stays unavailable, nothing from the answer reaches the page`);
    ok(c.S.form.joinVia === 'local' && c.el('#via-local').checked === true, `...and a choice of the internet that can no longer be made goes back to this network`);
  }
  {
    const c = make();
    c.d({ type: 'openHost' }); await wait(10);
    c.publicReq().resolve({ state: 'ok', address: '203.0.113.9:8080', via: '<img src=x onerror=alert(1)>' }); await wait(10);
    ok(c.S.hostInfo.public.state === 'ok' && !/<img/.test(c.el('#via-public-text').innerHTML) && /&lt;img/.test(c.el('#via-public-text').innerHTML), 'even the name of the service that found the address is shown as text, never as markup');
  }
  {
    const c = make();
    c.d({ type: 'openHost' }); await wait(10);
    c.advance(12500); await wait(10);
    ok(c.S.hostInfo.public.state === 'unavailable' && /could not be found/.test(c.el('#via-public-text').innerHTML), 'a lookup that never answers is given up after about 12 seconds');
    c.publicReq().resolve(PUBLIC); await wait(10);
    ok(c.S.hostInfo.public.state === 'unavailable', '(and a very late answer is ignored)');
  }
  {
    const c = make();
    c.d({ type: 'openHost' }); await wait(10);
    const first = c.publicReq();
    c.d({ type: 'closeOverlay' }); c.d({ type: 'openHost' }); await wait(10);
    first.resolve(PUBLIC); await wait(10);
    ok(c.S.hostInfo.public.state === 'checking', 'an answer to an earlier opening of the screen does not change the one now showing');
  }

  console.log('4. choosing, and creating the game');
  {
    const c = make();
    c.d({ type: 'openHost' }); await wait(10); c.publicReq().resolve(PUBLIC); await wait(10);
    c.d({ type: 'setJoinVia', value: 'public' });
    ok(c.S.form.joinVia === 'public', 'choosing the internet is remembered');
    c.d({ type: 'setJoinVia', value: 'nonsense' });
    ok(c.S.form.joinVia === 'local', '(anything else means this network)');
  }
  {
    const c = make(); c.d({ type: 'openHost' }); await wait(10); c.publicReq().resolve(PUBLIC); await wait(10);
    ok(await c.lobby({ joinVia: 'local' }), 'a game is created with "this network"');
    ok(c.S.online.join.via === 'local' && FakeWS.last.sent[0].t === 'create', 'the way to join is not sent to the server (it is only about what the page shows)');
    ok(JSON.stringify(FakeWS.last.sent[0]).includes('203.0.113') === false, '(and nothing about the addresses is sent)');
    ok(listOf(c).join(' | ') === '192.168.1.23:8080 (on this network) | 10.8.0.2:8080 (on this network) | 203.0.113.9:8080 (over the internet)', 'the lobby lists this network first, then the internet: ' + listOf(c).join(' | '));
    ok(linkOf(c) === 'http://192.168.1.23:8080/?join=K7QF2M' && /Scan with a phone on the same network/.test(c.html), 'the QR code and link use this network: ' + linkOf(c));
    ok(/data-action="copyLink" data-key="http:\/\/192\.168\.1\.23:8080\/\?join=K7QF2M"/.test(c.html), 'and so does Copy link');
  }
  {
    const c = make(); c.d({ type: 'openHost' }); await wait(10); c.publicReq().resolve(PUBLIC); await wait(10);
    await c.lobby({ joinVia: 'public' });
    ok(listOf(c)[0] === '203.0.113.9:8080 (over the internet)' && listOf(c).length === 3, 'with "over the internet" the public address comes first, then the local ones: ' + listOf(c).join(' | '));
    ok(linkOf(c) === 'http://203.0.113.9:8080/?join=K7QF2M' && /over the internet/.test(c.html.match(/<div class="qrtext"><p>([^<]+)/)[1]) && /forward port 8080/.test(c.html), 'the QR code and link use it, and the note about the router is there: ' + linkOf(c));
    ok(/data-action="selectQr" data-key="1" aria-pressed="false">Show QR/.test(c.html) && /data-key="0" aria-pressed="true">QR shown/.test(c.html), 'the others can be shown as the QR code instead');
    c.d({ type: 'selectQr', key: 1 });
    ok(linkOf(c) === 'http://192.168.1.23:8080/?join=K7QF2M' && /Scan with a phone on the same network/.test(c.html), 'choosing one changes the QR code and link');
  }
  {
    const c = make(); c.d({ type: 'openHost' }); await wait(10);                      // the public address never arrived
    await c.lobby({ joinVia: 'local' });
    ok(listOf(c).join(' | ') === '192.168.1.23:8080 (on this network) | 10.8.0.2:8080 (on this network)', 'without a public address the lobby offers only the local ones');
    c.publicReq().resolve(PUBLIC); await wait(10); c.d({ type: 'selectQr', key: 0 });
    ok(listOf(c).length === 3 && /203\.0\.113\.9:8080 \(over the internet\)/.test(listOf(c).join('|')), 'and when it turns up afterwards, the lobby offers it too');
  }
  {
    const c = make(); c.d({ type: 'openHost' }); await wait(10);
    const nConn = FakeWS.all.length;
    c.d({ type: 'hostGame', server: 'x', name: 'Ann', rounds: 4, hand: 15, joinVia: 'public' }); await wait(10);
    ok(!c.S.online && FakeWS.all.length === nConn && /public address is not known/.test(c.html), 'the internet chosen when there is no public address: no game is created (no connection is even made), and it says why');
    ok(c.S.form.joinVia === 'public', '(the choice is still there on the screen)');
  }
  console.log('5. an address typed by hand');
  {
    const before = FakeWS.all.length;
    const c = make(); c.d({ type: 'openHost' }); await wait(10);
    await c.lobby({ joinVia: 'manual', joinManual: '198.51.100.4:9000' });
    ok(listOf(c)[0] === '198.51.100.4:9000 (typed by you)' && listOf(c).length === 3, 'a typed address comes first: ' + listOf(c).join(' | '));
    ok(linkOf(c) === 'http://198.51.100.4:9000/?join=K7QF2M' && /address you typed/.test(c.html), 'the QR code and link use it: ' + linkOf(c));
    const c2 = make(); c2.d({ type: 'openHost' }); await wait(10);
    await c2.lobby({ joinVia: 'manual', joinManual: '198.51.100.4' });
    ok(linkOf(c2) === 'http://198.51.100.4:8080/?join=K7QF2M', 'with no port typed, the server\'s own port is used: ' + linkOf(c2));
    const c3 = make({ addresses: ['192.168.1.23:3456'] }); c3.d({ type: 'openHost' }); await wait(10);
    await c3.lobby({ joinVia: 'manual', joinManual: 'my-pc.example.org' }, { addresses: ['192.168.1.23:3456'] });
    ok(linkOf(c3) === 'http://my-pc.example.org:3456/?join=K7QF2M', '(whatever that port is: 3456 here)');
    const c4 = make(); c4.d({ type: 'openHost' }); await wait(10);
    await c4.lobby({ joinVia: 'manual', joinManual: '192.168.1.23:8080' });
    ok(listOf(c4).filter(x => /^192\.168\.1\.23:8080/.test(x)).length === 1, 'an address typed that is already on the list is listed once');
    const c5 = make(); c5.d({ type: 'openHost' }); await wait(10); c5.publicReq().resolve(PUBLIC); await wait(10);
    await c5.lobby({ joinVia: 'manual', joinManual: '203.0.113.9:8080' });
    ok(listOf(c5).filter(x => /^203\.0\.113\.9:8080/.test(x)).length === 1, '(also the public one)');
    for (const bad of ['', '   ', 'not an address', '999.1.1.1:80', 'x"><img src=x onerror=1>', 'javascript:alert(1)', '203.0.113.9:0']) {
      const d = make(); d.d({ type: 'openHost' }); await wait(10);
      const n = FakeWS.all.length;
      d.d({ type: 'hostGame', server: 'x', name: 'Ann', rounds: 4, hand: 15, joinVia: 'manual', joinManual: bad }); await wait(10);
      ok(!d.S.online && FakeWS.all.length === n && /role="alert"/.test(d.html) && (bad.trim() ? /not an address/.test(d.html) : /Type the address/.test(d.html)) && !/<img src=x/.test(d.html), `typed ${JSON.stringify(bad)}: no game is created, it says what is wrong, nothing is injected`);
      ok(d.S.form.joinVia === 'manual' && d.S.form.joinManual === bad.trim(), '...and the choice and what was typed are still on the screen');
      ok(/id="join-manual" type="text" value="/.test(d.html) && !/id="join-manual-box" class="manual-box" hidden/.test(d.html), '...with the box for it showing');
    }
    ok(FakeWS.all.length - before === 5, `one connection for each of the five games that were created, none for the rejected ones (${FakeWS.all.length - before})`);
  }

  console.log('6. the host\'s own page connects to where it was loaded from');
  {
    // The page was loaded through the PUBLIC address (a forwarded port), while the server says its local-network address is 192.168.1.170:8081,
    // which this page cannot reach (it is not on that network). Hosting must work all the same, whichever way the others are to join.
    FakeWS.unreachable = '192.168.1.170';
    for (const via of ['local', 'public', 'manual']) {
      const c = make({ origin: '203.0.113.9:8081', addresses: ['192.168.1.170:8081'] });
      c.d({ type: 'openHost' }); await wait(10); c.publicReq().resolve({ state: 'ok', ip: '203.0.113.9', address: '203.0.113.9:8081', via: 'api.ipify.org' }); await wait(10);
      const n = FakeWS.all.length;
      const made = await c.lobby({ joinVia: via, joinManual: '198.51.100.4:9000' }, { addresses: ['192.168.1.170:8081'] });
      ok(made && FakeWS.all[n].url === 'ws://203.0.113.9:8081/ws' && FakeWS.all.slice(n).every(w => !String(w.url).includes('192.168.1.170')) && c.S.online.server === '203.0.113.9:8081' && !c.S.onlineError, `choosing "${via}": the page connects to the address it was loaded from (203.0.113.9:8081), never to the unreachable local one, and reaches the lobby (${made ? FakeWS.all[n].url : 'no game: ' + c.S.onlineError})`);
      ok(!/Could not reach/.test(c.html), `(and there is no "Could not reach" message)`);
      const want = { local: '192.168.1.170:8081', public: '203.0.113.9:8081', manual: '198.51.100.4:9000' }[via];
      ok(linkOf(c) === `http://${want}/?join=K7QF2M`, `while the lobby still offers the others the address chosen: ${linkOf(c)}`);
    }
    FakeWS.unreachable = null;
    // a page opened from a file (no address it came from) can only use the one the server reported
    const f = make({ origin: '', addresses: ['192.168.1.170:8081'] });
    f.d({ type: 'openHost' }); await wait(10);
    const n2 = FakeWS.all.length;
    await f.lobby({ joinVia: 'local' }, { addresses: ['192.168.1.170:8081'] });
    ok(FakeWS.all[n2] && FakeWS.all[n2].url === 'ws://192.168.1.170:8081/ws', 'with no address it was loaded from, it uses the one the server reported');
    // a typed address with no port gets the server's REAL port, not the port of a forwarded address the page was loaded through
    const g = make({ origin: '203.0.113.9:80', addresses: ['192.168.1.170:8081'] });
    g.d({ type: 'openHost' }); await wait(10);
    await g.lobby({ joinVia: 'manual', joinManual: '198.51.100.4' }, { addresses: ['192.168.1.170:8081'] });
    ok(linkOf(g) === 'http://198.51.100.4:8081/?join=K7QF2M', 'a typed address with no port gets the server\'s own port (8081), not the forwarded 80 this page came through: ' + linkOf(g));
  }

  console.log('7. the guest');
  {
    const c = make(); c.d({ type: 'openJoin' });
    ok(!/join-choices|via-local|via-public|How will the others join/.test(c.html) && /id="net-server" type="text"/.test(c.html), 'the Join screen has none of this: the guest types the host\'s address as before');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
