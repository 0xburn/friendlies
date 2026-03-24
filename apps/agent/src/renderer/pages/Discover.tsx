import { useEffect, useState } from 'react';
import { PlayerCard } from '../components/PlayerCard';

interface DiscoverPlayer {
  userId: string;
  connectCode: string;
  displayName?: string;
  avatarUrl?: string;
  rating: number | null;
  characterId: number | null;
  status: 'online' | 'in-game';
  currentCharacter: number | null;
  opponentCode: string | null;
  playingSince: string | null;
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-3 flex items-center gap-3 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-[#1a1a1a]" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-24 rounded bg-[#1a1a1a]" />
        <div className="h-2.5 w-16 rounded bg-[#1a1a1a]" />
      </div>
      <div className="h-3 w-10 rounded bg-[#1a1a1a]" />
    </div>
  );
}

export function Discover() {
  const [players, setPlayers] = useState<DiscoverPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  async function load() {
    try {
      const data = await window.api.discoverPlayers();
      setPlayers(data || []);
    } catch {}
    setLoading(false);
    setLastRefresh(Date.now());
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function handleAdd(connectCode: string) {
    setAdding(connectCode);
    const result = await window.api.addFriend(connectCode);
    if (result.ok || result.mutual) {
      setAdded((prev) => new Set(prev).add(connectCode));
    }
    setAdding(null);
  }

  async function handleCopy(code: string) {
    await window.api.copyToClipboard(code);
  }

  const ago = Math.round((Date.now() - lastRefresh) / 1000);
  const refreshLabel = ago < 5 ? 'just now' : `${ago}s ago`;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Discover</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Players online now, sorted by proximity
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); load(); }}
          className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white hover:bg-[#222] transition-all"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        {loading && players.length === 0 && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {!loading && players.length === 0 && (
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center">
            <p className="text-gray-500 text-sm">
              No players online right now. Check back later!
            </p>
          </div>
        )}

        {players.map((p) => {
          const isAdded = added.has(p.connectCode);
          return (
            <div key={p.userId} className="group flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <PlayerCard
                  player={{
                    connectCode: p.connectCode,
                    displayName: p.displayName,
                    avatarUrl: p.avatarUrl,
                    rating: p.rating,
                    characterId: p.characterId,
                    status: p.status,
                    currentCharacter: p.currentCharacter,
                    opponentCode: p.opponentCode,
                    playingSince: p.playingSince,
                  }}
                  onClick={() => handleCopy(p.connectCode)}
                />
              </div>
              {isAdded ? (
                <span className="shrink-0 text-[10px] font-medium text-[#21BA45]">Added!</span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); handleAdd(p.connectCode); }}
                  disabled={adding === p.connectCode}
                  className="shrink-0 opacity-0 group-hover:opacity-100 rounded-lg bg-[#21BA45]/10 px-3 py-1.5 text-xs font-medium text-[#21BA45] hover:bg-[#21BA45]/20 transition-all"
                >
                  {adding === p.connectCode ? '...' : '+ Add'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
