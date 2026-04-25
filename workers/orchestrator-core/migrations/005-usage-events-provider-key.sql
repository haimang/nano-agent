ALTER TABLE nano_usage_events
ADD COLUMN provider_key TEXT;

CREATE INDEX IF NOT EXISTS idx_nano_usage_events_team_provider_created
ON nano_usage_events(team_uuid, provider_key, created_at DESC);
