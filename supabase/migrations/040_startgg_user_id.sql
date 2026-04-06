-- Optional start.gg OAuth link: stores the public start.gg user ID (numeric string).
-- This is a public identifier (visible on any start.gg profile page), safe with
-- authenticated-read RLS. Tokens are stored locally on the user's machine, never here.
-- Rollback: ALTER TABLE profiles DROP COLUMN IF EXISTS startgg_user_id;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS startgg_user_id text;
