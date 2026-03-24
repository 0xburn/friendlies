-- Add looking-to-play columns to presence_log
ALTER TABLE presence_log
  ADD COLUMN IF NOT EXISTS looking_to_play BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS looking_to_play_since TIMESTAMPTZ;
