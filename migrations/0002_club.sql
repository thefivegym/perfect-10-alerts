-- Public Perfect 10 Club. Additive so it can be applied on a database that already has 0001.
ALTER TABLE alerts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_alerts_public ON alerts(meet_date, detected_at);
