-- Prevent duplicate provider webhook deliveries from being processed twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_provider_event_id
ON webhook_events(provider, event_id)
WHERE event_id IS NOT NULL;
