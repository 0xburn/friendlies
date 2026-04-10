-- Patron flair on friend/Discover cards requires every signed-in client to know which
-- connect codes are on the public thanks list. Replace the self-only SELECT policy.

DROP POLICY IF EXISTS patreon_public_supporters_select_own_code ON patreon_public_supporters;

CREATE POLICY patreon_public_supporters_select_authenticated ON patreon_public_supporters
  FOR SELECT TO authenticated
  USING (true);
