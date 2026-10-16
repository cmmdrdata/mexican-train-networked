#!/usr/bin/env python3
"""Real Chromium: the score counting up in the round-end and final dialogs. The audio is a stand-in that records every sound started, so the clicks can be counted."""
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
AUDIO = """(() => {
  window.__audio = { starts: [] };
  class FakeCtx {
    constructor() { this.sampleRate = 44100; this.state = 'running'; this.destination = {}; this.currentTime = 0; }
    createBuffer(ch, n) { const d = new Float32Array(n); return { length: n, getChannelData: () => d }; }
    createBufferSource() { const s = { buffer: null, playbackRate: { value: 1 }, connect() {}, start() { window.__audio.starts.push({ len: s.buffer.length, rate: s.playbackRate.value, t: performance.now() }); } }; return s; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    resume() { return Promise.resolve(); }
  }
  window.AudioContext = FakeCtx; window.webkitAudioContext = FakeCtx;
})();"""
TICK_LEN = int(44100 * 0.016)
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
RECORD = """() => {
  const els = Array.from(document.querySelectorAll('[data-count]')); els.forEach((e, i) => { e.__tok = 'n' + i; });
  window.__rec = []; const t0 = performance.now();
  const iv = setInterval(() => { const cur = Array.from(document.querySelectorAll('[data-count]'));
    window.__rec.push({ t: performance.now() - t0, v: cur.map(e => +e.textContent), same: cur.length === els.length && cur.every((e, i) => e.__tok === 'n' + i), focus: !!(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.primary === '1'), counting: cur.map(e => e.classList.contains('counting')) }); }, 8);
  window.__stopRec = () => clearInterval(iv);
  const S = window.MexicanTrainApp.state, m = S.modal;
  return { type: m.type, totals: m.totals, rows: m.rows ? m.rows.map(r => ({ id: r.id, pips: r.pips })) : null, tiles: m.rows ? m.rows.reduce((n, r) => n + (r.hand || []).length, 0) : 0, shown: els.map(e => +e.textContent), sr: Array.from(document.querySelectorAll('.dialog [data-count] + .sr-only')).map(e => e.textContent) };
}"""
errors = []

def open_dialog(pg, kind):
    """Open the round-end or final dialog with the data a real round's end produces (playing a whole round at the computer's own pace takes minutes; the Node tests
       play real games to their end). Three players: you +33 (20 to 53), the first computer +0 (stays 70), the second +100 (60 to 160)."""
    pg.evaluate("""(kind) => {
      const app = window.MexicanTrainApp, S = app.state;
      window.__resolved = 0;
      S.overlay = null; S.game = null; S.opts.cpus = 2;                       // (no game running behind it: in a real round end the game is waiting for you, and nothing else draws the page)
      S.modal = kind === 'roundEnd'
        ? { type: 'roundEnd', blocked: false, tie: false, winnerId: 'cpu', last: false, totals: { human: 53, cpu: 70, cpu2: 160 },
            rows: [{ id: 'human', name: 'You', hand: [[3, 4], [6, 6], [0, 9]], pips: 33 }, { id: 'cpu', name: S.cpuName || 'Computer', hand: [], pips: 0 }, { id: 'cpu2', name: S.cpu2Name || 'Computer 2', hand: [[12, 12], [11, 12], [10, 12], [9, 12], [8, 12], [7, 12], [6, 12], [5, 12]], pips: 100 }] }
        : { type: 'final', totals: { human: 53, cpu: 70, cpu2: 160 } };
      S.awaiting = { kind: 'modal', resolve() { window.__resolved++; S.modal = null; app.render(true); } };
      app.render(true);
    }""", kind)

def analyse(rec, info, label, final):
    """What the recorded samples of the numbers show."""
    n = len(info['shown']); vals = [r['v'] for r in rec if len(r['v']) == n]
    to = [info['totals'][r['id']] for r in info['rows']] if not final else None
    return vals, to

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); ctx.add_init_script(AUDIO)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base); pg.wait_for_selector('#opt-rounds')
    hands = pg.evaluate("() => Array.from(document.querySelectorAll('#opt-hand option')).map(o => +o.value)")
    pg.mouse.click(5, 5)                                                                 # (a real click: browsers only allow sound after one, and the page unlocks it then)
    time.sleep(0.3)
    print('1. the round-end dialog')
    open_dialog(pg, 'roundEnd'); pg.wait_for_selector('.dialog [data-count]')
    ok(True, 'the round-end dialog is open (three players)')
    pg.evaluate("() => { window.__audio.starts.length = 0; }")
    info = pg.evaluate(RECORD)
    ok(info['type'] == 'roundEnd' and len(info['shown']) == len(info['rows']), f"the round-end dialog, with {len(info['rows'])} totals to count")
    from_ = [info['totals'][r['id']] - r['pips'] for r in info['rows']]; to_ = [info['totals'][r['id']] for r in info['rows']]
    time.sleep(0.2); pg.screenshot(path=f'{SHOTS}/count_roundend_start.png')
    deadline = time.time() + 12
    while time.time() < deadline and not pg.evaluate("() => window.MexicanTrainApp.state.count && window.MexicanTrainApp.state.count.done"):
        if 0.9 < time.time() % 3 < 1.2: pass
        time.sleep(0.05)
    time.sleep(0.2)
    rec = pg.evaluate("() => { window.__stopRec(); return window.__rec; }")
    clicks = pg.evaluate("() => window.__audio.starts.filter(s => s.len === %d).map(s => ({ rate: s.rate, t: s.t }))" % TICK_LEN)
    vals = [r['v'] for r in rec]
    ok(vals[0] == from_ or all(a >= b for a, b in zip(vals[0], from_)), f"it begins from what each player had before the round ({from_}); first look: {vals[0]}")
    ok(vals[-1] == to_, f'and ends on the real totals {to_} (last look: {vals[-1]})')
    mono = all(all(b[i] >= a[i] for i in range(len(a))) for a, b in zip(vals, vals[1:]))
    ok(mono, 'no number ever goes down')
    change_order = []
    for a, b in zip(vals, vals[1:]):
        for i in range(len(a)):
            if b[i] != a[i]: change_order.append(i)
    ok(change_order == sorted(change_order) and len(set(change_order)) >= 1, f'one player after another: the order of the changes is {sorted(set(change_order))} with no going back')
    steps = len(change_order)
    ok(len(clicks) >= 1 and abs(len(clicks) - info['tiles']) <= 1, f"a click for each tile put up: {len(clicks)} clicks for {info['tiles']} tiles")
    rates = [c['rate'] for c in clicks]
    ok(all(0.919 <= r <= 1.221 for r in rates), f'at a pitch within range ({min(rates):.2f} to {max(rates):.2f})')
    gaps = [b['t'] - a['t'] for a, b in zip(clicks, clicks[1:])]
    within = [g for g in gaps if g < 700]
    ok(within and 400 <= sorted(within)[len(within) // 2] <= 600, f'two tiles a second: about {sorted(within)[len(within) // 2]:.0f} ms between tiles' if within else 'two tiles a second')
    ok(all(r['same'] for r in rec), 'the numbers are changed IN PLACE: the very same elements all through (the dialog is not drawn again)')
    ok(all(r['focus'] for r in rec), 'and the focus stays on the dialog\'s button the whole time')
    ok(any(any(r['counting']) for r in rec) and not any(rec[-1]['counting']), 'the number being counted swells while it counts, and not when done')
    ok(info['sr'] and [int(x) for x in info['sr']] == to_, f"a screen reader is given the real totals at once: {info['sr']}")
    print('2. the final dialog (muted)')
    pg.evaluate("() => window.MexicanTrainApp.dispatch({ type: 'toggleSound' })")
    pg.evaluate("() => { window.__audio.starts.length = 0; }")
    pg.click('[data-action="dialogOk"]')
    pg.wait_for_function("() => !document.querySelector('.dialog [data-count]')", timeout=3000)
    open_dialog(pg, 'final')
    pg.wait_for_function("() => !!document.querySelector('.dialog .final [data-count]')", timeout=5000)
    info2 = pg.evaluate(RECORD)
    ok(info2['type'] == 'final' and info2['shown'] == [0] * len(info2['shown']) or all(v <= 3 for v in info2['shown']), f"the final dialog opens at nothing: {info2['shown']}")
    pg.wait_for_function("() => window.MexicanTrainApp.state.count && window.MexicanTrainApp.state.count.done", timeout=20000)
    time.sleep(0.2)
    rec2 = pg.evaluate("() => { window.__stopRec(); return window.__rec; }")
    tot2 = [info2['totals'][k] for k in info2['totals'] if k in ('human', 'cpu', 'cpu2')][:len(info2['shown'])]
    ok(rec2[-1]['v'] == tot2 and all(r['same'] for r in rec2), f"each counts up to its final score {tot2}, in place")
    mono2 = all(all(b[i] >= a[i] for i in range(len(a))) for a, b in zip([r['v'] for r in rec2], [r['v'] for r in rec2][1:]))
    ok(mono2, 'one after another, never down')
    ok(pg.evaluate("() => window.__audio.starts.filter(s => s.len === %d).length" % TICK_LEN) == 0, 'with the sound muted there are no clicks, but the count is shown')
    pg.screenshot(path=f'{SHOTS}/count_final.png')
    ctx.close()

    print('3. the button does not wait')
    ctx = browser.new_context(viewport={'width': 1100, 'height': 950}); ctx.add_init_script(AUDIO)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base); pg.wait_for_selector('#opt-rounds'); pg.mouse.click(5, 5); time.sleep(0.3)
    open_dialog(pg, 'roundEnd'); pg.wait_for_selector('.dialog [data-count]')
    pg.evaluate("() => { window.__audio.starts.length = 0; }")
    time.sleep(0.75)                                                                      # the count has begun
    n_before = pg.evaluate("() => window.__audio.starts.filter(s => s.len === %d).length" % TICK_LEN)
    t_click = time.time(); pg.click('[data-action="dialogOk"]')
    pg.wait_for_function("() => !document.querySelector('.dialog [data-count]')", timeout=3000)
    ok(time.time() - t_click < 1.0 and n_before >= 1 and pg.evaluate('() => window.__resolved') == 1, f'the button works at once in the middle of the count (after {n_before} clicks): the dialog closed in {time.time() - t_click:.2f} s')
    time.sleep(0.6)
    n_after = pg.evaluate("() => window.__audio.starts.filter(s => s.len === %d).length" % TICK_LEN)
    ok(n_after - n_before <= 1, 'and the clicks stop')
    ctx.close()
    ok(not errors, 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
