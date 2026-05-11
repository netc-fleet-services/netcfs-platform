-- Add updated_at and last_reminder_sent_at to trucks.
-- updated_at tracks the last time a user-visible field changed (not system fields).
-- last_reminder_sent_at tracks when the weekly stale-truck reminder was last sent.

ALTER TABLE trucks
  ADD COLUMN IF NOT EXISTS updated_at            timestamptz,
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz;

-- Seed updated_at from the most recent status history entry, or fall back to now().
UPDATE trucks t
SET updated_at = COALESCE(
  (SELECT MAX(sh.created_at) FROM status_history sh WHERE sh.truck_id = t.id),
  now()
)
WHERE updated_at IS NULL;

ALTER TABLE trucks
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now();

-- ── Trigger: bump updated_at only when user-editable fields change ─────────────
-- Deliberately excludes updated_at, last_reminder_sent_at, samsara_vehicle_id, etc.
-- so system writes don't reset the inactivity clock.

CREATE OR REPLACE FUNCTION _truck_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    OLD.current_status IS DISTINCT FROM NEW.current_status OR
    OLD.waiting_on     IS DISTINCT FROM NEW.waiting_on     OR
    OLD.location_id    IS DISTINCT FROM NEW.location_id    OR
    OLD.category       IS DISTINCT FROM NEW.category       OR
    OLD.unit_number    IS DISTINCT FROM NEW.unit_number    OR
    OLD.active         IS DISTINCT FROM NEW.active
  ) THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trucks_touch_updated_at ON trucks;
CREATE TRIGGER trucks_touch_updated_at
  BEFORE UPDATE ON trucks
  FOR EACH ROW EXECUTE FUNCTION _truck_touch_updated_at();

-- ── Trigger: bump trucks.updated_at when a note is added ─────────────────────
-- Adding a mechanic note counts as activity and resets the 7-day clock.

CREATE OR REPLACE FUNCTION _truck_note_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE trucks SET updated_at = now() WHERE id = NEW.truck_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS truck_notes_touch_truck ON truck_notes;
CREATE TRIGGER truck_notes_touch_truck
  AFTER INSERT ON truck_notes
  FOR EACH ROW EXECUTE FUNCTION _truck_note_touch_updated_at();
