-- ── Safety Program Schema ────────────────────────────────────────────────────
-- Creates the four core safety tables: safety_events, dvir_logs,
-- compliance_events, score_snapshots.
-- Assumes drivers table already has: yard (home yard) and function (driving type).

-- ── safety_events ─────────────────────────────────────────────────────────────
-- One row per Samsara safety event (coached or dismissed).
CREATE TABLE IF NOT EXISTS safety_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  samsara_event_id TEXT UNIQUE NOT NULL,        -- Samsara's external ID (for dedup)
  driver_id        INT REFERENCES drivers(id),
  driver_name      TEXT,                         -- denormalised for resilience
  vehicle_id       TEXT,                         -- Samsara vehicle ID
  unit_number      TEXT,                         -- human-readable unit
  occurred_at      TIMESTAMPTZ NOT NULL,
  event_type       TEXT NOT NULL,                -- e.g. 'mobile_usage', 'speeding_15_19'
  raw_status       TEXT,                         -- samsara raw status
  final_status     TEXT CHECK (final_status IN ('coached','dismissed','pending')),
  severity_points  INT NOT NULL DEFAULT 0,
  max_speed        NUMERIC,
  speed_limit      NUMERIC,
  labels           TEXT[],
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── dvir_logs ─────────────────────────────────────────────────────────────────
-- One row per driver per day indicating DVIR completion.
-- source: 'samsara' for Interstate drivers, 'manual' for TowBook locations.
CREATE TABLE IF NOT EXISTS dvir_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   INT REFERENCES drivers(id),
  driver_name TEXT,
  log_date    DATE NOT NULL,
  completed   BOOLEAN NOT NULL DEFAULT false,
  source      TEXT NOT NULL CHECK (source IN ('samsara', 'manual')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_id, log_date)
);

-- ── compliance_events ─────────────────────────────────────────────────────────
-- Manually entered DOT citations, OOS orders, and other compliance events.
CREATE TABLE IF NOT EXISTS compliance_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   INT REFERENCES drivers(id),
  driver_name TEXT,
  event_date  DATE NOT NULL,
  event_type  TEXT NOT NULL CHECK (event_type IN ('dot_citation','oos','accident','other')),
  points      INT NOT NULL DEFAULT 0,
  notes       TEXT,
  entered_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── score_snapshots ───────────────────────────────────────────────────────────
-- Precomputed quarterly scores. Never updated retroactively once locked.
CREATE TABLE IF NOT EXISTS score_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id             INT REFERENCES drivers(id),
  driver_name           TEXT,
  driver_yard           TEXT,    -- snapshot of drivers.yard at time of scoring
  driver_function       TEXT,    -- snapshot of drivers.function at time of scoring
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,

  -- Driving metrics (Samsara events only)
  total_event_points    INT NOT NULL DEFAULT 0,
  miles_driven          NUMERIC NOT NULL DEFAULT 0,
  severity_rate         NUMERIC NOT NULL DEFAULT 0,  -- (points / miles) * 1000, capped at 95
  driving_score         NUMERIC NOT NULL DEFAULT 100, -- 100 - severity_rate

  -- Compliance metrics (DVIR + DOT)
  dvir_days_missed      INT NOT NULL DEFAULT 0,
  dvir_penalty          INT NOT NULL DEFAULT 0,       -- dvir_days_missed * 2
  compliance_penalty    INT NOT NULL DEFAULT 0,       -- DOT citations + OOS + dvir_penalty

  -- Final composite score
  safety_score          NUMERIC NOT NULL DEFAULT 100, -- driving_score - compliance_penalty, min 5

  -- Eligibility
  eligible              BOOLEAN NOT NULL DEFAULT true,  -- false if miles < 2000
  disqualified          BOOLEAN NOT NULL DEFAULT false, -- true if OOS or accident

  -- Ranking within group
  rank                  INT,
  rank_group            TEXT,                           -- yard or function used for ranking

  locked                BOOLEAN NOT NULL DEFAULT false, -- true = quarter is finalised
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (driver_id, period_start, period_end)
);

-- ── Updated_at trigger for safety_events ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS safety_events_updated_at ON safety_events;
CREATE TRIGGER safety_events_updated_at
  BEFORE UPDATE ON safety_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE safety_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvir_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_snapshots   ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read everything; service role (used by cron jobs) bypasses RLS
CREATE POLICY "auth read safety_events"     ON safety_events     FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read dvir_logs"         ON dvir_logs         FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read compliance_events" ON compliance_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read score_snapshots"   ON score_snapshots   FOR SELECT TO authenticated USING (true);

-- Safety managers can insert/update compliance events
CREATE POLICY "auth write compliance_events" ON compliance_events FOR ALL TO authenticated USING (true);

-- Safety managers can insert/update manual DVIR logs
CREATE POLICY "auth write dvir_logs" ON dvir_logs FOR ALL TO authenticated USING (true);
