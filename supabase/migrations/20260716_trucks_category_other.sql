-- Allow 'other' as a truck category (support units: loaders, crash trucks,
-- yard plow trucks) alongside the existing towing/transport categories.
ALTER TABLE trucks DROP CONSTRAINT IF EXISTS trucks_category_check;
ALTER TABLE trucks ADD CONSTRAINT trucks_category_check
  CHECK (category = ANY (ARRAY['hd_tow'::text, 'ld_tow'::text, 'roadside'::text, 'transport'::text, 'trailer'::text, 'other'::text]));
