import log from 'electron-log/main';

log.initialize();
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB, rotates to .old
log.errorHandler.startCatching();

export default log;

export const authLog     = log.scope('auth');
export const presenceLog = log.scope('presence');
export const watcherLog  = log.scope('watcher');
export const identityLog = log.scope('identity');
export const mainLog     = log.scope('main');
export const ipcLog      = log.scope('ipc');
export const trayLog     = log.scope('tray');
export const updaterLog  = log.scope('updater');
export const chatLog     = log.scope('chat');
export const geoLog      = log.scope('geo');
export const notifLog    = log.scope('notifications');
export const cashboxLog  = log.scope('cashbox');
export const startggLog  = log.scope('startgg');
export const directLog   = log.scope('direct-connect');
export const settingsLog = log.scope('settings');
