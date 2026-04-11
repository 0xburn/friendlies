-- =============================================================================
-- Seed data for local development
-- Loaded automatically by `supabase db reset`
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Test users in auth.users
-- The handle_new_user() trigger auto-creates a profiles row for each.
-- Password for all test users: "password123"
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, aud, role)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'mango@test.local', crypt('password123', gen_salt('bf')), NOW(),
   '{"full_name": "Mang0", "provider_id": "111111111111111111"}'::jsonb,
   NOW(), NOW(), 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'zain@test.local', crypt('password123', gen_salt('bf')), NOW(),
   '{"full_name": "Zain", "provider_id": "222222222222222222"}'::jsonb,
   NOW(), NOW(), 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'hbox@test.local', crypt('password123', gen_salt('bf')), NOW(),
   '{"full_name": "Hungrybox", "provider_id": "333333333333333333"}'::jsonb,
   NOW(), NOW(), 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'cody@test.local', crypt('password123', gen_salt('bf')), NOW(),
   '{"full_name": "Cody", "provider_id": "444444444444444444"}'::jsonb,
   NOW(), NOW(), 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'plup@test.local', crypt('password123', gen_salt('bf')), NOW(),
   '{"full_name": "Plup", "provider_id": "555555555555555555"}'::jsonb,
   NOW(), NOW(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Flesh out profiles (trigger created the rows with discord_username/discord_id)
-- ---------------------------------------------------------------------------
UPDATE profiles SET
  connect_code = 'MANG#0', display_name = 'Mang0', slippi_uid = 'test-uid-mango',
  verified = true, verified_at = NOW(),
  discord_id = '111111111111111111',
  region = 'NA West', chosen_region = 'NA West',
  latitude = 33.94, longitude = -118.40,
  main_character = 2, secondary_character = 20,
  top_characters = '[{"character": 2, "count": 500}, {"character": 20, "count": 150}]'::jsonb,
  app_version = '1.0.34'
WHERE id = 'a0000000-0000-0000-0000-000000000001';

UPDATE profiles SET
  connect_code = 'ZAIN#0', display_name = 'Zain', slippi_uid = 'test-uid-zain',
  verified = true, verified_at = NOW(),
  discord_id = '222222222222222222',
  region = 'NA East', chosen_region = 'NA East',
  latitude = 38.90, longitude = -77.04,
  main_character = 9,
  top_characters = '[{"character": 9, "count": 680}]'::jsonb,
  app_version = '1.0.34'
WHERE id = 'a0000000-0000-0000-0000-000000000002';

UPDATE profiles SET
  connect_code = 'HUNG#0', display_name = 'Hungrybox', slippi_uid = 'test-uid-hbox',
  verified = true, verified_at = NOW(),
  discord_id = '333333333333333333',
  region = 'NA East', chosen_region = 'NA East',
  latitude = 25.76, longitude = -80.19,
  main_character = 15,
  top_characters = '[{"character": 15, "count": 630}]'::jsonb,
  app_version = '1.0.33'
WHERE id = 'a0000000-0000-0000-0000-000000000003';

UPDATE profiles SET
  connect_code = 'CODY#0', display_name = 'Cody', slippi_uid = 'test-uid-cody',
  verified = true, verified_at = NOW(),
  discord_id = '444444444444444444',
  region = 'NA West', chosen_region = 'NA West',
  latitude = 34.05, longitude = -118.24,
  main_character = 2,
  top_characters = '[{"character": 2, "count": 570}]'::jsonb,
  app_version = '1.0.34'
WHERE id = 'a0000000-0000-0000-0000-000000000004';

UPDATE profiles SET
  connect_code = 'PLUP#0', display_name = 'Plup', slippi_uid = 'test-uid-plup',
  verified = true, verified_at = NOW(),
  discord_id = '555555555555555555',
  region = 'NA East', chosen_region = 'NA East',
  latitude = 28.54, longitude = -81.38,
  main_character = 19, secondary_character = 2,
  top_characters = '[{"character": 19, "count": 400}, {"character": 2, "count": 150}]'::jsonb,
  app_version = '1.0.34'
WHERE id = 'a0000000-0000-0000-0000-000000000005';

-- ---------------------------------------------------------------------------
-- Slippi cache (legacy, still used by some lookups)
-- ---------------------------------------------------------------------------
INSERT INTO slippi_cache (connect_code, display_name, slippi_uid, rating_ordinal, wins, losses, characters, fetched_at)
VALUES
  ('MANG#0', 'Mang0',     'test-uid-mango', 2350.50, 450, 200, '[{"character": 2, "gameCount": 500}, {"character": 20, "gameCount": 150}]', NOW()),
  ('ZAIN#0', 'Zain',      'test-uid-zain',  2400.75, 500, 180, '[{"character": 9, "gameCount": 680}]', NOW()),
  ('HUNG#0', 'Hungrybox', 'test-uid-hbox',  2280.30, 420, 210, '[{"character": 15, "gameCount": 630}]', NOW()),
  ('CODY#0', 'Cody',      'test-uid-cody',  2320.10, 380, 190, '[{"character": 2, "gameCount": 570}]', NOW()),
  ('PLUP#0', 'Plup',      'test-uid-plup',  2250.60, 350, 200, '[{"character": 19, "gameCount": 400}, {"character": 2, "gameCount": 150}]', NOW())
ON CONFLICT (connect_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Player ratings
-- ---------------------------------------------------------------------------
INSERT INTO player_ratings (connect_code, current_rating, current_wins, current_losses, peak_past_rating, effective_rating, seasons, fetched_at)
VALUES
  ('MANG#0', 2350.50, 450, 200, 2410.00, 2380.25, '[{"season": "2025-Q4", "rating": 2350.50}]'::jsonb, NOW()),
  ('ZAIN#0', 2400.75, 500, 180, 2450.00, 2425.38, '[{"season": "2025-Q4", "rating": 2400.75}]'::jsonb, NOW()),
  ('HUNG#0', 2280.30, 420, 210, 2330.00, 2305.15, '[{"season": "2025-Q4", "rating": 2280.30}]'::jsonb, NOW()),
  ('CODY#0', 2320.10, 380, 190, 2370.00, 2345.05, '[{"season": "2025-Q4", "rating": 2320.10}]'::jsonb, NOW()),
  ('PLUP#0', 2250.60, 350, 200, 2300.00, 2275.30, '[{"season": "2025-Q4", "rating": 2250.60}]'::jsonb, NOW())
ON CONFLICT (connect_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Presence log (mix of online, in-game, LFG, and offline)
-- ---------------------------------------------------------------------------
INSERT INTO presence_log (user_id, status, current_character, opponent_code, playing_since, looking_to_play, looking_to_play_since, status_preset, connection_type, app_idle, lfg_characters, lfg_ranks, updated_at)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'in-game', 2, 'ZAIN#0', NOW() - interval '8 minutes', false, NULL, NULL, 'ethernet', false, '{}', '{}', NOW()),
  ('a0000000-0000-0000-0000-000000000002', 'in-game', 9, 'MANG#0', NOW() - interval '8 minutes', false, NULL, NULL, 'ethernet', false, '{}', '{}', NOW()),
  ('a0000000-0000-0000-0000-000000000003', 'online',  NULL, NULL, NULL, true, NOW() - interval '5 minutes', 'Looking for friendlies!', 'ethernet', false, '{15}', '{"Master 1","Master 2","Master 3"}', NOW()),
  ('a0000000-0000-0000-0000-000000000004', 'online',  NULL, NULL, NULL, false, NULL, NULL, 'wifi', false, '{}', '{}', NOW()),
  ('a0000000-0000-0000-0000-000000000005', 'offline', NULL, NULL, NULL, false, NULL, NULL, NULL, false, '{}', '{}', NOW() - interval '2 hours')
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Friends (accepted and pending requests)
-- ---------------------------------------------------------------------------
INSERT INTO friends (user_id, friend_id, friend_connect_code, status, created_at)
VALUES
  -- Mang0 ↔ Zain (both accepted)
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'ZAIN#0', 'accepted', NOW() - interval '30 days'),
  ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'MANG#0', 'accepted', NOW() - interval '30 days'),
  -- Mang0 ↔ Hbox (both accepted)
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'HUNG#0', 'accepted', NOW() - interval '20 days'),
  ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'MANG#0', 'accepted', NOW() - interval '20 days'),
  -- Zain ↔ Plup (both accepted)
  ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005', 'PLUP#0', 'accepted', NOW() - interval '15 days'),
  ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000002', 'ZAIN#0', 'accepted', NOW() - interval '15 days'),
  -- Cody → Mang0 (pending request)
  ('a0000000-0000-0000-0000-000000000004', NULL, 'MANG#0', 'pending', NOW() - interval '1 day'),
  -- Hbox → Plup (pending request)
  ('a0000000-0000-0000-0000-000000000003', NULL, 'PLUP#0', 'pending', NOW() - interval '2 days')
ON CONFLICT (user_id, friend_connect_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Matches (sample replay history)
-- Character IDs: 2=Fox, 9=Marth, 15=Jigglypuff, 19=Sheik, 20=Falco
-- Stage IDs: 2=Fountain, 3=Stadium, 8=Yoshi's, 28=Dreamland, 31=Battlefield, 32=FD
-- ---------------------------------------------------------------------------
INSERT INTO matches (user_id, opponent_connect_code, opponent_display_name, user_character_id, opponent_character_id, stage_id, did_win, replay_filename, played_at, created_at)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'ZAIN#0', 'Zain', 2, 9, 32, true, 'Game_20260410T120000.slp', NOW() - interval '1 hour', NOW()),
  ('a0000000-0000-0000-0000-000000000001', 'ZAIN#0', 'Zain', 2, 9, 31, false, 'Game_20260410T120500.slp', NOW() - interval '55 minutes', NOW()),
  ('a0000000-0000-0000-0000-000000000001', 'HUNG#0', 'Hungrybox', 20, 15, 28, true, 'Game_20260410T130000.slp', NOW() - interval '30 minutes', NOW()),
  ('a0000000-0000-0000-0000-000000000002', 'MANG#0', 'Mang0', 9, 2, 32, false, 'Game_20260410T120000.slp', NOW() - interval '1 hour', NOW()),
  ('a0000000-0000-0000-0000-000000000002', 'MANG#0', 'Mang0', 9, 2, 31, true, 'Game_20260410T120500.slp', NOW() - interval '55 minutes', NOW()),
  ('a0000000-0000-0000-0000-000000000003', 'MANG#0', 'Mang0', 15, 20, 28, false, 'Game_20260410T130000.slp', NOW() - interval '30 minutes', NOW())
ON CONFLICT (user_id, replay_filename) DO NOTHING;

-- ---------------------------------------------------------------------------
-- User activity (leaderboard data)
-- ---------------------------------------------------------------------------
INSERT INTO user_activity (user_id, online_seconds, in_game_seconds, updated_at)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 86400,  43200,  NOW()),
  ('a0000000-0000-0000-0000-000000000002', 72000,  36000,  NOW()),
  ('a0000000-0000-0000-0000-000000000003', 54000,  28800,  NOW()),
  ('a0000000-0000-0000-0000-000000000004', 21600,  10800,  NOW()),
  ('a0000000-0000-0000-0000-000000000005', 36000,  18000,  NOW())
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- App config defaults
-- ---------------------------------------------------------------------------
INSERT INTO app_config (key, value)
VALUES
  ('broadcast_message', 'Welcome to local dev! This is the broadcast banner.'),
  ('chat_enabled', 'true'),
  ('chat_rate_limit_seconds', '3')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Patreon public supporters (sample patron flair)
-- ---------------------------------------------------------------------------
INSERT INTO patreon_public_supporters (connect_code)
VALUES ('MANG#0'), ('ZAIN#0')
ON CONFLICT (connect_code) DO NOTHING;
