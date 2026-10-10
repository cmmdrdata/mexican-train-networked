#!/usr/bin/env python3
"""Real Chromium, two people: the HOST's 'Allow hints' setting applies to the guest too (each player can still switch their own hints off
   and on if it is allowed), and 'Build my longest train' finishes the opening by itself, with no Done to press."""
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
errors = []
HINTS = "() => ({ toggle: !!document.querySelector('.hints-toggle'), toggleText: (document.querySelector('.hints-toggle') || {}).textContent || null, build: !!document.querySelector('[data-action=\"autoBuild\"]'), lit: document.querySelectorAll('.tile-btn.playable').length })"

def game(browser, hints_off, switch_in_lobby=False):
    ca = browser.new_context(viewport={'width': 1200, 'height': 900}); cb = browser.new_context(viewport={'width': 1200, 'height': 900})
    a = ca.new_page(); b = cb.new_page()
    for p in (a, b): p.on('pageerror', lambda e: errors.append(str(e)))
    a.goto(base); a.click('[data-action="openHost"]')
    a.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    a.fill('#net-name', 'Ann'); a.select_option('#net-rounds', '1'); a.select_option('#net-hand', '15')
    start_text = a.inner_text('#net-hints')
    if hints_off: a.click('#net-hints')
    host_form = (start_text, a.inner_text('#net-hints'))
    a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
    code = a.eval_on_selector('.code-big', 'e => e.textContent').strip()
    b.goto(base + '?join=' + code.replace('-', '')); b.wait_for_selector('#net-code'); b.fill('#net-name', 'Ben'); b.click('[data-action="joinGame"]'); b.wait_for_selector('.code-big')
    a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled")
    return ca, cb, a, b, host_form

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    print('1. hints allowed by the host (the default)')
    ca, cb, a, b, form = game(browser, False)
    ok(form[0] == 'Allow hints: on', f'the Host screen starts with hints on (the host\'s main-screen setting): {form[0]}')
    ok('Hints are allowed' in b.inner_text('.dialog') and 'Hints are allowed' in a.inner_text('.dialog') and a.query_selector('.dialog select, .dialog input, .dialog [aria-pressed]') is None and b.query_selector('.dialog select, .dialog input, .dialog [aria-pressed]') is None, 'both lobbies say hints are allowed, and neither has anything to change: the host\'s choice was made on the Host screen')
    a.click('[data-action="startOnline"]'); a.wait_for_selector('.tracks'); b.wait_for_selector('.tracks')
    a.wait_for_function("() => window.MexicanTrainApp.state.awaiting"); b.wait_for_function("() => window.MexicanTrainApp.state.awaiting")
    ha, hb = a.evaluate(HINTS), b.evaluate(HINTS)
    ok(ha['toggle'] and hb['toggle'] and 'on' in hb['toggleText'], f'both players have a Show hints button, on: {ha["toggleText"]} / {hb["toggleText"]}')
    ok(hb['build'] and ha['build'], 'and both are offered Build my longest train')
    b.click('.hints-toggle'); time.sleep(0.2)
    ok('off' in b.evaluate(HINTS)['toggleText'] and 'on' in a.evaluate(HINTS)['toggleText'], 'the guest can switch their own hints off, and the host\'s stay on')
    b.click('.hints-toggle'); time.sleep(0.2)
    ok('on' in b.evaluate(HINTS)['toggleText'], '...and back on')
    print('2. the guest builds with Build my longest train: the opening finishes by itself')
    ok(b.query_selector('[data-action="autoBuild"]') is not None and b.query_selector('[data-action="endBuild"]') is not None, 'before: a Build button and a Done button')
    b.click('[data-action="autoBuild"]')
    b.wait_for_function("() => { const g = window.MexicanTrainApp.state.game; return g && g.opening && g.opening.human.finished; }", timeout=30000)
    ok(b.query_selector('[data-action="endBuild"]') is None and b.query_selector('[data-action="autoBuild"]') is None, 'the guest\'s opening is finished with nobody pressing Done, and no Done or Build button is left')
    tiles = b.evaluate("() => window.MexicanTrainApp.state.game.trains.human.tiles.length")
    ok(tiles >= 2, f'with the whole train down ({tiles} tiles)')
    a.wait_for_function("() => { const g = window.MexicanTrainApp.state.game; return g && g.opening && g.opening.cpu.finished; }", timeout=10000)
    shown = a.evaluate("() => window.MexicanTrainApp.state.game.trains.cpu.tiles.length")
    ok(shown == tiles and a.evaluate("() => window.MexicanTrainApp.state.game.trains.cpu.tiles.every(t => t[0] >= 0)"), 'and the host sees those tiles turned face up, as when anyone finishes')
    ca.close(); cb.close()

    print('3. hints turned off by the host')
    ca, cb, a, b, form = game(browser, True)
    ok(form[1] == 'Allow hints: off', f'the host switches it off on the Host screen: {form[1]}')
    ok('Hints are off' in b.inner_text('.dialog'), 'the guest\'s lobby says hints are off, the host\'s choice')
    ok('Hints are off.' in a.inner_text('.dialog') and a.query_selector('.dialog select, .dialog input, .dialog [aria-pressed]') is None, 'the host\'s lobby just says hints are off (nothing to change there)')
    a.click('[data-action="startOnline"]'); a.wait_for_selector('.tracks'); b.wait_for_selector('.tracks')
    a.wait_for_function("() => window.MexicanTrainApp.state.awaiting"); b.wait_for_function("() => window.MexicanTrainApp.state.awaiting")
    ha, hb = a.evaluate(HINTS), b.evaluate(HINTS)
    ok(not ha['toggle'] and not hb['toggle'], 'neither player has a Show hints button')
    ok(not ha['build'] and not hb['build'], 'nobody is offered Build my longest train')
    ok(ha['lit'] == 0 and hb['lit'] == 0, 'and no tile is highlighted as playable for either')
    ok(b.evaluate("() => window.MexicanTrainApp.state.opts.allowHints") is True, '(the guest\'s own saved setting is still on: it is the host\'s choice that rules)')
    # a changed page asking for it anyway is refused by the server
    b.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'autoBuild' })"); time.sleep(0.4)
    ok(b.evaluate("() => window.MexicanTrainApp.state.game.trains.human.tiles.length") == 0, 'asking for Build my longest train anyway does nothing')
    ca.close(); cb.close()

    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
