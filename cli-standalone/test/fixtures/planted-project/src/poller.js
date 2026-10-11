const db = require('./db');
const config = require('./config');

// Run manually with `node src/poller.js` while developing the dashboard.
async function tick() {
  const pending = await db.query('select count(*)::int as n from orders where status = $1', ['pending']);
  process.stdout.write(`pending=${pending[0].n}\r`);
}

if (require.main === module) {
  setInterval(tick, config.pollIntervalMs);
}

module.exports = { tick };
