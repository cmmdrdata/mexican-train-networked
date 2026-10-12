#!/usr/bin/env python3
"""A hosted game with a computer character, in real Chromium: it speaks to each person (after a long think), in its own theme's voice,
   next to the theme's own train markers, and the Comments switch works. Runs the Lord of the Rings theme and the classic one."""
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
THEMES = json.loads(subprocess.check_output(['node', '-e', "require('./game.js'); const G = globalThis.MexicanTrainGame; console.log(JSON.stringify({ lotr: G.THEMES.lotr.players, classic: G.CPU_PLAYERS }))"], cwd=HERE, text=True))
BUBBLE = "() => { const el = document.querySelector('.bubble'); return el ? { who: el.querySelector('b').textContent, text: el.querySelector('span').textContent, opacity: getComputedStyle(el).opacity } : null; }"
STAGE = """() => { const S = window.MexicanTrainApp.state; S.game.trains.cpu2.marker = true; S.game.trains.human.marker = true; if (S.game.opening) Object.keys(S.game.opening).forEach(k => { S.game.opening[k].finished = true; }); window.MexicanTrainApp.render(true);
  return { rings: document.querySelectorAll('.toy-train.ring').length, toys: document.querySelectorAll('.toy-train:not(.ring)').length, bubble: !!document.querySelector('.bubble') }; }"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(); errors = []
    for theme in ('lotr', 'classic'):
        label = 'Lord of the Rings' if theme == 'lotr' else 'classic'
        ca = browser.new_context(viewport={'width': 1200, 'height': 950}); cb = browser.new_context(viewport={'width': 1200, 'height': 950})
        a = ca.new_page(); b = cb.new_page()
        for p in (a, b): p.on('pageerror', lambda e: errors.append(str(e)))
        a.goto(base); a.click('[data-action="openHost"]')
        a.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
        a.fill('#net-name', 'Ann'); a.select_option('#net-rounds', '1'); a.select_option('#net-hand', '8'); a.select_option('#net-computer', 'normal'); a.select_option('#net-theme', theme)
        a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
        code = a.eval_on_selector('.code-big', 'e => e.textContent').strip()
        b.goto(base + '?join=' + code.replace('-', '')); b.wait_for_selector('#net-code'); b.fill('#net-name', 'Ben'); b.click('[data-action="joinGame"]'); b.wait_for_selector('.code-big')
        a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled")
        a.click('[data-action="startOnline"]'); a.wait_for_selector('.tracks'); b.wait_for_selector('.tracks')
        a.wait_for_function("() => window.MexicanTrainApp.state.awaiting"); b.wait_for_function("() => window.MexicanTrainApp.state.awaiting")
        who = a.evaluate("() => window.MexicanTrainApp.state.cpu2Name")
        ok(who in THEMES[theme]['normal'], f'{label}: the computer is {who}, one of that theme\'s players')
        ok('Comments: on' in a.inner_text('.opp') and 'Comments: on' in b.inner_text('.opp'), f'{label}: each person has a Comments switch by the computer')
        time.sleep(27.5)                                         # both are taking their time: the computer has something to say to each
        ba, bb = a.evaluate(BUBBLE), b.evaluate(BUBBLE)
        ok(ba and bb and ba['who'] == who and bb['who'] == who and len(ba['text']) > 4 and len(bb['text']) > 4, f'{label}: after a long think the computer speaks to BOTH people, in speech bubbles in its name: "{(ba or {}).get("text")}" / "{(bb or {}).get("text")}"')
        ok(ba and float(ba['opacity']) == 1.0, f'{label}: and the bubble is fully visible')
        st = a.evaluate(STAGE)
        ok(st['bubble'] and ((st['rings'] == 2 and st['toys'] == 0) if theme == 'lotr' else (st['toys'] == 2 and st['rings'] == 0)), f'{label}: next to it, the open trains wear {"rings" if theme == "lotr" else "toy trains"}, as that theme says ({st})')
        a.screenshot(path=f'/tmp/shots/talk_{theme}.png')
        a.click('.chat-toggle[data-action="toggleChat"]'); time.sleep(0.3)
        ok(a.evaluate(BUBBLE) is None and 'Comments: off' in a.inner_text('.opp'), f'{label}: Comments: off takes the bubble away at once')
        ca.close(); cb.close()
    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
