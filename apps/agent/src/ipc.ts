import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from 'electron';

import { getCurrentUser, handleAuthCallback, isAuthenticated, logout, startAuthFlow, startLocalAuthServer } from './auth';
import { PRESENCE_STALE_THRESHOLD } from './config';
import { getDirectConnectService } from './direct-connect';
import { getIdentity, verifyIdentity } from './identity';
import { resolvePresenceRow } from './presence-logic';
import { getConnectionType, getCurrentStatus, getOnlineUsers, getPresenceStats, getStatusPreset, isLookingToPlay, onLocalStatusChange, onPresenceSync, setHideConnectionType, setStatusPreset, toggleLookingToPlay } from './presence';
import { showTestNotification } from './notifications';
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
        supabase.from('profiles').select('region, top_characters, main_character, secondary_character').eq('connect_code', identity.connectCode).single(),
      ]);
      return {
        ...cache,
        region: profile?.region ?? null,
        top_characters: profile?.top_characters ?? [],
        main_character: profile?.main_character ?? null,
        secondary_character: profile?.secondary_character ?? null,
      };
    } catch { return null; }
  });

  ipcMain.handle('friends:list', async () => {
    const t0 = performance.now();
    try {
      const user = await getCurrentUser();
      if (!user) return [];
      const t1 = performance.now();
      const { data } = await supabase
        .from('friends')
        .select('id, friend_id, friend_connect_code, status, created_at, profiles!friends_friend_id_fkey(connect_code, display_name, discord_username, discord_id, avatar_url, region, hide_region, hide_discord_unless_friends, hide_avatar, main_character, secondary_character, top_characters)')
        .eq('user_id', user.id);
      if (!data) return [];
      const t2 = performance.now();

      const codes = data
        .map((f: any) => (f.profiles as any)?.connect_code || f.friend_connect_code)
        .filter(Boolean);

      let cacheMap: Record<string, any> = {};
      if (codes.length > 0) {
        const { data: cached } = await supabase.from('slippi_cache').select('*').in('connect_code', codes);
        if (cached) cached.forEach((c: any) => { cacheMap[c.connect_code] = c; });
      }
      const t3 = performance.now();

      const result = data.map((f: any) => {
        const p = f.profiles as any;
        const code = p?.connect_code || f.friend_connect_code;
        const c = cacheMap[code] || {};
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
          displayName: p?.display_name || c.display_name || null,
          discordUsername: showDiscord ? (p?.discord_username || null) : null,
          discordId: showDiscord ? (p?.discord_id || null) : null,
          avatarUrl: p?.hide_avatar ? null : (p?.avatar_url || null),
          region: p?.hide_region ? null : (p?.region || null),
          rating: c.rating_ordinal ?? null,
          characterId: c.characters?.[0]?.character ?? null,
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
        .select('id, user_id, friend_connect_code, status, created_at, profiles!friends_user_id_fkey(connect_code, display_name, discord_username, discord_id, avatar_url, hide_discord_unless_friends, hide_avatar)')
        .eq('friend_connect_code', profile.connect_code)
        .eq('status', 'pending');
      if (!rawData) return [];

      const data = rawData.filter((f: any) => {
        const senderCode = (f.profiles as any)?.connect_code;
        return !blockedIds.has(f.user_id) && (!senderCode || !blockedCodes.has(senderCode));
      });

      const codes = data.map((f: any) => (f.profiles as any)?.connect_code).filter(Boolean);
      let cacheMap: Record<string, any> = {};
      if (codes.length > 0) {
        const { data: cached } = await supabase.from('slippi_cache').select('*').in('connect_code', codes);
        if (cached) cached.forEach((c: any) => { cacheMap[c.connect_code] = c; });
      }

      const result = data.map((f: any) => {
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
          avatarUrl: p?.hide_avatar ? null : (p?.avatar_url || null),
          rating: c.rating_ordinal ?? null,
          characterId: c.characters?.[0]?.character ?? null,
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

      const { data: blocked } = await supabase
        .from('blocked_users')
        .select('id')
        .eq('user_id', user.id)
        .eq('blocked_connect_code', connectCode)
        .maybeSingle();
      if (blocked) return { error: 'This user is blocked' };

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
    const t0 = performance.now();
    try {
      const user = await getCurrentUser();
      if (!user) return [];

      const cutoff = new Date(Date.now() - INVITE_COOLDOWN_MS).toISOString();
      const { data } = await supabase
        .from('play_invites')
        .select('id, sender_id, created_at, status, receiver_opened')
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

      const result = data.map((d: any) => ({
        ...d,
        connectCode: profileMap[d.sender_id]?.connect_code,
        displayName: profileMap[d.sender_id]?.display_name,
        discordUsername: profileMap[d.sender_id]?.discord_username,
      }));
      console.log(`[bench] invite:pending total=${(performance.now()-t0).toFixed(0)}ms rows=${data.length}`);
      return result;
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

      return { ok: true };
    } catch (e: any) { return { error: e.message }; }
  });

  ipcMain.handle('invite:sent', async () => {
    const t0 = performance.now();
    try {
      const user = await getCurrentUser();
      if (!user) return [];

      const cutoff = new Date(Date.now() - INVITE_COOLDOWN_MS).toISOString();
      const { data } = await supabase
        .from('play_invites')
        .select('id, receiver_id, created_at, status, sender_opened')
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

      const result = data.map((d: any) => ({
        ...d,
        connectCode: profileMap[d.receiver_id]?.connect_code,
        displayName: profileMap[d.receiver_id]?.display_name,
        discordUsername: profileMap[d.receiver_id]?.discord_username,
      }));
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
      const { count: onlineCount } = await supabase
        .from('presence_log')
        .select('*, profiles!inner(id)', { count: 'exact', head: true })
        .eq('status', 'online');
      const { count: inGameCount } = await supabase
        .from('presence_log')
        .select('*, profiles!inner(id)', { count: 'exact', head: true })
        .eq('status', 'in-game');
      return { online: onlineCount ?? 0, inGame: inGameCount ?? 0 };
    } catch { return { online: 0, inGame: 0 }; }
  });

  ipcMain.handle('presence:online', () => getOnlineUsers());
  ipcMain.handle('presence:localStatus', () => getCurrentStatus());
  ipcMain.handle('presence:connectionType', () => getConnectionType());
  ipcMain.handle('stats:presence', () => getPresenceStats());
  ipcMain.handle('presence:toggleLookingToPlay', () => toggleLookingToPlay());
  ipcMain.handle('presence:isLookingToPlay', () => isLookingToPlay());
  ipcMain.handle('presence:setStatusPreset', (_e, preset: string | null) => setStatusPreset(preset));
  ipcMain.handle('presence:getStatusPreset', () => getStatusPreset());

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
        .select('user_id, status, current_character, opponent_code, playing_since, looking_to_play, looking_to_play_since, status_preset, connection_type, updated_at')
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

  ipcMain.handle('discover:list', async (_e, characterIds?: number[]) => {
    const filterChars = Array.isArray(characterIds) && characterIds.length > 0
      ? new Set(characterIds)
      : null;
    try {
      const user = await getCurrentUser();
      if (!user) return [];

      const [{ data: myProfile }, { data: friendRows }, { data: blockedRows }] = await Promise.all([
        supabase.from('profiles').select('latitude, longitude, region').eq('id', user.id).single(),
        supabase.from('friends').select('friend_id').eq('user_id', user.id),
        supabase.from('blocked_users').select('blocked_user_id, blocked_connect_code').eq('user_id', user.id),
      ]);
      const myLat = myProfile?.latitude ?? null;
      const myLng = myProfile?.longitude ?? null;

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
        .select('user_id, status, current_character, opponent_code, playing_since, looking_to_play, looking_to_play_since, status_preset, connection_type, updated_at')
        .in('status', ['online', 'in-game'])
        .gte('updated_at', cutoff);
      if (!presenceRows || presenceRows.length === 0) return [];

      const candidateIds = presenceRows
        .map((r: any) => r.user_id)
        .filter((id: string) => id !== user.id && !friendIds.has(id) && !blockedIds.has(id));
      if (candidateIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, connect_code, display_name, avatar_url, latitude, longitude, top_characters, main_character, secondary_character, region, hide_region, hide_discord_unless_friends, hide_avatar, hide_connection_type, discord_username, discord_id')
        .in('id', candidateIds);
      if (!profiles) return [];

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

      const myRegion = myProfile?.region as string | null ?? null;
      const myCountry = myRegion?.split(',').pop()?.trim() ?? null;

      let results = presenceRows
        .filter((r: any) => profileMap[r.user_id])
        .map((r: any) => {
          const p = profileMap[r.user_id];
          const c = cacheMap[p.connect_code] || {};
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

          // Boost active players: LFG / status preset users appear ~30% closer
          if (resolved.statusPreset || resolved.lookingToPlay) distance *= 0.7;
          return {
            userId: p.id,
            connectCode: p.connect_code,
            displayName: p.display_name || c.display_name || null,
            discordUsername: p.hide_discord_unless_friends ? null : (p.discord_username || null),
            discordId: p.hide_discord_unless_friends ? null : (p.discord_id || null),
            avatarUrl: p.hide_avatar ? null : (p.avatar_url || null),
            rating: c.rating_ordinal ?? null,
            topCharacters: (() => {
              const slippi: { characterId: number; gameCount: number }[] = Array.isArray(p.top_characters) ? p.top_characters : [];
              const resolved: { characterId: number; gameCount: number }[] = [];
              if (p.main_character != null) resolved.push({ characterId: p.main_character, gameCount: 0 });
              else if (slippi[0]) resolved.push(slippi[0]);
              return resolved;
            })(),
            region: p.hide_region ? null : (p.region || null),
            status: r.status,
            currentCharacter: r.current_character,
            opponentCode: r.opponent_code,
            playingSince: r.playing_since,
            connectionType: p.hide_connection_type ? null : resolved.connectionType,
            updatedAt: r.updated_at,
            lastPlayedAt: matchHistoryMap[p.connect_code] || null,
            lookingToPlay: resolved.lookingToPlay,
            statusPreset: resolved.statusPreset,
            distance,
          };
        });

      const MAX_DISTANCE = 2000;
      results = results.filter((r: any) => r.distance <= MAX_DISTANCE);

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

      return results.slice(0, 50);
    } catch (e) { console.error('discover:list', e); return []; }
  });

  const VALID_NUDGE_MESSAGES = ['GGs', 'one more', 'gtg', 'you play so hot and cool', 'that was sick', "you're cracked", "i'm cracked", "i'm so high", 'check discord', 'hi'];

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
  ipcMain.handle('notifications:test', () => { showTestNotification(); });

  ipcMain.handle('privacy:get', async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return { hideRegion: false, hideDiscordUnlessFriends: false, hideAvatar: false, hideConnectionType: false };
      const { data } = await supabase.from('profiles').select('hide_region, hide_discord_unless_friends, hide_avatar, hide_connection_type').eq('id', user.id).single();
      const hideConn = data?.hide_connection_type ?? false;
      setHideConnectionType(hideConn);
      return {
        hideRegion: data?.hide_region ?? false,
        hideDiscordUnlessFriends: data?.hide_discord_unless_friends ?? false,
        hideAvatar: data?.hide_avatar ?? false,
        hideConnectionType: hideConn,
      };
    } catch { return { hideRegion: false, hideDiscordUnlessFriends: false, hideAvatar: false, hideConnectionType: false }; }
  });

  ipcMain.handle('privacy:update', async (_e, partial: { hideRegion?: boolean; hideDiscordUnlessFriends?: boolean; hideAvatar?: boolean; hideConnectionType?: boolean }) => {
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
      const { error } = await supabase.from('profiles').update(update).eq('id', user.id);
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

  ipcMain.handle('perf:metrics', () => app.getAppMetrics());

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
