-- Add region column to profiles for geographic display
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS region TEXT;
