"""The game history: at the bottom in every layout, shown or hidden from the menu (no pop-up window); in Compact and Tiny it stays at the bottom of the screen."""
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
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for w, h, view, cpus in ((390, 780, 'compact', 3), (390, 780, 'tiny', 1), (1100, 900, 'roomy', 1), (390, 844, 'roomy', 1)):
            pg = b.new_page(viewport={'width': w, 'height': h}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-cpus', str(cpus)); pg.select_option('#opt-view', view)
            pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid'); pg.wait_for_timeout(500)
            tag = f'{view} {w}px'
            check(f'{tag}: the history is there by default', pg.locator('.log').count() == 1)
            pg.click('.menu-btn')
            check(f'{tag}: the menu toggles it (no pop-up item)', pg.locator('.menu [data-action="toggleLog"]').count() == 1 and pg.locator('.menu [data-action="openMoves"]').count() == 0)
            check(f'{tag}: the menu says Hide', 'Hide game history' in pg.locator('.menu').inner_text())
            pg.click('.menu [data-action="toggleLog"]')
            check(f'{tag}: hidden', pg.locator('.log').count() == 0 and pg.locator('.overlay, .dialog').count() == 0)
            pg.click('.menu-btn'); check(f'{tag}: the menu says Show', 'Show game history' in pg.locator('.menu').inner_text())
            pg.click('.menu [data-action="toggleLog"]')
            check(f'{tag}: shown again, and no window opened', pg.locator('.log').count() == 1 and pg.locator('.dialog').count() == 0)
            if view != 'roomy':
                r = pg.evaluate("() => { const r = document.querySelector('.log').getBoundingClientRect(); return [r.top, r.bottom, innerHeight, document.documentElement.scrollHeight]; }")
                check(f'{tag}: the history is in view at the bottom of the screen without scrolling (or the page is short enough to show it all) {r}', r[1] <= r[2] + 1 and (r[3] <= r[2] or r[1] >= r[2] - 2) and r[0] > 300)
                if w == 390 and cpus == 3: pg.screenshot(path='/tmp/log_sticky.png')
            check(f'{tag}: no page errors', not errs)
            pg.close()
finally:
    srv.terminate()
print('browser log:', ok, 'passed,', bad, 'failed')
raise SystemExit(1 if bad else 0)
