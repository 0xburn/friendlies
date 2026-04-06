import { connectCodeLookupVariants, normalizeSlippiConnectCode } from './connect-code-normalize';
import { PRESENCE_STALE_THRESHOLD } from './config';
import { resolvePresenceRow } from './presence-logic';
import type { CashboxFriendliesOpponent, CashboxSnapshot } from './startgg/cashbox';
import { supabase } from './supabase';

/**
 * Looks up friendlies profile / friends / presence for a given Slippi connect code.
 * Returns a CashboxFriendliesOpponent or null if the code is empty.
 */
export async function lookupFriendliesOpponent(
  code: string,
  viewerUserId: string | null,
  viewerConnectCode: string,
): Promise<CashboxFriendliesOpponent | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const offNetwork: CashboxFriendliesOpponent = {
    onNetwork: false,
    connectCode: trimmed,
    displayName: null,
    discordUsername: null,
    discordId: null,
    avatarUrl: null,
    rating: null,
    mainCharacter: null,
    topCharacters: [],
    region: null,
    status: 'offline',
    currentCharacter: null,
    opponentCode: null,
    playingSince: null,
    connectionType: null,
    lookingToPlay: false,
    statusPreset: null,
    friendStatus: 'none',
  };

  if (!viewerUserId) return offNetwork;

  const profileSelect =
    'id, connect_code, display_name, discord_username, discord_id, avatar_url, main_character, top_characters, region, chosen_region, hide_region, hide_discord_unless_friends, hide_avatar, hide_connection_type';

  const variants = connectCodeLookupVariants(trimmed);
  const { data: profileRows } = await supabase.from('profiles').select(profileSelect).in('connect_code', variants);

  const normTarget = normalizeSlippiConnectCode(trimmed);
  const opp =
    profileRows?.find((r: { connect_code: string }) => r.connect_code === trimmed) ??
    profileRows?.find(
      (r: { connect_code: string }) => normalizeSlippiConnectCode(r.connect_code) === normTarget,
    ) ??
    profileRows?.[0];

  if (!opp) return offNetwork;

  const resolvedCode = opp.connect_code as string;

  const { data: ratingRow } = await supabase
    .from('player_ratings')
    .select('effective_rating')
    .eq('connect_code', resolvedCode)
    .maybeSingle();

  const { data: pres } = await supabase
    .from('presence_log')
    .select(
      'status, current_character, opponent_code, playing_since, looking_to_play, looking_to_play_since, status_preset, connection_type, app_idle, updated_at',
    )
    .eq('user_id', opp.id)
    .maybeSingle();

  const resolved = pres
    ? resolvePresenceRow(pres as any, PRESENCE_STALE_THRESHOLD, Date.now())
    : {
        status: 'offline',
        currentCharacter: null,
        opponentCode: null,
        playingSince: null,
        lookingToPlay: false,
        statusPreset: null,
        connectionType: null,
      };

  const slippi: { characterId: number; gameCount: number }[] = Array.isArray(opp.top_characters)
    ? opp.top_characters
    : [];
  const topCharacters: { characterId: number; gameCount: number }[] = [];
  if (opp.main_character != null) topCharacters.push({ characterId: opp.main_character, gameCount: 0 });
  else if (slippi[0]) topCharacters.push(slippi[0]);

  let friendStatus: CashboxFriendliesOpponent['friendStatus'] = 'none';

  const { data: outByFriend } = await supabase
    .from('friends')
    .select('status, friend_id, friend_connect_code')
    .eq('user_id', viewerUserId)
    .eq('friend_id', opp.id)
    .maybeSingle();

  const { data: outByCode } = await supabase
    .from('friends')
    .select('status, friend_id, friend_connect_code')
    .eq('user_id', viewerUserId)
    .eq('friend_connect_code', resolvedCode)
    .maybeSingle();

  for (const r of [outByFriend, outByCode]) {
    if (!r) continue;
    if (r.status === 'accepted' && r.friend_id === opp.id) {
      friendStatus = 'friends';
      break;
    }
    if (r.status === 'pending' && r.friend_connect_code === resolvedCode) {
      friendStatus = 'pending_out';
      break;
    }
  }

  if (friendStatus === 'none') {
    const { data: inc } = await supabase
      .from('friends')
      .select('id')
      .eq('user_id', opp.id)
      .eq('friend_connect_code', viewerConnectCode)
      .eq('status', 'pending')
      .maybeSingle();
    if (inc) friendStatus = 'pending_in';
  }

  return {
    onNetwork: true,
    userId: opp.id,
    connectCode: opp.connect_code,
    displayName: opp.display_name || null,
    discordUsername: opp.hide_discord_unless_friends ? null : opp.discord_username || null,
    discordId: opp.hide_discord_unless_friends ? null : opp.discord_id || null,
    avatarUrl: opp.hide_avatar ? null : opp.avatar_url || null,
    rating: ratingRow?.effective_rating ?? null,
    mainCharacter: opp.main_character ?? null,
    topCharacters,
    region: opp.hide_region ? null : (opp.chosen_region || opp.region || null),
    status: resolved.status as CashboxFriendliesOpponent['status'],
    currentCharacter: resolved.currentCharacter,
    opponentCode: resolved.opponentCode,
    playingSince: resolved.playingSince,
    connectionType: opp.hide_connection_type
      ? null
      : (resolved.connectionType === 'wifi' || resolved.connectionType === 'ethernet'
          ? resolved.connectionType
          : null),
    lookingToPlay: resolved.lookingToPlay,
    statusPreset: resolved.statusPreset,
    friendStatus,
  };
}

/**
 * Loads friendlies profile / friends / presence for the mapped Slippi connect code on the next-match opponent.
 * Mutates snap.nextMatch.friendlies when snap.ok and nextMatch exists.
 */
export async function enrichCashboxFriendliesOpponent(
  snap: Extract<CashboxSnapshot, { ok: true }>,
  viewerUserId: string | null,
  viewerConnectCode: string,
): Promise<void> {
  const nm = snap.nextMatch;
  if (!nm || !nm.slippiConnectCode) return;
  const result = await lookupFriendliesOpponent(nm.slippiConnectCode, viewerUserId, viewerConnectCode);
  if (result) nm.friendlies = result;
}
