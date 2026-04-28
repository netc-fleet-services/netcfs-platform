-- Allows safety managers to manually mark a missed DVIR as completed.
-- Rows with manually_overridden=true are never overwritten by automated syncs.

ALTER TABLE dvir_logs
  ADD COLUMN IF NOT EXISTS manually_overridden boolean NOT NULL DEFAULT false;
