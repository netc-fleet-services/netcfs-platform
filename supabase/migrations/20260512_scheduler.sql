-- ============================================================================
-- Driver Scheduler — initial schema for the new monorepo `scheduler` app.
--
-- Ports the schema from the standalone Interstate Driver Scheduler:
--   1. Adds active / inactive_reason / inactive_since columns to `drivers`
--      (additive; existing rows default to active = true).
--   2. Creates `scheduler_driver_schedule` — one row per driver per date, but
--      multiple shifts per day are allowed (no UNIQUE constraint).
--   3. Adds an updated_at trigger, RLS policies, and Realtime publication.
--
-- Idempotent: safe to re-run. Does not touch the irh_driver_number /
-- irh_yard_number columns (added by an earlier roster sync against the same
-- shared Supabase project).
-- ============================================================================


-- 1. Additive columns on the shared `drivers` table
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS active           boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inactive_reason  text,
  ADD COLUMN IF NOT EXISTS inactive_since   date;

COMMENT ON COLUMN public.drivers.active IS
  'Active in the scheduler. Defaults true; flip to false when a driver leaves. History is preserved in scheduler_driver_schedule.';
COMMENT ON COLUMN public.drivers.inactive_reason IS
  'Optional: terminated / quit / transferred / other.';
COMMENT ON COLUMN public.drivers.inactive_since IS
  'Optional: date the driver became inactive.';


-- 2. New table: scheduler_driver_schedule (multi-shift per day, no UNIQUE)
CREATE TABLE IF NOT EXISTS public.scheduler_driver_schedule (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       integer     NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  schedule_date   date        NOT NULL,
  entry_type      text        NOT NULL,
  start_time      time,
  end_time        time,
  off_reason      text,
  notes           text,
  created_by      uuid        REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entry_type_valid CHECK (entry_type IN ('shift', 'off')),

  CONSTRAINT off_reason_valid CHECK (
    off_reason IS NULL
    OR off_reason IN ('PTO', 'sick', 'unavailable', 'other')
  ),

  CONSTRAINT entry_fields_match_type CHECK (
    (entry_type = 'shift'
       AND start_time IS NOT NULL
       AND end_time   IS NOT NULL
       AND off_reason IS NULL)
    OR
    (entry_type = 'off'
       AND start_time IS NULL
       AND end_time   IS NULL)
  )
);

COMMENT ON TABLE public.scheduler_driver_schedule IS
  'Driver schedule entries. Multiple shifts per (driver, date) allowed. entry_type=shift uses start_time/end_time (end_time<start_time means rolls into the next day). entry_type=off uses off_reason.';

CREATE INDEX IF NOT EXISTS idx_sched_schedule_date
  ON public.scheduler_driver_schedule (schedule_date);
CREATE INDEX IF NOT EXISTS idx_sched_driver_id
  ON public.scheduler_driver_schedule (driver_id);


-- 3. Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION public.scheduler_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sched_updated_at ON public.scheduler_driver_schedule;
CREATE TRIGGER trg_sched_updated_at
  BEFORE UPDATE ON public.scheduler_driver_schedule
  FOR EACH ROW
  EXECUTE FUNCTION public.scheduler_set_updated_at();


-- 4. Row-Level Security — any authenticated platform user can read/write.
--    The anon key alone gets nothing.
ALTER TABLE public.scheduler_driver_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authed read"   ON public.scheduler_driver_schedule;
DROP POLICY IF EXISTS "authed insert" ON public.scheduler_driver_schedule;
DROP POLICY IF EXISTS "authed update" ON public.scheduler_driver_schedule;
DROP POLICY IF EXISTS "authed delete" ON public.scheduler_driver_schedule;

CREATE POLICY "authed read"
  ON public.scheduler_driver_schedule
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "authed insert"
  ON public.scheduler_driver_schedule
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "authed update"
  ON public.scheduler_driver_schedule
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authed delete"
  ON public.scheduler_driver_schedule
  FOR DELETE TO authenticated
  USING (true);


-- 5. Realtime: broadcast changes so all logged-in dispatchers see live updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'scheduler_driver_schedule'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduler_driver_schedule';
  END IF;
END
$$;
