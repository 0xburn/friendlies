import { app } from 'electron';
import * as fs from 'fs';

const Store = require('electron-store');
import { getDefaultReplayDir } from './config';

export type AgentSettings = {
  replayDir: string;
  autoLaunch: boolean;
  showNotifications: boolean;
  notifyFriendOnline: boolean;
  notifyPlayInvite: boolean;
  notificationSound: boolean;
  setupComplete: boolean;
  reduceBackgroundActivity: boolean;
  disableNudges: boolean;
  disableStatuses: boolean;
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
      showNotifications: store.get('showNotifications') !== false,
      notifyFriendOnline: store.get('notifyFriendOnline') !== false,
      notifyPlayInvite: store.get('notifyPlayInvite') !== false,
      notificationSound: store.get('notificationSound') !== false,
      setupComplete: isSetupComplete(),
      reduceBackgroundActivity: store.get('reduceBackgroundActivity') !== false,
      disableNudges: Boolean(store.get('disableNudges')),
      disableStatuses: Boolean(store.get('disableStatuses')),
    };
  } catch {
    return { replayDir: getDefaultReplayDir(), autoLaunch: false, showNotifications: true, notifyFriendOnline: true, notifyPlayInvite: true, notificationSound: true, setupComplete: false, reduceBackgroundActivity: true, disableNudges: false, disableStatuses: false };
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
    if (partial.showNotifications !== undefined) store.set('showNotifications', next.showNotifications);
    if (partial.notifyFriendOnline !== undefined) store.set('notifyFriendOnline', next.notifyFriendOnline);
    if (partial.notifyPlayInvite !== undefined) store.set('notifyPlayInvite', next.notifyPlayInvite);
    if (partial.notificationSound !== undefined) store.set('notificationSound', next.notificationSound);
    if (partial.setupComplete !== undefined) store.set('setupComplete', next.setupComplete);
    if (partial.reduceBackgroundActivity !== undefined) store.set('reduceBackgroundActivity', next.reduceBackgroundActivity);
    if (partial.disableNudges !== undefined) store.set('disableNudges', next.disableNudges);
    if (partial.disableStatuses !== undefined) store.set('disableStatuses', next.disableStatuses);
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
