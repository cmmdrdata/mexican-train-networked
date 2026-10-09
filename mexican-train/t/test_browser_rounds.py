"""
The real page in a real browser (Chromium, through Playwright) against the real game server.
Everything else in t/ runs the page's code in Node with a fake DOM; this measures what is actually drawn.
Skipped (not failed) if Playwright or its Chromium is not installed:  pip install playwright && playwright install chromium
Screenshots go to $SHOTS (default /tmp/shots).
"""
import json, os, re, socket, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.environ.get('SHOTS', '/tmp/shots'); os.makedirs(SHOTS, exist_ok=True)
try:
    from playwright.sync_api import sync_playwright
except Exception:
    print('SKIPPED: Playwright is not installed'); sys.exit(0)

passed = failed = 0
def ok(cond, msg):
    global passed, failed
    if cond: passed += 1
    else: failed += 1; print('  FAIL:', msg)

def start_server(cmd):
    p = subprocess.Popen(cmd, cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return p
def free_port():
    s = socket.socket(); s.bind(('', 0)); port = s.getsockname()[1]; s.close(); return port

# the page's own helpers, run inside it: act like a player (the same actions a tap or drag triggers)
STEP = """(rnd) => {
  const A = window.MexicanTrainApp, S = A.state, a = S.awaiting, key = window.MexicanTrainGame.Engine.key;
  if (!a || (S.online && (S.online.pending || S.online.conn !== 'open'))) return 'wait';
  const d = x => A.dispatch(x);
  if (a.kind === 'modal') { d({type: 'dialogOk'}); return 'ok'; }
  if (a.kind === 'draw') { d({type: 'draw'}); return 'draw'; }
  const pick = () => a.moves[Math.floor(rnd * a.moves.length)];
  const tap = () => { const m = pick(); d({type: 'selectTile', key: key(m.tile)}); if (S.awaiting === a && !(S.online && S.online.pending)) d({type: 'playOn', train: m.trainId}); };
  if (a.kind === 'move') { tap(); return 'move'; }
  if (a.canDraw) { d({type: 'draw'}); return 'draw'; }
  if (a.canBuild && rnd < 0.3) { d({type: 'autoBuild'}); return 'auto'; }
  if (a.moves.length && rnd < 0.7) { tap(); return 'tap'; }
  if (a.canDone) { d({type: 'endBuild'}); return 'done'; }
  if (a.moves.length) { tap(); return 'tap'; }
  d({type: 'undoTile'}); return 'undo';
}"""
import random
R = random.Random(5)
def step(page): return page.evaluate(STEP, R.random())

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    errors = []
    def new_page(ctx):
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        return pg

    # ============================================================================
    srv = start_server(['node', 'browser_server.js']); line = srv.stdout.readline(); port = json.loads(line)['port']
    base = f'http://127.0.0.1:{port}/'
    PROBE = "() => { const S = window.MexicanTrainApp.state, o = S.online; return { round: S.roundIndex, modal: S.modal ? S.modal.type + (S.modal.last ? ':last' : '') : null, ended: o && o.ended ? o.ended : null, rounds: o && o.settings ? o.settings.rounds : null }; }"

    def host_and_join(ctxA, ctxB, form_rounds, lobby_rounds, computer):
        a = new_page(ctxA); a.goto(base); a.click('[data-action="openHost"]')
        a.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
        a.fill('#net-name', 'Ann'); a.select_option('#net-rounds', form_rounds); a.select_option('#net-hand', '8')
        if computer: a.select_option('#net-computer', computer)
        a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
        code = a.eval_on_selector('.code-big', 'e => e.textContent').strip()
        b = new_page(ctxB); b.goto(base + '?join=' + code.replace('-', '')); b.wait_for_selector('#net-code'); b.fill('#net-name', 'Ben'); b.click('[data-action="joinGame"]'); b.wait_for_selector('.code-big')
        a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled")
        if lobby_rounds:
            a.select_option('#net-rounds', lobby_rounds); time.sleep(0.6)
        return a, b

    print('R1. a hosted game of several rounds is played right through, in real browsers')
    for label, form_rounds, lobby_rounds, computer in [('two people, 4 rounds chosen on the first screen', '4', None, None),
                                                       ('two people and a computer, 4 rounds changed in the lobby', '1', '4', 'normal')]:
        ctxA = browser.new_context(viewport={'width': 1200, 'height': 950}); ctxB = browser.new_context(viewport={'width': 1200, 'height': 950})
        a, b = host_and_join(ctxA, ctxB, form_rounds, lobby_rounds, computer)
        sa = json.loads(a.evaluate("() => JSON.stringify(window.MexicanTrainApp.state.online.settings)")); sb = json.loads(b.evaluate("() => JSON.stringify(window.MexicanTrainApp.state.online.settings)"))
        ok(sa['rounds'] == 4 and sb['rounds'] == 4, f'{label}: both screens say 4 rounds before the start ({sa["rounds"]}, {sb["rounds"]})')
        a.click('[data-action="startOnline"]'); a.wait_for_selector('.tracks'); b.wait_for_selector('.tracks')
        for pg_ in (a, b):                                                    # each page notes every dialog it shows, however briefly
            pg_.evaluate("() => { window.__dlg = new Set(); setInterval(() => { const S = window.MexicanTrainApp.state; if (S.modal) window.__dlg.add(S.roundIndex + ':' + S.modal.type + (S.modal.last ? ':last' : '')); }, 3); }")
        t0 = time.time(); rounds_seen = []; ended = None
        while time.time() - t0 < 200:
            pa = a.evaluate(PROBE); pb = b.evaluate(PROBE)
            for p_ in (pa, pb):
                if p_['round'] is not None and p_['round'] not in rounds_seen: rounds_seen.append(p_['round'])
                if p_['ended']: ended = p_['ended']
            if ended or (pa['modal'] == 'final' and pb['modal'] == 'final'): break
            step(a); step(b); time.sleep(0.02)
        done_ = pa['modal'] == 'final' and pb['modal'] == 'final'
        ok(done_ and not ended, f'{label}: the game reached the final result on both screens, and did not end early ({ended})')
        ok(sorted(rounds_seen) == [0, 1, 2, 3], f'{label}: all four rounds were played (rounds seen: {sorted(rounds_seen)})')
        dlgs = [set(pg_.evaluate('() => [...window.__dlg]')) for pg_ in (a, b)]
        end_rounds = {int(d.split(':')[0]) for dd in dlgs for d in dd if d.split(':')[1] == 'roundEnd'} | {int(d.split(':')[0]) for dd in dlgs for d in dd if d.endswith(':roundEnd:last')}
        last_end_seen = all('3:roundEnd:last' in dd for dd in dlgs); final_before_last = any(d.split(':')[1] == 'final' and d.split(':')[0] != '3' for dd in dlgs for d in dd)
        ok(end_rounds == {0, 1, 2, 3} and last_end_seen and not final_before_last, f'{label}: a round-end dialog after every one of the four rounds, and the final result only after the last (round-end dialogs seen after rounds {sorted(end_rounds)})')
        ctxA.close(); ctxB.close()

    print('R2. the computer comments in a hosted game')
    ctxA = browser.new_context(viewport={'width': 1200, 'height': 950}); ctxB = browser.new_context(viewport={'width': 1200, 'height': 950})
    a, b = host_and_join(ctxA, ctxB, '1', None, 'normal')
    a.click('[data-action="startOnline"]'); a.wait_for_selector('.tracks'); b.wait_for_selector('.tracks')
    a.wait_for_function("() => window.MexicanTrainApp.state.awaiting"); b.wait_for_function("() => window.MexicanTrainApp.state.awaiting")
    comp = a.evaluate("() => window.MexicanTrainApp.state.cpu2Name")
    ok('Comments: on' in a.inner_text('.opp') and 'Comments: on' in b.inner_text('.opp'), 'each screen has a Comments button next to the computer')
    time.sleep(28)                                                          # two people taking their time: the computer has something to say to each
    BUBBLE = "() => { const el = document.querySelector('.bubble'); return el ? { who: el.querySelector('b').textContent, text: el.querySelector('span').textContent, opacity: getComputedStyle(el).opacity } : null; }"
    ba = a.evaluate(BUBBLE); bb = b.evaluate(BUBBLE)
    ok(ba and bb and ba['who'] == comp and bb['who'] == comp and len(ba['text']) > 5 and len(bb['text']) > 5, f'after 25+ seconds of dithering the computer ({comp}) has said something on both real screens: "{(ba or {}).get("text")}" / "{(bb or {}).get("text")}"')
    a.screenshot(path=f'{SHOTS}/hosted_computer_remark.png')
    a.click('.chat-toggle[data-action="toggleChat"]'); time.sleep(0.3)
    ok(a.evaluate(BUBBLE) is None and 'Comments: off' in a.inner_text('.opp'), 'Comments: off takes the bubble away at once, on that screen')
    ctxA.close(); ctxB.close()

    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:3]) if errors else ''))
    browser.close()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
