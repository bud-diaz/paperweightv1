const { getDb } = require('../db');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseTimeToMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(TIME_RE);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isValidTime(value) {
  return parseTimeToMinutes(value) !== null;
}

function isValidDayOfWeek(value) {
  return value == null || (Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 6);
}

function previousDow(dow) {
  return dow === 0 ? 6 : dow - 1;
}

function blockMatchesDay(blockDow, dow) {
  return blockDow == null || Number(blockDow) === dow;
}

function isBlockActiveAt(block, date = new Date()) {
  const start = parseTimeToMinutes(block.start_time);
  const end = parseTimeToMinutes(block.end_time);
  if (start == null || end == null || start === end) return false;

  const dow = date.getDay();
  const minute = date.getHours() * 60 + date.getMinutes();
  const blockDow = block.day_of_week;

  if (start < end) {
    return blockMatchesDay(blockDow, dow) && minute >= start && minute < end;
  }

  // Overnight block, e.g. 22:00 -> 02:00. The block belongs to the day it
  // starts. After midnight, it is still active for the previous start day.
  if (minute >= start) {
    return blockMatchesDay(blockDow, dow);
  }

  if (minute < end) {
    return blockDow == null || Number(blockDow) === previousDow(dow);
  }

  return false;
}

function sortBlocks(a, b) {
  const priorityDiff = (b.priority || 0) - (a.priority || 0);
  if (priorityDiff) return priorityDiff;
  return String(a.start_time).localeCompare(String(b.start_time));
}

function resolveCurrentBlock(date = new Date()) {
  const blocks = getDb().prepare('SELECT * FROM schedule_blocks').all();
  return blocks
    .filter(block => isBlockActiveAt(block, date))
    .sort(sortBlocks)[0] || null;
}

module.exports = {
  resolveCurrentBlock,
  isBlockActiveAt,
  isValidTime,
  isValidDayOfWeek,
  parseTimeToMinutes,
};
