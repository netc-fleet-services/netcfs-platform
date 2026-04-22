-- Add scrapped and sold disposition columns to impounds
-- Vehicles with either set to true are hidden from the dashboard but kept for history

ALTER TABLE impounds
  ADD COLUMN IF NOT EXISTS scrapped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sold     boolean NOT NULL DEFAULT false;
