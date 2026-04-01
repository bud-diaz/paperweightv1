-- Webhook event log — one row per received Stripe or PayPal event.
-- outcome: 'ok' | 'skipped' | 'error'
-- error_msg: populated only when outcome = 'error'
CREATE TABLE IF NOT EXISTS webhook_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider     TEXT    NOT NULL,             -- 'stripe' | 'paypal'
  event_id     TEXT,                         -- Stripe event.id or PayPal transmissionId
  event_type   TEXT    NOT NULL,
  outcome      TEXT    NOT NULL DEFAULT 'ok',
  error_msg    TEXT,
  received_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id    ON webhook_events (event_id);
