import re
t = open('template.html').read()
css = open('style.css').read()
js = open('game.js').read()
assert '</script>' not in js and '</style>' not in css
out = t.replace('/*CSS*/', css).replace('/*JS*/', js)
open('mexican-train.html', 'w').write(out)
print('built mexican-train.html', len(out), 'bytes')
