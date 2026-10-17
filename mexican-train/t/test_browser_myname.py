import json, os, subprocess, sys
from playwright.sync_api import sync_playwright
P = F = 0
def check(n, c):
    global P, F
    if c: P += 1
    else: F += 1; print('FAIL:', n)
srv = subprocess.Popen(['node', os.path.join(os.path.dirname(__file__), 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1100, 'height': 900})
        pg.goto(base); pg.wait_for_selector('#opt-name')
        check('field has maxlength 10', pg.get_attribute('#opt-name', 'maxlength') == '10')
        pg.select_option('#opt-rounds', '1'); pg.fill('#opt-name', 'Alexandria99')
        pg.click('[data-action="startGame"]'); pg.wait_for_selector('.totals')
        tots = pg.evaluate("() => [...document.querySelectorAll('.bar .totals .tot span')].map(e => e.textContent)")
        check('scoreboard shows the name, cut to 10', tots[0] == 'Alexandria' and 'You' not in tots)
        check('own train is named', pg.evaluate("() => document.querySelector('.track[data-train=human] .track-name').textContent") == "Alexandria's train")
        pg.reload(); pg.wait_for_selector('#opt-name')
        check('name is remembered', pg.input_value('#opt-name') == 'Alexandria')
        pg.fill('#opt-name', ''); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.totals')
        check('empty name goes back to You', pg.evaluate("() => document.querySelector('.bar .totals .tot span').textContent") == 'You' and pg.evaluate("() => document.querySelector('.track[data-train=human] .track-name').textContent") == 'Your train')
        b.close()
finally: srv.terminate()
print(f'browser myname: {P} passed, {F} failed'); sys.exit(1 if F else 0)
