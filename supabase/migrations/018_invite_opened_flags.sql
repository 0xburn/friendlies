-- Track which side has clicked "Open Melee"
ALTER TABLE play_invites
  ADD COLUMN sender_opened BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN receiver_opened BOOLEAN NOT NULL DEFAULT FALSE;

-- Allow sender to update their own invites (for marking sender_opened)
CREATE POLICY "invite_sender_update" ON play_invites
  FOR UPDATE USING (auth.uid() = sender_id)
  WITH CHECK (auth.uid() = sender_id);
