#!/usr/bin/env python3
"""Real Chromium: in the end-of-round dialog a player's name never runs into what is beside it (the tiles, "No tiles left", the points), however long it is: every
   computer name in the game (every theme), the longest name a person can give themselves (20 letters), at a wide and a phone-sized window, with a full hand and with none."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); SHOTS = '/tmp/shots'; os.makedirs(SHOTS, exist_ok=True)
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)
srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
SHOW = """([names, full, three]) => {
  const app = window.MexicanTrainApp, S = app.state; S.overlay = null; S.game = null; S.opts.cpus = three ? 2 : 1;
  const hand = full ? Array.from({ length: 15 }, (_, i) => [i % 13, (i * 5 + 3) % 13]) : [];
  const rows = names.map((n, i) => ({ id: ['human', 'cpu', 'cpu2'][i], name: n, hand: i === 0 ? hand : (full ? hand.slice(0, 9) : []), pips: i === 0 ? 133 : 0 }));
  const totals = {}; rows.forEach((r, i) => { totals[r.id] = 100 + i * 17; });
  S.modal = { type: 'roundEnd', blocked: false, tie: false, winnerId: 'cpu', last: false, totals, rows };
  S.awaiting = { kind: 'modal', resolve() {} }; app.render(true); }"""
# a row's name must fit its own box, and must not cross the neighbouring content: the tiles, "No tiles left" or the points
MEASURE = """() => Array.from(document.querySelectorAll('.dialog.roundend .row')).map(r => {
  const who = r.querySelector('.who'), mini = r.querySelector('.mini'), range = document.createRange(); range.selectNodeContents(who);
  const t = range.getBoundingClientRect(), box = who.getBoundingClientRect(), others = [mini, ...r.querySelectorAll('.pts')].map(e => e.getBoundingClientRect());
  const content = Array.from(mini.querySelectorAll('svg, .none')).map(e => e.getBoundingClientRect());
  const hit = [...content, ...others].some(o => o.width > 0 && o.height > 0 && t.left < o.right - 0.5 && t.right > o.left + 0.5 && t.top < o.bottom - 0.5 && t.bottom > o.top + 0.5);
  const d = document.querySelector('.dialog.roundend').getBoundingClientRect();
  return { name: who.textContent, textW: Math.round(t.width), boxW: Math.round(box.width), overflows: who.scrollWidth > who.clientWidth + 1, hit, outside: t.right > d.right + 1 || t.left < d.left - 1 }; })"""
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    names = json.loads(subprocess.run(['node', '-e', "require('./game.js');const G=globalThis.MexicanTrainGame;console.log(JSON.stringify(G.CPU_NAMES.concat(['Computer','Gandalf','Galadriel','Saruman','Aragorn','Gollum','Bilbo Baggins','Frodo','Samwise','Legolas','Gimli','Boromir','Théoden','Éowyn','Faramir','Elrond','Treebeard','Radagast','Wormtongue','Gwaihir'])))"], capture_output=True, text=True, cwd=os.path.join(HERE, '..')).stdout)
    longest = 'WWWWWWWWWWWWWWWWWWWW'          # 20 wide letters: the most a person can type as a name
    errors = []
    for w, h in ((1100, 900), (390, 800)):
        ctx = browser.new_context(viewport={'width': w, 'height': h}); pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(base); pg.wait_for_selector('#opt-theme')
        print(f'{w}px wide')
        bad = []; worst = 0
        for full in (False, True):
            for who in names + [longest, 'Mary-Jane Watson-Parker']:
                for three in (False, True):
                    table = ['You', who, 'Wen'] if three else ['You', who]
                    pg.evaluate(SHOW, [table, full, three]); pg.wait_for_selector('.dialog.roundend')
                    for r in pg.evaluate(MEASURE):
                        worst = max(worst, r['textW'])
                        if r['overflows'] or r['hit'] or r['outside']: bad.append((full, three, r))
        ok(not bad, f'{w}px: no name runs into its neighbours in {2 * 2 * (len(names) + 2)} dialogs (worst: ' + (f"{bad[0][2]['name']!r} {bad[0][2]['textW']}px in a {bad[0][2]['boxW']}px box, {len(bad)} rows" if bad else f'{worst}px wide') + ')')
        pg.evaluate(SHOW, [['You', 'Galadriel'], False, False]); pg.wait_for_selector('.dialog.roundend'); time.sleep(0.2)
        pg.screenshot(path=f'{SHOTS}/names_{w}_galadriel.png')
        pg.evaluate(SHOW, [['You', longest], True, False]); time.sleep(0.2)
        pg.screenshot(path=f'{SHOTS}/names_{w}_longest.png')
        ctx.close()
    ok(not errors, 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
