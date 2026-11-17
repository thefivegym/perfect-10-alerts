-- Subscribers. Emails and push subscriptions stay in D1, never in git.
CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT,
  email_status TEXT NOT NULL DEFAULT 'none',
  confirm_token TEXT,
  confirm_expires_at TEXT,
  push_endpoint TEXT,
  push_p256dh TEXT,
  push_auth TEXT,
  push_status TEXT NOT NULL DEFAULT 'none',
  channels TEXT NOT NULL,
  unsub_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_push ON subscribers(push_endpoint) WHERE push_endpoint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscribers_confirm ON subscribers(confirm_token);

-- One row per athlete + event + meet. The primary key is the dedupe key.
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  athlete_name TEXT NOT NULL,
  athlete_id TEXT,
  team TEXT NOT NULL,
  event TEXT NOT NULL,
  exhibition INTEGER NOT NULL DEFAULT 0,
  meet_key TEXT NOT NULL,
  meet_name TEXT,
  meet_date TEXT NOT NULL,
  teams_label TEXT,
  video_url TEXT,
  clip_url TEXT,
  scoreboard_url TEXT NOT NULL,
  search_url TEXT NOT NULL,
  source TEXT NOT NULL,
  detected_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_detected ON alerts(detected_at);
CREATE INDEX IF NOT EXISTS idx_alerts_meet ON alerts(meet_key);

-- Per subscriber, per channel. Stops a retry from sending a second copy.
CREATE TABLE IF NOT EXISTS deliveries (
  alert_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (alert_id, subscriber_id, channel, detail)
);

CREATE TABLE IF NOT EXISTS meets (
  meet_key TEXT PRIMARY KEY,
  rtn_id INTEGER,
  date TEXT NOT NULL,
  start_utc TEXT,
  description TEXT,
  home_json TEXT NOT NULL,
  away_json TEXT NOT NULL,
  d1_teams_json TEXT NOT NULL,
  virtius TEXT,
  video_url TEXT,
  video_desc TEXT,
  intrasquad INTEGER NOT NULL DEFAULT 0,
  last_polled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_meets_date ON meets(date);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
