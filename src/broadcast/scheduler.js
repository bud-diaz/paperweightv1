const { getDb } = require('../db');

// Returns the highest-priority schedule block active right now, or null.
function resolveCurrentBlock() {
  const now = new Date();
  const dow = now.getDay();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return getDb().prepare(`
    SELECT * FROM schedule_blocks
    WHERE (day_of_week IS NULL OR day_of_week = :dow)
      AND start_time <= :time
      AND end_time > :time
    ORDER BY priority DESC
    LIMIT 1
  `).get({ dow, time: timeStr }) || null;
}

module.exports = { resolveCurrentBlock };
