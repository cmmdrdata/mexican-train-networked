#!/usr/bin/env python3
"""A blip in a guest's connection, in real Chromium against the real server: what does the OTHER player see?
   Usage: python3 test_browser_connection.py [repo_dir] [label]   (default: the repo this file is in)"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(HERE)
LABEL = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(REPO)
PATCHED = '--original' not in sys.argv
OPTS = {'heartbeatMs': 60000}
if PATCHED and 'softGraceMs' in open(os.path.join(REPO, 'server.js'), encoding='utf-8').read(): OPTS['softGraceMs'] = 3000
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)

srv = subprocess.Popen(['node', os.path.join(HERE, 'connection_server.js'), REPO, json.dumps(OPTS), '/tmp/connection_server.log'], stdout=subprocess.PIPE, text=True)
ports = json.loads(srv.stdout.readline()); base = f"http://127.0.0.1:{ports['port']}/"
cut = lambda name: urllib.request.urlopen(f"http://127.0.0.1:{ports['ctl']}/cut?name={name}").read().decode()
PROBE = "() => { const o = window.MexicanTrainApp.state.online || {}; return { conn: o.conn, opp: o.oppConnected, phase: o.phase, log: window.MexicanTrainApp.state.netLog || [] }; }"
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ca = browser.new_context(viewport={'width': 1100, 'height': 900}); cb = browser.new_context(viewport={'width': 1100, 'height': 900})
    a = ca.new_page(); b = cb.new_page(); errors = []
    for p in (a, b): p.on('pageerror', lambda e: errors.append(str(e)))
    a.goto(base); a.click('[data-action="openHost"]')
    a.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    a.fill('#net-name', 'Ann'); a.select_option('#net-rounds', '1'); a.select_option('#net-hand', '8')
    a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
    code = a.eval_on_selector('.code-big', 'e => e.textContent').strip()
    b.goto(base + '?join=' + code.replace('-', '') + '&debug=1'); b.wait_for_selector('#net-code'); b.fill('#net-name', 'Ben'); b.click('[data-action="joinGame"]'); b.wait_for_selector('.code-big')
    a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled")
    a.click('[data-action="startOnline"]'); a.wait_for_selector('.tracks'); b.wait_for_selector('.tracks'); time.sleep(1.0)

    print(f'--- {LABEL}: Ben\'s connection is cut (like a Wi-Fi blip) while Ann watches')
    t0 = time.time(); print('cut:', cut('Ben'))
    rows = []
    while time.time() - t0 < 4.0:
        pa, pb = a.evaluate(PROBE), b.evaluate(PROBE)
        rows.append((round(time.time() - t0, 2), pa['opp'], pb['conn']))
        time.sleep(0.05)
    seen_paused = [r for r in rows if r[1] is False]
    seen_text = a.evaluate("() => /Game paused|lost the connection/.test(document.body.innerText)")
    ben_down = [r for r in rows if r[2] != 'open']
    print(f"   Ann's screen said Ben was disconnected for {round(len(seen_paused) * 0.05, 2)} s (first at {seen_paused[0][0] if seen_paused else '-'} s)")
    print(f"   Ben's own connection was down for about {round(len(ben_down) * 0.05, 2)} s")
    ok(rows[-1][2] == 'open' and rows[-1][1] is True, 'in the end both are connected again and Ann sees Ben as connected')
    ok(len(ben_down) > 0, 'the cut really happened (Ben\'s page noticed)')
    time.sleep(0.5)
    st = b.evaluate("() => window.MexicanTrainApp.state.game ? window.MexicanTrainApp.state.game.players.length : 0")
    ok(st >= 2, 'and Ben is back in the same game, with the board')
    if PATCHED and 'softGraceMs' in OPTS:
        ok(len(seen_paused) == 0, 'the blip was invisible to Ann: she was never told Ben had gone and no pause was shown')
        log = open('/tmp/connection_server.log', encoding='utf-8').read()
        ok('Ben lost the connection' in log and 'vanished without a goodbye' in log and 'Ben is back in game' in log and 'their page says' in log, 'and the server\'s log explains it: ' + ' | '.join(l.split(' ', 1)[1][:150] for l in log.splitlines() if 'Ben' in l)[:420])
        events = [e['kind'] for e in b.evaluate(PROBE)['log']]
        ok('closed' in events and 'reconnecting' in events and 'open' in events, f"and Ben's page logged what happened: {events}")
        b.screenshot(path='/tmp/shots/connection_debug_panel.png')
    else:
        ok(True, '(original code: the numbers above are the result)')
    print(f'--- {LABEL}: {passed} passed, {failed} failed')
    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
sys.exit(1 if failed else 0)
