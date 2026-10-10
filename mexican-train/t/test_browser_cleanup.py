#!/usr/bin/env python3
"""Real Chromium, two people: the screen clean-ups. The Host screen's first computer choice is just "None"; after Create game the lobby has
   no inputs (everyone is only waiting); in the game, the players' rows do not say "Needs N" (the Mexican train's still does) and the join code
   is nowhere on either player's screen, in any dialog, from the moment the game starts."""
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
INPUTS = "() => document.querySelectorAll('.dialog select, .dialog input, .dialog textarea, .dialog [contenteditable], .dialog button.toggle').length"
ROWS = "() => Array.from(document.querySelectorAll('.tracks .track')).map(t => ({ name: (t.querySelector('.track-name') || {}).textContent || '?', needs: !!t.querySelector('.needs'), open: !!t.querySelector('.lamp') }))"
STEP = """() => {
  const app = window.MexicanTrainApp, S = app.state, a = S.awaiting;
  if (!a || (S.online && S.online.pending)) return 'wait';
  if (a.kind === 'modal') return 'modal';
  if (a.kind === 'draw') { app.dispatch({ type: 'draw' }); return 'draw'; }
  if (a.kind === 'build') { app.dispatch({ type: a.canDraw ? 'draw' : a.canBuild ? 'autoBuild' : a.canDone ? 'endBuild' : 'undoTile' }); return 'build'; }
  if (a.kind === 'move') { const m = a.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); return 'move'; }
  return 'other';
}"""
errors = []

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ca = browser.new_context(viewport={'width': 1100, 'height': 900}); cb = browser.new_context(viewport={'width': 1100, 'height': 900})
    a = ca.new_page(); b = cb.new_page()
    for p in (a, b): p.on('pageerror', lambda e: errors.append(str(e)))

    print('1. the Host screen')
    a.goto(base); a.click('[data-action="openHost"]')
    a.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    opts = a.evaluate("() => Array.from(document.querySelectorAll('#net-computer option')).map(o => [o.value, o.textContent])")
    ok(opts[0] == ['none', 'None'], f'the first computer choice is just "None": {opts[0]}')
    ok(len(opts) == 4 and all('two players' not in t for _, t in opts) and 'Hard' in opts[3][1], f'and the other choices are as they were: {[t for _, t in opts[1:]]}')
    ok(a.evaluate(INPUTS) >= 6, 'the Host screen is where the choices are made (it has the inputs: name, length, tiles, computer, theme, hints)')
    a.fill('#net-name', 'Ann'); a.select_option('#net-rounds', '1'); a.select_option('#net-hand', '8')
    a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')

    print('2. after Create game: nothing to fill in')
    code = a.eval_on_selector('.code-big', 'e => e.textContent').strip(); plain = code.replace('-', '')
    ok(a.evaluate(INPUTS) == 0, 'the screen after Create game has no inputs at all: no boxes, no choices, no switches (the host is only waiting for the other player)')
    ok(code in a.inner_text('.dialog') and 'Waiting for a player' in a.inner_text('.dialog') and a.query_selector('[data-action="startOnline"][disabled]') is not None, 'it shows the join code and that it is waiting; Start game is there, not yet usable')
    ok(re.search(r'One round, 8 tiles each\. Hints are allowed\.', a.inner_text('.dialog')) is not None, 'and a one-line summary of how the game was set up: ' + re.sub(r'\s+', ' ', a.inner_text('.dialog'))[-150:-60])
    a.screenshot(path='/tmp/shots/cleanup_lobby.png')
    b.goto(base + '?join=' + plain); b.wait_for_selector('#net-code'); b.fill('#net-name', 'Ben'); b.click('[data-action="joinGame"]'); b.wait_for_selector('.code-big')
    a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled")
    ok(a.evaluate(INPUTS) == 0 and b.evaluate(INPUTS) == 0, 'with the guest in, neither lobby has any inputs either')

    print('3. in the game')
    a.click('[data-action="startOnline"]'); a.wait_for_selector('.tracks'); b.wait_for_selector('.tracks')
    seen = []
    def sample(label):
        for who, p in (('Ann', a), ('Ben', b)): seen.append((label, who, p.inner_text('body')))
    sample('start')
    rows = a.evaluate(ROWS)
    names = [r['name'] for r in rows]
    ok(len(rows) == 3 and any('Mexican' in n for n in names), f'three rows: {names}')
    ok(all(not r['needs'] for r in rows if 'Mexican' not in r['name']), 'the players\' rows have no "Needs N"')
    ok(all(r['needs'] for r in rows if 'Mexican' in r['name']), 'the Mexican train\'s row still says what it needs')
    hdr = a.inner_text('.round')
    ok('Online game' in hdr and code not in hdr and plain not in hdr, f'the header says "Online game" and not the join code: {re.sub(chr(10), " | ", hdr)}')
    a.screenshot(path='/tmp/shots/cleanup_game.png')
    # play on, looking at both screens all the way, including the dialogs
    for p, who in ((a, 'Ann'), (b, 'Ben')):
        p.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'openRules' })"); sample('rules ' + who); p.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'closeOverlay' })")
        p.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'askLeave' })"); sample('leave question ' + who); p.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'closeOverlay' })")
    t0 = time.time(); n = 0
    while time.time() - t0 < 120 and not (a.evaluate("() => window.MexicanTrainApp.state.modal && window.MexicanTrainApp.state.modal.type") == 'roundEnd' and b.evaluate("() => window.MexicanTrainApp.state.modal && window.MexicanTrainApp.state.modal.type") == 'roundEnd'):
        a.evaluate(STEP); b.evaluate(STEP); time.sleep(0.04); n += 1
        if n % 40 == 0:
            sample('playing')
            r = a.evaluate(ROWS)
            if any(x['needs'] for x in r if 'Mexican' not in x['name']): ok(False, 'a player\'s row said "Needs" while playing: ' + str(r))
    sample('round end')
    for who, p in (('Ann', a), ('Ben', b)):
        p.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'dialogOk' })"); time.sleep(0.3); sample('final ' + who)
    leaks = [(l, w) for l, w, t in seen if code in t or plain in t]
    ok(len(seen) >= 12 and not leaks, f'the join code {code} appears on neither screen in any of {len(seen)} samples (start, the Rules dialog, the Leave question, during play, round end, final score)' + (f': found at {leaks[:3]}' if leaks else ''))
    counts = sorted(set(len(re.findall(r'\bNeeds\b', t)) for l, w, t in seen if l in ('start', 'playing')))
    ok(counts == [1], f'and on the whole screen "Needs" appears exactly once (the Mexican train\'s) at the start and all through play: {counts}')

    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
