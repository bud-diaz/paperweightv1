-- 011_payment_idempotency.sql
-- Defense-in-depth uniqueness for payment identifiers. The webhook handler now
-- claims each event transactionally (see claimAndRun in src/api/payment.js), but
-- these partial unique indexes also protect the success-redirect paths
-- (/tip-success, /vault checkout return) so a tip or vault unlock can never be
-- recorded twice for the same payment, even outside the webhook gate.
--
-- Partial (WHERE ... IS NOT NULL) so rows without a captured payment id are
-- unaffected. Idempotent and non-destructive per the migration rules in CLAUDE.md.

CREATE UNIQUE INDEX IF NOT EXISTS idx_tips_payment_intent
  ON tips (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_unlocks_payment
  ON vault_unlocks (stripe_payment_id)
  WHERE stripe_payment_id IS NOT NULL;
