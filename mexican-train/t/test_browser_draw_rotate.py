#!/usr/bin/env python3
"""Real Chromium: (1) hints off: you may draw even if you have a play (once a turn), the hand and boneyard change, a second draw says so; (2) double-click a tile in
   the hand: it turns around instead of being played (hints on and off), a single click still plays after a moment, R on a focused tile turns it;
   (3) the same draw in a hosted game between two people with hints off."""
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
  if (!a || (S.online && S.online.pending)) return 'wait';
  if (a.kind === 'modal') return 'modal';
  if (a.kind === 'draw') { app.dispatch({ type: 'draw' }); return 'draw'; }
  if (a.kind === 'build') {                                  // as a player would: put tiles down (the build-my-longest-train button is not there with hints off)
    if (a.canDraw) { app.dispatch({ type: 'draw' }); return 'build'; }
    // (never stop on an uncovered double: cover it, or if nothing covers it take it back and put down a tile that is not a double. Otherwise a double as the
    //  last tile would be taken back and put down again for ever.)
    const nonDouble = a.moves.find(x => x.tile[0] !== x.tile[1]);
    if (a.moves.length && (a.placed < 4 || !a.canDone)) { const m = (a.placed >= 3 && nonDouble) ? nonDouble : a.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); return 'build'; }
    app.dispatch({ type: a.canDone ? 'endBuild' : 'undoTile' }); return 'build';
  }
  if (a.kind === 'move') { const m = a.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); return 'move'; }
  return 'other';
}"""
MOVE_NO_DOUBLE = "() => { const S = window.MexicanTrainApp.state, a = S.awaiting; return !!a && a.kind === 'move' && !S.game.openDouble && S.game.boneyard.length > 3 && !(S.online && S.online.pending); }"
SOLE_TILE = """() => { const a = window.MexicanTrainApp.state.awaiting; if (!a || a.kind !== 'move') return null; const c = {};
  a.moves.forEach(m => { const k = m.tile[0] + '-' + m.tile[1]; (c[k] = c[k] || []).push(m); });
  return Object.keys(c).find(k => c[k].length === 1 && c[k][0].tile[0] !== c[k][0].tile[1]) || null; }"""
HAND = "() => window.MexicanTrainApp.state.game.players[0].hand.length"
BONE = "() => +document.querySelector('.yard-text .count b').textContent"
TILE = """(k) => { const el = document.querySelector('.hand .tile-btn[data-key="' + k + '"]'); if (!el) return null;
  const gs = Array.from(el.querySelectorAll('svg > g')).map(g => g.querySelectorAll('circle').length);
  return { label: el.getAttribute('aria-label'), pips: gs, selected: el.classList.contains('selected') }; }"""
errors = []

def reach(pg, js, secs=120):                                   # (a time budget, not a number of steps: the computer plays at the game's own pace, and how long that takes depends on the machine)
    t0 = time.time()
    while time.time() - t0 < secs:
        if pg.evaluate(js): return True
        pg.evaluate(STEP); time.sleep(0.04)
    return False
def reach_value(pg, js, secs=120):
    t0 = time.time()
    while time.time() - t0 < secs:
        v = pg.evaluate(js)
        if v: return v
        pg.evaluate(STEP); time.sleep(0.04)
    return None

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    print('1. hints off, against the computer: draw even if you have a play')
    ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base); pg.wait_for_selector('#opt-hints'); pg.click('#opt-hints')
    ok(pg.get_attribute('#opt-hints', 'aria-pressed') == 'false', 'Allow hints switched off on the setup screen')
    pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15'); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
    ok(reach(pg, MOVE_NO_DOUBLE), 'a turn with a play to make and no double to cover')
    a0 = pg.evaluate("() => window.MexicanTrainApp.state.awaiting"); 
    moves = pg.evaluate("() => window.MexicanTrainApp.state.awaiting.moves.map(m => [m.tile.join('-'), m.trainId])")
    h0, b0 = pg.evaluate(HAND), pg.evaluate(BONE)
    ok(not pg.query_selector('.slot-draw:not(.calm)') and pg.query_selector('.slot-draw.calm') is not None and not pg.is_disabled('.slot-draw.calm'), 'the hand\'s plain Draw button is there and can be pressed on your turn, though you have a play')
    pg.click('.slot-draw.calm')
    pg.wait_for_function("(h) => window.MexicanTrainApp.state.game.players[0].hand.length === h", arg=h0 + 1)
    pg.wait_for_function("() => { const a = window.MexicanTrainApp.state.awaiting; return !!a && a.kind === 'move' && a.drewThisTurn === true; }")
    ok(pg.evaluate(BONE) == b0 - 1, f'it drew: one more tile in the hand ({h0} to {h0 + 1}), one fewer in the boneyard ({b0} to {b0 - 1})')
    now_moves = pg.evaluate("() => window.MexicanTrainApp.state.awaiting.moves.map(m => [m.tile.join('-'), m.trainId])")
    ok(all(m in now_moves for m in moves), 'and your turn goes on with everything you could play before still possible')
    ok('Nothing fits' not in pg.inner_text('body') and 'cannot draw' not in pg.inner_text('body'), 'and the game said nothing about whether you had a play')
    pg.screenshot(path=f'{SHOTS}/draw_anyway_1.png')
    pg.click('.slot-draw.calm')
    pg.wait_for_function("() => document.body.innerText.includes('already drawn a tile this turn')")
    ok(pg.evaluate(HAND) == h0 + 1 and pg.evaluate(BONE) == b0 - 1, 'a second draw in the same turn is refused with a message, and changes nothing')
    tile, train = now_moves[0]
    pg.click(f'.hand .tile-btn[data-key="{tile}"]'); pg.click(f'.track[data-train="{train}"]')
    pg.wait_for_function("(h) => window.MexicanTrainApp.state.game.players[0].hand.length === h", arg=h0)
    ok(True, 'a tile is played with the mouse as usual (pick it up, then the train); the hand is back to ' + str(h0))
    ctx.close()

    print('2. double-click a tile in the hand')
    k = None
    for attempt in range(6):                                  # (games are random: play new ones until a turn has a tile with only one place to go)
        ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(base); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15'); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
        k = reach_value(pg, SOLE_TILE, 60)
        if k: break
        ctx.close()
    ok(k is not None and pg.evaluate("() => window.MexicanTrainApp.state.opts.allowHints !== false && window.MexicanTrainApp.state.showHints !== false"), 'hints on: a turn where a tile has only one place to go (one click would play it at once)')
    sel = f'.hand .tile-btn[data-key="{k}"]'
    t0 = pg.evaluate(TILE, k); h0 = pg.evaluate(HAND)
    l, r = k.split('-'); ok(t0['pips'] in ([int(l), int(r)], [int(r), int(l)]), f'the tile is {k}: {t0["label"]}')
    pg.dblclick(sel); time.sleep(0.9)
    t1 = pg.evaluate(TILE, k)
    ok(t1 is not None and pg.evaluate(HAND) == h0, 'a double-click on it does NOT play it (still in the hand after a second)')
    ok(t1 and t1['pips'] == list(reversed(t0['pips'])) and t1['label'].split(',')[0] == ' and '.join(reversed(t0['label'].split(',')[0].split(' and '))), f'it turned around: {t0["label"].split(",")[0]} is now {t1["label"].split(",")[0] if t1 else None}, and the pips drawn are the other way round')
    pg.screenshot(path=f'{SHOTS}/rotate_1.png')
    pg.dblclick(sel); time.sleep(0.9)
    t2 = pg.evaluate(TILE, k)
    ok(t2 and t2['pips'] == t0['pips'], 'a second double-click turns it back')
    pg.dblclick(sel); time.sleep(0.9); t3 = pg.evaluate(TILE, k)
    t_click = time.time(); pg.click(sel)
    still = pg.evaluate(TILE, k) is not None
    ok(still, 'a single click on it does not play it at that instant (it waits a moment to see if a second click is coming)')
    pg.wait_for_function("(k) => !document.querySelector('.hand .tile-btn[data-key=\"' + k + '\"]')", arg=k, timeout=3000)
    dt = time.time() - t_click
    ok(0.15 <= dt <= 1.5 and pg.evaluate(HAND) == h0 - 1, f'but it is played a moment later ({dt:.2f} s), once')
    # the keyboard
    reach(pg, "() => { const a = window.MexicanTrainApp.state.awaiting; return !!a && a.kind === 'move'; }")
    k2 = pg.evaluate("() => { const h = window.MexicanTrainApp.state.game.players[0].hand.find(t => t[0] !== t[1]); return h[0] + '-' + h[1]; }")
    sel2 = f'.hand .tile-btn[data-key="{k2}"]'; u0 = pg.evaluate(TILE, k2)
    pg.focus(sel2); pg.keyboard.press('r'); time.sleep(0.3); u1 = pg.evaluate(TILE, k2)
    ok(u1 and u1['pips'] == list(reversed(u0['pips'])), 'R on a focused tile turns it around')
    ctx.close()

    print('2b. hints off: a double-click turns the tile too')
    ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base); pg.wait_for_selector('#opt-hints'); pg.click('#opt-hints'); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15'); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
    reach(pg, "() => { const a = window.MexicanTrainApp.state.awaiting; return !!a && a.kind === 'move'; }")
    k3 = pg.evaluate("() => { const h = window.MexicanTrainApp.state.game.players[0].hand.find(t => t[0] !== t[1]); return h[0] + '-' + h[1]; }")
    sel3 = f'.hand .tile-btn[data-key="{k3}"]'; v0 = pg.evaluate(TILE, k3); h0 = pg.evaluate(HAND)
    pg.dblclick(sel3); time.sleep(0.7); v1 = pg.evaluate(TILE, k3)
    ok(v1 and v1['pips'] == list(reversed(v0['pips'])) and pg.evaluate(HAND) == h0 and v1['selected'] == v0['selected'], 'hints off: a double-click turns the tile around, leaves it as it was for picking up (the two clicks cancel), and plays nothing')
    pg.click(sel3); time.sleep(0.4)
    ok(pg.evaluate(TILE, k3)['selected'] is True and pg.evaluate(HAND) == h0, 'and a single click only picks it up, at once (no waiting, no playing)')
    ctx.close()

    print('3. a hosted game between two people, hints off')
    hctx = browser.new_context(viewport={'width': 1100, 'height': 950}); gctx = browser.new_context(viewport={'width': 1100, 'height': 950})
    a = hctx.new_page(); a.on('pageerror', lambda e: errors.append('Ann: ' + str(e)))
    a.goto(base); a.click('[data-action="openHost"]')
    a.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    a.fill('#net-name', 'Ann'); a.select_option('#net-rounds', '1'); a.select_option('#net-hand', '15')
    opts = a.evaluate("() => Array.from(document.querySelectorAll('#net-computer option')).map(o => [o.value, o.textContent])")
    none = [o for o in opts if o[0] == '' or 'No ' in o[1] or 'None' in o[1] or 'only' in o[1].lower()]
    if none: a.select_option('#net-computer', none[0][0])
    a.click('#net-hints')
    ok(a.get_attribute('#net-hints', 'aria-pressed') == 'false', 'the host turned Allow hints off for the game')
    a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
    code = a.eval_on_selector('.code-big', 'e => e.textContent').strip().replace('-', '')
    b = gctx.new_page(); b.on('pageerror', lambda e: errors.append('Ben: ' + str(e)))
    b.goto(base + '?join=' + code); b.wait_for_selector('#net-code'); b.fill('#net-name', 'Ben'); b.click('[data-action="joinGame"]'); b.wait_for_selector('.code-big')
    a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled", timeout=8000)
    a.click('[data-action="startOnline"]'); a.wait_for_selector('.hand-grid'); b.wait_for_selector('.hand-grid')
    ok(not a.query_selector('text=Show hints') and not b.query_selector('text=Show hints'), 'both people are playing without hints')
    # both people play until Ann has a turn with a play and no double to cover
    found = False
    t0 = time.time()
    while time.time() - t0 < 120:
        if a.evaluate(MOVE_NO_DOUBLE): found = True; break
        a.evaluate(STEP); b.evaluate(STEP); time.sleep(0.04)
    ok(found, 'Ann has a turn with a play to make and no double to cover')
    h0 = a.evaluate(HAND); b0 = a.evaluate(BONE)
    log_b = b.evaluate("() => window.MexicanTrainApp.state.log.length")
    a.click('.slot-draw.calm')
    a.wait_for_function("(h) => window.MexicanTrainApp.state.game.players[0].hand.length === h", arg=h0 + 1, timeout=8000)
    a.wait_for_function("() => { const x = window.MexicanTrainApp.state.awaiting; return !!x && x.kind === 'move' && x.drewThisTurn === true; }", timeout=8000)
    ok(a.evaluate(BONE) == b0 - 1, f'Ann\'s draw is accepted by the server: one more tile in her hand, one fewer in the boneyard ({b0} to {b0 - 1})')
    b.wait_for_function("() => window.MexicanTrainApp.state.log.slice(-8).some(l => l === 'Ann draws a tile.')", timeout=8000)         # (the page keeps only the latest lines of the log, so look at its end rather than counting from before)
    ok(True, 'Ben sees "Ann draws a tile." and nothing else: exactly what any draw looks like to him')
    a.click('.slot-draw.calm')
    a.wait_for_function("() => document.body.innerText.includes('already drawn a tile this turn')", timeout=5000)
    ok(a.evaluate(HAND) == h0 + 1, 'a second draw is refused on Ann\'s page, with a message')
    mv = a.evaluate("() => { const m = window.MexicanTrainApp.state.awaiting.moves[0]; return [m.tile.join('-'), m.trainId]; }")
    a.click(f'.hand .tile-btn[data-key="{mv[0]}"]'); a.click(f'.track[data-train="{mv[1]}"]')
    a.wait_for_function("(h) => window.MexicanTrainApp.state.game.players[0].hand.length === h", arg=h0, timeout=8000)
    ok(True, 'and Ann plays her tile as usual: the game goes on')
    a.screenshot(path=f'{SHOTS}/draw_anyway_hosted.png')
    # the game goes on to the end of the round without trouble
    done = False
    t0 = time.time()
    while time.time() - t0 < 150:
        if a.evaluate("() => !!window.MexicanTrainApp.state.modal") or b.evaluate("() => !!window.MexicanTrainApp.state.modal"): done = True; break
        a.evaluate(STEP); b.evaluate(STEP); time.sleep(0.03)
    ok(done, 'and the round is played to its end')
    hctx.close(); gctx.close()
    ok(not errors, 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
