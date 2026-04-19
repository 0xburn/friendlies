-- Backfill: hide_avatar was added to production outside of migrations.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hide_avatar BOOLEAN DEFAULT FALSE;

-- Mutual friends feature: precomputed counts table, trigger maintenance, privacy, and RPCs.
--
-- Complexity (let F = friends of affected user, N = total users, C = discover candidates):
--
--   refresh_mutual_counts() trigger (per friendship change):
--     Time:  O(F) -- loops friends of v_friend, each does a PK upsert/delete at O(1).
--     Space: O(F) for the loop cursor; net table growth is at most F rows.
--
--   Backfill query (Section C, runs once at migration time):
--     Time:  O(E * F_avg) -- self-joins friends on friend_id, index-driven via
--            idx_friends_accepted_friend. E = accepted edges, F_avg = avg friends/user.
--     Space: O(P) where P = distinct user pairs sharing a mutual friend (worst case O(N^2)).
--
--   discover_mutual_friend_counts RPC (Discover page):
--     Time:  O(C) where C = |p_candidate_ids| (capped at 50 by caller).
--            Each candidate lookup is O(log P_user) via idx_mfc_a / idx_mfc_b.
--     Space: O(C) for the result set.
--
--   "Has Mutual Friends" toggle (client-side Discover filter):
--     Time:  O(C) -- filters already-fetched array to mutualFriendCount > 0. No extra query.
--     Space: O(C) for the filtered subset.
--
--   get_mutual_friends RPC (per-player popover):
--     Time:  O(min(F_me, F_them)) -- intersects two friend lists via index nested-loop join
--            on idx_friends_accepted_friend.
--     Space: O(M) where M = mutual friends returned (intersection size).
--
--   mutual_friend_counts table (storage):
--     Space: O(P) total. Fixed-size rows (two UUIDs + integer). CHECK (user_a < user_b)
--            prevents duplicates. Two secondary indexes add O(P) each.
--
--   Frontend (Discover.tsx):
--     Time:  O(C log C) for sort + render. hasMutualFriends filter is a linear pass.
--     Space: O(C) for React state (players array, filtered memo, add-state maps).

-- A. Precomputed mutual friend counts (canonical pair ordering: user_a < user_b)
CREATE TABLE mutual_friend_counts (
  user_a uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mutual_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE INDEX idx_mfc_a ON mutual_friend_counts (user_a, mutual_count DESC);
CREATE INDEX idx_mfc_b ON mutual_friend_counts (user_b, mutual_count DESC);

-- B. Trigger function: maintain mutual_friend_counts on friends INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION refresh_mutual_counts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_friend uuid;
  v_is_remove boolean := false;
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status != 'accepted' OR OLD.friend_id IS NULL THEN RETURN OLD; END IF;
    v_user := OLD.user_id;
    v_friend := OLD.friend_id;
    v_is_remove := true;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.status != 'accepted' OR NEW.friend_id IS NULL THEN RETURN NEW; END IF;
    v_user := NEW.user_id;
    v_friend := NEW.friend_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != 'accepted' AND NEW.status = 'accepted' AND NEW.friend_id IS NOT NULL THEN
      v_user := NEW.user_id;
      v_friend := NEW.friend_id;
    ELSIF OLD.status = 'accepted' AND OLD.friend_id IS NOT NULL
      AND (NEW.status != 'accepted' OR NEW.friend_id IS NULL) THEN
      v_user := OLD.user_id;
      v_friend := OLD.friend_id;
      v_is_remove := true;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  FOR r IN
    SELECT user_id AS other_user
    FROM friends
    WHERE friend_id = v_friend
      AND status = 'accepted'
      AND user_id != v_user
  LOOP
    IF v_is_remove THEN
      UPDATE mutual_friend_counts
      SET mutual_count = mutual_count - 1
      WHERE user_a = LEAST(v_user, r.other_user)
        AND user_b = GREATEST(v_user, r.other_user);

      DELETE FROM mutual_friend_counts
      WHERE user_a = LEAST(v_user, r.other_user)
        AND user_b = GREATEST(v_user, r.other_user)
        AND mutual_count <= 0;
    ELSE
      INSERT INTO mutual_friend_counts (user_a, user_b, mutual_count)
      VALUES (LEAST(v_user, r.other_user), GREATEST(v_user, r.other_user), 1)
      ON CONFLICT (user_a, user_b)
      DO UPDATE SET mutual_count = mutual_friend_counts.mutual_count + 1;
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER trg_mutual_counts
  AFTER INSERT OR UPDATE OR DELETE ON friends
  FOR EACH ROW EXECUTE FUNCTION refresh_mutual_counts();

-- C. Backfill from existing accepted friendships
INSERT INTO mutual_friend_counts (user_a, user_b, mutual_count)
SELECT LEAST(a.user_id, b.user_id), GREATEST(a.user_id, b.user_id), COUNT(*)::integer
FROM friends a
INNER JOIN friends b
  ON b.friend_id = a.friend_id
 AND b.status = 'accepted'
 AND b.friend_id IS NOT NULL
 AND b.user_id != a.user_id
WHERE a.status = 'accepted'
  AND a.friend_id IS NOT NULL
  AND a.user_id < b.user_id
GROUP BY LEAST(a.user_id, b.user_id), GREATEST(a.user_id, b.user_id)
ON CONFLICT (user_a, user_b) DO UPDATE SET mutual_count = EXCLUDED.mutual_count;

-- D. Privacy column
ALTER TABLE profiles ADD COLUMN hide_mutual_friends BOOLEAN NOT NULL DEFAULT FALSE;

-- E. Partial index for efficient single-pair detail queries
CREATE INDEX idx_friends_accepted_friend
  ON friends (friend_id, user_id)
  WHERE status = 'accepted' AND friend_id IS NOT NULL;

-- F. RPC: get mutual friend profiles for a single pair (on-demand, bounded by min(F1, F2))
CREATE OR REPLACE FUNCTION public.get_mutual_friends(p_target_id uuid)
RETURNS TABLE (
  id uuid, connect_code text, display_name text, avatar_url text,
  rating numeric, top_characters jsonb, region text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id, p.connect_code, p.display_name,
         p.avatar_url,
         pr.effective_rating, p.top_characters,
         CASE WHEN p.hide_region THEN NULL ELSE COALESCE(p.chosen_region, p.region) END
  FROM friends my
  INNER JOIN friends theirs
    ON theirs.user_id = p_target_id
   AND theirs.status = 'accepted'
   AND theirs.friend_id IS NOT NULL
   AND theirs.friend_id = my.friend_id
  INNER JOIN profiles p ON p.id = my.friend_id
  LEFT JOIN player_ratings pr ON pr.connect_code = p.connect_code
  WHERE my.user_id = auth.uid()
    AND my.status = 'accepted'
    AND my.friend_id IS NOT NULL
    AND NOT COALESCE(p.hide_mutual_friends, FALSE);
$$;

REVOKE ALL ON FUNCTION public.get_mutual_friends(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mutual_friends(uuid) TO authenticated;

-- G. Replace discover_mutual_friend_counts with cache-backed version
CREATE OR REPLACE FUNCTION public.discover_mutual_friend_counts(p_candidate_ids uuid[])
RETURNS TABLE (candidate_id uuid, mutual_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    CASE WHEN mfc.user_a = auth.uid() THEN mfc.user_b ELSE mfc.user_a END,
    mfc.mutual_count
  FROM mutual_friend_counts mfc
  WHERE (mfc.user_a = auth.uid() AND mfc.user_b = ANY(p_candidate_ids))
     OR (mfc.user_b = auth.uid() AND mfc.user_a = ANY(p_candidate_ids));
$$;

-- RLS on the cache table: users can read rows they are part of
ALTER TABLE mutual_friend_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mfc_read_own" ON mutual_friend_counts FOR SELECT
  USING (auth.uid() = user_a OR auth.uid() = user_b);
