import * as os from 'os';
import * as path from 'path';

const Store = require('electron-store');

const store = new Store({ name: 'slippi-friends-identity' });
const KEY = 'customLauncherDir';

export function getCustomLauncherDir(): string | null {
  return (store.get(KEY) as string | undefined) ?? null;
}

export function setCustomLauncherDir(dir: string | null): void {
  if (dir) store.set(KEY, dir);
  else store.delete(KEY);
}

function defaultLauncherDir(): string {
  const home = os.homedir();
  return process.platform === 'win32'
    ? path.join(home, 'AppData', 'Roaming', 'Slippi Launcher')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Slippi Launcher')
      : path.join(home, '.config', 'Slippi Launcher');
}

export function getEffectiveLauncherDir(): string {
  return getCustomLauncherDir() ?? defaultLauncherDir();
}
