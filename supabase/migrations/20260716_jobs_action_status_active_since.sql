-- Live dispatch board support: persist the raw TowBook action status and the
-- moment a job first went active, so the board can show "on a call since X,
-- free at ~Y" (free_at = active_since + calculated job duration).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS action_status text,
  ADD COLUMN IF NOT EXISTS active_since  timestamptz;

COMMENT ON COLUMN public.jobs.action_status IS
  'Raw TowBook action-status text (e.g. "On Scene", "Towing at time"). Written by sync_calls.py only.';
COMMENT ON COLUMN public.jobs.active_since IS
  'When the job first transitioned to status=active, as observed by the sync. Stable across re-syncs; reset only when a job re-enters active. Written by sync_calls.py only.';

-- Backfill currently-active jobs so the board has a usable timestamp on day one.
UPDATE public.jobs
SET active_since = COALESCE(updated_at, now())
WHERE status = 'active' AND active_since IS NULL;
