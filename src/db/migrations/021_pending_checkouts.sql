-- Migration 021: Bind browser checkout redirects to local state.
-- Prevents a Stripe session id from acting as a standalone listener login
-- credential by requiring the success redirect to match an unconsumed local
-- checkout nonce created before redirecting to Stripe.

CREATE TABLE IF NOT EXISTS pending_checkouts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nonce             TEXT    NOT NULL UNIQUE,
  provider          TEXT    NOT NULL,
  stripe_session_id TEXT    UNIQUE,
  listener_id       INTEGER REFERENCES listener_accounts(id),
  tier              TEXT    NOT NULL,
  expires_at        TEXT    NOT NULL,
  consumed_at       TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pending_checkouts_nonce ON pending_checkouts(nonce);
CREATE INDEX IF NOT EXISTS idx_pending_checkouts_session ON pending_checkouts(stripe_session_id);
