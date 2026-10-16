'use strict';
// The "Recent games" screen on the main menu.
require('./game.js');
const G = globalThis.MexicanTrainGame;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const tick = () => new Promise(r => setImmediate(r));
function make(fetchImpl, extra) {
  const root = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
  const store = {};
  const app = G.createApp(Object.assign({ root, rng: G.Engine.mulberry32(1), sleep: async () => {}, reducedMotion: true, fetch: fetchImpl, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } } }, extra));
  return { app, root, S: app.state };
}
const game = (o) => Object.assign({ id: 3, result: 'finished', startedAt: Date.UTC(2026, 9, 16, 17, 0), endedAt: Date.UTC(2026, 9, 16, 17, 25), rounds: 4, roundsPlayed: 4, hand: 15, theme: 'classic',
  players: [{ name: 'Ann', computer: false, score: 61, roundsWon: 1, winner: false }, { name: 'Ben', computer: false, score: 33, roundsWon: 2, winner: true }, { name: 'Nadia', computer: true, level: 'hard', score: 90, roundsWon: 1, winner: false }], winners: ['Ben'] }, o);
(async () => {
  const urls = [];
  const a = make(async url => { urls.push(url); return { ok: true, json: async () => ({ games: [game(), game({ id: 2, result: 'stopped', roundsPlayed: 2, winners: [], players: [{ name: '<b>X</b>', score: 5, roundsWon: 0 }, { name: 'Y', score: 7, roundsWon: 1 }] }), game({ id: 1, winners: ['Ann', 'Ben'] })] }) }; });
  a.app.dispatch({ type: 'newGame' });
  ok(/data-action="openHistory"[^>]*>Recent games</.test(a.root.innerHTML), 'the main screen has a Recent games button');
  a.app.dispatch({ type: 'openHistory' });
  ok(a.S.overlay === 'history' && /Loading/.test(a.root.innerHTML), 'it opens the screen at once, saying it is loading');
  await tick(); await tick();
  const h = a.root.innerHTML;
  ok(urls.length === 1 && urls[0] === '/history?n=25', 'it asks the server for the last 25 by default: ' + urls[0]);
  ok((h.match(/<article class="hist-game/g) || []).length === 3, 'a card for each game');
  ok(/Ben won/.test(h) && /Winner/.test(h) && />61</.test(h) && />33</.test(h) && />90</.test(h), 'the winner and every final score are shown');
  ok(/computer, hard/.test(h) && /1 round won/.test(h) && /2 rounds won/.test(h), 'computers are marked with their level, and rounds won are shown');
  ok(/4 of 4 rounds/.test(h) && /25 min/.test(h) && /<time datetime="2026-10-16T17:25:00.000Z">/.test(h), 'the round count, how long it took and when it ended (a machine-readable time as well)');
  ok(/Stopped early/.test(h) && /2 of 4 rounds/.test(h) && /Scores when it stopped/.test(h) && /hist-game stopped/.test(h), 'a game that stopped early says so and has no winner');
  ok(/Tied: Ann and Ben/.test(h), 'a tie names both');
  ok(!/<b>X<\/b>/.test(h) && !/<b>X/.test(h.replace(/<b class="crown">/g, '')), 'names are cleaned: no markup gets through');
  a.app.dispatch({ type: 'historyCount', key: '50' }); await tick(); await tick();
  ok(urls[1] === '/history?n=50' && a.S.history.n === 50 && /aria-pressed="true"[^>]*>|data-key="50"/.test(a.root.innerHTML), 'choosing 50 asks for 50');
  a.app.dispatch({ type: 'historyCount', key: '7' }); await tick();
  ok(a.S.history.n === 50, 'a number that is not on offer is ignored (it keeps 50)');
  a.app.dispatch({ type: 'openHistory', key: 'refresh' }); await tick(); await tick();
  ok(urls[urls.length - 1] === '/history?n=50', 'Refresh asks again for the same number');
  a.app.dispatch({ type: 'closeOverlay' });
  ok(a.S.overlay === 'setup' && /Start game/.test(a.root.innerHTML), 'Back returns to the main screen');

  const none = make(async () => ({ ok: true, json: async () => ({ games: [] }) })); none.app.dispatch({ type: 'openHistory' }); await tick(); await tick();
  ok(/No games have been played on this server yet/.test(none.root.innerHTML), 'an empty list says so');
  const bad = make(async () => ({ ok: false })); bad.app.dispatch({ type: 'openHistory' }); await tick(); await tick();
  ok(/not connected to one/.test(bad.root.innerHTML) && /Back/.test(bad.root.innerHTML), 'with no server (an error) it says where the list comes from, and Back still works');
  const nofetch = make(null); nofetch.app.dispatch({ type: 'openHistory' }); await tick();
  ok(/not connected to one/.test(nofetch.root.innerHTML), 'with no way to ask, the same message');
  const junk = make(async () => ({ ok: true, json: async () => ({ games: [null, { players: [] }, { result: 'finished', players: [{ name: 'Z', score: 'x' }] }] }) })); junk.app.dispatch({ type: 'openHistory' }); await tick(); await tick();
  ok((junk.root.innerHTML.match(/<article class="hist-game/g) || []).length === 1, 'rubbish from a server is skipped, not drawn');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
