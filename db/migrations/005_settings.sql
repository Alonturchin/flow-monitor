-- Migration 005: app_settings key-value table
-- Stores runtime-editable configuration (alert thresholds, etc.)

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_app_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION update_app_settings_timestamp();

-- Seed default alert thresholds
INSERT INTO app_settings (key, value) VALUES (
  'alert_thresholds',
  '{
    "spam_critical":   0.005,
    "spam_warning":    0.002,
    "bounce_critical": 0.05,
    "bounce_warning":  0.02,
    "unsub_warning":   0.03,
    "unsub_info":      0.015,
    "open_critical":   0.10,
    "open_info":       0.25,
    "click_info":      0.01,
    "min_recipients":  500,
    "revenue_drop_warning":  0.25,
    "revenue_drop_critical": 0.50,
    "revenue_drop_min":      100,
    "open_drop_warning":     0.20,
    "open_drop_critical":    0.40,
    "click_drop_warning":    0.25,
    "click_drop_critical":   0.50
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;
