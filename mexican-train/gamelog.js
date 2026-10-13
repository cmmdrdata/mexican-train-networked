'use strict';
/**
 * The game log: for debugging, a record of every game that is played through this server: the boneyard and every player's hand as dealt, then every domino drawn
 * and every play, in order. NOTHING OF A ROUND IS WRITTEN UNTIL THAT ROUND HAS ENDED (the log holds every hand and the order of the boneyard, so a log that could be read
 * during a round would show what the others hold): a round's events are written together when it is over. One file per game, in the games directory, as JSON Lines (one event, a line of JSON, per line, so that a game that stops half way still
 * leaves a log of everything up to there). Games in a browser against the computer send their events here (POST /gamelog, from this computer only); a game played
 * between people runs on this server, which writes its log itself. node tools/check_gamelog.js FILE replays a log and says whether it adds up.
 *
 * (The log holds every hand, the computer's and the other player's too: it is a record for the person who runs the server, and it stays on this computer's disk.)
 */
const fs = require('fs'), path = require('path'), os = require('os');

const MAX_FILE_BYTES = 20 * 1024 * 1024;     // a game's log stops growing at this size (a game is tens of kilobytes)
const MAX_EVENT_CHARS = 20000;               // one event, written out
const MAX_EVENTS_PER_POST = 1000;
const MAX_LOCAL_FILES = 200;                 // games being logged from pages at the same time (past this the oldest is forgotten)
const pad = (n, w) => String(n).padStart(w || 2, '0');

/* 20241012-143905: the time a game's log was started, which is what its file is named by (so the files sort in the order the games began) */
function stamp(d) {
  d = d || new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
const safe = s => String(s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'game';          // anything from outside only ever becomes part of a file name this way

/* Is this connection from this very computer (the loopback address, or one of its own addresses: someone who opened the page by this computer's network address)? */
function normalizeAddress(a) { a = String(a || ''); return a.startsWith('::ffff:') ? a.slice(7) : a; }
function thisComputerAddresses() {
  const out = new Set(['::1']);
  try { for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) out.add(i.address); } catch (e) { /* none known */ }
  return out;
}
function isThisComputer(addr) { addr = normalizeAddress(addr); return addr.startsWith('127.') || thisComputerAddresses().has(addr); }

class GameLogs {
  /* opts: dir (the games directory; made now if it is not there), now() -> Date, onError(err) (called once, and the log is then switched off: it must never stop a game),
   * maxBytes (the most one game's file may hold; tests make it small) */
  constructor(opts) {
    opts = opts || {};
    this.dir = path.resolve(opts.dir || path.join(__dirname, 'games'));
    this.now = opts.now || (() => new Date());
    this.onError = opts.onError || (() => {});
    this.maxBytes = opts.maxBytes || MAX_FILE_BYTES;
    this.failed = false;
    this.files = new Map();                       // games logged from pages: id -> { file, bytes, cut }
    this.written = 0;                             // events written, in all
    this.ensure();
  }
  /* The games directory exists (it is made, with anything above it, if it does not). */
  ensure() {
    try { fs.mkdirSync(this.dir, { recursive: true }); return true; }
    catch (e) { this._fail(e); return false; }
  }
  _fail(e) { if (!this.failed) { this.failed = true; try { this.onError(e); } catch (x) { /* ignore */ } } }
  _newFile(kind, id) { return path.join(this.dir, `${stamp(this.now())}-${kind}-${safe(id)}.jsonl`); }
  _append(entry, events) {
    if (this.failed) return false;
    let text = '', count = 0;
    for (const ev of events) {
      let s; try { s = JSON.stringify(ev); } catch (e) { continue; }
      if (!s || s.length > MAX_EVENT_CHARS) continue;
      text += s + '\n'; count++;
    }
    if (!text) return true;
    try {
      if (entry.bytes + text.length > this.maxBytes) {
        if (!entry.cut) { entry.cut = true; fs.appendFileSync(entry.file, JSON.stringify({ e: 'logTruncated', why: 'the log reached its size limit' }) + '\n'); }
        return false;
      }
      if (!fs.existsSync(this.dir)) this.ensure();           // (somebody removed the directory while the server was running: make it again)
      fs.appendFileSync(entry.file, text);
      entry.bytes += text.length; this.written += count;
      return true;
    } catch (e) { this._fail(e); return false; }
  }
  /* The log of a game played between people on this server: { file, write(events) } (one event, or a list: a round's events are written together, when the round has ended;
   * the file is not even made until then). `code` (the room's join code) goes in the file's name. */
  forHosted(code) {
    const entry = { file: this._newFile('hosted', code), bytes: 0, cut: false };
    return { file: entry.file, write: evs => this._append(entry, Array.isArray(evs) ? evs : [evs]) };
  }
  /* Events from a page playing against the computer. `id` is the page's own name for that game. True if they were kept. */
  acceptLocal(id, events) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{6,48}$/.test(id) || !Array.isArray(events) || events.length > MAX_EVENTS_PER_POST) return false;
    const clean = events.filter(e => e && typeof e === 'object' && !Array.isArray(e) && typeof e.e === 'string' && e.e.length <= 40);
    if (!clean.length) return false;
    let entry = this.files.get(id);
    if (!entry) {
      if (this.files.size >= MAX_LOCAL_FILES) this.files.delete(this.files.keys().next().value);
      entry = { file: this._newFile('local', id), bytes: 0, cut: false };
      this.files.set(id, entry);
    }
    return this._append(entry, clean);
  }
}

module.exports = { GameLogs, stamp, safe, isThisComputer, MAX_FILE_BYTES, MAX_EVENT_CHARS, MAX_EVENTS_PER_POST, MAX_LOCAL_FILES };
