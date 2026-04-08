-- ============================================================
-- 042_chat_moderation.sql
-- Block-count chat ban, admin word list, heuristics, auto-mute
-- ============================================================

-- 1. Count how many distinct users have blocked a given user.
--    SECURITY DEFINER bypasses RLS so callers can't see *who* blocked them.
CREATE OR REPLACE FUNCTION get_blocked_by_count(target_user_id UUID)
RETURNS int AS $$
  SELECT count(DISTINCT user_id)::int
  FROM blocked_users
  WHERE blocked_user_id = target_user_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- 2. Replace the chat insert trigger with expanded checks.
CREATE OR REPLACE FUNCTION enforce_chat_rate_limit()
RETURNS trigger AS $$
DECLARE
  rate_limit_seconds int;
  blocked_by_count int;
  word_list text;
  regex_list text;
  dup_count int;
  upper_count int;
  alpha_count int;
BEGIN
  -- Kill switch
  IF NOT EXISTS (
    SELECT 1 FROM app_config
    WHERE key = 'chat_enabled' AND value = 'true'
  ) THEN
    RAISE EXCEPTION 'Chat is currently disabled';
  END IF;

  -- Blocked-by-5 ban
  blocked_by_count := get_blocked_by_count(NEW.user_id);
  IF blocked_by_count >= 5 THEN
    RAISE EXCEPTION 'Chat is disabled for your account';
  END IF;

  -- Mute check (before rate limit so muted users get immediate feedback)
  IF EXISTS (
    SELECT 1 FROM chat_mutes
    WHERE user_id = NEW.user_id
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RAISE EXCEPTION 'You are muted from chat';
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

  -- Duplicate message check (same content within 60s)
  SELECT count(*) INTO dup_count
  FROM chat_messages
  WHERE user_id = NEW.user_id
    AND content = NEW.content
    AND created_at > now() - interval '60 seconds';
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Duplicate message: please don''t spam';
  END IF;

  -- Admin-configurable blocked words (comma-separated in app_config)
  SELECT value INTO word_list FROM app_config WHERE key = 'chat_blocked_words';
  IF word_list IS NOT NULL AND word_list <> '' THEN
    IF NEW.content ~* replace(word_list, ',', '|') THEN
      RAISE EXCEPTION 'Message contains inappropriate content';
    END IF;
  END IF;

  -- Admin-configurable regex patterns (pipe-separated in app_config)
  SELECT value INTO regex_list FROM app_config WHERE key = 'chat_blocked_regex';
  IF regex_list IS NOT NULL AND regex_list <> '' THEN
    IF NEW.content ~* regex_list THEN
      RAISE EXCEPTION 'Message contains inappropriate content';
    END IF;
  END IF;

  -- Heuristic: character flooding (any char repeated 6+ times)
  IF NEW.content ~ '(.)\1{5,}' THEN
    RAISE EXCEPTION 'Message rejected: character spam';
  END IF;

  -- Heuristic: all-caps spam (>80% uppercase, length > 10)
  IF char_length(NEW.content) > 10 THEN
    SELECT count(*) INTO upper_count
    FROM regexp_matches(NEW.content, '[A-Z]', 'g');
    SELECT count(*) INTO alpha_count
    FROM regexp_matches(NEW.content, '[A-Za-z]', 'g');
    IF alpha_count > 0 AND (upper_count::float / alpha_count) > 0.8 THEN
      RAISE EXCEPTION 'Message rejected: please don''t shout';
    END IF;
  END IF;

  -- Heuristic: URL/link spam
  IF NEW.content ~* 'https?://' THEN
    RAISE EXCEPTION 'Links are not allowed in chat';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Auto-moderate on report: auto-delete message, auto-mute repeat offenders.
--    Needs SECURITY DEFINER to write chat_messages and chat_mutes across RLS.
CREATE OR REPLACE FUNCTION auto_moderate_on_report()
RETURNS trigger AS $$
DECLARE
  msg_report_count int;
  msg_author_id uuid;
  hour_reporters int;
  total_reporters int;
BEGIN
  -- Count unique reporters on this specific message
  SELECT count(DISTINCT reporter_id) INTO msg_report_count
  FROM chat_reports
  WHERE message_id = NEW.message_id;

  -- Auto-delete message at 3 reports
  IF msg_report_count >= 3 THEN
    UPDATE chat_messages
    SET deleted_at = now()
    WHERE id = NEW.message_id AND deleted_at IS NULL;
  END IF;

  -- Get the message author
  SELECT user_id INTO msg_author_id
  FROM chat_messages
  WHERE id = NEW.message_id;

  IF msg_author_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count unique reporters against this author in the last hour
  SELECT count(DISTINCT cr.reporter_id) INTO hour_reporters
  FROM chat_reports cr
  JOIN chat_messages cm ON cm.id = cr.message_id
  WHERE cm.user_id = msg_author_id
    AND cr.created_at > now() - interval '1 hour';

  -- Count unique reporters against this author all-time
  SELECT count(DISTINCT cr.reporter_id) INTO total_reporters
  FROM chat_reports cr
  JOIN chat_messages cm ON cm.id = cr.message_id
  WHERE cm.user_id = msg_author_id;

  -- 5+ unique reporters all-time: permanent mute
  IF total_reporters >= 5 THEN
    IF NOT EXISTS (
      SELECT 1 FROM chat_mutes
      WHERE user_id = msg_author_id AND expires_at IS NULL
    ) THEN
      INSERT INTO chat_mutes (user_id, muted_by, reason, expires_at)
      VALUES (msg_author_id, msg_author_id, 'Auto-mute: 5+ community reports', NULL);
    END IF;
  -- 3+ unique reporters in last hour: 24h mute
  ELSIF hour_reporters >= 3 THEN
    IF NOT EXISTS (
      SELECT 1 FROM chat_mutes
      WHERE user_id = msg_author_id
        AND (expires_at IS NULL OR expires_at > now())
    ) THEN
      INSERT INTO chat_mutes (user_id, muted_by, reason, expires_at)
      VALUES (msg_author_id, msg_author_id, 'Auto-mute: 3+ reports in 1 hour', now() + interval '24 hours');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_moderate_on_report
  AFTER INSERT ON chat_reports
  FOR EACH ROW EXECUTE FUNCTION auto_moderate_on_report();


-- 4. SECURITY DEFINER functions for soft-delete (bypasses RLS safely).

-- Admin delete: any message
CREATE OR REPLACE FUNCTION admin_delete_chat_message(msg_id UUID)
RETURNS boolean AS $$
BEGIN
  UPDATE chat_messages
  SET deleted_at = now(), deleted_by = auth.uid()
  WHERE id = msg_id AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Owner delete: only own messages
CREATE OR REPLACE FUNCTION owner_delete_chat_message(msg_id UUID)
RETURNS boolean AS $$
BEGIN
  UPDATE chat_messages
  SET deleted_at = now(), deleted_by = auth.uid()
  WHERE id = msg_id AND user_id = auth.uid() AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. Lock down app_config: hide moderation word lists from regular users.
--    Replace the blanket "Anyone can read" policy with one that excludes sensitive keys.
DROP POLICY IF EXISTS "Anyone can read app_config" ON app_config;

CREATE POLICY "Public config readable" ON app_config
  FOR SELECT
  USING (key NOT IN ('chat_blocked_words', 'chat_blocked_regex'));


-- 6. Seed app_config for moderation word lists (empty defaults -- admin fills via dashboard)
INSERT INTO app_config (key, value) VALUES
  ('chat_blocked_words', ''),
  ('chat_blocked_regex', '')
ON CONFLICT (key) DO NOTHING;
