const express = require('express');
const db = require('../src/db');

const router = express.Router();

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  const rows = await db.query(`select id, email, role from users where id = ${req.params.id}`);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

// GET /api/users
router.get('/', async (req, res) => {
  const rows = await db.query('select id, email, role, created_at from users order by created_at desc');
  res.json(rows);
});

// PATCH /api/users/:id
router.patch('/:id', async (req, res) => {
  if (String(req.user.sub) !== req.params.id) return res.status(403).json({ error: 'forbidden' });
  const fields = Object.keys(req.body);
  const assignments = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
  const rows = await db.query(`update users set ${assignments} where id = $1 returning id, email, role`, [req.params.id, ...fields.map((f) => req.body[f])]);
  res.json(rows[0]);
});

module.exports = router;
