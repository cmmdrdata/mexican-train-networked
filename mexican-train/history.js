'use strict';
/* The server's memory of the games played on it: who played, when, who won and the final scores, kept in a SQLite database (games and players tables).
 * It uses the SQLite that comes with Node (node:sqlite, Node 22.5 or newer), so there is nothing to install. With no file the database lives in memory
 * (kept while the server runs). If this Node has no SQLite, or the file cannot be opened or written, the list is kept in memory only and a message says so:
 * a game is never stopped by it. Open the file with any SQLite tool, for example:  sqlite3 games/history.db "select * from players"  */
const fs = require('fs');
const path = require('path');

let Sqlite = null;
{ // (Node prints "SQLite is an experimental feature" once when it is loaded: that is noise for the person running the server)
  const emit = process.emitWarning;
  process.emitWarning = function (w, ...rest) { if (/SQLite/i.test(String(w && w.message || w))) return; return emit.call(process, w, ...rest); };
  try { Sqlite = require('node:sqlite').DatabaseSync; } catch (e) { /* an older Node */ } finally { process.emitWarning = emit; }
}

class GameHistory {
  constructor(opts) {
    opts = opts || {};
    this.file = opts.file || null;
    this.max = Math.max(1, opts.max || 500);
    this.onError = opts.onError || (() => {});
    this.db = null;
    this.mem = [];                         // used when there is no SQLite
    this.nextId = 1;
    if (Sqlite) {
      try {
        if (this.file) fs.mkdirSync(path.dirname(this.file), { recursive: true });
        this.db = new Sqlite(this.file || ':memory:');
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER, ended_at INTEGER NOT NULL, result TEXT NOT NULL,
            rounds INTEGER, rounds_played INTEGER, hand INTEGER, theme TEXT);
          CREATE TABLE IF NOT EXISTS players (
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE, seat INTEGER NOT NULL, name TEXT NOT NULL,
            computer INTEGER NOT NULL, level TEXT, score INTEGER NOT NULL, rounds_won INTEGER NOT NULL, winner INTEGER NOT NULL,
            PRIMARY KEY (game_id, seat));
          CREATE INDEX IF NOT EXISTS games_ended ON games(ended_at);`);
        this.db.exec('PRAGMA foreign_keys = ON');
      } catch (e) { this.onError(e); this.db = null; }
    } else if (this.file) this.onError(new Error('this version of Node has no SQLite (it needs Node 22.5 or newer): the list of games is kept only while the server runs'));
  }
  get kind() { return this.db ? 'sqlite' : 'memory'; }
  /* Keep one game. `g`: { startedAt, endedAt (ms), result: 'finished' | 'stopped', rounds, roundsPlayed, hand, theme, players: [{ name, computer, level, score, roundsWon }] }.
   * A finished game's winner (or winners, in a tie) is the lowest score. */
  add(g) {
    const players = (Array.isArray(g.players) ? g.players : []).slice(0, 4).map(p => ({
      name: String(p && p.name || '').slice(0, 40), computer: !!(p && p.computer), level: p && p.computer ? String(p.level || '') : undefined,
      score: Math.max(0, Math.round(Number(p && p.score) || 0)), roundsWon: Math.max(0, Math.round(Number(p && p.roundsWon) || 0)),
    }));
    if (!players.length) return null;
    const finished = g.result === 'finished';
    const low = Math.min(...players.map(p => p.score));
    players.forEach(p => { p.winner = finished && p.score === low; });
    const rec = {
      startedAt: Number(g.startedAt) || 0, endedAt: Number(g.endedAt) || Date.now(), result: finished ? 'finished' : 'stopped',
      rounds: Number(g.rounds) || 0, roundsPlayed: Number(g.roundsPlayed) || 0, hand: Number(g.hand) || 0, theme: String(g.theme || 'classic').slice(0, 20), players,
    };
    if (this.db) {
      try {
        this.db.exec('BEGIN');
        const r = this.db.prepare('INSERT INTO games (started_at, ended_at, result, rounds, rounds_played, hand, theme) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(rec.startedAt, rec.endedAt, rec.result, rec.rounds, rec.roundsPlayed, rec.hand, rec.theme);
        rec.id = Number(r.lastInsertRowid);
        const ins = this.db.prepare('INSERT INTO players (game_id, seat, name, computer, level, score, rounds_won, winner) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        players.forEach((p, i) => ins.run(rec.id, i, p.name, p.computer ? 1 : 0, p.level || null, p.score, p.roundsWon, p.winner ? 1 : 0));
        this.db.prepare('DELETE FROM games WHERE id <= (SELECT MAX(id) FROM games) - ?').run(this.max);        // only the newest games are kept
        this.db.exec('COMMIT');
      } catch (e) { try { this.db.exec('ROLLBACK'); } catch (e2) { /* nothing open */ } this.onError(e); this.db = null; this.mem.push(Object.assign(rec, { id: this.nextId++ })); }
    } else {
      rec.id = this.nextId++;
      this.mem.push(rec);
      if (this.mem.length > this.max) this.mem.splice(0, this.mem.length - this.max);
    }
    rec.winners = players.filter(p => p.winner).map(p => p.name);
    return rec;
  }
  /* The newest `n` games, newest first, each with its players in seat order and the winners' names. */
  list(n) {
    const k = Math.max(1, Math.min(this.max, Math.floor(Number(n)) || 20));
    let rows;
    if (this.db) {
      try {
        const games = this.db.prepare('SELECT * FROM games ORDER BY id DESC LIMIT ?').all(k);
        const pl = this.db.prepare('SELECT * FROM players WHERE game_id = ? ORDER BY seat');
        rows = games.map(g => ({
          id: Number(g.id), startedAt: Number(g.started_at) || 0, endedAt: Number(g.ended_at), result: g.result, rounds: Number(g.rounds), roundsPlayed: Number(g.rounds_played), hand: Number(g.hand), theme: g.theme,
          players: pl.all(g.id).map(p => ({ name: p.name, computer: !!p.computer, level: p.level || undefined, score: Number(p.score), roundsWon: Number(p.rounds_won), winner: !!p.winner })),
        }));
      } catch (e) { this.onError(e); rows = []; }
    } else rows = this.mem.slice(-k).reverse().map(g => Object.assign({}, g));
    rows.forEach(g => { g.winners = g.players.filter(p => p.winner).map(p => p.name); });
    return rows;
  }
  close() { try { if (this.db) this.db.close(); } catch (e) { /* already closed */ } this.db = null; }
}
module.exports = { GameHistory, hasSqlite: !!Sqlite };
