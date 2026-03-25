import { useEffect, useState } from 'react';
import { CharacterIcon } from './CharacterIcon';
import { RankBadge } from './RankBadge';

interface SlippiStats {
  displayName: string;
  connectCode: string;
  rankedRating: number | null;
  rankedWins: number;
  rankedLosses: number;
  globalPlacement: number | null;
  continent: string | null;
  characters: Array<{ character: number; gameCount: number }>;
}

export function PlayerStatsPanel({ connectCode, topCharacters }: {
  connectCode: string;
  topCharacters?: { characterId: number; gameCount: number }[];
}) {
  const [stats, setStats] = useState<SlippiStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    window.api.lookupSlippiPlayer(connectCode).then((data: SlippiStats | null) => {
      if (cancelled) return;
      if (data) setStats(data);
      else setError(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [connectCode]);

  if (loading) {
    return (
      <div className="px-4 py-3 text-xs text-gray-500 animate-pulse">
        Loading stats from slippi.gg...
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="px-4 py-3 text-xs text-gray-600">
        Could not load stats.{' '}
        <button
          onClick={() => window.api.openExternal(`https://slippi.gg/user/${connectCode.replace('#', '-')}`)}
          className="text-[#21BA45] hover:underline"
        >
          View on slippi.gg
        </button>
      </div>
    );
  }

  const winRate = stats.rankedWins + stats.rankedLosses > 0
    ? ((stats.rankedWins / (stats.rankedWins + stats.rankedLosses)) * 100).toFixed(1)
    : null;

  const topChars = topCharacters && topCharacters.length > 0
    ? topCharacters.slice(0, 3).map((tc) => ({ character: tc.characterId, gameCount: tc.gameCount }))
    : [...stats.characters].sort((a, b) => b.gameCount - a.gameCount).slice(0, 3);

  return (
    <div className="border-t border-[#2a2a2a] bg-[#0e0e0e] px-4 py-3 space-y-3 rounded-b-xl">
      <div className="flex items-center gap-4 flex-wrap">
        {stats.rankedRating != null && (
          <div className="flex items-center gap-2">
            <RankBadge rating={stats.rankedRating} />
            <span className="text-xs text-gray-400 font-mono">
              {stats.rankedRating.toFixed(1)} ELO
            </span>
          </div>
        )}
        {stats.globalPlacement != null && (
          <span className="text-xs text-gray-500">
            #{stats.globalPlacement} global
          </span>
        )}
        {stats.continent && (
          <span className="text-xs text-gray-600">{stats.continent}</span>
        )}
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="text-sm font-bold text-[#21BA45]">{stats.rankedWins}</p>
            <p className="text-[10px] text-gray-600 uppercase">Wins</p>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-red-400">{stats.rankedLosses}</p>
            <p className="text-[10px] text-gray-600 uppercase">Losses</p>
          </div>
          {winRate && (
            <div className="text-center">
              <p className="text-sm font-bold text-white">{winRate}%</p>
              <p className="text-[10px] text-gray-600 uppercase">Win Rate</p>
            </div>
          )}
        </div>

        {topChars.length > 0 && (
          <div className="flex items-center gap-1 ml-auto">
            {topChars.map((c) => (
              <div key={c.character} className="flex items-center gap-1">
                <CharacterIcon characterId={c.character} size="sm" showName={false} />
                <span className="text-[10px] text-gray-500">{c.gameCount}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => window.api.openExternal(`https://slippi.gg/user/${connectCode.replace('#', '-')}`)}
        className="text-[10px] text-[#21BA45]/60 hover:text-[#21BA45] transition-colors"
      >
        View full profile on slippi.gg →
      </button>
    </div>
  );
}
