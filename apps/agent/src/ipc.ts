import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';

import { getCurrentUser, handleAuthCallback, isAuthenticated, logout, startAuthFlow, startLocalAuthServer } from './auth';
import { PRESENCE_STALE_THRESHOLD } from './config';
import { getDirectConnectService } from './direct-connect';
import { getIdentity, verifyIdentity } from './identity';
import { resolvePresenceRow } from './presence-logic';
import { getCurrentStatus, getOnlineUsers, getPresenceStats, isLookingToPlay, onLocalStatusChange, onPresenceSync, toggleLookingToPlay } from './presence';
import { getSettings, isSetupComplete, updateSettings, type AgentSettings } from './settings';
import { supabase } from './supabase';
import { checkForUpdates, downloadUpdate, quitAndInstall } from './updater';
import { backfillRecentReplays } from './watcher';

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

  ipcMain.handle('auth:start', async () => {
    if (process.platform === 'linux') {
      const authDone = startLocalAuthServer();
      const url = await startAuthFlow();
      authDone.then(async () => {
        const user = await getCurrentUser();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth:changed', user);
        }
      }).catch((err) => console.error('[auth] Linux local auth failed:', err));
      return url;
    }
    return startAuthFlow();
  });
  ipcMain.handle('auth:callback', async (_e, url: string) => {
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
      const [{ data: cache }, { data: profile }] = await Promise.all([
        supabase.from('slippi_cache').select('*').eq('connect_code', identity.connectCode).single(),
        supabase.from('profiles').select('region').eq('connect_code', identity.connectCode).single(),
      ]);
      return { ...cache, region: profile?.region ?? null };
    } catch { return null; }
  });

  ipcMain.handle('friends:list', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return [];
      const { data } = await supabase
        .from('friends')
        .select('id, friend_id, friend_connect_code, status, created_at, profiles!friends_friend_id_fkey(connect_code, display_name, discord_username, discord_id, avatar_url, region, hide_region, hide_discord_unless_friends)')
        .eq('user_id', user.id);
      if (!data) return [];

      const codes = data
        .map((f: any) => (f.profiles as any)?.connect_code || f.friend_connect_code)
        .filter(Boolean);

      let cacheMap: Record<string, any> = {};
      if (codes.length > 0) {
        const { data: cached } = await supabase.from('slippi_cache').select('*').in('connect_code', codes);
        if (cached) cached.forEach((c: any) => { cacheMap[c.connect_code] = c; });
      }

      return data.map((f: any) => {
        const p = f.profiles as any;
        const code = p?.connect_code || f.friend_connect_code;
        const c = cacheMap[code] || {};
        const isAccepted = f.status === 'accepted';
        const showDiscord = isAccepted || !p?.hide_discord_unless_friends;
        return {
          id: f.id,
          friendId: f.friend_id,
          connectCode: code,
          displayName: p?.display_name || c.display_name || null,
          discordUsername: showDiscord ? (p?.discord_username || null) : null,
          discordId: showDiscord ? (p?.discord_id || null) : null,
          avatarUrl: p?.avatar_url || null,
          region: p?.hide_region ? null : (p?.region || null),
          rating: c.rating_ordinal ?? null,
          characterId: c.characters?.[0]?.character ?? null,
          onApp: !!f.friend_id,
          friendStatus: f.status || 'pending',
        };
      });
    } catch (e) { console.error('friends:list', e); return []; }
  });

  ipcMain.handle('friends:incoming', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return [];
      const { data: profile } = await supabase
        .from('profiles')
        .select('connect_code')
        .eq('id', user.id)
        .single();
      if (!profile?.connect_code) return [];

      const { data } = await supabase
        .from('friends')
        .select('id, user_id, friend_connect_code, status, created_at, profiles!friends_user_id_fkey(connect_code, display_name, discord_username, discord_id, avatar_url, hide_discord_unless_friends)')
        .eq('friend_connect_code', profile.connect_code)
        .eq('status', 'pending');
      if (!data) return [];

      const codes = data.map((f: any) => (f.profiles as any)?.connect_code).filter(Boolean);
      let cacheMap: Record<string, any> = {};
      if (codes.length > 0) {
        const { data: cached } = await supabase.from('slippi_cache').select('*').in('connect_code', codes);
        if (cached) cached.forEach((c: any) => { cacheMap[c.connect_code] = c; });
      }

      return data.map((f: any) => {
        const p = f.profiles as any;
        const code = p?.connect_code || '';
        const c = cacheMap[code] || {};
        return {
          id: f.id,
          fromUserId: f.user_id,
          connectCode: code,
          displayName: p?.display_name || c.display_name || null,
          discordUsername: p?.hide_discord_unless_friends ? null : (p?.discord_username || null),
          discordId: p?.hide_discord_unless_friends ? null : (p?.discord_id || null),
          avatarUrl: p?.avatar_url || null,
          rating: c.rating_ordinal ?? null,
          characterId: c.characters?.[0]?.character ?? null,
        };
      });
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

  ipcMain.handle('friends:add', async (_e, connectCode: string) => {
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

      const { data: target } = await supabase
        .from('profiles')
        .select('id, connect_code')
        .eq('connect_code', connectCode)
        .single();

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

  const INVITE_COOLDOWN_MS = 5 * 60 * 1000;

  async function logEvent(userId: string, eventType: string, metadata: Record<string, any> = {}) {
    try {
      await supabase.from('event_log').insert({ user_id: userId, event_type: eventType, metadata });
    } catch (e: any) {
      console.warn('[event_log] Failed to log event:', eventType, e.message);
    }
  }

  ipcMain.handle('invite:send', async (_e, friendConnectCode: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };

      const { data: target } = await supabase
        .from('profiles')
        .select('id, connect_code')
        .eq('connect_code', friendConnectCode)
        .single();
      if (!target) return { error: 'Friend not found on app' };

      const cutoff = new Date(Date.now() - INVITE_COOLDOWN_MS).toISOString();

      // Only allow one active invite at a time (sent or received)
      const { data: activeSent } = await supabase
        .from('play_invites')
        .select('id')
        .eq('sender_id', user.id)
        .gte('created_at', cutoff)
        .limit(1);
      if (activeSent && activeSent.length > 0) {
        return { error: 'You already have an active invite' };
      }

      const { data: activeReceived } = await supabase
        .from('play_invites')
        .select('id')
        .eq('receiver_id', user.id)
        .gte('created_at', cutoff)
        .limit(1);
      if (activeReceived && activeReceived.length > 0) {
        return { error: 'You already have an active invite' };
      }

      const { error } = await supabase
        .from('play_invites')
        .upsert({
          sender_id: user.id,
          receiver_id: target.id,
          created_at: new Date().toISOString(),
          status: 'pending',
        }, { onConflict: 'sender_id,receiver_id' });

      if (error) return { error: error.message };
      await logEvent(user.id, 'invite_sent', { receiver_code: friendConnectCode });
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('invite:pending', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return [];

      const cutoff = new Date(Date.now() - INVITE_COOLDOWN_MS).toISOString();
      const { data } = await supabase
        .from('play_invites')
        .select('id, sender_id, created_at, status')
        .eq('receiver_id', user.id)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false });
      if (!data || data.length === 0) return [];

      const senderIds = data.map((d: any) => d.sender_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, connect_code, display_name, discord_username')
        .in('id', senderIds);
      const profileMap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });

      return data.map((d: any) => ({
        ...d,
        connectCode: profileMap[d.sender_id]?.connect_code,
        displayName: profileMap[d.sender_id]?.display_name,
        discordUsername: profileMap[d.sender_id]?.discord_username,
      }));
    } catch { return []; }
  });

  ipcMain.handle('invite:dismiss', async (_e, inviteId: string) => {
    try {
      await supabase.from('play_invites').delete().eq('id', inviteId);
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

      await supabase.from('play_invites').delete().eq('id', inviteId);
      await logEvent(user.id, 'invite_opened_melee', { invite_id: inviteId });
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('invite:sent', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return [];

      const cutoff = new Date(Date.now() - INVITE_COOLDOWN_MS).toISOString();
      const { data } = await supabase
        .from('play_invites')
        .select('id, receiver_id, created_at, status')
        .eq('sender_id', user.id)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false });
      if (!data || data.length === 0) return [];

      const receiverIds = data.map((d: any) => d.receiver_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, connect_code, display_name, discord_username')
        .in('id', receiverIds);
      const profileMap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });

      return data.map((d: any) => ({
        ...d,
        connectCode: profileMap[d.receiver_id]?.connect_code,
        displayName: profileMap[d.receiver_id]?.display_name,
        discordUsername: profileMap[d.receiver_id]?.discord_username,
      }));
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

  ipcMain.handle('presence:online', () => getOnlineUsers());
  ipcMain.handle('presence:localStatus', () => getCurrentStatus());
  ipcMain.handle('stats:presence', () => getPresenceStats());
  ipcMain.handle('presence:toggleLookingToPlay', () => toggleLookingToPlay());
  ipcMain.handle('presence:isLookingToPlay', () => isLookingToPlay());

  ipcMain.handle('presence:friendStatuses', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return {};

      const { data: friendRows } = await supabase.from('friends')
        .select('friend_id, friend_connect_code, profiles!friends_friend_id_fkey(connect_code)')
        .eq('user_id', user.id)
        .eq('status', 'accepted');
      if (!friendRows || friendRows.length === 0) return {};

      const friendIds = friendRows.map((f: any) => f.friend_id).filter(Boolean);
      if (friendIds.length === 0) return {};

      const { data } = await supabase.from('presence_log')
        .select('user_id, status, current_character, opponent_code, playing_since, looking_to_play, looking_to_play_since, updated_at')
        .in('user_id', friendIds);
      if (!data) return {};

      const now = Date.now();
      const result: Record<string, any> = {};
      for (const row of data) {
        const friend = friendRows.find((f: any) => f.friend_id === row.user_id);
        const code = (friend as any)?.profiles?.connect_code || friend?.friend_connect_code;
        if (!code) continue;
        result[code] = resolvePresenceRow(row as any, PRESENCE_STALE_THRESHOLD, now);
      }
      return result;
    } catch (e) { console.error('presence:friendStatuses', e); return {}; }
  });

  ipcMain.handle('discover:list', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return [];

      const { data: myProfile } = await supabase
        .from('profiles')
        .select('latitude, longitude')
        .eq('id', user.id)
        .single();
      const myLat = myProfile?.latitude ?? null;
      const myLng = myProfile?.longitude ?? null;

      const { data: friendRows } = await supabase
        .from('friends')
        .select('friend_id')
        .eq('user_id', user.id);
      const friendIds = new Set(
        (friendRows || []).map((f: any) => f.friend_id).filter(Boolean),
      );

      const cutoff = new Date(Date.now() - PRESENCE_STALE_THRESHOLD).toISOString();
      const { data: presenceRows } = await supabase
        .from('presence_log')
        .select('user_id, status, current_character, opponent_code, playing_since, updated_at')
        .in('status', ['online', 'in-game'])
        .gte('updated_at', cutoff);
      if (!presenceRows || presenceRows.length === 0) return [];

      const candidateIds = presenceRows
        .map((r: any) => r.user_id)
        .filter((id: string) => id !== user.id && !friendIds.has(id));
      if (candidateIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, connect_code, display_name, avatar_url, latitude, longitude, top_characters, region, hide_region, hide_discord_unless_friends, discord_username, discord_id')
        .in('id', candidateIds);
      if (!profiles) return [];
      const profileMap: Record<string, any> = {};
      profiles.forEach((p: any) => { profileMap[p.id] = p; });

      const codes = profiles.map((p: any) => p.connect_code).filter(Boolean);
      let cacheMap: Record<string, any> = {};
      if (codes.length > 0) {
        const { data: cached } = await supabase.from('slippi_cache').select('*').in('connect_code', codes);
        if (cached) cached.forEach((c: any) => { cacheMap[c.connect_code] = c; });
      }

      const matchHistoryMap: Record<string, string> = {};
      if (codes.length > 0) {
        const { data: matchRows } = await supabase
          .from('matches')
          .select('opponent_connect_code, played_at')
          .eq('user_id', user.id)
          .in('opponent_connect_code', codes)
          .order('played_at', { ascending: false });
        if (matchRows) {
          for (const m of matchRows as any[]) {
            if (!matchHistoryMap[m.opponent_connect_code]) {
              matchHistoryMap[m.opponent_connect_code] = m.played_at;
            }
          }
        }
      }

      const results = presenceRows
        .filter((r: any) => profileMap[r.user_id])
        .map((r: any) => {
          const p = profileMap[r.user_id];
          const c = cacheMap[p.connect_code] || {};
          const NO_GEO_PENALTY = 9999;
          let distance = NO_GEO_PENALTY;
          if (myLat != null && myLng != null && p.latitude != null && p.longitude != null) {
            const cosLat = Math.cos((myLat * Math.PI) / 180);
            distance = Math.pow(p.latitude - myLat, 2) + Math.pow((p.longitude - myLng) * cosLat, 2);
          }
          return {
            userId: p.id,
            connectCode: p.connect_code,
            displayName: p.display_name || c.display_name || null,
            discordUsername: p.hide_discord_unless_friends ? null : (p.discord_username || null),
            discordId: p.hide_discord_unless_friends ? null : (p.discord_id || null),
            avatarUrl: p.avatar_url || null,
            rating: c.rating_ordinal ?? null,
            topCharacters: Array.isArray(p.top_characters) ? p.top_characters : [],
            region: p.hide_region ? null : (p.region || null),
            status: r.status,
            currentCharacter: r.current_character,
            opponentCode: r.opponent_code,
            playingSince: r.playing_since,
            updatedAt: r.updated_at,
            lastPlayedAt: matchHistoryMap[p.connect_code] || null,
            distance,
          };
        });

      results.sort((a: any, b: any) => {
        const hasHistoryA = a.lastPlayedAt ? 1 : 0;
        const hasHistoryB = b.lastPlayedAt ? 1 : 0;
        if (hasHistoryA !== hasHistoryB) return hasHistoryB - hasHistoryA;
        const statusOrder = (s: string) => s === 'in-game' ? 0 : 1;
        const sd = statusOrder(a.status) - statusOrder(b.status);
        if (sd !== 0) return sd;
        if (a.distance !== b.distance) return a.distance - b.distance;
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      });

      return results.slice(0, 10);
    } catch (e) { console.error('discover:list', e); return []; }
  });

  onPresenceSync((users) => { sendToRenderer('presence:updated', users); });
  onLocalStatusChange((info) => { sendToRenderer('presence:localStatus', info); });

  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:update', (_e, partial: Partial<AgentSettings>) => {
    return updateSettings(partial);
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

  ipcMain.handle('privacy:get', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return { hideRegion: false, hideDiscordUnlessFriends: false };
      const { data } = await supabase.from('profiles').select('hide_region, hide_discord_unless_friends').eq('id', user.id).single();
      return {
        hideRegion: data?.hide_region ?? false,
        hideDiscordUnlessFriends: data?.hide_discord_unless_friends ?? false,
      };
    } catch { return { hideRegion: false, hideDiscordUnlessFriends: false }; }
  });

  ipcMain.handle('privacy:update', async (_e, partial: { hideRegion?: boolean; hideDiscordUnlessFriends?: boolean }) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { error: 'Not authenticated' };
      const update: Record<string, any> = {};
      if (partial.hideRegion !== undefined) update.hide_region = partial.hideRegion;
      if (partial.hideDiscordUnlessFriends !== undefined) update.hide_discord_unless_friends = partial.hideDiscordUnlessFriends;
      const { error } = await supabase.from('profiles').update(update).eq('id', user.id);
      if (error) return { error: error.message };
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('auth:checkBlacklist', async () => {
    try {
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
      const res = await fetch('https://internal.slippi.gg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationName: 'UserProfilePageQuery',
          variables: { cc: connectCode, uid: connectCode },
          query,
        }),
      });
      if (!res.ok) return null;
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { return null; }
      const user = data?.data?.getUser;
      if (!user?.fbUid) return null;
      const r = user.rankedNetplayProfile;
      return {
        displayName: user.displayName || '',
        connectCode: user.connectCode?.code || connectCode,
        rankedRating: r?.ratingOrdinal ?? null,
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

  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url));

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

  ipcMain.handle('updater:check', () => checkForUpdates());
  ipcMain.handle('updater:download', () => downloadUpdate());
  ipcMain.handle('updater:install', () => quitAndInstall());

  ipcMain.handle('directConnect:start', async (_e, connectCode: string) => {
    try {
      const service = getDirectConnectService();
      if (service.isActive()) return { error: 'Direct connect already in progress' };

      service.removeAllListeners('status');
      service.on('status', (evt) => sendToRenderer('directConnect:status', evt));

      await service.start(connectCode);
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
}
