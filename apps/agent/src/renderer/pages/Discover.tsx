import { useEffect, useRef, useState } from 'react';
import { PlayerCard } from '../components/PlayerCard';
import { CHARACTER_MAP, getCharacterImagePath, getCharacterShortName } from '../lib/characters';

interface DiscoverPlayer {
  userId: string;
  connectCode: string;
  displayName?: string;
  discordUsername?: string | null;
  discordId?: string | null;
  avatarUrl?: string;
  rating: number | null;
  topCharacters: { characterId: number; gameCount: number }[];
  region: string | null;
  status: 'online' | 'in-game';
  currentCharacter: number | null;
  opponentCode: string | null;
  playingSince: string | null;
  lastPlayedAt: string | null;
}

function formatLastPlayed(iso: string): string {
  const played = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - played.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return 'You played this person today!';
  if (diffDays === 1) return 'You played this person yesterday!';
  return `You played this person ${diffDays} days ago!`;
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

const HIDDEN_CHARACTERS = new Set([23]);
const ALL_CHARACTER_IDS = Object.keys(CHARACTER_MAP).map(Number)
  .filter((id) => !HIDDEN_CHARACTERS.has(id))
  .sort((a, b) => CHARACTER_MAP[a].localeCompare(CHARACTER_MAP[b]));

const TOP_CHARACTERS = [2, 20, 9, 19, 15, 12, 0];
const TOP_SET = new Set(TOP_CHARACTERS);
const REST_CHARACTERS = ALL_CHARACTER_IDS.filter((id) => !TOP_SET.has(id));

function CharacterFilter({ selected, onToggle, onClear }: {
  selected: Set<number>;
  onToggle: (id: number) => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const hasRestSelected = REST_CHARACTERS.some((id) => selected.has(id));

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">Filter by character</span>
        {selected.size > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear ({selected.size})
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TOP_CHARACTERS.map((id) => {
          const active = selected.has(id);
          const imgPath = getCharacterImagePath(id);
          const name = getCharacterShortName(id);
          return (
            <button
              key={id}
              onClick={() => onToggle(id)}
              title={CHARACTER_MAP[id]}
              className={`
                relative h-14 w-14 rounded-xl border transition-all flex items-center justify-center
                ${active
                  ? 'border-[#21BA45]/60 bg-[#21BA45]/15 ring-1 ring-[#21BA45]/30'
                  : 'border-[#2a2a2a] bg-[#141414] opacity-60 hover:opacity-90 hover:border-[#3a3a3a]'
                }
              `}
            >
              {imgPath ? (
                <img src={imgPath} alt={name} className="h-11 object-contain" loading="lazy" />
              ) : (
                <span className="text-xs font-bold text-gray-400">{name.slice(0, 2)}</span>
              )}
            </button>
          );
        })}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`
            relative h-14 px-3 rounded-xl border transition-all flex items-center justify-center
            ${expanded || hasRestSelected
              ? 'border-[#3a3a3a] bg-[#1a1a1a] text-gray-300'
              : 'border-[#2a2a2a] bg-[#141414] text-gray-500 opacity-60 hover:opacity-90 hover:border-[#3a3a3a]'
            }
          `}
        >
          <span className="text-xs font-medium">{expanded ? 'Less' : 'More'}</span>
        </button>
      </div>
      {expanded && (
        <div className="flex flex-wrap gap-1.5">
          {REST_CHARACTERS.map((id) => {
            const active = selected.has(id);
            const imgPath = getCharacterImagePath(id);
            const name = getCharacterShortName(id);
            return (
              <button
                key={id}
                onClick={() => onToggle(id)}
                title={CHARACTER_MAP[id]}
                className={`
                  relative h-14 w-14 rounded-xl border transition-all flex items-center justify-center
                  ${active
                    ? 'border-[#21BA45]/60 bg-[#21BA45]/15 ring-1 ring-[#21BA45]/30'
                    : 'border-[#2a2a2a] bg-[#141414] opacity-60 hover:opacity-90 hover:border-[#3a3a3a]'
                  }
                `}
              >
                {imgPath ? (
                  <img src={imgPath} alt={name} className="h-11 object-contain" loading="lazy" />
                ) : (
                  <span className="text-xs font-bold text-gray-400">{name.slice(0, 2)}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Discover() {
  const [players, setPlayers] = useState<DiscoverPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [charFilter, setCharFilter] = useState<Set<number>>(new Set());
  const charFilterRef = useRef(charFilter);
  charFilterRef.current = charFilter;

  async function load(chars?: Set<number>) {
    const filter = chars ?? charFilterRef.current;
    try {
      const ids = filter.size > 0 ? Array.from(filter) : undefined;
      const data = await window.api.discoverPlayers(ids);
      setPlayers(data || []);
    } catch {}
    setLoading(false);
    setLastRefresh(Date.now());
  }

  useEffect(() => {
    load();
    const interval = setInterval(() => load(), 30_000);
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

  function toggleChar(id: number) {
    setCharFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setLoading(true);
      load(next);
      return next;
    });
  }

  function clearFilter() {
    setCharFilter(new Set());
    setLoading(true);
    load(new Set());
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

      <CharacterFilter
        selected={charFilter}
        onToggle={toggleChar}
        onClear={clearFilter}
      />

      <div className="space-y-2">
        {loading && players.length === 0 && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {!loading && players.length === 0 && charFilter.size === 0 && (
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center">
            <p className="text-gray-500 text-sm">
              No players online right now. Check back later!
            </p>
          </div>
        )}

        {!loading && players.length === 0 && charFilter.size > 0 && (
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center">
            <p className="text-gray-500 text-sm">
              No players match the selected characters.
            </p>
          </div>
        )}

        {players.map((p) => {
          const isAdded = added.has(p.connectCode);
          return (
            <div key={p.userId} className="space-y-1">
              {p.lastPlayedAt && (
                <div className="flex items-center gap-1.5 px-1">
                  <span className="text-amber-400 text-xs">⚑</span>
                  <span className="text-[11px] font-medium text-amber-400/90">
                    {formatLastPlayed(p.lastPlayedAt)}
                  </span>
                </div>
              )}
              <div className="group flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <PlayerCard
                    player={{
                      connectCode: p.connectCode,
                      displayName: p.displayName,
                      discordUsername: p.discordUsername ?? undefined,
                      discordId: p.discordId,
                      avatarUrl: p.avatarUrl,
                      rating: p.rating,
                      topCharacters: p.topCharacters,
                      region: p.region,
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
