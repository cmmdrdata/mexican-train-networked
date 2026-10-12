#!/usr/bin/env python3
"""Copy link on the host's lobby, in real Chromium: on a plain-http network address (where the browser has NO clipboard API: this is
   the real situation) and on localhost. The copied text is read back from the real clipboard."""
import json, os, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
passed = failed = 0
def ok(c, m):
    global passed, failed
    if c: passed += 1
    else: failed += 1; print('  FAIL:', m)

def lan_ip():
    for ip in subprocess.check_output(['hostname', '-I'], text=True).split():
        if '.' in ip and not ip.startswith('127.'): return ip
    return None

srv = subprocess.Popen(['node', os.path.join(HERE, 'browser_server.js')], stdout=subprocess.PIPE, text=True)
port = json.loads(srv.stdout.readline())['port']
ip = lan_ip()
with sync_playwright() as pw:
    browser = pw.chromium.launch(); errors = []
    ctx = browser.new_context(viewport={'width': 1100, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=f'http://127.0.0.1:{port}')
    def host_lobby(base):
        page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base)
        page.click('[data-action="openHost"]')
        page.wait_for_function("() => document.querySelector('#net-server') && document.querySelector('#net-server').value !== ''")
        page.fill('#net-name', 'Ann'); page.click('[data-action="hostGame"]'); page.wait_for_selector('[data-action="copyLink"]')
        return page
    SPY = "() => { window.__copied = null; document.addEventListener('copy', e => { const t = e.target; window.__copied = t && t.value !== undefined ? t.value.substring(t.selectionStart, t.selectionEnd) : String(document.getSelection()); }, true); }"
    if ip:
        page = host_lobby(f'http://{ip}:{port}/')
        env = page.evaluate("() => ({ secure: window.isSecureContext, clipboard: typeof navigator.clipboard })")
        ok(env['secure'] is False and env['clipboard'] == 'undefined', f'on http://{ip}:{port} (a network address) the browser has no clipboard API: {env}')
        ok(page.query_selector('[data-action="copyCode"]') is None and page.query_selector('.code-big') is not None, 'there is no Copy code button, and the code is still shown')
        link = page.eval_on_selector('.qrtext code', 'e => e.textContent')
        page.evaluate(SPY)
        page.click('[data-action="copyLink"]'); time.sleep(0.4)
        ok(page.evaluate("() => window.__copied") == link, f'clicking Copy link copies the link even without the clipboard API: {link}')
        ok('Copied' in page.inner_text('[data-action="copyLink"]'), 'and the button says "Copied"')
        ok(page.evaluate("() => document.querySelectorAll('textarea').length") == 0, 'and the hidden text box it used is gone')
        # read the REAL clipboard from a page where the browser allows it
        reader = ctx.new_page(); reader.goto(f'http://127.0.0.1:{port}/')
        got = reader.evaluate("async () => { try { return await navigator.clipboard.readText(); } catch (e) { return 'ERR ' + e.message; } }")
        ok(got == link, f'and the link really is on the clipboard (read back from another page): {got}')
        reader.close(); page.screenshot(path='/tmp/shots/copy_link_http.png')
    else:
        print('   (no network address in this sandbox: the plain-http case could not be run)')
    page = host_lobby(f'http://127.0.0.1:{port}/')
    env = page.evaluate("() => ({ secure: window.isSecureContext, clipboard: typeof navigator.clipboard })")
    ok(env['secure'] is True and env['clipboard'] == 'object', f'on localhost the clipboard API exists: {env}')
    link = page.eval_on_selector('.qrtext code', 'e => e.textContent')
    page.click('[data-action="copyLink"]'); time.sleep(0.4)
    got = page.evaluate("async () => { try { return await navigator.clipboard.readText(); } catch (e) { return 'ERR ' + e.message; } }")
    ok(got == link and 'Copied' in page.inner_text('[data-action="copyLink"]'), f'on localhost it copies too, and says so: {got}')
    ok(errors == [], 'no JavaScript errors' + (': ' + '; '.join(errors[:2]) if errors else ''))
    browser.close()
srv.terminate()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
