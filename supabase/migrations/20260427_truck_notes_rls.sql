-- Grant appropriate roles read/write access to truck_notes and status_history.
-- shop_manager needs INSERT on truck_notes to add notes/work history via the fleet app.
-- All fleet-facing roles need SELECT to view history in the notes drawer.
--
-- Run this in the Supabase SQL Editor.

-- ── truck_notes ───────────────────────────────────────────────────────────────

ALTER TABLE truck_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "truck_notes_select" ON truck_notes;
DROP POLICY IF EXISTS "truck_notes_insert" ON truck_notes;
DROP POLICY IF EXISTS "truck_notes_delete" ON truck_notes;

-- All authenticated users with fleet access can read notes
CREATE POLICY "truck_notes_select"
  ON truck_notes FOR SELECT
  TO authenticated
  USING (true);

-- Fleet-facing roles can add notes (type enforcement is done in the app)
CREATE POLICY "truck_notes_insert"
  ON truck_notes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'shop_manager', 'dispatcher', 'mechanic', 'driver')
    )
  );

-- Only admins and shop_managers can delete notes
CREATE POLICY "truck_notes_delete"
  ON truck_notes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'shop_manager')
    )
  );

-- ── status_history ────────────────────────────────────────────────────────────

ALTER TABLE status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "status_history_select" ON status_history;
DROP POLICY IF EXISTS "status_history_insert" ON status_history;

-- All authenticated users can read status history
CREATE POLICY "status_history_select"
  ON status_history FOR SELECT
  TO authenticated
  USING (true);

-- Roles that can change truck status can insert history rows.
-- (change_truck_status RPC runs as SECURITY DEFINER; this policy covers
--  any direct inserts and future code paths.)
CREATE POLICY "status_history_insert"
  ON status_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'shop_manager', 'dispatcher', 'mechanic')
    )
  );
