-- Migration 002: flow_snapshots and message_snapshots
-- Trend history — one row per flow per week, one row per message per week

CREATE TABLE IF NOT EXISTS flow_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  flow_id               TEXT          NOT NULL REFERENCES flows (flow_id) ON DELETE CASCADE,
  week_start            DATE          NOT NULL,
  recipients            INTEGER       NOT NULL DEFAULT 0,
  open_rate             NUMERIC(6,4),
  click_rate            NUMERIC(6,4),
  unsubscribe_rate      NUMERIC(6,4),
  spam_complaint_rate   NUMERIC(6,4),
  bounce_rate           NUMERIC(6,4),
  conversion_rate       NUMERIC(6,4),
  revenue               NUMERIC(12,2),
  revenue_per_recipient NUMERIC(10,4),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (flow_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_flow_snapshots_flow_week
  ON flow_snapshots (flow_id, week_start DESC);

CREATE TABLE IF NOT EXISTS message_snapshots (
  id                    BIGSERIAL PRIMARY KEY,
  flow_id               TEXT          NOT NULL REFERENCES flows (flow_id) ON DELETE CASCADE,
  message_id            TEXT          NOT NULL,
  message_name          TEXT,
  week_start            DATE          NOT NULL,
  recipients            INTEGER       NOT NULL DEFAULT 0,
  open_rate             NUMERIC(6,4),
  click_rate            NUMERIC(6,4),
  unsubscribe_rate      NUMERIC(6,4),
  spam_complaint_rate   NUMERIC(6,4),
  bounce_rate           NUMERIC(6,4),
  conversion_rate       NUMERIC(6,4),
  revenue               NUMERIC(12,2),
  revenue_per_recipient NUMERIC(10,4),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_message_snapshots_flow_week
  ON message_snapshots (flow_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_message_snapshots_message_week
  ON message_snapshots (message_id, week_start DESC);
