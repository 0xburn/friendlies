import { autoUpdater, UpdateInfo } from 'electron-updater';
import { app, BrowserWindow } from 'electron';

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

let sender: ((status: UpdateStatus) => void) | null = null;

export function initAutoUpdater(win: BrowserWindow): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true;

  const send = (status: UpdateStatus) => {
    if (sender) sender(status);
    try {
      if (!win.isDestroyed()) win.webContents.send('updater:status', status);
    } catch {}
  };

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    send({ state: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => send({ state: 'not-available' }));

  autoUpdater.on('download-progress', (progress) => {
    send({ state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    send({ state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    const msg = err?.message ?? String(err);
    if (msg.includes('404') || msg.includes('net::ERR_')) {
      console.warn('[updater] transient error, will retry:', msg);
      return;
    }
    send({ state: 'error', message: msg });
  });
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((e) =>
    console.error('[updater] checkForUpdates failed:', e),
  );
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch((e) =>
    console.error('[updater] downloadUpdate failed:', e),
  );
}

export function quitAndInstall(): void {
  (app as any).isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
  setTimeout(() => app.exit(0), 3000);
}
