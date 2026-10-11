const express = require('express');
const { execSync } = require('child_process');
const db = require('../src/db');

const router = express.Router();

router.get('/stats', async (req, res) => {
  res.json({ users: await db.countRows('users'), orders: await db.countRows('orders') });
});

// POST /api/admin/export  { format: 'csv' | 'json', table: 'orders' }
router.post('/export', async (req, res) => {
  const output = execSync(`psql "$DATABASE_URL" -c "\\copy ${req.body.table} to stdout csv"`).toString();
  res.type('text/csv').send(output);
});

module.exports = router;
