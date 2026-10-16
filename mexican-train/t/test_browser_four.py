#!/usr/bin/env python3
"""Real Chromium, FOUR players: (1) two people and two computers online (Host screen: Third player and Fourth player), played to the end;
   (2) one person and three computers on one page, at desktop and phone width: three opponent rows that do not overlap, no sideways scrolling."""
import json, os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)

srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
STEP = """() => {
  const app = window.MexicanTrainApp, S = app.state, a = S.awaiting;
  if (!a || (S.online && S.online.pending)) return 'wait';
  if (a.kind === 'modal') return 'modal';
  if (a.kind === 'draw') { app.dispatch({ type: 'draw' }); return 'draw'; }
  if (a.kind === 'build') { app.dispatch({ type: a.canDraw ? 'draw' : a.canBuild ? 'autoBuild' : a.canDone ? 'endBuild' : 'undoTile' }); return 'build'; }
  if (a.kind === 'move') { const m = a.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); return 'move'; }
  return 'other';
}"""
MODAL = "() => { const m = window.MexicanTrainApp.state.modal; return m ? m.type : null; }"
ROWS = """() => Array.from(document.querySelectorAll('.cpu-hand')).map(e => { const r = e.getBoundingClientRect(); return { p: e.dataset.player, who: e.querySelector('.who').textContent, tag: (e.querySelector('.tag') || {}).textContent || '', x: r.left, y: r.top, w: r.width, h: r.height }; })"""
YARD = "() => { const r = document.querySelector('.boneyard').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }"
def overlap(a, b): return a['x'] < b['x'] + b['w'] - 1 and b['x'] < a['x'] + a['w'] - 1 and a['y'] < b['y'] + b['h'] - 1 and b['y'] < a['y'] + a['h'] - 1
errors = []

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    def new_page(width=1100, height=950):
        c = browser.new_context(viewport={'width': width, 'height': height}); p = c.new_page(); p.on('pageerror', lambda e: errors.append(str(e))); return p
    print('1. online: two people and two computers')
    a = new_page(); a.goto(base); a.click('[data-action="openHost"]')
    a.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    ok(a.inner_text('label[for="net-computer2"]') == 'Fourth player' and a.is_disabled('#net-computer2'), 'the Host screen has a "Fourth player" choice, unavailable until a third player is chosen')
    a.select_option('#net-computer', 'normal')
    ok(not a.is_disabled('#net-computer2'), 'choosing a third player makes the fourth available')
    opts = a.evaluate("() => Array.from(document.querySelectorAll('#net-computer2 option')).map(o => o.value)")
    ok(opts == ['none', 'easy', 'normal', 'hard', 'expert'], f'the fourth player can only be a computer: {opts}')
    a.fill('#net-name', 'Ann'); a.select_option('#net-rounds', '1'); a.select_option('#net-hand', '8'); a.select_option('#net-computer2', 'hard')
    a.screenshot(path='/tmp/shots/four_host.png')
    a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
    code = a.eval_on_selector('.code-big', 'e => e.textContent').strip().replace('-', '')
    rows = lambda pg: pg.evaluate("() => Array.from(document.querySelectorAll('.players li')).map(li => li.className + ':' + li.textContent.trim())")
    r = rows(a)
    ok(len(r) == 4 and 'computer, Medium' in r[2] and 'computer, Hard' in r[3] and r[1].startswith('empty'), f'the lobby lists four places: Ann, an empty one, and the two computers: {r}')
    ok('two people and a Medium computer player and a Hard computer player' in a.inner_text('.dialog'), 'and says what the game is')
    b = new_page(); b.goto(base + '?join=' + code); b.wait_for_selector('#net-code'); b.fill('#net-name', 'Ben'); b.click('[data-action="joinGame"]'); b.wait_for_selector('.code-big')
    a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled")
    ok(len(rows(b)) == 4, 'Ben sees the same four places')
    d = new_page(); d.goto(base + '?join=' + code); d.wait_for_selector('#net-code'); d.fill('#net-name', 'Dan'); d.click('[data-action="joinGame"]')
    d.wait_for_selector('[role="alert"]', timeout=5000)
    ok('two players' in d.inner_text('[role="alert"]'), f'a third person is turned away: {d.inner_text("[role=alert]")!r}')
    a.click('[data-action="startOnline"]')
    for p in (a, b): p.wait_for_selector('.tracks'); p.wait_for_function("() => window.MexicanTrainApp.state.awaiting")
    for name, p in (('Ann', a), ('Ben', b)):
        rr = p.evaluate(ROWS)
        ok(len(rr) == 3 and [x['p'] for x in rr] == ['cpu', 'cpu2', 'cpu3'], f'{name} sees three opponent rows')
        ok(not any(overlap(x, y) for i, x in enumerate(rr) for y in rr[i + 1:]) and not any(overlap(x, p.evaluate(YARD)) for x in rr), f'{name}: the rows do not overlap each other or the boneyard')
        ok(p.evaluate("() => document.querySelectorAll('.track').length") == 5, f'{name}: four trains and the Mexican train')
    ra = a.evaluate(ROWS)
    ok([x['who'] for x in ra][0] == 'Ben' and [x['tag'] for x in ra][1:] == ['Medium', 'Hard'], f'Ann sees Ben, then the Medium and Hard computers: {[(x["who"], x["tag"]) for x in ra]}')
    a.screenshot(path='/tmp/shots/four_online.png')
    pages = [a, b]; t0 = time.time()
    while time.time() - t0 < 150 and not all(p.evaluate(MODAL) == 'roundEnd' for p in pages):
        for p in pages: p.evaluate(STEP)
        time.sleep(0.05)
    ok(all(p.evaluate(MODAL) == 'roundEnd' for p in pages), f'the round is played to its end ({time.time() - t0:.0f} s)')
    for p in pages: p.click('[data-action="dialogOk"]')
    for p in pages: p.wait_for_function("() => window.MexicanTrainApp.state.modal && window.MexicanTrainApp.state.modal.type === 'final'", timeout=8000)
    scores = lambda p, me: sorted(set((me if n == 'You' else n) + '=' + v for v, n in re.findall(r'<div class="tot"><b>(\d+)</b><span>([^<]*)</span>', p.content())))
    sa, sb = scores(a, 'Ann'), scores(b, 'Ben')
    ok(sa == sb and len(sa) == 4, f'both final screens show the same four scores: {sa}')
    a.screenshot(path='/tmp/shots/four_final.png')

    print('2. one page: you and three computers')
    for width, height, tag in ((1100, 950, 'desktop'), (390, 800, 'phone')):
        p = new_page(width, height); p.goto(base)
        p.select_option('#opt-cpus', '3')
        ok(p.is_visible('#opt-level3') and p.is_visible('#opt-level2'), f'{tag}: choosing three computers shows the second and third skill')
        p.select_option('#opt-level', 'easy'); p.select_option('#opt-level2', 'normal'); p.select_option('#opt-level3', 'hard'); p.select_option('#opt-rounds', '1'); p.select_option('#opt-hand', '8')
        p.click('[data-action="startGame"]'); p.wait_for_selector('.tracks'); p.wait_for_function("() => window.MexicanTrainApp.state.awaiting")
        rr = p.evaluate(ROWS)
        ok([x['p'] for x in rr] == ['cpu', 'cpu2', 'cpu3'] and [x['tag'] for x in rr] == ['Easy', 'Medium', 'Hard'], f'{tag}: three computer rows, Easy, Medium and Hard')
        ok(len({x['who'] for x in rr}) == 3, f'{tag}: three different names {[x["who"] for x in rr]}')
        ok(not any(overlap(x, y) for i, x in enumerate(rr) for y in rr[i + 1:]) and not any(overlap(x, p.evaluate(YARD)) for x in rr), f'{tag}: the rows do not overlap each other or the boneyard')
        ok(p.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), f'{tag}: no sideways scrolling')
        ok(p.evaluate("() => document.querySelectorAll('.track').length") == 5, f'{tag}: four trains and the Mexican train')
        p.screenshot(path=f'/tmp/shots/four_local_{tag}.png')
        if tag == 'desktop':
            t0 = time.time()
            while time.time() - t0 < 180 and p.evaluate(MODAL) != 'roundEnd':
                p.evaluate(STEP); time.sleep(0.03)
            ok(p.evaluate(MODAL) == 'roundEnd', f'the round is played to its end ({time.time() - t0:.0f} s)')
            p.screenshot(path='/tmp/shots/four_roundend.png')
            dlg = p.inner_text('.dialog')
            ok(dlg.count('\n') >= 4, 'the round-end dialog lists everyone')
            hs = p.evaluate("() => { const r = document.querySelector('.dialog').getBoundingClientRect(); return r.bottom <= window.innerHeight + 1; }")
            ok(hs, 'and fits on the screen')
    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:3]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
