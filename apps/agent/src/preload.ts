import { contextBridge, ipcRenderer } from 'electron';

type Unsubscribe = () => void;

function onEvent(channel: string, callback: (...args: any[]) => void): Unsubscribe {
  const handler = (_event: Electron.IpcRendererEvent, ...args: any[]) => callback(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api = {
  startAuth: () => ipcRenderer.invoke('auth:start'),
  getUser: () => ipcRenderer.invoke('auth:getUser'),
  isAuthenticated: () => ipcRenderer.invoke('auth:isAuthenticated'),
  checkBlacklist: () => ipcRenderer.invoke('auth:checkBlacklist'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  onAuthChanged: (cb: (user: any) => void): Unsubscribe => onEvent('auth:changed', cb),

  handleAuthCallback: (url: string) => ipcRenderer.invoke('auth:callback', url),
  getIdentity: () => ipcRenderer.invoke('identity:get') as Promise<{ uid: string; connectCode: string; displayName: string; staleAccount?: boolean } | null>,
  linkIdentity: () => ipcRenderer.invoke('identity:link'),
  getProfile: () => ipcRenderer.invoke('identity:profile'),

  getFriends: () => ipcRenderer.invoke('friends:list'),
  getIncomingRequests: () => ipcRenderer.invoke('friends:incoming'),
  addFriend: (connectCode: string) => ipcRenderer.invoke('friends:add', connectCode),
  acceptFriend: (requestId: string) => ipcRenderer.invoke('friends:accept', requestId),
  declineFriend: (requestId: string) => ipcRenderer.invoke('friends:decline', requestId),
  removeFriend: (friendshipId: string) => ipcRenderer.invoke('friends:remove', friendshipId),

  sendPlayInvite: (connectCode: string) => ipcRenderer.invoke('invite:send', connectCode),
  getPendingInvites: () => ipcRenderer.invoke('invite:pending'),
  dismissInvite: (inviteId: string) => ipcRenderer.invoke('invite:dismiss', inviteId),
  acceptPlayInvite: (inviteId: string) => ipcRenderer.invoke('invite:accept', inviteId),
  completeInvite: (inviteId: string) => ipcRenderer.invoke('invite:complete', inviteId),
  getSentInvites: () => ipcRenderer.invoke('invite:sent'),

  getOpponents: (limit?: number) => ipcRenderer.invoke('opponents:list', limit),
  getOpponentsPage: (before: string, limit?: number) => ipcRenderer.invoke('opponents:page', before, limit),
  getLatestMatchTimestamp: () => ipcRenderer.invoke('opponents:latestTimestamp'),
  backfillOpponents: (sinceMs?: number, beforeMs?: number) => ipcRenderer.invoke('opponents:backfill', sinceMs, beforeMs),
  onNewOpponent: (cb: (opponent: any) => void): Unsubscribe => onEvent('opponent:new', cb),
  onIdentityMismatch: (cb: (info: any) => void): Unsubscribe => onEvent('identity:mismatch', cb),
  onCodeClaimed: (cb: (info: any) => void): Unsubscribe => onEvent('identity:codeClaimed', cb),

  discoverPlayers: (characterIds?: number[]) => ipcRenderer.invoke('discover:list', characterIds),

  getPlayerCount: () => ipcRenderer.invoke('stats:playerCount'),
  getLivePresence: () => ipcRenderer.invoke('stats:livePresence') as Promise<{ online: number; inGame: number }>,
  getPresenceStats: () => ipcRenderer.invoke('stats:presence'),
  getOnlineUsers: () => ipcRenderer.invoke('presence:online'),
  getLocalStatus: () => ipcRenderer.invoke('presence:localStatus'),
  getFriendStatuses: () => ipcRenderer.invoke('presence:friendStatuses'),
  toggleLookingToPlay: () => ipcRenderer.invoke('presence:toggleLookingToPlay') as Promise<boolean>,
  isLookingToPlay: () => ipcRenderer.invoke('presence:isLookingToPlay') as Promise<boolean>,
  onPresenceUpdate: (cb: (users: any[]) => void): Unsubscribe => onEvent('presence:updated', cb),
  onLocalStatus: (cb: (info: any) => void): Unsubscribe => onEvent('presence:localStatus', cb),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial: Record<string, any>) => ipcRenderer.invoke('settings:update', partial),
  getPrivacy: () => ipcRenderer.invoke('privacy:get') as Promise<{ hideRegion: boolean; hideDiscordUnlessFriends: boolean }>,
  updatePrivacy: (partial: { hideRegion?: boolean; hideDiscordUnlessFriends?: boolean }) => ipcRenderer.invoke('privacy:update', partial),
  browseDirectory: () => ipcRenderer.invoke('settings:browse'),
  isSetupComplete: () => ipcRenderer.invoke('setup:isComplete'),
  refreshAgentState: () => ipcRenderer.invoke('agent:refresh'),

  getBroadcast: () => ipcRenderer.invoke('config:broadcast') as Promise<string | null>,

  lookupSlippiPlayer: (connectCode: string) => ipcRenderer.invoke('slippi:lookup', connectCode),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openDiscordProfile: (discordId: string) => ipcRenderer.invoke('discord:openProfile', discordId),
  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),

  onUpdateStatus: (cb: (status: any) => void): Unsubscribe => onEvent('updater:status', cb),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  startDirectConnect: (connectCode: string) => ipcRenderer.invoke('directConnect:start', connectCode),
  stopDirectConnect: () => ipcRenderer.invoke('directConnect:stop'),
  getDirectConnectStatus: () => ipcRenderer.invoke('directConnect:status') as Promise<{ status: string; active: boolean }>,
  onDirectConnectStatus: (cb: (evt: any) => void): Unsubscribe => onEvent('directConnect:status', cb),
  onInvitesRefresh: (cb: () => void): Unsubscribe => onEvent('invites:refresh', cb),
};

export type ElectronAPI = typeof api;

contextBridge.exposeInMainWorld('api', api);
