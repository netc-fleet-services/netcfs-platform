-- Vehicle inspections
CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id      UUID REFERENCES trucks(id) ON DELETE SET NULL,
  unit_number   TEXT NOT NULL,
  inspector     TEXT NOT NULL,
  inspected_date DATE NOT NULL,
  items         JSONB NOT NULL DEFAULT '[]',
  has_fails     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_inspections_truck_id_idx ON vehicle_inspections(truck_id);
CREATE INDEX IF NOT EXISTS vehicle_inspections_date_idx ON vehicle_inspections(inspected_date DESC);

ALTER TABLE vehicle_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated users can read inspections"
  ON vehicle_inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated users can insert inspections"
  ON vehicle_inspections FOR INSERT TO authenticated WITH CHECK (true);

-- Equipment requests
CREATE TABLE IF NOT EXISTS equipment_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by     TEXT NOT NULL,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  urgent           BOOLEAN NOT NULL DEFAULT false,
  request_type     TEXT NOT NULL CHECK (request_type IN ('replacement', 'new')),
  description      TEXT NOT NULL,
  purpose          TEXT NOT NULL,
  if_not_purchased TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  manager_notes    TEXT,
  denial_reason    TEXT,
  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS equipment_requests_status_idx ON equipment_requests(status);
CREATE INDEX IF NOT EXISTS equipment_requests_submitted_at_idx ON equipment_requests(submitted_at DESC);

ALTER TABLE equipment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated users can read equipment requests"
  ON equipment_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated users can insert equipment requests"
  ON equipment_requests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "managers can update equipment requests"
  ON equipment_requests FOR UPDATE TO authenticated USING (true);
