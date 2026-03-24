-- Store Discord user ID (snowflake) for deep linking
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS discord_id TEXT;
