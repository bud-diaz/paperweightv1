// Schedule-block resolution. Pure logic — no database needed, but the module
// pulls in ../config at import time, so load the harness first to set the
// PAPERWEIGHT_ALLOW_MISSING_ENV / DATA_PATH guards before config evaluates.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const {
  isBlockActiveAt,
  isValidTime,
  isValidDayOfWeek,
  parseTimeToMinutes,
} = require('../src/broadcast/scheduler');

// A fixed reference instant: 2024-01-03 12:00 local time (a Wednesday).
function at(hour, minute = 0) {
  return new Date(2024, 0, 3, hour, minute, 0);
}

test('parseTimeToMinutes parses HH:MM and rejects junk', () => {
  assert.strictEqual(parseTimeToMinutes('09:30'), 570);
  assert.strictEqual(parseTimeToMinutes('00:00'), 0);
  assert.strictEqual(parseTimeToMinutes('23:59'), 1439);
  assert.strictEqual(parseTimeToMinutes('24:00'), null);
  assert.strictEqual(parseTimeToMinutes('9:30'), null);
  assert.strictEqual(parseTimeToMinutes('nope'), null);
});

test('isValidTime / isValidDayOfWeek', () => {
  assert.ok(isValidTime('09:00'));
  assert.ok(!isValidTime('25:00'));
  assert.ok(isValidDayOfWeek(null));
  assert.ok(isValidDayOfWeek(0));
  assert.ok(isValidDayOfWeek(6));
  assert.ok(!isValidDayOfWeek(7));
  assert.ok(!isValidDayOfWeek(-1));
});

test('daytime block: inclusive start, exclusive end', () => {
  const block = { start_time: '09:00', end_time: '17:00', day_of_week: null };
  assert.ok(!isBlockActiveAt(block, at(8, 59)));
  assert.ok(isBlockActiveAt(block, at(9, 0)));   // inclusive start
  assert.ok(isBlockActiveAt(block, at(12, 0)));
  assert.ok(!isBlockActiveAt(block, at(17, 0))); // exclusive end
});

test('zero-length block (start === end) is never active', () => {
  const block = { start_time: '10:00', end_time: '10:00', day_of_week: null };
  assert.ok(!isBlockActiveAt(block, at(10, 0)));
});

test('overnight block spans midnight', () => {
  const block = { start_time: '22:00', end_time: '02:00', day_of_week: null };
  assert.ok(!isBlockActiveAt(block, at(21, 0)));
  assert.ok(isBlockActiveAt(block, at(22, 0)));
  assert.ok(isBlockActiveAt(block, at(1, 0)));
  assert.ok(!isBlockActiveAt(block, at(2, 0)));  // exclusive end
  assert.ok(!isBlockActiveAt(block, at(3, 0)));
});

test('day_of_week gates a daytime block to its day', () => {
  const wed = at(12, 0).getDay();
  assert.ok(isBlockActiveAt({ start_time: '09:00', end_time: '17:00', day_of_week: wed }, at(12, 0)));
  assert.ok(!isBlockActiveAt({ start_time: '09:00', end_time: '17:00', day_of_week: (wed + 1) % 7 }, at(12, 0)));
});

test('overnight block after midnight belongs to the previous day', () => {
  // At 01:00 Wednesday, a 22:00->02:00 block is the one that started Tuesday.
  const wed = at(1, 0).getDay();
  const tue = (wed + 6) % 7;
  assert.ok(isBlockActiveAt({ start_time: '22:00', end_time: '02:00', day_of_week: tue }, at(1, 0)));
  assert.ok(!isBlockActiveAt({ start_time: '22:00', end_time: '02:00', day_of_week: wed }, at(1, 0)));
});
