import * as fs from 'fs';
import * as path from 'path';
import { Menu, Tray, nativeImage } from 'electron';
import type { PresenceStatus } from './presence';

let tray: Tray | null = null;
let getStatusFn: () => PresenceStatus = () => 'offline';

type TrayHandlers = {
  onShowWindow: () => void;
  onQuit: () => void;
};

let handlers: TrayHandlers = { onShowWindow: () => {}, onQuit: () => {} };

function iconPath(kind: PresenceStatus): string {
  const base = path.join(__dirname, '..', 'assets');
  const name = kind === 'in-game' ? 'tray-ingame.png' : kind === 'online' ? 'tray-online.png' : 'tray-offline.png';
  return path.join(base, name);
}

function loadIcon(kind: PresenceStatus): Electron.NativeImage {
  for (const p of [iconPath(kind), iconPath('online'), path.join(__dirname, '..', 'assets', 'icon.png')]) {
    try { if (fs.existsSync(p)) return nativeImage.createFromPath(p); } catch {}
  }
  return nativeImage.createEmpty();
}

function buildMenu(): Menu {
  const status = getStatusFn();
  const statusLabel = status === 'in-game' ? 'In Game' : status === 'online' ? 'Online' : 'Away';

  return Menu.buildFromTemplate([
    { label: `Status: ${statusLabel}`, enabled: false },
    { type: 'separator' },
    { label: 'Show Friendlies', click: () => handlers.onShowWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => handlers.onQuit() },
  ]);
}

export function createTray(getStatus: () => PresenceStatus, h: TrayHandlers): void {
  getStatusFn = getStatus;
  handlers = h;
  const img = loadIcon(getStatus());
  tray = new Tray(img);
  tray.setToolTip('Friendlies');
  tray.setContextMenu(buildMenu());
  tray.on('click', () => handlers.onShowWindow());
}

export function updateTrayStatus(status: PresenceStatus): void {
  if (!tray) return;
  tray.setImage(loadIcon(status));
  tray.setContextMenu(buildMenu());
}

export function addRecentOpponent(_code: string, _name: string): void {}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
