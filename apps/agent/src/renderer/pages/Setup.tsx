import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type Step = 'replay' | 'identity' | 'done';

interface SetupProps {
  onComplete: () => void;
}

export function Setup({ onComplete }: SetupProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('replay');
  const [replayDir, setReplayDir] = useState('');
  const [detectedDir, setDetectedDir] = useState('');
  const [identity, setIdentity] = useState<{
    connectCode: string;
    displayName: string;
  } | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setReplayDir(s.replayDir || '');
      setDetectedDir(s.replayDir || '');
    });
  }, []);

  useEffect(() => {
    if (step === 'identity') {
      checkIdentity();
    }
  }, [step]);

  async function checkIdentity() {
    setIdentityLoading(true);
    const id = await window.api.getIdentity();
    if (id) setIdentity(id);
    setIdentityLoading(false);
  }

  async function handleBrowse() {
    const dir = await window.api.browseDirectory();
    if (dir) setReplayDir(dir);
  }

  async function handleFinish() {
    setLoading(true);
    try {
      await window.api.updateSettings({
        replayDir,
        setupComplete: true,
      });
      onComplete();
      navigate('/', { replace: true });
    } catch (e: any) {
      setError(e.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  }

  const steps: Step[] = ['replay', 'identity', 'done'];
  const stepIdx = steps.indexOf(step);

  return (
    <div className="flex items-center justify-center min-h-screen p-8">
      <div className="w-full max-w-lg">
        <div className="fixed top-0 left-0 right-0 h-[52px] drag" />
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-display font-bold">
            <span className="text-[#21BA45]">Friendlies</span>
          </h1>
          <p className="text-sm text-gray-500 mt-2">Let's get you set up</p>
          <div className="flex justify-center gap-2 mt-6">
            {steps.map((s, i) => (
              <div
                key={s}
                className={`h-1.5 w-16 rounded-full transition-colors ${
                  i <= stepIdx ? 'bg-[#21BA45]' : 'bg-[#2a2a2a]'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-8">
          {step === 'replay' && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="text-5xl mb-4">📂</div>
                <h2 className="text-xl font-semibold">Replay Directory</h2>
                <p className="text-gray-400 text-sm mt-2">
                  Where does Slippi save your replay files?
                </p>
              </div>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={replayDir}
                    onChange={(e) => setReplayDir(e.target.value)}
                    className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-[#21BA45]/50"
                    placeholder="/path/to/Slippi"
                  />
                  <button
                    onClick={handleBrowse}
                    className="shrink-0 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-[#222] hover:text-white"
                  >
                    Browse
                  </button>
                </div>
                {detectedDir && detectedDir !== replayDir && (
                  <button
                    onClick={() => setReplayDir(detectedDir)}
                    className="text-xs text-[#21BA45] hover:underline"
                  >
                    Use detected path: {detectedDir}
                  </button>
                )}
              </div>
              <button
                onClick={() => setStep('identity')}
                disabled={!replayDir}
                className="w-full rounded-xl bg-[#21BA45] px-6 py-3 font-semibold text-white transition-all hover:bg-[#1ea33e] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          )}

          {step === 'identity' && (
            <div className="text-center space-y-6">
              <div className="text-5xl">🏷️</div>
              <h2 className="text-xl font-semibold">Slippi Connect Code</h2>
              {identityLoading ? (
                <p className="text-gray-500 text-sm animate-pulse">Checking for Slippi Launcher...</p>
              ) : identity ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[#21BA45]/30 bg-[#21BA45]/5 p-6">
                    <p className="text-2xl font-mono font-bold text-white tracking-wider">
                      {identity.connectCode}
                    </p>
                    {identity.displayName && (
                      <p className="text-sm text-gray-400 mt-1">{identity.displayName}</p>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    Detected from your Slippi Launcher
                  </p>
                  <button
                    onClick={async () => {
                      await window.api.linkIdentity();
                      setStep('done');
                    }}
                    className="w-full rounded-xl bg-[#21BA45] px-6 py-3 font-semibold text-white transition-all hover:bg-[#1ea33e]"
                  >
                    That's Me
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-5 text-left">
                    <p className="text-sm text-yellow-200/90 font-medium mb-2">
                      Slippi Launcher not detected
                    </p>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      To link your connect code, open <strong className="text-white">Slippi Launcher</strong> and
                      make sure you're logged in. Then click Retry below.
                    </p>
                    <p className="text-xs text-gray-500 mt-3">
                      If you don't have Slippi Launcher, download it from{' '}
                      <button
                        onClick={() => window.api.openExternal('https://slippi.gg')}
                        className="text-[#21BA45] hover:underline"
                      >
                        slippi.gg
                      </button>
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={checkIdentity}
                      className="flex-1 rounded-xl bg-[#21BA45] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1ea33e] transition-colors"
                    >
                      Retry Detection
                    </button>
                    <button
                      onClick={() => setStep('done')}
                      className="flex-1 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3 text-sm font-medium text-gray-400 hover:text-white hover:bg-[#222] transition-colors"
                    >
                      Skip for Now
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="text-center space-y-6">
              <div className="text-5xl">🚀</div>
              <h2 className="text-xl font-semibold">You're All Set!</h2>
              <p className="text-gray-400 text-sm leading-relaxed">
                Friendlies will run in your menu bar, tracking your sessions
                and keeping you connected with your community.
              </p>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                onClick={handleFinish}
                disabled={loading}
                className="w-full rounded-xl bg-[#21BA45] px-6 py-3 font-semibold text-white transition-all hover:bg-[#1ea33e] hover:shadow-[0_0_30px_rgba(33,186,69,0.3)] disabled:opacity-60"
              >
                {loading ? 'Finishing...' : 'Start Playing'}
              </button>
            </div>
          )}
        </div>

        {step !== 'replay' && step !== 'done' && (
          <button
            onClick={() => {
              const idx = steps.indexOf(step);
              if (idx > 0) setStep(steps[idx - 1]);
            }}
            className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}
