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
    def start_single(page, port, seed, hand, level='easy'):
        page.goto(f'http://127.0.0.1:{port}/?seed={seed}')
        page.select_option('#opt-rounds', '1'); page.select_option('#opt-hand', str(hand)); page.select_option('#opt-level', level)
        page.click('[data-action="startGame"]')
        page.wait_for_function("() => window.MexicanTrainApp.state.awaiting")
    def find_deal(page, port, hand, cond, seeds=range(1, 80)):
        """a deal (page ?seed=N) whose first prompt satisfies cond: the page is left on that game"""
        for seed in seeds:
            start_single(page, port, seed, hand)
            first = page.evaluate("() => { const a = window.MexicanTrainApp.state.awaiting; return { moves: a.moves ? a.moves.length : 0, canBuild: !!a.canBuild, n: a.buildCount || 0 }; }")
            if cond(first): return seed, first
        return None, None
    SAMPLE = """() => { const S = window.MexicanTrainApp.state, a = S.awaiting;
      return { turn: !!a && a.kind !== 'modal', kind: a && a.kind, modal: !!S.modal,
        tiles: [...document.querySelectorAll('.tile-btn')].map(b => ({ op: parseFloat(getComputedStyle(b).opacity), playable: b.classList.contains('playable'), idle: b.classList.contains('idle') })) }; }"""

    print('1. the hand is dimmed when it is not your turn (a game against the computer)')
    port = free_port(); srv = start_server(['node', '../server.js', '--port', str(port), '--quiet']); time.sleep(1.2)
    ctx = browser.new_context(viewport={'width': 1100, 'height': 900}); page = new_page(ctx)
    seed, first = find_deal(page, port, 12, lambda f: f['moves'] > 0)
    ok(seed is not None, f'a deal with real choices was found (seed {seed})')
    waiting = []; mine = []; shots = set()
    t0 = time.time(); prev_waiting = False
    while time.time() - t0 < 70:
        st = page.evaluate(SAMPLE)
        if st['modal']: break
        if st['turn']:
            time.sleep(0.45); st2 = page.evaluate(SAMPLE)                    # a quarter of a second later it is still your turn: any fade is over
            if st2['turn'] and st2['kind'] == st['kind'] and st2['tiles']:
                mine.append(st2)
                if any(t['playable'] for t in st2['tiles']) and 'turn' not in shots: page.screenshot(path=f'{SHOTS}/hand_your_turn.png'); shots.add('turn')
            step(page); prev_waiting = False
        else:
            if prev_waiting and st['tiles']:
                time.sleep(0.4); st2 = page.evaluate(SAMPLE)
                if not st2['turn'] and st2['tiles']:
                    waiting.append(st2)
                    if 'wait' not in shots and len(st2['tiles']) > 6 and not st2['modal']: page.screenshot(path=f'{SHOTS}/hand_dimmed_waiting.png'); shots.add('wait')
            prev_waiting = True; time.sleep(0.15)
    ok(len(waiting) >= 3 and len(mine) >= 3, f'both states were seen in a real game ({len(waiting)} samples of waiting, {len(mine)} of your turn)')
    ok(all(abs(t['op'] - 0.4) < 0.03 for s_ in waiting for t in s_['tiles']), 'while it is not your turn every tile in the hand is drawn dimmed (computed opacity 0.4)')
    ok(all(t['idle'] for s_ in waiting for t in s_['tiles']), '(they carry the "idle" style)')
    playable = [t for s_ in mine for t in s_['tiles'] if t['playable']]
    ok(len(playable) > 0 and all(abs(t['op'] - 1.0) < 0.03 for t in playable), f'on your turn the {len(playable)} tiles you can play are at full strength (opacity 1)')
    ok(not any(t['idle'] for s_ in mine for t in s_['tiles']), 'and nothing is marked idle on your turn')
    ctx.close(); srv.terminate()

    # ============================================================================
    print('2. room for two more dominoes after the last tile of every train')
    for label, vw in [('wide screen', 1200), ('phone', 420)]:
        port = free_port(); srv = start_server(['node', '../server.js', '--port', str(port), '--quiet']); time.sleep(1.2)
        ctx = browser.new_context(viewport={'width': vw, 'height': 900}); page = new_page(ctx)
        seed, first = find_deal(page, port, 15, lambda f: f['canBuild'] and f['n'] >= 8)
        ok(seed is not None, f'{label}: a deal with a long train to build was found (seed {seed}, {first and first["n"]} tiles)')
        page.evaluate("() => window.MexicanTrainApp.dispatch({type: 'autoBuild'})")
        t0 = time.time()
        while time.time() - t0 < 30 and page.evaluate("() => document.querySelectorAll('.track[data-train=\"human\"] .tile[data-idx]').length") < 8: time.sleep(0.3)
        time.sleep(1.2)
        GEOM = """() => [...document.querySelectorAll('.track')].map(tr => {
          const sc = tr.querySelector('.scroller'), tt = tr.querySelector('.track-tiles');
          const tiles = [...tt.querySelectorAll('.tile')], last = tiles[tiles.length - 1];
          const s = parseFloat(getComputedStyle(tr).getPropertyValue('--s')), lyingWidth = s * 1.9615;
          const lr = last.getBoundingClientRect(), tr_ = tt.getBoundingClientRect(), sr = sc.getBoundingClientRect();
          return { id: tr.dataset.train, n: tiles.length - 1, lying: lyingWidth,
                   afterLastInRow: tr_.right - lr.right, visibleAfterLast: sr.right - lr.right,
                   atEnd: sc.scrollWidth - sc.clientWidth - sc.scrollLeft, overflows: sc.scrollWidth > sc.clientWidth + 1 }; })"""
        g = page.evaluate(GEOM)
        human = next(x for x in g if x['id'] == 'human')
        ok(human['n'] >= 8, f'{label}: the test train has {human["n"]} tiles on it')
        for x in g:
            ok(x['afterLastInRow'] >= 2 * x['lying'] + 8 - 1, f'{label}: train "{x["id"]}" ({x["n"]} tiles): the room after its last tile is {x["afterLastInRow"]:.0f}px, at least two dominoes ({2 * x["lying"] + 8:.0f}px)')
        ok(human['atEnd'] < 2 and human['visibleAfterLast'] >= 2 * human['lying'] + 8 - 1, f'{label}: scrolled to its newest tile, the human train still shows {human["visibleAfterLast"]:.0f}px of empty track after it (two dominoes = {2 * human["lying"] + 8:.0f}px)')
        ok(human['overflows'] == (label == 'phone' or human['overflows']), f'{label}: the row {"scrolls sideways (no scroll bar)" if human["overflows"] else "fits on the screen"}')
        page.screenshot(path=f'{SHOTS}/trains_{label.replace(" ", "_")}.png')
        ctx.close(); srv.terminate()

    # ============================================================================
    print('2b. hints: the main-screen toggle, and playing with hints off using the real mouse')
    port = free_port(); srv = start_server(['node', '../server.js', '--port', str(port), '--quiet']); time.sleep(1.2)
    ctx = browser.new_context(viewport={'width': 1100, 'height': 900}); page = new_page(ctx)
    page.goto(f'http://127.0.0.1:{port}/?seed=3')
    ok(page.inner_text('#opt-hints') == 'Allow hints: on' and page.get_attribute('#opt-hints', 'aria-pressed') == 'true', 'the main screen has an Allow hints toggle, on by default')
    page.click('#opt-hints')
    ok(page.inner_text('#opt-hints') == 'Allow hints: off' and page.get_attribute('#opt-hints', 'aria-pressed') == 'false', 'clicking it turns it off (the button itself changes)')
    page.reload()
    ok(page.inner_text('#opt-hints') == 'Allow hints: off', 'and a reload remembers that')
    HINTSEL = ".tile-btn.playable, .tile-btn.dim, .track.target, .track.preview, .ghost, .boneyard.ready, .slot-draw:not(.calm), [data-action=autoBuild]"
    found_hint_ids = None
    def deal_with_choices(hand, allow):
        for seed in range(1, 60):
            page.goto(f'http://127.0.0.1:{port}/?seed={seed}')
            page.select_option('#opt-rounds', '1'); page.select_option('#opt-hand', str(hand)); page.select_option('#opt-level', 'easy')
            if page.get_attribute('#opt-hints', 'aria-pressed') != ('true' if allow else 'false'): page.click('#opt-hints')
            page.click('[data-action="startGame"]'); page.wait_for_function("() => window.MexicanTrainApp.state.awaiting")
            if page.evaluate("() => { const a = window.MexicanTrainApp.state.awaiting; return !!(a.moves && a.moves.length); }"): return seed
        return None
    seed = deal_with_choices(12, False)
    ok(seed is not None, f'a deal with something to play was found (seed {seed})')
    ok(page.query_selector('.hints-toggle') is None, 'with hints not allowed there is no Show hints button on the hand')
    ok(page.evaluate(f"() => document.querySelectorAll('{HINTSEL}').length") == 0, 'and nothing in the live page is highlighted as playable, glowing, previewed or flashing')
    ok(page.query_selector('[data-action="autoBuild"]') is None, 'and there is no Build my longest train button')
    ok(page.query_selector('.sort-btn') is None and 'Sort hand' not in page.inner_text('.tray'), 'there is no Sort hand button on the hand')
    draw = page.query_selector('.slot-draw.calm')
    ok(draw is not None and draw.inner_text().strip() == 'Draw' and draw.is_visible(), 'the hand still has a Draw button with the word Draw on it')
    st = page.eval_on_selector('.slot-draw.calm', 'e => { const c = getComputedStyle(e); return { anim: c.animationName, op: c.opacity }; }')
    ok(st['anim'] == 'none', f'and it does not flash (animation: {st["anim"]})')
    ok(not page.evaluate("() => /glow|Nothing fits/i.test(document.querySelector('.status').textContent)"), 'the instruction line does not mention glowing tiles')
    page.screenshot(path=f'{SHOTS}/hints_off_opening.png')
    # play a tile with real clicks: pick the tile, then pick the train
    mv = page.evaluate("() => { const m = window.MexicanTrainApp.state.awaiting.moves[0]; return { key: window.MexicanTrainGame.Engine.key(m.tile), train: m.trainId }; }")
    before = page.evaluate("() => window.MexicanTrainApp.state.game.trains.human.tiles.length")
    page.click(f'.tile-btn[data-key="{mv["key"]}"]')
    ok(page.evaluate(f"() => document.querySelector('.tile-btn[data-key=\"{mv['key']}\"]').classList.contains('selected')"), 'a real click on a tile picks it up (it does not play)')
    ok(page.evaluate("() => window.MexicanTrainApp.state.game.trains.human.tiles.length") == before, '...nothing was played yet')
    page.click('.track[data-train="mexican"] .track-label')
    ok(page.evaluate("() => window.MexicanTrainApp.state.game.trains.human.tiles.length") == before and 'cannot be played' in page.inner_text('.status'), 'a real click on the wrong train is refused with a message, and the tile stays picked up')
    page.screenshot(path=f'{SHOTS}/hints_off_wrong_train.png')
    page.click('.track[data-train="human"] .track-label')
    try:
        page.wait_for_function(f"() => window.MexicanTrainApp.state.game.trains.human.tiles.length > {before}", timeout=3000); played = True
    except Exception:
        played = False
    ok(played, 'a real click on the right train plays it (the tile lands on the train)')
    # dragging with the real mouse onto the right train
    # (the move is read from the game, then the tile and the train are looked up on screen: if the page is redrawn in between, ask again)
    t0 = time.time(); mv2 = None; tb = trk = None
    while time.time() - t0 < 10 and (mv2 is None or tb is None or trk is None):
        mv2 = page.evaluate("() => { const a = window.MexicanTrainApp.state.awaiting; if (!a || !a.moves || !a.moves.length) return null; const m = a.moves[0]; return { key: window.MexicanTrainGame.Engine.key(m.tile), train: m.trainId }; }")
        tb = trk = None
        if mv2:
            e1 = page.query_selector(f'.tile-btn[data-key="{mv2["key"]}"]'); e2 = page.query_selector(f'.track[data-train="{mv2["train"]}"]')
            tb = e1.bounding_box() if e1 else None; trk = e2.bounding_box() if e2 else None
        if tb is None or trk is None: time.sleep(0.2)
    if mv2 and tb and trk:
        n0 = page.evaluate("() => window.MexicanTrainApp.state.game.trains.human.tiles.length")
        page.mouse.move(tb['x'] + tb['width'] / 2, tb['y'] + tb['height'] / 2); page.mouse.down()
        page.mouse.move(trk['x'] + 200, trk['y'] + trk['height'] / 2, steps=8)
        lit = page.evaluate(f"() => document.querySelectorAll('{HINTSEL}').length")
        page.mouse.up(); time.sleep(0.6)
        ok(lit == 0, 'while dragging, no train lights up to show where the tile could go')
        placed = page.evaluate("() => window.MexicanTrainApp.state.game.trains.human.tiles.length") > n0 or page.evaluate(f"() => window.MexicanTrainApp.state.game.trains['{mv2['train']}'].tiles.length") > 0
        ok(placed, 'and dropping it on the right train with the real mouse plays it')
    else: ok(False, 'no second move to drag')
    # hints allowed: the Show hints button on the hand
    seed2 = deal_with_choices(12, True)
    ok(seed2 is not None and page.inner_text('.hints-toggle') == 'Show hints: on', 'with hints allowed the hand has a "Show hints: on" button')
    ok(page.evaluate("() => document.querySelectorAll('.tile-btn.playable').length") > 0, 'and playable tiles are highlighted')
    page.click('.hints-toggle')
    ok(page.inner_text('.hints-toggle') == 'Show hints: off' and page.evaluate(f"() => document.querySelectorAll('{HINTSEL}').length") == 0, 'clicking it switches every highlight off at once')
    page.click('.hints-toggle')
    ok(page.evaluate("() => document.querySelectorAll('.tile-btn.playable').length") > 0, 'and clicking again brings them back')
    ctx.close(); srv.terminate()

    # ============================================================================
    print('2c. the toy train that marks an open train')
    port = free_port(); srv = start_server(['node', '../server.js', '--port', str(port), '--quiet']); time.sleep(1.2)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 760}); page = new_page(ctx)
    page.goto(f'http://127.0.0.1:{port}/?seed=4'); page.select_option('#opt-rounds', '1'); page.select_option('#opt-hand', '15'); page.select_option('#opt-level', 'easy')
    page.click('[data-action="startGame"]'); page.wait_for_function("() => window.MexicanTrainApp.state.awaiting"); time.sleep(0.5)
    ok(page.evaluate("() => document.querySelectorAll('.toy-train').length") == 0, 'no train is open at the start of a round, so there are no toy trains')
    page.evaluate("""() => { const S = window.MexicanTrainApp.state, g = S.game;
      ['human', 'cpu'].forEach(id => { let end = g.engine, tiles = []; for (let i = 0; i < 13; i++) { const nxt = (end + 5 + i) % 13; tiles.push([end, nxt]); end = nxt; } g.trains[id].tiles = tiles; g.trains[id].end = end; });
      g.trains.human.marker = true; g.trains.cpu.marker = true; if (g.opening) g.opening.cpu.finished = true; window.MexicanTrainApp.render(true); }""")
    time.sleep(5)          # the computer may still be placing its last opening tile (at most 4 s), which would take its marker off: let it finish, then stage the scene again
    page.evaluate("() => { const S = window.MexicanTrainApp.state; S.game.trains.human.marker = true; S.game.trains.cpu.marker = true; window.MexicanTrainApp.render(true); }")
    time.sleep(0.4)
    ok(page.evaluate("() => document.querySelectorAll('.toy-train').length") == 2 and page.query_selector('.track[data-train="mexican"] .toy-train') is None, 'an open train has one, the Mexican train never does')
    # (the game is still running behind this staged scene: a real move by the computer would take its marker off, so the scene is re-staged before each measurement)
    FORCE = "() => { const S = window.MexicanTrainApp.state; S.game.trains.human.marker = true; S.game.trains.cpu.marker = true; window.MexicanTrainApp.render(true); }"
    GEO = """(id) => { const tr = document.querySelector('.track[data-train=' + id + ']'), sc = tr.querySelector('.scroller'), toy = tr.querySelector('.toy-train'), rail = tr.querySelector('.rail'), eng = tr.querySelector('.tile.engine'), lab = tr.querySelector('.track-label');
      const t = toy.getBoundingClientRect(), r = rail.getBoundingClientRect(), e = eng.getBoundingClientRect(), l = lab.getBoundingClientRect(), sr = sc.getBoundingClientRect();
      return { left: t.left - r.left, right: t.right, top: t.top, bottom: t.bottom, rowTop: r.top, rowBottom: r.bottom, engineLeft: e.left, labelRight: l.right, scrollLeft: sc.scrollLeft, scrollerLeft: sr.left }; }"""
    page.evaluate("() => document.querySelectorAll('.scroller').forEach(e => { e.scrollLeft = 0; })"); time.sleep(0.2)
    page.evaluate(FORCE); g0 = page.evaluate(GEO, 'human')
    ok(g0['left'] >= 0 and g0['left'] <= 12 and g0['right'] <= g0['engineLeft'] - 4, f'at the start of the row it is at the far left and clear of the engine domino (train ends {g0["right"]:.0f}px, domino starts {g0["engineLeft"]:.0f}px)')
    ok(g0['top'] >= g0['rowTop'] - 1 and g0['bottom'] <= g0['rowBottom'] + 1 and g0['left'] + g0['labelRight'] > 0 and g0['right'] > g0['labelRight'], 'it sits inside its own row, to the right of the name and note')
    page.evaluate("() => document.querySelectorAll('.scroller').forEach(e => { e.scrollLeft = e.scrollWidth; })"); time.sleep(0.3)
    page.evaluate(FORCE); page.evaluate("() => document.querySelectorAll('.scroller').forEach(e => { e.scrollLeft = e.scrollWidth; })"); time.sleep(0.2)
    g1 = page.evaluate(GEO, 'human'); g1c = page.evaluate(GEO, 'cpu')
    ok(g1['scrollLeft'] > 300 and abs(g1['left'] - g0['left']) < 1 and abs(g1c['left'] - g0['left']) < 1, f'with the row scrolled {g1["scrollLeft"]:.0f}px it has not moved: it rides along at the far left (still {g1["left"]:.0f}px from the edge) while the dominoes slide past beneath it')
    ok(g1['engineLeft'] < g1['scrollerLeft'], '(the engine domino has scrolled out of sight to its left)')
    page.evaluate(FORCE)
    over = page.evaluate("() => { const t = document.querySelector('.track[data-train=human] .toy-train').getBoundingClientRect(); const el = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2); return el ? el.tagName + '.' + (el.className.baseVal !== undefined ? el.className.baseVal : el.className) : null; }")
    ok(over is not None and 'toy-train' not in over and not over.lower().startswith('svg'), f'a click on the toy train goes through it to the train underneath (the element there is {over})')
    page.evaluate(FORCE)
    cols = page.evaluate("() => ['human', 'cpu'].map(id => { const g = document.querySelector('.track[data-train=' + id + '] .toy-train'); return getComputedStyle(g).getPropertyValue('--tc').trim(); })")
    ok(len(set(cols)) == 2 and all(c.startswith('#') for c in cols), f'the two trains are painted different colours ({cols})')
    page.evaluate(FORCE)
    paint = page.evaluate("""() => ['human', 'cpu'].map(id => { const tr = document.querySelector('.track[data-train=' + id + '] .toy-train'), svg = tr.querySelector('svg');
      const circles = [...svg.querySelectorAll('circle')].map(c => c.getBoundingClientRect().toJSON()), body = svg.querySelector('rect[height="20"]').getBoundingClientRect().toJSON();
      return { stops: [...svg.querySelectorAll('stop')].map(e => getComputedStyle(e).stopColor), wheels: circles, bodyBottom: body.bottom, box: svg.getBoundingClientRect().toJSON() }; })""")
    import colorsys
    def hls(c):
        r, g, b = [int(x) / 255 for x in re.findall(r'\d+', c)[:3]]; h, l, s_ = colorsys.rgb_to_hls(r, g, b); return h * 360, l
    shaded = True; one_hue = True
    for p_ in paint:
        hl = [hls(c) for c in p_['stops']]
        hs_ = [h for h, l in hl]; ls = [l for h, l in hl]
        if max(ls) - min(ls) < 0.3: shaded = False
        if max(min(abs(a - b) , 360 - abs(a - b)) for a in hs_ for b in hs_) > 14: one_hue = False
    ok(shaded, 'as painted, each train goes from light to dark (it is shaded and shiny, not flat)')
    ok(one_hue, 'and every shade is the same hue as its colour (it is still one solid colour)')
    ok(paint[0]['stops'][0] != paint[1]['stops'][0], 'and the two players\' trains are different colours')
    ok(all(len(p_['wheels']) == 2 for p_ in paint), 'it shows exactly two wheels')
    ok(all(abs((w['top'] + w['bottom']) / 2 - p_['bodyBottom']) < 1.2 for p_ in paint for w in p_['wheels']), 'and the bottom of the body is at the middle of the wheels in the real layout, so it covers the top half of each')
    ok(all(abs(p_['box']['width'] - 52) <= 1.5 and abs(p_['box']['height'] - 33.6) <= 1.5 for p_ in paint), f'at the same size as before, about 52 x 34 pixels ({paint[0]["box"]["width"]:.0f} x {paint[0]["box"]["height"]:.0f}): the height did not change')
    ok(page.evaluate("() => document.querySelector('.toy-train').getAttribute('aria-hidden')") == 'true' and 'lantern' not in page.content().lower(), 'it is hidden from screen readers, and the word lantern is nowhere on the page')
    page.screenshot(path=f'{SHOTS}/toy_trains_scrolled.png', clip={'x': 0, 'y': 215, 'width': 1000, 'height': 330})
    # the three colours, as the browser paints them
    page.evaluate("""() => { const G = window.MexicanTrainGame; const d = document.createElement('div'); d.id = 'toydemo'; d.style.cssText = 'position:fixed;left:20px;top:20px;display:flex;gap:20px;padding:16px;background:#1d5a50;z-index:99;--s:40px';
      d.innerHTML = [0, 1, 2].map(id => '<div class="rail" style="width:120px;height:60px;position:relative">' + G.toyTrainSVG(id).replace('class="toy-train', 'style="left:0" class="toy-train') + '</div>').join(''); document.body.appendChild(d); }""")
    time.sleep(0.2)
    names = page.evaluate("() => [...document.querySelectorAll('#toydemo .toy-train')].map(e => getComputedStyle(e).getPropertyValue('--tc').trim())")
    ok(len(set(names)) == 3, f'all three players\' colours are different as painted: {names}')
    page.query_selector('#toydemo').screenshot(path=f'{SHOTS}/toy_trains_colours.png')
    ctx.close(); srv.terminate()

    # ============================================================================
    print('2d. one person against two computers, in the real browser')
    port = free_port(); srv = start_server(['node', '../server.js', '--port', str(port), '--quiet']); time.sleep(1.2)
    ctx = browser.new_context(viewport={'width': 1100, 'height': 900}); page = new_page(ctx)
    page.goto(f'http://127.0.0.1:{port}/?seed=6')
    ok(page.is_visible('#opt-cpus') and not page.is_visible('#field-level2'), 'the setup form has a Computer players choice, and the second skill is not shown while there is one computer')
    page.select_option('#opt-cpus', '2')
    ok(page.is_visible('#field-level2') and page.is_visible('#opt-level2'), 'choosing Two computer players in the real form shows the second computer\'s skill straight away')
    page.select_option('#opt-cpus', '1')
    ok(not page.is_visible('#field-level2'), 'and choosing One hides it again')
    page.select_option('#opt-cpus', '2'); page.select_option('#opt-level', 'easy'); page.select_option('#opt-level2', 'hard'); page.select_option('#opt-rounds', '1'); page.select_option('#opt-hand', '12')
    page.screenshot(path=f'{SHOTS}/two_computers_setup.png')
    page.click('[data-action="startGame"]'); page.wait_for_function("() => window.MexicanTrainApp.state.awaiting"); time.sleep(0.6)
    info = page.evaluate("""() => ({ rows: [...document.querySelectorAll('.cpu-hand')].map(r => ({ player: r.dataset.player, who: r.querySelector('.who').textContent, tag: r.querySelector('.tag').textContent.trim() })),
      header: document.querySelector('.round').textContent, tots: document.querySelectorAll('.tot').length, tracks: [...document.querySelectorAll('.track')].map(t => t.dataset.train), names: [window.MexicanTrainApp.state.cpuName, window.MexicanTrainApp.state.cpu2Name] })""")
    ok([r['player'] for r in info['rows']] == ['cpu', 'cpu2'] and [r['who'] for r in info['rows']] == info['names'] and info['names'][0] != info['names'][1], f'two opponent rows with two different names: {info["names"]}')
    ok([r['tag'] for r in info['rows']] == ['Easy', 'Hard'], f'tagged with their own skills: {[r["tag"] for r in info["rows"]]}')
    ok('Computers: Easy and Hard' in info['header'] and 'against two computers' in page.inner_text('.brand') and info['tots'] == 3 and sorted(info['tracks']) == ['cpu', 'cpu2', 'human', 'mexican'], 'the header names both skills; three scores; four trains')
    # play on, with the computers at their real pace, until it is the first normal turn
    t0 = time.time(); reached = False
    while time.time() - t0 < 80:
        st = page.evaluate("() => { const S = window.MexicanTrainApp.state; return { kind: S.awaiting && S.awaiting.kind, done: !!S.game && !!S.game.opening && ['human', 'cpu', 'cpu2'].every(i => S.game.opening[i].finished), modal: !!S.modal }; }")
        if st['modal']: break
        if st['done'] and st['kind'] in ('move', 'draw'): reached = True; break
        if st['kind'] == 'build':
            page.evaluate("() => { const a = window.MexicanTrainApp.state.awaiting; window.MexicanTrainApp.dispatch({ type: a.canDraw ? 'draw' : 'endBuild' }); }")
        time.sleep(0.4)
    time.sleep(0.5)
    ok(reached or st['modal'], 'all three finished the opening and play went on to the first turns (or the round ended)')
    page.screenshot(path=f'{SHOTS}/two_computers_game.png')
    ok(page.evaluate("() => [...document.querySelectorAll('.cpu-hand .backs')].map(b => b.querySelectorAll('.back').length).every(n => n > 0) || !!window.MexicanTrainApp.state.modal"), 'both computers show their tiles in the real layout')
    boxes = page.evaluate("() => ['.cpu-hand[data-player=cpu]', '.cpu-hand[data-player=cpu2]', '.boneyard', '.bubble-slot'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, r.left, r.top, r.right, r.bottom]; })")
    def overlap_(p, q): return not (p[3] <= q[1] + 0.5 or q[3] <= p[1] + 0.5 or p[4] <= q[2] + 0.5 or q[4] <= p[2] + 0.5)
    ok(not any(overlap_(boxes[i], boxes[j]) for i in range(len(boxes)) for j in range(i + 1, len(boxes))), 'and nothing overlaps in the top area (two opponents, boneyard, speech bubble)')
    ctx.close(); srv.terminate()

    # ============================================================================
    print('2e. a speech bubble does not flash when the page is redrawn')
    port = free_port(); srv = start_server(['node', '../server.js', '--port', str(port), '--quiet']); time.sleep(1.2)
    ctx = browser.new_context(viewport={'width': 1000, 'height': 760}); page = new_page(ctx)
    page.goto(f'http://127.0.0.1:{port}/?seed=4'); page.select_option('#opt-rounds', '1'); page.select_option('#opt-hand', '12')
    page.click('[data-action="startGame"]'); page.wait_for_function("() => window.MexicanTrainApp.state.awaiting"); time.sleep(0.5)
    res = page.evaluate("""async () => {
      const A = window.MexicanTrainApp, S = A.state, out = { redraws: [] };
      S.comment = { id: 99, kind: 'draw', text: 'Interesting choice.' };
      A.render(true);
      await new Promise(r => setTimeout(r, 600));
      for (let i = 0; i < 6; i++) {                                         // the page is redrawn as the computers play, one line at a time
        S.log.push('Somebody played something ' + i); A.render(true);
        const el = document.querySelector('.bubble');
        out.redraws.push({ opacity: getComputedStyle(el).opacity, animations: el.getAnimations().length });
        await new Promise(r => setTimeout(r, 30));
      }
      const el = document.querySelector('.bubble');                          // and a NEW comment: the script gives the bubble its fade-in once
      el.classList.add('in');
      out.fadeIn = { animations: el.getAnimations().length, name: el.getAnimations()[0] && el.getAnimations()[0].animationName, opacityAtStart: getComputedStyle(el).opacity };
      await Promise.race([Promise.all(el.getAnimations().map(a => a.finished.catch(() => null))), new Promise(r => setTimeout(r, 3000))]);      // (until it has finished: not a guess at how long that takes on this machine)
      await new Promise(r => setTimeout(r, 60));
      out.after = { animations: el.getAnimations().length, opacity: getComputedStyle(el).opacity };
      return out; }""")
    ok(all(r['opacity'] == '1' and r['animations'] == 0 for r in res['redraws']), f'a bubble that is up while the page is redrawn six times stays fully visible at every redraw, with no animation restarting ({res["redraws"][0]})')
    ok(res['fadeIn']['animations'] == 1 and res['fadeIn']['name'] == 'bubbleIn' and float(res['fadeIn']['opacityAtStart']) < 1, f'a new comment does fade in (the bubbleIn animation runs, starting transparent: {res["fadeIn"]})')
    ok(res['after']['animations'] == 0 and res['after']['opacity'] == '1', 'and once, then it is plainly there')
    ctx.close(); srv.terminate()

    # ============================================================================
    print('3. the host address: a network IP address, and it cannot be edited')
    port = free_port(); srv = start_server(['node', '../server.js', '--port', str(port), '--quiet']); time.sleep(1.2)
    info = json.loads(__import__('urllib.request').request.urlopen(f'http://127.0.0.1:{port}/info').read())
    ctx = browser.new_context(viewport={'width': 1100, 'height': 900}); page = new_page(ctx)
    page.goto(f'http://localhost:{port}/')                        # the host opens the page as "localhost"
    page.click('[data-action="openHost"]')
    page.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    val = page.input_value('#net-server')
    ok(re.match(r'^\d+\.\d+\.\d+\.\d+:%d$' % port, val) is not None, f'the field shows an IP address and the port: {val}')
    ok('localhost' not in val and not val.startswith('127.') or info['addresses'] == [], 'it is the computer\'s network address, not localhost, although the page was opened as localhost')
    ok(val == info['preferred'], 'and it is the address the server prefers (a 192.168.x.x or 10.x.x.x address when the computer has one)')
    page.screenshot(path=f'{SHOTS}/host_dialog.png')
    ok(page.eval_on_selector('#net-server', 'e => e.readOnly') is True, 'the field is read-only in the browser')
    st = page.eval_on_selector('#net-server', 'e => { const c = getComputedStyle(e); return { bg: c.backgroundColor, cursor: c.cursor, border: c.borderTopStyle }; }')
    ok(st['cursor'] == 'not-allowed' and st['border'] == 'dashed' and st['bg'] not in ('rgba(0, 0, 0, 0)', 'transparent'), f'and it looks locked: shaded, dashed border, not-allowed cursor ({st})')
    nm = page.eval_on_selector('#net-name', 'e => { const c = getComputedStyle(e); return { bg: c.backgroundColor, border: c.borderTopStyle }; }')
    ok(nm['border'] == 'solid' and nm['bg'] in ('rgba(0, 0, 0, 0)', 'transparent'), 'while the name field next to it still looks editable')
    page.click('#net-server'); page.keyboard.type('hacked.example.com'); page.keyboard.press('Backspace'); page.keyboard.press('Control+A'); page.keyboard.type('x')
    ok(page.input_value('#net-server') == val, 'clicking in it and typing does nothing')
    try:
        page.fill('#net-server', 'evil:1', timeout=1500); filled = True
    except Exception:
        filled = False
    ok(not filled and page.input_value('#net-server') == val, 'the browser itself refuses to fill it in (not editable)')
    page.evaluate("() => { const f = document.getElementById('net-server'); f.removeAttribute('readonly'); f.value = 'evil.example.com:1'; }")   # even if someone edits the page...
    page.fill('#net-name', 'Ann'); page.click('[data-action="hostGame"]')
    page.wait_for_selector('.code-big')
    ok(page.evaluate("() => window.MexicanTrainApp.state.online.server") == val, '...the game is still hosted at the server\'s address (the page ignores the field)')
    page.screenshot(path=f'{SHOTS}/lobby_with_qr.png')
    qr = page.query_selector('svg.qr')
    ok(qr is not None and qr.bounding_box()['width'] > 100, 'the QR code is drawn at a readable size by the real browser')
    link = page.eval_on_selector('.qrtext code', 'e => e.textContent')
    ok(link.startswith(f'http://{val}/?join='), f'its link uses the same address: {link}')
    qr.screenshot(path=f'{SHOTS}/qr_element.png')
    try:
        import cv2
        img = cv2.imread(f'{SHOTS}/qr_element.png'); text, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
        ok(text == link, 'and a screenshot of the QR code, as the browser really drew it, is read back by OpenCV as exactly that link')
    except ImportError:
        print('   (OpenCV not installed: the QR screenshot was not decoded)')
    ctx.close(); srv.terminate()

    # ============================================================================
    print('4. two real browsers play each other, then three (with a computer)')
    srv = start_server(['node', 'browser_server.js']); line = srv.stdout.readline(); port = json.loads(line)['port']
    base = f'http://127.0.0.1:{port}/'
    def host_game(ctx, computer):
        pg = new_page(ctx); pg.goto(base); pg.click('[data-action="openHost"]')
        pg.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
        pg.fill('#net-name', 'Ann'); pg.select_option('#net-rounds', '1'); pg.select_option('#net-hand', '8')
        if computer: pg.select_option('#net-computer', computer)
        pg.click('[data-action="hostGame"]'); pg.wait_for_selector('.code-big'); return pg
    def join_game(ctx, code):
        pg = new_page(ctx); pg.goto(base + '?join=' + code.replace('-', ''))
        pg.wait_for_selector('#net-code'); ok(pg.input_value('#net-code') == code, 'a scanned link opens the Join screen with the code filled in (' + code + ')')
        pg.fill('#net-name', 'Ben'); pg.click('[data-action="joinGame"]'); pg.wait_for_selector('.code-big'); return pg
    def play_out(pages, secs=90):
        t0 = time.time()
        while time.time() - t0 < secs:
            if all(p.evaluate("() => { const m = window.MexicanTrainApp.state.modal; return !!m && m.type === 'final'; }") for p in pages): return True
            for p in pages: step(p)
            time.sleep(0.02)
        return False
    for computer in (None, 'normal'):
        label = 'two people' if not computer else 'two people and a computer'
        ctxA = browser.new_context(viewport={'width': 1200, 'height': 950}); ctxB = browser.new_context(viewport={'width': 1200, 'height': 950})
        a = host_game(ctxA, computer)
        code = a.eval_on_selector('.code-big', 'e => e.textContent').strip()
        b = join_game(ctxB, code)
        a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled")
        a.click('[data-action="startOnline"]')
        a.wait_for_selector('.tracks'); b.wait_for_selector('.tracks')
        time.sleep(0.8)
        if computer:
            rows = a.eval_on_selector_all('.cpu-hand', 'els => els.map(e => e.dataset.player)')
            ok(rows == ['cpu', 'cpu2'], f'{label}: the host sees two opponent rows ({rows})')
            a.screenshot(path=f'{SHOTS}/three_players_opening.png'); b.screenshot(path=f'{SHOTS}/three_players_guest.png')
            ok(a.evaluate("() => document.querySelectorAll('.track').length") == 4, 'and four trains')
            # nothing overlaps: every part of the top area has its own space on the screen
            boxes = a.evaluate("() => ['.cpu-hand[data-player=cpu]', '.cpu-hand[data-player=cpu2]', '.boneyard', '.bubble-slot'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, r.left, r.top, r.right, r.bottom]; })")
            def overlap(p, q): return not (p[3] <= q[1] + 0.5 or q[3] <= p[1] + 0.5 or p[4] <= q[2] + 0.5 or q[4] <= p[2] + 0.5)
            ok(not any(overlap(boxes[i], boxes[j]) for i in range(len(boxes)) for j in range(i + 1, len(boxes))), 'in the real layout the two opponents, the boneyard and the speech area do not overlap: ' + str([[b_[0], round(b_[2]), round(b_[4])] for b_ in boxes]))
        # the colour of each player's toy train, on each real page: stage every train open in one go (and read it back in the same
        # instant, so nothing can change in between) and compare the two screens
        STAGE = """() => { const S = window.MexicanTrainApp.state; Object.keys(S.game.trains).forEach(id => { if (id !== 'mexican') S.game.trains[id].marker = true; if (S.game.opening && S.game.opening[id]) S.game.opening[id].finished = true; });
          window.MexicanTrainApp.render(true); const out = {}; document.querySelectorAll('.track').forEach(t => { const toy = t.querySelector('.toy-train'); if (toy) out[t.querySelector('.track-name').textContent] = toy.className.replace('toy-train ', ''); }); return out; }"""
        ma = a.evaluate(STAGE); mb = b.evaluate(STAGE)
        comp_name = a.evaluate("() => window.MexicanTrainApp.state.cpu2Name") if computer else None
        def by_owner(m, me): return {(me if k == 'Your train' else k.replace("'s train", '')): v for k, v in m.items()}
        oa, ob = by_owner(ma, 'Ann'), by_owner(mb, 'Ben')
        expect = {'Ann': 'c0', 'Ben': 'c1'}
        if computer: expect[comp_name] = 'c2'
        ok(oa == expect and ob == expect, f'{label}: every train has the colour of its owner\'s seat on BOTH real pages, the same on each: Ann\'s page {oa}, Ben\'s page {ob}')
        done = play_out([a, b])
        ok(done, f'{label}: a whole game is played to the final score in two real browsers')
        if done:
            ta = a.evaluate("() => window.MexicanTrainApp.state.modal.totals"); tb = b.evaluate("() => window.MexicanTrainApp.state.modal.totals")
            if computer: ok(ta['human'] == tb['cpu2'] and ta['cpu'] == tb['human'] and ta['cpu2'] == tb['cpu'], f'{label}: both browsers show the same three scores {ta}')
            else: ok(ta['human'] == tb['cpu'] and ta['cpu'] == tb['human'], f'{label}: both browsers show the same two scores {ta}')
            a.screenshot(path=f'{SHOTS}/final_{"three" if computer else "two"}.png')
            title = a.inner_text('#dlg-title'); ok(re.match(r'^(You win|A tie.*|.+ wins)$', title) is not None, f'{label}: the final dialog title is sensible: "{title}"')
        ctxA.close(); ctxB.close()
    srv.terminate()

    ok(errors == [], 'no JavaScript errors or console errors in any of the pages' + (': ' + '; '.join(errors[:3]) if errors else ''))
    browser.close()

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
