"""Layout setting: Auto/Roomy/Compact/Tiny. Compact and Tiny fit a 390x780 phone without scrolling."""
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
def start(pg, cpus, view=None):
    pg.goto(base); pg.wait_for_selector('#opt-rounds')
    pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15'); pg.select_option('#opt-cpus', str(cpus))
    if view: pg.select_option('#opt-view', view)
    pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
def metrics(pg):
    return pg.evaluate("() => ({h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, shell: document.querySelector('.shell').className})")
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for cpus in (1, 3):
            pg = b.new_page(viewport={'width': 390, 'height': 780})
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            start(pg, cpus)                                    # Auto on a phone = Compact
            m = metrics(pg); check(f'auto is compact ({cpus})', 'v-compact' in m['shell'])
            check(f'compact no sideways scroll ({cpus})', m['w'] <= 390)
            check(f'compact shorter than roomy ({cpus}) h={m["h"]}', m['h'] < 1310)
            pg.click('.menu-btn'); check('menu opens', pg.locator('.menu').count() == 1)
            check('menu has view buttons', pg.locator('.menu [data-action="setView"]').count() == 4)
            pg.keyboard.press('Escape'); check('escape closes menu', pg.locator('.menu').count() == 0)
            pg.click('.menu-btn'); pg.click('.menu [data-key="tiny"]')
            m2 = metrics(pg); check('tiny applied', 'v-tiny' in m2['shell']); check(f'tiny shorter than compact ({cpus}) {m2["h"]}<{m["h"]}', m2['h'] <= m['h'])
            print('heights', cpus, m['h'], m2['h']); check(f'tiny fits one screen ({cpus}) h={m2["h"]}', m2['h'] <= 780)
            check('menu closed after choosing', pg.locator('.menu').count() == 0)
            check('saved', json.loads(pg.evaluate("() => localStorage.getItem('mt-opts')"))['view'] == 'tiny')
            pg.click('.menu-btn'); pg.click('.menu [data-key="roomy"]')
            check('roomy back', 'v-roomy' in metrics(pg)['shell'] and pg.locator('.log').count() >= 1)
            pg.click('.tools [data-action="toggleSound"]'); check('roomy keeps header buttons', True)
            pg.click('.tools [data-action="newGame"]') if pg.locator('.tools [data-action="newGame"]').count() else None
            check(f'no page errors ({cpus})', not errs)
            pg.close()
        pg = b.new_page(viewport={'width': 1000, 'height': 800}); start(pg, 1)
        check('auto is roomy on a wide screen', 'v-roomy' in metrics(pg)['shell'])
        pg.set_viewport_size({'width': 390, 'height': 780}); time.sleep(0.4)
        check('auto turns compact when narrowed', 'v-compact' in metrics(pg)['shell'])
        pg.click('.menu-btn'); pg.click('.menu [data-action="openMoves"]')
        check('history screen opens', pg.locator('#dlg-title').inner_text() == 'Game history')
        # menu text is readable (dark on light or light on dark, never light on light)
        def lum(c):
            import re
            r, g, bl = [int(x) for x in re.findall(r'\d+', c)[:3]]
            f = lambda v: (v/255/12.92) if v/255 <= .03928 else (((v/255)+.055)/1.055)**2.4
            return .2126*f(r)+.7152*f(g)+.0722*f(bl)
        for view in ('compact', 'roomy'):
            pg2 = b.new_page(viewport={'width': 390 if view == 'compact' else 1100, 'height': 800}); start(pg2, 3, view)
            pg2.click('.menu-btn')
            fg, bg = pg2.evaluate("() => { const e = document.querySelector('.menu .btn'); return [getComputedStyle(e).color, getComputedStyle(document.querySelector('.menu')).backgroundColor]; }")
            l1, l2 = sorted([lum(fg), lum(bg)], reverse=True)
            check(f'{view}: menu text readable (contrast {(l1+.05)/(l2+.05):.1f})', (l1+.05)/(l2+.05) >= 4.5)
            check(f'{view}: menu offers layout and history', pg2.locator('.menu [data-action="setView"]').count() == 4 and pg2.locator('.menu [data-action="openMoves"]').count() == 1)
            # a computer's comment does not move the board
            pg2.keyboard.press('Escape')
            top = lambda: pg2.evaluate("() => document.querySelector('.tracks').getBoundingClientRect().top")
            h0 = top()
            pg2.evaluate("() => { const a = window.MexicanTrainApp; a.state.comment = { id: 999, kind: 'chat', text: 'Well, that was a long and rather chatty remark about your last move, friend.', from: 'Zed' }; a.dispatch({ type: 'setView', key: a.state.opts.view }); }")
            pg2.wait_for_timeout(100)
            check(f'{view}: a comment shows ({pg2.locator(".bubble").count()})', pg2.locator('.bubble').count() >= 1)
            check(f'{view}: the board does not move when a comment appears ({h0} -> {top()})', abs(top() - h0) < 1)
            pg2.close()
        # the menu stays inside the window even when its button is at the left edge
        for w in (1100, 390):
            pg3 = b.new_page(viewport={'width': w, 'height': 800}); start(pg3, 1, 'roomy')
            pg3.add_style_tag(content='.menu-wrap { position: absolute !important; left: 4px; top: 10px; }')
            pg3.click('.menu-btn')
            r = pg3.evaluate("() => { const r = document.querySelector('.menu').getBoundingClientRect(); return [r.left, r.right]; }")
            check(f'menu inside the window with its button at the left edge ({w}px: {r})', r[0] >= 0 and r[1] <= w)
            pg3.close()
        # a long train keeps its room for two more tiles after the layout changes
        STEP = """() => { const app = window.MexicanTrainApp, S = app.state, a = S.awaiting; if (!a) return;
          if (a.kind==='modal') return; if (a.kind==='draw') app.dispatch({type:'draw'});
          else if (a.kind==='build') { if (a.canDraw) app.dispatch({type:'draw'}); else if (a.canBuild) app.dispatch({type:'autoBuild'}); else if (a.canDone) app.dispatch({type:'endBuild'}); else app.dispatch({type:'undoTile'}); }
          else { const m = a.moves[0]; app.dispatch({type:'selectTile', key: m.tile[0]+'-'+m.tile[1]}); if (S.awaiting===a) app.dispatch({type:'playOn', train:m.trainId}); } }"""
        ROOM = "() => { const sc = [...document.querySelectorAll('.scroller')].pop(); const tl = [...sc.querySelectorAll('.tile')]; const s = parseFloat(getComputedStyle(tl[0]).height); return [Math.round(sc.getBoundingClientRect().right - tl[tl.length-1].getBoundingClientRect().right), s, tl.length]; }"
        pg4 = b.new_page(viewport={'width': 390, 'height': 780}); start(pg4, 1, 'roomy')
        for i in range(900):
            pg4.evaluate(STEP); pg4.wait_for_timeout(20)
            if pg4.evaluate("() => [...document.querySelectorAll('.track-tiles')].pop().querySelectorAll('.tile').length") >= 10: break
        for v in ('tiny', 'compact', 'roomy', 'tiny'):
            pg4.evaluate("(v) => window.MexicanTrainApp.dispatch({ type: 'setView', key: v })", v); pg4.wait_for_timeout(200)
            room, tile, n = pg4.evaluate(ROOM)
            check(f'{v}: the end of a long train ({n} tiles) leaves room for two more ({room}px, a tile is {tile}px)', room >= 1.9 * tile)
        # the computers' face-down tiles on the trains are the same size as every other tile there (only the ones in their hands are small)
        for view, size in (('compact', 27), ('tiny', 21), ('roomy', 27)):
            pg5 = b.new_page(viewport={'width': 390, 'height': 780}); start(pg5, 3, view); pg5.wait_for_timeout(9000)
            sizes = pg5.evaluate("() => [...document.querySelectorAll('.track .tile')].map(e => { const c = getComputedStyle(e); return Math.round(Math.min(parseFloat(c.width), parseFloat(c.height))); })")
            check(f'{view}: every tile on the trains is full size ({sorted(set(sizes))})', len(sizes) > 6 and all(abs(x - size) <= 1 for x in sizes))
            pg5.close()
        b.close()
finally:
    srv.terminate()
print(f'{ok} passed, {bad} failed'); sys.exit(1 if bad else 0)
