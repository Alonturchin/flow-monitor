-- Migration 004: ab_tests table
-- AI-generated test suggestions per flow/message

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ab_test_status') THEN
    CREATE TYPE ab_test_status AS ENUM ('pending', 'in_progress', 'completed', 'dismissed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ab_tests (
  id               BIGSERIAL PRIMARY KEY,
  flow_id          TEXT           NOT NULL REFERENCES flows (flow_id) ON DELETE CASCADE,
  message_id       TEXT,
  hypothesis       TEXT           NOT NULL,
  suggested_change TEXT           NOT NULL,
  metric_to_watch  TEXT           NOT NULL,
  confidence       NUMERIC(4,2)   NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status           ab_test_status NOT NULL DEFAULT 'pending',
  result           TEXT,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ab_tests_flow    ON ab_tests (flow_id);
CREATE INDEX IF NOT EXISTS idx_ab_tests_status  ON ab_tests (status);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ab_tests_updated_at
  BEFORE UPDATE ON ab_tests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
