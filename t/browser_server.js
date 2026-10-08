'use strict';
// Starts the game server for the real-browser test (test_browser.py), listening on the whole network on a free port,
// with the computer player answering instantly so a whole game takes seconds. Prints {"port": N} and runs until killed.
const path = require('path');
const { createGameServer } = require('../server.js');
const srv = createGameServer({ pagePath: path.join(__dirname, '..', 'mexican-train.html'), sleep: async () => {}, stepDelay: 60, log: () => {}, ratePerSecond: 5000, burst: 10000 });
srv.listen(0, '0.0.0.0').then(port => { console.log(JSON.stringify({ port })); });
