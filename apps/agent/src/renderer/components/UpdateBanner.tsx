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

  useEffect(() => {
    return window.api.onUpdateStatus((s: UpdateStatus) => {
      setStatus(s);
      if (s.state === 'available' || s.state === 'downloaded') {
        setDismissed(false);
      }
    });
  }, []);

  if (dismissed || !status) return null;
  if (status.state === 'not-available' || status.state === 'checking') return null;
  if (status.state === 'error') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs animate-in slide-in-from-bottom">
      <div className="rounded-xl border border-white/10 bg-[#1a1a2e]/95 backdrop-blur-sm shadow-2xl p-4 space-y-3">
        {status.state === 'available' && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">
                v{status.version} available
              </span>
              <button
                onClick={() => setDismissed(true)}
                className="text-gray-500 hover:text-gray-300 text-xs ml-3"
              >
                ✕
              </button>
            </div>
            <button
              onClick={() => window.api.downloadUpdate()}
              className="w-full rounded-lg bg-[#21BA45] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#1ea33e]"
            >
              Download Update
            </button>
          </>
        )}

        {status.state === 'downloading' && (
          <>
            <div className="text-sm text-gray-300">Downloading update…</div>
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#21BA45] transition-all duration-300"
                style={{ width: `${status.percent}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 text-right">{status.percent}%</div>
          </>
        )}

        {status.state === 'downloaded' && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">
                v{status.version} ready
              </span>
              <button
                onClick={() => setDismissed(true)}
                className="text-gray-500 hover:text-gray-300 text-xs ml-3"
              >
                ✕
              </button>
            </div>
            <button
              onClick={() => window.api.installUpdate()}
              className="w-full rounded-lg bg-[#21BA45] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#1ea33e]"
            >
              Restart & Install
            </button>
          </>
        )}
      </div>
    </div>
  );
}
