#!/usr/bin/env python3
"""Real Chromium, THREE people (three separate browser windows) at one table: the Host screen's "Add a third person", the lobby filling up, the game,
   a message that reaches both others with the sender's name, one person closing their window and coming back, and the final screens."""
import json, os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)

srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True)
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
BUBBLE = "() => { const el = document.querySelector('.bubble'); return el ? { who: el.querySelector('b').textContent, text: el.querySelector('span').textContent } : null; }"
errors = []

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctxs = {n: browser.new_context(viewport={'width': 1100, 'height': 950}) for n in ('Ann', 'Ben', 'Cat')}
    def new_page(name):
        p = ctxs[name].new_page(); p.on('pageerror', lambda e: errors.append(f'{name}: {e}')); return p
    a = new_page('Ann'); a.goto(base); a.click('[data-action="openHost"]')
    a.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")

    print('1. the Host screen and the lobby')
    opts = a.evaluate("() => Array.from(document.querySelectorAll('#net-computer option')).map(o => [o.value, o.textContent])")
    ok(opts[-1] == ['person', 'Add a third person'] and a.inner_text('label[for="net-computer"]') == 'Third player', f'the last choice under "Third player" is a third person: {opts[-1]}')
    a.fill('#net-name', 'Ann'); a.select_option('#net-rounds', '1'); a.select_option('#net-hand', '8'); a.select_option('#net-computer', 'person')
    a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
    code = a.eval_on_selector('.code-big', 'e => e.textContent').strip().replace('-', '')
    rows = lambda pg: pg.evaluate("() => Array.from(document.querySelectorAll('.players li')).map(li => li.className + ':' + li.textContent.trim())")
    ok(len(rows(a)) == 3 and rows(a)[0].startswith('up:Ann') and rows(a)[1].startswith('empty') and 'Waiting for 2 players' in a.inner_text('.actions'), f'alone, Ann sees three places and "Waiting for 2 players...": {rows(a)}')
    a.screenshot(path='/tmp/shots/three_lobby_alone.png')
    b = new_page('Ben'); b.goto(base + '?join=' + code); b.wait_for_selector('#net-code'); b.fill('#net-name', 'Ben'); b.click('[data-action="joinGame"]'); b.wait_for_selector('.code-big')
    a.wait_for_function("() => document.querySelectorAll('.players li.up').length === 2")
    ok('Waiting for a player' in a.inner_text('.actions') and a.is_disabled('[data-action="startOnline"]'), 'Ben joins: Ann is waiting for one more, and cannot start')
    c = new_page('Cat'); c.goto(base + '?join=' + code); c.wait_for_selector('#net-code'); c.fill('#net-name', 'Cat'); c.click('[data-action="joinGame"]'); c.wait_for_selector('.code-big')
    a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled")
    ok(all(len(rows(p)) == 3 and all(r.startswith('up:') for r in rows(p)) for p in (a, b, c)) and a.inner_text('[data-action="startOnline"]') == 'Start game', 'Cat joins: all three lobbies show three people in, and Ann can start')
    d = new_page('Ben'); d.goto(base + '?join=' + code); d.wait_for_selector('#net-code'); d.fill('#net-name', 'Dan'); d.click('[data-action="joinGame"]')
    d.wait_for_selector('[role="alert"]', timeout=5000)
    ok('three players' in d.inner_text('[role="alert"]'), f'a fourth person is told it is full: {d.inner_text("[role=alert]")!r}'); d.close()
    a.screenshot(path='/tmp/shots/three_lobby_full.png')

    print('2. in the game')
    a.click('[data-action="startOnline"]')
    for p in (a, b, c): p.wait_for_selector('.tracks'); p.wait_for_function("() => window.MexicanTrainApp.state.awaiting")
    ok(all(p.evaluate("() => document.querySelectorAll('.cpu-hand').length") == 2 for p in (a, b, c)), 'every window shows two opponent rows')
    seen = {n: p.evaluate("() => Array.from(document.querySelectorAll('.cpu-hand .who')).map(e => e.textContent).join(',')") for n, p in (('Ann', a), ('Ben', b), ('Cat', c))}
    ok(seen == {'Ann': 'Ben,Cat', 'Ben': 'Cat,Ann', 'Cat': 'Ann,Ben'}, f'each lists the other two by name, in seat order after their own: {seen}')
    ok(all(p.evaluate("() => document.querySelectorAll('.cpu-hand .net-dot.up').length") == 2 for p in (a, b, c)), 'with both shown as connected')
    a.screenshot(path='/tmp/shots/three_game.png')

    print('3. talking')
    b.click('[data-action="toggleSay"]'); time.sleep(0.2); b.keyboard.type('Good luck, Ann and Cat'); b.keyboard.press('Enter')
    time.sleep(0.8)
    ba, bc = a.evaluate(BUBBLE), c.evaluate(BUBBLE)
    ok(ba and bc and ba['who'] == 'Ben' and bc['who'] == 'Ben' and ba['text'] == bc['text'] == 'Good luck, Ann and Cat', f'what Ben types appears in both other windows, as Ben\'s: {ba} / {bc}')
    c.screenshot(path='/tmp/shots/three_chat.png')

    print('4. one person closes their window, and comes back')
    c.close()
    a.wait_for_function("() => document.body.innerText.includes('Game paused')", timeout=20000)
    b.wait_for_function("() => document.body.innerText.includes('Game paused')", timeout=20000)
    ta, tb = a.inner_text('.dialog'), b.inner_text('.dialog')
    ok('Cat lost the connection' in ta and 'Ben' not in ta.split('Cat lost')[0][-30:] and 'Cat lost the connection' in tb, f'Ann and Ben are both told it is Cat: {ta[:80]!r}')
    a.screenshot(path='/tmp/shots/three_paused.png')
    c2 = new_page('Cat'); c2.goto(base)                              # the saved game is picked up again
    c2.wait_for_selector('.tracks', timeout=15000)
    a.wait_for_function("() => !document.body.innerText.includes('Game paused')", timeout=15000)
    b.wait_for_function("() => !document.body.innerText.includes('Game paused')", timeout=15000)
    ok(c2.evaluate("() => window.MexicanTrainApp.state.online.seat") == 2 and c2.evaluate("() => document.querySelectorAll('.cpu-hand').length") == 2, 'Cat opens the page again: she is back in her seat in the same game, and the pause goes away for the others')

    print('5. played to the end')
    pages = [a, b, c2]; t0 = time.time()
    while time.time() - t0 < 150 and not all(p.evaluate(MODAL) == 'roundEnd' for p in pages):
        for p in pages: p.evaluate(STEP)
        time.sleep(0.05)
    ok(all(p.evaluate(MODAL) == 'roundEnd' for p in pages), f'the three play the one round to its end ({time.time() - t0:.0f} s)')
    for p in pages: p.click('[data-action="dialogOk"]')
    for p in pages: p.wait_for_function("() => window.MexicanTrainApp.state.modal && window.MexicanTrainApp.state.modal.type === 'final'", timeout=8000)
    scores = lambda p, me: sorted(set((me if n == 'You' else n) + '=' + v for v, n in re.findall(r'<div class="tot"><b>(\d+)</b><span>([^<]*)</span>', p.content())))
    sa, sb, sc = scores(a, 'Ann'), scores(b, 'Ben'), scores(c2, 'Cat')
    ok(sa == sb == sc and len(sa) == 3, f'all three final screens show the same three scores: {sa}')
    ok('You played Ben and Cat online' in a.inner_text('.dialog') and 'You played Cat and Ann online' in b.inner_text('.dialog'), 'and each is told whom they played')
    a.screenshot(path='/tmp/shots/three_final.png')
    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:3]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
