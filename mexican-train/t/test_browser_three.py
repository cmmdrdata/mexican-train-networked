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

srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))     # (a page that is not the served one is turned away, as with node server.js)
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
    print('0. a game server that is an older version (it cannot seat a third person)')
    octx = browser.new_context(viewport={'width': 1100, 'height': 950}); o = octx.new_page(); o.on('pageerror', lambda e: errors.append(f'old: {e}'))
    def old_info(route):
        resp = route.fetch(); data = resp.json(); data.pop('maxHumans', None); route.fulfill(response=resp, json=data)     # (an older server says nothing about it)
    o.route('**/info', old_info)
    o.goto(base); o.click('[data-action="openHost"]')
    o.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    opt = o.evaluate("() => { const x = document.querySelector('#net-computer option[value=person]'); return { disabled: x.disabled, text: x.textContent }; }")
    ok(opt['disabled'] and 'must be restarted' in opt['text'] and 'older version and cannot seat a third person' in o.inner_text('.dialog'), f"the Host screen does not let you ask an older server for a third person, and says to restart it: {opt['text']}")
    o.screenshot(path='/tmp/shots/three_old_server.png'); octx.close()
    # the page thinks the server is current, but the server's answer to Create has no table size: it made a game for two
    bctx = browser.new_context(viewport={'width': 1100, 'height': 950}); b0 = bctx.new_page(); b0.on('pageerror', lambda e: errors.append(f'old2: {e}'))
    def strip_humans(ws):
        server = ws.connect_to_server()
        ws.on_message(lambda m: server.send(m))
        def to_page(m):
            try:
                d = json.loads(m)
                if isinstance(d.get('settings'), dict): d['settings'].pop('humans', None)
                ws.send(json.dumps(d))
            except Exception:
                ws.send(m)
        server.on_message(to_page)
    b0.route_web_socket('**/ws', strip_humans)
    b0.goto(base); b0.click('[data-action="openHost"]')
    b0.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    b0.fill('#net-name', 'Ann'); b0.select_option('#net-computer', 'person'); b0.click('[data-action="hostGame"]')
    b0.wait_for_selector('[role="alert"]', timeout=8000)
    msg = b0.inner_text('[role="alert"]')
    ok('made a game for two people, not three' in msg and 'node server.js' in msg and b0.query_selector('.code-big') is None, f'creating a game for three on a server that answers "two" is stopped at once, with what to do: {msg[:90]!r}')
    ok(b0.evaluate("() => window.MexicanTrainApp.state.online") is None and b0.evaluate("() => !!document.querySelector('#net-computer')"), 'and the host is back on the Host screen, not waiting in a lobby for a guest who could never join')
    bctx.close()

    print('0b. an old page left open in a browser tab')
    def stale_page(modify):
        sc = browser.new_context(viewport={'width': 1100, 'height': 950}); sp = sc.new_page(); sp.on('pageerror', lambda e: errors.append(f'stale: {e}'))
        def serve(route):
            resp = route.fetch(); route.fulfill(response=resp, body=modify(resp.text()))
        sp.route(base, serve)
        return sc, sp
    # (1) a page from before pages carried a version: nothing on its screen can tell it is old, but the server can
    sc, sp = stale_page(lambda html: re.sub(r'window\.MT_BUILD = "[0-9a-f]+";', '', html))
    ok(sp.evaluate("() => 1") == 1, '(a page with no version stamp)')
    sp.goto(base); sp.click('[data-action="openHost"]')
    sp.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    sp.fill('#net-name', 'Ann'); sp.select_option('#net-computer', 'person'); sp.click('[data-action="hostGame"]')
    sp.wait_for_selector('[role="alert"]', timeout=8000)
    msg = sp.inner_text('[role="alert"]')
    ok('out of date' in msg and 'Reload it' in msg and sp.query_selector('.code-big') is None, f'the server turns an old page away and the screen says to reload it: {msg[:80]!r}')
    sp.screenshot(path='/tmp/shots/three_old_page.png'); sc.close()
    # (2) a stamped page that is behind: it can see for itself, and does not even let you try
    sc, sp = stale_page(lambda html: re.sub(r'(window\.MT_BUILD = ")[0-9a-f]+(";)', r'\g<1>deadbeef00\g<2>', html))
    sp.goto(base); sp.click('[data-action="openHost"]')
    sp.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    sp.wait_for_function("() => document.body.innerText.includes('This page is out of date')", timeout=5000)
    ok(sp.is_disabled('[data-action="hostGame"]') and 'Reload this page' in sp.inner_text('.dialog'), 'a page that is behind its server says so on the Host screen, and Create game cannot be pressed')
    sc.close()

    LOGCHK = "() => { const norm = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; }; const S = window.MexicanTrainApp.state; const all = Array.from(document.querySelectorAll('.log li')); const li = all[0]; return li ? { top: li.classList.contains('latest') && norm(li.innerHTML) === norm(S.log[S.log.length - 1]), n: all.length, latestCount: document.querySelectorAll('.log li.latest').length, order: all.map(x => norm(x.innerHTML)).join('|') === S.log.slice(-600).reverse().map(norm).join('|') } : null; }"
    log_bad = []; log_seen = [0]

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
    for p in (a, b, c):
        r = p.evaluate(LOGCHK)
        if r: log_seen[0] += 1
        if not r or not (r['top'] and r['order'] and r['latestCount'] == 1): log_bad.append(r)
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
    pages = [a, b, c2]; t0 = time.time(); loops = 0
    while time.time() - t0 < 150 and not all(p.evaluate(MODAL) == 'roundEnd' for p in pages):
        for p in pages: p.evaluate(STEP)
        time.sleep(0.05)
        loops += 1
        if loops % 8 == 0:
            for p in pages:
                r = p.evaluate(LOGCHK)
                if r: log_seen[0] += 1
                if r and not (r['top'] and r['order'] and r['latestCount'] == 1): log_bad.append(r)
    ok(all(p.evaluate(MODAL) == 'roundEnd' for p in pages), f'the three play the one round to its end ({time.time() - t0:.0f} s)')
    for p in pages: p.click('[data-action="dialogOk"]')
    for p in pages: p.wait_for_function("() => window.MexicanTrainApp.state.modal && window.MexicanTrainApp.state.modal.type === 'final'", timeout=8000)
    scores = lambda p, me: sorted(set((me if n == 'You' else n) + '=' + v for v, n in re.findall(r'<div class="tot"><b>(\d+)</b><span>([^<]*)</span>', p.content())))
    sa, sb, sc = scores(a, 'Ann'), scores(b, 'Ben'), scores(c2, 'Cat')
    ok(sa == sb == sc and len(sa) == 3, f'all three final screens show the same three scores: {sa}')
    ok('You played Ben and Cat online' in a.inner_text('.dialog') and 'You played Cat and Ann online' in b.inner_text('.dialog'), 'and each is told whom they played')
    a.screenshot(path='/tmp/shots/three_final.png')

    print('6. playing again')
    dlg = lambda p: re.sub(r'\s+', ' ', p.inner_text('.dialog'))
    ok(all('Play again' in dlg(p) and 'Back to the menu' in dlg(p) for p in pages), 'each final dialog offers Play again as well as Back to the menu')
    a.click('[data-action="playAgainOnline"]')
    for p in (b, c2): p.wait_for_function("() => document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('Ann wants to play again.')", timeout=8000)
    ok('Waiting for Ben and Cat' in dlg(a) and a.is_disabled('.dialog .btn.primary'), f'Ann asks: she is told she is waiting for Ben and Cat, with nothing to press: {dlg(a)[-70:]!r}')
    a.screenshot(path='/tmp/shots/three_again_waiting.png')
    ok('Ann wants to play again.' in dlg(b) and 'Ann wants to play again.' in dlg(c2), 'while Ben and Cat are both told that Ann wants to play again')
    b.click('[data-action="playAgainOnline"]')
    c2.wait_for_function("() => document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('Ann and Ben want to play again.')", timeout=8000)
    ok('Waiting for Cat' in dlg(a) and a.evaluate("() => !!document.querySelector('.dialog')"), 'Ben asks: Cat is told that Ann and Ben want to play again, and nothing starts yet')
    c2.click('[data-action="playAgainOnline"]')
    for p in pages: p.wait_for_function("() => !document.querySelector('.dialog') && window.MexicanTrainApp.state.awaiting", timeout=12000)
    ok(all(p.evaluate("() => { const S = window.MexicanTrainApp.state; return S.roundIndex === 0 && S.totals.human === 0 && S.totals.cpu === 0 && S.totals.cpu2 === 0 && !S.modal && S.game.players[0].hand.length === 8; }") for p in pages), 'when the last of them asks, a new game starts on all three windows: round one, nothing scored, a new hand of 8')
    a.wait_for_selector('.tracks'); a.screenshot(path='/tmp/shots/three_again_new_game.png')
    t1 = time.time()
    while time.time() - t1 < 150 and not all(p.evaluate(MODAL) == 'roundEnd' for p in pages):
        for p in pages: p.evaluate(STEP)
        time.sleep(0.05)
    ok(all(p.evaluate(MODAL) == 'roundEnd' for p in pages), f'the new game is played to its end ({time.time() - t1:.0f} s)')
    for p in pages: p.click('[data-action="dialogOk"]')
    for p in pages: p.wait_for_function("() => window.MexicanTrainApp.state.modal && window.MexicanTrainApp.state.modal.type === 'final'", timeout=8000)
    ok(all('Play again' in dlg(p) for p in pages), 'and its final dialog offers to play again too')

    print('7. someone goes back to the menu')
    c2.click('[data-action="onlineBack"]')
    for p in (a, b): p.wait_for_function("() => document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('Cat has left, so there is nobody to play again with.')", timeout=8000)
    ok(a.query_selector('[data-action="playAgainOnline"]') is None and b.query_selector('[data-action="playAgainOnline"]') is None and 'Back to the menu' in dlg(a), 'Cat goes back to the menu: Ann and Ben are told she has left, and can only go back to the menu')
    a.screenshot(path='/tmp/shots/three_again_gone.png')
    ok(log_seen[0] >= 6 and not log_bad, f'in all three windows, all through the game, the history of the game at the bottom had the newest on top and all the older ones below it ({log_seen[0]} looks)' + (f': {log_bad[:1]}' if log_bad else ''))
    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:3]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
