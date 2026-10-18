#!/usr/bin/env python3
"""Real Chromium: the two wizarding boards (the candlelit hall and the moonlit forest) must not make the board harder to read. MEASURED on the drawn pixels at three screen sizes:
   no pixel brighter than the classic board's brightest point, text that sits on the board at least as readable as on the classic board (and never below 3:1),
   the bone tiles stand out, the picture is really there, a game picks one of the two boards, and the guardian-animal markers are drawn."""
import json, os, re, subprocess, sys, time
import cv2, numpy as np
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = '/tmp/shots'; os.makedirs(SHOTS, exist_ok=True)
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)

srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True)
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"

def lin(v):
    v = v / 255.0
    return np.where(v <= 0.03928, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)
def lum_rgb(r, g, b): return 0.2126 * lin(np.array(r, float)) + 0.7152 * lin(np.array(g, float)) + 0.0722 * lin(np.array(b, float))
def contrast(l1, l2): hi, lo = max(l1, l2), min(l1, l2); return (hi + 0.05) / (lo + 0.05)

TEXTS = """() => {
  const table = document.querySelector('.table'), out = {};
  const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
  const alphaOf = c => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return 0; const p = m[1].split(',').map(s => parseFloat(s)); return p.length === 4 ? p[3] : 1; };
  let n;
  while ((n = walker.nextNode())) {
    const t = n.textContent.trim(); if (!t) continue;
    const el = n.parentElement, cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let own = false, op = 1, p = el;                                   // does it sit on a background of its own (the wooden hand, a bubble, a brass button)? and is it faded?
    while (p && p !== table) { const b = getComputedStyle(p); op *= parseFloat(b.opacity); if (alphaOf(b.backgroundColor) > 0.4 || (b.backgroundImage && b.backgroundImage !== 'none')) own = true; p = p.parentElement; }
    if (own) continue;
    const m = cs.color.match(/rgba?\\(([^)]+)\\)/)[1].split(',').map(s => parseFloat(s));
    const key = cs.color + '|' + cs.fontSize + '|' + cs.fontWeight + '|' + op;
    out[key] = out[key] || { rgb: m.slice(0, 3), a: (m.length === 4 ? m[3] : 1) * op, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight) || 400, sample: t.slice(0, 28), n: 0 };
    out[key].n++;
  }
  return Object.values(out);
}"""
HIDE = "() => { const s = document.createElement('style'); s.id = 'measure'; s.textContent = '.table > *, .shell > :not(.table), body > :not(#app) { visibility: hidden !important; }'; document.head.appendChild(s); }"
SHOW = "() => { const s = document.getElementById('measure'); if (s) s.remove(); }"

def shot(pg, path):
    """Photograph the board; the game may redraw it a moment before (the computer is still building its train), so try again."""
    for attempt in range(8):
        try:
            pg.locator('.table').screenshot(path=path, timeout=4000); return
        except Exception:
            time.sleep(0.4)
    raise RuntimeError('could not photograph the board')


def measure(browser, theme, w, h, name, board=None):
    ctx = browser.new_context(viewport={'width': w, 'height': h}); pg = ctx.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base); pg.select_option('#opt-theme', theme); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15')
    pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid'); time.sleep(2.0)
    picked = pg.evaluate("() => document.querySelector('.table').className")
    if board:
        pg.evaluate("c => { const t = document.querySelector('.table'); t.classList.remove('bk-hall', 'bk-forest'); t.classList.add(c); }", 'bk-' + board)
    texts = pg.evaluate(TEXTS)
    bone = pg.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--bone').trim()")
    bgimg = pg.evaluate("() => getComputedStyle(document.querySelector('.table')).backgroundImage")
    cls = pg.evaluate("() => document.querySelector('.table').className")
    pg.screenshot(path=f'{SHOTS}/wiz_{name}_{board or theme}.png')
    pg.evaluate(HIDE); time.sleep(0.2)
    path = f'{SHOTS}/wiz_{name}_{board or theme}_bg.png'; shot(pg, path)
    img = cv2.imread(path)[..., ::-1][3:-3]
    L = lum_rgb(img[..., 0], img[..., 1], img[..., 2])
    y, x = np.unravel_index(np.argmax(L), L.shape)
    res = dict(max=float(L.max()), p999=float(np.percentile(L, 99.9)), brightest=img[y, x].astype(float), texts=texts, bone=bone, bgimg=bgimg, cls=cls, picked=picked, errors=errors,
               spread=float(L.std()))
    ctx.close()
    return res

def worst(res, maxL=None):
    maxL = res['max'] if maxL is None else maxL
    lo = (1e9, None)
    for t in res['texts']:
        bg = res['brightest']; a = t['a']
        c = np.array(t['rgb'], float) * a + bg * (1 - a)
        cr = contrast(float(lum_rgb(*c)), maxL)
        if cr < lo[0]: lo = (cr, (round(cr, 2), t['sample'], t['size']))
    return lo

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for (w, h, name) in ((1100, 950, 'desktop'), (820, 1100, 'tablet'), (390, 800, 'phone')):
        print(f'{name} {w}x{h}')
        c = measure(browser, 'classic', w, h, name)
        ok(not c['errors'], f'{name}: no JavaScript errors on the classic board')
        for board in ('hall', 'forest'):
            l = measure(browser, 'wizard', w, h, name, board)
            wl, wsame = worst(l), worst(l, maxL=c['max'])
            print(f"  {board}: brightest pixel {l['max']:.4f} (classic {c['max']:.4f}); worst text {wl[1][0]}:1 here, {wsame[1][0]}:1 on classic")
            ok(not l['errors'], f'{name} {board}: no JavaScript errors')
            ok('art-wizard' in l['cls'] and f'bk-{board}' in l['cls'] and len(re.findall(r'url\("data:image/svg', l['bgimg'])) == 1, f'{name} {board}: the board carries its picture')
            ok('art-wizard' in l['picked'] and re.search(r'bk-(hall|forest)', l['picked']), f"{name}: a new wizard game picks one of the two boards ({l['picked']})")
            ok(l['max'] <= c['max'] + 0.001, f"{name} {board}: no pixel brighter than the classic board's brightest point ({l['max']:.4f} against {c['max']:.4f})")
            ok(l['p999'] <= c['max'], f'{name} {board}: and 99.9% of the pixels are darker than that')
            ok(wl[1][0] >= 3.0, f'{name} {board}: no text on the board is below 3:1 against the brightest background pixel (the worst: {wl[1]})')
            ok(wl[0] >= wsame[0] - 1e-6, f'{name} {board}: the same texts are at least as readable as on the classic board ({wl[0]:.2f}:1 against {wsame[0]:.2f}:1)')
            bone = [int(l['bone'][i:i + 2], 16) for i in (1, 3, 5)]
            ok(contrast(float(lum_rgb(*bone)), l['max']) >= 6, f'{name} {board}: the bone tiles stand out from the background')
            ok(l['spread'] >= 0.003, f"{name} {board}: the picture is really there (luminance spread {l['spread']:.4f})")

    print('the guardian-animal markers, in a real game')
    ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page()
    pg.goto(base); pg.select_option('#opt-theme', 'wizard'); pg.select_option('#opt-rounds', '1'); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid'); time.sleep(1.0)
    svg = pg.evaluate("() => window.MexicanTrainGame.patronusSVG('stag', 0)")
    pg.evaluate("s => document.querySelector('.rail').insertAdjacentHTML('afterbegin', s)", svg)
    box = pg.evaluate("() => { const e = document.querySelector('.toy-train.patronus svg'); const r = e.getBoundingClientRect(); return [r.width, r.height, getComputedStyle(e).filter]; }")
    ok(box[0] > 20 and box[1] > 14 and 'drop-shadow' in box[2], f'a marker is drawn at a visible size with its glow ({box[0]:.0f}x{box[1]:.0f})')
    ratio = pg.evaluate("() => { const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')); return document.querySelector('.toy-train.patronus svg').getBoundingClientRect().width / (s * 1.3); }")
    ok(1.45 <= ratio <= 1.55, f'and it is 50% larger than the toy train or the ring would be (x{ratio:.2f})')
    ctx.close()

    print('someone who asks for more contrast')
    ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page()
    try:
        pg.emulate_media(contrast='more'); supported = True
    except Exception:
        supported = False; print('  (this Chromium cannot emulate prefers-contrast; test_art.js and test_wizard.js check the stylesheet rule)')
    if supported:
        pg.goto(base); pg.select_option('#opt-theme', 'wizard'); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid'); time.sleep(0.8)
        ok('url(' not in pg.evaluate("() => getComputedStyle(document.querySelector('.table')).backgroundImage"), 'the plain board, without the picture')
    ctx.close(); browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed'); sys.exit(1 if failed else 0)
