-- Add top_characters column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS top_characters JSONB DEFAULT '[]';

-- Index for efficient aggregation on matches
CREATE INDEX IF NOT EXISTS idx_matches_user_character
  ON matches (user_id, user_character_id)
  WHERE user_character_id IS NOT NULL;

-- Trigger function: recompute top 3 characters for a user after match insert
CREATE OR REPLACE FUNCTION recompute_top_characters()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles
  SET top_characters = (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    FROM (
      SELECT user_character_id AS "characterId", COUNT(*)::int AS "gameCount"
      FROM matches
      WHERE user_id = NEW.user_id AND user_character_id IS NOT NULL
      GROUP BY user_character_id
      ORDER BY COUNT(*) DESC
      LIMIT 3
    ) t
  )
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_recompute_top_characters
  AFTER INSERT ON matches
  FOR EACH ROW EXECUTE FUNCTION recompute_top_characters();

-- Backfill existing users
UPDATE profiles p
SET top_characters = sub.chars
FROM (
  SELECT user_id, COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) AS chars
  FROM (
    SELECT user_id, user_character_id AS "characterId", COUNT(*)::int AS "gameCount"
    FROM matches
    WHERE user_character_id IS NOT NULL
    GROUP BY user_id, user_character_id
  ) t
  GROUP BY user_id
) sub
WHERE p.id = sub.user_id;

-- The backfill above gives ALL characters per user; trim to top 3
UPDATE profiles p
SET top_characters = (
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  FROM (
    SELECT elem
    FROM jsonb_array_elements(p.top_characters) AS elem
    ORDER BY (elem->>'gameCount')::int DESC
    LIMIT 3
  ) ranked
)
WHERE jsonb_array_length(p.top_characters) > 3;
