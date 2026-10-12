#!/usr/bin/env python3
"""Real Chromium, two people, a one-round game: after the last round, whoever presses "See final score" has it at once (the other person's
   button is not waited for), even if they then go back to the menu; the other person still gets theirs."""
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
STEP = """() => {
  const app = window.MexicanTrainApp, S = app.state, a = S.awaiting;
  if (!a || (S.online && S.online.pending)) return 'wait';
  if (a.kind === 'modal') return 'modal';
  if (a.kind === 'draw') { app.dispatch({ type: 'draw' }); return 'draw'; }
  if (a.kind === 'build') { app.dispatch({ type: a.canDraw ? 'draw' : a.canBuild ? 'autoBuild' : a.canDone ? 'endBuild' : 'undoTile' }); return 'build'; }
  if (a.kind === 'move') { const m = a.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); return 'move'; }
  return 'other';
}"""
MODAL = "() => { const m = window.MexicanTrainApp.state.modal; return m ? m.type : null; }"
errors = []

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ca = browser.new_context(viewport={'width': 1100, 'height': 900}); cb = browser.new_context(viewport={'width': 1100, 'height': 900})
    a = ca.new_page(); b = cb.new_page()
    for p in (a, b): p.on('pageerror', lambda e: errors.append(str(e)))
    a.goto(base); a.click('[data-action="openHost"]')
    a.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    a.fill('#net-name', 'Ann'); a.select_option('#net-rounds', '1'); a.select_option('#net-hand', '8'); a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
    code = a.eval_on_selector('.code-big', 'e => e.textContent').strip()
    b.goto(base + '?join=' + code.replace('-', '')); b.wait_for_selector('#net-code'); b.fill('#net-name', 'Ben'); b.click('[data-action="joinGame"]'); b.wait_for_selector('.code-big')
    a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled")
    a.click('[data-action="startOnline"]'); a.wait_for_selector('.tracks'); b.wait_for_selector('.tracks')

    t0 = time.time()
    while time.time() - t0 < 120 and not (a.evaluate(MODAL) == 'roundEnd' and b.evaluate(MODAL) == 'roundEnd'):
        a.evaluate(STEP); b.evaluate(STEP); time.sleep(0.04)
    ok(a.evaluate(MODAL) == 'roundEnd' and b.evaluate(MODAL) == 'roundEnd', f'the game is played to the end of its only round ({time.time() - t0:.0f} s)')
    ok('See final score' in a.inner_text('.dialog') and 'See final score' in b.inner_text('.dialog'), 'both screens have a "See final score" button')
    a.screenshot(path='/tmp/shots/final_before.png')

    print('the host presses it')
    a.click('[data-action="dialogOk"]')
    a.wait_for_function("() => window.MexicanTrainApp.state.modal && window.MexicanTrainApp.state.modal.type === 'final'", timeout=3000)
    ok(a.evaluate(MODAL) == 'final' and 'Waiting' not in a.inner_text('body'), 'the host has the final score straight away, and is not told to wait for the guest')
    time.sleep(0.5)
    ok(b.evaluate(MODAL) == 'roundEnd' and 'See final score' in b.inner_text('.dialog'), 'while the guest, who has not pressed it, still has the round-end dialog')
    a.screenshot(path='/tmp/shots/final_host.png')

    print('the host goes back to the menu before the guest has pressed it')
    a.click('[data-action="onlineBack"]')
    time.sleep(1.0)
    ok(b.evaluate(MODAL) == 'roundEnd' and 'left the game' not in b.inner_text('body') and b.evaluate("() => !!window.MexicanTrainApp.state.game"), 'the guest\'s game is not ended: no "left the game", and the dialog is still there')
    ok('has gone' in b.inner_text('body') or b.evaluate("() => window.MexicanTrainApp.state.log.some(l => /has gone/.test(l))"), 'and the guest is told that Ann has gone')
    b.click('[data-action="dialogOk"]')
    b.wait_for_function("() => window.MexicanTrainApp.state.modal && window.MexicanTrainApp.state.modal.type === 'final'", timeout=3000)
    ok(b.evaluate(MODAL) == 'final' and ('wins' in b.inner_text('.dialog') or 'win' in b.inner_text('.dialog') or 'tie' in b.inner_text('.dialog').lower()), 'and the guest gets the final score too')
    b.screenshot(path='/tmp/shots/final_guest.png')
    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
