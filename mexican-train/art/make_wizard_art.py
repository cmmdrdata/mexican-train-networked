#!/usr/bin/env python3
"""Draws the two boards of the wizarding theme: wizard-hall.svg (a candlelit hall, floating candles under tall arches) and wizard-forest.svg
   (a moonlit forest with fireflies). Original artwork, plain shapes, no text, no scripts. The page picks one of the two at random for each game.
   Run:  python3 art/make_wizard_art.py     (build.py puts them into the page)
   The rule they are drawn by, like the Lord of the Rings board: the picture stays DARK, so the writing and the tiles on top of it are as easy to read
   as on the classic felt. Nothing is brighter than a dim plum or a dim green; the candles and fireflies are small, at most half opaque, with a very
   faint glow. t/test_art.js checks the colours and t/test_browser_wizard.py measures the pixels."""
import os, random

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1200, 800

def hall():
    rnd = random.Random(1997)
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">',
         '<defs><radialGradient id="g" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#2a1a30"/><stop offset="1" stop-color="#140c18"/></radialGradient></defs>',
         f'<rect width="{W}" height="{H}" fill="url(#g)"/>']
    # tall arches down both sides and a row of beams across the top
    for x in (60, 330, 870, 1140):
        o.append(f'<path d="M{x-110} {H} V380 Q{x} 130 {x+110} 380 V{H}Z" fill="#120a16" fill-opacity="0.85"/>')
    for i in range(7):
        x = 90 + i * 170
        o.append(f'<path d="M{x} 0 L{600 + (x - 600) * 0.55:.0f} 190" stroke="#1c1222" stroke-width="14" fill="none"/>')
    # hanging banners (dim plum)
    for x in (470, 560, 650, 740):
        o.append(f'<path d="M{x} 0 h56 v170 l-28 26 -28 -26z" fill="#2c1120" fill-opacity="0.7"/>')
    # floating candles: small, at most half opaque, with a very faint halo
    for _ in range(46):
        x = rnd.uniform(30, W - 30); y = rnd.uniform(60, 520)
        h = rnd.uniform(14, 22)
        o.append(f'<circle cx="{x:.0f}" cy="{y - 6:.0f}" r="13" fill="#c9923a" fill-opacity="0.05"/>')
        o.append(f'<rect x="{x - 2.5:.0f}" y="{y:.0f}" width="5" height="{h:.0f}" fill="#8a7a60" fill-opacity="0.22"/>')
        o.append(f'<ellipse cx="{x:.0f}" cy="{y - 4:.0f}" rx="2.4" ry="5" fill="#c9923a" fill-opacity="0.22"/>')
    o.append(f'<rect y="560" width="{W}" height="240" fill="#0e0812" fill-opacity="0.6"/>')
    o.append('</svg>')
    return ''.join(o)

def forest():
    rnd = random.Random(1991)
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">',
         '<defs><radialGradient id="g" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#173a30"/><stop offset="1" stop-color="#0a1a16"/></radialGradient>'
         '<radialGradient id="m" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#9fc7b0" stop-opacity="0.05"/><stop offset="1" stop-color="#9fc7b0" stop-opacity="0"/></radialGradient></defs>',
         f'<rect width="{W}" height="{H}" fill="url(#g)"/>',
         '<circle cx="900" cy="130" r="210" fill="url(#m)"/>',
         '<circle cx="900" cy="130" r="38" fill="#a9cdb8" fill-opacity="0.05"/>']
    # tree trunks and heavy branches along both sides
    for x, w in ((20, 70), (120, 40), (250, 30), (1180, 80), (1070, 46), (960, 28)):
        o.append(f'<path d="M{x} {H} V150 Q{x + w / 2:.0f} 60 {x + w} 150 V{H}Z" fill="#06120f" fill-opacity="0.88"/>')
    for _ in range(9):
        x = rnd.choice([rnd.uniform(0, 330), rnd.uniform(870, W)]); y = rnd.uniform(60, 360)
        o.append(f'<path d="M{x:.0f} {y:.0f} q{rnd.uniform(-90, 90):.0f} {rnd.uniform(-70, -20):.0f} {rnd.uniform(-130, 130):.0f} {rnd.uniform(-90, -30):.0f}" stroke="#06120f" stroke-opacity="0.85" stroke-width="9" fill="none"/>')
    # drifting mist
    for y in (360, 470, 580):
        o.append(f'<ellipse cx="{rnd.uniform(300, 900):.0f}" cy="{y}" rx="{rnd.uniform(380, 560):.0f}" ry="26" fill="#9fc7b0" fill-opacity="0.04"/>')
    # fireflies
    for _ in range(38):
        x = rnd.uniform(20, W - 20); y = rnd.uniform(160, 700)
        o.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="9" fill="#b7d86a" fill-opacity="0.06"/><circle cx="{x:.0f}" cy="{y:.0f}" r="2.2" fill="#b7d86a" fill-opacity="0.12"/>')
    o.append(f'<rect y="620" width="{W}" height="180" fill="#05100d" fill-opacity="0.55"/>')
    o.append('</svg>')
    return ''.join(o)

for name, f in (('wizard-hall', hall), ('wizard-forest', forest)):
    open(os.path.join(HERE, name + '.svg'), 'w').write(f())
    print('wrote', name)
