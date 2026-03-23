import { useEffect, useState } from 'react';

interface SettingsState {
  replayDir: string;
  autoLaunch: boolean;
  showNotifications: boolean;
}

export function Settings() {
  const [settings, setSettings] = useState<SettingsState>({
    replayDir: '',
    autoLaunch: false,
    showNotifications: true,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings({
        replayDir: s.replayDir || '',
        autoLaunch: s.autoLaunch || false,
        showNotifications: s.showNotifications !== false,
      });
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

  async function toggle(key: 'autoLaunch' | 'showNotifications') {
    const next = !settings[key];
    setSettings((s) => ({ ...s, [key]: next }));
    await window.api.updateSettings({ [key]: next });
    flash();
  }

  async function handleLogout() {
    await window.api.logout();
    window.location.hash = '/setup';
  }

  function flash() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

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
          description="Start Slippi Friends automatically when you log in"
          checked={settings.autoLaunch}
          onChange={() => toggle('autoLaunch')}
        />

        <ToggleRow
          label="Notifications"
          description="Show desktop notifications for new opponents"
          checked={settings.showNotifications}
          onChange={() => toggle('showNotifications')}
        />
      </div>

      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-5">
        <h3 className="text-sm font-medium text-gray-300 mb-4">Account</h3>
        <button
          onClick={handleLogout}
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
        >
          Log Out
        </button>
      </div>

      <p className="text-center text-xs text-gray-600">
        Slippi Friends v0.1.13
      </p>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-5">
      <div>
        <p className="text-sm font-medium text-gray-300">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <button
        onClick={onChange}
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
