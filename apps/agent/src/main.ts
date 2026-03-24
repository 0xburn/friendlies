import * as path from 'path';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import {
  getCurrentUser, handleAuthCallback, isAuthenticated,
  listenForTokenRefresh, logout, restoreSession, startAuthFlow,
} from './auth';
import { APP_PROTOCOL, PRESENCE_STALE_THRESHOLD } from './config';
import { getIdentity, verifyIdentity, type SlippiIdentity } from './identity';
import { registerIpcHandlers, sendToRenderer } from './ipc';
import { showFriendOnlineNotification, showFriendRequestNotification, showOpponentNotification, showPlayInviteNotification } from './notifications';
import { supabase } from './supabase';
import {
  getCurrentStatus, pushOfflineAndStop, setLastOpponent, startPresenceLoop, stopPresenceLoop, updatePresenceReplayDir,
} from './presence';
import { getSettings, isSetupComplete, updateSettings } from './settings';
import {
  addRecentOpponent, createTray, destroyTray, updateTrayStatus,
} from './tray';
import { checkForUpdates, initAutoUpdater } from './updater';
import { setIdentityMismatchHandler, startWatcher, stopWatcher } from './watcher';

let mainWindow: BrowserWindow | null = null;
let friendPollTimer: ReturnType<typeof setInterval> | null = null;
let serviceStartedAt: string | null = null;
let firstPollDone = false;
let refreshLock = false;
let activeServiceKey: string | null = null;
const previousFriendStatuses = new Map<string, string>();
const knownIncomingRequestIds = new Set<string>();
const knownPlayInviteIds = new Set<string>();

function parseDotEnvContent(content: string): void {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function loadDotEnvFromAppDir(): void {
  try {
    const fs = require('fs') as typeof import('fs');
    for (const root of [app.getAppPath(), path.join(__dirname, '..')]) {
      const p = path.join(root, '.env');
      if (fs.existsSync(p)) { parseDotEnvContent(fs.readFileSync(p, 'utf8')); break; }
    }
  } catch (e) { console.error('loadDotEnvFromAppDir', e); }
}

function findProtocolUrl(argv: string[]): string | null {
  return argv.find((a) => a.startsWith(`${APP_PROTOCOL}://`)) ?? null;
}

function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, 'preload.js');
  const win = new BrowserWindow({
    width: 940,
    height: 680,
    minWidth: 780,
    minHeight: 520,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    win.loadURL('http://localhost:5173');
  } else {
    const rendererPath = path.join(__dirname, 'renderer', 'index.html');
    win.loadFile(rendererPath);
  }

  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    if (process.platform === 'darwin' && !(app as any).isQuitting) {
      e.preventDefault();
      win.hide();
    } else {
      (app as any).isQuitting = true;
    }
  });

  return win;
}

async function stopAgentServices(): Promise<void> {
  if (friendPollTimer) { clearInterval(friendPollTimer); friendPollTimer = null; }
  serviceStartedAt = null;
  firstPollDone = false;
  activeServiceKey = null;
  previousFriendStatuses.clear();
  knownIncomingRequestIds.clear();
  knownPlayInviteIds.clear();
  try { await stopPresenceLoop(); } catch (e) { console.error('stopPresenceLoop', e); }
  stopWatcher();
}

async function pollAllNotifications(userId: string): Promise<void> {
  const suppressNotifs = !firstPollDone;
  await Promise.all([
    pollFriendOnlineStatuses(userId, suppressNotifs),
    pollIncomingFriendRequests(userId, suppressNotifs),
    pollPlayInvites(userId),
  ]);
  firstPollDone = true;
}

async function pollFriendOnlineStatuses(userId: string, suppressNotifs = false): Promise<void> {
  try {
    const st = getSettings();
    if (!st.showNotifications || !st.notifyFriendOnline) return;
    const { data: friendRows } = await supabase.from('friends')
      .select('friend_id, friend_connect_code, profiles!friends_friend_id_fkey(connect_code)')
      .eq('user_id', userId)
      .eq('status', 'accepted');
    if (!friendRows?.length) return;

    const friendIds = friendRows.map((f: any) => f.friend_id).filter(Boolean);
    if (!friendIds.length) return;

    const { data } = await supabase.from('presence_log')
      .select('user_id, status, updated_at')
      .in('user_id', friendIds);
    if (!data) return;

    const staleMs = PRESENCE_STALE_THRESHOLD;
    const now = Date.now();
    for (const row of data) {
      const friend = friendRows.find((f: any) => f.friend_id === row.user_id);
      const code = (friend as any)?.profiles?.connect_code || friend?.friend_connect_code;
      if (!code) continue;
      const age = now - new Date(row.updated_at).getTime();
      const newStatus = age > staleMs ? 'offline' : row.status;
      const prev = previousFriendStatuses.get(code);
      if (!suppressNotifs && prev && prev === 'offline' && newStatus !== 'offline') {
        showFriendOnlineNotification(code, newStatus);
      }
      previousFriendStatuses.set(code, newStatus);
    }
  } catch (e) { console.error('[main] friend status poll failed', e); }
}

async function pollIncomingFriendRequests(userId: string, suppressNotifs = false): Promise<void> {
  try {
    if (!getSettings().showNotifications) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('connect_code')
      .eq('id', userId)
      .single();
    if (!profile?.connect_code) return;

    const { data: incoming } = await supabase
      .from('friends')
      .select('id, profiles!friends_user_id_fkey(connect_code)')
      .eq('friend_connect_code', profile.connect_code)
      .eq('status', 'pending');
    if (!incoming) return;

    for (const req of incoming) {
      if (knownIncomingRequestIds.has(req.id)) continue;
      knownIncomingRequestIds.add(req.id);
      if (suppressNotifs) continue;
      const fromCode = (req as any).profiles?.connect_code;
      if (!fromCode) continue;
      showFriendRequestNotification(fromCode, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
    }
  } catch (e) { console.error('[main] incoming request poll failed', e); }
}

async function pollPlayInvites(userId: string): Promise<void> {
  try {
    const st = getSettings();
    if (!st.showNotifications || !st.notifyPlayInvite) return;

    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: invites } = await supabase
      .from('play_invites')
      .select('id, sender_id, created_at')
      .eq('receiver_id', userId)
      .gte('created_at', cutoff);
    if (!invites || invites.length === 0) return;

    const newInvites = invites.filter((inv) => !knownPlayInviteIds.has(inv.id));
    if (newInvites.length === 0) return;

    const senderIds = newInvites.map((inv) => inv.sender_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, connect_code')
      .in('id', senderIds);
    const profileMap: Record<string, string> = {};
    (profiles || []).forEach((p: any) => { profileMap[p.id] = p.connect_code; });

    for (const inv of newInvites) {
      knownPlayInviteIds.add(inv.id);
      const fromCode = profileMap[inv.sender_id];
      if (!fromCode) continue;
      if (serviceStartedAt && inv.created_at < serviceStartedAt) continue;
      showPlayInviteNotification(fromCode, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
    }
  } catch (e) { console.error('[main] play invite poll failed', e); }
}

async function startAgentServices(identity: SlippiIdentity, userId: string): Promise<void> {
  const key = `${userId}:${identity.connectCode}`;
  if (activeServiceKey === key) {
    console.log('[main] services already running for', identity.connectCode, '— skipping restart');
    return;
  }
  await stopAgentServices();
  activeServiceKey = key;
  serviceStartedAt = new Date().toISOString();
  const st = getSettings();

  setIdentityMismatchHandler(async (mismatch) => {
    console.warn('[main] Identity mismatch — stopping services and notifying renderer');
    await stopAgentServices();
    sendToRenderer('identity:mismatch', mismatch);
  });

  startWatcher(st.replayDir, identity.connectCode, (info) => {
    try {
      addRecentOpponent(info.connectCode, info.displayName);
      setLastOpponent(info.connectCode, info.characterId);
      sendToRenderer('opponent:new', info);
      if (getSettings().showNotifications) {
        showOpponentNotification(info.connectCode, info.displayName, info.characterId);
      }
      updateTrayStatus(getCurrentStatus());
    } catch (e) { console.error('opponent callback', e); }
  });
  await startPresenceLoop(identity.connectCode, identity.displayName || identity.connectCode, userId, st.replayDir);

  if (friendPollTimer) clearInterval(friendPollTimer);
  friendPollTimer = setInterval(() => void pollAllNotifications(userId), 30_000);
  void pollAllNotifications(userId);
}

async function refreshAgentState(): Promise<void> {
  if (refreshLock) return;
  refreshLock = true;
  try {
    const authed = await isAuthenticated();
    const user = await getCurrentUser();
    const identity = getIdentity();
    if (authed && identity && user) {
      // Ensure profile has connect_code + slippi_uid synced (with claim check)
      const { data: existingClaim } = await supabase.from('profiles')
        .select('id, verified')
        .eq('connect_code', identity.connectCode)
        .neq('id', user.id)
        .maybeSingle();

      if (existingClaim?.verified) {
        console.warn(`[main] connect code ${identity.connectCode} is already claimed by another verified user`);
        await stopAgentServices();
        sendToRenderer('identity:codeClaimed', { connectCode: identity.connectCode });
        updateTrayStatus(getCurrentStatus());
        return;
      }

      const appVersion = app.getVersion();
      const meta = user.user_metadata || {};
      const profileUpdate: Record<string, any> = {
        connect_code: identity.connectCode,
        slippi_uid: identity.uid,
        display_name: identity.displayName || null,
        discord_username: meta.full_name || meta.name || null,
        discord_id: meta.provider_id || null,
        avatar_url: meta.avatar_url || null,
        verified: true,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        app_version: appVersion,
      };

      try {
        const geoRes = await fetch('http://ip-api.com/json/?fields=lat,lon,regionName,country');
        if (geoRes.ok) {
          const geo = await geoRes.json();
          if (typeof geo.lat === 'number' && typeof geo.lon === 'number') {
            profileUpdate.latitude = geo.lat;
            profileUpdate.longitude = geo.lon;
            profileUpdate.region = [geo.regionName, geo.country].filter(Boolean).join(', ') || null;
          }
        }
      } catch (e) { console.warn('[main] geolocation lookup failed:', e); }

      const { error: syncErr } = await supabase.from('profiles').update(profileUpdate).eq('id', user.id);
      if (syncErr) console.error('[main] profile sync failed:', syncErr.message);
      else console.log('[main] profile synced:', identity.connectCode);

      await startAgentServices(identity, user.id);
    } else {
      await stopAgentServices();
    }
    updateTrayStatus(getCurrentStatus());
  } catch (e) { console.error('refreshAgentState', e); } finally { refreshLock = false; }
}

async function handleDeepLink(url: string): Promise<void> {
  try {
    if (!url.includes('auth-callback')) return;
    await handleAuthCallback(url);
    const user = await getCurrentUser();
    sendToRenderer('auth:changed', user);
    await refreshAgentState();
  } catch (e) { console.error('handleDeepLink', e); }
}

// --- App lifecycle ---

(app as any).isQuitting = false;

if (process.platform === 'win32') {
  app.setAppUserModelId('com.friendlies.agent');
}

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

if (!isDev && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = findProtocolUrl(argv);
    if (url) void handleDeepLink(url);
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
  });
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(APP_PROTOCOL);
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  void handleDeepLink(url);
});

app.on('before-quit', async (e) => {
  if (!(app as any).isQuitting) {
    e.preventDefault();
    (app as any).isQuitting = true;
    try {
      await pushOfflineAndStop();
    } catch (err) { console.error('before-quit cleanup failed', err); }
    destroyTray();
    app.quit();
  }
});

app.whenReady().then(async () => {
  try {
    loadDotEnvFromAppDir();
    const st0 = getSettings();
    app.setLoginItemSettings({ openAtLogin: st0.autoLaunch, openAsHidden: true });

    listenForTokenRefresh();
    await restoreSession();

    mainWindow = createMainWindow();
    registerIpcHandlers(mainWindow, { onLogout: stopAgentServices });

    ipcMain.handle('agent:refresh', async () => {
      await refreshAgentState();
      return { ok: true };
    });

    if (!isDev) {
      initAutoUpdater(mainWindow);
      checkForUpdates();
      setInterval(checkForUpdates, 10 * 60 * 1000);
      let lastFocusCheck = 0;
      mainWindow.on('focus', () => {
        const now = Date.now();
        if (now - lastFocusCheck > 5 * 60 * 1000) {
          lastFocusCheck = now;
          checkForUpdates();
        }
      });
    }

    createTray(getCurrentStatus, {
      onShowWindow: () => { mainWindow?.show(); mainWindow?.focus(); },
      onQuit: () => { (app as any).isQuitting = true; app.quit(); },
    });

    if (isSetupComplete()) {
      await refreshAgentState();
    }

    setInterval(() => {
      try { updateTrayStatus(getCurrentStatus()); } catch {}
    }, 5000);
  } catch (e) { console.error('app.whenReady', e); }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    (app as any).isQuitting = true;
    app.quit();
  }
});
