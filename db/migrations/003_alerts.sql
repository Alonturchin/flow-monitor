-- Migration 003: alerts table
-- Generated automatically when thresholds are crossed

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_severity') THEN
    CREATE TYPE alert_severity AS ENUM ('critical', 'warning', 'info');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS alerts (
  id              BIGSERIAL PRIMARY KEY,
  flow_id         TEXT          NOT NULL REFERENCES flows (flow_id) ON DELETE CASCADE,
  message_id      TEXT,
  severity        alert_severity NOT NULL DEFAULT 'warning',
  metric          TEXT          NOT NULL,
  value           NUMERIC(10,4) NOT NULL,
  threshold       NUMERIC(10,4) NOT NULL,
  ai_suggestion   TEXT,
  monday_task_id  TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_flow        ON alerts (flow_id);
CREATE INDEX IF NOT EXISTS idx_alerts_severity    ON alerts (severity);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved    ON alerts (resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_created_at  ON alerts (created_at DESC);
