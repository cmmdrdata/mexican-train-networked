#!/usr/bin/env python3
"""Real Chromium: the Host screen's ways for the other player to join (this network / over the internet / a typed address) and the lobby that follows.
   The server's public-address look-up is faked (MT_PUBLIC_IP): no test contacts the internet."""
import json, os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)

def start(mode):
    env = dict(os.environ, MT_PUBLIC_IP=mode)
    p = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True, env=env)
    return p, json.loads(p.stdout.readline())['port']

def lan_ip():
    for ip in subprocess.check_output(['hostname', '-I'], text=True).split():
        if '.' in ip and not ip.startswith('127.'): return ip
    return None

STATE = """() => ({
  local: { checked: document.getElementById('via-local').checked, text: document.getElementById('via-local-text').textContent },
  pub: { checked: document.getElementById('via-public').checked, disabled: document.getElementById('via-public').disabled, text: document.getElementById('via-public-text').textContent },
  manual: { checked: document.getElementById('via-manual').checked, shown: !document.getElementById('join-manual-box').hidden, value: document.getElementById('join-manual').value },
  name: document.getElementById('net-name').value, active: document.activeElement && document.activeElement.id,
  hidden: document.getElementById('net-server').type + ':' + document.getElementById('net-server').value })"""
LINK = "() => (document.querySelector('.qrtext code') || {}).textContent || null"
LIST = "() => Array.from(document.querySelectorAll('.addrs li')).map(li => li.querySelector('code').textContent + ' | ' + li.querySelector('.field-note').textContent)"
errors = []

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1100, 'height': 1000})
    def host_page(base):
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(base); pg.click('[data-action="openHost"]')
        pg.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
        return pg

    print('1. the address arrives while the host is typing (it takes a couple of seconds)')
    srv, port = start('slow:203.0.113.9:2500')
    a = host_page(f'http://127.0.0.1:{port}/')
    t0 = time.time(); st = a.evaluate(STATE)
    ok(st['local']['checked'] and 'On this network:' in st['local']['text'] and re.search(r':\d+$', st['hidden']) and st['hidden'].startswith('hidden:'), f"this network is chosen and shows the server's address; the page's own address is a hidden value: {st['local']['text'][:60]}")
    ok(st['pub']['disabled'] and 'looking up' in st['pub']['text'] and not st['manual']['shown'], 'the internet choice says it is looking and cannot be chosen yet; the box for a typed address is hidden')
    a.screenshot(path='/tmp/shots/join_looking.png')
    a.fill('#net-name', 'Ann')
    a.click('#via-manual'); time.sleep(0.2)
    st = a.evaluate(STATE)
    ok(st['manual']['checked'] and st['manual']['shown'] and st['active'] == 'join-manual', 'choosing "Type an address" shows its box and puts the cursor in it')
    a.keyboard.type('198.51.100.4:90')                                    # half typed when the answer arrives
    a.wait_for_function("() => !document.getElementById('via-public').disabled", timeout=8000)
    st = a.evaluate(STATE)
    ok(time.time() - t0 > 2, f'(the answer came after {time.time() - t0:.1f} s)')
    ok(f":{port}" in st['pub']['text'] and '203.0.113.9' in st['pub']['text'] and 'test lookup' in st['pub']['text'] and f'forward port {port}' in st['pub']['text'] and not st['pub']['disabled'], f"the internet choice now shows the address, how it was found and the port to forward: {st['pub']['text'][:110]}")
    ok(st['name'] == 'Ann' and st['manual']['value'] == '198.51.100.4:90' and st['manual']['checked'] and st['active'] == 'join-manual', f"and what the host had typed is untouched: the name {st['name']!r}, the half-typed address {st['manual']['value']!r}, still in the box with the cursor")
    a.keyboard.type('00')
    ok(a.evaluate("() => document.getElementById('join-manual').value") == '198.51.100.4:9000', 'typing carries on from where it was')
    a.screenshot(path='/tmp/shots/join_found.png')

    print('2. over the internet')
    a.click('#via-public')
    ok(a.evaluate("() => document.getElementById('join-manual-box').hidden") is True, 'choosing the internet hides the typed address box again')
    a.select_option('#net-rounds', '1'); a.select_option('#net-hand', '8')
    a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
    link = a.evaluate(LINK); code = a.eval_on_selector('.code-big', 'e => e.textContent').strip().replace('-', '')
    ok(link == f'http://203.0.113.9:{port}/?join={code}', f'the lobby\'s link is the public address: {link}')
    lst = a.evaluate(LIST)
    ok(lst[0] == f'203.0.113.9:{port} | over the internet' and any('on this network' in x for x in lst[1:]), f'and lists it first, then this network: {lst}')
    ok('forward port' in a.inner_text('.qrtext'), 'with the reminder about the router')
    ok(a.evaluate("() => document.querySelectorAll('.dialog select, .dialog input, .dialog textarea').length") == 0, '(the lobby still has no inputs)')
    qr1 = a.evaluate("() => document.querySelector('.qrbox svg').innerHTML")
    a.click('.addrs li:nth-child(2) [data-action="selectQr"]'); time.sleep(0.2)
    link2 = a.evaluate(LINK); qr2 = a.evaluate("() => document.querySelector('.qrbox svg').innerHTML")
    ok(link2 != link and f':{port}/?join={code}' in link2 and qr1 != qr2, f'Show QR on another address changes the link and the QR code: {link2}')
    a.screenshot(path='/tmp/shots/join_lobby_public.png')
    # a guest joins through the link this network offers
    if link2.startswith('http://127.') or lan_ip():
        guest = ctx.new_page(); guest.on('pageerror', lambda e: errors.append(str(e)))
        guest.goto(link2); guest.wait_for_selector('#net-code')
        ok(guest.input_value('#net-code').replace('-', '') == code and guest.input_value('#net-server') != '', 'the guest opens the local link and lands on the Join screen with the code and address filled in')
        guest.fill('#net-name', 'Ben'); guest.click('[data-action="joinGame"]'); guest.wait_for_selector('.code-big')
        a.wait_for_function("() => !document.querySelector('[data-action=\"startOnline\"]').disabled", timeout=8000)
        ok('Ben' in a.inner_text('.dialog'), 'and joins: the host sees Ben')
        guest.close()
    a.close(); srv.terminate()

    print('3. a typed address, and the keyboard')
    srv, port = start('off')
    a = host_page(f'http://127.0.0.1:{port}/')
    a.wait_for_function("() => !document.getElementById('via-public-text').textContent.includes('looking up')", timeout=8000)     # (the answer comes a moment after the screen)
    st = a.evaluate(STATE)
    ok(st['pub']['disabled'] and 'not offered' in st['pub']['text'] and '--no-public-ip' in st['pub']['text'], f"with the lookup switched off the internet choice says so: {st['pub']['text'][:90]}")
    a.focus('#via-local'); a.keyboard.press('ArrowDown'); time.sleep(0.2)
    st = a.evaluate(STATE)
    ok(st['manual']['checked'] and st['manual']['shown'], 'with the keyboard, the arrow key skips the choice that cannot be made and chooses "Type an address"')
    a.click('[data-action="hostGame"]'); time.sleep(0.4)
    err = a.inner_text('[role="alert"]') if a.query_selector('[role="alert"]') else ''
    ok('Type the address' in err and a.query_selector('.code-big') is None, f'creating with nothing typed is refused, and says what to do: {err[:80]!r}')
    a.fill('#join-manual', 'not an address!'); a.click('[data-action="hostGame"]'); time.sleep(0.4)
    err = a.inner_text('[role="alert"]')
    st = a.evaluate(STATE)
    ok('not an address' in err and st['manual']['value'] == 'not an address!' and st['manual']['checked'] and st['manual']['shown'], f'a bad address is refused with the box still showing what was typed: {err[:70]!r}')
    a.screenshot(path='/tmp/shots/join_error.png')
    a.fill('#join-manual', 'game.example.org'); a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
    link = a.evaluate(LINK); code = a.eval_on_selector('.code-big', 'e => e.textContent').strip().replace('-', '')
    ok(link == f'http://game.example.org:{port}/?join={code}', f'a name with no port gets the server\'s port: {link}')
    ok(a.evaluate(LIST)[0].startswith(f'game.example.org:{port} | typed by you'), 'and is listed first as typed by the host')
    a.close(); srv.terminate()

    print('4. nothing found')
    srv, port = start('fail')
    a = host_page(f'http://127.0.0.1:{port}/')
    a.wait_for_function("() => document.getElementById('via-public-text').textContent.includes('could not be found')", timeout=8000)
    st = a.evaluate(STATE)
    ok(st['pub']['disabled'] and 'type it below' in st['pub']['text'], f"a lookup that fails is reported, with what to do: {st['pub']['text'][:100]}")
    a.close(); srv.terminate()

    print('5. the public address changes between two clicks of "Host online game"')
    srv, port = start('seq:203.0.113.9,203.0.113.77')
    a = host_page(f'http://127.0.0.1:{port}/')
    a.wait_for_function("() => !document.getElementById('via-public').disabled", timeout=8000)
    first = a.evaluate(STATE)['pub']['text']
    ok(f'203.0.113.9:{port}' in first, f'the first click finds the first address: {first[:70]}')
    a.keyboard.press('Escape'); a.wait_for_selector('[data-action="openHost"]')
    a.click('[data-action="openHost"]')                                         # clicked again at once: the same answer, not another question
    a.wait_for_function("() => !document.getElementById('via-public').disabled", timeout=8000)
    ok(f'203.0.113.9:{port}' in a.evaluate(STATE)['pub']['text'], 'clicked again straight away it shows the same address (a quick second click does not ask the service again)')
    a.keyboard.press('Escape'); a.wait_for_selector('[data-action="openHost"]')
    time.sleep(5.6)                                                             # the server's memory of an answer is 5 seconds
    a.click('[data-action="openHost"]')
    a.wait_for_function("() => document.getElementById('via-public-text').textContent.includes('203.0.113.77')", timeout=8000)
    st = a.evaluate(STATE)
    ok(f'203.0.113.77:{port}' in st['pub']['text'] and '203.0.113.9:' not in st['pub']['text'], f"clicked again a little later it asks again and shows the NEW address: {st['pub']['text'][:70]}")
    a.click('#via-public'); a.fill('#net-name', 'Ann'); a.click('[data-action="hostGame"]'); a.wait_for_selector('.code-big')
    ok((a.evaluate("() => document.querySelector('.qrtext code').textContent") or '').startswith(f'http://203.0.113.77:{port}/?join='), 'and the lobby\'s link uses the new address')
    a.close(); srv.terminate()

    print('6. the local address cannot be reached from this window, and the host chose the internet')
    srv, port = start('203.0.113.9')
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    sockets = []; pg.on('websocket', lambda ws: sockets.append(ws.url))
    fake = f'10.255.255.1:{port}'                                              # an address nothing in this window can reach
    pg.route('**/info', lambda route: route.fulfill(content_type='application/json', body=json.dumps({'game': 'mexican-train', 'addresses': [fake], 'preferred': fake})))
    pg.goto(f'http://127.0.0.1:{port}/'); pg.click('[data-action="openHost"]')
    pg.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
    pg.wait_for_function("() => !document.getElementById('via-public').disabled", timeout=8000)
    st = pg.evaluate(STATE)
    ok(fake in st['local']['text'] and f'203.0.113.9:{port}' in st['pub']['text'], f"the Host screen is told the local address is {fake} (unreachable from here) and finds the public one")
    pg.click('#via-public'); pg.fill('#net-name', 'Ann'); pg.click('[data-action="hostGame"]')
    try:
        pg.wait_for_selector('.code-big', timeout=8000); reached = True
    except Exception:
        reached = False
    err = pg.inner_text('[role="alert"]') if pg.query_selector('[role="alert"]') else ''
    ok(reached and 'Could not reach' not in err, f'creating the game works, with no "Could not reach" message ({err[:90]!r})')
    ok(sockets == [f'ws://127.0.0.1:{port}/ws'], f'the window connected only to the address it was loaded from, never to the unreachable one: {sockets}')
    ok((pg.evaluate(LINK) or '').startswith(f'http://203.0.113.9:{port}/?join='), 'and the lobby offers the others the public address, as chosen')
    pg.close(); srv.terminate()

    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
