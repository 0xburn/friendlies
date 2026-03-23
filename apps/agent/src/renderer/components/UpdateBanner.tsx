import { useEffect, useState } from 'react';

type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    return window.api.onUpdateStatus((s: UpdateStatus) => {
      setStatus(s);
      if ((s.state === 'available' || s.state === 'downloaded') && 'version' in s) {
        setVersion(s.version);
        setDismissed(false);
      }
    });
  }, []);

  if (dismissed || !status) return null;
  if (status.state === 'not-available' || status.state === 'checking') return null;

  if (status.state === 'error') {
    return (
      <div className="fixed bottom-4 right-4 z-50 w-72">
        <div className="rounded-xl border border-red-500/20 bg-[#1a1a2e]/95 backdrop-blur-sm shadow-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-red-400">Update error</span>
            <button onClick={() => setDismissed(true)} className="text-gray-500 hover:text-gray-300 text-xs ml-3">✕</button>
          </div>
          <p className="text-[11px] text-gray-400 break-all">{status.message}</p>
          <button
            onClick={() => window.api.checkForUpdates()}
            className="w-full rounded-lg bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/20"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isDownloading = status.state === 'downloading';
  const isReady = status.state === 'downloaded';

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 animate-in slide-in-from-bottom">
      <div className="rounded-xl border border-white/10 bg-[#1a1a2e]/95 backdrop-blur-sm shadow-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">
            {isReady ? `v${version} ready to install` : `v${version} available`}
          </span>
          {!isDownloading && (
            <button
              onClick={() => setDismissed(true)}
              className="text-gray-500 hover:text-gray-300 text-xs ml-3"
            >
              ✕
            </button>
          )}
        </div>

        {isDownloading && (
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#21BA45] transition-all duration-300"
                style={{ width: `${status.percent}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-500 text-right">Downloading… {status.percent}%</p>
          </div>
        )}

        {status.state === 'available' && (
          <button
            onClick={() => window.api.downloadUpdate()}
            className="w-full rounded-lg bg-[#21BA45] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#1ea33e]"
          >
            Download Update
          </button>
        )}

        {isReady && (
          <button
            onClick={() => window.api.installUpdate()}
            className="w-full rounded-lg bg-[#21BA45] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#1ea33e]"
          >
            Restart & Install
          </button>
        )}
      </div>
    </div>
  );
}
