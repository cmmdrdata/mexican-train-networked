import re, hashlib
t = open('template.html').read()
css = open('style.css').read()
js = open('game.js').read()
assert '</script>' not in js and '</style>' not in css
# a short stamp that changes whenever the page changes: the page sends it when it creates or joins a game, and the server (which serves this very
# file) turns away a page that is not this one, so an old copy left open in a browser tab cannot quietly start a game that behaves differently
build = hashlib.sha256((t + css + js).encode()).hexdigest()[:10]
out = t.replace('/*CSS*/', css).replace('/*JS*/', 'window.MT_BUILD = "' + build + '";\n' + js)
open('mexican-train.html', 'w').write(out)
print('built mexican-train.html', len(out), 'bytes, build', build)
