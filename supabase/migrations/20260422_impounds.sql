-- Impound tracker tables
-- Run in Supabase SQL Editor

-- Main impounds table
CREATE TABLE impounds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_number           text UNIQUE NOT NULL,
  date_of_impound       date,
  make_model            text,
  year                  text,
  vin                   text,
  reason_for_impound    text,
  notes                 text,
  location              text,
  status                text,
  released              boolean NOT NULL DEFAULT false,
  amount_paid           numeric(10,2),
  internal_cost         numeric(10,2),
  sell                  boolean NOT NULL DEFAULT false,
  keys                  boolean,           -- null = unknown
  drives                boolean,           -- null = unknown
  sales_description     text,
  estimated_value       numeric(10,2),
  needs_detail          boolean NOT NULL DEFAULT false,
  needs_mechanic        boolean NOT NULL DEFAULT false,
  estimated_repair_cost numeric(10,2),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER impounds_updated_at
  BEFORE UPDATE ON impounds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Vehicle photos
CREATE TABLE impound_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impound_id   uuid NOT NULL REFERENCES impounds(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name    text NOT NULL,
  uploaded_by  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX impound_photos_impound_id_idx ON impound_photos(impound_id);

-- RLS
ALTER TABLE impounds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE impound_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Impound access"
  ON impounds FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'dispatcher', 'impound_manager')
    )
  );

CREATE POLICY "Impound photo access"
  ON impound_photos FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'dispatcher', 'impound_manager')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage bucket + RLS for impound photos
--
-- Step 1: Create the bucket in Supabase Dashboard → Storage → New bucket
--   Name: impound-photos   Public: NO
--
-- Step 2: Run the three policies below in the SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "Impound photo upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'impound-photos' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'dispatcher', 'impound_manager')
    )
  );

CREATE POLICY "Impound photo read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'impound-photos' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'dispatcher', 'impound_manager')
    )
  );

CREATE POLICY "Impound photo delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'impound-photos' AND
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'dispatcher', 'impound_manager')
    )
  );
