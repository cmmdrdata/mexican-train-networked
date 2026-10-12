'use strict';
// The server can be told from any other Node process in `ps -ef`: it renames itself, and --name adds a label of your choice.
const { spawn, spawnSync, execFileSync } = require('child_process');
const http = require('http'), path = require('path'), fs = require('fs');
const S = require('../server.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('  ok:', m); } else { fail++; console.log('  FAIL:', m); } };
const node = process.execPath, server = path.join(__dirname, '..', 'server.js');
const hasPs = process.platform !== 'win32' && (() => { try { execFileSync('ps', ['-o', 'args=', '-p', String(process.pid)]); return true; } catch (e) { return false; } })();
const psArgs = pid => execFileSync('ps', ['-o', 'args=', '-p', String(pid)]).toString().trim();
const get = (port, p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej));
function start(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [server, '--port', '0', '--local-only', '--no-public-ip'].concat(args || []));
    let out = '', port = null;
    const t = setTimeout(() => { child.kill(); reject(new Error('the server did not start: ' + out)); }, 8000);
    child.stdout.on('data', d => { out += d; const m = out.match(/Open\s+http:\/\/127\.0\.0\.1:(\d+)/); if (m && port === null) { port = Number(m[1]); clearTimeout(t); resolve({ child, port, out: () => out }); } });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => { if (port === null) { clearTimeout(t); reject(new Error('exited ' + code + ': ' + out)); } });
  });
}
const stop = c => new Promise(res => { c.on('exit', code => res(code)); c.kill('SIGTERM'); });

(async () => {
  console.log('1. the title');
  ok(S.PROCESS_NAME === 'mexican-train-server', 'the process is called "mexican-train-server"');
  ok(S.processTitle(null, 8080) === 'mexican-train-server :8080', 'with a port: "mexican-train-server :8080"');
  ok(S.processTitle('table1', 8080) === 'mexican-train-server table1 :8080', 'with a label too: "mexican-train-server table1 :8080"');
  ok(S.processTitle('table1', 0) === 'mexican-train-server table1' && S.processTitle(null, 0) === 'mexican-train-server', 'and with no port yet, just the name (and label)');

  console.log('2. the real server, as ps shows it');
  if (!hasPs) console.log('  (no ps on this system: the checks against ps are skipped)');
  const a = await start(['--name', 'table1']), b = await start(['--name', 'practice-2']), c = await start([]);
  const other = spawn(node, ['-e', 'setTimeout(function () {}, 20000)']);               // an ordinary Node process, to be told apart from
  await new Promise(r => setTimeout(r, 400));
  const titleOf = (h, label) => 'mexican-train-server' + (label ? ' ' + label : '') + ' :' + h.port;
  ok(/Process name: mexican-train-server table1 :\d+/.test(a.out()) && a.out().includes(titleOf(a, 'table1')), 'it says what to look for when it starts: "' + (a.out().match(/Process name: .*?\s{2}/) || [''])[0].trim() + '"');
  ok(/ps -ef \| grep mexican-train-server/.test(a.out()), 'and how to find it: ps -ef | grep mexican-train-server');
  if (hasPs) {
    ok(psArgs(a.child.pid) === titleOf(a, 'table1'), `ps shows the first one as "${psArgs(a.child.pid)}"`);
    ok(psArgs(b.child.pid) === titleOf(b, 'practice-2'), `and the second as "${psArgs(b.child.pid)}": a label of your own tells them apart`);
    ok(psArgs(c.child.pid) === titleOf(c, null), `with no label: "${psArgs(c.child.pid)}"`);
    const all = execFileSync('ps', ['-eo', 'pid,args']).toString().split('\n');
    const mine = all.filter(l => /^\s*\d+\s+mexican-train-server\b/.test(l));        // (processes whose command IS the server; a shell that merely mentions the name, as this test's own launcher may, is not one)
    ok(mine.length === 3 && [a, b, c].every(h => mine.some(l => l.trim().startsWith(h.child.pid + ' '))), 'a search of all processes for "mexican-train-server" finds exactly these three');
    ok(!/mexican-train-server/.test(psArgs(other.pid)) && /node/.test(psArgs(other.pid)), 'and not an ordinary Node process, which still shows as node: "' + psArgs(other.pid).slice(0, 40) + '"');
    ok(all.filter(l => /^\s*\d+\s+mexican-train-server\b.*\btable1\b/.test(l)).length === 1, 'the label picks out the one server (of the processes called mexican-train-server, one has table1)');
  }
  const r = await get(a.port, '/info').catch(e => ({ status: 0, body: String(e) }));
  let info = {}; try { info = JSON.parse(r.body); } catch (e) { /* not JSON */ }
  ok(r.status === 200 && info.maxHumans === 3 && typeof info.build === 'string', 'the renamed server serves as usual (/info answers, build ' + info.build + ')');
  const page = await get(a.port, '/');
  ok(page.status === 200 && /Mexican Train/.test(page.body), 'and serves the game page');
  other.kill();
  const codes = await Promise.all([stop(a.child), stop(b.child), stop(c.child)]);
  ok(codes.every(x => x === 0), 'and stops cleanly when asked (Ctrl+C / kill)');

  console.log('3. the --name option');
  const bad = (args) => { const r = spawnSync(node, [server].concat(args), { timeout: 5000 }); return { code: r.status, err: r.stderr.toString(), out: r.stdout.toString() }; };
  for (const v of ['has space', '', 'x'.repeat(41), 'a/b', 'semi;colon', '$(x)']) { const r2 = bad(['--name', v, '--port', '0']); ok(r2.code === 1 && /--name must be 1 to 40/.test(r2.err), `--name "${v.length > 12 ? v.slice(0, 12) + '...' : v}" is refused`); }
  const none = bad(['--name']);
  ok(none.code === 1 && /--name must be/.test(none.err), '--name with nothing after it is refused');
  const help = bad(['--help']);
  ok(help.code === 0 && /--name LABEL/.test(help.out) && /ps -ef/.test(help.out) && /mexican-train-server/.test(help.out), '--help describes it, and what ps shows');
  const okNames = ['a', 'table1', 'my.game_2-b:x', 'A'.repeat(40)];
  for (const v of okNames) { const h = await start(['--name', v]); ok(h.out().includes('mexican-train-server ' + v + ' :'), `--name ${v.length > 12 ? v.slice(0, 12) + '...' : v} is accepted`); await stop(h.child); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
