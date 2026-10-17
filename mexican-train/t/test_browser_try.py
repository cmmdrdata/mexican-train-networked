"""A try on the wrong train: the face-down tile goes there, shakes and comes back (a person's invalid try, and a computer's, in the opening)."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.abspath(__file__))
srv = subprocess.Popen(['node', os.path.join(ROOT, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
ok = bad = 0
def check(name, cond):
    global ok, bad
    if cond: ok += 1
    else: bad += 1; print('FAIL', name)
FLY = "() => [...document.querySelectorAll('.flying')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })"
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for w, h in ((390, 780), (1100, 900)):
            pg = b.new_page(viewport={'width': w, 'height': h}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15'); pg.select_option('#opt-cpus', '2'); pg.select_option('#opt-level', 'easy'); pg.select_option('#opt-level2', 'easy')
            pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
            # a computer's tries during its opening (Easy: about 0.3 per tile laid)
            seen = 0; t0 = time.time(); maxn = 0
            while time.time() - t0 < 25 and seen < 1:
                n = len(pg.evaluate(FLY)); maxn = max(maxn, n)
                pg.wait_for_timeout(30)
                kinds = pg.evaluate("() => [...document.querySelectorAll('.flying')].filter(e => e.getAnimations && e.getAnimations().some(a => a.effect && a.effect.getKeyframes().length >= 6)).length")
                if kinds: seen = 1
            check(f'{w}px: an Easy computer tries a wrong train during its opening (a shaking flight was seen)', seen == 1)
            if seen and w == 390: pg.screenshot(path='/tmp/try_phone.png')
            # a person's invalid try: the tile goes to the train and comes back
            pg.wait_for_function("() => { const a = window.MexicanTrainApp.state.awaiting; return a && a.kind === 'build' && a.moves && a.moves.length; }", timeout=20000)
            pg.evaluate("() => { const app = window.MexicanTrainApp, a = app.state.awaiting, m = a.moves[0]; app.dispatch({ type: 'selectTile', key: Math.min(m.tile[0], m.tile[1]) + '-' + Math.max(m.tile[0], m.tile[1]) }); window.__k = Math.min(m.tile[0], m.tile[1]) + '-' + Math.max(m.tile[0], m.tile[1]); }")
            pg.wait_for_timeout(1500)       # (let any computer try end first)
            pg.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'invalidTry', train: 'cpu', key: window.__k })")
            pg.wait_for_timeout(120)
            f = pg.evaluate(FLY)
            check(f'{w}px: your invalid try sends a tile flying to that train ({f})', len(f) >= 1)
            pg.wait_for_timeout(1400)
            check(f'{w}px: and it is gone again afterwards', len(pg.evaluate(FLY)) == 0)
            check(f'{w}px: no page errors ({errs})', not errs)
            pg.close()
        b.close()
finally:
    srv.terminate()
print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)
