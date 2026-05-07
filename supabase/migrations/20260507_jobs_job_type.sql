-- Add canonical job_type column and override flag to jobs table.
--
-- job_type: one of 'Equipment Transport', 'Heavy Duty Tow', 'Light Duty Tow',
--           'Road Service', 'Crane Service', or NULL for unclassified.
-- job_type_override: when true, the sync script will not overwrite job_type,
--                    preserving a manual correction made through the UI.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_type          text,
  ADD COLUMN IF NOT EXISTS job_type_override boolean NOT NULL DEFAULT false;

-- Backfill existing rows from tb_reason.
-- Rules (first match wins):
--   1. anything containing "transport"  → Equipment Transport
--   2. "heavy" or "hdt" anywhere        → Heavy Duty Tow
--   3. "light" or "ldt" anywhere        → Light Duty Tow
--   4. "road service" anywhere          → Road Service
--   5. "crane" anywhere                 → Crane Service
UPDATE jobs
SET job_type = CASE
  WHEN tb_reason ILIKE '%transport%'               THEN 'Equipment Transport'
  WHEN tb_reason ILIKE '%heavy%'
    OR tb_reason ILIKE '%hdt%'                     THEN 'Heavy Duty Tow'
  WHEN tb_reason ILIKE '%light%'
    OR tb_reason ILIKE '%ldt%'                     THEN 'Light Duty Tow'
  WHEN tb_reason ILIKE '%road service%'            THEN 'Road Service'
  WHEN tb_reason ILIKE '%crane%'                   THEN 'Crane Service'
  ELSE NULL
END
WHERE job_type_override = false;
