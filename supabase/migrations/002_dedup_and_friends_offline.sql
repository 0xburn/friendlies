-- The following command only is originally from 002_add_app_version.sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS app_version TEXT;

-- 1. Deduplicate matches by replay_filename per user
DELETE FROM matches a USING matches b
  WHERE a.id > b.id
    AND a.user_id = b.user_id
    AND a.replay_filename = b.replay_filename;

ALTER TABLE matches
  ADD CONSTRAINT matches_user_replay_unique UNIQUE (user_id, replay_filename);

-- 2. Allow friending players who aren't on the app yet
ALTER TABLE friends ADD COLUMN friend_connect_code TEXT;

-- Backfill friend_connect_code from existing profiles links
UPDATE friends SET friend_connect_code = p.connect_code
  FROM profiles p WHERE friends.friend_id = p.id AND friends.friend_connect_code IS NULL;

ALTER TABLE friends ALTER COLUMN friend_id DROP NOT NULL;

-- Replace the old unique constraint with one on connect_code
ALTER TABLE friends DROP CONSTRAINT IF EXISTS friends_user_id_friend_id_key;
ALTER TABLE friends ADD CONSTRAINT friends_user_code_unique UNIQUE (user_id, friend_connect_code);

-- Allow upsert (dedup) on matches
CREATE POLICY "matches_own_update" ON matches FOR UPDATE USING (auth.uid() = user_id);

-- Update RLS: simplify read to own rows only (friend_id may be null)
DROP POLICY IF EXISTS "friends_own_read" ON friends;
CREATE POLICY "friends_own_read" ON friends FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "friends_own_delete" ON friends;
CREATE POLICY "friends_own_delete" ON friends FOR DELETE USING (auth.uid() = user_id);
