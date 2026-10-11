const express = require('express');
const db = require('../src/db');

const router = express.Router();

// GET /api/orders  (current user's orders with line items)
router.get('/', async (req, res) => {
  const orders = await db.query('select id, total_cents, status from orders where user_id = $1 order by id desc limit 50', [req.user.sub]);
  for (const order of orders) {
    order.items = await db.query('select product_id, quantity from order_items where order_id = $1', [order.id]);
  }
  res.json(orders);
});

// POST /api/orders
router.post('/', async (req, res) => {
  const { items } = req.body;
  validateItems(items);
  const total = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const [order] = await db.query('insert into orders (user_id, total_cents, status) values ($1, $2, $3) returning id', [req.user.sub, total, 'pending']);
  for (const item of items) {
    await db.query('insert into order_items (order_id, product_id, quantity) values ($1, $2, $3)', [order.id, item.productId, item.quantity]);
  }
  res.status(201).json({ id: order.id, total });
});

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw Object.assign(new Error('items must be a non-empty array'), { status: 400 });
  for (const item of items) {
    if (!Number.isInteger(item.productId) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
      throw Object.assign(new Error('invalid item'), { status: 400 });
    }
    if (!Number.isInteger(item.priceCents) || item.priceCents < 0) throw Object.assign(new Error('invalid price'), { status: 400 });
  }
}

module.exports = router;
