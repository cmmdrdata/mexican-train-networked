"""Names of at most 10 characters (the entry field and the board, with no overlap), the history with no background, the hand tray adjustable from see-through to solid (tiles always solid)."""
import json, os, subprocess
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.abspath(__file__))
srv = subprocess.Popen(['node', os.path.join(ROOT, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
ok = bad = 0
def check(name, cond):
    global ok, bad
    if cond: ok += 1
    else: bad += 1; print('FAIL', name)
NAMES = ['Bartholome', 'Wolfeschle', 'Maximilian']      # ten characters each: the longest the board will show
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for w, h, view in ((390, 780, 'compact'), (390, 780, 'tiny'), (320, 700, 'tiny'), (1100, 900, 'roomy')):
            pg = b.new_page(viewport={'width': w, 'height': h}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-cpus', '3'); pg.select_option('#opt-view', view)
            pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid'); pg.wait_for_timeout(300)
            pg.evaluate("n => { const A = window.MexicanTrainApp; A.state.cpuName = n[0]; A.state.cpu2Name = n[1]; A.state.cpu3Name = n[2]; A.state.game.turn = 'cpu'; A.render(true); }", NAMES)
            pg.wait_for_timeout(600)
            tag = f'{view} {w}px'
            res = pg.evaluate("""() => [...document.querySelectorAll('.track')].map(t => { const n = t.querySelector('.track-name'), nr = n.getBoundingClientRect(), tile = t.querySelector('.rail .tile'), r = tile ? tile.getBoundingClientRect() : null; return { nameRight: nr.right, tileLeft: r ? r.left : null, sw: n.scrollWidth, cw: n.clientWidth }; })""")
            check(f'{tag}: ten-character names never reach the first domino {[(round(r["nameRight"]), round(r["tileLeft"] or 0)) for r in res]}', all(r['tileLeft'] is None or r['nameRight'] <= r['tileLeft'] + 0.5 for r in res))
            check(f'{tag}: nothing wider than its box', all(r['sw'] <= r['cw'] + 1 for r in res))
            check(f'{tag}: no page errors', not errs)
            if w == 390 and view == 'compact':
                bg = pg.evaluate("() => { const cs = getComputedStyle(document.querySelector('.log')); return [cs.backgroundColor, cs.backgroundImage, cs.backdropFilter]; }")
                check(f'the history has no background at all {bg}', bg[0] in ('rgba(0, 0, 0, 0)', 'transparent') and bg[1] == 'none' and bg[2] in ('none', ''))
            # the slider in the menu
            pg.click('.menu-btn')
            check(f'{tag}: the menu has the hand background slider', pg.locator('.menu input[data-range="tray"]').count() == 1)
            alpha = lambda: pg.evaluate("() => getComputedStyle(document.querySelector('.shell')).getPropertyValue('--tray-a').trim()")
            check(f'{tag}: the default is half see-through ({alpha()})', alpha() == '50%')
            pg.evaluate("v => { const i = document.querySelector('.menu input[data-range=tray]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }", '0')
            check(f'{tag}: at 0 the tray is see-through, and the menu stays open', alpha() == '0%' and pg.locator('.menu').count() == 1)
            tray0 = pg.evaluate("() => getComputedStyle(document.querySelector('.tray')).backgroundImage")
            pg.evaluate("v => { const i = document.querySelector('.menu input[data-range=tray]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }", '100')
            tray100 = pg.evaluate("() => getComputedStyle(document.querySelector('.tray')).backgroundImage")
            check(f'{tag}: at 100 it is solid and different from 0', alpha() == '100%' and tray0 != tray100)
            tile = pg.evaluate("() => { const t = document.querySelector('.hand .tile-btn'); let o = 1; for (let e = t; e && !e.classList.contains('tray'); e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; }")
            check(f'{tag}: the tiles do not change with it (opacity {tile})', tile >= 0.35)
            check(f'{tag}: it is remembered', json.loads(pg.evaluate("() => localStorage.getItem('mt-opts')"))['tray'] == 100)
            pg.reload(); pg.wait_for_selector('#opt-rounds')
            pg.select_option('#opt-rounds', '1'); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
            check(f'{tag}: and used again after a reload', pg.evaluate("() => getComputedStyle(document.querySelector('.shell')).getPropertyValue('--tray-a').trim()") == '100%')
            pg.close()
        # the entry field
        pg = b.new_page(viewport={'width': 800, 'height': 800}); pg.goto(base); pg.wait_for_selector('#opt-rounds')
        pg.click('[data-action="openHost"]') if pg.locator('[data-action="openHost"]').count() else None
        n = pg.locator('#net-name')
        if n.count(): check('the name field takes 10 letters', n.get_attribute('maxlength') == '10')
        else: print('(no name field reachable on this screen; checked by the Node tests)')
finally:
    srv.terminate()
print('browser tray:', ok, 'passed,', bad, 'failed')
raise SystemExit(1 if bad else 0)
