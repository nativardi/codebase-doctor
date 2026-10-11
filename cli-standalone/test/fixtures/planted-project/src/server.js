const express = require('express');
const config = require('./config');
const users = require('../api/users');
const orders = require('../api/orders');
const admin = require('../api/admin');
const webhooks = require('../api/webhooks');
const { requireAuth, requireAdmin } = require('./auth');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/users', requireAuth, users);
app.use('/api/orders', requireAuth, orders);
app.use('/api/admin', requireAuth, requireAdmin, admin);
app.use('/webhooks', webhooks);

app.use((error, req, res, next) => {
  res.status(500).json({ error: error.message, stack: error.stack });
});

if (require.main === module) {
  app.listen(config.port);
}

module.exports = app;
