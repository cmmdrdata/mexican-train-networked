'use strict';
// The chat of an online game, on the page: cleaning what is typed, sending, receiving, showing it safely, keeping the messages in the chat
// beside the game history, and what happens to them when a game ends. (The box people type in survives redraws: see test_browser_chat.py.)
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

  const chatItems = html => { const m = html.match(/<ol class="chat-list"[^>]*>([\s\S]*?)<\/ol>/); return m ? m[1] : null; };

  console.log('2. sending');
  {
    const { S, d, ws, root, started } = await make(null);
    ok(!/class="chat"/.test(root.html), 'no chat before a game has started');
    d({ type: 'sendText', text: 'hello before the game' });
    ok(!ws.sent.some(m => m.t === 'chat') && S.chatLog.length === 0, 'nothing can be sent before the game has started');
    started();
    ok(/<section class="chat" aria-label="Chat">/.test(root.html) && /<input id="say-text" type="text" maxlength="80"/.test(root.html) && /data-action="sendText"/.test(root.html) && /data-say-form/.test(root.html), 'the chat has a list, a box to type in and a Send button');
    ok(!/Say something|toggleSay|say-panel|data-action="sendChat"/.test(root.html), 'the Say something button, its panel and its quick phrases are gone');
    ok(/class="log-wrap"/.test(root.html) && root.html.indexOf('class="log"') < root.html.indexOf('class="chat"'), 'the chat sits beside the game history, in the same block');
    ok(/<li class="empty">No messages yet\.<\/li>/.test(root.html), 'an empty chat says so');
    d({ type: 'sendText', text: '  Nice   move,\nBen!  ' });
    const sent = ws.sent.filter(m => m.t === 'chat');
    ok(sent.length === 1 && sent[0].text === 'Nice move, Ben!' && !('id' in sent[0]), 'what is sent is the cleaned text: ' + JSON.stringify(sent[0]));
    ok(/<li class="mine"><b>You<\/b> <span>Nice move, Ben!<\/span><\/li>/.test(root.html) && !/No messages yet/.test(root.html), 'the sender sees it in the chat, as "You"');
    ok(S.chatClear === 1, 'the box is told to empty itself');
    ok(!/class="bubble"/.test(root.html), 'the sender gets no speech bubble of their own');
    for (const nothing of ['', '   ', '\n', '​', undefined, null, 5, {}]) d({ type: 'sendText', text: nothing });
    ok(ws.sent.filter(m => m.t === 'chat').length === 1 && S.chatLog.length === 1 && S.chatClear === 1, 'blank or not-text messages are never sent, and never shown');
    d({ type: 'sendText', text: 'y'.repeat(400) });
    ok(ws.sent.filter(m => m.t === 'chat')[1].text.length === 80, 'a long one is cut to 80 before it is sent');
    d({ type: 'sendText', text: '<img src=x onerror=alert(1)>' });
    ok(/<span>&lt;img src=x onerror=alert\(1\)&gt;<\/span>/.test(root.html) && !/<img src=x/.test(root.html), 'what the sender sees is escaped: markup shows as text');
    ws.say({ t: 'error', code: 'slow_down', message: 'Not so fast: that message was not sent.' });
    const items = chatItems(root.html);
    ok(/<li class="sys">Not so fast: that message was not sent\.<\/li>\s*$/.test(items), 'if the server says it was too fast, the chat says so, as its last line');
    ok(items.indexOf('Nice move') < items.indexOf('yyyy') && items.indexOf('yyyy') < items.indexOf('&lt;img') && items.indexOf('&lt;img') < items.indexOf('Not so fast'), 'oldest first, newest at the bottom');
    d({ type: 'sendChat', key: 1 });
    ok(ws.sent.filter(m => m.t === 'chat').pop().id === 1 && /<span>Well played!<\/span>/.test(root.html), '(a quick phrase, if something sends one, still goes out and shows)');
  }

  console.log('3. receiving');
  {
    const { S, d, ws, root, advance, started } = await make(null);
    started();
    ws.say({ t: 'chat', text: 'Hi Ann!' });
    ok(/<div class="bubble"><b>Ben<\/b><span>Hi Ann!<\/span><\/div>/.test(root.html), 'a message still appears as a speech bubble in the other player\'s name');
    ok(/<li class="them"><b>Ben<\/b> <span>Hi Ann!<\/span><\/li>/.test(root.html), 'and is kept in the chat');
    advance(30000);
    ok(!/class="bubble"/.test(root.html) && /<li class="them"><b>Ben<\/b> <span>Hi Ann!<\/span><\/li>/.test(root.html), 'the bubble goes away, the chat keeps it');
    ws.say({ t: 'chat', text: '<img src=x onerror=alert(1)><script>alert(2)</script>' });
    ok(/&lt;img src=x onerror=alert\(1\)&gt;&lt;script&gt;/.test(root.html) && !/<img src=x|<script>/.test(root.html), 'markup in a message is shown as plain text, in the chat and in the bubble');
    ws.say({ t: 'chat', text: 'a‮b​c\nd' });
    ok(/<span>abc d<\/span>/.test(chatItems(root.html)), 'a message is cleaned on arrival as well (whatever a changed server sent)');
    ws.say({ t: 'chat', text: 'q'.repeat(5000) });
    ok((chatItems(root.html).match(/<span>(q+)<\/span>/) || [, ''])[1].length === 80, 'an enormous message is cut to 80');
    const before = S.chatLog.length;
    for (const bad of [{ text: '' }, { text: '   ' }, { text: 42 }, { text: null }, { text: { a: 1 } }, { text: ['x'] }, {}]) ws.say(Object.assign({ t: 'chat' }, bad));
    ok(S.chatLog.length === before, 'messages with no text, or text that is not text, are ignored (and not added to the chat)');
    ws.say({ t: 'chat', id: 2, text: 'Good game!' });
    ok(/<li class="them"><b>Ben<\/b> <span>Good game!<\/span><\/li>/.test(root.html), '(quick phrases still arrive and show)');
    for (let i = 0; i < 400; i++) ws.say({ t: 'chat', text: 'line ' + i });
    ok(S.chatLog.length === 300 && /line 399/.test(root.html) && !/line 99</.test(root.html), 'the chat keeps the latest 300 lines');
    ok(/<li class="them"><b>Ben<\/b>/.test(root.html) && (root.html.match(/<li class="them"/g) || []).length === 300, 'all of them are drawn');
  }

  console.log('4. the chat lives and dies with the game');
  {
    const { S, d, ws, root, started } = await make(null);
    started();
    ws.say({ t: 'chat', text: 'before' });
    ok(S.chatLog.length === 1, 'one message');
    d({ type: 'toggleLog' });
    ok(S.opts.log === false && /class="log-wrap chat-only"/.test(root.html) && !/class="log"/.test(root.html) && /<span>before<\/span>/.test(root.html), 'with the game history hidden, the chat is still there on its own');
    d({ type: 'toggleLog' });
    ok(/class="log-wrap"/.test(root.html) && /class="log"/.test(root.html), 'and it shares the block again when the history is shown');
    ws.say({ t: 'rematch', backdrop: 'hall' });
    ok(S.chatLog.length === 0, 'a rematch starts with an empty chat');
    ws.say({ t: 'chat', text: 'again' });
    d({ type: 'askLeave' }); d({ type: 'confirmLeave' });
    ok(S.chatLog.length === 0 && !/class="chat"/.test(root.html), 'leaving the game empties the chat, and the page no longer shows one');
  }
  {
    const root = { html: '', set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; }, querySelectorAll() { return []; }, querySelector() { return null; }, ownerDocument: {}, addEventListener() {} };
    const app = G.createApp({ root, sleep: async () => {}, reducedMotion: true, storage: { get: () => null, set() {} }, rng: mulberry32(5) });
    app.dispatch({ type: 'boot' }); app.dispatch({ type: 'startGame', rounds: 1, hand: 7, level: 'normal' });
    ok(!/class="chat"|log-wrap|data-say-form/.test(root.html), 'a game against the computer has no chat: the computer\'s Comments are its talk');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
