'use strict';
// The server finding out its public address: GET /publicip. The "services" asked are small local HTTP servers, so the real request code
// runs (IPv4, time limit, size limit, no redirects, validation, caching, one question at a time, the switch that turns it off).
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { createGameServer, isPublicIPv4 } = require('../server.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

function provider(handler) {                                         // a stand-in for "what is my address" service; counts how often it is asked
  const p = { hits: 0, headers: [], methods: [] };
  p.server = http.createServer((req, res) => { p.hits++; p.headers.push(req.headers); p.methods.push(req.method); handler(req, res, p); });
  return new Promise(r => p.server.listen(0, '127.0.0.1', () => { p.url = `http://127.0.0.1:${p.server.address().port}/`; p.close = () => new Promise(x => { p.server.closeAllConnections && p.server.closeAllConnections(); p.server.close(x); }); r(p); }));
}
const say = text => (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(text); };
function get(port, p, method) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET' }, res => { let b = ''; res.on('data', c => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b, json: (() => { try { return JSON.parse(b); } catch (e) { return null; } })() })); });
    r.on('error', reject); r.end();
  });
}
async function serverWith(urls, extra) {
  const srv = createGameServer(Object.assign({ publicIpUrls: urls, publicIpTimeoutMs: 400, publicIpCacheMs: 400, publicIpFailMs: 250, log: () => {} }, extra || {}));
  const port = await srv.listen(0);                                // (on every interface, like a real host; a server on 127.0.0.1 only is "local-only", tested below)
  return { srv, port };
}

(async () => {
  console.log('1. which addresses count as public');
  {
    const yes = ['203.0.113.7', '8.8.8.8', '172.32.0.1', '100.128.0.1', '192.0.2.5', '1.1.1.1'];
    const no = ['10.0.0.5', '192.168.1.2', '172.16.0.1', '172.31.255.255', '127.0.0.1', '100.64.0.1', '100.127.255.255', '169.254.1.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.0.9', '999.1.1.1', '1.2.3', '1.2.3.4.5', '::1', '2001:db8::1', 'example.com', '', ' 8.8.8.8', '8.8.8.8\n', '8.8.8.8:80', '08.8.8.8x', '<html>', '-1.2.3.4'];
    ok(yes.every(isPublicIPv4), `public: ${yes.join(', ')}`);
    ok(no.every(x => !isPublicIPv4(x)), 'not public (private, loopback, link-local, carrier-grade NAT, multicast, reserved, malformed, a name, or IPv6)');
  }

  console.log('2. a service answers');
  {
    const a = await provider(say('203.0.113.7\n'));
    const { srv, port } = await serverWith([a.url]);
    const r = await get(port, '/publicip');
    ok(r.status === 200 && r.json.state === 'ok' && r.json.ip === '203.0.113.7' && r.json.address === `203.0.113.7:${port}` && r.json.via === new URL(a.url).host, 'the answer is the address, with the server\'s own port, and which service said so: ' + r.body);
    ok(/application\/json/.test(r.headers['content-type']) && r.headers['cache-control'] === 'no-store' && r.headers['x-content-type-options'] === 'nosniff', 'sent as JSON, not to be cached');
    ok(a.methods[0] === 'GET' && /mexican-train/.test(a.headers[0]['user-agent']) && !a.headers[0].cookie && !a.headers[0].authorization, 'the service is sent a plain GET saying only what this is (no cookies, no secrets)');
    const h = await get(port, '/publicip', 'HEAD');
    ok(h.status === 200 && h.body === '', 'HEAD works');
    const po = await get(port, '/publicip', 'POST');
    ok(po.status === 405, 'and only GET and HEAD');
    const other = await get(port, '/info');
    ok(other.json && Array.isArray(other.json.addresses) && other.json.preferred, '(/info is as it was)');
    await srv.close(); await a.close();
  }

  console.log('3. answers that are not trusted');
  for (const [label, handler] of [
    ['an HTML page', say('<html><body>Hello</body></html>')],
    ['an empty answer', say('')],
    ['a private address', say('192.168.0.9')],
    ['loopback', say('127.0.0.1')],
    ['an address that is not an address (999.1.1.1)', say('999.1.1.1')],
    ['IPv6', say('2001:db8::1')],
    ['two addresses', say('8.8.8.8 1.1.1.1')],
    ['text with the address inside it', say('Your address is 8.8.8.8')],
    ['a server error (500)', (q, s) => { s.writeHead(500); s.end('203.0.113.7'); }],
    ['a redirect (not followed)', (q, s) => { s.writeHead(302, { Location: 'http://127.0.0.1:1/' }); s.end('203.0.113.7'); }],
    ['a "not found"', (q, s) => { s.writeHead(404); s.end('203.0.113.7'); }],
  ]) {
    const a = await provider(handler);
    const { srv, port } = await serverWith([a.url]);
    const r = await get(port, '/publicip');
    ok(r.json && r.json.state === 'unavailable' && !('ip' in r.json) && !('address' in r.json), `${label}: no address is offered (${r.body})`);
    await srv.close(); await a.close();
  }
  {
    // a good address followed by pages of nothing: only the size limit can refuse it (the text itself would pass once trimmed)
    const big = await provider((q, s) => { s.writeHead(200); s.end('8.8.8.8' + ' '.repeat(5000)); });
    const { srv, port } = await serverWith([big.url]);
    ok((await get(port, '/publicip')).json.state === 'unavailable', 'a reply that is more than a short line is refused, even when the address in it is fine');
    await srv.close(); await big.close();
    // a service that never stops sending is cut off, not read for ever
    let aborted = false;
    const endless = await provider((q, s) => { s.writeHead(200); const t = setInterval(() => s.write(' '.repeat(1000)), 5); s.on('close', () => { aborted = true; clearInterval(t); }); });
    const e = await serverWith([endless.url]);
    const t0 = Date.now(); const r = await get(e.port, '/publicip');
    await wait(100);
    ok(r.json.state === 'unavailable' && Date.now() - t0 < 1500 && aborted, `a service that never stops sending is cut off and its connection closed (${Date.now() - t0} ms)`);
    await e.srv.close(); await endless.close();
  }

  console.log('4. one service failing does not stop the next');
  {
    const bad = await provider(say('not an address')), slow = await provider(() => { /* never answers */ }), good = await provider(say('198.51.100.23'));
    const { srv, port } = await serverWith([bad.url, slow.url, 'http://127.0.0.1:1/', good.url]);
    const t0 = Date.now();
    const r = await get(port, '/publicip');
    ok(r.json.state === 'ok' && r.json.ip === '198.51.100.23' && r.json.via === new URL(good.url).host, 'a service that gives rubbish, one that never answers, and one that is not there are all skipped: ' + r.body);
    ok(Date.now() - t0 < 1500 && bad.hits === 1 && slow.hits === 1 && good.hits === 1, `each asked once, and the one that never answers for no longer than its limit (${Date.now() - t0} ms)`);
    await srv.close(); await bad.close(); await slow.close(); await good.close();
  }
  {
    const slow1 = await provider(() => {}), slow2 = await provider(() => {});
    const { srv, port } = await serverWith([slow1.url, slow2.url]);
    const t0 = Date.now(); const r = await get(port, '/publicip');
    ok(r.json.state === 'unavailable' && Date.now() - t0 < 1500, `if nothing answers it says so after the limits, not never (${Date.now() - t0} ms)`);
    await srv.close(); await slow1.close(); await slow2.close();
  }

  console.log('5. remembered, and asked one at a time');
  {
    const a = await provider(say('203.0.113.50'));
    const { srv, port } = await serverWith([a.url], { publicIpCacheMs: 350 });
    const rs = await Promise.all(Array.from({ length: 12 }, () => get(port, '/publicip')));
    ok(rs.every(r => r.json.state === 'ok') && a.hits === 1, `twelve questions at once are one question to the service (${a.hits})`);
    await get(port, '/publicip'); await get(port, '/publicip');
    ok(a.hits === 1, 'and later ones are answered from memory');
    await wait(450);
    await get(port, '/publicip');
    ok(a.hits === 2, 'until the memory runs out, when it asks again');
    await srv.close(); await a.close();
  }
  {
    const a = await provider((q, s) => { s.writeHead(500); s.end(); });
    const { srv, port } = await serverWith([a.url], { publicIpFailMs: 300 });
    for (let i = 0; i < 20; i++) await get(port, '/publicip');
    ok(a.hits === 1, `a service that is failing is not asked again for every question (20 questions, ${a.hits} asked)`);
    await wait(380);
    await get(port, '/publicip');
    ok(a.hits === 2, '...but is tried again after a short while');
    await srv.close(); await a.close();
  }
  {
    let mode = 'bad';
    const a = await provider((q, s) => { if (mode === 'bad') { s.writeHead(500); s.end(); } else say('203.0.113.99')(q, s); });
    const { srv, port } = await serverWith([a.url], { publicIpFailMs: 200 });
    const first = await get(port, '/publicip'); mode = 'good'; await wait(260);
    const second = await get(port, '/publicip');
    ok(first.json.state === 'unavailable' && second.json.state === 'ok' && second.json.ip === '203.0.113.99', 'once the network is back, the next question finds the address');
    await srv.close(); await a.close();
  }

  console.log('5b. a public address can change: every click of "Host online game" is a fresh question');
  {
    const d = createGameServer({ log: () => {} });
    ok(d.options.publicIpCacheMs <= 5000 && d.options.publicIpFailMs <= 5000 && d.options.publicIpCacheMs > 0, `by default an answer is reused for no more than 5 seconds, a failure too (${d.options.publicIpCacheMs} ms, ${d.options.publicIpFailMs} ms), not for minutes`);
  }
  {
    let n = 0;
    const a = await provider((q, r) => { n++; r.writeHead(200); r.end(n === 1 ? '203.0.113.10' : '203.0.113.77'); });
    const { srv, port } = await serverWith([a.url], { publicIpCacheMs: 250, publicIpFailMs: 250 });
    const first = await get(port, '/publicip');
    const again = await get(port, '/publicip');
    ok(first.json.ip === '203.0.113.10' && again.json.ip === '203.0.113.10' && a.hits === 1, 'two clicks right after each other get the same answer from one question (a double click does not ask twice)');
    await wait(330);
    const later = await get(port, '/publicip');
    ok(later.json.ip === '203.0.113.77' && later.json.address === `203.0.113.77:${port}` && a.hits === 2, 'but the next click after that asks again, and so notices that the address has changed: ' + later.body);
    await wait(330);
    const third = await get(port, '/publicip');
    ok(a.hits === 3 && third.json.ip === '203.0.113.77', 'and again, each time (asked ' + a.hits + ' times for three clicks spread out)');
    await srv.close(); await a.close();
  }
  {
    // the service is reachable at first and then is not: the old address is not kept as if it were still true
    let up = true;
    const a = await provider((q, r) => { if (up) { r.writeHead(200); r.end('203.0.113.10'); } else { r.writeHead(503); r.end(); } });
    const { srv, port } = await serverWith([a.url], { publicIpCacheMs: 200, publicIpFailMs: 200 });
    const first = await get(port, '/publicip'); up = false; await wait(280);
    const second = await get(port, '/publicip');
    ok(first.json.state === 'ok' && second.json.state === 'unavailable' && !('ip' in second.json), 'when the next click cannot find the address, the old one is not offered any more (it may have changed)');
    await srv.close(); await a.close();
  }

  console.log('6. when it must not ask');
  {
    const a = await provider(say('203.0.113.7'));
    const off = await serverWith([a.url], { publicIp: false });
    const r1 = await get(off.port, '/publicip');
    ok(r1.json.state === 'off' && !('ip' in r1.json) && a.hits === 0, 'switched off: it says "off" and the service is never contacted');
    await off.srv.close();
    const lo = createGameServer({ publicIpUrls: [a.url], localOnly: true, log: () => {} });
    const lp = await lo.listen(0, '127.0.0.1');
    const r2 = await get(lp, '/publicip');
    ok(r2.json.state === 'off' && a.hits === 0, 'a server only this computer can reach has no public address to offer, and does not ask');
    await lo.close();
    const quiet = await serverWith([a.url]);
    ok(a.hits === 0, 'merely starting the server asks nothing (only the Host screen does)');
    await get(quiet.port, '/'); await get(quiet.port, '/info'); await get(quiet.port, '/healthz'); await get(quiet.port, '/netstats');
    ok(a.hits === 0, '...nor does serving the page or any other route');
    await quiet.srv.close(); await a.close();
  }
  {
    let calls = 0;
    const { srv, port } = await serverWith([], { publicIpLookup: async () => { calls++; return { ip: '203.0.113.8', via: 'test' }; } });
    const r = await get(port, '/publicip');
    ok(r.json.state === 'ok' && r.json.ip === '203.0.113.8' && r.json.via === 'test' && calls === 1, 'a test can supply its own lookup');
    await srv.close();
    const bad = await serverWith([], { publicIpLookup: async () => ({ ip: '10.1.2.3' }) });
    ok((await get(bad.port, '/publicip')).json.state === 'unavailable', '(and what it returns is checked just the same)');
    await bad.srv.close();
    const thrower = await serverWith([], { publicIpLookup: async () => { throw new Error('boom'); } });
    ok((await get(thrower.port, '/publicip')).json.state === 'unavailable', '(and a lookup that throws is just "unavailable")');
    await thrower.srv.close();
  }

  console.log('7. the command line');
  {
    const node = process.execPath, server = path.join(__dirname, '..', 'server.js');
    const help = await new Promise(r => { const c = spawn(node, [server, '--help']); let o = ''; c.stdout.on('data', d => (o += d)); c.on('close', () => r(o)); });
    ok(/--no-public-ip/.test(help) && /api\.ipify\.org/.test(help) && /only when you open the Host screen/.test(help), '--help describes --no-public-ip, says which service is asked and when');
    const port = 38000 + Math.floor(Math.random() * 1500);
    const child = spawn(node, [server, '--no-public-ip', '--port', String(port), '--quiet']);
    let out = ''; child.stdout.on('data', d => (out += d));
    for (let i = 0; i < 40 && !/is running/.test(out); i++) await wait(100);
    const r = await get(port, '/publicip');
    ok(r.json && r.json.state === 'off', 'node server.js --no-public-ip: the answer is "off"');
    child.kill();
    const bad = await new Promise(r => { const c = spawn(node, [server, '--no-public-ipp']); let o = ''; c.stderr.on('data', d => (o += d)); c.on('close', code => r({ code, o })); });
    ok(bad.code === 1 && /Unknown option/.test(bad.o), 'and a misspelt option is still refused');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
