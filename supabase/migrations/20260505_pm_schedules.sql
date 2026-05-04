-- PM schedule definitions (9 schedules matching Samsara configuration)
CREATE TABLE IF NOT EXISTS pm_schedules (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT    NOT NULL UNIQUE,
  interval_type  TEXT    NOT NULL CHECK (interval_type IN ('days', 'miles', 'hours')),
  interval_value INTEGER NOT NULL
);

INSERT INTO pm_schedules (name, interval_type, interval_value) VALUES
  ('Interstate Trailer PMs', 'days',  180),
  ('Interstate Gas Assets',  'miles', 5000),
  ('Interstate Wet PMs',     'miles', 10000),
  ('Powered Equipment',      'days',  365),
  ('180 DAY TRAILER PM',     'days',  180),
  ('ROTATOR PM',             'hours', 250),
  ('B PM SERVICE',           'miles', 10000),
  ('Trailer PM''s',          'days',  90),
  ('HEAVY PM SERVICE',       'miles', 5000)
ON CONFLICT (name) DO NOTHING;

-- Per-truck PM assignment and tracking (one row per truck × schedule combination)
CREATE TABLE IF NOT EXISTS truck_pm_assignments (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id         UUID          NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  pm_schedule_id   UUID          NOT NULL REFERENCES pm_schedules(id),
  last_pm_date     DATE,
  last_pm_mileage  INTEGER,
  last_pm_hours    NUMERIC(10,1),
  current_odometer INTEGER,
  current_hours    NUMERIC(10,1),
  logged_by        TEXT,
  logged_at        TIMESTAMPTZ,
  UNIQUE (truck_id, pm_schedule_id)
);

CREATE INDEX IF NOT EXISTS idx_truck_pm_truck    ON truck_pm_assignments (truck_id);
CREATE INDEX IF NOT EXISTS idx_truck_pm_schedule ON truck_pm_assignments (pm_schedule_id);
