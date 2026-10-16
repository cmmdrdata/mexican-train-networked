#!/usr/bin/env python3
"""Real Chromium: the Recent games screen from the main menu (the server's answer is supplied by the test)."""
import json, os, subprocess
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); SHOTS = '/tmp/shots'; os.makedirs(SHOTS, exist_ok=True)
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)
GAMES = [
  {'id': 3, 'result': 'finished', 'startedAt': 1792170000000, 'endedAt': 1792171500000, 'rounds': 4, 'roundsPlayed': 4, 'players': [
    {'name': 'Ann', 'score': 61, 'roundsWon': 1, 'winner': False}, {'name': 'Ben', 'score': 33, 'roundsWon': 2, 'winner': True}, {'name': 'Nadia', 'computer': True, 'level': 'hard', 'score': 90, 'roundsWon': 1, 'winner': False}], 'winners': ['Ben']},
  {'id': 2, 'result': 'stopped', 'startedAt': 1792160000000, 'endedAt': 1792160400000, 'rounds': 4, 'roundsPlayed': 2, 'players': [
    {'name': 'Cy', 'score': 40, 'roundsWon': 0, 'winner': False}, {'name': 'Di', 'score': 12, 'roundsWon': 2, 'winner': False}], 'winners': []},
  {'id': 1, 'result': 'finished', 'startedAt': 1792100000000, 'endedAt': 1792103600000, 'rounds': 4, 'roundsPlayed': 4, 'players': [
    {'name': 'Eve', 'score': 20, 'roundsWon': 2, 'winner': True}, {'name': 'Fay', 'score': 55, 'roundsWon': 2, 'winner': False}], 'winners': ['Eve']}]
srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=dict(os.environ, MT_CHECK_BUILD='1'))
base = f"http://127.0.0.1:{json.loads(srv.stdout.readline())['port']}/"
asked = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(); pg = browser.new_page(viewport={'width': 1100, 'height': 950})
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    def history(route):
        asked.append(route.request.url.split('?')[1]); route.fulfill(status=200, content_type='application/json', body=json.dumps({'games': GAMES}))
    pg.route('**/history?*', history)
    pg.goto(base); pg.wait_for_selector('#opt-rounds')
    ok(pg.query_selector('[data-action="openHistory"]') is not None, 'the main screen has a Recent games button')
    pg.click('[data-action="openHistory"]'); pg.wait_for_selector('.hist-game')
    ok(pg.locator('.hist-game').count() == 3 and asked == ['n=25'], f'three games listed, asked for n=25 ({asked})')
    t = pg.inner_text('.hist-list')
    ok('Ben won' in t and 'Eve won' in t and 'Stopped early' in t and 'computer, hard' in t and '90' in t and '61' in t, 'winners, stopped game, computer and scores are on screen')
    ok(pg.locator('.hist-game time').first.inner_text().strip() != '', 'a time is shown for each game')
    pg.screenshot(path=f'{SHOTS}/history.png')
    pg.click('[data-action="historyCount"][data-key="100"]'); pg.wait_for_selector('.hist-game')
    ok(asked[-1] == 'n=100' and pg.get_attribute('[data-key="100"]', 'aria-pressed') == 'true', 'choosing 100 asks for 100')
    pg.click('[data-action="closeOverlay"]'); pg.wait_for_selector('#opt-rounds')
    ok(pg.query_selector('[data-action="startGame"]') is not None, 'Back returns to the main screen')
    pg.set_viewport_size({'width': 390, 'height': 780}); pg.click('[data-action="openHistory"]'); pg.wait_for_selector('.hist-game')
    ok(pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), 'on a phone-sized screen nothing runs off the side')
    pg.screenshot(path=f'{SHOTS}/history_phone.png')
    ok(not errs, f'no page errors {errs}')
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed'); raise SystemExit(1 if failed else 0)
