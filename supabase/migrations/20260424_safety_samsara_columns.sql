-- Add Samsara driver ID to drivers table for event → driver mapping
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS samsara_driver_id TEXT UNIQUE;

-- Daily mileage per driver (aggregated from Samsara trips)
CREATE TABLE IF NOT EXISTS mileage_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   INT REFERENCES drivers(id),
  driver_name TEXT,
  log_date    DATE NOT NULL,
  miles       NUMERIC NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'samsara',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_id, log_date)
);

ALTER TABLE mileage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read mileage_logs" ON mileage_logs FOR SELECT TO authenticated USING (true);
