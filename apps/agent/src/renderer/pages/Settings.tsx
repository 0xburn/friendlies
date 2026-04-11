import { useEffect, useRef, useState } from 'react';
import { isGameActive } from '../App';

interface SettingsState {
  replayDir: string;
  autoLaunch: boolean;
  closeToTray: boolean;
  showNotifications: boolean;
  notifyFriendOnline: boolean;
  notifyPlayInvite: boolean;
  notificationSound: boolean;
  notificationVolume: number;
  reduceBackgroundActivity: boolean;
  disableNudges: boolean;
  disableStatuses: boolean;
  disableChat: boolean;
}

interface AppMetric {
  pid: number;
  type: string;
  cpu: { percentCPUUsage: number; idleWakeupsPerSecond: number };
  memory: { workingSetSize: number; peakWorkingSetSize: number };
}

interface PresenceStats {
  upsertOk: number;
  upsertFail: number;
  upsertSkipped: number;
  trackOk: number;
  trackFail: number;
  subscribeFail: number;
  lastError: string;
  realtimeConnected: boolean;
}

const DEBUG_CONNECT_CODES = ['SMOK#1', 'BF#0'];
export function Settings() {
  const [pStats, setPStats] = useState<PresenceStats | null>(null);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsState>({
    replayDir: '',
    autoLaunch: false,
    closeToTray: false,
    showNotifications: true,
    notifyFriendOnline: true,
    notifyPlayInvite: true,
    notificationSound: true,
    notificationVolume: 0.35,
    reduceBackgroundActivity: true,
    disableNudges: false,
    disableStatuses: false,
    disableChat: false,
  });
  const [metrics, setMetrics] = useState<AppMetric[] | null>(null);
  const [privacy, setPrivacy] = useState({ hideRegion: false, hideDiscordUnlessFriends: false, hideAvatar: false, hideConnectionType: false, hideOnlineStatus: false, disableFriendRequests: false, chosenRegion: null as string | null });
  const [saved, setSaved] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [slippiDir, setSlippiDir] = useState<string | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<{ connectCode: string; displayName: string | null; avatarUrl: string | null; blockedAt: string }[]>([]);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings({
        replayDir: s.replayDir || '',
        autoLaunch: s.autoLaunch || false,
        closeToTray: !!s.closeToTray,
        showNotifications: s.showNotifications !== false,
        notifyFriendOnline: s.notifyFriendOnline !== false,
        notifyPlayInvite: s.notifyPlayInvite !== false,
        notificationSound: s.notificationSound !== false,
        notificationVolume: typeof s.notificationVolume === 'number' ? s.notificationVolume : 0.35,
        reduceBackgroundActivity: s.reduceBackgroundActivity !== false,
        disableNudges: !!s.disableNudges,
        disableStatuses: !!s.disableStatuses,
        disableChat: !!s.disableChat,
      });
    });
    window.api.getPrivacy().then(setPrivacy).catch(() => {});
    window.api.getSlippiDir().then(setSlippiDir).catch(() => {});
    loadBlockedUsers();
    window.api.getIdentity().then((id) => {
      if (id?.connectCode) setMyCode(id.connectCode);
    });
    const fetchStats = () => (window.api as any).getPresenceStats?.().then((s: PresenceStats) => setPStats(s)).catch(() => {});
    fetchStats();
    const statsInterval = setInterval(() => { if (!document.hidden && !isGameActive()) fetchStats(); }, 30_000);
    const fetchMetrics = () => window.api.getAppMetrics().then(setMetrics).catch(() => {});
    fetchMetrics();
    const metricsInterval = setInterval(() => { if (!document.hidden && !isGameActive()) fetchMetrics(); }, 30_000);
    const unsub = window.api.onUpdateStatus((s: any) => {
      if (s.state === 'not-available') setUpdateMsg('Up to date');
      else if (s.state === 'available') setUpdateMsg(null);
      else if (s.state === 'error') setUpdateMsg(null);
    });
    const onVisible = () => { if (!document.hidden) { fetchStats(); fetchMetrics(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { unsub(); clearInterval(statsInterval); clearInterval(metricsInterval); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  async function handleBrowse() {
    const dir = await window.api.browseDirectory();
    if (dir) {
      setSettings((s) => ({ ...s, replayDir: dir }));
      await window.api.updateSettings({ replayDir: dir });
      flash();
    }
  }

  async function toggle(key: keyof Omit<SettingsState, 'replayDir'>) {
    const next = !settings[key];
    setSettings((s) => ({ ...s, [key]: next }));
    await window.api.updateSettings({ [key]: next });
    flash();
  }

  async function togglePrivacy(key: keyof typeof privacy) {
    const next = !privacy[key];
    setPrivacy((s) => ({ ...s, [key]: next }));
    await window.api.updatePrivacy({ [key]: next });
    flash();
  }

  async function handleLogout() {
    await window.api.logout();
    window.location.reload();
  }

  function flash() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function loadBlockedUsers() {
    try {
      const data = await window.api.getBlockedUsers();
      setBlockedUsers(data || []);
    } catch {}
  }

  async function handleUnblock(connectCode: string) {
    setUnblocking(connectCode);
    await window.api.unblockUser(connectCode);
    await loadBlockedUsers();
    setUnblocking(null);
  }

  const notifsEnabled = settings.showNotifications;
  const [searchQuery, setSearchQuery] = useState('');
  const sq = searchQuery.toLowerCase();
  const show = (...terms: string[]) => !sq || terms.some(t => t.toLowerCase().includes(sq));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold">Settings</h1>
        {saved && (
          <span className="text-xs text-[#21BA45] font-medium animate-pulse">Saved</span>
        )}
      </div>

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search settings..."
        className="w-full rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#21BA45]/50"
      />

      {show('replay', 'directory', 'display region', 'region', 'launch', 'login', 'close', 'tray', 'slippi', 'launcher', 'install', 'path', 'custom') && (
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] divide-y divide-[#2a2a2a]">
        {show('replay', 'directory') && (
        <div className="p-5">
          <label className="text-sm font-medium text-gray-300">Replay Directory</label>
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={settings.replayDir}
              readOnly
              className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-2.5 text-sm font-mono text-white"
            />
            <button
              onClick={handleBrowse}
              className="shrink-0 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-[#222] hover:text-white"
            >
              Change
            </button>
          </div>
        </div>
        )}

        {show('slippi', 'launcher', 'install', 'path', 'custom') && (
        <div className="p-5">
          <label className="text-sm font-medium text-gray-300">Slippi Launcher Path</label>
          <p className="text-xs text-gray-500 mt-0.5 mb-2">Override if Slippi Launcher data is on a different drive</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={slippiDir || ''}
              readOnly
              placeholder="Default (auto-detect)"
              className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-2.5 text-sm font-mono text-white placeholder-gray-600"
            />
            <button
              onClick={async () => {
                const dir = await window.api.browseSlippiDir();
                if (dir) {
                  await window.api.setSlippiDir(dir);
                  setSlippiDir(dir);
                  flash();
                }
              }}
              className="shrink-0 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-[#222] hover:text-white"
            >
              Change
            </button>
            {slippiDir && (
              <button
                onClick={async () => {
                  await window.api.setSlippiDir(null);
                  setSlippiDir(null);
                  flash();
                }}
                className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                Reset
              </button>
            )}
          </div>
        </div>
        )}

        {!privacy.hideRegion && show('display region', 'region', 'override', 'auto-detect', 'profile') && (
          <div className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="text-sm font-medium text-gray-300">Display Region</p>
              <p className="text-xs text-gray-500">Override the auto-detected region shown on your profile</p>
            </div>
            <select
              className="bg-[#21BA45]/10 border border-[#21BA45]/40 rounded-lg px-3 py-1.5 text-sm text-[#21BA45] font-medium focus:outline-none focus:border-[#21BA45]/70 min-w-[180px] cursor-pointer"
              value={privacy.chosenRegion || ''}
              onChange={async (e) => {
                const val = e.target.value || null;
                setPrivacy((s) => ({ ...s, chosenRegion: val }));
                await window.api.setRegion(val);
                flash();
              }}
            >
              <option value="">Auto-detect</option>
              <optgroup label="United States">
                {['MDVA','Tristate','New England','Florida','NorCal','Central Cal','SoCal','Pacific Northwest','Midwest','Southwest','South'].map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
              <optgroup label="Canada">
                {['British Columbia','Alberta','Saskatchewan','Manitoba','Ontario','Quebec','Atlantic Canada (NB/NS/PEI/NFLD)'].map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
              <optgroup label="Latin America">
                {['Mexico'].map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
              <optgroup label="Europe">
                {['UK','Ireland','Germany','Sweden','France','Netherlands','Norway','Denmark','Finland','Spain','Portugal','Italy','Poland','Austria','Switzerland','EU'].map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
              <optgroup label="Oceania">
                {['NSW','VIC','QLD','WA','SA','TAS','ACT','NT','New Zealand'].map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
              <optgroup label="Asia">
                {['Japan','South Korea','Philippines','Southeast Asia'].map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
              <optgroup label="Other">
                {['South America','Middle East','Africa'].map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            </select>
          </div>
        )}
        {show('launch', 'login', 'start', 'auto') && (
        <ToggleRow
          label="Launch at Login"
          description="Start friendlies automatically when you log in"
          checked={settings.autoLaunch}
          onChange={() => toggle('autoLaunch')}
        />
        )}
        {show('close', 'tray', 'minimize', 'quit') && (
        <ToggleRow
          label="Close to Tray"
          description="Minimize to the system tray instead of quitting when you close the window"
          checked={settings.closeToTray}
          onChange={() => toggle('closeToTray')}
        />
        )}
      </div>
      )}

      {show('notification', 'friend online', 'play invite', 'sound', 'volume', 'test') && (
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] divide-y divide-[#2a2a2a]">
        {show('notification', 'desktop') && (
        <ToggleRow
          label="Notifications"
          description="Enable desktop notifications"
          checked={settings.showNotifications}
          onChange={() => toggle('showNotifications')}
        />
        )}

        {show('friend online', 'notify', 'notification') && (
        <ToggleRow
          label="Friend Online"
          description="Notify when a friend comes online or enters a game"
          checked={notifsEnabled && settings.notifyFriendOnline}
          onChange={() => toggle('notifyFriendOnline')}
          disabled={!notifsEnabled}
          indent
        />
        )}

        {show('play invite', 'notify', 'notification') && (
        <ToggleRow
          label="Play Invites"
          description="Notify when a friend invites you to play"
          checked={notifsEnabled && settings.notifyPlayInvite}
          onChange={() => toggle('notifyPlayInvite')}
          disabled={!notifsEnabled}
          indent
        />
        )}

        {show('notification sound', 'sound effect') && (
        <ToggleRow
          label="Notification Sound"
          description="Play a sound effect with notifications"
          checked={notifsEnabled && settings.notificationSound}
          onChange={() => toggle('notificationSound')}
          disabled={!notifsEnabled}
          indent
        />
        )}

        {show('volume', 'sound') && (
        <div className={`flex items-center justify-between p-5 pl-10 ${!notifsEnabled || !settings.notificationSound ? 'opacity-40 pointer-events-none' : ''}`}>
          <div>
            <p className="text-sm font-medium text-gray-300">Volume</p>
            <p className="text-xs text-gray-500 mt-0.5">Adjust notification sound volume</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={0.35}
              step={0.01}
              value={settings.notificationVolume}
              onChange={(e) => {
                const vol = parseFloat(e.target.value);
                setSettings((s) => ({ ...s, notificationVolume: vol }));
                window.api.updateSettings({ notificationVolume: vol });
              }}
              className="w-28 accent-[#21BA45] h-1.5 bg-[#333] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
            />
            <span className="text-xs text-gray-500 w-8 text-right tabular-nums">{Math.round((settings.notificationVolume / 0.35) * 100)}%</span>
          </div>
        </div>
        )}

        {show('test notification', 'preview') && (
        <div className={`flex items-center justify-between p-5 pl-10 ${!notifsEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
          <div>
            <p className="text-sm font-medium text-gray-300">Test Notification</p>
            <p className="text-xs text-gray-500 mt-0.5">Send a test notification to preview your settings</p>
          </div>
          <button
            onClick={() => window.api.testNotification()}
            disabled={!notifsEnabled}
            className="shrink-0 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-[#222] hover:text-white disabled:opacity-40"
          >
            Test
          </button>
        </div>
        )}
      </div>
      )}

      {show('reduce', 'background', 'performance', 'polling', 'game') && (
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] divide-y divide-[#2a2a2a]">
        <ToggleRow
          label="Reduce Background Activity"
          description="Pause notifications and slow polling while in a game to minimize performance impact"
          checked={settings.reduceBackgroundActivity}
          onChange={() => toggle('reduceBackgroundActivity')}
        />
      </div>
      )}

      {show('privacy', 'friend request', 'hide', 'online status', 'location', 'discord', 'avatar', 'photo', 'connection type') && (
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] divide-y divide-[#2a2a2a]">
        <div className="p-5">
          <p className="text-sm font-medium text-gray-300">Privacy</p>
          <p className="text-xs text-gray-500 mt-0.5">Control what other players can see about you</p>
        </div>
        {show('friend request', 'disable', 'block', 'incoming') && (
        <ToggleRow
          label="Disable Friend Requests"
          description="Block all incoming friend requests from other players"
          checked={privacy.disableFriendRequests}
          onChange={() => togglePrivacy('disableFriendRequests')}
          indent
        />
        )}
        {show('hide online', 'online status', 'offline', 'appear') && (
        <ToggleRow
          label="Hide Online Status"
          description="Appear offline to all other players"
          checked={privacy.hideOnlineStatus}
          onChange={() => togglePrivacy('hideOnlineStatus')}
          indent
        />
        )}
        {show('hide location', 'region', 'location') && (
        <ToggleRow
          label="Hide Location"
          description="Don't show your region to other players"
          checked={privacy.hideRegion}
          onChange={() => togglePrivacy('hideRegion')}
          indent
        />
        )}
        {show('hide discord', 'discord', 'non-friends', 'username') && (
        <ToggleRow
          label="Hide Discord from Non-Friends"
          description="Only show your Discord username to accepted friends"
          checked={privacy.hideDiscordUnlessFriends}
          onChange={() => togglePrivacy('hideDiscordUnlessFriends')}
          indent
        />
        )}
        {show('hide discord photo', 'avatar', 'photo', 'character icon') && (
        <ToggleRow
          label="Hide Discord Photo"
          description="Show your main character icon instead of your Discord avatar"
          checked={privacy.hideAvatar}
          onChange={() => togglePrivacy('hideAvatar')}
          indent
        />
        )}
        {show('connection type', 'wifi', 'ethernet') && (
          <ToggleRow
            label="Hide Connection Type"
            description="Don't show whether you're on Wi-Fi or Ethernet"
            checked={privacy.hideConnectionType}
            onChange={() => togglePrivacy('hideConnectionType')}
            indent
          />
        )}
      </div>
      )}

      {show('social', 'status preset', 'nudge', 'ggs', 'friendlies', 'chat') && (
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] divide-y divide-[#2a2a2a]">
        <div className="p-5">
          <p className="text-sm font-medium text-gray-300">Social Features</p>
          <p className="text-xs text-gray-500 mt-0.5">Control which social features are enabled</p>
        </div>
        {show('status preset', 'down for friendlies', 'status') && (
        <ToggleRow
          label="Status Presets"
          description="Show status presets like 'Down for friendlies' on your card and see others' statuses"
          checked={!settings.disableStatuses}
          onChange={() => toggle('disableStatuses')}
          indent
        />
        )}
        {show('nudge', 'ggs', 'quick message') && (
        <ToggleRow
          label="Nudges"
          description="Receive and send quick messages like 'GGs' to other players"
          checked={!settings.disableNudges}
          onChange={() => toggle('disableNudges')}
          indent
        />
        )}
        {show('chat', 'chatroom', 'disable chat') && (
        <ToggleRow
          label="Chat"
          description="Show the public chatroom tab"
          checked={!settings.disableChat}
          onChange={() => toggle('disableChat')}
          indent
        />
        )}
      </div>
      )}

      {blockedUsers.length > 0 && show('block', 'unblock', 'blocked users') && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] divide-y divide-[#2a2a2a]">
          <div className="p-5">
            <p className="text-sm font-medium text-gray-300">Blocked Users</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Blocked users can't send you requests, invites, or appear on Discover
            </p>
          </div>
          {blockedUsers.map((b) => (
            <div key={b.connectCode} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3 min-w-0">
                {b.avatarUrl ? (
                  <img src={b.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover shrink-0 border border-[#2a2a2a]" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-gray-600 text-[10px] font-bold shrink-0">
                    {b.connectCode.slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0">
                  <span className="font-mono font-bold text-white text-sm">{b.connectCode}</span>
                  {b.displayName && (
                    <p className="text-xs text-gray-500 truncate">{b.displayName}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleUnblock(b.connectCode)}
                disabled={unblocking === b.connectCode}
                className="shrink-0 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white hover:bg-[#222] transition-colors disabled:opacity-40"
              >
                {unblocking === b.connectCode ? '...' : 'Unblock'}
              </button>
            </div>
          ))}
        </div>
      )}

      {show('account', 'log out', 'logout', 'update', 'version') && (
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-5">
        <h3 className="text-sm font-medium text-gray-300 mb-4">Account</h3>
        <div className="flex gap-3">
          <button
            onClick={handleLogout}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
          >
            Log Out
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setUpdateMsg(null); window.api.checkForUpdates(); }}
              className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-[#222] hover:text-white"
            >
              Check for Updates
            </button>
            {updateMsg && (
              <span className="text-xs font-medium text-[#21BA45]">{updateMsg}</span>
            )}
          </div>
        </div>
      </div>
      )}

      {sq && !['replay', 'directory', 'display region', 'region', 'launch', 'login', 'close', 'tray', 'slippi', 'launcher', 'install', 'path', 'custom', 'notification', 'friend online', 'play invite', 'sound', 'volume', 'test', 'reduce', 'background', 'performance', 'polling', 'game', 'privacy', 'friend request', 'hide', 'online status', 'location', 'discord', 'avatar', 'photo', 'connection type', 'social', 'status preset', 'nudge', 'ggs', 'friendlies', 'chat', 'chatroom', 'disable chat', 'block', 'unblock', 'blocked users', 'account', 'log out', 'logout', 'update', 'version'].some(t => t.includes(sq)) && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center">
          <p className="text-gray-500 text-sm">No settings match "{searchQuery}"</p>
        </div>
      )}

      {pStats && myCode && DEBUG_CONNECT_CODES.includes(myCode) && !sq && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Connection Health</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Realtime</span>
              <span className={pStats.realtimeConnected ? 'text-[#21BA45]' : 'text-red-400'}>
                {pStats.realtimeConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">DB writes</span>
              <span className="text-gray-300">{pStats.upsertOk} ok / {pStats.upsertFail} fail</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Writes skipped</span>
              <span className="text-gray-300">{pStats.upsertSkipped}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Realtime tracks</span>
              <span className="text-gray-300">{pStats.trackOk} ok / {pStats.trackFail} fail</span>
            </div>
          </div>
          {pStats.lastError && (
            <p className="mt-2 text-[10px] text-red-400/70 truncate">Last error: {pStats.lastError}</p>
          )}
        </div>
      )}

      {myCode && DEBUG_CONNECT_CODES.includes(myCode) && !sq && (
        <DebugLaunchPanel />
      )}

      {metrics && myCode && DEBUG_CONNECT_CODES.includes(myCode) && !sq && (() => {
        const labelMap: Record<string, string> = {
          Browser: 'Main process',
          Tab: 'Renderer (UI)',
          GPU: 'GPU compositing',
          Utility: 'Network / utility',
        };
        const totalCpu = metrics.reduce((s, m) => s + m.cpu.percentCPUUsage, 0);
        const totalMem = metrics.reduce((s, m) => s + m.memory.workingSetSize, 0);
        const fmtCpu = (v: number) => v.toFixed(2).padStart(6);
        const fmtMem = (v: number) => `${(v / 1024).toFixed(0)}`.padStart(4);
        return (
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Performance</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-gray-600">
                  <td className="pb-2">Process</td>
                  <td className="pb-2 text-right">CPU</td>
                  <td className="pb-2 text-right">RAM</td>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {metrics.map((m) => (
                  <tr key={m.pid}>
                    <td className="text-gray-500 py-0.5 pr-4 font-sans">{labelMap[m.type] || m.type}</td>
                    <td className="text-gray-300 py-0.5 text-right whitespace-pre">{fmtCpu(m.cpu.percentCPUUsage)}%</td>
                    <td className="text-gray-300 py-0.5 text-right whitespace-pre">{fmtMem(m.memory.workingSetSize)} MB</td>
                  </tr>
                ))}
                <tr className="border-t border-[#2a2a2a]">
                  <td className="text-gray-400 font-medium pt-2 font-sans">Total</td>
                  <td className="text-white font-medium pt-2 text-right whitespace-pre">{fmtCpu(totalCpu)}%</td>
                  <td className="text-white font-medium pt-2 text-right whitespace-pre">{fmtMem(totalMem)} MB</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })()}

      <p className="text-center text-xs text-gray-600">
      friendlies v1.0.35
      </p>
    </div>
  );
}

function DebugLaunchPanel() {
  const [status, setStatus] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    window.api.getDirectConnectStatus().then((s) => {
      setActive(s.active);
      if (s.active) setStatus(s.status);
    });
    const unsub = window.api.onDirectConnectStatus((evt: any) => {
      const msg = evt.error ? `${evt.status}: ${evt.error}` : evt.status;
      setStatus(msg);
      setActive(evt.status !== 'stopped' && evt.status !== 'error');
      setLog((prev) => [...prev.slice(-50), `${new Date().toLocaleTimeString()} ${msg}`]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function handleLaunch() {
    setLog([]);
    setStatus('starting...');
    setActive(true);
    const result = await window.api.startDirectConnect('MANG#0');
    if (result?.error) {
      setStatus(`error: ${result.error}`);
      setActive(false);
      setLog((prev) => [...prev, `${new Date().toLocaleTimeString()} error: ${result.error}`]);
    }
  }

  async function handleStop() {
    await window.api.stopDirectConnect();
    setActive(false);
    setStatus('stopped');
  }

  return (
    <div className="rounded-2xl border border-yellow-500/30 bg-[#141414] p-5">
      <h3 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-3">Launch Dolphin (debug)</h3>
      <p className="text-xs text-gray-500 mb-3">
        Launches Dolphin and injects <span className="font-mono text-gray-400">MANG#0</span> as the direct connect code.
      </p>
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={handleLaunch}
          disabled={active}
          className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-400 transition-colors hover:bg-yellow-500/20 disabled:opacity-40"
        >
          {active ? 'Running...' : 'Launch'}
        </button>
        {active && (
          <button
            onClick={handleStop}
            className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-[#222] hover:text-white"
          >
            Stop
          </button>
        )}
        {status && (
          <span className={`text-xs font-medium ${
            status.startsWith('error') ? 'text-red-400' :
            status === 'stopped' ? 'text-gray-500' :
            'text-yellow-400'
          }`}>
            {status}
          </span>
        )}
      </div>
      {log.length > 0 && (
        <pre
          ref={logRef}
          className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-[#0a0a0a] border border-[#2a2a2a] p-3 text-[10px] text-gray-500 font-mono leading-relaxed"
        >
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  indent,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between p-5 ${indent ? 'pl-10' : ''} ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div>
        <p className="text-sm font-medium text-gray-300">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <button
        onClick={onChange}
        disabled={disabled}
        className={`relative w-11 h-6 rounded-full transition-colors ${
          checked ? 'bg-[#21BA45]' : 'bg-[#333]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </div>
  );
}
