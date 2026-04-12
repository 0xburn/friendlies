import { BrowserWindow, Notification } from 'electron';
import { getSettings } from './settings';
import { getCurrentStatus } from './presence';
import { notifLog } from './logger';

const NOTIF_COOLDOWN_MS = 60_000;
const recentFriendNotifs = new Map<string, number>();
const recentNudgeNotifs = new Map<string, number>();

function playNotificationSound(): void {
  try {
    if (!getSettings().notificationSound) return;
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('notification:sound');
    }
  } catch {}
}

function shouldSuppressToast(): boolean {
  return process.platform === 'win32' && getCurrentStatus() === 'in-game';
}

export function showFriendOnlineNotification(
  connectCode: string,
  newStatus: string,
): void {
  try {
    if (!Notification.isSupported()) return;
    const suppress = shouldSuppressToast();
    if (suppress) return;

    const now = Date.now();
    const lastShown = recentFriendNotifs.get(connectCode);
    if (lastShown && now - lastShown < NOTIF_COOLDOWN_MS) return;
    recentFriendNotifs.set(connectCode, now);

    const label = newStatus === 'in-game' ? 'is now in game' : 'is now online';
    const n = new Notification({
      title: 'friendlies',
      body: `${connectCode} ${label}`,
      silent: true,
    });
    n.show();
  } catch (e) {
    console.error('showFriendOnlineNotification failed', e);
    notifLog.error('showFriendOnlineNotification failed', e);
  }
}

export function showFriendRequestNotification(
  fromCode: string,
  onClick?: () => void,
): void {
  try {
    if (!Notification.isSupported()) return;
    const suppress = shouldSuppressToast();
    if (!suppress) {
      const n = new Notification({
        title: 'friendlies',
        body: `${fromCode} sent you a friend request`,
        silent: true,
      });
      if (onClick) n.on('click', onClick);
      n.show();
    }
    playNotificationSound();
  } catch (e) {
    console.error('showFriendRequestNotification failed', e);
    notifLog.error('showFriendRequestNotification failed', e);
  }
}

export function showPlayInviteNotification(
  fromCode: string,
  onClick?: () => void,
): void {
  try {
    if (!Notification.isSupported()) return;
    const suppress = shouldSuppressToast();
    if (!suppress) {
      const n = new Notification({
        title: 'friendlies',
        body: `${fromCode} wants to play!`,
        silent: true,
      });
      if (onClick) n.on('click', onClick);
      n.show();
    }
    playNotificationSound();
  } catch (e) {
    console.error('showPlayInviteNotification failed', e);
    notifLog.error('showPlayInviteNotification failed', e);
  }
}

export function showNudgeNotification(
  fromCode: string,
  message: string,
  onClick?: () => void,
): void {
  try {
    if (!Notification.isSupported()) return;
    const key = `${fromCode}:${message}`;
    const now = Date.now();
    const lastShown = recentNudgeNotifs.get(key);
    if (lastShown && now - lastShown < NOTIF_COOLDOWN_MS) return;
    recentNudgeNotifs.set(key, now);

    const suppress = shouldSuppressToast();
    if (!suppress) {
      const n = new Notification({
        title: 'friendlies',
        body: `${fromCode}: ${message}`,
        silent: true,
      });
      if (onClick) n.on('click', onClick);
      n.show();
    }
    playNotificationSound();
  } catch (e) {
    console.error('showNudgeNotification failed', e);
    notifLog.error('showNudgeNotification failed', e);
  }
}

export function showTestNotification(): void {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('notification:sound');
    }
  } catch (e) {
    console.error('showTestNotification failed', e);
    notifLog.error('showTestNotification failed', e);
  }
}
