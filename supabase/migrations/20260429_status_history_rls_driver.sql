-- Allow drivers to insert status_history rows now that they can change truck status.

DROP POLICY IF EXISTS "status_history_insert" ON status_history;

CREATE POLICY "status_history_insert"
  ON status_history FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'shop_manager', 'dispatcher', 'mechanic', 'driver')
    )
  );
