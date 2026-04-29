-- Separate notification rules for vehicle inspection emails
-- Mirrors notification_settings but controls who receives inspection completion emails

CREATE TABLE inspection_notification_settings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category      text,       -- null = matches all categories
  location_id   uuid REFERENCES locations(id) ON DELETE CASCADE, -- null = matches all locations
  emails        text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE inspection_notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage inspection notification settings"
  ON inspection_notification_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'shop_manager')
    )
  );
