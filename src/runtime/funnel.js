'use strict';

// Records first-occurrence activation-funnel milestones (migration 029,
// src/db/migrations/index.js). Deliberately narrow — four fixed event types,
// not a general event log. Every call site wraps this in nothing extra: it's
// already safe to call unconditionally and often (INSERT OR IGNORE is the
// entire "already recorded?" check), and it never throws, so a milestone
// write can never break the real feature that triggered it.

const { getDb } = require('../db');

const EVENT_TYPES = new Set(['install_completed', 'first_track_scanned', 'went_public', 'first_listener']);

function recordMilestone(eventType, metadata) {
  if (!EVENT_TYPES.has(eventType)) return;
  try {
    getDb().prepare(
      'INSERT OR IGNORE INTO funnel_events (event_type, metadata) VALUES (?, ?)'
    ).run(eventType, metadata ? JSON.stringify(metadata) : null);
  } catch {
    // Never let milestone bookkeeping break the feature that triggered it.
  }
}

function getMilestones() {
  try {
    return getDb().prepare('SELECT event_type, occurred_at, metadata FROM funnel_events').all();
  } catch {
    return [];
  }
}

module.exports = { recordMilestone, getMilestones, EVENT_TYPES };
