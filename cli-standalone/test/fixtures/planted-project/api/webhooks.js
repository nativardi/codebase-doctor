const express = require('express');
const Stripe = require('stripe');
const config = require('../src/config');
const db = require('../src/db');
const { emailQueue } = require('../workers/email');

const router = express.Router();
const stripe = new Stripe(config.stripeKey);

// POST /webhooks/stripe
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = JSON.parse(req.body.toString());
  if (event.type === 'payment_intent.succeeded') {
    const orderId = event.data.object.metadata.orderId;
    await db.query('update orders set status = $1 where id = $2', ['paid', orderId]);
    await emailQueue.add('receipt', { orderId });
  }
  res.json({ received: true });
});

module.exports = router;
