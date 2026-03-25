-- Event log for debugging and usage tracking
CREATE TABLE IF NOT EXISTS event_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_event_log_type ON event_log(event_type, created_at DESC);
CREATE INDEX idx_event_log_user ON event_log(user_id, created_at DESC);

ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_log_insert" ON event_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "event_log_owner_read" ON event_log
  FOR SELECT USING (auth.uid() = user_id);
