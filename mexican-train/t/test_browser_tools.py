#!/usr/bin/env python3
"""Real Chromium: the Comments button stays exactly where they are (above the opponents' rows) while a game is played, with one, two and three computers,
   on a desktop and a phone, and in a hosted game; and they never sit in a row between the computers' names."""
import json, os, subprocess, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); SHOTS = '/tmp/shots'; os.makedirs(SHOTS, exist_ok=True)
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)
srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
STEP = """() => { const app = window.MexicanTrainApp, S = app.state, a = S.awaiting; if (!a || (S.online && S.online.pending)) return;
  if (a.kind==='modal') return; if (a.kind==='draw') app.dispatch({type:'draw'});
  else if (a.kind==='build') { if (a.canDraw) app.dispatch({type:'draw'}); else if (a.canBuild) app.dispatch({type:'autoBuild'}); else if (a.canDone) app.dispatch({type:'endBuild'}); else app.dispatch({type:'undoTile'}); }
  else { const m = a.moves[0]; app.dispatch({type:'selectTile', key: m.tile[0]+'-'+m.tile[1]}); if (S.awaiting===a) app.dispatch({type:'playOn', train:m.trainId}); } }"""
SAMPLE = """() => { const q = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
  const rows = Array.from(document.querySelectorAll('.cpu-hand')).map(e => e.getBoundingClientRect());
  return { say: q('[data-action="toggleSay"]'), comments: q('[data-action="toggleChat"]'), tools: q('.opp-tools'), rows: rows.map(r => [Math.round(r.top), Math.round(r.bottom)]) }; }"""
def watch(pg, secs, label):
    seen = []; t0 = time.time()
    while time.time() - t0 < secs:
        pg.evaluate(STEP); seen.append(pg.evaluate(SAMPLE)); time.sleep(0.05)
    seen = [s for s in seen if s['comments']]
    ok(len(seen) > 50, f'{label}: sampled {len(seen)} times')
    for k in ('say', 'comments'):
        vals = {json.dumps(s[k]) for s in seen if s[k]}
        ok(len(vals) <= 1, f'{label}: the {k} button never moves ({len(vals)} different places: {sorted(vals)[:3]})')
    first = seen[0]; tb = first['tools']
    ok(all(s['tools'] and s['rows'] and s['tools'][1] + s['tools'][3] <= min(r[0] for r in s['rows']) + 1 for s in seen), f'{label}: the buttons are always above the first computer row, never between the names')
    return seen
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for cpus, size in ((1, (1100, 950)), (2, (1100, 950)), (3, (1100, 950)), (3, (390, 800))):
        pg = b.new_page(viewport={'width': size[0], 'height': size[1]}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15'); pg.select_option('#opt-cpus', str(cpus))
        pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
        watch(pg, 25, f'{cpus} computer(s), {size[0]} wide')
        pg.screenshot(path=f'{SHOTS}/tools_{cpus}_{size[0]}.png'); ok(not errs, f'no page errors {errs}'); pg.close()
    # hosted: two people and a computer
    a = b.new_page(viewport={'width': 1100, 'height': 950}); a.goto(base); a.click('[data-action="openHost"]')
    a.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    a.select_option('#net-computer', 'normal'); a.fill('#net-name', 'Ann'); a.select_option('#net-rounds', '1'); a.select_option('#net-hand', '15')
    a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
    code = a.eval_on_selector('.code-big', 'e => e.textContent').strip().replace('-', '')
    p2 = b.new_page(viewport={'width': 1100, 'height': 950}); p2.goto(base + '?join=' + code); p2.wait_for_selector('#net-code'); p2.fill('#net-name', 'Ben'); p2.click('[data-action="joinGame"]'); p2.wait_for_selector('.code-big')
    a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled"); a.click('[data-action="startOnline"]')
    for p in (a, p2): p.wait_for_selector('.tracks')
    seen = []; t0 = time.time()
    while time.time() - t0 < 30:
        p2.evaluate(STEP); a.evaluate(STEP); seen.append(a.evaluate(SAMPLE)); time.sleep(0.05)
    ok(all(s['comments'] and not s['say'] for s in seen) and a.query_selector('.chat') is not None, 'hosted: Comments is there, the Say something button is gone, and the chat is at the bottom')
    ok(len({json.dumps(s['comments']) for s in seen}) == 1, 'hosted: the Comments button never moves')
    ok(all(s['tools'][1] + s['tools'][3] <= min(r[0] for r in s['rows']) + 1 for s in seen), 'hosted: above the rows')
    a.evaluate("() => document.getElementById('say-text').focus({ preventScroll: true })"); a.keyboard.type('hello'); time.sleep(0.2); after = a.evaluate(SAMPLE)
    c0, c1, t0, t1 = seen[0]['comments'], after['comments'], seen[0]['tools'], after['tools']
    ok(c1[0] == c0[0] and c1[2:] == c0[2:] and c1[1] - t1[1] == c0[1] - t0[1], f'typing in the chat does not move the buttons within their strip (the page itself may scroll to the cursor: {c0} -> {c1})')
    a.screenshot(path=f'{SHOTS}/tools_online.png')
    b.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed'); raise SystemExit(1 if failed else 0)
