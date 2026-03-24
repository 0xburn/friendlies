-- Privacy settings on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hide_region BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hide_discord_unless_friends BOOLEAN DEFAULT FALSE;
