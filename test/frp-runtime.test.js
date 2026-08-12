process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');

const frp = require('../src/runtime/frp');

test('frp installHint returns FRP-specific guidance', () => {
  assert.match(frp.installHint(), /frp|frpc|Paperweight/i);
});

test('frpcPath is a non-empty string', () => {
  assert.equal(typeof frp.frpcPath, 'string');
  assert.ok(frp.frpcPath.length > 0);
});
