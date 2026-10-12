// Test shim: exposes the browser engine under the same API the CLI tests expect.
require('./game.js');
const E = globalThis.MexicanTrainGame.Engine;
module.exports = Object.assign({}, E, {
  cpuController: { choose: async (g, p, m) => E.cpuChoose(g, p, m) },
  isDouble: t => t[0] === t[1],
});
