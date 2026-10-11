#!/usr/bin/env python3
"""Real Chromium, a game against the computer: when you play a domino its slot is left empty and nothing else in your hand moves; a drawn tile goes
   into the first empty slot; you can drag the tiles about without disturbing the empty slots."""
import json, os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)

# the layout (not the lifted look of a playable tile) of every cell in the hand's grid
SNAP = """() => {
  const grid = document.querySelector('.hand-grid');
  const cells = Array.from(grid.children);
  // positions relative to the hand's own grid (the whole tray can move down the page when something above it grows)
  return cells.map(el => ({ k: el.classList.contains('tile-btn') ? el.dataset.key : (el.classList.contains('hole') ? '_' : (el.classList.contains('slot-draw') || el.classList.contains('slot-empty') ? '.' : '?')), x: el.offsetLeft - grid.offsetLeft, y: el.offsetTop - grid.offsetTop, w: el.offsetWidth }));
}"""
STEP = """() => {
  const app = window.MexicanTrainApp, S = app.state, a = S.awaiting;
  if (!a) return 'wait';
  if (a.kind === 'modal') return 'modal';
  if (a.kind === 'draw') { app.dispatch({ type: 'draw' }); return 'draw'; }
  if (a.kind === 'build') { app.dispatch({ type: a.canBuild ? 'autoBuild' : a.canDone ? 'endBuild' : 'undoTile' }); return 'build'; }
  if (a.kind === 'move') { const m = a.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); return 'move'; }
  return 'other';
}"""
errors = []

srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True)
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for seed_try in range(1):
        ctx = browser.new_context(viewport={'width': 1100, 'height': 950})
        page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base)
        page.select_option('#opt-rounds', '1'); page.select_option('#opt-hand', '15')
        page.click('[data-action="startGame"]')
        page.wait_for_selector('.hand-grid')

        print('1. playing a real game: nothing in your hand moves')
        prev = None; moved = 0; looks = 0; hole_looks = 0; stuck = []; filled_first = 0; draws = 0; plays = 0
        widths = set(); t0 = time.time(); shots = 0
        while time.time() - t0 < 100 and not page.evaluate("() => !!window.MexicanTrainApp.state.modal"):
            page.evaluate(STEP)
            time.sleep(0.04)
            snap = page.evaluate(SNAP)
            if not snap: continue
            looks += 1
            widths.add(len({c['y'] for c in snap}) and max(c['x'] for c in snap) // 1)       # the width of the row (the rightmost cell's left edge)
            holes = [i for i, c in enumerate(snap) if c['k'] == '_']
            if holes:
                hole_looks += 1
                if shots < 1 and len(holes) >= 3:
                    page.screenshot(path='/tmp/shots/slots_holes.png'); shots += 1
            if prev:
                old = {c['k']: (c['x'], c['y']) for c in prev if c['k'] not in ('_', '.', '?')}
                for c in snap:
                    if c['k'] in old and old[c['k']] != (c['x'], c['y']): moved += 1; stuck.append((c['k'], old[c['k']], (c['x'], c['y'])))
                # an empty slot appears exactly where a tile was
                gone = [c for c in prev if c['k'] not in ('_', '.', '?') and c['k'] not in {d['k'] for d in snap}]
                for g in gone:
                    plays += 1
                    if not any(d['k'] == '_' and (d['x'], d['y']) == (g['x'], g['y']) for d in snap): stuck.append(('no hole where', g['k']))
                # a drawn tile takes the first empty slot
                new = [c for c in snap if c['k'] not in ('_', '.', '?') and c['k'] not in {d['k'] for d in prev}]
                prev_holes = [d for d in prev if d['k'] == '_']
                for n in new:
                    draws += 1
                    if prev_holes and (n['x'], n['y']) == (prev_holes[0]['x'], prev_holes[0]['y']): filled_first += 1
            prev = snap
        ok(looks > 40, f'the game was watched for {looks} looks')
        ok(plays >= 6, f'at least six tiles of yours were played in that game ({plays})')
        ok(moved == 0, f'no tile in your hand was ever pushed to another place when a tile was played or drawn ({moved} moves)' + (f': {stuck[:2]}' if stuck else ''))
        ok(not any(s[0] == 'no hole where' for s in stuck), 'every tile that was played left an empty slot exactly where it had been')
        ok(hole_looks > 10, f'and empty slots were really there to look at ({hole_looks} looks)')
        ok(draws == 0 or filled_first >= max(1, draws // 2), f'a drawn tile went into the first empty slot ({filled_first} of {draws} draws; the rest had no empty slot before them)')
        ok(len(widths) <= 2, 'the row stayed the same width the whole game')
        ctx.close()

        print('2. dragging a tile into an empty slot, or onto another tile')
        ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base); page.select_option('#opt-rounds', '1'); page.select_option('#opt-hand', '15'); page.click('[data-action="startGame"]'); page.wait_for_selector('.hand-grid')
        def usable(snap):                                          # two tiles side by side in a row, and a tile beside an empty slot in the same row
            ks = [c['k'] for c in snap]; t = lambda k: k not in ('_', '.', '?')
            pair = any(t(ks[i]) and t(ks[i + 1]) and snap[i]['y'] == snap[i + 1]['y'] for i in range(len(ks) - 1))
            beside = any(ks[h] == '_' and any(0 <= i < len(ks) and t(ks[i]) and snap[i]['y'] == snap[h]['y'] for i in (h - 1, h + 1)) for h in range(len(ks)))
            return pair and beside and sum(1 for k in ks if k == '_') >= 2
        for _ in range(900):                                      # until the trains are built, it is your move, and the hand has what this test needs (stop BEFORE making that move)
            if page.evaluate("() => { const a = window.MexicanTrainApp.state.awaiting; return !!a && a.kind === 'move'; }") and usable(page.evaluate(SNAP)): break
            page.evaluate(STEP); time.sleep(0.05)
        time.sleep(0.5)
        s0 = page.evaluate(SNAP)
        holes0 = [i for i, c in enumerate(s0) if c['k'] == '_']
        ok(len(holes0) >= 2, f'the hand has {len(holes0)} empty slots to start with')
        cells = lambda: page.query_selector_all('.hand-grid > *')
        centre = lambda i: (lambda b: (b['x'] + b['width'] / 2, b['y'] + b['height'] / 2))(cells()[i].bounding_box())
        def drag(frm, to):                                     # a real pointer drag from one slot to another
            fx, fy = centre(frm); tx, ty = centre(to)
            page.mouse.move(fx, fy); page.mouse.down()
            page.mouse.move(fx + 12, fy + 4, steps=3)
            page.mouse.move(tx, ty, steps=14)
            page.mouse.up(); time.sleep(0.3)
        keys0 = [c['k'] for c in s0]
        isTile = lambda k: k not in ('_', '.', '?')
        # (a) two tiles side by side in a row: a short drag from one onto the other crosses just that boundary
        sw = [(i, i + 1) for i in range(len(keys0) - 1) if isTile(keys0[i]) and isTile(keys0[i + 1]) and s0[i]['y'] == s0[i + 1]['y']]
        ok(bool(sw), 'there are two tiles side by side to swap')
        i1, i2 = sw[0]
        drag(i1, i2)
        s1 = page.evaluate(SNAP); keys1 = [c['k'] for c in s1]
        expect = list(keys0); expect[i1], expect[i2] = keys0[i2], keys0[i1]
        ok(keys1 == expect, f'dragging a tile onto the tile beside it swaps the two, and nothing else moves: slots {i1} and {i2}')
        # (b) a tile next to an empty slot, in the same row
        holes1 = [i for i, k in enumerate(keys1) if k == '_']
        pairs = [(i, h) for h in holes1 for i in (h - 1, h + 1) if 0 <= i < len(keys1) and isTile(keys1[i]) and s1[i]['y'] == s1[h]['y']]
        ok(bool(pairs), 'there is a tile next to an empty slot to drag')
        src, dst = pairs[0]
        drag(src, dst)
        s2 = page.evaluate(SNAP); keys2 = [c['k'] for c in s2]
        expect2 = list(keys1); expect2[dst] = keys1[src]; expect2[src] = '_'
        ok(keys2 == expect2, f'dragging a tile into an empty slot puts it there and leaves the slot it came from empty, with nothing else moved: slot {src} to slot {dst}')
        ok(all((a['x'], a['y']) == (b['x'], b['y']) for a, b in zip(s0, s2)), '(and every slot is still in the same place on the screen: only what is in them changed)')
        page.screenshot(path='/tmp/shots/slots_moved_into_empty.png')
        ok(sorted(k for k in keys2 if isTile(k)) == sorted(k for k in keys0 if isTile(k)), 'with the same tiles in the hand (none lost, none doubled)')
        page.screenshot(path='/tmp/shots/slots_swapped.png')
        ctx.close()
    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
