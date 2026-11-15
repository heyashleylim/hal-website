-- Episode types (Alex, 2026-11-15): Week, Q&A, Live, Bonus instead of Module / Bonus. A week number can be used by
-- any number of episodes (several recordings in the same week), and an episode can be released on a fixed date for
-- every cohort instead of N days after each cohort's start.
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_kind_check;
UPDATE episodes SET kind = 'week' WHERE kind = 'module';
ALTER TABLE episodes ALTER COLUMN kind SET DEFAULT 'week';
ALTER TABLE episodes ADD CONSTRAINT episodes_kind_check CHECK (kind IN ('week', 'qa', 'live', 'bonus'));
DROP INDEX IF EXISTS episodes_module_number;
CREATE INDEX episodes_show_number ON episodes (show_id, number);

-- Fixed release date and time for every cohort (null = day_offset days after the cohort start, as before).
-- A cohort's own date for the episode (cohort_episode_dates) still wins.
ALTER TABLE episodes ADD COLUMN release_at timestamptz;
