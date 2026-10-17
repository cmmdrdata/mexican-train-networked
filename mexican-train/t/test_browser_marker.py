"""The marker on a train: it drops in when put on, a copy lifts away when it comes off; nothing at the start of a round; none with reduced motion."""
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
POS = "() => [...document.querySelectorAll('.track[data-train=human] .tile')].map(e => Math.round(e.getBoundingClientRect().left))"
def setm(pg, v): pg.evaluate("v => { const A = window.MexicanTrainApp; A.state.game.trains.human.marker = v; A.render(true); }", v)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for w, h, reduced, theme in ((390, 780, 'no-preference', 'classic'), (1100, 900, 'no-preference', 'classic'), (390, 780, 'no-preference', 'lotr'), (390, 780, 'reduce', 'classic')):
            ctx = b.new_context(viewport={'width': w, 'height': h}, reduced_motion=reduced); pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            tag = f'{w}px {theme} {reduced}'
            pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15')
            if theme == 'lotr': pg.select_option('#opt-theme', 'lotr')
            pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
            pg.wait_for_timeout(300)
            base_pos = pg.evaluate(POS)
            setm(pg, True)
            moved = 0 if pg.evaluate(POS) == base_pos else 1
            n_in = pg.evaluate("() => document.querySelectorAll('.toy-train.toy-in').length")
            anim = pg.evaluate("() => { const e = document.querySelector('.toy-train.toy-in'); return e ? e.getAnimations().length : 0; }")
            if reduced == 'reduce':
                check(f'{tag}: no marker animation with reduced motion', n_in == 0)
            else:
                check(f'{tag}: the new marker drops in', n_in == 1 and anim >= 1)
                check(f'{tag}: the tiles do not move over for it', moved == 0)
                if w == 390 and theme == 'classic': pg.screenshot(path='/tmp/marker_in.png')
            setm(pg, True)
            check(f'{tag}: the marker lands on the leftmost domino', pg.evaluate("() => { const m = document.querySelector('.track[data-train=human] .toy-train'), t = document.querySelector('.track[data-train=human] .tile'); if (!m || !t) return false; const a = m.getBoundingClientRect(), b = t.getBoundingClientRect(); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }"))
            check(f'{tag}: a redraw with the marker already on does not animate it again', pg.evaluate("() => document.querySelectorAll('.toy-train.toy-in').length") == 0)
            setm(pg, False)
            fly = pg.evaluate("() => document.querySelectorAll('.marker-fly').length")
            if reduced == 'reduce': check(f'{tag}: nothing lifts away with reduced motion', fly == 0)
            else:
                check(f'{tag}: the removed marker lifts away as a copy', fly == 1)
                check(f'{tag}: the copy has the marker drawn', pg.evaluate("() => !!document.querySelector('.marker-fly .toy-train svg')"))
                check(f'{tag}: the tiles do not move when it comes off either', pg.evaluate(POS) == base_pos)
                pg.wait_for_timeout(900)
                check(f'{tag}: the copy is gone afterwards', pg.evaluate("() => document.querySelectorAll('.marker-fly').length") == 0)
            check(f'{tag}: no page errors', not errs)
            ctx.close()
        # a new round / game: markers that vanish do not animate
        pg = b.new_page(viewport={'width': 390, 'height': 780}); pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1')
        pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid'); pg.wait_for_timeout(300)
        setm(pg, True); pg.wait_for_timeout(100)
        pg.evaluate("() => { const A = window.MexicanTrainApp; A.state.roundIndex += 1; A.state.game.trains.human.marker = false; A.render(true); }")
        check('a different round: no lift-away', pg.evaluate("() => document.querySelectorAll('.marker-fly').length") == 0)
finally:
    srv.terminate()
print('browser marker:', ok, 'passed,', bad, 'failed')
raise SystemExit(1 if bad else 0)
