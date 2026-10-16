#!/usr/bin/env python3
"""Real Chromium: a tile taken back from your train in the opening flies back into your hand instead of vanishing."""
import json, os, subprocess, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = '/tmp/shots'; os.makedirs(SHOTS, exist_ok=True)
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)
srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
with sync_playwright() as pw:
    browser = pw.chromium.launch(); pg = browser.new_page(viewport={'width': 1100, 'height': 950})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15'); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
    t0 = time.time(); got = False
    while time.time() - t0 < 60:
        a = pg.evaluate("() => { const a = window.MexicanTrainApp.state.awaiting; return a ? { kind: a.kind, moves: (a.moves || []).length, undo: !!a.canUndo, draw: !!a.canDraw } : null; }")
        if a and a['kind'] == 'build' and a['draw']: pg.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'draw' })")
        elif a and a['kind'] == 'build' and a['moves'] and not a['undo']:
            pg.evaluate("() => { const a = window.MexicanTrainApp.state.awaiting, m = a.moves[0]; window.MexicanTrainApp.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); window.MexicanTrainApp.dispatch({ type: 'playOn', train: m.trainId }); }")
        elif a and a['kind'] == 'build' and a['undo']: got = True; break
        time.sleep(0.1)
    ok(got, 'a tile is on your train and can be taken back')
    time.sleep(1.2)
    n_hand = pg.evaluate("() => document.querySelectorAll('.hand .tile-btn').length")
    pg.evaluate("() => { window.__seen = 0; window.__mo = new MutationObserver(() => { if (document.querySelector('body > .flying')) window.__seen++; }); window.__mo.observe(document.body, { childList: true, subtree: true }); }")
    pg.click('[data-action="undoTile"]')
    time.sleep(0.12)
    flying = pg.evaluate("() => { const f = document.querySelector('body > .flying'); if (!f) return null; const r = f.getBoundingClientRect(); return { w: r.width, h: r.height, kids: f.children.length }; }")
    ok(flying is not None, 'right after Take back, a tile is flying')
    if flying: pg.screenshot(path=f'{SHOTS}/undo_fly.png')
    time.sleep(0.7)
    ok(pg.evaluate("() => !document.querySelector('body > .flying')"), 'the flying tile is gone once it has landed')
    ok(pg.evaluate("() => document.querySelectorAll('.hand .tile-btn').length") == n_hand + 1 and pg.evaluate("() => Array.from(document.querySelectorAll('.hand .tile .tile, .hand .tile-btn .tile')).every(e => e.style.visibility !== 'hidden')"), 'the tile is back in the hand, visible')
    ok(not errs, f'no page errors {errs}')
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
raise SystemExit(1 if failed else 0)
