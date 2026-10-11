'use strict';
// Starts the game server for the real-browser test (test_browser.py), listening on the whole network on a free port,
// with the computer player answering instantly so a whole game takes seconds. Prints {"port": N} and runs until killed.
// The server's look-up of its public address never contacts the internet here: MT_PUBLIC_IP says what it finds
//   (unset or "off": the look-up is switched off; "203.0.113.9": that address; "slow:203.0.113.9:2500": that address after 2.5 seconds; "fail": nothing found;
//    "seq:203.0.113.9,203.0.113.77": the first address, then the second the next time it is asked, as when an address changes).
const path = require('path');
const { createGameServer } = require('../server.js');
const mode = process.env.MT_PUBLIC_IP || 'off';
const lookup = {};
if (mode === 'off') lookup.publicIp = false;
else if (mode === 'fail') lookup.publicIpLookup = async () => { throw new Error('no internet'); };
else if (/^seq:/.test(mode)) { const ips = mode.slice(4).split(','); let n = 0; lookup.publicIpLookup = async () => ({ ip: ips[Math.min(n++, ips.length - 1)], via: 'test lookup' }); }
else if (/^slow:/.test(mode)) { const [, ip, ms] = mode.split(':'); lookup.publicIpLookup = async () => { await new Promise(r => setTimeout(r, Number(ms) || 2000)); return { ip, via: 'test lookup' }; }; }
else lookup.publicIpLookup = async () => ({ ip: mode, via: 'test lookup' });
const check = process.env.MT_CHECK_BUILD === '1' ? { checkBuild: true } : {};                    // (MT_CHECK_BUILD=1: turn away a page that is not the one served, as the command line does)
const srv = createGameServer(Object.assign({ pagePath: path.join(__dirname, '..', 'mexican-train.html'), sleep: async () => {}, stepDelay: 60, log: () => {}, ratePerSecond: 5000, burst: 10000 }, lookup, check));
srv.listen(0, '0.0.0.0').then(port => { console.log(JSON.stringify({ port })); });
