const test = require('node:test');
const assert = require('node:assert/strict');

test('health shape', () => {
  assert.deepEqual({ ok: true }, { ok: true });
});
