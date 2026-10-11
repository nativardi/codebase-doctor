// Runtime configuration. Values come from the environment in production.
module.exports = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  stripeKey: process.env.STRIPE_SECRET_KEY || 'sk_live_FAKE_planted_for_tests_not_a_real_key',
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  pollIntervalMs: 500,
};
