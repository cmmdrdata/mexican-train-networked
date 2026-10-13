#!/usr/bin/env python3
"""Real Chromium, measured on pixels and computed styles: (1) the back of a domino is the same off-white as the face of a blank tile (#f6f0e0), with nothing on it (in a train, in the opponent's row, and the
   boneyard's stack); (2) the end-of-round dialog: its tiles (that same off-white) on the deep felt green, in both themes, with the writing readable; (3) the computer's train
   going down as well as up, one tile at a time, while it builds."""
import json, os, subprocess, sys, time
import cv2, numpy as np
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
def lin(v): v = v / 255.0; return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
def lum(rgb): return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
def contrast(a, b): x, y = lum(a), lum(b); return (max(x, y) + 0.05) / (min(x, y) + 0.05)
def parse(css): return [int(float(x)) for x in css[css.index('(') + 1:css.index(')')].replace('/', ' ').replace(',', ' ').split()[:3]]
def shot(el):
    data = el.screenshot(); return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)[..., ::-1]
errors = []
CPU_LEN = "() => { const g = window.MexicanTrainApp.state.game; return g ? g.trains.cpu.tiles.length : -1; }"
OPEN = """() => { const S = window.MexicanTrainApp.state, m = S.modal; return null; }"""

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15')
    pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')

    print('1. the back of a domino')
    el = None
    for attempt in range(5):                                   # (about one deal in ten gives the computer no tile for the engine: it draws or passes and lays nothing face down. Try a fresh game.)
        t0 = time.time()
        while time.time() - t0 < 25 and not pg.query_selector('.track[data-train="cpu"] svg.tile.back'): time.sleep(0.2)
        el = pg.query_selector('.track[data-train="cpu"] svg.tile.back')
        if el: break
        pg.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'normal' })"); pg.wait_for_selector('.hand-grid')
    ok(el is not None, 'the computer is building and its tiles are face down')
    if el:
        pg.screenshot(path=f'{SHOTS}/white_backs_board.png')
        img = shot(el); h, w = img.shape[:2]
        inner = img[int(h * 0.15):int(h * 0.85), int(w * 0.1):int(w * 0.9)]
        bone_px = (np.abs(inner.astype(int) - np.array([246, 240, 224])) <= 3).all(axis=2)
        bonefrac = float(bone_px.mean())
        ok(bonefrac >= 0.995 and int(inner.max()) < 253, f'a face-down tile in a train: {bonefrac * 100:.1f}% of its face is exactly the off-white of a blank tile (246, 240, 224), with no line and no dot anywhere on it, and no pure white (brightest pixel {int(inner.max())})')
        ok(pg.evaluate("() => { const r = document.querySelector('.track[data-train=\"cpu\"] svg.tile.back'); return r.querySelectorAll('*').length === 1 && r.querySelector('rect').getAttribute('fill') === '#f6f0e0'; }"), 'and its drawing is one rectangle of that colour, nothing else')
    back = pg.query_selector('.backs .back')
    if back:
        st = pg.evaluate("() => { const c = getComputedStyle(document.querySelector('.backs .back')); return [c.backgroundColor, c.borderTopWidth, c.backgroundImage]; }")
        img = shot(back); mid = img[img.shape[0] // 2, img.shape[1] // 2]
        ok(st[0] == 'rgb(246, 240, 224)' and st[1] == '0px' and st[2] == 'none' and all(abs(int(a) - b) <= 3 for a, b in zip(mid, (246, 240, 224))), f'the small backs in the opponent\'s row: the off-white of a blank tile, no border, no gradient (centre pixel {mid.tolist()})')
    stack = pg.query_selector('.boneyard .stack i')
    if stack:
        st = pg.evaluate("() => { const c = getComputedStyle(document.querySelector('.boneyard .stack i')); return [c.backgroundColor, c.borderTopWidth, c.backgroundImage]; }")
        ok(st[0] == 'rgb(246, 240, 224)' and st[1] == '0px' and st[2] == 'none', 'the boneyard\'s stack: the off-white of a blank tile, no border')
    pg.screenshot(path=f'{SHOTS}/white_backs_header.png', clip={'x': 0, 'y': 120, 'width': 1100, 'height': 120})
    ctx.close()

    print('2. the end-of-round dialog')
    for theme in ('classic', 'lotr'):
        ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(base); pg.wait_for_selector('#opt-theme'); pg.select_option('#opt-theme', theme)
        pg.evaluate("""() => {
          const app = window.MexicanTrainApp, S = app.state; S.overlay = null; S.game = null; S.opts.cpus = 1;
          S.modal = { type: 'roundEnd', blocked: false, tie: false, winnerId: 'cpu', last: false, totals: { human: 53, cpu: 70 },
            rows: [{ id: 'human', name: 'You', hand: [[3, 4], [6, 6], [0, 9], [12, 11], [5, 8]], pips: 33 }, { id: 'cpu', name: 'Computer', hand: [], pips: 0 }] };
          S.awaiting = { kind: 'modal', resolve() {} }; app.render(true); }""")
        pg.wait_for_selector('.dialog.roundend'); time.sleep(0.3)
        cs = pg.evaluate("""() => { const d = document.querySelector('.dialog.roundend'), g = e => getComputedStyle(e);
          return { bg: g(d).backgroundColor, title: g(d.querySelector('h2')).color, who: g(d.querySelector('.who')).color, muted: g(d.querySelector('.pts span')).color, btn: g(d.querySelector('.btn.primary')).color, btnbg: g(d.querySelector('.btn.primary')).backgroundColor,
                   faces: Array.from(d.querySelectorAll('.mini svg.tile')).map(s => s.querySelector('rect').getAttribute('fill')) }; }""")
        bg = parse(cs['bg'])
        ok(bg == [22, 74, 66], f'{theme}: the dialog\'s background is the deep felt green of the game\'s palette: rgb{tuple(bg)}')
        ok(cs['faces'] == ['#f6f0e0'] * 5, f"{theme}: all {len(cs['faces'])} tiles in it have the off-white face of a blank tile")
        for name in ('title', 'who', 'muted'):
            ratio = contrast(parse(cs[name]), bg)
            ok(ratio >= (7 if name != 'muted' else 4.5), f'{theme}: {name} text against the background {ratio:.1f}:1')
        ok(contrast(parse(cs['btn']), parse(cs['btnbg'])) >= 4.5, f"{theme}: the button's own writing is as readable as before ({contrast(parse(cs['btn']), parse(cs['btnbg'])):.1f}:1)")
        d = pg.query_selector('.dialog.roundend'); dimg = shot(d)
        corner = dimg[24, 24]
        ok(all(abs(int(a) - b) <= 3 for a, b in zip(corner, bg)), f'{theme}: on the screen, the dialog\'s background pixel is {corner.tolist()}')
        tile = shot(pg.query_selector('.mini svg.tile')); th, tw = tile.shape[:2]
        face = tile[int(th * 0.12):int(th * 0.88), int(tw * 0.04):int(tw * 0.96)]
        whitefrac = float((np.abs(face.astype(int) - np.array([246, 240, 224])) <= 3).all(axis=2).mean())
        purewhite = float((face.min(axis=2) >= 253).mean())
        tile_contrast = contrast([246, 240, 224], bg)
        bone = ((np.abs(face[..., 0].astype(int) - 246) <= 3) & (np.abs(face[..., 1].astype(int) - 240) <= 3) & (np.abs(face[..., 2].astype(int) - 224) <= 3)).mean()
        ok(whitefrac >= 0.5 and purewhite == 0 and tile_contrast >= 7, f'{theme}: a tile in it, on the screen: {whitefrac * 100:.0f}% exactly the off-white of a blank tile (the rest its pips and its middle line), no pure white, and it stands out from the dialog at {tile_contrast:.1f}:1')
        pg.screenshot(path=f'{SHOTS}/roundend_{theme}.png')
        ctx.close()

    print('3. the computer changing its mind, live')
    saw = None
    for attempt in range(5):
        ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
        pg.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'startGame', rounds: 1, hand: 15, style: 'pips', level: 'easy' })"); pg.wait_for_selector('.hand-grid')
        series = []; seen_dom = []; t0 = time.time(); prev = -1
        while time.time() - t0 < 75:
            n = pg.evaluate(CPU_LEN)
            if n != prev:
                time.sleep(0.12)                                                      # (the page is drawn a moment after the state changes)
                n2 = pg.evaluate(CPU_LEN); dom = pg.evaluate("() => document.querySelectorAll('.track[data-train=\"cpu\"] svg.tile.back').length")       # (the face-down tiles: the track also holds the engine tile)
                if n2 == n: seen_dom.append((n, dom))
                series.append(n); prev = n
            fin = pg.evaluate("() => { const g = window.MexicanTrainApp.state.game; return !!g && g.opening.cpu.finished; }")
            if any(b < a for a, b in zip(series, series[1:])) and fin: break
            if fin and time.time() - t0 > 5: break
            # the person builds too, so that the opening can end
            pg.evaluate("""() => { const app = window.MexicanTrainApp, S = app.state, a = S.awaiting; if (a && a.kind === 'build') app.dispatch({ type: a.canDraw ? 'draw' : a.canBuild ? 'autoBuild' : a.canDone ? 'endBuild' : 'undoTile' }); }""")
            time.sleep(0.04)
        down = any(b < a for a, b in zip(series, series[1:]))
        ctx.close()
        if down: saw = (series, seen_dom); break
    ok(saw is not None, 'the computer\'s train was seen getting SHORTER while it built (' + (str(saw[0]) if saw else 'in none of 5 games') + ')')
    if saw:
        series, seen_dom = saw
        steps = [abs(b - a) for a, b in zip(series, series[1:])]
        ok(all(s == 1 for s in steps), f'always by one tile at a time: {series}')
        ok(all(n == dom or n == dom + 0 for n, dom in seen_dom if n >= 0), 'and what is drawn matches: the face-down tiles on screen are as many as it has laid')
        ok(series[-1] >= 1, f'and it finally finishes with a train of {series[-1]}')
    ok(not errors, 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
