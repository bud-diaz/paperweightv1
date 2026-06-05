#!/usr/bin/env node
// Verifies schedule window matching, including overnight blocks.

process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const { isBlockActiveAt, isValidTime } = require('../src/broadcast/scheduler');

let ok = true;

function check(name, condition) {
  if (condition) {
    console.log(`OK   ${name}`);
  } else {
    console.log(`FAIL ${name}`);
    ok = false;
  }
}

// Tuesday, June 2, 2026 in local time.
const tueAt23 = new Date(2026, 5, 2, 23, 0, 0);
const wedAt01 = new Date(2026, 5, 3, 1, 0, 0);
const wedAt03 = new Date(2026, 5, 3, 3, 0, 0);

const overnightTuesday = {
  day_of_week: 2,
  start_time: '22:00',
  end_time: '02:00',
};

check('valid HH:MM accepted', isValidTime('23:59'));
check('invalid HH:MM rejected', !isValidTime('24:00'));
check('overnight block active on start day late night', isBlockActiveAt(overnightTuesday, tueAt23));
check('overnight block active after midnight on following day', isBlockActiveAt(overnightTuesday, wedAt01));
check('overnight block inactive after end time', !isBlockActiveAt(overnightTuesday, wedAt03));
check('same-day block active in window', isBlockActiveAt({ day_of_week: 2, start_time: '10:00', end_time: '12:00' }, new Date(2026, 5, 2, 11, 0, 0)));
check('same-day block inactive outside window', !isBlockActiveAt({ day_of_week: 2, start_time: '10:00', end_time: '12:00' }, new Date(2026, 5, 2, 13, 0, 0)));

if (!ok) process.exitCode = 1;
else console.log('Scheduler check passed.');
