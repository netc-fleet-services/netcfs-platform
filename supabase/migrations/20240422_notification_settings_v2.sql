-- Migrate notification_settings from status-based to category+location-based rules
-- Run this in the Supabase SQL Editor

-- Drop old table
DROP TABLE IF EXISTS notification_settings;

-- Create new table
CREATE TABLE notification_settings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category      text,       -- null = matches all categories
  location_id   uuid REFERENCES locations(id) ON DELETE CASCADE, -- null = matches all locations
  emails        text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz DEFAULT now()
);

-- RLS: only admins/shop_managers can read/write
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage notification settings"
  ON notification_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'shop_manager')
    )
  );

-- Example seed rows (optional, delete if not needed)
-- INSERT INTO notification_settings (category, location_id, emails) VALUES
--   (null, null, ARRAY['dispatch@netruckcenter.com']),  -- all trucks, all locations
--   ('hd_tow', null, ARRAY['hdtow@netruckcenter.com']); -- all HD Tow trucks
