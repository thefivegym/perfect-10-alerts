-- A single running total. No addresses, accounts, or browser identifiers.
CREATE TABLE IF NOT EXISTS visitor_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total INTEGER NOT NULL DEFAULT 0
);

INSERT INTO visitor_counter (id, total) VALUES (1, 0) ON CONFLICT(id) DO NOTHING;
