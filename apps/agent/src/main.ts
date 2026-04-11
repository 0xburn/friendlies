import * as path from 'path';
import { BrowserWindow, app, ipcMain, screen, shell } from 'electron';
import {
  getCurrentUser, handleAuthCallback, isAuthenticated,
  listenForTokenRefresh, logout, restoreSession, startAuthFlow,
} from './auth';
import { handleStartGgCallback, isStartGgConnected } from './startgg-auth';
import { APP_PROTOCOL, PRESENCE_STALE_THRESHOLD } from './config';
import { getIdentity, verifyIdentity, type SlippiIdentity } from './identity';
import { registerIpcHandlers, sendToRenderer } from './ipc';
import { showFriendOnlineNotification, showFriendRequestNotification, showNudgeNotification, showPlayInviteNotification } from './notifications';
import { supabase } from './supabase';
import {
  getCurrentStatus, onGameActiveChange, pushOfflineAndStop, setGameThrottling, setLastOpponent, setMainWindowFocused, startPresenceLoop, stopPresenceLoop, updatePresenceReplayDir,
} from './presence';
import { getSettings, getWindowBounds, isSetupComplete, saveWindowBounds, updateSettings } from './settings';
import {
  addRecentOpponent, createTray, destroyTray, updateTrayStatus,
} from './tray';
import { checkForUpdates, initAutoUpdater } from './updater';
import { setIdentityMismatchHandler, setWatcherGameActive, startWatcher, stopWatcher } from './watcher';
import { setCachedGeo } from './geo-cache';

let mainWindow: BrowserWindow | null = null;
let friendPollTimer: ReturnType<typeof setInterval> | null = null;
let serviceStartedAt: string | null = null;
let firstPollDone = false;
let refreshLock = false;
let activeServiceKey: string | null = null;
let unsubGameActive: (() => void) | null = null;
let gameIsActive = false;
const previousFriendStatuses = new Map<string, string>();
const knownIncomingRequestIds = new Set<string>();
const knownPlayInviteIds = new Set<string>();
const knownNudgeIds = new Set<string>();
let unreadNudgeCount = 0;

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
    const paths: string[] = [];
    if (app.isPackaged) {
      paths.push(path.join(process.resourcesPath, '.env'));
    }
    paths.push(path.join(app.getAppPath(), '.env'));
    paths.push(path.join(__dirname, '..', '.env'));
    for (const envPath of paths) {
      if (fs.existsSync(envPath)) {
        parseDotEnvContent(fs.readFileSync(envPath, 'utf8'));
      }
    }
  } catch (e) { console.error('loadDotEnvFromAppDir', e); }
}

async function fetchGeoWithFallback(): Promise<{ lat: number; lon: number; region: string } | null> {
  const timeout = (ms: number) => new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

  type GeoResult = { lat: number; lon: number; region: string };
  const results: GeoResult[] = [];

  const providers: Array<{ name: string; url: string; parse: (d: any) => GeoResult | null }> = [
    {
      name: 'ip-api.com',
      url: 'http://ip-api.com/json/?fields=status,lat,lon,regionName,country',
      parse: (d) => d.status === 'success' && typeof d.lat === 'number'
        ? { lat: d.lat, lon: d.lon, region: [d.regionName, d.country].filter(Boolean).join(', ') }
        : null,
    },
    {
      name: 'ipwho.is',
      url: 'https://ipwho.is/',
      parse: (d) => d.success !== false && typeof d.latitude === 'number'
        ? { lat: d.latitude, lon: d.longitude, region: [d.region, d.country].filter(Boolean).join(', ') }
        : null,
    },
    {
      name: 'freeipapi.com',
      url: 'https://freeipapi.com/api/json',
      parse: (d) => typeof d.latitude === 'number'
        ? { lat: d.latitude, lon: d.longitude, region: [d.regionName, d.countryName].filter(Boolean).join(', ') }
        : null,
    },
  ];

  await Promise.allSettled(providers.map(async (p) => {
    try {
      const res = await Promise.race([fetch(p.url), timeout(4000)]);
      if (!res.ok) return;
      const parsed = p.parse(await res.json());
      if (parsed) results.push(parsed);
    } catch { /* provider failed */ }
  }));

  if (results.length === 0) {
    console.warn('[main] all geolocation services failed');
    return null;
  }

  if (results.length === 1) return results[0];

  // Use median lat/lon from all successful providers for best accuracy
  const sorted = (arr: number[]) => [...arr].sort((a, b) => a - b);
  const median = (arr: number[]) => { const s = sorted(arr); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return {
    lat: median(results.map((r) => r.lat)),
    lon: median(results.map((r) => r.lon)),
    region: results[0].region,
  };
}

function findProtocolUrl(argv: string[]): string | null {
  return argv.find((a) => a.startsWith(`${APP_PROTOCOL}://`)) ?? null;
}

function savedBoundsAreVisible(bounds: { x: number; y: number; width: number; height: number }): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((d) => {
    const { x, y, width, height } = d.workArea;
    return bounds.x + bounds.width > x && bounds.x < x + width
      && bounds.y + bounds.height > y && bounds.y < y + height;
  });
}

function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, 'preload.js');

  const saved = getWindowBounds();
  const useSaved = saved && savedBoundsAreVisible(saved);

  const win = new BrowserWindow({
    width: useSaved ? saved!.width : 940,
    height: useSaved ? saved!.height : 680,
    ...(useSaved ? { x: saved!.x, y: saved!.y } : {}),
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
      webviewTag: true,
      backgroundThrottling: true,
    },
  });

  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const persistBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => { saveWindowBounds(win.getBounds()); }, 500);
  };
  win.on('resize', persistBounds);
  win.on('move', persistBounds);

  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    win.loadURL('http://localhost:5173');
  } else {
    const rendererPath = path.join(__dirname, 'renderer', 'index.html');
    win.loadFile(rendererPath);
  }

  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    saveWindowBounds(win.getBounds());
    if (!(app as any).isQuitting && getSettings().closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

async function stopAgentServices(): Promise<void> {
  if (unsubGameActive) { unsubGameActive(); unsubGameActive = null; }
  if (friendPollTimer) { clearInterval(friendPollTimer); friendPollTimer = null; }
  serviceStartedAt = null;
  firstPollDone = false;
  activeServiceKey = null;
  previousFriendStatuses.clear();
  knownIncomingRequestIds.clear();
  knownPlayInviteIds.clear();
  knownNudgeIds.clear();
  unreadNudgeCount = 0;
  try { await stopPresenceLoop(); } catch (e) { console.error('stopPresenceLoop', e); }
  stopWatcher();
}

let pollInFlight = false;

async function pollAllNotifications(userId: string): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const t0 = performance.now();
    const suppressNotifs = !firstPollDone;
    await Promise.all([
      pollFriendOnlineStatuses(userId, suppressNotifs),
      pollIncomingFriendRequests(userId, suppressNotifs),
      pollPlayInvites(userId),
      pollNudges(userId, suppressNotifs),
    ]);
    firstPollDone = true;
    const ms = performance.now() - t0;
    if (ms > 200) console.log(`[perf] pollAllNotifications took ${ms.toFixed(0)}ms`);
  } finally {
    pollInFlight = false;
    updateTrayStatus();
  }
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

    const [{ data: profile }, { data: blockedRows }] = await Promise.all([
      supabase.from('profiles').select('connect_code').eq('id', userId).single(),
      supabase.from('blocked_users').select('blocked_user_id, blocked_connect_code').eq('user_id', userId),
    ]);
    if (!profile?.connect_code) return;

    const blockedIds = new Set((blockedRows || []).map((b: any) => b.blocked_user_id).filter(Boolean));
    const blockedCodes = new Set((blockedRows || []).map((b: any) => b.blocked_connect_code).filter(Boolean));

    const { data: incoming } = await supabase
      .from('friends')
      .select('id, user_id, profiles!friends_user_id_fkey(connect_code)')
      .eq('friend_connect_code', profile.connect_code)
      .eq('status', 'pending');
    if (!incoming) return;

    for (const req of incoming) {
      if (knownIncomingRequestIds.has(req.id)) continue;
      knownIncomingRequestIds.add(req.id);
      if (suppressNotifs) continue;
      const fromCode = (req as any).profiles?.connect_code;
      if (!fromCode) continue;
      if (blockedIds.has((req as any).user_id) || blockedCodes.has(fromCode)) continue;
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
    const [{ data: invites }, { data: blockedRows }] = await Promise.all([
      supabase.from('play_invites').select('id, sender_id, created_at').eq('receiver_id', userId).gte('created_at', cutoff),
      supabase.from('blocked_users').select('blocked_user_id, blocked_connect_code').eq('user_id', userId),
    ]);
    if (!invites || invites.length === 0) return;

    const blockedIds = new Set((blockedRows || []).map((b: any) => b.blocked_user_id).filter(Boolean));
    const blockedCodes = new Set((blockedRows || []).map((b: any) => b.blocked_connect_code).filter(Boolean));

    const newInvites = invites.filter((inv) => !knownPlayInviteIds.has(`${inv.id}:${inv.created_at}`));
    if (newInvites.length === 0) return;

    const senderIds = newInvites.map((inv) => inv.sender_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, connect_code')
      .in('id', senderIds);
    const profileMap: Record<string, string> = {};
    (profiles || []).forEach((p: any) => { profileMap[p.id] = p.connect_code; });

    let didNotify = false;
    for (const inv of newInvites) {
      knownPlayInviteIds.add(`${inv.id}:${inv.created_at}`);
      const fromCode = profileMap[inv.sender_id];
      if (!fromCode) continue;
      if (blockedIds.has(inv.sender_id) || blockedCodes.has(fromCode)) continue;
      if (serviceStartedAt && inv.created_at < serviceStartedAt) continue;
      didNotify = true;
      showPlayInviteNotification(fromCode, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
    }
    if (didNotify) {
      sendToRenderer('invites:refresh', {});
    }
  } catch (e) { console.error('[main] play invite poll failed', e); }
}

async function pollNudges(userId: string, suppressNotifs = false): Promise<void> {
  try {
    const st = getSettings();
    if (st.disableNudges || !st.showNotifications) return;

    const { data: nudges } = await supabase
      .from('nudges')
      .select('id, sender_id, message, created_at')
      .eq('receiver_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (!nudges || nudges.length === 0) return;

    const newNudges = nudges.filter((n) => !knownNudgeIds.has(n.id));
    if (newNudges.length === 0) return;

    for (const n of newNudges) knownNudgeIds.add(n.id);

    const senderIds = [...new Set(newNudges.map((n) => n.sender_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, connect_code')
      .in('id', senderIds);
    const profileMap: Record<string, string> = {};
    (profiles || []).forEach((p: any) => { profileMap[p.id] = p.connect_code; });

    for (const nudge of newNudges) {
      if (!suppressNotifs && serviceStartedAt && nudge.created_at >= serviceStartedAt) {
        unreadNudgeCount++;
        const fromCode = profileMap[nudge.sender_id];
        if (fromCode) {
          showNudgeNotification(fromCode, nudge.message, () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.focus();
            }
          });
        }
      }
    }
    sendToRenderer('nudge:unreadCount', unreadNudgeCount);
  } catch (e) { console.error('[main] nudge poll failed', e); }
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
      setLastOpponent(info.connectCode, info.characterId, info.gameMode);
      sendToRenderer('opponent:new', info);
      updateTrayStatus();
    } catch (e) { console.error('opponent callback', e); }
  });
  setGameThrottling(st.reduceBackgroundActivity);
  await startPresenceLoop(identity.connectCode, identity.displayName || identity.connectCode, userId, st.replayDir);

  if (friendPollTimer) clearInterval(friendPollTimer);
  friendPollTimer = setInterval(() => void pollAllNotifications(userId), 30_000);
  void pollAllNotifications(userId);

  const NOTIF_POLL_NORMAL = 30_000;
  const NOTIF_POLL_IN_GAME = 300_000;

  if (unsubGameActive) unsubGameActive();
  unsubGameActive = onGameActiveChange((inGame) => {
    gameIsActive = inGame;
    setWatcherGameActive(inGame);
    sendToRenderer('game:active', inGame);

    if (!getSettings().reduceBackgroundActivity) return;
    if (friendPollTimer) { clearInterval(friendPollTimer); friendPollTimer = null; }
    const interval = inGame ? NOTIF_POLL_IN_GAME : NOTIF_POLL_NORMAL;
    friendPollTimer = setInterval(() => void pollAllNotifications(userId), interval);
    console.log(`[main] Game ${inGame ? 'active' : 'idle'} — notification poll interval: ${interval / 1000}s`);
  });
}

async function refreshAgentState(): Promise<void> {
  if (refreshLock) return;
  refreshLock = true;
  try {
    const authed = await isAuthenticated();
    const user = await getCurrentUser();
    const identity = getIdentity();
    if (authed && identity && user) {
      if (identity.staleAccount) {
        console.warn(`[main] identity is stale (user.json uid ≠ Launcher activeId) — stopping services`);
        await stopAgentServices();
        sendToRenderer('identity:staleAccount', { connectCode: identity.connectCode });
        updateTrayStatus();
        return;
      }

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
        updateTrayStatus();
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
        const geo = await fetchGeoWithFallback();
        if (geo) {
          setCachedGeo(geo);
          profileUpdate.latitude = geo.lat;
          profileUpdate.longitude = geo.lon;
          profileUpdate.region = geo.region;
        }
      } catch (e) { console.warn('[main] geolocation lookup failed:', e); }

      const { error: syncErr } = await supabase.from('profiles').update(profileUpdate).eq('id', user.id);
      if (syncErr) console.error('[main] profile sync failed:', syncErr.message);
      else console.log('[main] profile synced:', identity.connectCode);

      await startAgentServices(identity, user.id);
    } else {
      await stopAgentServices();
    }
    updateTrayStatus();
  } catch (e) { console.error('refreshAgentState', e); } finally { refreshLock = false; }
}

async function handleDeepLink(url: string): Promise<void> {
  try {
    if (url.includes('startgg-callback')) {
      await handleStartGgCallback(url);
      sendToRenderer('startgg:authChanged', isStartGgConnected());
      return;
    }
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

    const syncFocusFromWindow = () => {
      if (gameIsActive) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        setMainWindowFocused(mainWindow.isFocused());
        updateTrayStatus();
      }
    };
    mainWindow.on('blur', () => {
      if (gameIsActive) return;
      setMainWindowFocused(false);
      updateTrayStatus();
    });
    mainWindow.on('focus', () => {
      setMainWindowFocused(true);
      updateTrayStatus();
    });
    mainWindow.on('show', syncFocusFromWindow);
    setInterval(syncFocusFromWindow, 60_000);

    ipcMain.handle('agent:refresh', async () => {
      await refreshAgentState();
      return { ok: true };
    });

    ipcMain.handle('nudge:markSeen', (_e, ids: string[]) => {
      if (Array.isArray(ids)) ids.forEach((id) => knownNudgeIds.add(id));
      unreadNudgeCount = 0;
      sendToRenderer('nudge:unreadCount', 0);
    });

    ipcMain.handle('nudge:unreadCount', () => unreadNudgeCount);

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

    createTray({
      onShowWindow: () => { mainWindow?.show(); mainWindow?.focus(); },
      onQuit: () => { (app as any).isQuitting = true; app.quit(); },
    });

    if (isSetupComplete()) {
      await refreshAgentState();
    }

    let lastTrayUpdate = 0;
    setInterval(() => {
      try {
        if (gameIsActive && getSettings().reduceBackgroundActivity) return;
        const now = Date.now();
        if (now - lastTrayUpdate < 10_000) return;
        lastTrayUpdate = now;
        updateTrayStatus();
      } catch {}
    }, 10_000);
  } catch (e) { console.error('app.whenReady', e); }
});

app.on('window-all-closed', () => {
  if (!getSettings().closeToTray) {
    (app as any).isQuitting = true;
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
});
