import re, hashlib, os, base64, urllib.parse
t = open('template.html').read()
css = open('style.css').read()
js = open('game.js').read()
assert '</script>' not in js and '</style>' not in css

def svg_text(name):
    svg = open(os.path.join('art', name + '.svg')).read().strip()
    assert '<script' not in svg and 'http' not in svg.replace('http://www.w3.org/2000/svg', '') and len(svg) < 20000, name
    return re.sub(r'>\s+<', '><', svg)

# the board's scenery: url(art:NAME) in the stylesheet becomes the SVG file art/NAME.svg, inlined as a data URI (the page stays one file with nothing to fetch)
def art(m):
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg_text(m.group(1)), safe="/:=,;()'!*-._~") + '")'
css = re.sub(r'url\(art:([a-z0-9-]+)\)', art, css)
assert 'url(art:' not in css

# the tab icon: href="art:NAME.svg" or href="art:NAME.png" in the page's head, inlined the same way (an SVG as text, a PNG as base64)
def icon(m):
    name, ext = m.group(1), m.group(2)
    if ext == 'svg':
        return 'href="data:image/svg+xml,' + urllib.parse.quote(svg_text(name), safe="/:=,;()'!*-._~") + '"'
    data = open(os.path.join('art', name + '.png'), 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) < 20000, name
    return 'href="data:image/png;base64,' + base64.b64encode(data).decode() + '"'
t = re.sub(r'href="art:([a-z0-9-]+)\.(svg|png)"', icon, t)
assert 'href="art:' not in t

# a short stamp that changes whenever the page changes: the page sends it when it creates or joins a game, and the server (which serves this very
# file) turns away a page that is not this one, so an old copy left open in a browser tab cannot quietly start a game that behaves differently
build = hashlib.sha256((t + css + js).encode()).hexdigest()[:10]
out = t.replace('/*CSS*/', css).replace('/*JS*/', 'window.MT_BUILD = "' + build + '";\n' + js)
open('mexican-train.html', 'w').write(out)
print('built mexican-train.html', len(out), 'bytes, build', build)
