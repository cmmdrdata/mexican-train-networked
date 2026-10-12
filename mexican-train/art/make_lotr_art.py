#!/usr/bin/env python3
"""Draws the Lord of the Rings board scenery: three small SVG files (original artwork, plain shapes, no text, no scripts).
   lotr-top.svg     distant jagged mountains under a soft glow, across the top of the board
   lotr-ring.svg    a faint golden ring, behind the middle of the board
   lotr-bottom.svg  rolling hills with a line of trees, along the bottom of the board
   Run:  python3 art/make_lotr_art.py     (build.py puts them into the page)
   The rule they are drawn by: nothing is brighter than the felt's centre, so no text on the board is harder to read than in the classic theme;
   the scenery is silhouettes (darker than the board), a glow and a ring that stay under that limit. t/test_browser_lotr_bg.py measures it."""
import math, os, random

HERE = os.path.dirname(os.path.abspath(__file__))

def ridge(rnd, width, base, amp, step, sharp):
    """Points of a jagged ridge line from the left edge to the right edge."""
    pts = []; x = -20; y = base
    while x < width + 40:
        y = base - amp * (0.35 + 0.65 * rnd.random()) * (1 if rnd.random() < sharp else 0.45)
        pts.append((x, y)); x += step * (0.6 + 0.9 * rnd.random())
    return pts

def poly(pts, bottom, width):
    d = 'M-20 %d ' % bottom + ' '.join('L%.0f %.0f' % p for p in pts) + ' L%d %d Z' % (width + 40, bottom)
    return d

def top():
    W, H = 1200, 320; rnd = random.Random(1954)
    far = poly(ridge(rnd, W, 215, 120, 46, 0.8), H, W)
    mid = poly(ridge(rnd, W, 250, 105, 38, 0.75), H, W)
    near = poly(ridge(rnd, W, 292, 70, 30, 0.7), H, W)
    # everything in the band fades away towards its bottom edge, so the scenery never ends in a hard line
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMin slice">
<defs>
<radialGradient id="g" cx="50%" cy="85%" r="70%"><stop offset="0" stop-color="#285a45" stop-opacity="0.38"/><stop offset="1" stop-color="#285a45" stop-opacity="0"/></radialGradient>
<linearGradient id="f" gradientUnits="userSpaceOnUse" x1="0" y1="170" x2="0" y2="{H}"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}"><rect width="{W}" height="{H}" fill="url(#f)"/></mask>
</defs>
<g mask="url(#m)">
<rect width="{W}" height="{H}" fill="url(#g)"/>
<path d="{far}" fill="#17382f" fill-opacity="0.85"/>
<path d="{mid}" fill="#12302a" fill-opacity="0.9"/>
<path d="{near}" fill="#0e2822"/>
</g>
</svg>'''

def ring():
    S = 600
    R, W = 220, 52         # the radius of the ring, and the thickness of its band (it was 250 and 26: twice as thick, a little smaller)
    core, edge = 6, 4      # the thin brighter line along the middle of the band, and the two hairlines along its edges (3 and 2 before: twice as thick)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}">
<circle cx="300" cy="300" r="{R}" fill="none" stroke="#d6a84f" stroke-opacity="0.04" stroke-width="{W}"/>
<circle cx="300" cy="300" r="{R}" fill="none" stroke="#d6a84f" stroke-opacity="0.055" stroke-width="{core}"/>
<circle cx="300" cy="300" r="{R + W // 2}" fill="none" stroke="#d6a84f" stroke-opacity="0.035" stroke-width="{edge}"/>
<circle cx="300" cy="300" r="{R - W // 2}" fill="none" stroke="#d6a84f" stroke-opacity="0.035" stroke-width="{edge}"/>
</svg>'''

def bottom():
    W, H = 1200, 200; rnd = random.Random(1937)
    def hills(base, amp, n, seed):
        r = random.Random(seed); pts = []
        ph = [r.random() * 6.28 for _ in range(3)]
        for i in range(0, W + 41, 20):
            y = base - amp * (0.5 + 0.28 * math.sin(i / 170 + ph[0]) + 0.17 * math.sin(i / 83 + ph[1]) + 0.05 * math.sin(i / 37 + ph[2]))
            pts.append((i - 20 if i == 0 else i, y))
        return 'M-20 %d ' % H + ' '.join('L%.0f %.0f' % p for p in pts) + ' L%d %d Z' % (W + 40, H)
    # a line of trees: each a stack of three overlapping triangles (pines) or a round crown (oaks), standing on the near hill
    trees = []; x = 8
    while x < W:
        h = 38 + 34 * rnd.random(); w = 14 + 10 * rnd.random(); base = 196 - 6 * math.sin(x / 90)
        if rnd.random() < 0.65:
            for k in range(3):
                top_y = base - h + k * h * 0.26; bw = w * (0.55 + 0.25 * k)
                trees.append(f'M{x - bw:.0f} {top_y + h * 0.42:.0f} L{x:.0f} {top_y:.0f} L{x + bw:.0f} {top_y + h * 0.42:.0f} Z')
            trees.append(f'M{x - 2:.0f} {base:.0f} L{x - 2:.0f} {base - h * 0.2:.0f} L{x + 2:.0f} {base - h * 0.2:.0f} L{x + 2:.0f} {base:.0f} Z')
        else:
            r = w * 0.8; trees.append(f'M{x - 2:.0f} {base:.0f} L{x - 2:.0f} {base - h * 0.45:.0f} L{x + 2:.0f} {base - h * 0.45:.0f} L{x + 2:.0f} {base:.0f} Z')
            trees.append(f'M{x - r:.0f} {base - h * 0.55:.0f} A{r:.0f} {r * 0.95:.0f} 0 1 1 {x + r:.0f} {base - h * 0.55:.0f} A{r:.0f} {r * 0.95:.0f} 0 1 1 {x - r:.0f} {base - h * 0.55:.0f} Z')
        x += 22 + 38 * rnd.random()
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice">
<path d="{hills(150, 70, 0, 5)}" fill="#143a31" fill-opacity="0.8"/>
<path d="{hills(172, 52, 0, 9)}" fill="#10322a"/>
<path d="{' '.join(trees)}" fill="#0b231d"/>
<path d="M-20 {H} L-20 190 L{W + 40} 190 L{W + 40} {H} Z" fill="#0b231d"/>
</svg>'''

for name, make in (('lotr-top', top), ('lotr-ring', ring), ('lotr-bottom', bottom)):
    svg = make()
    with open(os.path.join(HERE, name + '.svg'), 'w') as f: f.write(svg + '\n')
    print(name + '.svg', len(svg), 'bytes')
