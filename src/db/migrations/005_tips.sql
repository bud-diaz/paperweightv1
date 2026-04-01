CREATE TABLE IF NOT EXISTS tip_config (
  id             INTEGER PRIMARY KEY CHECK(id = 1),
  amounts        TEXT    NOT NULL DEFAULT '[300,500,1000]',
  custom_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tips (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_cents                INTEGER NOT NULL,
  stripe_payment_intent_id    TEXT,
  stripe_checkout_session_id  TEXT,
  created_at                  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Seed default tip config on first run
INSERT OR IGNORE INTO tip_config (id, amounts, custom_enabled) VALUES (1, '[300,500,1000]', 1);
