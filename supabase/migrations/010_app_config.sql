CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read app_config"
  ON app_config FOR SELECT
  USING (true);

INSERT INTO app_config (key, value)
VALUES ('broadcast_message', 'Check out the new Discover tab to find other players who are active on friendlies!')
ON CONFLICT (key) DO NOTHING;
