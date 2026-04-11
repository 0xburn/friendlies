import { app } from 'electron';
import * as fs from 'fs';

const Store = require('electron-store');
import { getDefaultReplayDir } from './config';

export type AgentSettings = {
  replayDir: string;
  autoLaunch: boolean;
  closeToTray: boolean;
  showNotifications: boolean;
  notifyFriendOnline: boolean;
  notifyPlayInvite: boolean;
  notificationSound: boolean;
  setupComplete: boolean;
  reduceBackgroundActivity: boolean;
  notificationVolume: number;
  disableNudges: boolean;
  disableStatuses: boolean;
  disableChat: boolean;
};

const store = new Store({ name: 'slippi-friends-settings' });

export function isSetupComplete(): boolean {
  return Boolean(store.get('setupComplete'));
}

export function getSettings(): AgentSettings {
  try {
    return {
      replayDir: (store.get('replayDir') as string | undefined) ?? getDefaultReplayDir(),
      autoLaunch: Boolean(store.get('autoLaunch')),
      closeToTray: Boolean(store.get('closeToTray')),
      showNotifications: store.get('showNotifications') !== false,
      notifyFriendOnline: store.get('notifyFriendOnline') !== false,
      notifyPlayInvite: store.get('notifyPlayInvite') !== false,
      notificationSound: store.get('notificationSound') !== false,
      setupComplete: isSetupComplete(),
      reduceBackgroundActivity: store.get('reduceBackgroundActivity') !== false,
      notificationVolume: typeof store.get('notificationVolume') === 'number' ? store.get('notificationVolume') as number : 0.35,
      disableNudges: Boolean(store.get('disableNudges')),
      disableStatuses: Boolean(store.get('disableStatuses')),
      disableChat: Boolean(store.get('disableChat')),
    };
  } catch {
    return { replayDir: getDefaultReplayDir(), autoLaunch: false, closeToTray: false, showNotifications: true, notifyFriendOnline: true, notifyPlayInvite: true, notificationSound: true, setupComplete: false, reduceBackgroundActivity: true, notificationVolume: 0.35, disableNudges: false, disableStatuses: false, disableChat: false };
  }
}

export function updateSettings(partial: Partial<AgentSettings>): AgentSettings {
  try {
    const cur = getSettings();
    const next = { ...cur, ...partial };
    if (partial.replayDir !== undefined) store.set('replayDir', next.replayDir);
    if (partial.autoLaunch !== undefined) {
      store.set('autoLaunch', next.autoLaunch);
      app.setLoginItemSettings({ openAtLogin: next.autoLaunch, openAsHidden: true });
    }
    if (partial.closeToTray !== undefined) store.set('closeToTray', next.closeToTray);
    if (partial.showNotifications !== undefined) store.set('showNotifications', next.showNotifications);
    if (partial.notifyFriendOnline !== undefined) store.set('notifyFriendOnline', next.notifyFriendOnline);
    if (partial.notifyPlayInvite !== undefined) store.set('notifyPlayInvite', next.notifyPlayInvite);
    if (partial.notificationSound !== undefined) store.set('notificationSound', next.notificationSound);
    if (partial.setupComplete !== undefined) store.set('setupComplete', next.setupComplete);
    if (partial.reduceBackgroundActivity !== undefined) store.set('reduceBackgroundActivity', next.reduceBackgroundActivity);
    if (partial.notificationVolume !== undefined) store.set('notificationVolume', next.notificationVolume);
    if (partial.disableNudges !== undefined) store.set('disableNudges', next.disableNudges);
    if (partial.disableStatuses !== undefined) store.set('disableStatuses', next.disableStatuses);
    if (partial.disableChat !== undefined) store.set('disableChat', next.disableChat);
    return next;
  } catch {
    return getSettings();
  }
}

export function detectReplayDir(): string {
  const dir = getDefaultReplayDir();
  try { if (fs.existsSync(dir)) return dir; } catch {}
  return dir;
}

export type WindowBounds = { x: number; y: number; width: number; height: number };

const BOUNDS_KEY = 'windowBounds';

export function getWindowBounds(): WindowBounds | null {
  try {
    const raw = store.get(BOUNDS_KEY) as WindowBounds | undefined;
    if (raw && typeof raw.width === 'number' && typeof raw.height === 'number') return raw;
  } catch {}
  return null;
}

export function saveWindowBounds(bounds: WindowBounds): void {
  try { store.set(BOUNDS_KEY, bounds); } catch {}
}
