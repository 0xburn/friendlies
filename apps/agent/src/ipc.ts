import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';

import { getCurrentUser, isAuthenticated, logout, startAuthFlow } from './auth';
import { getIdentity, verifyIdentity } from './identity';
import { showFriendOnlineNotification } from './notifications';
import { getCurrentStatus, getOnlineUsers, onLocalStatusChange, onPresenceSync } from './presence';
import { getSettings, isSetupComplete, updateSettings, type AgentSettings } from './settings';
import { supabase } from './supabase';
import { checkForUpdates, downloadUpdate, quitAndInstall } from './updater';
import { backfillRecentReplays } from './watcher';

const previousFriendStatuses = new Map<string, string>();

let mainWindow: BrowserWindow | null = null;

export function sendToRenderer(channel: string, ...args: any[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

export function registerIpcHandlers(win: BrowserWindow): void {
  mainWindow = win;

  ipcMain.handle('auth:start', () => startAuthFlow());
  ipcMain.handle('auth:getUser', async () => {
    try { return await getCurrentUser(); } catch { return null; }
  });
  ipcMain.handle('auth:isAuthenticated', async () => {
    try { return await isAuthenticated(); } catch { return false; }
  });
  ipcMain.handle('auth:logout', async () => {
    try { await logout(); sendToRenderer('auth:changed', null); } catch (e) { console.error('auth:logout', e); }
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
      const { data } = await supabase
        .from('slippi_cache')
        .select('*')
        .eq('connect_code', identity.connectCode)
        .single();
      return data;
    } catch { return null; }
  });

  ipcMain.handle('friends:list', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return [];
      const { data } = await supabase
        .from('friends')
        .select('id, friend_id, friend_connect_code, status, created_at, profiles!friends_friend_id_fkey(connect_code, display_name, discord_username, avatar_url)')
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
        return {
          id: f.id,
          friendId: f.friend_id,
          connectCode: code,
          displayName: p?.display_name || c.display_name || null,
          discordUsername: p?.discord_username || null,
          avatarUrl: p?.avatar_url || null,
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
        .select('id, user_id, friend_connect_code, status, created_at, profiles!friends_user_id_fkey(connect_code, display_name, discord_username, avatar_url)')
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
          discordUsername: p?.discord_username || null,
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

      // Check if they already sent us a request — auto-accept if so
      if (target) {
        const { data: existing } = await supabase
          .from('friends')
          .select('id')
          .eq('user_id', target.id)
          .eq('friend_connect_code', (await supabase.from('profiles').select('connect_code').eq('id', user.id).single()).data?.connect_code || '')
          .eq('status', 'pending')
          .single();

        if (existing) {
          // They already requested us — accept it and create our row as accepted
          await supabase
            .from('friends')
            .update({ status: 'accepted', friend_id: user.id })
            .eq('id', existing.id);

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
      await supabase.from('friends').delete().eq('id', friendshipId);
      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
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

  ipcMain.handle('presence:online', () => getOnlineUsers());
  ipcMain.handle('presence:localStatus', () => getCurrentStatus());

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
        .select('user_id, status, current_character, opponent_code, playing_since, updated_at')
        .in('user_id', friendIds);
      if (!data) return {};

      const staleMs = 45_000;
      const now = Date.now();
      const result: Record<string, any> = {};
      const showNotifs = getSettings().showNotifications;
      for (const row of data) {
        const friend = friendRows.find((f: any) => f.friend_id === row.user_id);
        const code = (friend as any)?.profiles?.connect_code || friend?.friend_connect_code;
        if (!code) continue;
        const age = now - new Date(row.updated_at).getTime();
        const isStale = age > staleMs;
        const newStatus = isStale ? 'offline' : row.status;
        result[code] = {
          status: newStatus,
          currentCharacter: isStale ? null : (row as any).current_character ?? null,
          opponentCode: isStale ? null : row.opponent_code,
          playingSince: isStale ? null : row.playing_since,
        };

        const prev = previousFriendStatuses.get(code);
        if (showNotifs && prev && prev === 'offline' && (newStatus === 'online' || newStatus === 'in-game')) {
          showFriendOnlineNotification(code, newStatus);
        }
        previousFriendStatuses.set(code, newStatus);
      }
      return result;
    } catch (e) { console.error('presence:friendStatuses', e); return {}; }
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
        characters: (r?.characters ?? []).filter((c: any) => c?.character != null).map((c: any) => ({ character: c.character, gameCount: c.gameCount })),
      };
    } catch (e: any) { console.error('slippi:lookup', e); return null; }
  });

  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url));
  ipcMain.handle('clipboard:write', (_e, text: string) => { clipboard.writeText(text); });

  ipcMain.handle('updater:check', () => checkForUpdates());
  ipcMain.handle('updater:download', () => downloadUpdate());
  ipcMain.handle('updater:install', () => quitAndInstall());
}
