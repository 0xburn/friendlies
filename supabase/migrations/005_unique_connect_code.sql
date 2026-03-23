-- Ensure each connect code can only be claimed by one profile.
-- Partial index so multiple NULL rows are allowed (unlinked users).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_connect_code_unique
  ON profiles (connect_code)
  WHERE connect_code IS NOT NULL;
