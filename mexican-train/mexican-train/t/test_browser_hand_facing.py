#!/usr/bin/env python3
"""Real Chromium: in your hand, tiles that lie side by side and share a number are drawn so that the like halves face each other. Checked on the real
   layout (the grid wraps to the width of the screen: which tiles are side by side is read from where they really are), at a desktop and a phone width, after
   the window is resized, and while a game is played."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = '/tmp/shots'; os.makedirs(SHOTS, exist_ok=True)
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)

srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True)
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"

SNAP = """() => {
  const grid = document.querySelector('.hand-grid'); if (!grid) return null;
  const S = window.MexicanTrainApp.state;
  const cells = Array.from(grid.children).map(el => {
    const r = { top: el.offsetTop, left: el.offsetLeft, tile: el.classList.contains('tile-btn'), hole: el.classList.contains('hole') };
    if (r.tile) {
      const m = /^(\\d+) and (\\d+)/.exec(el.getAttribute('aria-label')); r.l = +m[1]; r.r = +m[2]; r.key = el.dataset.key;
      const gs = Array.from(el.querySelectorAll('svg > g')).map(g => g.querySelectorAll('circle').length); r.pips = gs;
    }
    return r;
  });
  return { cells, handCols: S.handCols, dragging: !!S.dragKey };
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

def rows_of(snap):
    """the runs of tiles that really lie side by side on screen: same row (same top), consecutive cells, no empty slot between"""
    runs = []; cur = []
    for c in snap['cells']:
        if c['tile']:
            if cur and cur[-1]['top'] == c['top']: cur.append(c)
            else:
                if cur: runs.append(cur)
                cur = [c]
        else:
            if cur: runs.append(cur)
            cur = []
    if cur: runs.append(cur)
    return runs

def best_matches(run):
    free = [k for k, t in enumerate(run) if t['l'] != t['r']]
    best = 0
    for mask in range(1 << len(free)):
        a = [0] * len(run)
        for b, k in enumerate(free): a[k] = (mask >> b) & 1
        m = 0
        for k in range(len(run) - 1):
            r = run[k]['l'] if a[k] else run[k]['r']; l = run[k + 1]['r'] if a[k + 1] else run[k + 1]['l']
            if r == l: m += 1
        best = max(best, m)
    return best
def matches(run): return sum(1 for k in range(len(run) - 1) if run[k]['r'] == run[k + 1]['l'])

def check(snap, label):
    runs = [r for r in rows_of(snap) if len(r) > 1]
    bad = [[(t['l'], t['r']) for t in r] for r in runs if matches(r) < best_matches(r)]
    pips = [t for c in snap['cells'] if c['tile'] for t in [c] if t['pips'] != [t['l'], t['r']]]
    pairs = sum(1 for r in runs for k in range(len(r) - 1) if {r[k]['l'], r[k]['r']} & {r[k + 1]['l'], r[k + 1]['r']})
    faced = sum(1 for r in runs for k in range(len(r) - 1) if r[k]['r'] == r[k + 1]['l'])
    return bad, pips, pairs, faced

errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for (w, h, name) in ((1100, 950, 'desktop'), (390, 800, 'phone')):
        print(f'{name} {w}x{h}')
        ctx = browser.new_context(viewport={'width': w, 'height': h}); pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(base); pg.select_option('#opt-rounds', '1'); pg.select_option('#opt-hand', '15'); pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid'); time.sleep(1.5)
        s0 = pg.evaluate(SNAP)
        tops = sorted({c['top'] for c in s0['cells']})
        per_row = [sum(1 for c in s0['cells'] if c['top'] == t) for t in tops]
        ok(s0['handCols'] == per_row[0], f"{name}: the page measured the real row length ({s0['handCols']}) and it is what is on the screen ({per_row[0]} cells in the first row, {len(tops)} rows)")
        bad, pips, pairs, faced = check(s0, name)
        ok(not bad and not pips, f'{name}: at the start every row of tiles side by side has the most facing pairs possible, and the drawn pips match each tile\'s numbers ({bad[:1]})')
        looks = pairs_total = faced_total = 0; bad_all = []; t0 = time.time()
        while time.time() - t0 < 40 and not pg.evaluate("() => !!window.MexicanTrainApp.state.modal"):
            pg.evaluate(STEP); time.sleep(0.05)
            sn = pg.evaluate(SNAP)
            if not sn or sn['dragging']: continue
            looks += 1
            b, p, pr, fc = check(sn, name); pairs_total += pr; faced_total += fc
            if b or p: bad_all.append((b[:1], len(p)))
        ok(looks > 25 and not bad_all, f'{name}: through {looks} looks while the game was played, every row was as good as it could be{" (" + str(bad_all[:1]) + ")" if bad_all else ""}')
        ok(pairs_total > 20 and faced_total >= pairs_total * 0.5, f'{name}: pairs with a number in common were mostly drawn facing ({faced_total} of {pairs_total} on those looks; the rest could not all be, a tile has two sides)')
        pg.screenshot(path=f'{SHOTS}/facing_{name}.png')
        if name == 'desktop':
            print('the window is made narrower, then wider')
            sn = pg.evaluate(SNAP); before = sn['handCols']
            pg.set_viewport_size({'width': 640, 'height': 900}); time.sleep(0.8)
            sn = pg.evaluate(SNAP)
            tops = sorted({c['top'] for c in sn['cells']}); first = sum(1 for c in sn['cells'] if c['top'] == tops[0])
            ok(sn['handCols'] == first and first < before, f"narrower: the hand now has {first} in a row (it had {before}); the page measured it again: {sn['handCols']}")
            b, p, pr, fc = check(sn, 'narrow'); ok(not b and not p, f'narrower: and the tiles that are now side by side face each other as well as they can ({b[:1]})')
            pg.screenshot(path=f'{SHOTS}/facing_narrow.png')
            pg.set_viewport_size({'width': 1300, 'height': 900}); time.sleep(0.8)
            sn = pg.evaluate(SNAP); tops = sorted({c['top'] for c in sn['cells']}); first = sum(1 for c in sn['cells'] if c['top'] == tops[0])
            b, p, pr, fc = check(sn, 'wide')
            ok(sn['handCols'] == first and not b and not p, f"wider: {first} in a row, measured {sn['handCols']}, and facing as well as it can be")
        ctx.close()
    ok(not errors, 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
