#!/usr/bin/env python3
"""The end of a single-player game (against three computers): two buttons. Quit goes to the menu; Play again starts the same game again (same settings) at once."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
os.makedirs('/tmp/shots', exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)
STEP = """() => {
  const app = window.MexicanTrainApp, S = app.state, a = S.awaiting;
  if (!a) return 'wait';
  if (a.kind === 'modal') return 'modal';
  if (a.kind === 'draw') { app.dispatch({ type: 'draw' }); return 'draw'; }
  if (a.kind === 'build') {
    if (a.canDraw) { app.dispatch({ type: 'draw' }); return 'build'; }
    const nonDouble = a.moves.find(x => x.tile[0] !== x.tile[1]);
    if (a.moves.length && (a.placed < 3 || !a.canDone)) { const m = (a.placed >= 2 && nonDouble) ? nonDouble : a.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); return 'build'; }
    app.dispatch({ type: a.canDone ? 'endBuild' : 'undoTile' }); return 'build';
  }
  if (a.kind === 'move') { const m = a.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); return 'move'; }
  return 'other';
}"""
MODAL = "() => { const m = window.MexicanTrainApp.state.modal; return m ? m.type : null; }"
def finish(pg):
    t = time.time()
    while time.time() - t < 280 and not (pg.evaluate(MODAL) == 'final'):
        pg.evaluate(STEP)
        if pg.evaluate(MODAL) == 'roundEnd': pg.click('[data-action="dialogOk"]')
        time.sleep(0.03)
    return pg.evaluate(MODAL) == 'final'
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        ctx.add_init_script("(() => { const st = window.setTimeout.bind(window); window.setTimeout = (f, ms, ...a) => st(f, typeof ms === 'number' ? Math.min(ms, 12) : ms, ...a); })();")
        pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '8'); pg.select_option('#opt-cpus', '3'); pg.select_option('#opt-level', 'easy'); pg.select_option('#opt-level2', 'normal'); pg.select_option('#opt-level3', 'hard')
        pg.fill('#opt-name', 'Zelda')
        pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
        ok(finish(pg), 'the game reached its final screen')
        btns = pg.evaluate("() => [...document.querySelectorAll('.dialog .actions .btn')].map(b => b.textContent.trim())")
        ok(btns == ['Quit', 'Play again'], f'two buttons: {btns}')
        pg.screenshot(path='/tmp/shots/final_buttons.png')
        names = pg.evaluate("() => window.MexicanTrainApp.state.cpuName")
        opts = pg.evaluate("() => JSON.stringify(window.MexicanTrainApp.state.opts)")
        pg.click('[data-action="playAgain"]'); pg.wait_for_selector('.hand-grid', timeout=10000)
        ok(pg.evaluate("() => !document.querySelector('#opt-rounds')") and pg.evaluate("() => window.MexicanTrainApp.state.opts && JSON.stringify(window.MexicanTrainApp.state.opts)") == opts, 'Play again: no menu, a new game on the same settings')
        ok(pg.evaluate("() => window.MexicanTrainApp.state.opts.cpus") == 3 and pg.evaluate("() => window.MexicanTrainApp.state.myName") == 'Zelda' and pg.evaluate("() => document.querySelectorAll('.track').length") == 5, 'still three computers, and still Zelda')
        ok(finish(pg), 'the second game reaches its final screen too')
        pg.click('.dialog .actions .btn:not(.primary)'); pg.wait_for_selector('#opt-rounds', timeout=10000)
        ok(True, 'Quit goes to the menu')
        ok(pg.input_value('#opt-cpus') == '3' and pg.input_value('#opt-name') == 'Zelda', 'with the same settings filled in')
        ok(not errs, f'no page errors {errs}')
        b.close()
finally: srv.terminate()
print(f'browser again: {passed} passed, {failed} failed'); sys.exit(1 if failed else 0)
