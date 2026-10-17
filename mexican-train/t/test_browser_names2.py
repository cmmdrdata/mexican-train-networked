"""Long names: a player's name never runs into the first domino of their train (Roomy, Compact, Tiny); the history has no background; the hand tray is half see-through while its tiles are solid."""
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
LONG = ['Bartholomew-Alexander', 'Wolfeschlegelstein', 'Maximilianus']
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for w, h, view in ((390, 780, 'compact'), (390, 780, 'tiny'), (320, 700, 'tiny'), (1100, 900, 'roomy'), (700, 900, 'roomy')):
            pg = b.new_page(viewport={'width': w, 'height': h}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-cpus', '3'); pg.select_option('#opt-view', view)
            pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid'); pg.wait_for_timeout(300)
            pg.evaluate("n => { const A = window.MexicanTrainApp; A.state.cpuName = n[0]; A.state.cpu2Name = n[1]; A.state.cpu3Name = n[2]; A.state.game.turn = 'cpu'; A.render(true); }", LONG)
            pg.wait_for_timeout(600)
            tag = f'{view} {w}px'
            res = pg.evaluate("""() => [...document.querySelectorAll('.track')].map(t => { const l = t.querySelector('.track-label').getBoundingClientRect(), n = t.querySelector('.track-name'), nr = n.getBoundingClientRect(), tile = t.querySelector('.rail .tile'), r = tile ? tile.getBoundingClientRect() : null; return { id: t.dataset.train, text: n.textContent, nameRight: nr.right, labelRight: l.right, tileLeft: r ? r.left : null, sw: n.scrollWidth, cw: n.clientWidth }; })""")
            long_rows = [r for r in res if any(x in r['text'] for x in LONG)]
            check(f'{tag}: the long names are on the screen ({len(long_rows)})', len(long_rows) == 3)
            check(f'{tag}: no name reaches the first domino: ' + str([(r['nameRight'], r['tileLeft']) for r in long_rows]), all(r['tileLeft'] is None or r['nameRight'] <= r['tileLeft'] + 0.5 for r in res))
            check(f'{tag}: nothing wider than its box (scrollWidth {[ (r["sw"], r["cw"]) for r in long_rows]})', all(r['sw'] <= r['cw'] + 1 for r in res))
            check(f'{tag}: no sideways scroll', pg.evaluate("() => document.documentElement.scrollWidth") <= w)
            check(f'{tag}: no page errors', not errs)
            if w == 390 and view == 'compact':
                pg.screenshot(path='/tmp/long_names.png')
                bg = pg.evaluate("() => { const cs = getComputedStyle(document.querySelector('.log')); return [cs.backgroundColor, cs.backgroundImage]; }")
                check(f'history has no background {bg}', bg[0] in ('rgba(0, 0, 0, 0)', 'transparent') and bg[1] == 'none')
                tray = pg.evaluate("() => getComputedStyle(document.querySelector('.tray')).backgroundImage")
                check(f'the tray background is half see-through {tray[:120]}', 'color(srgb' in tray or 'rgba' in tray)
                tile = pg.evaluate("() => { const t = document.querySelector('.hand .tile-btn:not(.idle):not(.dim)') || document.querySelector('.hand .tile-btn'); let o = 1; for (let e = t; e && e !== document.body; e = e.parentElement) { o *= +getComputedStyle(e).opacity; } return o; }")
                check(f'the tiles stay solid (opacity {tile})', tile >= 0.35)
            pg.close()
finally:
    srv.terminate()
print('browser names2:', ok, 'passed,', bad, 'failed')
raise SystemExit(1 if bad else 0)
