import { useEffect, useState } from 'react';

interface SettingsState {
  replayDir: string;
  autoLaunch: boolean;
  showNotifications: boolean;
  notifyFriendOnline: boolean;
  notifyPlayInvite: boolean;
}

export function Settings() {
  const [settings, setSettings] = useState<SettingsState>({
    replayDir: '',
    autoLaunch: false,
    showNotifications: true,
    notifyFriendOnline: true,
    notifyPlayInvite: true,
  });
  const [saved, setSaved] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings({
        replayDir: s.replayDir || '',
        autoLaunch: s.autoLaunch || false,
        showNotifications: s.showNotifications !== false,
        notifyFriendOnline: s.notifyFriendOnline !== false,
        notifyPlayInvite: s.notifyPlayInvite !== false,
      });
    });
    return window.api.onUpdateStatus((s: any) => {
      if (s.state === 'not-available') setUpdateMsg('Up to date');
      else if (s.state === 'available') setUpdateMsg(null);
      else if (s.state === 'error') setUpdateMsg(null);
    });
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

  async function handleLogout() {
    await window.api.logout();
    window.location.reload();
  }

  function flash() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const notifsEnabled = settings.showNotifications;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold">Settings</h1>
        {saved && (
          <span className="text-xs text-[#21BA45] font-medium animate-pulse">Saved</span>
        )}
      </div>

      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] divide-y divide-[#2a2a2a]">
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

        <ToggleRow
          label="Launch at Login"
          description="Start Friendlies automatically when you log in"
          checked={settings.autoLaunch}
          onChange={() => toggle('autoLaunch')}
        />
      </div>

      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] divide-y divide-[#2a2a2a]">
        <ToggleRow
          label="Notifications"
          description="Enable desktop notifications"
          checked={settings.showNotifications}
          onChange={() => toggle('showNotifications')}
        />

        <ToggleRow
          label="Friend Online"
          description="Notify when a friend comes online or enters a game"
          checked={notifsEnabled && settings.notifyFriendOnline}
          onChange={() => toggle('notifyFriendOnline')}
          disabled={!notifsEnabled}
          indent
        />

        <ToggleRow
          label="Play Invites"
          description="Notify when a friend invites you to play"
          checked={notifsEnabled && settings.notifyPlayInvite}
          onChange={() => toggle('notifyPlayInvite')}
          disabled={!notifsEnabled}
          indent
        />
      </div>

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

      <p className="text-center text-xs text-gray-600">
        Friendlies v0.1.33
      </p>
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
