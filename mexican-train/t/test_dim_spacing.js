'use strict';
// The hand is dimmed exactly when it is not your turn, and every train keeps room for two more dominoes.
// (test_browser.py measures both in a real browser; this runs anywhere Node does.)
require('./game.js');
const fs = require('fs');
const G = globalThis.MexicanTrainGame;
const { mulberry32, key } = G.Engine;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const handClasses = html => (html.match(/<button class="tile-btn ([^"]*)"/g) || []).map(x => x.replace('<button class="tile-btn ', '').replace('"', '').split(' '));

(async () => {
  console.log('1. in a game against the computer');
  {
    let html = '', S = null; const renders = [];
    const root = { set innerHTML(v) { html = v; if (S && S.game && !S.overlay) renders.push({ tiles: handClasses(v), aw: S.awaiting ? S.awaiting.kind : null }); }, get innerHTML() { return html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const app = G.createApp({ root, rng: mulberry32(7), paceRng: () => 0, sleep: async () => {}, reducedMotion: true, chatRng: () => 1, storage: { get: () => null, set() {} } });
    S = app.state;
    app.dispatch({ type: 'boot' });
    app.dispatch({ type: 'startGame', rounds: 1, hand: 12, style: 'pips', level: 'normal' });
    let guard = 0;
    while (!(S.modal && S.modal.type === 'roundEnd') && guard++ < 4000) {
      const a = S.awaiting;
      if (a && a.kind === 'move') { const m = a.moves[0]; app.dispatch({ type: 'selectTile', key: key(m.tile) }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); }
      else if (a && a.kind === 'draw') app.dispatch({ type: 'draw' });
      else if (a && a.kind === 'build') app.dispatch({ type: a.canDraw ? 'draw' : a.canBuild ? 'autoBuild' : a.canDone ? 'endBuild' : 'undoTile' });
      await wait(0);
    }
    let waiting = 0, turn = 0; const bad = [];
    for (const r of renders) {
      if (!r.tiles.length) continue;
      if (!r.aw) { waiting++; if (!r.tiles.every(c => c.includes('idle'))) bad.push('not dimmed while waiting'); }
      else if (r.aw !== 'modal') { turn++; if (r.tiles.some(c => c.includes('idle'))) bad.push('dimmed on your turn (' + r.aw + ')'); }
    }
    ok(waiting > 20 && turn > 20, `both states occurred in a whole game (${waiting} renders while waiting, ${turn} on your turn)`);
    ok(bad.length === 0, 'on every screen: all tiles dimmed while waiting (the computer\'s turn, "waiting for the computer to finish building", the pauses), none dimmed on your turn' + (bad[0] ? ' (' + bad[0] + ')' : ''));
  }

  console.log('2. in an online game');
  {
    class FakeWS { constructor() { this.readyState = 0; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); } send() {} close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
    let html = '';
    const root = { set innerHTML(v) { html = v; }, get innerHTML() { return html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const app = G.createApp({ root, sleep: async () => {}, reducedMotion: true, storage: { get: () => null, set() {} }, WebSocket: FakeWS, fetch: async () => ({ ok: true, json: async () => ({ addresses: ['fake:1'], preferred: 'fake:1' }) }) });
    app.dispatch({ type: 'boot' }); app.dispatch({ type: 'openHost' }); await wait(5);
    app.dispatch({ type: 'hostGame', server: 'x', name: 'Me', rounds: 4, hand: 15 }); await wait(10);
    FakeWS.last.say({ t: 'created', code: 'ABCDEF', display: 'ABC-DEF', token: 't', seat: 0, settings: { rounds: 4, hand: 15 }, addresses: [] });
    const T = (a, b) => [a, b];
    const tr = id => ({ id, marker: false, tiles: [], end: 12 });
    const view = aw => ({ seq: ++view.n, round: 0, rounds: 4, me: { name: 'Me' }, opp: { name: 'Zed' }, totals: { human: 0, cpu: 0 }, paused: false, over: null, log: [], banner: '', modal: null, awaiting: aw,
      game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [T(12, 1), T(3, 4), T(5, 6)] }, { id: 'cpu', name: 'Zed', hand: [T(-1, -1)] }], boneyard: [T(-1, -1)], trains: { human: tr('human'), cpu: tr('cpu'), mexican: tr('mexican') }, openDouble: null, opening: { human: { finished: true }, cpu: { finished: true } } } });
    view.n = 0;
    const move = { kind: 'move', moves: [{ tile: T(12, 1), trainId: 'human', placed: T(12, 1), newEnd: 1 }] };
    FakeWS.last.say({ t: 'state', seq: 1, view: view(null), events: [] });
    ok(handClasses(html).length === 3 && handClasses(html).every(c => c.includes('idle')), 'the opponent\'s turn: all three tiles are dimmed');
    FakeWS.last.say({ t: 'state', seq: 2, view: view(move), events: [] });
    ok(handClasses(html).every(c => !c.includes('idle')) && handClasses(html).some(c => c.includes('playable')), 'your turn: none dimmed as "idle", the playable one stands out');
    FakeWS.last.say({ t: 'state', seq: 3, view: view({ kind: 'draw' }), events: [] });
    ok(handClasses(html).every(c => !c.includes('idle')), '"nothing fits, draw" is your turn too: not idle');
    FakeWS.last.say({ t: 'state', seq: 4, view: view(null), events: [] });
    ok(handClasses(html).every(c => c.includes('idle')), 'and back to dimmed when the move is over');
  }

  console.log('3. room at the end of every train');
  {
    const css = fs.readFileSync('../style.css', 'utf8');
    const rule = sel => { const m = css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : ''; };
    const tt = rule('.track-tiles');
    const pad = tt.match(/padding:\s*8px calc\(var\(--s\) \* ([\d.]+) \+ (\d+)px\) 8px 10px/);
    ok(!!pad, 'the train row has extra padding on its right end, in units of the tile size');
    const lying = 1.9615;
    ok(pad && Number(pad[1]) >= 2 * lying - 0.001 && Number(pad[2]) >= 8 + 10, `it is at least two dominoes (2 x ${lying} x the tile size) plus their gaps and the usual margin: ${pad && pad[1]} x tile + ${pad && pad[2]}px`);
    ok(/width:\s*max-content/.test(tt) && /min-width:\s*100%/.test(tt) && /box-sizing:\s*border-box/.test(css), '(the row still grows with its tiles and fills the screen when short, with the padding inside its width)');
    const tile = rule('.tile.h');
    ok(new RegExp('width:\\s*calc\\(var\\(--s\\) \\* ' + lying + '\\)').test(tile), 'and a domino lying on a train really is 1.9615 x the tile size wide, the figure the padding is based on');
    ok(/\.tile-btn\.idle\s*\{\s*opacity:\s*0\.4/.test(css), 'the hand\'s "idle" style dims the tiles');
    ok(/\.field input\[type="text"\]\.fixed/.test(css), 'and the host\'s fixed address field has a locked look');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
