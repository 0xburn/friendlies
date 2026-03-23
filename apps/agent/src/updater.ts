import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow } from 'electron';

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

  const send = (status: UpdateStatus) => {
    if (sender) sender(status);
    try {
      win.webContents.send('updater:status', status);
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
    send({ state: 'error', message: err?.message ?? String(err) });
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
  autoUpdater.quitAndInstall(false, true);
}
