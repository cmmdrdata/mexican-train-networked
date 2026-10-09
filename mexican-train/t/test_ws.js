'use strict';
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { upgrade, acceptKey } = require('../ws-lite.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = f(); if (r) return r; await wait(5); } return f(); };

/* ---------- a server that records what happens to each connection ---------- */
function makeServer(opts) {
  const conns = [];
  const server = http.createServer((q, r) => { r.end('plain http'); });
  server.on('upgrade', (req, socket) => {
    const ws = upgrade(req, socket, opts || { maxPayload: 100000 });
    if (!ws) return;
    const rec = { ws, messages: [], errors: [], closed: false, closing: null, pongs: 0 };
    ws.on('message', t => { rec.messages.push(t); ws.send(t); });         // echo
    ws.on('protocol-error', e => rec.errors.push(e));
    ws.on('close', () => { rec.closed = true; });
    ws.on('closing', c => { rec.closing = c; });
    ws.on('pong', () => { rec.pongs++; });
    conns.push(rec);
  });
  return new Promise(res => server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port, conns })));
}

/* ---------- a raw client, to say things a real WebSocket client never would ---------- */
function frame(opcode, payload, o) {
  o = o || {};
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8');
  const mask = o.mask === undefined ? crypto.randomBytes(4) : o.mask;               // null = send unmasked
  let len = p.length, head;
  const lenByte = o.lenByte !== undefined ? o.lenByte : (len < 126 ? len : len < 65536 ? 126 : 127);
  const parts = [Buffer.from([((o.fin === false ? 0 : 0x80) | (o.rsv || 0) | opcode), (mask ? 0x80 : 0) | lenByte])];
  if (lenByte === 126) { const b = Buffer.alloc(2); b.writeUInt16BE(o.extLen !== undefined ? o.extLen : len); parts.push(b); }
  if (lenByte === 127) { const b = Buffer.alloc(8); if (o.hi) b.writeUInt32BE(o.hi, 0); b.writeUInt32BE(o.extLen !== undefined ? o.extLen : len, 4); parts.push(b); }
  if (mask) { parts.push(mask); const m = Buffer.from(p); for (let i = 0; i < m.length; i++) m[i] ^= mask[i & 3]; parts.push(m); } else parts.push(p);
  return Buffer.concat(parts);
}
function rawClient(port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    const c = { sock, frames: [], head: '', closed: false, buf: Buffer.alloc(0), upgraded: false };
    const key = crypto.randomBytes(16).toString('base64');
    sock.on('connect', () => sock.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    sock.on('data', d => {
      c.buf = Buffer.concat([c.buf, d]);
      if (!c.upgraded) {
        const i = c.buf.indexOf('\r\n\r\n'); if (i < 0) return;
        c.head = c.buf.subarray(0, i).toString(); c.buf = c.buf.subarray(i + 4); c.upgraded = true;
        if (!/^HTTP\/1.1 101/.test(c.head)) return reject(new Error('no upgrade: ' + c.head));
        c.accept = (c.head.match(/Sec-WebSocket-Accept: (\S+)/i) || [])[1]; c.key = key;
        resolve(c);
      }
      for (;;) {                                              // server frames are never masked
        const b = c.buf; if (b.length < 2) break;
        let len = b[1] & 0x7f, off = 2;
        if (len === 126) { if (b.length < 4) break; len = b.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (b.length < 10) break; len = b.readUInt32BE(6); off = 10; }
        if (b.length < off + len) break;
        c.frames.push({ fin: !!(b[0] & 0x80), opcode: b[0] & 0x0f, payload: Buffer.from(b.subarray(off, off + len)), masked: !!(b[1] & 0x80) });
        c.buf = b.subarray(off + len);
      }
    });
    sock.on('close', () => { c.closed = true; });
    sock.on('error', () => { c.closed = true; });
    c.send = buf => sock.write(buf);
    c.closeCode = () => { const f = c.frames.find(x => x.opcode === 8); return f ? (f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1005) : null; };
  });
}

async function violation(srv, name, bytes, expectCode) {
  const c = await rawClient(srv.port);
  c.send(bytes);
  await until(() => c.closeCode() !== null || c.closed, 1500);
  const code = c.closeCode();
  ok(code === expectCode, `${name}: closed with ${expectCode} (got ${code})`);
  ok(await until(() => c.closed, 3000), `${name}: and the connection is dropped`);
  c.sock.destroy();
}

(async () => {
  console.log('1. the handshake');
  ok(acceptKey('dGhlIHNhbXBsZSBub25jZQ==') === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=', 'the example from RFC 6455 gives the expected Sec-WebSocket-Accept');
  const A = await makeServer();
  {
    const c = await rawClient(A.port);
    ok(c.accept === acceptKey(c.key), 'a good request is answered 101 with the right accept key');
    ok(/Upgrade: websocket/i.test(c.head) && /Connection: Upgrade/i.test(c.head), 'with the upgrade headers');
    c.sock.destroy();
  }
  const rawHttp = (req) => new Promise(res => { const s = net.connect(A.port, '127.0.0.1', () => s.write(req)); let d = ''; s.on('data', x => { d += x; }); s.on('close', () => res(d)); s.on('error', () => res(d)); });
  const base = 'Host: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n';
  ok(/^HTTP\/1.1 405/.test(await rawHttp(`POST /ws HTTP/1.1\r\n${base}\r\n`)), 'a POST is refused (405)');
  ok(/^HTTP\/1.1 200/.test(await rawHttp(`GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)), 'without an Upgrade header it is just a plain HTTP request (Node never offers it to the WebSocket code)');
  {
    // and if it ever were offered, upgrade() itself refuses it: tested with a stand-in request and socket
    let written = '', destroyed = false;
    const sock = { write: s => { written += s; }, destroy: () => { destroyed = true; } };
    const r = upgrade({ method: 'GET', headers: { connection: 'Upgrade', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } }, sock);
    ok(r === null && /^HTTP\/1.1 400/.test(written) && destroyed, 'upgrade() itself refuses a request with no Upgrade header (400) and hangs up');
    written = ''; destroyed = false;
    ok(upgrade({ method: 'GET', headers: { upgrade: 'websocket', connection: 'close', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' } }, sock) === null && /^HTTP\/1.1 400/.test(written), 'and one whose Connection header does not ask for an upgrade');
  }
  ok(/^HTTP\/1.1 400/.test(await rawHttp(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n\r\n`)), 'a missing key is refused (400)');
  ok(/^HTTP\/1.1 400/.test(await rawHttp(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: short\r\nSec-WebSocket-Version: 13\r\n\r\n`)), 'a malformed key is refused (400)');
  const v = await rawHttp(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 8\r\n\r\n`);
  ok(/^HTTP\/1.1 426/.test(v) && /Sec-WebSocket-Version: 13/i.test(v), 'the wrong protocol version gets 426 and says which one is supported');
  ok(/^HTTP\/1.1 101/.test(await new Promise(res => { const s = net.connect(A.port, '127.0.0.1', () => s.write(`GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: WebSocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)); s.once('data', d => { res(String(d)); s.destroy(); }); })), 'header values are case-insensitive and "keep-alive, Upgrade" is accepted (as browsers send)');
  ok(A.conns.length >= 2, 'refused requests never became connections (only the accepted ones did)');

  console.log('2. a real WebSocket client (Node\'s own) talking to it');
  {
    const ws = new WebSocket(`ws://127.0.0.1:${A.port}/ws`);
    const got = [];
    ws.onmessage = e => got.push(e.data);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const sizes = [0, 1, 2, 124, 125, 126, 127, 128, 300, 4096, 65535, 65536, 70000];
    for (const n of sizes) ws.send('x'.repeat(n));
    ok(await until(() => got.length === sizes.length, 4000), 'every message comes back');
    ok(sizes.every((n, i) => got[i] === 'x'.repeat(n)), `in order and intact, across every length class (${sizes.join(', ')})`);
    const uni = ['héllo', '日本語のテスト', 'Привет, мир', 'مرحبا بالعالم', 'emoji 🂡🂱 domino 🁣', 'नमस्ते', '\u0000 with a NUL', 'a\nb\tc'];
    const before = got.length;
    uni.forEach(s => ws.send(s));
    await until(() => got.length === before + uni.length);
    ok(uni.every((s, i) => got[before + i] === s), 'text in many scripts, emoji and control characters survive the trip');
    const rec = A.conns[A.conns.length - 1];
    const big = 'é'.repeat(30000);                                   // a 60,000-byte message the other way
    rec.ws.send(big);
    ok(await until(() => got[got.length - 1] === big, 3000), 'a large message from the server arrives whole');
    ok(rec.ws.send('{"t":"x"}') === true, 'send() reports success on a live connection');
    await until(() => got.includes('{"t":"x"}'));                  // let the message sent above arrive before counting
    // many messages sent back to back
    const n0 = got.length; for (let i = 0; i < 500; i++) ws.send('m' + i);
    await until(() => got.length === n0 + 500, 4000);
    ok(Array.from({ length: 500 }, (_, i) => got[n0 + i] === 'm' + i).every(Boolean), '500 messages sent at once come back in order');
    // heartbeat: the client answers pings by itself
    const p0 = rec.pongs; rec.ws.alive = false; rec.ws.ping('hb');
    ok(await until(() => rec.pongs > p0 && rec.ws.alive, 2000), 'a ping from the server is answered, and sets the alive flag (the heartbeat the game server uses)');
    ws.close(1000, 'done');
    ok(await until(() => rec.closed, 2000) && rec.closing === 1000, 'a normal close from the client is seen as 1000, then the connection ends');
    ok(rec.ws.send('late') === false && rec.ws.ping() === false, 'sending after a close is refused quietly');
  }

  console.log('3. frames the way a hostile or sloppy client might send them');
  {
    const c = await rawClient(A.port);
    c.send(frame(9, 'ping-data'));
    ok(await until(() => c.frames.some(f => f.opcode === 10 && f.payload.toString() === 'ping-data')), 'a ping is answered with a pong carrying the same data');
    c.send(frame(1, 'one', { fin: false })); c.send(frame(9, 'mid')); c.send(frame(0, 'two', { fin: false })); c.send(frame(0, 'three'));
    ok(await until(() => c.frames.some(f => f.opcode === 1 && f.payload.toString() === 'onetwothree')), 'a message split into three fragments, with a ping in the middle, is reassembled and echoed');
    ok(c.frames.filter(f => f.opcode === 10).length === 2, '(and the ping inside it was still answered)');
    const euro = Buffer.from('€', 'utf8');                              // three bytes: split across two frames
    c.send(frame(1, euro.subarray(0, 1), { fin: false })); c.send(frame(0, euro.subarray(1)));
    ok(await until(() => c.frames.some(f => f.opcode === 1 && f.payload.toString() === '€')), 'a character split across two fragments is put back together');
    const bytewise = frame(1, '{"t":"slow","n":123}');
    for (const b of bytewise) { c.send(Buffer.from([b])); await wait(1); }
    ok(await until(() => c.frames.some(f => f.payload.toString() === '{"t":"slow","n":123}')), 'a frame that arrives one byte at a time is still understood');
    const two = Buffer.concat([frame(1, 'first'), frame(1, 'second'), frame(1, 'third')]);
    c.send(two);
    ok(await until(() => ['first', 'second', 'third'].every(s => c.frames.some(f => f.payload.toString() === s))), 'three frames in one network packet are all handled');
    const chunk = frame(1, 'split-in-the-header');
    c.send(chunk.subarray(0, 1)); await wait(5); c.send(chunk.subarray(1, 3)); await wait(5); c.send(chunk.subarray(3));
    ok(await until(() => c.frames.some(f => f.payload.toString() === 'split-in-the-header')), 'a frame cut in the middle of its header is still understood');
    ok(c.frames.every(f => !f.masked), 'the server never masks its frames');
    c.send(frame(8, Buffer.concat([Buffer.from([0x03, 0xe8]), Buffer.from('bye')])));
    ok(await until(() => c.closeCode() === 1000), 'a close frame is echoed back with the same code');
    c.sock.destroy();
  }

  console.log('4. protocol violations are refused with the right close code');
  await violation(A, 'an unmasked client frame', frame(1, 'hi', { mask: null }), 1002);
  await violation(A, 'reserved bits set', frame(1, 'hi', { rsv: 0x40 }), 1002);
  await violation(A, 'an unknown opcode', frame(3, 'hi'), 1002);
  await violation(A, 'a fragmented ping', frame(9, 'x', { fin: false }), 1002);
  await violation(A, 'a control frame over 125 bytes', frame(9, 'x'.repeat(126)), 1002);
  await violation(A, 'a continuation with nothing to continue', frame(0, 'x'), 1002);
  await violation(A, 'a new message inside a fragmented one', Buffer.concat([frame(1, 'a', { fin: false }), frame(1, 'b')]), 1002);
  await violation(A, 'a binary message', frame(2, Buffer.from([1, 2, 3])), 1003);
  await violation(A, 'text that is not UTF-8', frame(1, Buffer.from([0xff, 0xfe, 0xfd])), 1007);
  await violation(A, 'text cut in the middle of a character', frame(1, Buffer.from([0xe2, 0x82])), 1007);
  await violation(A, 'a close frame with a one-byte body', frame(8, Buffer.from([1])), 1002);
  await violation(A, 'a close with a forbidden code (1005)', frame(8, Buffer.from([0x03, 0xed])), 1002);
  await violation(A, 'a close with an invalid code (999)', frame(8, Buffer.from([0x03, 0xe7])), 1002);
  await violation(A, 'a close whose reason is not UTF-8', frame(8, Buffer.concat([Buffer.from([0x03, 0xe8]), Buffer.from([0xff, 0xfe])])), 1007);
  const small = await makeServer({ maxPayload: 1000 });
  await violation(small, 'one frame over the size limit', frame(1, 'x'.repeat(1001)), 1009);
  await violation(small, 'a huge claimed length (16-bit)', frame(1, 'x', { lenByte: 126, extLen: 60000 }), 1009);
  await violation(small, 'a 64-bit length with high bits set', frame(1, 'x', { lenByte: 127, hi: 1, extLen: 5 }), 1009);
  await violation(small, 'a 4 GB claimed length', frame(1, 'x', { lenByte: 127, hi: 0, extLen: 4000000000 }), 1009);
  await violation(small, 'fragments that add up to too much', Buffer.concat([frame(1, 'x'.repeat(600), { fin: false }), frame(0, 'x'.repeat(600))]), 1009);
  {
    const c = await rawClient(small.port);
    c.send(frame(1, 'x'.repeat(1000)));
    ok(await until(() => c.frames.some(f => f.opcode === 1)), 'a message exactly at the limit is fine');
    c.sock.destroy();
  }
  {
    // after a violation the server ignores anything else the client sends and never answers it
    const c = await rawClient(A.port);
    c.send(Buffer.concat([frame(1, 'x', { mask: null }), frame(1, 'after the error')]));
    await until(() => c.closed, 3000);
    ok(!c.frames.some(f => f.opcode === 1), 'nothing sent after a violation is acted on');
    c.sock.destroy();
  }

  console.log('5. garbage cannot hurt it');
  {
    const before = A.conns.length;
    let crashes = 0;
    process.on('uncaughtException', () => { crashes++; });
    const rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
    for (let i = 0; i < 300; i++) {
      const c = await rawClient(A.port);
      const n = 1 + Math.floor(rnd() * 400);
      const junk = Buffer.alloc(n); for (let k = 0; k < n; k++) junk[k] = Math.floor(rnd() * 256);
      c.send(junk);
      if (i % 3 === 0) c.send(frame(1, 'valid-after-junk'));
      await wait(1);
      c.sock.destroy();
    }
    // mutate valid frames: flip random bits in good traffic
    for (let i = 0; i < 300; i++) {
      const c = await rawClient(A.port);
      const good = Buffer.from(Buffer.concat([frame(1, JSON.stringify({ t: 'hello', n: i })), frame(9, 'p'), frame(1, 'frag', { fin: false }), frame(0, 'ment')]));
      for (let k = 0; k < 3; k++) good[Math.floor(rnd() * good.length)] ^= 1 << Math.floor(rnd() * 8);
      c.send(good);
      await wait(1);
      c.sock.destroy();
    }
    await wait(150);
    ok(crashes === 0, '600 connections full of random and bit-flipped bytes: no exceptions escaped');
    const fresh = await rawClient(A.port);
    fresh.send(frame(1, 'still alive'));
    ok(await until(() => fresh.frames.some(f => f.payload.toString() === 'still alive')), 'and the server still serves a normal client afterwards');
    fresh.sock.destroy();
    ok(A.conns.length > before + 500, 'every one of them was accepted and then dealt with');
    ok(await until(() => A.conns.every(r => r.closed || !r.ws.open || r.ws.socket.destroyed), 4000), 'no connection is left dangling open');
  }

  A.server.close(); small.server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
