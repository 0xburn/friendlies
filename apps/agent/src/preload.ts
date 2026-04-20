import { contextBridge, ipcRenderer } from 'electron';
import { DisconnectReason } from 'slippi-web-bridge';

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
  getProfileByConnectCode: (connectCode: string) =>
    ipcRenderer.invoke('profiles:byConnectCode', connectCode),
  getProfileByStartGgUserId: (startGgUserId: string) =>
    ipcRenderer.invoke('profiles:byStartGgUserId', startGgUserId),

  getFriends: () => ipcRenderer.invoke('friends:list'),
  getIncomingRequests: () => ipcRenderer.invoke('friends:incoming'),
  addFriend: (connectCode: string, note?: string) => ipcRenderer.invoke('friends:add', connectCode, note),
  acceptFriend: (requestId: string) => ipcRenderer.invoke('friends:accept', requestId),
  declineFriend: (requestId: string) => ipcRenderer.invoke('friends:decline', requestId),
  removeFriend: (friendshipId: string) => ipcRenderer.invoke('friends:remove', friendshipId),

  blockUser: (connectCode: string) => ipcRenderer.invoke('block:add', connectCode),
  unblockUser: (connectCode: string) => ipcRenderer.invoke('block:remove', connectCode),
  getBlockedUsers: () => ipcRenderer.invoke('block:list') as Promise<{ connectCode: string; displayName: string | null; avatarUrl: string | null; blockedAt: string }[]>,

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

  discoverPlayers: (opts?: { characterIds?: number[]; minElo?: number; maxElo?: number }) => ipcRenderer.invoke('discover:list', opts),

  getLeaderboard: (limit?: number) => ipcRenderer.invoke('leaderboard:top', limit) as Promise<{ userId: string; connectCode: string; displayName: string; avatarUrl: string | null; mainCharacter: number | null; inGameSeconds: number; rankChange: number }[]>,

  getPlayerCount: () => ipcRenderer.invoke('stats:playerCount'),
  getLivePresence: () => ipcRenderer.invoke('stats:livePresence') as Promise<{ online: number; inGame: number }>,
  getPresenceStats: () => ipcRenderer.invoke('stats:presence'),
  getOnlineUsers: () => ipcRenderer.invoke('presence:online'),
  getLocalStatus: () => ipcRenderer.invoke('presence:localStatus'),
  getConnectionType: () => ipcRenderer.invoke('presence:connectionType') as Promise<'wifi' | 'ethernet' | null>,
  getFriendStatuses: () => ipcRenderer.invoke('presence:friendStatuses'),
  toggleLookingToPlay: () => ipcRenderer.invoke('presence:toggleLookingToPlay') as Promise<boolean>,
  isLookingToPlay: () => ipcRenderer.invoke('presence:isLookingToPlay') as Promise<boolean>,
  setStatusPreset: (preset: string | null) => ipcRenderer.invoke('presence:setStatusPreset', preset) as Promise<string | null>,
  getStatusPreset: () => ipcRenderer.invoke('presence:getStatusPreset') as Promise<string | null>,
  setLfgExpiry: (minutes: number | null) => ipcRenderer.invoke('presence:setLfgExpiry', minutes) as Promise<void>,
  getLfgExpiry: () => ipcRenderer.invoke('presence:getLfgExpiry') as Promise<number | null>,
  setLfgCharacters: (chars: number[]) => ipcRenderer.invoke('presence:setLfgCharacters', chars) as Promise<void>,
  getLfgCharacters: () => ipcRenderer.invoke('presence:getLfgCharacters') as Promise<number[]>,
  setLfgRanks: (ranks: string[]) => ipcRenderer.invoke('presence:setLfgRanks', ranks) as Promise<void>,
  getLfgRanks: () => ipcRenderer.invoke('presence:getLfgRanks') as Promise<string[]>,
  onPresenceUpdate: (cb: (users: any[]) => void): Unsubscribe => onEvent('presence:updated', cb),
  onLocalStatus: (cb: (info: any) => void): Unsubscribe => onEvent('presence:localStatus', cb),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial: Record<string, any>) => ipcRenderer.invoke('settings:update', partial),
  getPrivacy: () => ipcRenderer.invoke('privacy:get') as Promise<{ hideRegion: boolean; hideDiscordUnlessFriends: boolean; hideAvatar: boolean; hideConnectionType: boolean; hideOnlineStatus: boolean; disableFriendRequests: boolean; chosenRegion: string | null }>,
  updatePrivacy: (partial: { hideRegion?: boolean; hideDiscordUnlessFriends?: boolean; hideAvatar?: boolean; hideConnectionType?: boolean; hideOnlineStatus?: boolean; disableFriendRequests?: boolean }) => ipcRenderer.invoke('privacy:update', partial),
  setRegion: (chosenRegion: string | null) => ipcRenderer.invoke('profile:setRegion', chosenRegion) as Promise<{ ok?: boolean; error?: string }>,
  updateCharacters: (data: { mainCharacter?: number | null; secondaryCharacter?: number | null }) => ipcRenderer.invoke('profile:updateCharacters', data) as Promise<{ ok?: boolean; error?: string }>,
  browseDirectory: () => ipcRenderer.invoke('settings:browse'),
  getSlippiDir: () => ipcRenderer.invoke('settings:getSlippiDir') as Promise<string | null>,
  setSlippiDir: (dir: string | null) => ipcRenderer.invoke('settings:setSlippiDir', dir),
  browseSlippiDir: () => ipcRenderer.invoke('settings:browseSlippiDir') as Promise<string | null>,
  isSetupComplete: () => ipcRenderer.invoke('setup:isComplete'),
  refreshAgentState: () => ipcRenderer.invoke('agent:refresh'),

  getBroadcast: () => ipcRenderer.invoke('config:broadcast') as Promise<string | null>,
  isPatreonPublicSupporter: () => ipcRenderer.invoke('patreon:isPublicSupporter') as Promise<boolean>,
  listPatreonPublicSupporterCodes: () =>
    ipcRenderer.invoke('patreon:listPublicSupporterCodes') as Promise<string[]>,

  lookupSlippiPlayer: (connectCode: string) => ipcRenderer.invoke('slippi:lookup', connectCode),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openDiscordProfile: (discordId: string) => ipcRenderer.invoke('discord:openProfile', discordId),
  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),

  getAppMetrics: () => ipcRenderer.invoke('perf:metrics') as Promise<any[]>,

  onUpdateStatus: (cb: (status: any) => void): Unsubscribe => onEvent('updater:status', cb),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  startDirectConnect: (connectCode: string, source?: string, meta?: Record<string, unknown>) =>
    ipcRenderer.invoke('directConnect:start', connectCode, source, meta),
  stopDirectConnect: () => ipcRenderer.invoke('directConnect:stop'),
  getDirectConnectStatus: () => ipcRenderer.invoke('directConnect:status') as Promise<{ status: string; active: boolean }>,
  onDirectConnectStatus: (cb: (evt: any) => void): Unsubscribe => onEvent('directConnect:status', cb),
  onInvitesRefresh: (cb: () => void): Unsubscribe => onEvent('invites:refresh', cb),
  onNotificationSound: (cb: () => void): Unsubscribe => onEvent('notification:sound', cb),
  sendNudge: (connectCode: string, message: string) => ipcRenderer.invoke('nudge:send', connectCode, message) as Promise<{ ok?: boolean; error?: string }>,
  getNudges: () => ipcRenderer.invoke('nudge:list') as Promise<any[]>,
  markNudgesSeen: (ids: string[]) => ipcRenderer.invoke('nudge:markSeen', ids),
  getSentNudges: () => ipcRenderer.invoke('nudge:listSent') as Promise<any[]>,
  getUnreadNudgeCount: () => ipcRenderer.invoke('nudge:unreadCount') as Promise<number>,
  onUnreadNudgeCount: (cb: (count: number) => void): Unsubscribe => onEvent('nudge:unreadCount', cb),

  chatEnabled: () => ipcRenderer.invoke('chat:enabled') as Promise<boolean>,
  chatSubscribe: (room?: string) =>
    ipcRenderer.invoke('chat:subscribe', room) as Promise<{ ok: boolean; error?: string }>,
  chatUnsubscribe: () => ipcRenderer.invoke('chat:unsubscribe') as Promise<void>,
  chatHistory: (opts?: { room?: string; before?: string; limit?: number }) =>
    ipcRenderer.invoke('chat:history', opts) as Promise<any[]>,
  chatSend: (content: string, room?: string) =>
    ipcRenderer.invoke('chat:send', content, room) as Promise<{ error?: string }>,
  chatDelete: (messageId: string) =>
    ipcRenderer.invoke('chat:delete', messageId) as Promise<{ error?: string }>,
  chatReport: (messageId: string, reason?: string) =>
    ipcRenderer.invoke('chat:report', messageId, reason) as Promise<{ error?: string }>,
  chatIsMuted: () => ipcRenderer.invoke('chat:isMuted') as Promise<boolean>,
  chatIsBanned: () => ipcRenderer.invoke('chat:isBanned') as Promise<boolean>,
  chatProfile: (connectCode: string) =>
    ipcRenderer.invoke('chat:profile', connectCode) as Promise<{ connect_code: string; avatar_url: string | null; main_character: number | null; hide_avatar: boolean } | null>,
  chatAdminDelete: (messageId: string) =>
    ipcRenderer.invoke('chat:adminDelete', messageId) as Promise<{ ok?: boolean; error?: string }>,
  chatAdminMute: (connectCode: string, durationMinutes?: number) =>
    ipcRenderer.invoke('chat:adminMute', connectCode, durationMinutes) as Promise<{ ok?: boolean; error?: string }>,
  onChatMessage: (cb: (msg: any) => void): Unsubscribe => onEvent('chat:newMessage', cb),
  onChatMessageDeleted: (cb: (data: { id: string }) => void): Unsubscribe => onEvent('chat:messageDeleted', cb),
  onChatOnlineCount: (cb: (count: number) => void): Unsubscribe => onEvent('chat:onlineCount', cb),

  trackBannerClick: (banner: string) => ipcRenderer.invoke('banner:click', banner),
  getCashboxSnapshot: () => ipcRenderer.invoke('cashbox:getSnapshot'),
  lookupCashboxOpponent: (code: string) =>
    ipcRenderer.invoke('cashbox:lookupOpponent', code) as Promise<{
      ok: boolean;
      friendlies?: any;
      message?: string;
    }>,
  completeCashboxModerationTask: (taskId: string) =>
    ipcRenderer.invoke('cashbox:completeModerationTask', taskId) as Promise<{
      ok: boolean;
      message?: string;
      status?: number;
    }>,
  reportCashboxSet: (
    setId: string,
    winnerId: number | null,
    gameData: { winnerId: number; gameNum: number }[],
  ) =>
    ipcRenderer.invoke('cashbox:reportSet', setId, winnerId, gameData) as Promise<{
      ok: boolean;
      message?: string;
      state?: number | null;
    }>,
  getSetTasks: (phaseGroupId: string, setId: string, forceFresh?: boolean) =>
    ipcRenderer.invoke('cashbox:getSetTasks', phaseGroupId, setId, forceFresh) as Promise<{
      ok: boolean;
      tasks?: any[];
      message?: string;
    }>,
  getSetUpdatedAt: (setId: string) =>
    ipcRenderer.invoke('cashbox:getSetUpdatedAt', setId) as Promise<{
      ok: boolean;
      state?: number;
      updatedAt?: number;
      message?: string;
    }>,
  taskComplete: (taskId: string, body: Record<string, unknown>) =>
    ipcRenderer.invoke('cashbox:taskComplete', taskId, body) as Promise<{
      ok: boolean;
      tasks?: any[];
      message?: string;
    }>,
  taskUpdate: (taskId: string, body: Record<string, unknown>) =>
    ipcRenderer.invoke('cashbox:taskUpdate', taskId, body) as Promise<{
      ok: boolean;
      tasks?: any[];
      message?: string;
    }>,
  connectStartGg: () =>
    ipcRenderer.invoke('startgg:connect') as Promise<{ ok: boolean; error?: string }>,
  disconnectStartGg: () =>
    ipcRenderer.invoke('startgg:disconnect') as Promise<{ ok: boolean; error?: string }>,
  isStartGgConnected: () =>
    ipcRenderer.invoke('startgg:isConnected') as Promise<{
      connected: boolean;
      userId: string | null;
      displayName: string | null;
    }>,
  onStartGgAuthChanged: (cb: (connected: boolean) => void): Unsubscribe =>
    onEvent('startgg:authChanged', cb),

  testNotification: () => ipcRenderer.invoke('notifications:test'),
  reportDocumentHidden: (hidden: boolean) => ipcRenderer.send('visibility:document', hidden),
  onGameActive: (cb: (active: boolean) => void): Unsubscribe => onEvent('game:active', cb),

  startStream: () => ipcRenderer.invoke('stream:start'),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  onStreamDisconnected: (cb: (reason: DisconnectReason) => void): Unsubscribe => onEvent('stream:disconnected', cb),
};

export type ElectronAPI = typeof api;

contextBridge.exposeInMainWorld('api', api);
