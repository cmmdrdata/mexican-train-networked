#!/usr/bin/env python3
"""Typed 'Say something' in real Chromium, between two people: the text box survives the page being redrawn (same element, same text,
   same cursor, same focus), Enter sends, Escape closes, quick phrases work, hostile text is only ever text, and it fits a phone."""
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
BUBBLE = "() => { const el = document.querySelector('.bubble'); return el ? { who: el.querySelector('b').textContent, text: el.querySelector('span').textContent, html: el.innerHTML } : null; }"
DOCK = "() => { const d = document.getElementById('say-dock'), i = document.getElementById('say-text'); return { hidden: d ? d.hidden : null, visible: d ? getComputedStyle(d).display !== 'none' : false, active: document.activeElement === i, value: i ? i.value : null, caret: i ? i.selectionStart : null, node: i === window.__node, inApp: !!document.querySelector('#app #say-dock') }; }"
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

    print('1. the box')
    d = a.evaluate(DOCK)
    ok(d['hidden'] is True and d['visible'] is False, 'the box starts hidden')
    ok(d['inApp'] is False, 'and is not inside the part of the page that is redrawn')
    a.click('[data-action="toggleSay"]'); time.sleep(0.15)
    d = a.evaluate(DOCK)
    ok(d['visible'] and d['active'], 'Say something shows it with the cursor already in it, ready to type')
    a.evaluate("() => { window.__node = document.getElementById('say-text'); window.__renders = 0; new MutationObserver(m => { window.__renders += m.length; }).observe(document.getElementById('app'), { childList: true }); }")

    print('2. it survives the page being redrawn while a person types')
    a.keyboard.type('abcdef')
    for _ in range(3): a.keyboard.press('ArrowLeft')                      # the cursor goes between c and d
    # real moves by the other player (each one is a redraw on this page) ...
    b.evaluate("() => { const a = window.MexicanTrainApp.state.awaiting; window.MexicanTrainApp.dispatch({ type: a && a.canBuild ? 'autoBuild' : (a && a.canDraw ? 'draw' : 'endBuild') }); }")
    time.sleep(1.2)
    # ... and a good many more, forced
    for _ in range(8): a.evaluate("() => window.MexicanTrainApp.render(true)")
    r = a.evaluate("() => window.__renders")
    d = a.evaluate(DOCK)
    ok(r >= 8, f'the page was redrawn {r} times meanwhile')
    ok(d['node'] is True, 'and it is still the very same text box (not a new one made to look like it)')
    ok(d['value'] == 'abcdef' and d['active'] and d['caret'] == 3, f"with the same text, the cursor where it was, and the focus: {d['value']!r}, cursor {d['caret']}, focused {d['active']}")
    a.keyboard.type('X')
    ok(a.evaluate(DOCK)['value'] == 'abcXdef', 'and typing carries on from the cursor: ' + a.evaluate(DOCK)['value'])

    print('3. sending')
    a.keyboard.press('Enter'); time.sleep(0.5)
    d = a.evaluate(DOCK)
    ok(d['hidden'] is True and d['value'] == '', 'Enter sends it: the box empties and goes away')
    ok('You said: abcXdef' in a.inner_text('.opp'), 'the sender sees "You said: abcXdef"')
    bb = b.evaluate(BUBBLE)
    ok(bb and bb['who'] == 'Ann' and bb['text'] == 'abcXdef', f'the other person sees it in a speech bubble in Ann\'s name: {bb and bb["text"]}')
    a.screenshot(path='/tmp/shots/say_sender.png'); b.screenshot(path='/tmp/shots/say_receiver.png')

    print('4. hostile text is only ever text')
    time.sleep(1.7)
    evil = '<img src=x onerror="window.__xss=1"><b>bold</b> & "quotes"'
    a.click('[data-action="toggleSay"]'); time.sleep(0.1); a.keyboard.type(evil); a.keyboard.press('Enter'); time.sleep(0.6)
    bb = b.evaluate(BUBBLE)
    ok(bb and bb['text'] == evil, f'it arrives exactly as typed, as text: {bb and bb["text"]}')
    ok(b.evaluate("() => document.querySelectorAll('.bubble img, .bubble b + b').length === 0 && document.querySelector('.bubble span').children.length === 0 && window.__xss === undefined"), 'no element was created from it, and no script ran')

    print('5. Escape, quick phrases, and the rate limit')
    time.sleep(1.7)
    a.click('[data-action="toggleSay"]'); time.sleep(0.1); a.keyboard.type('half a thought'); a.keyboard.press('Escape'); time.sleep(0.2)
    d = a.evaluate(DOCK)
    ok(d['hidden'] is True and not a.query_selector('.overlay'), 'Escape closes the box (and nothing else)')
    a.click('[data-action="toggleSay"]'); time.sleep(0.15)
    ok(a.evaluate(DOCK)['value'] == 'half a thought', 'and what was typed is still there when it is opened again')
    a.keyboard.press('Control+A'); a.keyboard.press('Backspace')
    a.click('#say-dock [data-phrase="0"]'); time.sleep(0.5)
    bb = b.evaluate(BUBBLE)
    ok(a.evaluate(DOCK)['hidden'] is True and bb and bb['text'] == 'Nice play!', f'a quick phrase in the box is sent, and the box goes away: {bb and bb["text"]}')
    a.click('[data-action="toggleSay"]'); time.sleep(0.1); a.keyboard.type('too soon'); a.keyboard.press('Enter'); time.sleep(0.5)
    ok('Not so fast: that message was not sent.' in a.inner_text('.opp') and 'You said: too soon' not in a.inner_text('.opp'), 'a second message straight away is refused, and Ann is told, where "You said" would be, that it was not sent')
    ok(b.evaluate(BUBBLE)['text'] == 'Nice play!', '(and Ben did not get it)')

    print('6. with a dialog on top, and the other way round')
    time.sleep(1.7)
    a.click('[data-action="toggleSay"]'); time.sleep(0.1)
    a.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'openRules' })"); time.sleep(0.2)
    ok(a.evaluate(DOCK)['visible'] is False, 'a dialog (Rules) on top hides the box')
    a.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'closeOverlay' })"); time.sleep(0.2)
    ok(a.evaluate(DOCK)['visible'] is True, '...and it is there again when the dialog is closed')
    a.keyboard.press('Escape')
    b.click('[data-action="toggleSay"]'); time.sleep(0.15)
    ok(b.evaluate(DOCK)['active'] is True, 'Ben has it too')
    b.keyboard.type('Thanks Ann \U0001F600'); b.keyboard.press('Enter'); time.sleep(0.6)
    ab = a.evaluate(BUBBLE)
    ok(ab and ab['who'] == 'Ben' and ab['text'] == 'Thanks Ann \U0001F600', f'and it works the other way, emoji included: {ab and ab["text"]}')

    print('7. on a phone')
    time.sleep(1.7)
    a.set_viewport_size({'width': 390, 'height': 780}); time.sleep(0.3)
    a.click('[data-action="toggleSay"]'); time.sleep(0.2)
    box = a.evaluate("() => { const r = document.getElementById('say-dock').getBoundingClientRect(); const i = document.getElementById('say-text'); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, font: parseFloat(getComputedStyle(i).fontSize), vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth }; }")
    ok(box['x'] >= 0 and box['right'] <= box['vw'] and box['y'] >= 0 and box['bottom'] <= box['vh'] and box['scrollW'] <= box['vw'], f"the box fits a 390-pixel-wide screen: x {box['x']:.0f} to {box['right']:.0f} of {box['vw']}, height {box['h']:.0f}")
    ok(box['font'] >= 16, f"and its text is 16 pixels or more, so a phone does not zoom in when it is tapped ({box['font']})")
    a.screenshot(path='/tmp/shots/say_phone.png')
    a.keyboard.press('Escape')

    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
