import { useEffect, useState } from 'react';

const NUDGE_OPTIONS = ['GGs', 'one more', 'gtg', 'you play so hot and cool', 'that was sick', "you're cracked", "i'm cracked", "i'm so high", 'check discord', 'hi'];

interface Nudge {
  id: string;
  senderId: string;
  connectCode: string;
  displayName: string | null;
  discordUsername: string | null;
  avatarUrl: string | null;
  message: string;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function GGs() {
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});

  useEffect(() => {
    window.api.getSettings().then((s: any) => {
      if (s.disableNudges) {
        setDisabled(true);
        setLoading(false);
        return;
      }
      loadNudges().finally(() => setLoading(false));
    });

    const poll = setInterval(() => {
      if (!document.hidden) loadNudges();
    }, 30_000);
    const onVisible = () => { if (!document.hidden) loadNudges(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  async function loadNudges() {
    try {
      const data = await window.api.getNudges();
      setNudges(data || []);
      if (data?.length) {
        window.api.markNudgesSeen(data.map((n: any) => n.id));
      }
    } catch {}
  }

  async function handleReply(connectCode: string, message: string) {
    setSending(connectCode);
    const result = await window.api.sendNudge(connectCode, message);
    if (result.error) {
      setSent((prev) => ({ ...prev, [connectCode]: result.error! }));
    } else {
      setSent((prev) => ({ ...prev, [connectCode]: message }));
    }
    setSending(null);
    setReplyOpen(null);
    setTimeout(() => setSent((prev) => {
      const next = { ...prev };
      delete next[connectCode];
      return next;
    }), 3000);
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-display font-bold">GGs</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          {disabled ? 'Nudges are disabled. You can re-enable them in Settings.' : 'Quick nudges from other players'}
        </p>
      </div>

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#1a1a1a]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-24 rounded bg-[#1a1a1a]" />
                  <div className="h-2.5 w-16 rounded bg-[#1a1a1a]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && nudges.length === 0 && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center space-y-4">
          <p className="text-4xl">🤜🤛</p>
          <p className="text-gray-400 text-sm font-medium">No nudges yet</p>
          <div className="text-xs text-gray-500 leading-relaxed max-w-sm mx-auto space-y-2">
            <p>
              Nudges are quick, lightweight messages you can send to other players.
      
            </p>
            <p>
              To send a nudge, hover over a friend on the Friends page and tap the
              nudge button. You can send things like "GGs", "one more", or "gtg".
            </p>
            <p>
              When someone nudges you, it will show up here and you can reply back. This can be disabled in Settings. 
            </p>
          </div>
        </div>
      )}

      {!loading && nudges.length > 0 && (
        <div className="space-y-2">
          {nudges.map((nudge) => {
            const sentMsg = sent[nudge.connectCode];
            return (
              <div key={nudge.id} className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4">
                <div className="flex items-center gap-3">
                  {nudge.avatarUrl ? (
                    <img src={nudge.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-[#2a2a2a]" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-gray-600 text-xs font-bold shrink-0">
                      {nudge.connectCode.slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-white text-sm">{nudge.connectCode}</span>
                      {nudge.displayName && (
                        <span className="text-xs text-gray-500 truncate">{nudge.displayName}</span>
                      )}
                    </div>
                    <p className="text-sm text-amber-400 font-medium mt-0.5">"{nudge.message}"</p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="text-[10px] text-gray-600">{timeAgo(nudge.createdAt)}</span>
                    {sentMsg ? (
                      <span className={`text-[10px] font-medium ${sentMsg === nudge.message || NUDGE_OPTIONS.includes(sentMsg) ? 'text-[#21BA45]' : 'text-yellow-500'}`}>
                        {NUDGE_OPTIONS.includes(sentMsg) ? 'Sent!' : sentMsg}
                      </span>
                    ) : replyOpen === nudge.id ? (
                      <div className="flex flex-wrap gap-1 justify-end max-w-[200px]">
                        {NUDGE_OPTIONS.map((opt) => (
                          <button
                            key={opt}
                            onClick={() => handleReply(nudge.connectCode, opt)}
                            disabled={sending === nudge.connectCode}
                            className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                          >
                            {opt}
                          </button>
                        ))}
                        <button
                          onClick={() => setReplyOpen(null)}
                          className="rounded-md px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                        >
                          cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReplyOpen(nudge.id)}
                        className="rounded-md bg-[#21BA45]/10 px-2.5 py-1 text-[10px] font-medium text-[#21BA45] hover:bg-[#21BA45]/20 transition-colors"
                      >
                        Reply
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
