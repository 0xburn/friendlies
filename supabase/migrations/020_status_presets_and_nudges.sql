-- Add status_preset column to presence_log
ALTER TABLE presence_log
  ADD COLUMN IF NOT EXISTS status_preset TEXT;

-- Nudges table for lightweight player-to-player signals
CREATE TABLE IF NOT EXISTS nudges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nudges_receiver ON nudges (receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nudges_sender ON nudges (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nudges_pair ON nudges (sender_id, receiver_id, created_at DESC);

ALTER TABLE nudges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read nudges they received"
  ON nudges FOR SELECT
  USING (auth.uid() = receiver_id);

CREATE POLICY "Users can read nudges they sent"
  ON nudges FOR SELECT
  USING (auth.uid() = sender_id);

CREATE POLICY "Users can send nudges"
  ON nudges FOR INSERT
  WITH CHECK (auth.uid() = sender_id);
