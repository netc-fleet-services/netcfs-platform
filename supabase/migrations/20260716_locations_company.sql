-- Company layer for the maintenance tracker: each location (yard) belongs to a
-- company ('netc' | 'interstate'). Existing yards default to NETC; the legacy
-- "Interstate" location belongs to interstate and will be retired once its
-- trucks move to the real Interstate yards (Chicopee / Sturbridge).
ALTER TABLE locations ADD COLUMN IF NOT EXISTS company TEXT NOT NULL DEFAULT 'netc';
UPDATE locations SET company = 'interstate' WHERE name = 'Interstate';
