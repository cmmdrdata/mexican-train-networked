"""Whose turn it is ("tunnel vision"): the row of that player is lit, the others dim, and the light slides from row to row."""
import json, os, subprocess
from playwright.sync_api import sync_playwright
os.makedirs('/tmp/shots', exist_ok=True)
ROOT = os.path.dirname(os.path.abspath(__file__))
srv = subprocess.Popen(['node', os.path.join(ROOT, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
ok = bad = 0
def check(name, cond):
    global ok, bad
    if cond: ok += 1
    else: bad += 1; print('FAIL', name)
WHERE = "() => [...document.querySelectorAll('.spot')].map(e => e.closest('.track').dataset.train)"
def setturn(pg, t): pg.evaluate("t => { const A = window.MexicanTrainApp; A.state.game.turn = t; A.render(true); }", t)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for w, h, reduced, view in ((1100, 900, 'no-preference', 'roomy'), (390, 780, 'no-preference', 'compact'), (390, 780, 'reduce', 'compact')):
            ctx = b.new_context(viewport={'width': w, 'height': h}, reduced_motion=reduced); pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            tag = f'{w}px {view} {reduced}'
            pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-cpus', '2'); pg.select_option('#opt-view', view)
            pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid'); pg.wait_for_timeout(300)
            check(f'{tag}: no spotlight while everyone builds', pg.evaluate(WHERE) == [])
            setturn(pg, 'human')
            check(f'{tag}: on your own name when it is your turn', pg.evaluate(WHERE) == ['human'])
            pg.wait_for_timeout(600)
            check(f'{tag}: the light is behind the name and the tiles', pg.evaluate("() => { const s = document.querySelector('.spot'), l = s.parentElement.querySelector('.track-label'); return +getComputedStyle(l).zIndex > +getComputedStyle(s).zIndex && getComputedStyle(s).pointerEvents === 'none'; }"))
            check(f'{tag}: the light covers the whole row, and nothing around it has a border', pg.evaluate("() => { const s = document.querySelector('.spot'), r = s.parentElement.getBoundingClientRect(), q = s.getBoundingClientRect(); const cs = getComputedStyle(s); return Math.abs(q.width - r.width) < 1 && Math.abs(q.height - r.height) < 2 && cs.borderTopWidth === '0px' && getComputedStyle(s.parentElement).outlineStyle === 'none'; }"))
            check(f'{tag}: the other rows are dimmed (and the lit one is not)', pg.evaluate("() => { const rows = [...document.querySelectorAll('.track')]; const lit = rows.filter(r => r.classList.contains('turn')); return lit.length === 1 && +getComputedStyle(lit[0]).opacity === 1 && rows.filter(r => r !== lit[0] && +getComputedStyle(r.querySelector('.track-label')).opacity < 0.6).length >= rows.length - 2 && rows.every(r => +getComputedStyle(r).opacity === 1 && getComputedStyle(r).filter === 'none' && getComputedStyle(r.querySelector('.rail')).filter === 'none' && +getComputedStyle(r.querySelector('.rail')).opacity === 1); }") if reduced else pg.evaluate("() => { const rows = [...document.querySelectorAll('.track')]; const lit = rows.filter(r => r.classList.contains('turn')); return lit.length === 1 && +getComputedStyle(lit[0]).opacity === 1 && rows.filter(r => r !== lit[0] && +getComputedStyle(r.querySelector('.track-label')).opacity < 0.6).length >= rows.length - 2 && rows.every(r => +getComputedStyle(r).opacity === 1 && getComputedStyle(r).filter === 'none' && getComputedStyle(r.querySelector('.rail')).filter === 'none' && +getComputedStyle(r.querySelector('.rail')).opacity === 1); }"))
            setturn(pg, 'cpu')
            n = pg.evaluate("() => document.querySelector('.spot').getAnimations().length")
            pg.wait_for_timeout(600)
            check(f'{tag}: moves to the first computer', pg.evaluate(WHERE) == ['cpu'])
            check(f'{tag}: and slides there ({n} animation)', (n == 0) if reduced == 'reduce' else n >= 1)
            setturn(pg, 'cpu2'); check(f'{tag}: then the second computer', pg.evaluate(WHERE) == ['cpu2'])
            pg.wait_for_timeout(800); setturn(pg, 'cpu2'); check(f'{tag}: no new slide when it is the same player', pg.evaluate("() => document.querySelector('.spot').getAnimations().length") == 0)
            setturn(pg, 'human')
            check(f'{tag}: a row you can play on is never dimmed', pg.evaluate("() => { const r = document.querySelector('.track[data-train=mexican]'); r.classList.add('target'); return +getComputedStyle(r.querySelector('.track-label')).opacity === 1; }"))
            if reduced != 'reduce':
                setturn(pg, 'cpu'); pg.wait_for_timeout(700); setturn(pg, None); setturn(pg, 'cpu2')
                check(f'{tag}: after a gap with nobody lit, the light still sweeps in from the last row (no jump)', pg.evaluate("() => document.querySelector('.spot').getAnimations().length") >= 1)
            if reduced != 'reduce':
                setturn(pg, 'human'); pg.wait_for_timeout(800)
                top = pg.evaluate("() => { const r = [...document.querySelectorAll('.track:not([data-train=mexican])')].map(e => [e.dataset.train, e.getBoundingClientRect().top]).sort((a, b) => a[1] - b[1]); return r[0][0]; }")
                y0 = pg.evaluate("() => document.querySelector('.spot').getBoundingClientRect().top")
                setturn(pg, top); pg.wait_for_timeout(150); pg.evaluate("() => window.MexicanTrainApp.render(true)"); pg.evaluate("() => window.MexicanTrainApp.render(true)")
                y1 = pg.evaluate("() => document.querySelector('.spot').getBoundingClientRect().top"); pg.wait_for_timeout(1000)
                y2 = pg.evaluate("() => document.querySelector('.spot').getBoundingClientRect().top")
                check(f'{tag}: bottom to top, and redrawn twice on the way: the light is still part-way (not jumped to the end): {y0:.0f} {y1:.0f} {y2:.0f}', y2 < y1 - 3 and y1 < y0 - 3 and y1 > y2 - 1 + 0 and top != 'human')
            setturn(pg, None); check(f'{tag}: nobody: no light, nothing dimmed', pg.evaluate(WHERE) == [] and pg.evaluate("() => [...document.querySelectorAll('.track')].every(r => +getComputedStyle(r.querySelector('.track-label')).opacity === 1)"))
            if w == 390 and reduced != 'reduce': setturn(pg, 'cpu'); pg.wait_for_timeout(600); pg.screenshot(path='/tmp/shots/spot_phone.png')
            check(f'{tag}: no page errors', not errs); ctx.close()
        # a real game: the light is on somebody once the turns begin, and it is always on exactly one name
        pg = b.new_page(viewport={'width': 1100, 'height': 900}); pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-cpus', '1')
        pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
        pg.wait_for_selector('[data-action="autoBuild"]', timeout=30000); pg.click('[data-action="autoBuild"]')
        try: pg.wait_for_function("() => window.MexicanTrainApp.state.game && window.MexicanTrainApp.state.game.turn", timeout=60000)
        except Exception: pass
        check('a real game: the turns begin and the light is on', pg.evaluate("() => !!window.MexicanTrainApp.state.game.turn") and len(pg.evaluate(WHERE)) == 1)
        counts = set()
        for _ in range(40):
            pg.wait_for_timeout(250); counts.add(len(pg.evaluate(WHERE)))
        check(f'a real game: never more than one light {counts}', counts <= {0, 1})
finally:
    srv.terminate()
print('browser spot:', ok, 'passed,', bad, 'failed')
raise SystemExit(1 if bad else 0)
