#!/usr/bin/env python3
"""The chat of an online game in real Chromium, between two people: it sits at the bottom right beside the game history, the box survives the page
   being redrawn (same element, same text, same cursor, same focus), Enter and Send both send, messages are kept in the list (newest at the bottom, which
   follows the newest unless the reader scrolled up), hostile text is only ever text, and it fits a phone."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)

srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True)
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
BOX = "() => { const i = document.getElementById('say-text'); return { node: i === window.__node, value: i ? i.value : null, active: document.activeElement === i, caret: i ? i.selectionStart : null }; }"
ITEMS = "() => Array.from(document.querySelectorAll('.chat-list li')).map(li => ({ cls: li.className, who: li.querySelector('b') ? li.querySelector('b').textContent : '', text: li.querySelector('span') ? li.querySelector('span').textContent : li.textContent }))"
RECT = "sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }"
errors = []

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ca = browser.new_context(viewport={'width': 1200, 'height': 900}); cb = browser.new_context(viewport={'width': 1200, 'height': 900})
    a = ca.new_page(); b = cb.new_page()
    for p in (a, b): p.on('pageerror', lambda e: errors.append(str(e)))
    a.goto(base); a.click('[data-action="openHost"]')
    a.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    a.fill('#net-name', 'Ann'); a.select_option('#net-rounds', '1'); a.select_option('#net-hand', '8'); a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
    code = a.eval_on_selector('.code-big', 'e => e.textContent').strip()
    b.goto(base + '?join=' + code.replace('-', '')); b.wait_for_selector('#net-code'); b.fill('#net-name', 'Ben'); b.click('[data-action="joinGame"]'); b.wait_for_selector('.code-big')
    a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled")
    a.click('[data-action="startOnline"]'); a.wait_for_selector('.tracks'); b.wait_for_selector('.tracks')
    a.wait_for_function("() => window.MexicanTrainApp.state.awaiting"); b.wait_for_function("() => window.MexicanTrainApp.state.awaiting")

    print('1. where it is')
    ok(a.query_selector('.chat') is not None and b.query_selector('.chat') is not None, 'both players have a chat')
    ok(a.query_selector('[data-action="toggleSay"]') is None and 'Say something' not in a.inner_text('body'), 'and no Say something button')
    lg, ch = a.evaluate(RECT, '.log'), a.evaluate(RECT, '.chat')
    ok(ch['l'] >= lg['r'] - 2 and abs(ch['t'] - lg['t']) < 3 and abs(ch['h'] - lg['h']) < 3, f'the chat is right of the game history, the same height ({lg}, {ch})')
    ok(ch['r'] > 1100 and ch['b'] > 600, f"in the bottom right of the window ({ch['r']:.0f}, {ch['b']:.0f})")
    ok(ch['w'] > 250 and a.evaluate(RECT, '#say-text')['w'] > 150, 'wide enough to use')
    ok(a.inner_text('.chat-list').strip() == 'No messages yet.', 'empty at first')

    print('2. the box survives the page being redrawn while a person types')
    a.click('#say-text'); time.sleep(0.1)
    a.evaluate("() => { window.__node = document.getElementById('say-text'); window.__list = document.querySelector('.chat'); window.__renders = 0; new MutationObserver(m => { window.__renders += m.length; }).observe(document.getElementById('app'), { childList: true }); }")
    a.keyboard.type('abcdef')
    for _ in range(3): a.keyboard.press('ArrowLeft')
    b.evaluate("() => { const a = window.MexicanTrainApp.state.awaiting; window.MexicanTrainApp.dispatch({ type: a && a.canBuild ? 'autoBuild' : (a && a.canDraw ? 'draw' : 'endBuild') }); }")
    time.sleep(1.2)
    for _ in range(8): a.evaluate("() => window.MexicanTrainApp.render(true)")
    r = a.evaluate("() => window.__renders"); d = a.evaluate(BOX)
    ok(r >= 8, f'the page was redrawn {r} times meanwhile')
    ok(d['node'] and a.evaluate("() => window.__list === document.querySelector('.chat')"), 'and it is still the very same chat and text box (not new ones made to look like them)')
    ok(d['value'] == 'abcdef' and d['active'] and d['caret'] == 3, f"with the same text, the cursor where it was, and the focus: {d['value']!r}, cursor {d['caret']}, focused {d['active']}")
    a.keyboard.type('X')
    ok(a.evaluate(BOX)['value'] == 'abcXdef', 'and typing carries on from the cursor: ' + a.evaluate(BOX)['value'])

    print('3. sending')
    a.keyboard.press('Enter'); time.sleep(0.5)
    ok(a.evaluate(BOX)['value'] == '' and a.evaluate(BOX)['active'], 'Enter sends, empties the box and keeps the focus there')
    ia, ib = a.evaluate(ITEMS), b.evaluate(ITEMS)
    ok(ia == [{'cls': 'mine', 'who': 'You', 'text': 'abcXdef'}], f'Ann sees it as "You": {ia}')
    ok(ib == [{'cls': 'them', 'who': 'Ann', 'text': 'abcXdef'}], f"Ben sees it as Ann's: {ib}")
    time.sleep(1.7)
    b.fill('#say-text', '<img src=x onerror="window.__pwned=1"> & <b>bold</b>'); b.click('.chat [data-action="sendText"]'); time.sleep(0.5)
    ok(b.evaluate(BOX.replace('window.__node', 'null'))['value'] == '', 'the Send button works too, and empties the box')
    ia = a.evaluate(ITEMS)
    ok(len(ia) == 2 and ia[1]['who'] == 'Ben' and ia[1]['text'] == '<img src=x onerror="window.__pwned=1"> & <b>bold</b>' and a.query_selector('.chat img') is None and not a.evaluate('() => window.__pwned'), 'hostile text arrives as plain text and does nothing')
    ok(a.query_selector('.bubble b') is not None and a.inner_text('.bubble b') == 'Ben', "(it also shows as a bubble in Ben's name, as before)")
    time.sleep(13)
    ok(a.query_selector('.bubble') is None and len(a.evaluate(ITEMS)) == 2, 'the bubble goes away; the messages stay in the chat')
    a.fill('#say-text', '   '); a.keyboard.press('Enter'); time.sleep(0.3)
    ok(len(a.evaluate(ITEMS)) == 2, 'a blank message is not sent')

    print('4. the list')
    a.evaluate("() => { const S = window.MexicanTrainApp.state; for (let i = 0; i < 40; i++) S.chatLog.push({ who: 'Ben', text: 'filler ' + i }); window.MexicanTrainApp.render(true); }")
    top = a.evaluate("() => { const l = document.querySelector('.chat-list'); return l.scrollHeight - l.scrollTop - l.clientHeight; }")
    ok(top < 4, f'the list follows the newest message ({top}px from the bottom)')
    ok(a.evaluate("() => document.querySelector('.chat-list').scrollHeight > document.querySelector('.chat-list').clientHeight + 100") and a.evaluate(RECT, '.chat')['h'] < 140, 'it scrolls inside a panel of a fixed size')
    a.evaluate("() => { document.querySelector('.chat-list').scrollTop = 0; }")
    a.evaluate("() => { const S = window.MexicanTrainApp.state; S.chatLog.push({ who: 'Ben', text: 'newest' }); window.MexicanTrainApp.render(true); }")
    ok(a.evaluate("() => document.querySelector('.chat-list').scrollTop") < 4, 'a reader who scrolled up is not pulled down when a message arrives')
    a.evaluate("() => { const l = document.querySelector('.chat-list'); l.scrollTop = l.scrollHeight; }")
    a.fill('#say-text', 'last one'); a.keyboard.press('Enter'); time.sleep(0.4)
    ok(a.evaluate("() => { const l = document.querySelector('.chat-list'); return l.scrollHeight - l.scrollTop - l.clientHeight < 4; }") and a.evaluate(ITEMS)[-1]['text'] == 'last one', 'sending your own message shows it at the bottom')
    ok(a.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"), 'no sideways scrolling')

    print('5. a phone')
    cp = browser.new_context(viewport={'width': 390, 'height': 760}, has_touch=True, is_mobile=True); p = cp.new_page(); p.on('pageerror', lambda e: errors.append(str(e)))
    p.goto(base + '?join=' + code.replace('-', '')); p.wait_for_selector('#net-code')
    # (a third person cannot join a two-person game, so look at the phone layout from the first player's side instead)
    a.set_viewport_size({'width': 390, 'height': 760}); time.sleep(0.5)
    a.evaluate("() => window.MexicanTrainApp.render(true)")
    ch = a.evaluate(RECT, '.chat'); lg = a.evaluate(RECT, '.log'); inp = a.evaluate(RECT, '#say-text')
    ok(ch['r'] <= 392 and ch['l'] >= -2 and inp['w'] > 110 and inp['h'] >= 22, f'on a phone the chat and its box fit the screen ({ch}, {inp})')
    ok(a.evaluate("() => parseFloat(getComputedStyle(document.getElementById('say-text')).fontSize)") >= 16, 'the box has a 16px font (a phone does not zoom in when it is used)')
    ok(a.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), 'no sideways scrolling on a phone')
    ok(not errors, 'no errors on the page: ' + '; '.join(errors[:3]))
    browser.close()

srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
