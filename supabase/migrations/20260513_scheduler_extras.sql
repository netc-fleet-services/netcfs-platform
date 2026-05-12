-- ============================================================================
-- Driver Scheduler — extras for the Historical / Settings / Optimizer features.
--
-- Idempotent. Safe to re-run. Adds:
--   1. Helper views for the company / yard filter dropdowns.
--   2. app_settings (JSONB key/value, realtime) for the optimizer thresholds
--      form in the Settings tab.
--   3. call_volume_baseline (read-only historical baseline) — TABLE ONLY.
--      Data is already loaded in prod; this migration creates the schema
--      idempotently with IF NOT EXISTS but does NOT touch rows.
-- ============================================================================


-- 1. Distinct-companies / distinct-yards helper views ------------------------
--    Push the dedupe + comma-split work to Postgres so filter dropdowns load
--    with a small targeted query instead of fetching every driver.

CREATE OR REPLACE VIEW public.scheduler_distinct_companies AS
SELECT DISTINCT "Company" AS company
  FROM public.drivers
 WHERE "Company" IS NOT NULL
   AND "Company" <> '';

COMMENT ON VIEW public.scheduler_distinct_companies IS
  'Distinct non-null Company values from drivers. Used by the company filter dropdown.';


CREATE OR REPLACE VIEW public.scheduler_distinct_yards AS
SELECT DISTINCT
       trim(unnest(string_to_array(irh_yard_number, ','))) AS yard,
       "function",
       "Company"
  FROM public.drivers
 WHERE irh_yard_number IS NOT NULL
   AND irh_yard_number <> '';

COMMENT ON VIEW public.scheduler_distinct_yards IS
  'Distinct yard codes split out of comma-separated irh_yard_number values, with the driver function and Company alongside.';

GRANT SELECT ON public.scheduler_distinct_companies TO authenticated;
GRANT SELECT ON public.scheduler_distinct_yards     TO authenticated;


-- 2. app_settings: shared editable runtime settings -------------------------

CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text         PRIMARY KEY,
  value       jsonb        NOT NULL,
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  updated_by  uuid         REFERENCES auth.users(id)
);

COMMENT ON TABLE public.app_settings IS
  'Shared runtime settings. One row per logical group (optimizer, ui, ...). value is JSONB so new fields can be added without migrations.';

CREATE OR REPLACE FUNCTION public.app_settings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.app_settings_set_updated_at();

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authed read"  ON public.app_settings;
DROP POLICY IF EXISTS "authed write" ON public.app_settings;

CREATE POLICY "authed read"
  ON public.app_settings
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "authed write"
  ON public.app_settings
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'app_settings'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings';
  END IF;
END
$$;


-- 3. call_volume_baseline: optimizer demand source --------------------------
--    Table only. Data is already populated in prod; the IF NOT EXISTS guard
--    keeps this migration idempotent without touching the rows.

CREATE TABLE IF NOT EXISTS public.call_volume_baseline (
  day_of_week smallint     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Mon..6=Sun
  hour        smallint     NOT NULL CHECK (hour BETWEEN 0 AND 23),
  month       smallint              CHECK (month BETWEEN 1 AND 12),        -- NULL = aggregate
  avg_calls   numeric(7,3) NOT NULL CHECK (avg_calls >= 0),
  source      text         NOT NULL DEFAULT 'historical_2025',
  updated_at  timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT call_volume_baseline_aggregate_uk
    UNIQUE NULLS NOT DISTINCT (day_of_week, hour, month, source)
);

COMMENT ON TABLE public.call_volume_baseline IS
  'Historical avg calls per (day_of_week, hour). month=NULL is the aggregate; month=1..12 is per-month seasonality. Copart calls are redistributed evenly across 8 AM-4 PM (inclusive, 9 hours) before averaging.';

CREATE INDEX IF NOT EXISTS idx_cvb_dow_hour ON public.call_volume_baseline (day_of_week, hour);

ALTER TABLE public.call_volume_baseline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authed read" ON public.call_volume_baseline;
CREATE POLICY "authed read"
  ON public.call_volume_baseline
  FOR SELECT TO authenticated
  USING (true);
