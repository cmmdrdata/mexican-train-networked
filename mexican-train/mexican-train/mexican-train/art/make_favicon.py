#!/usr/bin/env python3
"""Draws the game's tab icon (NOT themed: a generic Mexican Train game): a domino on the game's felt green, a few big shapes so it can be told apart on a
   browser tab (16 pixels) and nothing finer than that.
   favicon.svg        the icon (what Chrome, Edge and Firefox use)
   favicon-32.png     the same at 32 x 32 (browsers that do not take an SVG icon)
   favicon-180.png    the same at 180 x 180 (the icon of the page when it is saved to a phone's home screen)
   Run:  python3 art/make_favicon.py     (needs Playwright, only to draw the two PNGs; the files are committed, and build.py puts them in the page)"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FELT, BONE, INK, BRASS = '#1d5c52', '#f6f0e0', '#1b2523', '#a07a26'     # the game's own colours (felt, bone, pips, brass)

def svg():
    pips = ''.join(f'<circle cx="{x}" cy="{y}" r="2.7" fill="{INK}"/>' for x, y in ((8.6, 11.6), (11.6, 20.4), (20.4, 11.6), (23.4, 20.4)))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
            f'<rect width="32" height="32" rx="7" fill="{FELT}"/>'
            f'<rect x="2" y="6" width="28" height="20" rx="3.6" fill="{BONE}"/>'
            f'<rect x="14.9" y="7" width="2.2" height="18" fill="{BRASS}"/>'
            f'{pips}</svg>')

def main():
    s = svg()
    open(os.path.join(HERE, 'favicon.svg'), 'w').write(s + '\n')
    print('favicon.svg', len(s), 'bytes')
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('Playwright is not installed: the PNGs were not redrawn'); return
    with sync_playwright() as p:
        b = p.chromium.launch()
        for size in (32, 180):
            pg = b.new_page(viewport={'width': size, 'height': size})
            pg.set_content(f'<body style="margin:0;background:transparent">{s.replace("<svg ", f"<svg width=%d height=%d " % (size, size), 1)}</body>')
            pg.screenshot(path=os.path.join(HERE, f'favicon-{size}.png'), omit_background=True)
            pg.close()
        b.close()
    for size in (32, 180): print(f'favicon-{size}.png', os.path.getsize(os.path.join(HERE, f'favicon-{size}.png')), 'bytes')

main()
