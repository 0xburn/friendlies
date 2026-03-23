import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { Setup } from './pages/Setup';
import { Dashboard } from './pages/Dashboard';
import { Friends } from './pages/Friends';
import { Opponents } from './pages/Opponents';
import { Settings } from './pages/Settings';
import { UpdateBanner } from './components/UpdateBanner';

type BootState =
  | { phase: 'loading' }
  | { phase: 'no-slippi' }
  | { phase: 'banned'; reason: string; claimedCode?: string; actualCode?: string }
  | { phase: 'need-auth'; connectCode: string; displayName: string }
  | { phase: 'need-setup'; connectCode: string }
  | { phase: 'ready' };

function SlippiNotFound() {
  const [checking, setChecking] = useState(false);

  async function retry() {
    setChecking(true);
    const id = await window.api.getIdentity();
    if (id) window.location.reload();
    setChecking(false);
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md px-8">
        <div className="fixed top-0 left-0 right-0 h-[52px] drag" />
        <div className="text-center space-y-6">
          <div className="flex flex-col items-center gap-3">
            <img src="./logo.png" alt="L7" className="w-16 h-16" />
            <h1 className="text-3xl font-display font-bold">
              Slippi <span className="text-[#21BA45]">Friends</span>
            </h1>
          </div>
          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-6 text-left">
            <p className="text-sm text-yellow-200/90 font-medium mb-2">
              Slippi Launcher not detected
            </p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Open <strong className="text-white">Slippi Launcher</strong> and log in
              to your Slippi account. Slippi Friends needs your connect code to identify you.
            </p>
            <p className="text-xs text-gray-500 mt-3">
              Don't have Slippi Launcher?{' '}
              <button
                onClick={() => window.api.openExternal('https://slippi.gg')}
                className="text-[#21BA45] hover:underline"
              >
                Download from slippi.gg
              </button>
            </p>
          </div>
          <button
            onClick={retry}
            disabled={checking}
            className="w-full rounded-xl bg-[#21BA45] px-6 py-3 font-semibold text-white transition-all hover:bg-[#1ea33e] disabled:opacity-60"
          >
            {checking ? 'Checking...' : 'I\'ve Logged In — Retry'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthPrompt({ connectCode, displayName }: { connectCode: string; displayName: string }) {
  const [waiting, setWaiting] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  useEffect(() => {
    const unsub = window.api.onAuthChanged((user) => {
      if (user) window.location.reload();
    });
    return unsub;
  }, []);

  async function handleAuth() {
    setWaiting(true);
    try {
      const url = await window.api.startAuth();
      if (url) setAuthUrl(url);
    } catch {
      setWaiting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md px-8">
        <div className="fixed top-0 left-0 right-0 h-[52px] drag" />
        <div className="text-center space-y-6">
          <div className="flex flex-col items-center gap-3">
            <img src="./logo.png" alt="L7" className="w-16 h-16 rounded-2xl" />
            <h1 className="text-3xl font-display font-bold">
              Slippi <span className="text-[#21BA45]">Friends</span>
            </h1>
          </div>
          <div className="rounded-xl border border-[#21BA45]/30 bg-[#21BA45]/5 p-5">
            <p className="text-2xl font-mono font-bold text-white tracking-wider">
              {connectCode}
            </p>
            {displayName && <p className="text-sm text-gray-400 mt-1">{displayName}</p>}
          </div>
          <p className="text-gray-400 text-sm leading-relaxed">
            Link your Discord account to sync friends, track opponents,
            and show your online status. You only need to do this once.
          </p>
          <button
            onClick={handleAuth}
            disabled={waiting}
            className="w-full rounded-xl bg-[#5865F2] px-6 py-3.5 font-semibold text-white transition-all hover:bg-[#4752C4] disabled:opacity-70"
          >
            {waiting ? 'Waiting for Discord...' : 'Link Discord Account'}
          </button>
          {waiting && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 animate-pulse">
                Complete sign-in in your browser, then return here.
              </p>
              {authUrl && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">
                    Browser didn't open?{' '}
                    <button
                      onClick={() => window.api.openExternal(authUrl)}
                      className="text-[#21BA45] hover:underline"
                    >
                      Click here to open manually
                    </button>
                  </p>
                  <button
                    onClick={() => { window.api.copyToClipboard(authUrl); }}
                    className="text-xs text-gray-600 hover:text-gray-400"
                  >
                    Or copy link to clipboard
                  </button>
                </div>
              )}
              <button
                onClick={() => { setWaiting(false); setAuthUrl(null); }}
                className="text-xs text-gray-600 hover:text-gray-400"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<BootState>({ phase: 'loading' });
  const [mismatch, setMismatch] = useState<{ claimedCode: string; actualCode: string } | null>(null);

  useEffect(() => {
    boot();
    const unsub = window.api.onIdentityMismatch((info) => {
      setMismatch({ claimedCode: info.claimedCode, actualCode: info.actualCode });
    });
    return unsub;
  }, []);

  async function boot() {
    const identity = await window.api.getIdentity();
    if (!identity) {
      setState({ phase: 'no-slippi' });
      return;
    }

    const authed = await window.api.isAuthenticated();
    if (!authed) {
      setState({ phase: 'need-auth', connectCode: identity.connectCode, displayName: identity.displayName });
      return;
    }

    const ban = await window.api.checkBlacklist();
    if (ban) {
      setState({
        phase: 'banned',
        reason: ban.reason,
        claimedCode: ban.claimed_code,
        actualCode: ban.actual_code,
      });
      return;
    }

    const setupDone = await window.api.isSetupComplete();
    if (!setupDone) {
      setState({ phase: 'need-setup', connectCode: identity.connectCode });
      return;
    }

    setState({ phase: 'ready' });
  }

  if (mismatch) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="fixed top-0 left-0 right-0 h-[52px] drag" />
        <div className="w-full max-w-md px-8 text-center space-y-6">
          <div className="text-5xl">⚠️</div>
          <h1 className="text-2xl font-display font-bold text-red-400">
            Identity Mismatch Detected
          </h1>
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 text-left space-y-3">
            <p className="text-sm text-red-200/90">
              Your claimed connect code <strong className="font-mono text-white">{mismatch.claimedCode}</strong> does
              not match the connect code found in your replays: <strong className="font-mono text-white">{mismatch.actualCode}</strong>.
            </p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Your profile has been unlinked and your account has been flagged. If
              this is an error, contact <span className="text-white font-medium">lucky7smelee@gmail.com</span> to appeal.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-xl bg-[#21BA45] px-6 py-3 font-semibold text-white transition-all hover:bg-[#1ea33e]"
          >
            Restart
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'banned') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="fixed top-0 left-0 right-0 h-[52px] drag" />
        <div className="w-full max-w-md px-8 text-center space-y-6">
          <div className="text-5xl">🚫</div>
          <h1 className="text-2xl font-display font-bold text-red-400">
            Account Suspended
          </h1>
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 text-left space-y-3">
            <p className="text-sm text-red-200/90">
              This account has been banned for identity spoofing.
            </p>
            {state.claimedCode && state.actualCode && (
              <p className="text-xs text-gray-500">
                Claimed <strong className="font-mono text-gray-400">{state.claimedCode}</strong>
                {' '}but played as <strong className="font-mono text-gray-400">{state.actualCode}</strong>.
              </p>
            )}
            <p className="text-xs text-gray-400 leading-relaxed">
              If you believe this is an error, contact{' '}
              <span className="text-white font-medium">lucky7smelee@gmail.com</span> to appeal.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="fixed top-0 left-0 right-0 h-[52px] drag" />
        <img src="./logo.png" alt="L7" className="w-20 h-20 animate-pulse" />
      </div>
    );
  }

  if (state.phase === 'no-slippi') return <SlippiNotFound />;

  if (state.phase === 'need-auth') {
    return <AuthPrompt connectCode={state.connectCode} displayName={state.displayName} />;
  }

  if (state.phase === 'need-setup') {
    return (
      <HashRouter>
        <Routes>
          <Route path="*" element={
            <Setup onComplete={() => setState({ phase: 'ready' })} />
          } />
        </Routes>
      </HashRouter>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<Navigation />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/friends" element={<Friends />} />
          <Route path="/opponents" element={<Opponents />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UpdateBanner />
    </HashRouter>
  );
}
