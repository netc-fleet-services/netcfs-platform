-- Allow mechanics, dispatchers, and drivers to update truck status
-- admin and shop_manager already have full access via "trucks_admin" policy.
-- This policy covers the remaining operational roles for status-only updates.

CREATE POLICY "trucks_status_update"
  ON trucks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('dispatcher', 'mechanic', 'driver')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('dispatcher', 'mechanic', 'driver')
    )
  );
