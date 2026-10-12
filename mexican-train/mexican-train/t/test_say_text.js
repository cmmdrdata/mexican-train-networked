'use strict';
// "Say something" with typed text, on the page: cleaning what is typed, sending, receiving, showing it safely, and the separate
// text box (the "dock") that the page keeps outside the part it redraws.
require('./game.js');
const G = globalThis.MexicanTrainGame, E = G.Engine;
const { mulberry32 } = E;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('1. cleaning what is typed');
  {
    const c = G.cleanChatText;
    ok(c('Hello there') === 'Hello there' && c('  padded  ') === 'padded' && c('a   b \t c') === 'a b c', 'plain text stays, spaces are trimmed and collapsed');
    ok(c('one\ntwo\r\nthree') === 'one two three' && c('x\u0000y\u001fz\u007f') === 'x y z', 'new lines and control characters become spaces');
    ok(c('a\u200bb\u2060c\ufeffd') === 'abcd', 'zero-width characters are removed');
    ok(c('safe \u202eevil\u202c \u2066x\u2069 \u200f\u200e\u061c') === 'safe evil x', 'characters that flip the direction of text are removed');
    ok(c('e\u0301') === '\u00e9', 'accents are put in their usual form');
    ok(c('\u{1F468}\u200d\u{1F469}\u200d\u{1F467} family') === '\u{1F468}\u200d\u{1F469}\u200d\u{1F467} family', 'emoji that are joined together (a family) are left alone');
    ok(c('\u05e9\u05dc\u05d5\u05dd \u0645\u0631\u062d\u0628\u0627 \u4f60\u597d') === '\u05e9\u05dc\u05d5\u05dd \u0645\u0631\u062d\u0628\u0627 \u4f60\u597d', 'other languages are left alone');
    ok(c('') === '' && c('   ') === '' && c('\n\t') === '' && c('\u200b') === '', 'nothing, or only spaces and invisible characters, is nothing');
    ok(c(undefined) === '' && c(null) === '' && c(42) === '' && c({}) === '' && c(['a']) === '' && c(true) === '', 'anything that is not text is nothing');
    ok(Array.from(c('x'.repeat(300))).length === G.CHAT_MAX && G.CHAT_MAX === 80, 'at most 80 characters');
    ok(Array.from(c('\u{1F600}'.repeat(200))).length === 80 && Array.from(c('\u{1F600}'.repeat(200))).every(ch => ch === '\u{1F600}'), 'counted as characters people see, not as halves: 80 emoji, none cut in half');
    ok(c('<b>bold</b> & "q"') === '<b>bold</b> & "q"', 'markup is left as text (it is escaped when drawn, below)');
    ok(c(c('  a \n b  ')) === c('  a \n b  '), 'cleaning twice changes nothing more (what the page sends and what the server sends on agree)');
  }

  class FakeWS { constructor() { this.readyState = 0; this.sent = []; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); } send(d) { this.sent.push(JSON.parse(d)); } close() {} say(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); } }
  const T = (a, b) => [a, b], tr = id => ({ id, marker: false, tiles: [], end: 12 });
  let seq = 0;
  const view = () => ({ seq: ++seq, round: 0, rounds: 4, me: { name: 'Ann', seat: 0 }, opp: { name: 'Ben' }, opps: [{ id: 'cpu', name: 'Ben', seat: 1, computer: false }], totals: { human: 0, cpu: 0 }, paused: false, over: null, log: ['x'], banner: '', modal: null, awaiting: null,
    game: { engine: 12, players: [{ id: 'human', name: 'You', hand: [T(1, 2)] }, { id: 'cpu', name: 'Ben', hand: [T(-1, -1)] }], boneyard: [T(-1, -1)], trains: { human: tr('human'), cpu: tr('cpu'), mexican: tr('mexican') }, openDouble: null, opening: null } });
  const make = async dock => {
    const clock = { t: 1e9 }, timers = [];
    const timer = { set: (fn, ms) => { timers.push({ fn, at: clock.t + ms }); return timers.length; }, clear() {} };
    const advance = ms => { const end = clock.t + ms; for (;;) { timers.sort((a, b) => a.at - b.at); if (!timers.length || timers[0].at > end) break; const x = timers.shift(); clock.t = x.at; x.fn(); } clock.t = end; };
    const root = { html: '', set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; }, querySelectorAll() { return []; }, querySelector() { return { focus() {} }; }, ownerDocument: {}, addEventListener() {} };
    const store = {};
    const app = G.createApp({ root, sleep: async () => {}, reducedMotion: true, timer, now: () => clock.t, dock, storage: { get: k => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } }, WebSocket: FakeWS, fetch: async () => ({ ok: true, json: async () => ({ addresses: ['fake:1'], preferred: 'fake:1' }) }) });
    const S = app.state, d = a => app.dispatch(a);
    d({ type: 'boot' }); d({ type: 'openHost' }); await wait(5);
    d({ type: 'hostGame', server: 'x', name: 'Ann', rounds: 4, hand: 15 }); await wait(10);
    const ws = FakeWS.last;
    ws.say({ t: 'created', code: 'ABCDEF', display: 'ABC-DEF', token: 't', seat: 0, settings: { rounds: 4, hand: 15 }, addresses: [] });
    return { S, d, ws, root, advance, started: () => ws.say({ t: 'state', seq: seq + 1, view: view(), events: [] }) };
  };

  console.log('2. sending (with the panel inside the page: the fallback when there is no separate text box)');
  {
    const { S, d, ws, root, started } = await make(null);
    ws.say({ t: 'chat', text: 'nothing yet' });
    d({ type: 'sendText', text: 'hello before the game' });
    ok(!ws.sent.some(m => m.t === 'chat') , 'nothing can be sent before the game has started');
    started();
    d({ type: 'toggleSay' });
    ok(/<input id="say-text" type="text" maxlength="80"/.test(root.html) && /data-action="sendText"/.test(root.html) && /data-action="sendChat"/.test(root.html), 'the Say something panel has a box to type in, a Send button, and the quick phrases');
    d({ type: 'sendText', text: '  Nice   move,\nBen!  ' });
    const sent = ws.sent.filter(m => m.t === 'chat');
    ok(sent.length === 1 && sent[0].text === 'Nice move, Ben!' && !('id' in sent[0]), 'what is sent is the cleaned text: ' + JSON.stringify(sent[0]));
    ok(/You said: Nice move, Ben!/.test(root.html) && !/class="say-panel"/.test(root.html) && S.sayOpen === false, 'the sender sees "You said: ..." and the panel closes');
    for (const nothing of ['', '   ', '\n', '\u200b', undefined, null, 5, {}]) d({ type: 'sendText', text: nothing });
    ok(ws.sent.filter(m => m.t === 'chat').length === 1, 'blank or not-text messages are never sent');
    d({ type: 'sendText', text: 'y'.repeat(400) });
    ok(ws.sent.filter(m => m.t === 'chat')[1].text.length === 80, 'a long one is cut to 80 before it is sent');
    d({ type: 'sendText', text: '<img src=x onerror=alert(1)>' });
    ok(/You said: &lt;img src=x onerror=alert\(1\)&gt;/.test(root.html) && !/<img src=x/.test(root.html), 'what the sender sees is escaped: markup shows as text');
    ws.say({ t: 'error', code: 'slow_down', message: 'Not so fast: that message was not sent.' });
    ok(!/You said/.test(root.html) && /<div class="you-said not-sent">Not so fast: that message was not sent\.<\/div>/.test(root.html), 'if the server says it was too fast, "You said" is replaced by the reason, in the same place (the page has its own text on screen in some phases, so a banner would not be seen)');
  }

  console.log('3. receiving');
  {
    const { S, d, ws, root, advance, started } = await make(null);
    started();
    ws.say({ t: 'chat', text: 'Hi Ann!' });
    ok(/<div class="bubble"><b>Ben<\/b><span>Hi Ann!<\/span><\/div>/.test(root.html), 'a message appears as a speech bubble in the other player\'s name');
    advance(6100);
    ok(/Hi Ann/.test(root.html), '(a short one is still up after 6 seconds: it stays a little longer for each character)');
    advance(600);
    ok(!/Hi Ann/.test(root.html), 'and goes away after a few seconds');
    ws.say({ t: 'chat', text: 'z'.repeat(80) });
    advance(6100); ok(/z{80}/.test(root.html), 'a long one stays up longer');
    advance(10000); ok(!/z{80}/.test(root.html), '(but not for ever)');
    ws.say({ t: 'chat', text: '<img src=x onerror=alert(1)><script>alert(2)</script>' });
    ok(/&lt;img src=x onerror=alert\(1\)&gt;&lt;script&gt;/.test(root.html) && !/<img src=x|<script>/.test(root.html), 'markup in a message is shown as plain text');
    advance(20000);
    ws.say({ t: 'chat', text: 'a\u202eb\u200bc\nd' });
    ok(/<span>abc d<\/span>/.test(root.html), 'a message is cleaned on arrival as well (whatever a changed server sent)');
    advance(20000);
    ws.say({ t: 'chat', text: 'q'.repeat(5000) });
    ok((root.html.match(/<span>(q+)<\/span>/) || [, ''])[1].length === 80, 'an enormous message is cut to 80');
    advance(20000);
    for (const bad of [{ text: '' }, { text: '   ' }, { text: 42 }, { text: null }, { text: { a: 1 } }, { text: ['x'] }, {}]) ws.say(Object.assign({ t: 'chat' }, bad));
    ok(!S.comment, 'messages with no text, or text that is not text, are ignored');
    ws.say({ t: 'chat', id: 2, text: 'Good game!' });
    ok(/<span>Good game!<\/span>/.test(root.html), '(quick phrases still arrive and show as before)');
  }

  console.log('4. the separate text box (the "dock")');
  {
    const calls = [];
    const dock = { sync: open => calls.push(open ? 'open' : 'closed'), clear: () => calls.push('clear') };
    const { S, d, ws, root, started } = await make(dock);
    started();
    ok(S.dockMode === true && calls[calls.length - 1] === 'closed', 'with a separate box, it starts hidden');
    ok(!/id="say-text"/.test(root.html) && /data-action="toggleSay"/.test(root.html), 'the page itself has only the Say something button: no text box in the part that is redrawn');
    d({ type: 'toggleSay' });
    ok(calls[calls.length - 1] === 'open' && !/class="say-panel"/.test(root.html), 'pressing it shows the box (and the page draws no panel of its own)');
    ws.say({ t: 'state', seq: seq + 1, view: view(), events: [] }); ws.say({ t: 'state', seq: seq + 1, view: view(), events: [] });
    ok(calls[calls.length - 1] === 'open', 'moves by the other player redraw the page, and the box stays open');
    d({ type: 'openRules' });
    ok(calls[calls.length - 1] === 'closed', 'a dialog on top (Rules) hides it');
    d({ type: 'closeOverlay' });
    ok(calls[calls.length - 1] === 'open', '...and it comes back when the dialog is closed');
    d({ type: 'sendText', text: 'hello' });
    ok(ws.sent.filter(m => m.t === 'chat')[0].text === 'hello' && calls.includes('clear') && calls[calls.length - 1] === 'closed' && S.sayOpen === false, 'sending clears the box and hides it');
    d({ type: 'toggleSay' }); d({ type: 'sendChat', key: 1 });
    ok(ws.sent.filter(m => m.t === 'chat').pop().id === 1 && calls[calls.length - 1] === 'closed', 'a quick phrase from the box is sent, and hides it');
    d({ type: 'toggleSay' }); d({ type: 'toggleSay' });
    ok(calls[calls.length - 1] === 'closed', 'Close (or Escape) hides it without sending anything');
    d({ type: 'toggleSay' });
    ok(calls[calls.length - 1] === 'open', '(open again)');
    d({ type: 'askLeave' });
    ok(calls[calls.length - 1] === 'closed', 'the Leave game question hides it');
    d({ type: 'confirmLeave' });
    ok(calls[calls.length - 1] === 'closed' && S.sayOpen === false, 'and leaving the game closes it for good');
  }
  {
    const calls = [];
    const c = await make({ sync: o => calls.push(o), clear() {} });
    c.d({ type: 'toggleSay' });
    ok(!calls.includes(true), 'before the game there is nothing to say it to: the box never opens');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
