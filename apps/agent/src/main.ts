import * as path from 'path';
import { BrowserWindow, app, shell } from 'electron';
import {
  getCurrentUser, handleAuthCallback, isAuthenticated,
  logout, restoreSession, startAuthFlow,
} from './auth';
import { APP_PROTOCOL } from './config';
import { getIdentity, verifyIdentity, type SlippiIdentity } from './identity';
import { registerIpcHandlers, sendToRenderer } from './ipc';
import { showOpponentNotification } from './notifications';
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
    if (!(app as any).isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

async function stopAgentServices(): Promise<void> {
  try { await stopPresenceLoop(); } catch (e) { console.error('stopPresenceLoop', e); }
  stopWatcher();
}

async function startAgentServices(identity: SlippiIdentity, userId: string): Promise<void> {
  await stopAgentServices();
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
}

async function refreshAgentState(): Promise<void> {
  try {
    const authed = await isAuthenticated();
    const user = await getCurrentUser();
    const identity = getIdentity();
    if (authed && identity && user) {
      void verifyIdentity(identity).catch((e) => console.error('verifyIdentity', e));
      await startAgentServices(identity, user.id);
    } else {
      await stopAgentServices();
    }
    updateTrayStatus(getCurrentStatus());
  } catch (e) { console.error('refreshAgentState', e); }
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

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

if (!isDev && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const url = findProtocolUrl(argv);
    if (url) void handleDeepLink(url);
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
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

    await restoreSession();

    mainWindow = createMainWindow();
    registerIpcHandlers(mainWindow);

    if (!isDev) {
      initAutoUpdater(mainWindow);
      checkForUpdates();
      setInterval(checkForUpdates, 60 * 60 * 1000);
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

app.on('window-all-closed', () => {});
