-- Add TowBook stock number to impounds.
-- Used to construct direct detail page URLs for the keys sync workflow.
-- Populated from the CSV export's "Stock #" column going forward.

ALTER TABLE impounds
  ADD COLUMN IF NOT EXISTS stock_number text;
