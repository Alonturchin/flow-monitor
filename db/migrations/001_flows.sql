-- Migration 001: flows table
-- One row per Klaviyo flow

CREATE TABLE IF NOT EXISTS flows (
  flow_id       TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  tags          TEXT[]        DEFAULT '{}',
  status        TEXT          NOT NULL DEFAULT 'live',
  trigger_type  TEXT,
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flows_status ON flows (status);
CREATE INDEX IF NOT EXISTS idx_flows_tags   ON flows USING GIN (tags);
