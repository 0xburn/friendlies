-- Public Patreon shout-out list: connect codes you maintain in SQL (service role / dashboard).
-- Initial SELECT policy is replaced in 045_patreon_public_supporters_read_all.sql so clients
-- can highlight friend/Discover cards for any listed code.

CREATE TABLE IF NOT EXISTS patreon_public_supporters (
  connect_code TEXT PRIMARY KEY
);

ALTER TABLE patreon_public_supporters ENABLE ROW LEVEL SECURITY;

CREATE POLICY patreon_public_supporters_select_own_code ON patreon_public_supporters
  FOR SELECT TO authenticated
  USING (
    connect_code IS NOT NULL
    AND connect_code = (
      SELECT p.connect_code
      FROM profiles p
      WHERE p.id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated — manage rows via Supabase SQL editor or service role.
