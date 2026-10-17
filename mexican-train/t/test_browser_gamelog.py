#!/usr/bin/env python3
"""Real Chromium against a real `node server.js`: a game played in the page is logged into the server's games directory, and ONLY when its round has ended.
   (1) nothing is in the games directory while a round is being played (no file, however long you wait); (2) when the round ends the log appears; (3) it is a real log:
   the checker says it adds up, it has the deal (every hand and the whole boneyard), and the page's build; (4) a game left half way writes its dead round, as aborted;
   (5) the server's banner says where the logs go, and the directory was made."""
import json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

TMP = tempfile.mkdtemp(prefix='mt-gl-'); GAMES = os.path.join(TMP, 'deeper', 'games')       # (a directory that does not exist yet: the server must make it)
PORT = free_port()
srv = subprocess.Popen(['node', os.path.join(ROOT, 'server.js'), '--port', str(PORT), '--local-only', '--no-public-ip', '--games-dir', GAMES], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
banner = ''
t0 = time.time()
while time.time() - t0 < 15:
    try:
        urllib.request.urlopen(f'http://127.0.0.1:{PORT}/healthz', timeout=1).read(); break
    except Exception: time.sleep(0.2)
time.sleep(0.3)
BASE = f'http://127.0.0.1:{PORT}/'

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
LAID = "() => { const g = window.MexicanTrainApp.state.game; return g ? Object.values(g.trains).reduce((n, t) => n + t.tiles.length, 0) : 0; }"
MODAL = "() => { const m = window.MexicanTrainApp.state.modal; return m ? m.type : null; }"
logs = lambda: sorted(f for f in os.listdir(GAMES) if f.endswith('.jsonl')) if os.path.isdir(GAMES) else []
def start_game(pg, rounds='1'):
    pg.goto(BASE); pg.wait_for_selector('#opt-rounds'); pg.select_option('#opt-rounds', rounds); pg.select_option('#opt-hand', '8')
    pg.click('[data-action="startGame"]'); pg.wait_for_selector('.hand-grid')
errors = []
try:
    print('1. the server')
    ok(os.path.isdir(GAMES), 'the games directory (and the directory above it that did not exist) was made when the server started')
    with sync_playwright() as pw:
        browser = pw.chromium.launch(); ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        # (the page paces the computer like a person: a whole round takes minutes. Every timer's delay is cut short so that a REAL round, through the real round loop and the real
        #  recorder, takes seconds. While the page waits for ME it is not going anywhere, so a round cannot end behind my back during the checks that nothing is written.)
        ctx.add_init_script("(() => { const st = window.setTimeout.bind(window); window.setTimeout = (f, ms, ...a) => st(f, typeof ms === 'number' ? Math.min(ms, 12) : ms, ...a); })();")
        build = None
        print('2. nothing is written while a round is being played')
        start_game(pg)
        build = pg.evaluate("() => window.MT_BUILD || ''")
        t1 = time.time()
        while time.time() - t1 < 90 and pg.evaluate(LAID) < 10: pg.evaluate(STEP); time.sleep(0.04)
        ok(pg.evaluate(LAID) >= 10 and pg.evaluate(MODAL) is None, f"a round is under way ({pg.evaluate(LAID)} tiles laid)")
        time.sleep(3.5)                                   # (longer than the old 1.5 second batch time, so that a timer that still sent things would have)
        ok(logs() == [], f'after waiting, with the round still being played, the games directory has no log in it: {logs()}')
        print('3. when the round ends, its log appears')
        t2 = time.time()
        while time.time() - t2 < 240 and pg.evaluate(MODAL) != 'roundEnd': pg.evaluate(STEP); time.sleep(0.03)
        ok(pg.evaluate(MODAL) == 'roundEnd', 'the round ended')
        t3 = time.time()
        while time.time() - t3 < 10 and not logs(): time.sleep(0.2)
        files = logs()
        ok(len(files) == 1 and '-local-' in files[0], f'its log is there now, one file: {files}')
        path = os.path.join(GAMES, files[0]) if files else None
        events = [json.loads(l) for l in open(path, encoding='utf-8').read().splitlines() if l.strip()] if path else []
        kinds = [e['e'] for e in events]
        ok(kinds[:2] == ['game', 'round'] and kinds[-1] == 'roundEnd' and kinds.count('round') == 1, f"it runs from the game and the deal to the result of the round ({len(events)} events)")
        deal = next((e for e in events if e['e'] == 'round'), {})
        ok(len(deal.get('hands', {}).get('human', [])) == 8 and len(deal.get('hands', {}).get('cpu', [])) == 8 and len(deal.get('boneyard', [])) == 74, 'the deal has both hands (8 tiles each) and the whole boneyard (74)')
        ok(events and events[0].get('mode') == 'local' and events[0].get('build') == build and build != '', f"the game event says it was played in the page, and which build ({events[0].get('build') if events else None})")
        r = subprocess.run(['node', os.path.join(ROOT, 'tools', 'check_gamelog.js'), path], capture_output=True, text=True) if path else None
        ok(r is not None and r.returncode == 0 and 'ADDS UP' in r.stdout, 'the checker says the log adds up' + ('' if r is None or r.returncode == 0 else ': ' + r.stdout[-300:]))
        pg.screenshot(path=os.path.join(TMP, 'roundend.png'))
        print('4. a game that is left, or whose page is closed, half way')
        pg.click('[data-action="dialogOk"]'); time.sleep(0.5)
        hist = []; th = time.time()
        while time.time() - th < 10 and not hist:
            hist = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/history', timeout=3).read()).get('games', []); time.sleep(0.2)
        ok(len(hist) == 1 and hist[0]['result'] == 'finished' and hist[0]['roundsPlayed'] == 1 and len(hist[0]['players']) == 2, f'the finished one-player game is in the list of past games: {hist}')
        ok(hist and sum(1 for p in hist[0]['players'] if p['computer']) == 1 and any(not p['computer'] for p in hist[0]['players']), 'with the person and the computer')
        before = logs()
        start_game(pg, '4')
        t4 = time.time()
        while time.time() - t4 < 90 and pg.evaluate(LAID) < 8: pg.evaluate(STEP); time.sleep(0.04)
        time.sleep(2)
        ok(logs() == before, 'a new game, under way: no new file')
        pg.goto(BASE); pg.wait_for_selector('#opt-rounds'); time.sleep(1.5)       # (the page is reloaded: that game is gone with it)
        ok(logs() == before, 'the page is reloaded in the middle of the round: nothing is written (a round that is only lost is not given away; the price of not writing during a round)')
        start_game(pg, '4')
        t5 = time.time()
        while time.time() - t5 < 90 and pg.evaluate(LAID) < 8: pg.evaluate(STEP); time.sleep(0.04)
        time.sleep(1)
        ok(logs() == before, 'another game under way: still nothing')
        pg.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'startGame', rounds: 1, hand: 8, style: 'pips', level: 'easy' })")      # (a new game, in the page, over the one that is half played)
        t6 = time.time()
        while time.time() - t6 < 10 and len(logs()) == len(before): time.sleep(0.2)
        after = logs()
        ok(len(after) == len(before) + 1, f'starting a new game over it writes its log at once: {len(after) - len(before)} new file')
        new = [f for f in after if f not in before]
        ev2 = [json.loads(l) for l in open(os.path.join(GAMES, new[0]), encoding='utf-8').read().splitlines() if l.strip()] if new else []
        ok(ev2 and ev2[-1]['e'] == 'gameEnd' and ev2[-1].get('how') == 'aborted' and any(e['e'] == 'round' for e in ev2), 'it holds the round that was left, and ends "aborted"')
        r2 = subprocess.run(['node', os.path.join(ROOT, 'tools', 'check_gamelog.js'), os.path.join(GAMES, new[0])], capture_output=True, text=True) if new else None
        ok(r2 is not None and r2.returncode == 0, 'and it adds up')
        ok(not errors, 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
        ctx.close(); browser.close()
finally:
    srv.terminate()
    try: out = srv.communicate(timeout=5)[0]
    except Exception: out = ''
    shutil.rmtree(TMP, ignore_errors=True)
print('5. the banner')
ok('Game logs:' in out and 'deeper' in out and 'games' in out, 'the server said, when it started, where the logs go')
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
