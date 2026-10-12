#!/usr/bin/env python3
"""Real Chromium: the Lord of the Rings board scenery must not make the board harder to read. It is MEASURED on the drawn pixels, at four screen sizes:
   everything on the board except its background is hidden and the background is photographed; then
     - no pixel may be brighter than the classic board's brightest point (so light text on it keeps at least the classic contrast),
     - every colour of text that sits directly on the board is checked against the BRIGHTEST background pixel (WCAG contrast: 4.5 for normal text, 3 for large),
       and the worst of them may not be worse than the worst in a classic game,
     - the bone tiles keep a strong contrast with it,
     - the scenery is really there (the background is not flat), only for the Lord of the Rings theme, and gone for someone who asks for more contrast."""
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

def measure(browser, theme, w, h, name):
    ctx = browser.new_context(viewport={'width': w, 'height': h}); pg = ctx.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base); pg.select_option('#opt-theme', theme); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15')
    pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid'); time.sleep(2.5)
    texts = pg.evaluate(TEXTS)
    bone = pg.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--bone').trim()")
    bgimg = pg.evaluate("() => getComputedStyle(document.querySelector('.table')).backgroundImage")
    cls = pg.evaluate("() => document.querySelector('.table').className")
    full = f'{SHOTS}/lotrbg_{name}_{theme}.png'; pg.screenshot(path=full)
    pg.evaluate(HIDE); time.sleep(0.2)
    path = f'{SHOTS}/lotrbg_{name}_{theme}_bg.png'; shot(pg, path)
    img = cv2.imread(path)[..., ::-1][3:-3]                                # RGB, without the table's own 1px border lines (the brightest pixels of ANY board)
    L = lum_rgb(img[..., 0], img[..., 1], img[..., 2])
    y, x = np.unravel_index(np.argmax(L), L.shape)
    H, W = L.shape
    # the same board with its scenery taken off (only the plain gradient): what is left when the two are subtracted is the scenery alone
    pg.add_style_tag(content='.table { background: radial-gradient(ellipse at 50% 30%, ' + ('#1e4d3f 0%, #13332b 100%' if theme == 'lotr' else 'var(--felt) 0%, var(--felt-deep) 100%') + ') !important; }'); time.sleep(0.2)
    shot(pg, f'{SHOTS}/lotrbg_{name}_{theme}_plain.png')
    plain = cv2.imread(f'{SHOTS}/lotrbg_{name}_{theme}_plain.png')[..., ::-1][3:-3]
    D = L - lum_rgb(plain[..., 0], plain[..., 1], plain[..., 2])
    band = lambda a, b: np.abs(D[int(H * a):int(H * b)])
    cy0, cy1, cx0, cx1 = int(H * .30), int(H * .70), int(W * .25), int(W * .75)
    res = dict(L=L, max=float(L.max()), p999=float(np.percentile(L, 99.9)), brightest=img[y, x].astype(float), texts=texts, bone=bone, bgimg=bgimg, cls=cls, errors=errors, size=L.shape,
               top=float(band(.03, .35).mean()), bottom=float(band(.88, 1.0).mean()), ring=float((np.abs(D[cy0:cy1, cx0:cx1]) > 0.002).mean()), brighter=float(D.max()), darker=float(-D.min()))
    ctx.close()
    return res

def worst(res, maxL=None, texts=None):
    """the lowest contrast of any of these texts against the BRIGHTEST pixel of this background (or of another one, maxL)"""
    maxL = res['max'] if maxL is None else maxL
    lo = (1e9, None)
    for t in (res['texts'] if texts is None else texts):
        bg = res['brightest']; a = t['a']
        c = np.array(t['rgb'], float) * a + bg * (1 - a)
        cr = contrast(float(lum_rgb(*c)), maxL)
        if cr < lo[0]: lo = (cr, (round(cr, 2), t['sample'], t['size']))
    return lo

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for (w, h, name) in ((1100, 950, 'desktop'), (1600, 1000, 'wide'), (820, 1100, 'tablet'), (390, 800, 'phone')):
        print(f'{name} {w}x{h}')
        c = measure(browser, 'classic', w, h, name); l = measure(browser, 'lotr', w, h, name)
        wl, wsame = worst(l), worst(l, maxL=c['max'])                       # the SAME texts against the scenery board and against the classic board
        print(f"  brightest background pixel (luminance): scenery {l['max']:.4f}, classic {c['max']:.4f} | worst text contrast ({len(l['texts'])} colours of text): on the scenery {wl[1][0]}:1, on the classic board {wsame[1][0]}:1 | scenery changes: top {l['top']:.4f}, bottom {l['bottom']:.4f}, brighter by at most {l['brighter']:.4f}, darker by up to {l['darker']:.4f}")
        ok(not c['errors'] and not l['errors'], f'{name}: no JavaScript errors')
        ok('art-lotr' in l['cls'] and len(re.findall(r'url\("data:image/svg', l['bgimg'])) == 3, f'{name}: the Lord of the Rings board has its three pictures')
        ok('art-lotr' not in c['cls'] and 'url(' not in c['bgimg'], f'{name}: the classic board has none')
        ok(l['max'] <= c['max'] + 0.001, f"{name}: no pixel of the scenery is brighter than the classic board's brightest point (L {l['max']:.4f} against {c['max']:.4f})")
        ok(l['p999'] <= c['max'], f"{name}: and 99.9% of its pixels are darker than that")
        ok(l['brighter'] <= 0.03, f"{name}: the scenery never makes the board brighter than its plain gradient by more than 0.03 (the most: {l['brighter']:.4f}; it makes it darker by up to {l['darker']:.4f})")
        ok(wl[1] is not None and wl[1][0] >= 3.0, f"{name}: no text on the board is below 3:1 against the BRIGHTEST background pixel (the worst: {wl[1]})")
        ok(wl[0] >= wsame[0] - 1e-6, f"{name}: and the same texts are at least as easy to read against the scenery as against the classic board ({wl[0]:.2f}:1 against {wsame[0]:.2f}:1)")
        bone = [int(l['bone'][i:i + 2], 16) for i in (1, 3, 5)]
        cb, cbc = contrast(float(lum_rgb(*bone)), l['max']), contrast(float(lum_rgb(*bone)), c['max'])
        ok(cb >= 6 and cb >= cbc - 0.05, f"{name}: the bone tiles stand out from the background (contrast {cb:.1f}:1, classic {cbc:.1f}:1)")
        ok(l['top'] >= 0.003, f"{name}: the mountains are really there (they change the top of the board by {l['top']:.4f} in luminance on average; the plain board: {c['top']:.4f})")
        ok(l['bottom'] >= 0.003, f"{name}: and so are the hills and trees along the bottom ({l['bottom']:.4f})")
        ok(l['ring'] >= 0.001, f"{name}: and the ring in the middle ({l['ring'] * 100:.2f}% of the middle of the board is changed by it)")
        ok(c['top'] < 0.0005 and c['bottom'] < 0.0005, f"{name}: (the classic board, measured the same way, has no scenery: {c['top']:.5f}, {c['bottom']:.5f})")

    print('someone who asks for more contrast')
    ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page()
    try:
        pg.emulate_media(contrast='more'); supported = True
    except Exception as e:
        supported = False; print('  (this Chromium cannot emulate prefers-contrast; the stylesheet rule is checked in test_art.js instead)')
    if supported:
        pg.goto(base); pg.select_option('#opt-theme', 'lotr'); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid'); time.sleep(0.8)
        bg = pg.evaluate("() => getComputedStyle(document.querySelector('.table')).backgroundImage")
        ok('art-lotr' in pg.evaluate("() => document.querySelector('.table').className") and 'url(' not in bg, 'with more contrast asked for, the Lord of the Rings board has no pictures, only the plain gradient')
    ctx.close()
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
