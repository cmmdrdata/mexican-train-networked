'use strict';
// For test_browser_connection.py: runs the game server (the repo given as argv[2], with options as JSON in argv[3]) and a second tiny
// control server that can cut a player's connection like a Wi-Fi drop. Prints {"port": N, "ctl": M}.
const fs = require('fs'), http = require('http'), path = require('path');
const DIR = path.resolve(process.argv[2]);
const opts = JSON.parse(process.argv[3] || '{}');
const logfile = process.argv[4] || '/tmp/connection_server.log';
fs.writeFileSync(logfile, '');
const { createGameServer } = require(DIR + '/server.js');
const srv = createGameServer(Object.assign({ pagePath: path.join(DIR, 'mexican-train.html'), sleep: async () => {}, stepDelay: 60, ratePerSecond: 5000, burst: 10000,
  log: m => fs.appendFileSync(logfile, `${Date.now()} ${m}\n`) }, opts));
srv.listen(0, '0.0.0.0').then(port => {
  const ctl = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/cut') {                                  // /cut?name=Ben : the connection vanishes without a goodbye
      const c = Array.from(srv.conns).find(x => x.session && (srv.rooms.size && x.session.room.players[x.session.seat].name === u.searchParams.get('name')));
      if (c) c.ws.socket.destroy();
      res.end(c ? 'cut' : 'none');
    } else res.end('?');
  }).listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port, ctl: ctl.address().port })));
});
