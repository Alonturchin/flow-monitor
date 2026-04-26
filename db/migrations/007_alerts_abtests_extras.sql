-- Backfills columns that were added ad-hoc to local DB but never migrated.
-- Safe to re-run.

DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM ('critical', 'warning', 'info');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS severity     alert_severity NOT NULL DEFAULT 'warning',
  ADD COLUMN IF NOT EXISTS week_start   DATE,
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts (severity);

ALTER TABLE ab_tests
  ADD COLUMN IF NOT EXISTS rationale       TEXT,
  ADD COLUMN IF NOT EXISTS expected_impact TEXT,
  ADD COLUMN IF NOT EXISTS monday_task_id  TEXT;
