#!/usr/bin/env python3
"""Real Chromium: the tab icon decodes, and at tab size (16 x 16, no smoothing tricks, device pixel ratio 1) it can still be told apart:
   the four pips are four separate dots, the bone tile and the felt both take a real share of the icon, they contrast strongly, and the icon is
   visible on a light tab strip and on a dark one."""
import json, os, subprocess, sys
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
def lum(img): return 0.2126 * lin(img[..., 0].astype(float)) + 0.7152 * lin(img[..., 1].astype(float)) + 0.0722 * lin(img[..., 2].astype(float))
def contrast(a, b): hi, lo = max(a, b), min(a, b); return (hi + 0.05) / (lo + 0.05)

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    pg = browser.new_page(viewport={'width': 900, 'height': 600}, device_scale_factor=1)
    errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base); pg.wait_for_selector('#app')

    print('1. the page offers the icons, and the browser can read them')
    icons = pg.evaluate("() => Array.from(document.querySelectorAll('link[rel~=icon], link[rel=apple-touch-icon]')).map(l => ({ rel: l.rel, type: l.type, sizes: l.sizes.value || l.getAttribute('sizes'), href: l.href }))")
    ok(len(icons) == 3 and [i['rel'] for i in icons] == ['icon', 'icon', 'apple-touch-icon'], f'three icon links: {[ (i["rel"], i["sizes"]) for i in icons ]}')
    ok(all(i['href'].startswith('data:image/') for i in icons), 'all inlined (nothing for the browser to fetch)')
    sizes = pg.evaluate("""async (hrefs) => Promise.all(hrefs.map(h => new Promise(res => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res(null); im.src = h; })))""", [i['href'] for i in icons])
    ok(all(sizes) and sizes[1] == [32, 32] and sizes[2] == [180, 180] and sizes[0][0] > 0, f'each decodes in Chromium: {sizes}')
    ok(pg.evaluate("() => document.title") == 'Mexican Train' and pg.evaluate("() => document.querySelector('meta[name=theme-color]').content") == '#0f3a33', 'the title is still "Mexican Train", with the page\'s colour for a phone\'s bar')
    themed = pg.evaluate("() => { const hs = Array.from(document.querySelectorAll('link[rel~=icon]')).map(l => l.href); return hs; }")
    pg.select_option('#opt-theme', 'lotr'); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
    same = pg.evaluate("() => Array.from(document.querySelectorAll('link[rel~=icon]')).map(l => l.href)")
    ok(same == themed, 'choosing the Lord of the Rings theme does not change the icon: it is the generic game\'s')
    svg_href = icons[0]['href']

    print('2. at tab size')
    TABS = {'light': (222, 225, 230), 'dark': (53, 54, 58)}                 # a typical light and a typical dark tab strip
    results = {}
    for size in (16, 32):
        for tab, rgb in TABS.items():
            p2 = browser.new_page(viewport={'width': size, 'height': size}, device_scale_factor=1)
            p2.set_content(f'<body style="margin:0;background:rgb{rgb}"><img src="{svg_href}" width="{size}" height="{size}" style="display:block"></body>')
            path = f'{SHOTS}/favicon_{size}_{tab}.png'; p2.screenshot(path=path); p2.close()
            results[(size, tab)] = cv2.imread(path)[..., ::-1]
    for size in (16, 32):
        img = results[(size, 'light')]; L = lum(img); H, W = L.shape
        bone = L > 0.6                                                      # the tile
        felt = (L > 0.04) & (L < 0.2) & (img[..., 1] > img[..., 0] + 15)      # the green of the felt
        ys, xs = np.where(bone)
        ok(bone.mean() >= 0.35, f'{size}px: the bone tile takes {bone.mean() * 100:.0f}% of the icon (at least 35%)')
        ok(felt.mean() >= 0.15, f'{size}px: and the felt {felt.mean() * 100:.0f}% (at least 15%), so both are there')
        ok(contrast(float(np.median(L[bone])), float(np.median(L[felt]))) >= 5, f'{size}px: tile against felt {contrast(float(np.median(L[bone])), float(np.median(L[felt]))):.1f}:1 (at least 5:1)')
        x0, x1, y0, y1 = xs.min() + 1, xs.max() - 1, ys.min() + 1, ys.max() - 1          # inside the tile
        inner = L[y0:y1 + 1, x0:x1 + 1]
        brass = (img[y0:y1 + 1, x0:x1 + 1, 0] > img[y0:y1 + 1, x0:x1 + 1, 2] + 40) & (inner < 0.6)
        cols = brass.mean(axis=0) > 0.5                                       # the columns the divider is in
        dark = (inner < 0.30) & ~brass
        dark[:, np.where(cols)[0]] = False
        n, labels, stats, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8), connectivity=8)
        ih, iw = dark.shape
        # a pip lies wholly inside the tile: a dark patch touching the tile's edge is the felt showing in a rounded corner
        blobs = [stats[i, cv2.CC_STAT_AREA] for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= (2 if size == 16 else 6)
                 and stats[i, cv2.CC_STAT_LEFT] > 0 and stats[i, cv2.CC_STAT_TOP] > 0 and stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] < iw and stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT] < ih]
        ok(len(blobs) == 4, f'{size}px: the four pips are four separate dots ({len(blobs)} found, areas {sorted(int(b) for b in blobs)})')
        ok(cols.any(), f'{size}px: and the brass divider is there ({int(cols.sum())} columns wide)')
        wide = (xs.max() - xs.min() + 1) / W
        ok(wide >= 0.75, f'{size}px: the tile spans {wide * 100:.0f}% of the icon\'s width (at least 75%)')
    for tab, rgb in TABS.items():
        img = results[(16, tab)]; L = lum(img)
        bgL = float(lum(np.array([[rgb]], dtype=np.uint8))[0, 0])
        edge = float(np.median(np.concatenate([L[1:3, 6:10].ravel(), L[-3:-1, 6:10].ravel()])))   # the felt, top and bottom
        tile = float(np.median(L[L > 0.6]))
        best = max(contrast(edge, bgL), contrast(tile, bgL))
        ok(best >= 3, f'on a {tab} tab strip the icon is visible: felt {contrast(edge, bgL):.1f}:1, tile {contrast(tile, bgL):.1f}:1 against the strip')
    # a mock tab strip, for a person to look at
    strip = np.full((40, 400, 3), (222, 225, 230), np.uint8)
    cv2.imwrite(f'{SHOTS}/favicon_strip.png', strip[..., ::-1])
    ok(not errors, 'no JavaScript errors')
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
