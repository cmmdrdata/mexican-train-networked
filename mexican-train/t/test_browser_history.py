#!/usr/bin/env python3
"""Real Chromium: the game's history panel at the bottom left scrolls (mouse wheel and keyboard), shows the whole history newest first, and keeps the reader's place when the
   page is drawn again as the game goes on."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = '/tmp/shots'; os.makedirs(SHOTS, exist_ok=True)
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)

srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
STEP = """() => {
  const app = window.MexicanTrainApp, S = app.state, a = S.awaiting;
  if (!a) return 'wait';
  if (a.kind === 'modal') return 'modal';
  if (a.kind === 'draw') { app.dispatch({ type: 'draw' }); return 'draw'; }
  if (a.kind === 'build') {
    if (a.canDraw) { app.dispatch({ type: 'draw' }); return 'build'; }
    const nonDouble = a.moves.find(x => x.tile[0] !== x.tile[1]);
    if (a.moves.length && (a.placed < 3 || !a.canDone)) { const m = (a.placed >= 2 && nonDouble) ? nonDouble : a.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); return 'build'; }
    app.dispatch({ type: a.canDone ? 'endBuild' : 'undoTile' }); return 'build';
  }
  if (a.kind === 'move') { const m = a.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); return 'move'; }
  return 'other';
}"""
LOGN = "() => window.MexicanTrainApp.state.log.length"
SNAP = """() => { const p = document.querySelector('.log'), lis = Array.from(p.querySelectorAll('ol > li')), pr = p.getBoundingClientRect(), top = p.scrollTop;
  const k = lis.findIndex(li => li.getBoundingClientRect().bottom - pr.top > 2);
  return { n: lis.length, top, abs: lis.length - 1 - k, off: k < 0 ? null : lis[k].getBoundingClientRect().top - pr.top, text: k < 0 ? '' : lis[k].textContent }; }"""
AT = """(abs) => { const p = document.querySelector('.log'), lis = Array.from(p.querySelectorAll('ol > li')), pr = p.getBoundingClientRect(), k = lis.length - 1 - abs;
  return { off: k < 0 ? null : lis[k].getBoundingClientRect().top - pr.top, top: p.scrollTop, n: lis.length }; }"""
errors = []

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', '4'); pg.select_option('#opt-hand', '8')
    pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
    t0 = time.time()
    while time.time() - t0 < 120 and pg.evaluate(LOGN) < 16:
        pg.evaluate(STEP); time.sleep(0.05)
    n = pg.evaluate(LOGN)
    print('1. the panel')
    ok(n >= 16, f'a game under way has a history of {n} messages')
    info = pg.evaluate("""() => { const p = document.querySelector('.log'), c = getComputedStyle(p);
      return { overflowY: c.overflowY, overscroll: c.overscrollBehaviorY, h: p.clientHeight, sh: p.scrollHeight, tab: p.getAttribute('tabindex'), role: p.getAttribute('role'), label: p.getAttribute('aria-label'),
               lis: p.querySelectorAll('ol > li').length, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) }; }""")
    ok(info['overflowY'] == 'auto' and info['overscroll'] == 'contain', f"it scrolls (overflow-y {info['overflowY']}) and does not pass the scrolling on to the page ({info['overscroll']})")
    ok(abs(info['h'] - 7.2 * info['rem']) <= 2, f"and is the size it always was: {info['h']} px (7.2 rem is {7.2 * info['rem']:.0f})")
    ok(info['sh'] > info['h'] + 10, f"with more in it than shows at once: {info['sh']} px of history in a {info['h']} px window")
    ok(info['lis'] == n, f"every message of the game is in it: {info['lis']} lines for {n} messages (not just five)")
    ok(info['tab'] == '0' and info['role'] == 'region' and 'history' in info['label'].lower(), f"it can take the keyboard focus, and says what it is: {info['label']}")
    pg.screenshot(path=f'{SHOTS}/history_top.png', clip={'x': 0, 'y': 700, 'width': 1100, 'height': 250})
    first = pg.evaluate("() => { const p = document.querySelector('.log'); return { latest: p.querySelector('li.latest').textContent, newest: window.MexicanTrainApp.state.log.slice(-1)[0], first: p.querySelector('ol > li').textContent }; }")
    ok(first['first'] == first['latest'] and first['latest'].replace('&#39;', "'") == first['newest'].replace('&#39;', "'"), 'at the top is the newest message, highlighted')

    print('2. scrolling it')
    box = pg.evaluate("() => { const r = document.querySelector('.log').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }")
    sy0 = pg.evaluate("() => window.scrollY")
    pg.mouse.move(box['x'], box['y']); pg.mouse.wheel(0, 70); time.sleep(0.3)
    s1 = pg.evaluate("() => document.querySelector('.log').scrollTop")
    ok(s1 > 20, f'the mouse wheel over it scrolls it down through the history (to {s1:.0f} px)')
    pg.mouse.wheel(0, 5000); time.sleep(0.3)
    s2 = pg.evaluate("() => { const p = document.querySelector('.log'); return [p.scrollTop, p.scrollHeight - p.clientHeight, window.scrollY]; }")
    ok(abs(s2[0] - s2[1]) <= 2, f'all the way to the oldest message ({s2[0]:.0f} of {s2[1]:.0f} px)')
    oldest = pg.evaluate("() => { const lis = document.querySelectorAll('.log ol > li'); return lis[lis.length - 1].textContent; }")
    ok(oldest.startswith('Round 1:'), f'and the oldest is where the game began: "{oldest[:60]}"')
    ok(pg.evaluate("() => window.scrollY") == sy0, 'the page itself did not scroll, though the wheel went past the end of the panel')
    pg.screenshot(path=f'{SHOTS}/history_bottom.png', clip={'x': 0, 'y': 700, 'width': 1100, 'height': 250})
    pg.evaluate("() => { document.querySelector('.log').scrollTop = 0; }")

    print('3. the keyboard')
    pg.focus('.log'); ok(pg.evaluate("() => document.activeElement.classList.contains('log')"), 'the panel takes the focus')
    pg.keyboard.press('PageDown'); time.sleep(0.3)
    k1 = pg.evaluate("() => document.querySelector('.log').scrollTop")
    pg.keyboard.press('End'); time.sleep(0.3)
    k2 = pg.evaluate("() => { const p = document.querySelector('.log'); return [p.scrollTop, p.scrollHeight - p.clientHeight]; }")
    pg.keyboard.press('Home'); time.sleep(0.3)
    k3 = pg.evaluate("() => document.querySelector('.log').scrollTop")
    ok(k1 > 20 and abs(k2[0] - k2[1]) <= 2 and k3 == 0, f'Page Down ({k1:.0f} px), End (the oldest) and Home (the newest, back at 0) all work')
    pg.screenshot(path=f'{SHOTS}/history_focus.png', clip={'x': 0, 'y': 700, 'width': 1100, 'height': 250})
    pg.evaluate("() => { document.activeElement.blur(); }")

    print('4. the reader keeps their place as the game goes on')
    pg.evaluate("() => { document.querySelector('.log').scrollTop = 45; }"); time.sleep(0.1)
    before = pg.evaluate(SNAP); n0 = pg.evaluate(LOGN); t1 = time.time()
    while time.time() - t1 < 60 and pg.evaluate(LOGN) < n0 + 3:
        pg.evaluate(STEP); time.sleep(0.05)
        # (stay where we put it: the game redraws the page as it goes)
    after_n = pg.evaluate(LOGN)
    ok(after_n >= n0 + 3, f'the game went on: {after_n - n0} more messages, each at the TOP of the history, each redrawing the page')
    a = pg.evaluate(AT, before['abs'])
    ok(a['off'] is not None and abs(a['off'] - before['off']) <= 3, f"the message being read ({before['text'][:40]!r}) is still in the same place in the panel: {before['off']:.0f} px from its top, then {a['off']:.0f} (the panel's own scroll went from {before['top']:.0f} to {a['top']:.0f} px)")
    ok(a['top'] > before['top'], 'which means the panel scrolled down by the height of what was added above')
    pg.evaluate("() => { document.querySelector('.log').scrollTop = 0; }"); time.sleep(0.1)
    n1 = pg.evaluate(LOGN); t2 = time.time()
    while time.time() - t2 < 60 and pg.evaluate(LOGN) < n1 + 2:
        pg.evaluate(STEP); time.sleep(0.05)
    time.sleep(0.2)
    top_now = pg.evaluate("() => { const p = document.querySelector('.log'); return { top: p.scrollTop, first: p.querySelector('ol > li').textContent, newest: window.MexicanTrainApp.state.log.slice(-1)[0] }; }")
    ok(top_now['top'] == 0 and top_now['first'].replace('&#39;', "'") == top_now['newest'].replace('&#39;', "'"), 'while reading the newest, the panel stays at the top and shows each new message as it comes')
    ok(not errors, 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    ctx.close(); browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
