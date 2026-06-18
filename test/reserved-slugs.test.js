const test = require('node:test');
const assert = require('node:assert');
const { isReservedSlug, containsProfanity, validateSlug, RESERVED, PROFANITY } = require('../src/auth/reserved-slugs');

test('isReservedSlug: known reserved slugs are blocked', () => {
  for (const slug of ['admin', 'api', 'dashboard', 'paperweight', 'stream', 'login', 'verify']) {
    assert.ok(isReservedSlug(slug), `expected "${slug}" to be reserved`);
  }
});

test('isReservedSlug: case-insensitive match', () => {
  assert.ok(isReservedSlug('ADMIN'));
  assert.ok(isReservedSlug('Api'));
  assert.ok(isReservedSlug('DashBoard'));
});

test('isReservedSlug: arbitrary station names are not reserved', () => {
  assert.ok(!isReservedSlug('coolradio'));
  assert.ok(!isReservedSlug('jazzstation'));
  assert.ok(!isReservedSlug('mysoundboard'));
});

test('containsProfanity: exact profanity terms are blocked', () => {
  for (const term of PROFANITY) {
    assert.ok(containsProfanity(term), `expected "${term}" to be blocked`);
  }
});

test('containsProfanity: profanity embedded in combinations is blocked', () => {
  assert.ok(containsProfanity('asshole'));
  assert.ok(containsProfanity('fuckhead'));
  assert.ok(containsProfanity('bullshit'));
  assert.ok(containsProfanity('badass'));
  assert.ok(containsProfanity('cocky'));
  assert.ok(containsProfanity('bitchin'));
  assert.ok(containsProfanity('MYFUCKradio'));
});

test('containsProfanity: case-insensitive', () => {
  assert.ok(containsProfanity('SHIT'));
  assert.ok(containsProfanity('FuCk'));
  assert.ok(containsProfanity('BadAss'));
});

test('containsProfanity: clean slugs pass', () => {
  assert.ok(!containsProfanity('coolradio'));
  assert.ok(!containsProfanity('jazzstation'));
  assert.ok(!containsProfanity('oceanwaves'));
  assert.ok(!containsProfanity('metalfm'));
  assert.ok(!containsProfanity('lofibeats'));
});

test('validateSlug: reserved slugs return invalid', () => {
  const result = validateSlug('admin');
  assert.ok(!result.valid);
  assert.ok(result.reason.includes('reserved'));
});

test('validateSlug: profanity slugs return invalid', () => {
  const result = validateSlug('fuckradio');
  assert.ok(!result.valid);
  assert.ok(result.reason.includes('restricted'));
});

test('validateSlug: valid slugs pass', () => {
  assert.deepStrictEqual(validateSlug('coolradio'), { valid: true });
  assert.deepStrictEqual(validateSlug('jazzfm'), { valid: true });
});

test('validateSlug: missing or non-string input returns invalid', () => {
  assert.ok(!validateSlug('').valid);
  assert.ok(!validateSlug(null).valid);
  assert.ok(!validateSlug(undefined).valid);
});

test('RESERVED set contains expected entries', () => {
  const expected = [
    'admin', 'api', 'dashboard', 'login', 'logout', 'register', 'signup',
    'paperweight', 'paperweighthq', 'stream', 'streams', 'broadcast',
    'analytics', 'verify', 'verification',
  ];
  for (const slug of expected) {
    assert.ok(RESERVED.has(slug), `expected RESERVED to contain "${slug}"`);
  }
});
