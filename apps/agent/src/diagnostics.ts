import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserWindow, app, dialog, screen } from 'electron';
import log from 'electron-log/main';
import archiver from 'archiver';
import { getSettings } from './settings';
import { getIdentity } from './identity';
import { getCurrentStatus, getPresenceStats, isLookingToPlay, getStatusPreset } from './presence';

export async function exportDiagnostics(): Promise<string | null> {
  const ts = new Date().toISOString().replace(/[:]/g, '-').replace(/\.\d+Z$/, '');
  const defaultName = `friendlies-diagnostics-${ts}.tar.gz`;
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Export Diagnostic Logs',
    defaultPath: path.join(app.getPath('desktop'), defaultName),
    filters: [{ name: 'Gzipped Tar', extensions: ['tar.gz'] }],
  });
  if (canceled || !filePath) return null;

  const output = fs.createWriteStream(filePath);
  const archive = archiver('tar', { gzip: true });
  archive.pipe(output);

  // --- Logs ---
  try {
    const allLogs = log.transports.file.readAllLogs();
    for (const entry of allLogs) {
      const name = path.basename(entry.path);
      archive.append(entry.lines.join('\n'), { name });
    }
  } catch (e) {
    archive.append(`Failed to read logs: ${e}`, { name: 'log-error.txt' });
  }

  // --- Platform info ---
  const displays = screen.getAllDisplays().map((d) => ({
    id: d.id,
    size: d.size,
    scaleFactor: d.scaleFactor,
  }));

  let windowSize: { width: number; height: number } | null = null;
  try {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      const [w, h] = win.getSize();
      windowSize = { width: w, height: h };
    }
  } catch {}

  const platformInfo = {
    platform: os.platform(),
    platformPretty: getPrettyOSName(),
    arch: os.arch(),
    osRelease: os.release(),
    appVersion: app.getVersion(),
    windowSize,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    displays,
  };
  archive.append(JSON.stringify(platformInfo, null, 2), { name: 'platform-info.json' });

  // --- App state ---
  const identity = getIdentity();
  const appState = {
    connectCode: identity?.connectCode ?? null,
    displayName: identity?.displayName ?? null,
    presenceStatus: getCurrentStatus(),
    lookingToPlay: isLookingToPlay(),
    statusPreset: getStatusPreset(),
    presenceStats: getPresenceStats(),
    settings: getSettings(),
  };
  archive.append(JSON.stringify(appState, null, 2), { name: 'app-state.json' });

  await archive.finalize();

  // Wait for the stream to finish writing
  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
  });

  return filePath;
}

function getPrettyOSName(): string {
  const platform = os.platform();
  const release = os.release(); // e.g. "10.0.22631"

  if (platform === 'darwin') {
    const major = parseInt(release.split('.')[0], 10);
    // Darwin kernel 20 = macOS 11 Big Sur, 21 = 12 Monterey, etc.
    const macVersion = major >= 20 ? major - 9 : null;
    return macVersion ? `macOS ${macVersion} (${release})` : `macOS (${release})`;
  }

  if (platform === 'win32') {
    const parts = release.split('.');
    const build = parseInt(parts[2] || '0', 10);
    // Windows 11 starts at build 22000
    const winVersion = build >= 22000 ? '11' : '10';
    return `Windows ${winVersion} (build ${build})`;
  }

  if (platform === 'linux') {
    try {
      const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
      const pretty = osRelease.match(/^PRETTY_NAME="?(.+?)"?$/m);
      if (pretty) return pretty[1];
    } catch {}
    return `Linux ${release}`;
  }

  return `${platform} ${release}`;
}

