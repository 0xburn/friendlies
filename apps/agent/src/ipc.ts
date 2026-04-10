import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from 'electron';

import { getCurrentUser, handleAuthCallback, isAuthenticated, logout, startAuthFlow, startLocalAuthServer } from './auth';
import { PRESENCE_STALE_THRESHOLD } from './config';
import { getDirectConnectService } from './direct-connect';
import { ENABLE_IDENTITY_BLACKLIST_ENFORCEMENT } from './identity-enforcement';
import { getIdentity, invalidateIdentityCache, verifyIdentity } from './identity';
import { getCustomLauncherDir, setCustomLauncherDir } from './launcher-path';
import { getCachedGeo } from './geo-cache';
import { resolvePresenceRow } from './presence-logic';
import { getConnectionType, getLfgExpiry, getLocalStatusSnapshot, getOnlineUsers, getPresenceStats, getStatusPreset, isLookingToPlay, onLocalStatusChange, onPresenceSync, setGameThrottling, setHideConnectionType, setHideOnlineStatus, setLfgExpiry, setRendererDocumentHidden, setStatusPreset, toggleLookingToPlay } from './presence';
import { showTestNotification } from './notifications';
import { getSettings, isSetupComplete, updateSettings, type AgentSettings } from './settings';
import { updateTrayStatus } from './tray';
import { supabase } from './supabase';
import { checkForUpdates, downloadUpdate, quitAndInstall } from './updater';
import { backfillRecentReplays } from './watcher';
import { enrichCashboxFriendliesOpponent, lookupFriendliesOpponent } from './cashbox-enrich';

import {
  checkChatBanned,
  checkMuted,
  deleteChatMessage,
  getChatHistory,
  invalidateBlockCache,
  isChatEnabled,
  joinChatPresence,
  lookupChatProfile,
  reportChatMessage,
  sendChatMessage,
  subscribeChatRoom,
  unsubscribeChatRoom,
} from './chat';
import { getCashboxSnapshot, reportBracketSet } from './startgg/cashbox';
import {
  completeStartGgModerationTask,
  completeStartGgTask,
  updateStartGgTask,
  fetchRawSetTasks,
  fetchSetUpdatedAt,
} from './startgg/www-rest-moderation';
import {
  startStartGgAuth,
  disconnectStartGg,
  isStartGgConnected,
  getStartGgUserInfo,
  getStartGgUserToken,
} from './startgg-auth';

const SLIPPI_API_NAME_TO_ID: Record<string, number> = {
  CAPTAIN_FALCON: 0, DONKEY_KONG: 1, FOX: 2, MR_GAME_AND_WATCH: 3,
  KIRBY: 4, BOWSER: 5, LINK: 6, LUIGI: 7, MARIO: 8, MARTH: 9,
  MEWTWO: 10, NESS: 11, PEACH: 12, PIKACHU: 13, ICE_CLIMBERS: 14,
  JIGGLYPUFF: 15, SAMUS: 16, YOSHI: 17, ZELDA: 18, SHEIK: 19,
  FALCO: 20, YOUNG_LINK: 21, DR_MARIO: 22, ROY: 23, PICHU: 24, GANONDORF: 25,
};

function slippiNameToId(name: string): number | null {
  return SLIPPI_API_NAME_TO_ID[name] ?? null;
}

interface RatingCacheEntry {
  currentRating: number | null;
  currentWins: number;
  currentLosses: number;
  peakPastRating: number | null;
  effectiveRating: number | null;
  seasons: { ratingOrdinal: number | null; wins: number; losses: number; seasonId: string | null; seasonName: string | null; seasonStatus: string | null }[];
  fetchedAt: number;
}

const slippiRatingCache = new Map<string, RatingCacheEntry>();
const RATING_CACHE_TTL = 30 * 60 * 1000;

const RATING_QUERY = `
fragment profileFields on NetplayProfile {
  ratingOrdinal ratingUpdateCount wins losses __typename
}
query RatingLookup($cc: String, $uid: String) {
  getUser(connectCode: $cc, fbUid: $uid) {
    rankedNetplayProfile { ...profileFields __typename }
    rankedNetplayProfileHistory {
      ...profileFields
      season { id name status __typename }
      __typename
    }
    __typename
  }
}`.trim();

async function fetchSlippiRating(connectCode: string): Promise<RatingCacheEntry | null> {
  try {
    const res = await fetch('https://internal.slippi.gg/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'RatingLookup',
        variables: { cc: connectCode, uid: connectCode },
        query: RATING_QUERY,
      }),
    });
    if (!res.ok) return null;
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { return null; }
    const user = data?.data?.getUser;
    if (!user) return null;

    const ranked = user.rankedNetplayProfile;
    const currentRating: number | null = ranked?.ratingOrdinal ?? null;
    const currentWins: number = ranked?.wins ?? 0;
    const currentLosses: number = ranked?.losses ?? 0;

    const history: any[] = user.rankedNetplayProfileHistory ?? [];
    const MIN_WINS = 25;
    const completedSeasons = history
      .filter((p: any) => p.season?.status !== 'active' && p.ratingOrdinal != null)
      .sort((a: any, b: any) => {
        const aId = parseInt(a.season?.id ?? '0', 10);
        const bId = parseInt(b.season?.id ?? '0', 10);
        return bId - aId;
      });
    const peakPastRating = completedSeasons
      .filter((p: any) => (p.wins ?? 0) >= MIN_WINS)
      .reduce(
        (max: number | null, p: any) => max == null || p.ratingOrdinal > max ? p.ratingOrdinal : max, null);
    const qualifiedPastSeason = completedSeasons.find((p: any) => (p.wins ?? 0) >= MIN_WINS);
    const lastSeasonRating = qualifiedPastSeason?.ratingOrdinal ?? null;

    let effectiveRating: number | null;
    if (currentWins >= MIN_WINS) {
      effectiveRating = currentRating;
    } else if (lastSeasonRating != null) {
      effectiveRating = lastSeasonRating;
    } else {
      effectiveRating = null;
    }

    const seasons = history.map((p: any) => ({
      ratingOrdinal: p.ratingOrdinal ?? null,
      wins: p.wins ?? 0,
      losses: p.losses ?? 0,
      seasonId: p.season?.id ?? null,
      seasonName: p.season?.name ?? null,
      seasonStatus: p.season?.status ?? null,
    }));

    return { currentRating, currentWins, currentLosses, peakPastRating, effectiveRating, seasons, fetchedAt: Date.now() };
  } catch {
    return null;
  }
}

async function upsertPlayerRating(connectCode: string, entry: RatingCacheEntry): Promise<void> {
  try {
    await supabase.from('player_ratings').upsert({
      connect_code: connectCode,
      current_rating: entry.currentRating,
      current_wins: entry.currentWins,
      current_losses: entry.currentLosses,
      peak_past_rating: entry.peakPastRating,
      effective_rating: entry.effectiveRating,
      seasons: entry.seasons,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('upsertPlayerRating', connectCode, e);
  }
}

function getCachedRatings(codes: string[]): Map<string, RatingCacheEntry> {
  const result = new Map<string, RatingCacheEntry>();
  for (const code of codes) {
    const cached = slippiRatingCache.get(code);
    if (cached) result.set(code, cached);
  }
  return result;
}

let batchFetchInFlight = false;

async function batchFetchRatings(codes: string[]): Promise<Map<string, RatingCacheEntry>> {
  const result = new Map<string, RatingCacheEntry>();
  const toFetch: string[] = [];
  const now = Date.now();

  for (const code of codes) {
    const cached = slippiRatingCache.get(code);
    if (cached && (now - cached.fetchedAt) < RATING_CACHE_TTL) {
      result.set(code, cached);
    } else {
      toFetch.push(code);
    }
  }

  if (toFetch.length === 0 || batchFetchInFlight) return result;
  batchFetchInFlight = true;

  try {
    const CONCURRENCY = 5;
    for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
      const batch = toFetch.slice(i, i + CONCURRENCY);
      const entries = await Promise.all(batch.map(fetchSlippiRating));
      for (let j = 0; j < batch.length; j++) {
        if (entries[j]) {
          slippiRatingCache.set(batch[j], entries[j]!);
          result.set(batch[j], entries[j]!);
          void upsertPlayerRating(batch[j], entries[j]!);
        }
      }
    }
  } finally {
    batchFetchInFlight = false;
  }

  return result;
}

/** DB `player_ratings` is only upsertable for the signed-in user's code (RLS). Prefer fresh Slippi-derived entries from `batchFetchRatings` for everyone else. */
function displayEffectiveRating(
  connectCode: string,
  liveByCode: Map<string, RatingCacheEntry>,
  dbRow?: { effective_rating?: number | null } | null,
): number | null {
  const live = liveByCode.get(connectCode);
  if (live !== undefined) return live.effectiveRating;
  const db = dbRow?.effective_rating;
  return db != null ? db : null;
}

let mainWindow: BrowserWindow | null = null;

export function sendToRenderer(channel: string, ...args: any[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

export function registerIpcHandlers(
  win: BrowserWindow,
  opts?: { onLogout?: () => Promise<void> },
): void {
  mainWindow = win;

  ipcMain.on('visibility:document', (_e, hidden: unknown) => {
    if (typeof hidden === 'boolean') setRendererDocumentHidden(hidden);
    updateTrayStatus();
  });

  const RATING_STALE_MS = 6 * 60 * 60 * 1000; // 6 hours
  setTimeout(async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return;
      const identity = getIdentity();
      if (!identity?.connectCode) return;

      // Collect own code + all friend codes
      const ownCode = identity.connectCode;
      const { data: friendRows } = await supabase
        .from('friends')
        .select('friend_connect_code')
        .eq('user_id', user.id)
        .eq('status', 'accepted');
      const friendCodes: string[] = (friendRows ?? [])
        .map((f: any) => f.friend_connect_code)
        .filter(Boolean);
      const allCodes = [ownCode, ...friendCodes];

      // Find which ratings are stale or missing
      const { data: existing } = await supabase
        .from('player_ratings')
        .select('connect_code, fetched_at')
        .in('connect_code', allCodes);
      const fetchedMap = new Map<string, string>();
      (existing ?? []).forEach((r: any) => { fetchedMap.set(r.connect_code, r.fetched_at); });

      const now = Date.now();
      const staleCodes = allCodes.filter((c) => {
        const fetched = fetchedMap.get(c);
        return !fetched || (now - new Date(fetched).getTime()) >= RATING_STALE_MS;
      });

      if (staleCodes.length === 0) return;
      console.log(`[ratings] startup refresh: ${staleCodes.length} stale of ${allCodes.length} total`);

      const CONCURRENCY = 5;
      for (let i = 0; i < staleCodes.length; i += CONCURRENCY) {
        const batch = staleCodes.slice(i, i + CONCURRENCY);
        const entries = await Promise.all(batch.map(fetchSlippiRating));
        for (let j = 0; j < batch.length; j++) {
          if (entries[j]) {
            slippiRatingCache.set(batch[j], entries[j]!);
            void upsertPlayerRating(batch[j], entries[j]!);
          }
        }
      }
      console.log(`[ratings] startup refresh complete`);
    } catch (e) {
      console.error('[ratings] startup refresh failed', e);
    }
  }, 10_000);

  setTimeout(async () => {
    try {
      const user = await getCurrentUser();
      if (user) await cleanupExpiredInvites(user.id);
    } catch (e) {
      console.error('[invites] startup cleanup failed', e);
    }
  }, 5_000);

  ipcMain.handle('auth:start', async () => {
    const onLocalAuth = async () => {
      const user = await getCurrentUser();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:changed', user);
      }
    };

    if (process.platform === 'linux') {
      const authDone = startLocalAuthServer();
      const url = await startAuthFlow();
      authDone.then(onLocalAuth).catch((err) => console.error('[auth] Linux local auth failed:', err));
      return url;
    }

    if (process.platform === 'win32') {
      let deepLinkResolved = false;
      const markResolved = () => { deepLinkResolved = true; };
      ipcMain.once('auth:deeplink-resolved', markResolved);

      const url = await startAuthFlow();

      setTimeout(async () => {
        ipcMain.removeListener('auth:deeplink-resolved', markResolved);
        if (deepLinkResolved) return;
        console.log('[auth] Deep link did not return in time, falling back to localhost callback');
        const authDone = startLocalAuthServer();
        await startAuthFlow(true);
        authDone.then(onLocalAuth).catch((err) => console.error('[auth] Windows fallback auth failed:', err));
      }, 8_000);

      return url;
    }

    return startAuthFlow();
  });
  ipcMain.handle('auth:callback', async (_e, url: string) => {
    ipcMain.emit('auth:deeplink-resolved');
    await handleAuthCallback(url);
    const user = await getCurrentUser();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('auth:changed', user);
  });
  ipcMain.handle('auth:getUser', async () => {
    try { return await getCurrentUser(); } catch { return null; }
  });
  ipcMain.handle('auth:isAuthenticated', async () => {
    try { return await isAuthenticated(); } catch { return false; }
  });
  ipcMain.handle('auth:logout', async () => {
    try {
      if (opts?.onLogout) await opts.onLogout();
      await logout();
      sendToRenderer('auth:changed', null);
    } catch (e) { console.error('auth:logout', e); }
  });

  ipcMain.handle('identity:get', () => {
    try { return getIdentity(); } catch { return null; }
  });
  ipcMain.handle('identity:link', async () => {
    try {
      const identity = getIdentity();
      const user = await getCurrentUser();
      if (!identity || !user) return { error: 'Missing identity or auth' };
      const { error } = await supabase
        .from('profiles')
        .update({
          connect_code: identity.connectCode,
          slippi_uid: identity.uid,
          display_name: identity.displayName || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (error) return { error: error.message };

      // Resolve pending friend requests targeting this connect code
      await supabase
        .from('friends')
        .update({ friend_id: user.id })
        .eq('friend_connect_code', identity.connectCode)
        .is('friend_id', null);

      void verifyIdentity(identity).catch((e) => console.error('verifyIdentity', e));
      return { ok: true, connectCode: identity.connectCode };
    } catch (e: any) { return { error: e.message }; }
  });
  ipcMain.handle('identity:profile', async () => {
    try {
      const identity = getIdentity();
      if (!identity) return null;
      const [{ data: profile }, { data: ratingRow }] = await Promise.all([
        supabase.from('profiles').select('region, chosen_region, top_characters, main_character, secondary_character, discord_username, discord_id').eq('connect_code', identity.connectCode).single(),
        supabase.from('player_ratings').select('*').eq('connect_code', identity.connectCode).single(),
      ]);
      return {
        connect_code: identity.connectCode,
        display_name: identity.displayName,
        rating_ordinal: ratingRow?.effective_rating ?? null,
        current_rating: ratingRow?.current_rating ?? null,
        peak_past_rating: ratingRow?.peak_past_rating ?? null,
        wins: ratingRow?.current_wins ?? 0,
        losses: ratingRow?.current_losses ?? 0,
        region: profile?.chosen_region || profile?.region || null,
        top_characters: profile?.top_characters ?? [],
        main_character: profile?.main_character ?? null,
        secondary_character: profile?.secondary_character ?? null,
        discord_username: profile?.discord_username ?? null,
        discord_id: profile?.discord_id ?? null,
      };
    } catch { return null; }
  });
  ipcMain.handle('profiles:byConnectCode', async (_e, connectCode: unknown) => {
    try {
      if (typeof connectCode !== 'string' || !connectCode.trim()) return null;
      const { data } = await supabase
        .from('profiles')
        .select('connect_code, display_name, discord_username, main_character, secondary_character, top_characters, region, chosen_region, avatar_url, startgg_user_id')
        .eq('connect_code', connectCode.trim().toUpperCase())
        .maybeSingle();
      return data ?? null;
    } catch {
      return null;
    }
  });
  ipcMain.handle('profiles:byStartGgUserId', async (_e, startGgUserId: unknown) => {
    try {
      if (typeof startGgUserId !== 'string' || !startGgUserId.trim()) return null;
      const { data } = await supabase
        .from('profiles')
        .select('connect_code, display_name, discord_username, main_character, secondary_character, top_characters, region, chosen_region, avatar_url, startgg_user_id')
        .eq('startgg_user_id', startGgUserId.trim())
        .maybeSingle();
      return data ?? null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('friends:list', async () => {
    const t0 = performance.now();
    try {
      const user = await getCurrentUser();
      if (!user) return [];
      const t1 = performance.now();
      const { data } = await supabase
        .from('friends')
        .select('id, friend_id, friend_connect_code, status, created_at, profiles!friends_friend_id_fkey(connect_code, display_name, discord_username, discord_id, avatar_url, region, chosen_region, hide_region, hide_discord_unless_friends, hide_avatar, main_character, secondary_character, top_characters)')
        .eq('user_id', user.id);
      if (!data) return [];
      const t2 = performance.now();

      const codes = data
        .map((f: any) => (f.profiles as any)?.connect_code || f.friend_connect_code)
        .filter(Boolean);

      let ratingsMap: Record<string, any> = {};
      if (codes.length > 0) {
        const { data: ratings } = await supabase.from('player_ratings').select('connect_code, effective_rating').in('connect_code', codes);
        if (ratings) ratings.forEach((r: any) => { ratingsMap[r.connect_code] = r; });
      }
      const liveRatings = getCachedRatings(codes);
      if (codes.length > 0) void batchFetchRatings(codes);
      const t3 = performance.now();

      const result = data.map((f: any) => {
        const p = f.profiles as any;
        const code = p?.connect_code || f.friend_connect_code;
        const rEntry = ratingsMap[code];
        const isAccepted = f.status === 'accepted';
        const showDiscord = isAccepted || !p?.hide_discord_unless_friends;
        const slippiChars: { characterId: number; gameCount: number }[] = Array.isArray(p?.top_characters) ? p.top_characters : [];
        const topCharacters: { characterId: number; gameCount: number }[] = [];
        const mainChar = p?.main_character;
        if (mainChar != null) topCharacters.push({ characterId: mainChar, gameCount: 0 });
        else if (slippiChars[0]) topCharacters.push(slippiChars[0]);
        return {
          id: f.id,
          friendId: f.friend_id,
          connectCode: code,
          displayName: p?.display_name || null,
          discordUsername: showDiscord ? (p?.discord_username || null) : null,
          discordId: showDiscord ? (p?.discord_id || null) : null,
          avatarUrl: p?.hide_avatar ? null : (p?.avatar_url || null),
          region: p?.hide_region ? null : (p?.chosen_region || p?.region || null),
          rating: displayEffectiveRating(code, liveRatings, rEntry),
          characterId: mainChar ?? slippiChars[0]?.characterId ?? null,
          topCharacters,
          onApp: !!f.friend_id,
          friendStatus: f.status || 'pending',
        };
      });
      console.log(`[bench] friends:list total=${(performance.now()-t0).toFixed(0)}ms (auth=${(t1-t0).toFixed(0)} friends=${(t2-t1).toFixed(0)} cache=${(t3-t2).toFixed(0)} rows=${data.length})`);
      return result;
    } catch (e) { console.error('friends:list', e); return []; }
  });

  ipcMain.handle('friends:incoming', async () => {
    const t0 = performance.now();
    try {
      const user = await getCurrentUser();
      if (!user) return [];
      const [{ data: profile }, { data: blockedRows }] = await Promise.all([
        supabase.from('profiles').select('connect_code').eq('id', user.id).single(),
        supabase.from('blocked_users').select('blocked_user_id, blocked_connect_code').eq('user_id', user.id),
      ]);
      if (!profile?.connect_code) return [];

      const blockedIds = new Set((blockedRows || []).map((b: any) => b.blocked_user_id).filter(Boolean));
      const blockedCodes = new Set((blockedRows || []).map((b: any) => b.blocked_connect_code).filter(Boolean));

      const { data: rawData } = await supabase
        .from('friends')
        .select('id, user_id, friend_connect_code, status, created_at, note, profiles!friends_user_id_fkey(connect_code, display_name, discord_username, discord_id, avatar_url, hide_discord_unless_friends, hide_avatar, main_character, top_characters, hide_connection_type, region, chosen_region, hide_region)')
        .eq('friend_connect_code', profile.connect_code)
        .eq('status', 'pending');
      if (!rawData) return [];

      const data = rawData.filter((f: any) => {
        const senderCode = (f.profiles as any)?.connect_code;
        return !blockedIds.has(f.user_id) && (!senderCode || !blockedCodes.has(senderCode));
      });

      const codes = data.map((f: any) => (f.profiles as any)?.connect_code).filter(Boolean);
      const senderIds = data.map((f: any) => f.user_id).filter(Boolean);
      let ratingsMap: Record<string, any> = {};
      let presenceMap: Record<string, any> = {};
      if (codes.length > 0) {
        const { data: ratings } = await supabase.from('player_ratings').select('connect_code, effective_rating').in('connect_code', codes);
        if (ratings) ratings.forEach((r: any) => { ratingsMap[r.connect_code] = r; });
      }
      const liveRatingsIncoming = getCachedRatings(codes);
      if (codes.length > 0) void batchFetchRatings(codes);
      if (senderIds.length > 0) {
        const { data: presRows } = await supabase.from('presence_log').select('user_id, connection_type').in('user_id', senderIds);
        if (presRows) presRows.forEach((r: any) => { presenceMap[r.user_id] = r; });
      }

      const result = data.map((f: any) => {
        const p = f.profiles as any;
        const code = p?.connect_code || '';
        const rEntry = ratingsMap[code];
        const pres = presenceMap[f.user_id] || {};
        const slippiChars: any[] = Array.isArray(p?.top_characters) ? p.top_characters : [];
        const mainChar = p?.main_character ?? slippiChars[0]?.characterId ?? null;
        return {
          id: f.id,
          fromUserId: f.user_id,
          connectCode: code,
          displayName: p?.display_name || null,
          discordUsername: p?.hide_discord_unless_friends ? null : (p?.discord_username || null),
          discordId: p?.hide_discord_unless_friends ? null : (p?.discord_id || null),
          avatarUrl: p?.hide_avatar ? null : (p?.avatar_url || null),
          rating: displayEffectiveRating(code, liveRatingsIncoming, rEntry),
          characterId: mainChar,
          connectionType: p?.hide_connection_type ? null : (pres.connection_type || null),
          region: p?.hide_region ? null : (p?.chosen_region || p?.region || null),
          note: f.note || null,
        };
      });
      console.log(`[bench] friends:incoming total=${(performance.now()-t0).toFixed(0)}ms rows=${data.length}`);
      return result;
    } catch (e) { console.error('friends:incoming', e); return []; }
  });

  ipcMain.handle('friends:accept', async (_e, requestId: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };

      // Get the incoming request
      const { data: req } = await supabase
        .from('friends')
        .select('id, user_id, friend_connect_code')
        .eq('id', requestId)
        .single();
      if (!req) return { error: 'Request not found' };

      // Mark it accepted
      const { error: upErr } = await supabase
        .from('friends')
        .update({ status: 'accepted', friend_id: user.id })
        .eq('id', requestId);
      if (upErr) return { error: upErr.message };

      // Get the sender's connect code
      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('connect_code')
        .eq('id', req.user_id)
        .single();

      // Create the reciprocal row so the acceptor also has them as a friend
      if (senderProfile?.connect_code) {
        await supabase
          .from('friends')
          .upsert({
            user_id: user.id,
            friend_id: req.user_id,
            friend_connect_code: senderProfile.connect_code,
            status: 'accepted',
          }, { onConflict: 'user_id,friend_connect_code' });
      }

      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('friends:decline', async (_e, requestId: string) => {
    try {
      await supabase.from('friends').delete().eq('id', requestId);
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('friends:add', async (_e, connectCode: string, note?: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };

      const { data: self } = await supabase
        .from('profiles')
        .select('connect_code')
        .eq('id', user.id)
        .single();
      if (self?.connect_code === connectCode) {
        return { error: "You can't add yourself" };
      }

      const { data: blocked } = await supabase
        .from('blocked_users')
        .select('id')
        .eq('user_id', user.id)
        .eq('blocked_connect_code', connectCode)
        .maybeSingle();
      if (blocked) return { error: 'This user is blocked' };

      const { data: target } = await supabase
        .from('profiles')
        .select('id, connect_code, disable_friend_requests')
        .eq('connect_code', connectCode)
        .single();

      if (target?.disable_friend_requests) {
        return { error: 'This player has disabled friend requests' };
      }

      if (target) {
        const myCode = (await supabase.from('profiles').select('connect_code').eq('id', user.id).single()).data?.connect_code || '';

        // Check if they already have a row for us (pending or accepted)
        const { data: theirRow } = await supabase
          .from('friends')
          .select('id, status')
          .eq('user_id', target.id)
          .eq('friend_connect_code', myCode)
          .single();

        if (theirRow) {
          // Ensure their row is accepted
          if (theirRow.status !== 'accepted') {
            await supabase
              .from('friends')
              .update({ status: 'accepted', friend_id: user.id })
              .eq('id', theirRow.id);
          }

          // Ensure our row exists and is accepted
          await supabase
            .from('friends')
            .upsert({
              user_id: user.id,
              friend_id: target.id,
              friend_connect_code: connectCode,
              status: 'accepted',
            }, { onConflict: 'user_id,friend_connect_code' });

          return { ok: true, mutual: true };
        }

        // Check if we already have an accepted row for them
        const { data: ourRow } = await supabase
          .from('friends')
          .select('id, status')
          .eq('user_id', user.id)
          .eq('friend_connect_code', connectCode)
          .single();

        if (ourRow?.status === 'accepted') {
          return { ok: true, mutual: true };
        }
      }

      const row: Record<string, any> = {
        user_id: user.id,
        friend_connect_code: connectCode,
        status: 'pending',
        note: note || null,
      };
      if (target) row.friend_id = target.id;

      const { error } = await supabase
        .from('friends')
        .upsert(row, { onConflict: 'user_id,friend_connect_code' });
      if (error) return { error: error.message };
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('friends:remove', async (_e, friendshipId: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };

      const { data: row } = await supabase
        .from('friends')
        .select('user_id, friend_id, friend_connect_code')
        .eq('id', friendshipId)
        .single();

      if (!row) return { error: 'Friendship not found' };

      const myCode = (await supabase.from('profiles').select('connect_code').eq('id', user.id).single()).data?.connect_code || '';

      // Delete both directions
      await supabase.from('friends').delete().eq('id', friendshipId);

      if (row.friend_id) {
        await supabase
          .from('friends')
          .delete()
          .eq('user_id', row.friend_id)
          .eq('friend_connect_code', myCode);
      }

      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  const INVITE_COOLDOWN_MS = 60 * 1000;
  const INVITE_EXPIRY_MS = 5 * 60 * 1000;

  async function logEvent(userId: string, eventType: string, metadata: Record<string, any> = {}) {
    try {
      await supabase.from('event_log').insert({ user_id: userId, event_type: eventType, metadata });
    } catch (e: any) {
      console.warn('[event_log] Failed to log event:', eventType, e.message);
    }
  }

  async function cleanupExpiredInvites(userId: string) {
    const expiryCutoff = new Date(Date.now() - INVITE_EXPIRY_MS).toISOString();
    await supabase
      .from('play_invites')
      .delete()
      .eq('sender_id', userId)
      .eq('status', 'pending')
      .lt('created_at', expiryCutoff);
  }

  ipcMain.handle('invite:send', async (_e, friendConnectCode: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };

      await cleanupExpiredInvites(user.id);

      const { data: target } = await supabase
        .from('profiles')
        .select('id, connect_code')
        .eq('connect_code', friendConnectCode)
        .single();
      if (!target) return { error: 'Friend not found on app' };

      const cutoff = new Date(Date.now() - INVITE_COOLDOWN_MS).toISOString();

      const { data: existing } = await supabase
        .from('play_invites')
        .select('id')
        .eq('sender_id', user.id)
        .eq('receiver_id', target.id)
        .gte('created_at', cutoff)
        .limit(1);
      if (existing && existing.length > 0) {
        return { error: 'Invite already sent to this player' };
      }

      const MAX_OUTGOING = 5;
      const { data: allSent } = await supabase
        .from('play_invites')
        .select('id')
        .eq('sender_id', user.id)
        .eq('status', 'pending');
      if (allSent && allSent.length >= MAX_OUTGOING) {
        return { error: `Max ${MAX_OUTGOING} outgoing invites` };
      }

      const { error } = await supabase
        .from('play_invites')
        .upsert({
          sender_id: user.id,
          receiver_id: target.id,
          created_at: new Date().toISOString(),
          status: 'pending',
          sender_opened: false,
          receiver_opened: false,
        }, { onConflict: 'sender_id,receiver_id' });

      if (error) return { error: error.message };
      await logEvent(user.id, 'invite_sent', { receiver_code: friendConnectCode });
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('invite:pending', async () => {
    const t0 = performance.now();
    try {
      const user = await getCurrentUser();
      if (!user) return [];

      const expiry = new Date(Date.now() - INVITE_EXPIRY_MS).toISOString();
      const { data } = await supabase
        .from('play_invites')
        .select('id, sender_id, created_at, status, receiver_opened')
        .eq('receiver_id', user.id)
        .gte('created_at', expiry)
        .order('created_at', { ascending: false });
      if (!data || data.length === 0) return [];

      const senderIds = data.map((d: any) => d.sender_id);
      const [{ data: profiles }, { data: presRows }] = await Promise.all([
        supabase.from('profiles').select('id, connect_code, display_name, discord_username, avatar_url, hide_avatar, hide_discord_unless_friends, main_character, top_characters, hide_connection_type, region, chosen_region, hide_region').in('id', senderIds),
        supabase.from('presence_log').select('user_id, connection_type').in('user_id', senderIds),
      ]);
      const profileMap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });
      const presMap: Record<string, any> = {};
      (presRows || []).forEach((r: any) => { presMap[r.user_id] = r; });

      const codes = (profiles || []).map((p: any) => p.connect_code).filter(Boolean);
      let ratingsMap: Record<string, any> = {};
      if (codes.length > 0) {
        const { data: ratings } = await supabase.from('player_ratings').select('connect_code, effective_rating').in('connect_code', codes);
        if (ratings) ratings.forEach((r: any) => { ratingsMap[r.connect_code] = r; });
      }
      const liveRatingsPending = getCachedRatings(codes);
      if (codes.length > 0) void batchFetchRatings(codes);

      const result = data.map((d: any) => {
        const p = profileMap[d.sender_id] || {};
        const pres = presMap[d.sender_id] || {};
        const slippiChars: any[] = Array.isArray(p.top_characters) ? p.top_characters : [];
        const mainChar = p.main_character ?? slippiChars[0]?.characterId ?? null;
        const rEntry = ratingsMap[p.connect_code];
        return {
          ...d,
          connectCode: p.connect_code,
          displayName: p.display_name,
          discordUsername: p.hide_discord_unless_friends ? null : (p.discord_username || null),
          avatarUrl: p.hide_avatar ? null : (p.avatar_url || null),
          mainCharacter: mainChar,
          rating: displayEffectiveRating(p.connect_code, liveRatingsPending, rEntry),
          connectionType: p.hide_connection_type ? null : (pres.connection_type || null),
          region: p.hide_region ? null : (p.chosen_region || p.region || null),
        };
      });
      console.log(`[bench] invite:pending total=${(performance.now()-t0).toFixed(0)}ms rows=${data.length}`);
      return result;
    } catch { return []; }
  });

  ipcMain.handle('invite:dismiss', async (_e, inviteId: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };

      const { data: invite } = await supabase
        .from('play_invites')
        .select('sender_id, receiver_id')
        .eq('id', inviteId)
        .single();

      await supabase.from('play_invites').delete().eq('id', inviteId);

      if (invite) {
        const isSender = invite.sender_id === user.id;
        await logEvent(user.id, isSender ? 'invite_cancelled' : 'invite_declined', { invite_id: inviteId });
      }

      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('invite:accept', async (_e, inviteId: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };

      const { error } = await supabase
        .from('play_invites')
        .update({ status: 'accepted' })
        .eq('id', inviteId)
        .eq('receiver_id', user.id);

      if (error) return { error: error.message };
      await logEvent(user.id, 'invite_accepted', { invite_id: inviteId });
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('invite:complete', async (_e, inviteId: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };

      const { data: invite } = await supabase
        .from('play_invites')
        .select('sender_id, receiver_id, sender_opened, receiver_opened')
        .eq('id', inviteId)
        .single();
      if (!invite) return { error: 'Invite not found' };

      const isSender = invite.sender_id === user.id;
      const flagCol = isSender ? 'sender_opened' : 'receiver_opened';
      const otherOpened = isSender ? invite.receiver_opened : invite.sender_opened;

      if (otherOpened) {
        await supabase.from('play_invites').delete().eq('id', inviteId);
        await logEvent(user.id, 'invite_both_opened', { invite_id: inviteId });
      } else {
        await supabase
          .from('play_invites')
          .update({ [flagCol]: true })
          .eq('id', inviteId);
        await logEvent(user.id, 'invite_opened_melee', { invite_id: inviteId });
      }

      await supabase
        .from('play_invites')
        .delete()
        .eq('sender_id', user.id)
        .eq('status', 'pending')
        .neq('id', inviteId);

      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('invite:sent', async () => {
    const t0 = performance.now();
    try {
      const user = await getCurrentUser();
      if (!user) return [];

      const expiry = new Date(Date.now() - INVITE_EXPIRY_MS).toISOString();
      const { data } = await supabase
        .from('play_invites')
        .select('id, receiver_id, created_at, status, sender_opened')
        .eq('sender_id', user.id)
        .gte('created_at', expiry)
        .order('created_at', { ascending: false });
      if (!data || data.length === 0) return [];

      const receiverIds = data.map((d: any) => d.receiver_id);
      const [{ data: profiles }, { data: presRows }] = await Promise.all([
        supabase.from('profiles').select('id, connect_code, display_name, discord_username, avatar_url, hide_avatar, hide_discord_unless_friends, main_character, top_characters, hide_connection_type, region, chosen_region, hide_region').in('id', receiverIds),
        supabase.from('presence_log').select('user_id, connection_type').in('user_id', receiverIds),
      ]);
      const profileMap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });
      const presMap: Record<string, any> = {};
      (presRows || []).forEach((r: any) => { presMap[r.user_id] = r; });

      const codes = (profiles || []).map((p: any) => p.connect_code).filter(Boolean);
      let ratingsMap: Record<string, any> = {};
      if (codes.length > 0) {
        const { data: ratings } = await supabase.from('player_ratings').select('connect_code, effective_rating').in('connect_code', codes);
        if (ratings) ratings.forEach((r: any) => { ratingsMap[r.connect_code] = r; });
      }
      const liveRatingsSent = getCachedRatings(codes);
      if (codes.length > 0) void batchFetchRatings(codes);

      const result = data.map((d: any) => {
        const p = profileMap[d.receiver_id] || {};
        const pres = presMap[d.receiver_id] || {};
        const slippiChars: any[] = Array.isArray(p.top_characters) ? p.top_characters : [];
        const mainChar = p.main_character ?? slippiChars[0]?.characterId ?? null;
        const rEntry = ratingsMap[p.connect_code];
        return {
          ...d,
          connectCode: p.connect_code,
          displayName: p.display_name,
          discordUsername: p.hide_discord_unless_friends ? null : (p.discord_username || null),
          avatarUrl: p.hide_avatar ? null : (p.avatar_url || null),
          mainCharacter: mainChar,
          rating: displayEffectiveRating(p.connect_code, liveRatingsSent, rEntry),
          connectionType: p.hide_connection_type ? null : (pres.connection_type || null),
          region: p.hide_region ? null : (p.chosen_region || p.region || null),
        };
      });
      console.log(`[bench] invite:sent total=${(performance.now()-t0).toFixed(0)}ms rows=${data.length}`);
      return result;
    } catch { return []; }
  });

  ipcMain.handle('opponents:backfill', async (_e, sinceMs?: number, beforeMs?: number) => {
    try {
      const identity = getIdentity();
      if (!identity) return { error: 'No identity' };
      const settings = getSettings();
      const result = await backfillRecentReplays(
        settings.replayDir, identity.connectCode,
        sinceMs ?? 7 * 24 * 60 * 60 * 1000,
        beforeMs ?? 0,
      );
      return { ok: true, processed: result.processed, oldestMs: result.oldestMs };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('opponents:list', async (_e, limit = 50) => {
    try {
      const user = await getCurrentUser();
      if (!user) return [];
      const { data } = await supabase
        .from('matches')
        .select('*')
        .eq('user_id', user.id)
        .order('played_at', { ascending: false })
        .limit(limit);
      return data || [];
    } catch (e) { console.error('opponents:list', e); return []; }
  });

  ipcMain.handle('opponents:page', async (_e, before: string, limit = 50) => {
    try {
      const user = await getCurrentUser();
      if (!user) return [];
      const { data } = await supabase
        .from('matches')
        .select('*')
        .eq('user_id', user.id)
        .lt('played_at', before)
        .order('played_at', { ascending: false })
        .limit(limit);
      return data || [];
    } catch (e) { console.error('opponents:page', e); return []; }
  });

  ipcMain.handle('opponents:latestTimestamp', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return null;
      const { data } = await supabase
        .from('matches')
        .select('played_at')
        .eq('user_id', user.id)
        .order('played_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.played_at ?? null;
    } catch (e) { console.error('opponents:latestTimestamp', e); return null; }
  });

  ipcMain.handle('stats:playerCount', async () => {
    try {
      const { count, error } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });
      if (error) return 0;
      return count ?? 0;
    } catch { return 0; }
  });

  ipcMain.handle('stats:livePresence', async () => {
    try {
      const LIVE_STATS_STALE_MS = 24 * 60 * 60 * 1000;
      const staleCutoff = new Date(Date.now() - LIVE_STATS_STALE_MS).toISOString();
      const { count: onlineCount } = await supabase
        .from('presence_log')
        .select('*, profiles!inner(id)', { count: 'exact', head: true })
        .eq('status', 'online')
        .gte('updated_at', staleCutoff);
      const { count: inGameCount } = await supabase
        .from('presence_log')
        .select('*, profiles!inner(id)', { count: 'exact', head: true })
        .eq('status', 'in-game')
        .not('opponent_code', 'is', null)
        .gte('updated_at', staleCutoff);
      return { online: onlineCount ?? 0, inGame: inGameCount ?? 0 };
    } catch { return { online: 0, inGame: 0 }; }
  });

  ipcMain.handle('leaderboard:top', async (_e, limit = 50) => {
    try {
      const { data, error } = await supabase
        .from('user_activity')
        .select('user_id, in_game_seconds, yesterday_seconds, profiles(connect_code, display_name, avatar_url, main_character)')
        .order('in_game_seconds', { ascending: false })
        .gt('in_game_seconds', 0)
        .limit(limit);
      if (error) { console.error('leaderboard:top', error.message); return []; }
      const rows = (data || []).map((row: any) => ({
        userId: row.user_id,
        profiles: row.profiles,
        inGameSeconds: row.in_game_seconds ?? 0,
        yesterdaySeconds: row.yesterday_seconds ?? 0,
      }));
      const yesterdayRanks = new Map<string, number>();
      [...rows]
        .sort((a, b) => b.yesterdaySeconds - a.yesterdaySeconds)
        .forEach((r, i) => { yesterdayRanks.set(r.userId, i + 1); });
      return rows.map((row, i) => {
        const p = row.profiles;
        const todayRank = i + 1;
        const yRank = yesterdayRanks.get(row.userId) ?? todayRank;
        return {
          userId: row.userId,
          connectCode: p?.connect_code ?? '',
          displayName: p?.display_name ?? '',
          avatarUrl: p?.avatar_url ?? null,
          mainCharacter: p?.main_character ?? null,
          inGameSeconds: row.inGameSeconds,
          rankChange: yRank - todayRank,
        };
      });
    } catch (e) { console.error('leaderboard:top', e); return []; }
  });

  ipcMain.handle('presence:online', () => getOnlineUsers());
  ipcMain.handle('presence:localStatus', () => getLocalStatusSnapshot());
  ipcMain.handle('presence:connectionType', () => getConnectionType());
  ipcMain.handle('stats:presence', () => getPresenceStats());
  ipcMain.handle('presence:toggleLookingToPlay', () => toggleLookingToPlay());
  ipcMain.handle('presence:isLookingToPlay', () => isLookingToPlay());
  ipcMain.handle('presence:setStatusPreset', (_e, preset: string | null) => setStatusPreset(preset));
  ipcMain.handle('presence:getStatusPreset', () => getStatusPreset());
  ipcMain.handle('presence:setLfgExpiry', (_e, minutes: number | null) => setLfgExpiry(minutes));
  ipcMain.handle('presence:getLfgExpiry', () => getLfgExpiry());

  ipcMain.handle('presence:friendStatuses', async () => {
    const t0 = performance.now();
    try {
      const user = await getCurrentUser();
      if (!user) return {};
      const t1 = performance.now();

      const { data: friendRows } = await supabase.from('friends')
        .select('friend_id, friend_connect_code, profiles!friends_friend_id_fkey(connect_code)')
        .eq('user_id', user.id)
        .eq('status', 'accepted');
      if (!friendRows || friendRows.length === 0) return {};
      const t2 = performance.now();

      const friendIds = friendRows.map((f: any) => f.friend_id).filter(Boolean);
      if (friendIds.length === 0) return {};

      const { data } = await supabase.from('presence_log')
        .select('user_id, status, current_character, opponent_code, playing_since, looking_to_play, looking_to_play_since, status_preset, connection_type, app_idle, updated_at')
        .in('user_id', friendIds);
      if (!data) return {};
      const t3 = performance.now();

      const now = Date.now();
      const result: Record<string, any> = {};
      for (const row of data) {
        const friend = friendRows.find((f: any) => f.friend_id === row.user_id);
        const code = (friend as any)?.profiles?.connect_code || friend?.friend_connect_code;
        if (!code) continue;
        result[code] = resolvePresenceRow(row as any, PRESENCE_STALE_THRESHOLD, now);
      }
      console.log(`[bench] presence:friendStatuses total=${(performance.now()-t0).toFixed(0)}ms (auth=${(t1-t0).toFixed(0)} friends=${(t2-t1).toFixed(0)} presence=${(t3-t2).toFixed(0)} rows=${data.length})`);
      return result;
    } catch (e) { console.error('presence:friendStatuses', e); return {}; }
  });

  let discoverInFlight: Promise<any[]> | null = null;

  ipcMain.handle('discover:list', async (_e, opts?: { characterIds?: number[]; minElo?: number; maxElo?: number }) => {
    if (discoverInFlight) return discoverInFlight;
    discoverInFlight = (async () => {
    const t0 = performance.now();
    const characterIds = opts?.characterIds;
    const minElo = opts?.minElo ?? null;
    const maxElo = opts?.maxElo ?? null;
    const filterChars = Array.isArray(characterIds) && characterIds.length > 0
      ? new Set(characterIds)
      : null;
    try {
      const user = await getCurrentUser();
      if (!user) return [];
      const t1 = performance.now();

      const [{ data: myProfile }, { data: friendRows }, { data: blockedRows }] = await Promise.all([
        supabase.from('profiles').select('latitude, longitude, region').eq('id', user.id).single(),
        supabase.from('friends').select('friend_id').eq('user_id', user.id),
        supabase.from('blocked_users').select('blocked_user_id, blocked_connect_code').eq('user_id', user.id),
      ]);
      const t2 = performance.now();
      const localGeo = getCachedGeo();
      const myLat = myProfile?.latitude ?? localGeo?.lat ?? null;
      const myLng = myProfile?.longitude ?? localGeo?.lon ?? null;

      const friendIds = new Set(
        (friendRows || []).map((f: any) => f.friend_id).filter(Boolean),
      );
      const blockedIds = new Set(
        (blockedRows || []).map((b: any) => b.blocked_user_id).filter(Boolean),
      );
      const blockedCodes = new Set(
        (blockedRows || []).map((b: any) => b.blocked_connect_code).filter(Boolean),
      );

      const cutoff = new Date(Date.now() - PRESENCE_STALE_THRESHOLD).toISOString();
      const { data: presenceRows } = await supabase
        .from('presence_log')
        .select('user_id, status, current_character, opponent_code, playing_since, looking_to_play, looking_to_play_since, status_preset, connection_type, app_idle, updated_at')
        .in('status', ['online', 'in-game'])
        .gte('updated_at', cutoff);
      if (!presenceRows || presenceRows.length === 0) return [];
      const t3 = performance.now();

      const candidateIds = presenceRows
        .map((r: any) => r.user_id)
        .filter((id: string) => id !== user.id && !friendIds.has(id) && !blockedIds.has(id));
      if (candidateIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, connect_code, display_name, avatar_url, latitude, longitude, top_characters, main_character, secondary_character, region, chosen_region, hide_region, hide_discord_unless_friends, hide_avatar, hide_connection_type, discord_username, discord_id')
        .in('id', candidateIds);
      if (!profiles) return [];
      const t4 = performance.now();

      const notBlocked = profiles.filter((p: any) => !blockedCodes.has(p.connect_code));
      const filtered = filterChars
        ? notBlocked.filter((p: any) => {
            const slippi: any[] = Array.isArray(p.top_characters) ? p.top_characters : [];
            const mainId = p.main_character ?? slippi[0]?.characterId;
            return mainId != null && filterChars.has(mainId);
          })
        : notBlocked;
      if (filterChars && filtered.length === 0) return [];

      const profileMap: Record<string, any> = {};
      filtered.forEach((p: any) => { profileMap[p.id] = p; });

      const codes = filtered.map((p: any) => p.connect_code).filter(Boolean);
      let ratingsMap: Record<string, any> = {};
      const matchHistoryMap: Record<string, string> = {};

      if (codes.length > 0) {
        const [ratingsResult, matchResult] = await Promise.all([
          supabase.from('player_ratings').select('connect_code, effective_rating').in('connect_code', codes),
          supabase.from('matches')
            .select('opponent_connect_code, played_at')
            .eq('user_id', user.id)
            .in('opponent_connect_code', codes)
            .order('played_at', { ascending: false }),
        ]);
        if (ratingsResult.data) ratingsResult.data.forEach((r: any) => { ratingsMap[r.connect_code] = r; });
        if (matchResult.data) {
          for (const m of matchResult.data as any[]) {
            if (!matchHistoryMap[m.opponent_connect_code]) {
              matchHistoryMap[m.opponent_connect_code] = m.played_at;
            }
          }
        }
      }

      const liveRatingsDiscover = new Map<string, RatingCacheEntry>();
      for (const code of codes) {
        const cached = slippiRatingCache.get(code);
        if (cached) liveRatingsDiscover.set(code, cached);
      }
      const t5 = performance.now();
      const t6 = t5;

      const myRegion = (myProfile?.region as string | null) ?? localGeo?.region ?? null;
      const myCountry = myRegion?.split(',').pop()?.trim() ?? null;

      let results = presenceRows
        .filter((r: any) => profileMap[r.user_id])
        .map((r: any) => {
          const p = profileMap[r.user_id];
          const rEntry = ratingsMap[p.connect_code];
          const hasGeo = myLat != null && myLng != null && p.latitude != null && p.longitude != null;
          let distance: number;
          if (hasGeo) {
            const cosLat = Math.cos((myLat! * Math.PI) / 180);
            distance = Math.pow(p.latitude - myLat!, 2) + Math.pow((p.longitude - myLng!) * cosLat, 2);
          } else {
            const theirRegion = p.region as string | null;
            const theirCountry = theirRegion?.split(',').pop()?.trim() ?? null;
            if (myRegion && theirRegion && myRegion === theirRegion) distance = 100;
            else if (myCountry && theirCountry && myCountry === theirCountry) distance = 500;
            else distance = 9999;
          }
          // Small variance so the order shuffles slightly between refreshes
          distance += distance * 0.08 * (Math.random() - 0.5);

          const resolved = resolvePresenceRow(r as any, PRESENCE_STALE_THRESHOLD, Date.now());

          // Boost active players only within ~NY-to-FL range (~1,800 km / 250 sq-deg)
          const MAX_BOOST_DISTANCE = 250;
          if (distance <= MAX_BOOST_DISTANCE) {
            if (resolved.statusPreset) distance *= 0.4;
            else if (resolved.lookingToPlay) distance *= 0.5;
          }
          return {
            userId: p.id,
            connectCode: p.connect_code,
            displayName: p.display_name || null,
            discordUsername: p.hide_discord_unless_friends ? null : (p.discord_username || null),
            discordId: p.hide_discord_unless_friends ? null : (p.discord_id || null),
            avatarUrl: p.hide_avatar ? null : (p.avatar_url || null),
            rating: displayEffectiveRating(p.connect_code, liveRatingsDiscover, rEntry),
            topCharacters: (() => {
              const slippi: { characterId: number; gameCount: number }[] = Array.isArray(p.top_characters) ? p.top_characters : [];
              const resolved: { characterId: number; gameCount: number }[] = [];
              if (p.main_character != null) resolved.push({ characterId: p.main_character, gameCount: 0 });
              else if (slippi[0]) resolved.push(slippi[0]);
              return resolved;
            })(),
            region: p.hide_region ? null : (p.chosen_region || p.region || null),
            status: resolved.status,
            currentCharacter: resolved.currentCharacter,
            opponentCode: resolved.opponentCode,
            playingSince: resolved.playingSince,
            connectionType: p.hide_connection_type ? null : resolved.connectionType,
            updatedAt: r.updated_at,
            lastPlayedAt: matchHistoryMap[p.connect_code] || null,
            lookingToPlay: resolved.lookingToPlay,
            statusPreset: resolved.statusPreset,
            distance,
          };
        });

      const eloFilterActive = minElo != null || maxElo != null;
      const MAX_DISTANCE = 2000;
      if (!eloFilterActive) {
        results = results.filter((r: any) => r.distance <= MAX_DISTANCE);
      }

      if (eloFilterActive) {
        results = results.filter((r: any) => {
          if (r.rating == null) return false;
          if (minElo != null && r.rating < minElo) return false;
          if (maxElo != null && r.rating > maxElo) return false;
          return true;
        });
      }

      results.sort((a: any, b: any) => {
        const hasHistoryA = a.lastPlayedAt ? 1 : 0;
        const hasHistoryB = b.lastPlayedAt ? 1 : 0;
        if (hasHistoryA !== hasHistoryB) return hasHistoryB - hasHistoryA;
        const hasStatusA = (a.statusPreset || a.lookingToPlay) ? 1 : 0;
        const hasStatusB = (b.statusPreset || b.lookingToPlay) ? 1 : 0;
        if (hasStatusA !== hasStatusB) return hasStatusB - hasStatusA;
        if (hasStatusA && hasStatusB) {
          const inGameA = a.opponentCode ? 1 : 0;
          const inGameB = b.opponentCode ? 1 : 0;
          if (inGameA !== inGameB) return inGameA - inGameB;
        }
        return a.distance - b.distance;
      });

      const final = results.slice(0, 50);

      const mutualMap = new Map<string, number>();
      if (final.length > 0) {
        const ids = final.map((r: any) => r.userId).filter(Boolean);
        const { data: mutualRows } = await supabase.rpc('discover_mutual_friend_counts', {
          p_candidate_ids: ids,
        });
        if (Array.isArray(mutualRows)) {
          for (const row of mutualRows as { candidate_id: string; mutual_count: number }[]) {
            if (row.candidate_id) mutualMap.set(row.candidate_id, row.mutual_count ?? 0);
          }
        }
      }

      const withMutuals = final.map((r: any) => ({
        ...r,
        mutualFriendCount: mutualMap.get(r.userId) ?? 0,
      }));

      console.log(`[bench] discover:list total=${(performance.now()-t0).toFixed(0)}ms (auth=${(t1-t0).toFixed(0)} context=${(t2-t1).toFixed(0)} presence=${(t3-t2).toFixed(0)} profiles=${(t4-t3).toFixed(0)} ratings=${(t5-t4).toFixed(0)} matches=${(t6-t5).toFixed(0)} candidates=${candidateIds.length} results=${withMutuals.length} nullRatings=${withMutuals.filter((r: any) => r.rating == null).length})`);
      return withMutuals;
    } catch (e) { console.error('discover:list', e); return []; }
    })();
    try { return await discoverInFlight; } finally { discoverInFlight = null; }
  });

  const VALID_NUDGE_MESSAGES = ['GGs', 'one more', 'gtg', 'you play so hot and cool', 'that was sick', "you're cracked", "i'm cracked", "i'm so high", 'check discord', 'hi', 'Down in 5-15 min', 'Sorry, another time', 'Looking for different matchup', 'Message me on Discord'];

  ipcMain.handle('nudge:send', async (_e, receiverConnectCode: string, message: string) => {
    try {
      if (!VALID_NUDGE_MESSAGES.includes(message)) return { error: 'Invalid nudge message' };
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };

      const { data: target } = await supabase
        .from('profiles')
        .select('id, connect_code')
        .eq('connect_code', receiverConnectCode)
        .single();
      if (!target) return { error: 'Player not found' };
      if (target.id === user.id) return { error: "You can't nudge yourself" };

      const { data: blockedByMe } = await supabase
        .from('blocked_users')
        .select('id')
        .eq('user_id', user.id)
        .eq('blocked_connect_code', receiverConnectCode)
        .maybeSingle();
      if (blockedByMe) return { error: 'This user is blocked' };

      const { data: self } = await supabase
        .from('profiles')
        .select('connect_code')
        .eq('id', user.id)
        .single();
      if (self?.connect_code) {
        const { data: blockedByThem } = await supabase
          .from('blocked_users')
          .select('id')
          .eq('user_id', target.id)
          .eq('blocked_connect_code', self.connect_code)
          .maybeSingle();
        if (blockedByThem) return { error: 'Cannot send nudge to this player' };
      }

      // Cooldown: check if sender already sent a nudge without receiving one back
      const { data: lastSent } = await supabase
        .from('nudges')
        .select('created_at')
        .eq('sender_id', user.id)
        .eq('receiver_id', target.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastSent) {
        const { data: lastReceived } = await supabase
          .from('nudges')
          .select('created_at')
          .eq('sender_id', target.id)
          .eq('receiver_id', user.id)
          .gt('created_at', lastSent.created_at)
          .limit(1)
          .maybeSingle();

        if (!lastReceived) {
          return { error: 'Wait for them to reply before sending another nudge' };
        }
      }

      const { error } = await supabase.from('nudges').insert({
        sender_id: user.id,
        receiver_id: target.id,
        message,
      });
      if (error) return { error: error.message };
      await logEvent(user.id, 'nudge_sent', { receiver_code: receiverConnectCode, message });
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('nudge:list', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return [];

      const { data } = await supabase
        .from('nudges')
        .select('id, sender_id, message, created_at')
        .eq('receiver_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!data || data.length === 0) return [];

      const senderIds = [...new Set(data.map((d: any) => d.sender_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, connect_code, display_name, discord_username, avatar_url, hide_avatar')
        .in('id', senderIds);
      const profileMap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });

      return data.map((d: any) => {
        const p = profileMap[d.sender_id] || {};
        return {
          id: d.id,
          senderId: d.sender_id,
          connectCode: p.connect_code || '',
          displayName: p.display_name || null,
          discordUsername: p.discord_username || null,
          avatarUrl: p.hide_avatar ? null : (p.avatar_url || null),
          message: d.message,
          createdAt: d.created_at,
        };
      });
    } catch { return []; }
  });

  ipcMain.handle('nudge:listSent', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return [];

      const { data } = await supabase
        .from('nudges')
        .select('id, receiver_id, message, created_at')
        .eq('sender_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (!data || data.length === 0) return [];

      const receiverIds = [...new Set(data.map((d: any) => d.receiver_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, connect_code')
        .in('id', receiverIds);
      const profileMap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });

      return data.map((d: any) => ({
        id: d.id,
        receiverId: d.receiver_id,
        connectCode: profileMap[d.receiver_id]?.connect_code || '',
        message: d.message,
        createdAt: d.created_at,
      }));
    } catch { return []; }
  });

  onPresenceSync((users) => { sendToRenderer('presence:updated', users); });
  onLocalStatusChange((info) => { sendToRenderer('presence:localStatus', info); });

  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:update', (_e, partial: Partial<AgentSettings>) => {
    const result = updateSettings(partial);
    if (partial.reduceBackgroundActivity !== undefined) {
      setGameThrottling(result.reduceBackgroundActivity);
    }
    return result;
  });
  ipcMain.handle('settings:browse', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Slippi Replay Directory',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('setup:isComplete', () => isSetupComplete());
  ipcMain.handle('notifications:test', () => { showTestNotification(); });

  ipcMain.handle('settings:getSlippiDir', () => getCustomLauncherDir());
  ipcMain.handle('settings:setSlippiDir', (_e, dir: string | null) => {
    setCustomLauncherDir(dir);
    invalidateIdentityCache();
    return dir;
  });
  ipcMain.handle('settings:browseSlippiDir', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Slippi Launcher Data Folder',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('privacy:get', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return { hideRegion: false, hideDiscordUnlessFriends: false, hideAvatar: false, hideConnectionType: false, hideOnlineStatus: false, disableFriendRequests: false, chosenRegion: null };
      const { data } = await supabase.from('profiles').select('hide_region, hide_discord_unless_friends, hide_avatar, hide_connection_type, show_online_status, disable_friend_requests, chosen_region').eq('id', user.id).single();
      const hideConn = data?.hide_connection_type ?? false;
      const hideOnline = !(data?.show_online_status ?? true);
      setHideConnectionType(hideConn);
      setHideOnlineStatus(hideOnline);
      return {
        hideRegion: data?.hide_region ?? false,
        hideDiscordUnlessFriends: data?.hide_discord_unless_friends ?? false,
        hideAvatar: data?.hide_avatar ?? false,
        hideConnectionType: hideConn,
        hideOnlineStatus: hideOnline,
        disableFriendRequests: data?.disable_friend_requests ?? false,
        chosenRegion: data?.chosen_region ?? null,
      };
    } catch { return { hideRegion: false, hideDiscordUnlessFriends: false, hideAvatar: false, hideConnectionType: false, hideOnlineStatus: false, disableFriendRequests: false, chosenRegion: null }; }
  });

  ipcMain.handle('privacy:update', async (_e, partial: { hideRegion?: boolean; hideDiscordUnlessFriends?: boolean; hideAvatar?: boolean; hideConnectionType?: boolean; hideOnlineStatus?: boolean; disableFriendRequests?: boolean }) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };
      const update: Record<string, any> = {};
      if (partial.hideRegion !== undefined) update.hide_region = partial.hideRegion;
      if (partial.hideDiscordUnlessFriends !== undefined) update.hide_discord_unless_friends = partial.hideDiscordUnlessFriends;
      if (partial.hideAvatar !== undefined) update.hide_avatar = partial.hideAvatar;
      if (partial.hideConnectionType !== undefined) {
        update.hide_connection_type = partial.hideConnectionType;
        setHideConnectionType(partial.hideConnectionType);
      }
      if (partial.hideOnlineStatus !== undefined) {
        update.show_online_status = !partial.hideOnlineStatus;
        setHideOnlineStatus(partial.hideOnlineStatus);
      }
      if (partial.disableFriendRequests !== undefined) update.disable_friend_requests = partial.disableFriendRequests;
      const { error } = await supabase.from('profiles').update(update).eq('id', user.id);
      if (error) return { error: error.message };
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('profile:setRegion', async (_e, chosenRegion: string | null) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };
      const { error } = await supabase.from('profiles').update({ chosen_region: chosenRegion || null }).eq('id', user.id);
      if (error) return { error: error.message };
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('profile:updateCharacters', async (_e, data: { mainCharacter?: number | null; secondaryCharacter?: number | null }) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };
      const update: Record<string, any> = {};
      if (data.mainCharacter !== undefined) update.main_character = data.mainCharacter;
      if (data.secondaryCharacter !== undefined) update.secondary_character = data.secondaryCharacter;
      if (Object.keys(update).length === 0) return { ok: true };
      const { error } = await supabase.from('profiles').update(update).eq('id', user.id);
      if (error) return { error: error.message };
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  // --- Block / unblock ---

  ipcMain.handle('block:add', async (_e, connectCode: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };

      const { data: self } = await supabase
        .from('profiles')
        .select('connect_code')
        .eq('id', user.id)
        .single();
      if (self?.connect_code === connectCode) return { error: "You can't block yourself" };

      const { data: target } = await supabase
        .from('profiles')
        .select('id')
        .eq('connect_code', connectCode)
        .maybeSingle();

      const { error } = await supabase.from('blocked_users').upsert({
        user_id: user.id,
        blocked_user_id: target?.id ?? null,
        blocked_connect_code: connectCode,
      }, { onConflict: 'user_id,blocked_connect_code' });
      if (error) return { error: error.message };

      // Remove any existing friendship in both directions
      const myCode = self?.connect_code || '';
      await supabase.from('friends').delete().eq('user_id', user.id).eq('friend_connect_code', connectCode);
      if (target?.id) {
        await supabase.from('friends').delete().eq('user_id', target.id).eq('friend_connect_code', myCode);
      }

      invalidateBlockCache();
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('block:remove', async (_e, connectCode: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };
      const { error } = await supabase
        .from('blocked_users')
        .delete()
        .eq('user_id', user.id)
        .eq('blocked_connect_code', connectCode);
      if (error) return { error: error.message };
      invalidateBlockCache();
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('block:list', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return [];
      const { data } = await supabase
        .from('blocked_users')
        .select('blocked_connect_code, blocked_user_id, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (!data) return [];

      const userIds = data.map((b: any) => b.blocked_user_id).filter(Boolean);
      let profileMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, connect_code, display_name, avatar_url, hide_avatar')
          .in('id', userIds);
        if (profiles) profiles.forEach((p: any) => { profileMap[p.id] = p; });
      }

      return data.map((b: any) => {
        const p = profileMap[b.blocked_user_id] || {};
        return {
          connectCode: b.blocked_connect_code,
          displayName: p.display_name || null,
          avatarUrl: p.hide_avatar ? null : (p.avatar_url || null),
          blockedAt: b.created_at,
        };
      });
    } catch (e) { console.error('block:list', e); return []; }
  });

  ipcMain.handle('auth:checkBlacklist', async () => {
    try {
      if (!ENABLE_IDENTITY_BLACKLIST_ENFORCEMENT) return null;
      const user = await getCurrentUser();
      if (!user) return null;
      const { data } = await supabase
        .from('blacklist')
        .select('reason, claimed_code, actual_code, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    } catch { return null; }
  });

  ipcMain.handle('slippi:lookup', async (_e, connectCode: string) => {
    try {
      const query = `
        fragment profileFields on NetplayProfile {
          id ratingOrdinal ratingUpdateCount wins losses
          dailyGlobalPlacement dailyRegionalPlacement continent
          characters { character gameCount __typename }
          __typename
        }
        fragment userProfilePage on User {
          fbUid displayName
          connectCode { code __typename }
          status
          rankedNetplayProfile { ...profileFields __typename }
          __typename
        }
        query UserProfilePageQuery($cc: String, $uid: String) {
          getUser(connectCode: $cc, fbUid: $uid) { ...userProfilePage __typename }
        }
      `;
      const [res, ratingEntry] = await Promise.all([
        fetch('https://internal.slippi.gg/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operationName: 'UserProfilePageQuery',
            variables: { cc: connectCode, uid: connectCode },
            query,
          }),
        }),
        fetchSlippiRating(connectCode),
      ]);
      if (!res.ok) return null;
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { return null; }
      const user = data?.data?.getUser;
      if (!user?.fbUid) return null;
      const r = user.rankedNetplayProfile;
      const rawOrdinal = r?.ratingOrdinal ?? null;
      const displayRating = ratingEntry?.effectiveRating ?? rawOrdinal;
      return {
        displayName: user.displayName || '',
        connectCode: user.connectCode?.code || connectCode,
        rankedRating: displayRating,
        rankedWins: r?.wins ?? 0,
        rankedLosses: r?.losses ?? 0,
        globalPlacement: r?.dailyGlobalPlacement ?? null,
        continent: r?.continent ?? null,
        characters: (r?.characters ?? []).filter((c: any) => c?.character != null).map((c: any) => ({
          character: typeof c.character === 'string' ? slippiNameToId(c.character) : c.character,
          gameCount: c.gameCount,
        })).filter((c: any) => c.character != null),
      };
    } catch (e: any) { console.error('slippi:lookup', e); return null; }
  });

  ipcMain.handle('config:broadcast', async () => {
    try {
      const { data } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'broadcast_message')
        .single();
      return data?.value || null;
    } catch { return null; }
  });

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    const raw = typeof url === 'string' ? url.trim() : '';
    if (!raw) {
      console.warn('[shell] openExternal: empty url');
      return;
    }
    try {
      await shell.openExternal(raw);
    } catch (e) {
      console.error('[shell] openExternal failed:', raw, e);
    }
  });

  ipcMain.handle('banner:click', async (_e, banner: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return;
      await supabase.from('banner_clicks').insert({ user_id: user.id, banner });
    } catch { /* fire-and-forget */ }
  });

  let discordProtocolSupported: boolean | null = null;
  (async () => {
    const { exec } = require('child_process');
    if (process.platform === 'win32') {
      exec('reg query HKCR\\discord /ve', { timeout: 3000 }, (err: any, stdout: string) => {
        discordProtocolSupported = !err && stdout.includes('URL:');
        console.log('[discord] protocol supported:', discordProtocolSupported);
      });
    } else if (process.platform === 'darwin') {
      discordProtocolSupported = true;
    } else {
      discordProtocolSupported = false;
    }
  })();

  ipcMain.handle('discord:openProfile', async (_e, discordId: string) => {
    if (discordProtocolSupported) {
      await shell.openExternal(`discord://-/users/${discordId}`);
    } else {
      await shell.openExternal(`https://discord.com/users/${discordId}`);
    }
  });

  ipcMain.handle('clipboard:write', (_e, text: string) => { clipboard.writeText(text); });

  ipcMain.handle('perf:metrics', () => app.getAppMetrics());

  ipcMain.handle('updater:check', () => checkForUpdates());
  ipcMain.handle('updater:download', () => downloadUpdate());
  ipcMain.handle('updater:install', () => quitAndInstall());

  ipcMain.handle('directConnect:start', async (_e, connectCode: string, source?: string, meta?: Record<string, unknown>) => {
    try {
      const service = getDirectConnectService();
      if (service.isActive()) return { error: 'Direct connect already in progress' };

      service.removeAllListeners('status');
      service.on('status', (evt) => sendToRenderer('directConnect:status', evt));

      await service.start(connectCode);

      if (source) {
        const user = await getCurrentUser();
        if (user) {
          logEvent(user.id, `${source}_launch_melee`, { opponent_code: connectCode, ...meta });
        }
      }

      return { ok: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('directConnect:stop', () => {
    try {
      const service = getDirectConnectService();
      service.stop();
      return { ok: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('directConnect:status', () => {
    const service = getDirectConnectService();
    return { status: service.getStatus(), active: service.isActive() };
  });

  let _snapshotInflight: Promise<any> | null = null;

  ipcMain.handle('cashbox:getSnapshot', async () => {
    if (_snapshotInflight) {
      console.log('[cashbox] dedup: sharing in-flight snapshot request');
      return _snapshotInflight;
    }

    const p = (async () => {
      try {
        let code: string | null = null;
        const user = await getCurrentUser();
        if (user?.id) {
          try {
            const { data: profile } = await supabase
              .from('profiles')
              .select('connect_code')
              .eq('id', user.id)
              .maybeSingle();
            const fromProfile = typeof profile?.connect_code === 'string' ? profile.connect_code.trim() : '';
            if (fromProfile) code = fromProfile.toUpperCase();
          } catch {
            // Fallback below.
          }
        }
        if (!code) {
          const id = getIdentity();
          const fromIdentity = id?.connectCode?.trim();
          if (fromIdentity) code = fromIdentity;
        }
        if (!code) {
          return {
            ok: false as const,
            reason: 'not_mapped' as const,
            message: 'No Slippi connect code found.',
            startggConnected: isStartGgConnected(),
          };
        }
        const sggToken = await getStartGgUserToken();
        console.log('[cashbox] token source:', sggToken ? 'oauth (user-linked)' : 'env (START_GG_TOKEN fallback)');
        const snap = await getCashboxSnapshot(code, sggToken);
        if (snap.ok) {
          await enrichCashboxFriendliesOpponent(snap, user?.id ?? null, code);
        } else {
          (snap as any).startggConnected = isStartGgConnected();
        }
        return snap;
      } catch (e: any) {
        console.error('cashbox:getSnapshot', e);
        return { ok: false as const, reason: 'api' as const, message: e?.message || 'Unknown error' };
      }
    })();

    _snapshotInflight = p;
    try { return await p; } finally { _snapshotInflight = null; }
  });

  ipcMain.handle('cashbox:lookupOpponent', async (_e, opponentCode: unknown) => {
    if (typeof opponentCode !== 'string' || !opponentCode.trim()) {
      return { ok: false as const, message: 'Invalid connect code' };
    }
    try {
      const user = await getCurrentUser();
      let viewerCode = '';
      if (user?.id) {
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('connect_code')
            .eq('id', user.id)
            .maybeSingle();
          viewerCode = typeof profile?.connect_code === 'string' ? profile.connect_code.trim() : '';
        } catch { /* fallback */ }
      }
      if (!viewerCode) {
        const id = getIdentity();
        viewerCode = id?.connectCode?.trim() || '';
      }
      const result = await lookupFriendliesOpponent(opponentCode.trim(), user?.id ?? null, viewerCode);
      return { ok: true as const, friendlies: result };
    } catch (e: any) {
      console.error('cashbox:lookupOpponent', e);
      return { ok: false as const, message: e?.message || 'Unknown error' };
    }
  });

  ipcMain.handle('cashbox:completeModerationTask', async (_e, taskId: unknown) => {
    if (typeof taskId !== 'string' || !/^\d+$/.test(taskId)) {
      return { ok: false as const, message: 'Invalid task id' };
    }
    return completeStartGgModerationTask(taskId);
  });

  ipcMain.handle(
    'cashbox:reportSet',
    async (
      _e,
      setId: unknown,
      winnerId: unknown,
      gameData: unknown,
    ) => {
      if (typeof setId !== 'string') return { ok: false, message: 'Invalid setId' };
      const wId = typeof winnerId === 'number' ? winnerId : null;
      const gd = Array.isArray(gameData) ? gameData : [];
      return reportBracketSet(setId, wId, gd);
    },
  );

  // --- Task-driven set flow (REST) ---

  ipcMain.handle('cashbox:getSetTasks', async (_e, phaseGroupId: unknown, setId: unknown, forceFresh?: unknown) => {
    if (typeof phaseGroupId !== 'string' || typeof setId !== 'string') {
      return { ok: false, message: 'Invalid phaseGroupId or setId' };
    }
    return fetchRawSetTasks(phaseGroupId, setId, !!forceFresh);
  });

  ipcMain.handle('cashbox:getSetUpdatedAt', async (_e, setId: unknown) => {
    if (typeof setId !== 'string') return { ok: false, message: 'Invalid setId' };
    const sggToken = await getStartGgUserToken();
    return fetchSetUpdatedAt(setId, sggToken);
  });

  ipcMain.handle('cashbox:taskComplete', async (_e, taskId: unknown, body: unknown) => {
    if (typeof taskId !== 'string' || !/^\d+$/.test(taskId)) {
      return { ok: false, message: 'Invalid task id' };
    }
    const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
    return completeStartGgTask(taskId, b);
  });

  ipcMain.handle('cashbox:taskUpdate', async (_e, taskId: unknown, body: unknown) => {
    if (typeof taskId !== 'string' || !/^\d+$/.test(taskId)) {
      return { ok: false, message: 'Invalid task id' };
    }
    const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
    return updateStartGgTask(taskId, b);
  });

  // --- Chat ---

  ipcMain.handle('chat:enabled', () => isChatEnabled());

  ipcMain.handle('chat:subscribe', async (_e, room?: string) => {
    const r = room || 'general';
    const enabled = await isChatEnabled();
    if (!enabled) return { ok: false, error: 'Chat is currently disabled' };
    const ok = await subscribeChatRoom(r);
    if (ok) await joinChatPresence(r);
    return { ok };
  });

  ipcMain.handle('chat:unsubscribe', () => unsubscribeChatRoom());

  ipcMain.handle('chat:history', async (_e, opts?: { room?: string; before?: string; limit?: number }) => {
    return getChatHistory(opts?.room, opts?.before, opts?.limit);
  });

  ipcMain.handle('chat:send', async (_e, content: string, room?: string) => {
    return sendChatMessage(content, room);
  });

  ipcMain.handle('chat:delete', async (_e, messageId: string) => {
    return deleteChatMessage(messageId);
  });

  ipcMain.handle('chat:report', async (_e, messageId: string, reason?: string) => {
    return reportChatMessage(messageId, reason);
  });

  ipcMain.handle('chat:isMuted', () => checkMuted());
  ipcMain.handle('chat:isBanned', () => checkChatBanned());

  ipcMain.handle('chat:profile', async (_e, connectCode: string) => {
    return lookupChatProfile(connectCode);
  });

  ipcMain.handle('chat:adminDelete', async (_e, messageId: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };
      const identity = getIdentity();
      const ADMIN_CODES = ['SMOK#1', 'BF#0', 'BURN#0', 'BURN#1'];
      if (!identity?.connectCode || !ADMIN_CODES.includes(identity.connectCode)) {
        return { error: 'Not authorized' };
      }
      const { data, error } = await supabase.rpc('admin_delete_chat_message', { msg_id: messageId });
      if (error) return { error: error.message };
      if (data === false) return { error: 'Message not found or already deleted' };
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('chat:adminMute', async (_e, connectCode: string, durationMinutes?: number) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };
      const identity = getIdentity();
      const ADMIN_CODES = ['SMOK#1', 'BF#0', 'BURN#0', 'BURN#1'];
      if (!identity?.connectCode || !ADMIN_CODES.includes(identity.connectCode)) {
        return { error: 'Not authorized' };
      }
      const { data: target } = await supabase
        .from('profiles')
        .select('id')
        .eq('connect_code', connectCode)
        .single();
      if (!target) return { error: 'User not found' };

      const expires = durationMinutes
        ? new Date(Date.now() + durationMinutes * 60_000).toISOString()
        : null;

      const { error } = await supabase.from('chat_mutes').insert({
        user_id: target.id,
        muted_by: user.id,
        expires_at: expires,
        reason: `Muted by admin ${identity.connectCode}`,
      });
      if (error) return { error: error.message };
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  // --- start.gg OAuth ---

  ipcMain.handle('startgg:connect', async () => {
    try {
      await startStartGgAuth();
      mainWindow?.webContents.send('startgg:authChanged', true);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to start auth' };
    }
  });

  ipcMain.handle('startgg:disconnect', async () => {
    try {
      await disconnectStartGg();
      mainWindow?.webContents.send('startgg:authChanged', false);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Failed to disconnect' };
    }
  });

  ipcMain.handle('startgg:isConnected', () => {
    return {
      connected: isStartGgConnected(),
      ...getStartGgUserInfo(),
    };
  });
}
