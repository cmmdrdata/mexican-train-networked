'use strict';
/**
 * A small WebSocket (RFC 6455) server side with no dependencies: the opening handshake and the
 * frame protocol for text messages, enough for the game's JSON messages.
 *
 *   const { upgrade } = require('./ws-lite');
 *   httpServer.on('upgrade', (req, socket) => {
 *     const ws = upgrade(req, socket, { maxPayload: 8192 });
 *     if (!ws) return;                         // refused: the HTTP error has already been sent
 *     ws.on('message', text => ws.send(text)); // text frames only
 *     ws.on('close', () => {});
 *   });
 *
 * Strict by design, since it faces a network: client frames must be masked, reserved bits must be
 * clear, control frames must be small and whole, text must be valid UTF-8, binary frames are refused,
 * and nothing larger than `maxPayload` (one frame or one reassembled message) is ever buffered.
 * Anything wrong gets the proper close code (1002 protocol error, 1003 unsupported data, 1007 bad
 * text, 1009 too big) and the connection is dropped.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const acceptKey = key => crypto.createHash('sha1').update(String(key) + GUID).digest('base64');

const OP = { CONT: 0, TEXT: 1, BINARY: 2, CLOSE: 8, PING: 9, PONG: 10 };
// close codes a peer may legitimately send (RFC 6455 section 7.4)
const validCloseCode = c => (c >= 1000 && c <= 1003) || (c >= 1007 && c <= 1011) || (c >= 3000 && c <= 4999);

class WsConnection extends EventEmitter {
  constructor(socket, opts) {
    super();
    this.socket = socket;
    this.maxPayload = (opts && opts.maxPayload) || 16 * 1024;
    this.buffer = Buffer.alloc(0);
    this.parts = [];                 // pieces of a fragmented message
    this.partsOpcode = 0;
    this.partsBytes = 0;
    this.closeSent = false;
    this.finished = false;
    this.alive = true;               // cleared by the owner's heartbeat, set again by every pong
    this.decoder = new TextDecoder('utf-8', { fatal: true });
    socket.setNoDelay(true);
    socket.on('data', d => this._onData(d));
    socket.on('close', () => this._finish());
    socket.on('error', () => { /* a 'close' follows */ });
    socket.on('end', () => { try { socket.end(); } catch (e) { /* ignore */ } });
  }

  get open() { return !this.closeSent && !this.finished && !this.socket.destroyed; }

  /* ----------------------------- sending ----------------------------- */
  _frame(opcode, payload) {
    const n = payload.length;
    let head;
    if (n < 126) { head = Buffer.alloc(2); head[1] = n; }
    else if (n < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(n, 6); }
    head[0] = 0x80 | opcode;                                   // FIN + opcode; server frames are never masked
    return Buffer.concat([head, payload]);
  }
  send(text) {
    if (!this.open) return false;
    if (this.socket.writableLength > 4 * 1024 * 1024) { this.terminate(); return false; }   // a peer that never reads
    try { this.socket.write(this._frame(OP.TEXT, Buffer.from(String(text), 'utf8'))); return true; }
    catch (e) { return false; }
  }
  ping(data) {
    if (!this.open) return false;
    try { this.socket.write(this._frame(OP.PING, Buffer.from(data || '', 'utf8').subarray(0, 125))); return true; }
    catch (e) { return false; }
  }
  close(code, reason) {
    if (this.closeSent || this.finished) return;
    this.closeSent = true;
    const r = Buffer.from(String(reason || '').slice(0, 100), 'utf8');
    const body = Buffer.alloc(2 + r.length);
    body.writeUInt16BE(code || 1000, 0);
    r.copy(body, 2);
    try { this.socket.write(this._frame(OP.CLOSE, body)); this.socket.end(); } catch (e) { /* ignore */ }
    const t = setTimeout(() => { try { this.socket.destroy(); } catch (e) { /* ignore */ } }, 2000);   // do not wait forever for the peer
    if (t.unref) t.unref();
  }
  terminate() { try { this.socket.destroy(); } catch (e) { /* ignore */ } }

  /* ----------------------------- receiving ----------------------------- */
  _fail(code, message) {
    this.emit('protocol-error', message);
    this.parts = []; this.buffer = Buffer.alloc(0);
    this.close(code, message);
    this.buffer = null;               // ignore anything else the peer sends
  }
  _onData(chunk) {
    if (this.buffer === null || this.finished) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const b = this.buffer;
      if (b === null || b.length < 2) return;
      const fin = !!(b[0] & 0x80), rsv = b[0] & 0x70, opcode = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (rsv) return this._fail(1002, 'reserved bits set');
      if (!masked) return this._fail(1002, 'client frames must be masked');
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) return this._fail(1009, 'message too big');
        len = b.readUInt32BE(6); off = 10;
      }
      if (len > this.maxPayload) return this._fail(1009, 'message too big');
      if (opcode >= 8 && (!fin || len > 125)) return this._fail(1002, 'bad control frame');
      if (b.length < off + 4 + len) return;                    // wait for the rest of the frame
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));   // a copy we may unmask in place
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = b.subarray(off + 4 + len);
      this._onFrame(fin, opcode, payload);
      if (this.buffer === null) return;
    }
  }
  _onFrame(fin, opcode, payload) {
    switch (opcode) {
      case OP.CONT:
        if (!this.partsOpcode) return this._fail(1002, 'unexpected continuation');
        this.partsBytes += payload.length;
        if (this.partsBytes > this.maxPayload) return this._fail(1009, 'message too big');
        this.parts.push(payload);
        if (fin) { const whole = Buffer.concat(this.parts); this.parts = []; this.partsOpcode = 0; this.partsBytes = 0; this._deliver(whole); }
        return;
      case OP.TEXT:
      case OP.BINARY:
        if (this.partsOpcode) return this._fail(1002, 'new message inside a fragmented one');
        if (opcode === OP.BINARY) return this._fail(1003, 'binary messages are not accepted');
        if (fin) return this._deliver(payload);
        this.partsOpcode = opcode; this.parts = [payload]; this.partsBytes = payload.length;
        return;
      case OP.CLOSE: {
        let code = 1005;
        if (payload.length === 1) return this._fail(1002, 'bad close frame');
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0);
          if (!validCloseCode(code)) return this._fail(1002, 'bad close code');
          try { this.decoder.decode(payload.subarray(2)); } catch (e) { return this._fail(1007, 'bad close reason'); }
        }
        this.emit('closing', code);
        this.close(code === 1005 ? 1000 : code);              // echo it back and hang up
        return;
      }
      case OP.PING:
        try { this.socket.write(this._frame(OP.PONG, payload)); } catch (e) { /* ignore */ }
        return;
      case OP.PONG:
        this.alive = true; this.emit('pong');
        return;
      default:
        return this._fail(1002, 'unknown opcode');
    }
  }
  _deliver(bytes) {
    let text;
    try { text = this.decoder.decode(bytes); } catch (e) { return this._fail(1007, 'text is not valid UTF-8'); }
    this.emit('message', text);
  }
  _finish() {
    if (this.finished) return;
    this.finished = true;
    this.emit('close');
  }
}

/* The opening handshake. Returns a WsConnection, or null after sending an HTTP error. */
function upgrade(req, socket, opts) {
  const refuse = (status, text, extra) => {
    try {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n${extra || ''}\r\n`);
      socket.destroy();
    } catch (e) { /* ignore */ }
    return null;
  };
  const h = req.headers || {};
  if (req.method !== 'GET') return refuse(405, 'Method Not Allowed', 'Allow: GET\r\n');
  if (String(h.upgrade || '').toLowerCase() !== 'websocket' || !/(^|,)\s*upgrade\s*(,|$)/i.test(String(h.connection || ''))) return refuse(400, 'Bad Request');
  if (!/^[A-Za-z0-9+/]{22}==$/.test(String(h['sec-websocket-key'] || ''))) return refuse(400, 'Bad Request');
  if (String(h['sec-websocket-version'] || '') !== '13') return refuse(426, 'Upgrade Required', 'Sec-WebSocket-Version: 13\r\n');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey(h['sec-websocket-key'])}\r\n\r\n`);
  return new WsConnection(socket, opts);
}

module.exports = { upgrade, acceptKey, WsConnection };
