#!/usr/bin/env python3
"""Real Chromium: the Expert level. It is offered in the setup dialog; its thinking is fast enough in a browser; a whole round against an Expert
   is played to the end with no errors; its tag says Expert; and in the Lord of the Rings theme it is Gandalf, Galadriel or Saruman."""
import json, os, subprocess, sys, time
PART = sys.argv[1] if len(sys.argv) > 1 else 'all'      # 'quick' (everything but the long round), 'round' (only the round), or 'all'
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
  if (!a) return 'wait';
  if (a.kind === 'modal') return 'modal';
  if (a.kind === 'draw') { app.dispatch({ type: 'draw' }); return 'draw'; }
  if (a.kind === 'build') { app.dispatch({ type: a.canDraw ? 'draw' : a.canBuild ? 'autoBuild' : a.canDone ? 'endBuild' : 'undoTile' }); return 'build'; }
  if (a.kind === 'move') { const m = a.moves[0]; app.dispatch({ type: 'selectTile', key: m.tile[0] + '-' + m.tile[1] }); if (S.awaiting === a) app.dispatch({ type: 'playOn', train: m.trainId }); return 'move'; }
  return 'other';
}"""
TIMING = """async () => {
  const E = window.MexicanTrainGame.Engine, times = []; let n = 0;
  for (let seed = 1; seed <= 60 && times.length < 30; seed++) {
    const g = E.newRound({ engine: 12, handSize: 12, rng: E.mulberry32(seed), players: 2 });
    const p = g.players[0], ms = E.legalMoves(g, p); if (ms.length < 3) continue;
    const t0 = performance.now(); const m = await E.cpuChooseAsync(g, p, ms, 'expert'); times.push(performance.now() - t0);
    if (!ms.includes(m)) return { error: 'not a legal move' };
  }
  times.sort((a, b) => a - b);
  return { n: times.length, median: times[Math.floor(times.length / 2)], max: times[times.length - 1] };
}"""
errors = []

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base + '?seed=11')
    print('1. the setup dialog')
    opts = page.evaluate("() => Array.from(document.querySelectorAll('#opt-level option')).map(o => [o.value, o.textContent])")
    ok([v for v, _ in opts] == ['easy', 'normal', 'hard', 'expert'], f'the computer\'s skill has four choices: {[v for v, _ in opts]}')
    ok(opts[3][1] == 'Expert: thinks several moves ahead' and 'blocks you' in opts[2][1], f'described: {[t for _, t in opts[2:]]}')
    ok(page.evaluate("() => Array.from(document.querySelectorAll('#opt-level2 option')).map(o => o.value).join()") == 'easy,normal,hard,expert', 'and so does the second computer\'s')
    ok('Expert also thinks several moves ahead' in page.inner_text('.dialog') and 'plays like Hard' in page.inner_text('.dialog'), 'the dialog says what Expert does, and that with two computers it plays like Hard')

    print('2. how fast it thinks, in the browser')
    t = page.evaluate(TIMING)
    ok(t.get('n', 0) >= 20 and t['median'] < 110 and t['max'] < 400, f"an Expert decision takes {t.get('median', 0):.0f} ms typically and {t.get('max', 0):.0f} ms at most (over {t.get('n')} positions in Chromium)")

    print('3. a whole round against an Expert')
    page.select_option('#opt-rounds', '1'); page.select_option('#opt-hand', '8'); page.select_option('#opt-level', 'expert')
    # (the computer's pauses are shortened, so that the time the game takes is the time the Expert needs to think)
    page.evaluate("() => { const P = window.MexicanTrainGame.PACE; Object.keys(P).forEach(k => { P[k] = [15, 30]; }); }")
    page.click('[data-action="startGame"]'); page.wait_for_selector('.tracks')
    page.wait_for_function("() => window.MexicanTrainApp.state.awaiting")
    name = page.evaluate("() => window.MexicanTrainApp.state.cpuName")
    pools = page.evaluate("() => window.MexicanTrainGame.CPU_PLAYERS.expert")
    ok(name in pools, f'the computer is {name}, one of the eight classic Experts')
    ok(page.text_content('.tag-expert').strip() == 'Expert', 'its tag says Expert (in its own colour)')
    page.screenshot(path='/tmp/shots/expert_game.png')
    t0 = time.time()
    if PART == 'quick': pass
    while PART != 'quick' and time.time() - t0 < 230 and page.evaluate("() => { const m = window.MexicanTrainApp.state.modal; return m ? m.type : null; }") != 'roundEnd':
        page.evaluate(STEP); time.sleep(0.05)
    if PART != 'quick':
        ok(page.evaluate("() => { const m = window.MexicanTrainApp.state.modal; return m ? m.type : null; }") == 'roundEnd', f'the whole round is played against the Expert, with the computer\'s pauses cut short, in {time.time() - t0:.0f} s')
        ok('See final score' in page.inner_text('.dialog'), 'and the round-end dialog is shown')

    print('4. in the Lord of the Rings theme')
    if PART == 'round': ok(errors == [], 'no JavaScript errors'); browser.close(); srv.terminate(); print(f'\n{passed} passed, {failed} failed'); sys.exit(1 if failed else 0)
    page.goto(base + '?seed=12')
    page.select_option('#opt-theme', 'lotr'); page.select_option('#opt-level', 'expert'); page.select_option('#opt-rounds', '1'); page.select_option('#opt-hand', '8')
    page.click('[data-action="startGame"]'); page.wait_for_selector('.tracks')
    nm = page.evaluate("() => window.MexicanTrainApp.state.cpuName")
    ok(nm in ('Gandalf', 'Galadriel', 'Saruman'), f'an Expert is Gandalf, Galadriel or Saruman: {nm}')
    page.goto(base + '?seed=13')
    page.select_option('#opt-theme', 'lotr'); page.select_option('#opt-level', 'hard'); page.select_option('#opt-rounds', '1'); page.select_option('#opt-hand', '8')
    page.click('[data-action="startGame"]'); page.wait_for_selector('.tracks')
    nm = page.evaluate("() => window.MexicanTrainApp.state.cpuName")
    ok(nm in ('Aragorn', 'Elrond') and page.text_content('.tag-hard').strip() == 'Hard', f'and a Hard one is Aragorn or Elrond: {nm}')

    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
