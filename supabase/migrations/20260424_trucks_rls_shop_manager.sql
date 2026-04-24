-- Grant shop_manager full truck management permissions (insert + update)
-- Run this in the Supabase SQL Editor

-- Drop the existing admin-only ALL policy and replace it with one that
-- includes shop_manager so they can add and edit trucks in admin settings.
DROP POLICY IF EXISTS "trucks_admin" ON trucks;

CREATE POLICY "trucks_admin"
  ON trucks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'shop_manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'shop_manager')
    )
  );
