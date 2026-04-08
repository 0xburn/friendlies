-- Chat messages table
CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  room text NOT NULL DEFAULT 'general',
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  connect_code text NOT NULL,
  display_name text,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_room_created ON chat_messages (room, created_at DESC);
CREATE INDEX idx_chat_user_created ON chat_messages (user_id, created_at DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- 48h soft TTL: authenticated users can only see recent, non-deleted messages
CREATE POLICY "chat_read" ON chat_messages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND created_at > now() - interval '48 hours'
  );

CREATE POLICY "chat_insert" ON chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Owner can soft-delete their own messages
CREATE POLICY "chat_owner_soft_delete" ON chat_messages
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (deleted_at IS NOT NULL);


-- Chat mutes table (admin-managed)
CREATE TABLE chat_mutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  muted_by uuid NOT NULL REFERENCES profiles(id),
  reason text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_mutes_user ON chat_mutes (user_id);

ALTER TABLE chat_mutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mute_self_read" ON chat_mutes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);


-- Chat reports table
CREATE TABLE chat_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason text,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, reporter_id)
);

ALTER TABLE chat_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_insert" ON chat_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);


-- Rate limit + mute check + kill-switch trigger
CREATE OR REPLACE FUNCTION enforce_chat_rate_limit()
RETURNS trigger AS $$
DECLARE
  rate_limit_seconds int;
BEGIN
  -- Kill switch
  IF NOT EXISTS (
    SELECT 1 FROM app_config
    WHERE key = 'chat_enabled' AND value = 'true'
  ) THEN
    RAISE EXCEPTION 'Chat is currently disabled';
  END IF;

  -- Configurable rate limit
  SELECT COALESCE(value::int, 3) INTO rate_limit_seconds
    FROM app_config WHERE key = 'chat_rate_limit_seconds';
  IF rate_limit_seconds IS NULL THEN rate_limit_seconds := 3; END IF;

  IF EXISTS (
    SELECT 1 FROM chat_messages
    WHERE user_id = NEW.user_id
      AND created_at > now() - make_interval(secs => rate_limit_seconds)
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Chat rate limit: wait before sending another message';
  END IF;

  -- Mute check
  IF EXISTS (
    SELECT 1 FROM chat_mutes
    WHERE user_id = NEW.user_id
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RAISE EXCEPTION 'You are muted from chat';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chat_rate_limit
  BEFORE INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION enforce_chat_rate_limit();


-- Seed app_config keys for chat (admin-only writable)
INSERT INTO app_config (key, value) VALUES
  ('chat_enabled', 'true'),
  ('chat_rate_limit_seconds', '3')
ON CONFLICT (key) DO NOTHING;


-- Enable Realtime for chat_messages (postgres_changes)
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
