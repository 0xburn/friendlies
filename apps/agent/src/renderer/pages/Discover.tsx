import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isGameActive } from '../App';
import { PlayerCard } from '../components/PlayerCard';
import { CharacterIcon } from '../components/CharacterIcon';
import { ConnectionTypeIcon } from '../components/ConnectionTypeIcon';
import { RankBadge } from '../components/RankBadge';
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
  status: 'online' | 'in-game' | 'idle';
  currentCharacter: number | null;
  opponentCode: string | null;
  playingSince: string | null;
  connectionType: 'wifi' | 'ethernet' | null;
  lastPlayedAt: string | null;
  lookingToPlay?: boolean;
  statusPreset?: string | null;
  mutualFriendCount?: number;
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

const RANK_TIERS = [
  { name: 'Bronze',   min: 0,       max: 1054.86, color: '#E06A36' },
  { name: 'Silver',   min: 1054.87, max: 1435.47, color: '#B5A5B7' },
  { name: 'Gold',     min: 1435.48, max: 1751.82, color: '#F6A51E' },
  { name: 'Platinum', min: 1751.83, max: 2003.91, color: '#91E8E0' },
  { name: 'Diamond',  min: 2003.92, max: 2191.74, color: '#4169E1' },
  { name: 'Master',   min: 2191.75, max: 99999,   color: '#8B008B' },
] as const;

function EloFilter({ selected, onToggle, onClear }: {
  selected: Set<number>;
  onToggle: (idx: number) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">Filter by rank</span>
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
        {RANK_TIERS.map((tier, idx) => {
          const active = selected.has(idx);
          return (
            <button
              key={tier.name}
              onClick={() => onToggle(idx)}
              className={`
                relative h-8 px-3 rounded-lg border transition-all flex items-center justify-center text-xs font-bold
                ${active
                  ? 'ring-1'
                  : 'opacity-60 hover:opacity-90'
                }
              `}
              style={active
                ? { borderColor: `${tier.color}99`, backgroundColor: `${tier.color}22`, color: tier.color, boxShadow: `0 0 0 1px ${tier.color}44` }
                : { borderColor: '#2a2a2a', backgroundColor: '#141414', color: tier.color }
              }
            >
              {tier.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const HIDDEN_CHARACTERS = new Set<number>();
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
                relative h-10 w-10 rounded-lg border transition-all flex items-center justify-center
                ${active
                  ? 'border-[#21BA45]/60 bg-[#21BA45]/15 ring-1 ring-[#21BA45]/30'
                  : 'border-[#2a2a2a] bg-[#141414] opacity-60 hover:opacity-90 hover:border-[#3a3a3a]'
                }
              `}
            >
              {imgPath ? (
                <img src={imgPath} alt={name} className="h-8 object-contain" loading="lazy" />
              ) : (
                <span className="text-xs font-bold text-gray-400">{name.slice(0, 2)}</span>
              )}
            </button>
          );
        })}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`
            relative h-10 px-3 rounded-lg border transition-all flex items-center justify-center
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
                  relative h-10 w-10 rounded-lg border transition-all flex items-center justify-center
                  ${active
                    ? 'border-[#21BA45]/60 bg-[#21BA45]/15 ring-1 ring-[#21BA45]/30'
                    : 'border-[#2a2a2a] bg-[#141414] opacity-60 hover:opacity-90 hover:border-[#3a3a3a]'
                  }
                `}
              >
                {imgPath ? (
                  <img src={imgPath} alt={name} className="h-8 object-contain" loading="lazy" />
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
  const [myCode, setMyCode] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [addedMap, setAddedMap] = useState<Map<string, 'pending' | 'friends'>>(new Map());
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [visibleCount, setVisibleCount] = useState(15);
  const [confirmBlock, setConfirmBlock] = useState<string | null>(null);
  const [addNoteModal, setAddNoteModal] = useState<string | null>(null);
  const [addNote, setAddNote] = useState<string | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState<Record<string, string | true>>({});
  const [sentInvites, setSentInvites] = useState<{ id: string; connectCode: string; displayName?: string; avatarUrl?: string; rating?: number | null; status: string; mainCharacter?: number | null; connectionType?: 'wifi' | 'ethernet' | null; region?: string | null }[]>([]);
  const [playInvites, setPlayInvites] = useState<{ id: string; connectCode: string; displayName?: string; avatarUrl?: string; rating?: number | null; status: string; mainCharacter?: number | null; connectionType?: 'wifi' | 'ethernet' | null; region?: string | null }[]>([]);
  const [acceptingInvite, setAcceptingInvite] = useState<string | null>(null);
  const [dcStarting, setDcStarting] = useState(false);
  const [dcStatus, setDcStatus] = useState<{ status: string; message: string; connectCode?: string } | null>(null);
  const [charFilter, setCharFilter] = useState<Set<number>>(new Set());
  const [eloFilter, setEloFilter] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const charFilterRef = useRef(charFilter);
  charFilterRef.current = charFilter;
  const eloFilterRef = useRef(eloFilter);
  eloFilterRef.current = eloFilter;

  const loadInFlight = useRef(false);

  async function load(chars?: Set<number>, elo?: Set<number>, resetVisible = true) {
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    const filter = chars ?? charFilterRef.current;
    const eloSel = elo ?? eloFilterRef.current;
    try {
      const characterIds = filter.size > 0 ? Array.from(filter) : undefined;
      let minElo: number | undefined;
      let maxElo: number | undefined;
      if (eloSel.size > 0) {
        const indices = Array.from(eloSel);
        minElo = Math.min(...indices.map((i) => RANK_TIERS[i].min));
        maxElo = Math.max(...indices.map((i) => RANK_TIERS[i].max));
      }
      const data: DiscoverPlayer[] = (await window.api.discoverPlayers({ characterIds, minElo, maxElo })) || [];
      if (resetVisible) {
        setPlayers(data);
      } else {
        setPlayers((prev) => {
          if (prev.length === 0) return data;
          const newMap = new Map(data.map((p) => [p.userId, p]));
          const merged: DiscoverPlayer[] = [];
          for (const p of prev) {
            const updated = newMap.get(p.userId);
            if (updated) {
              merged.push(updated);
              newMap.delete(p.userId);
            }
          }
          for (const p of data) {
            if (newMap.has(p.userId)) merged.push(p);
          }
          return merged;
        });
      }
    } catch {}
    setLoading(false);
    setLastRefresh(Date.now());
    if (resetVisible) setVisibleCount(15);
    loadInFlight.current = false;
  }

  async function loadSentInvites() {
    try {
      const data = await window.api.getSentInvites();
      const visible = (data || []).filter((d: any) => !d.sender_opened || d.status === 'pending').slice(0, 10).map((d: any) => ({
        id: d.id,
        connectCode: d.connectCode || '',
        displayName: d.displayName,
        avatarUrl: d.avatarUrl ?? null,
        rating: d.rating ?? null,
        status: d.status || 'pending',
        mainCharacter: d.mainCharacter ?? null,
        connectionType: d.connectionType ?? null,
        region: d.region ?? null,
      }));
      setSentInvites((prev) => {
        if (prev.length === visible.length && prev.every((p, i) => p.id === visible[i].id && p.status === visible[i].status)) return prev;
        return visible;
      });
      const activeCodes = new Set(visible.map((v) => v.connectCode));
      setInviteSent((prev) => {
        const next: Record<string, string | true> = {};
        for (const [code, val] of Object.entries(prev)) {
          if (activeCodes.has(code)) next[code] = val;
        }
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    } catch {}
  }

  async function loadPlayInvites() {
    try {
      const data = await window.api.getPendingInvites();
      const visible = (data || []).filter((d: any) => !d.receiver_opened || d.status === 'pending').slice(0, 10).map((d: any) => ({
        id: d.id,
        connectCode: d.connectCode || '',
        displayName: d.displayName,
        avatarUrl: d.avatarUrl ?? null,
        rating: d.rating ?? null,
        status: d.status || 'pending',
        mainCharacter: d.mainCharacter ?? null,
        connectionType: d.connectionType ?? null,
        region: d.region ?? null,
      }));
      setPlayInvites((prev) => {
        if (prev.length === visible.length && prev.every((p, i) => p.id === visible[i].id && p.status === visible[i].status)) return prev;
        return visible;
      });
    } catch {}
  }

  async function handleAcceptInvite(inviteId: string) {
    setAcceptingInvite(inviteId);
    await window.api.acceptPlayInvite(inviteId);
    await loadPlayInvites();
    setAcceptingInvite(null);
  }

  async function handleDeclineInvite(inviteId: string) {
    await window.api.dismissInvite(inviteId);
    await loadPlayInvites();
  }

  async function handleStopDirectConnect() {
    await window.api.stopDirectConnect();
    setDcStarting(false);
    setDcStatus(null);
  }

  async function handleDirectConnect(connectCode: string, inviteId?: string) {
    if (inviteId) {
      await window.api.completeInvite(inviteId);
      await Promise.all([loadPlayInvites(), loadSentInvites()]);
    }
    setDcStarting(true);
    setDcStatus({ status: 'configuring', message: `Starting direct connect to ${connectCode}...`, connectCode });
    const result = await window.api.startDirectConnect(connectCode);
    if (result.error) {
      setDcStatus({ status: 'error', message: result.error, connectCode });
      setDcStarting(false);
      setTimeout(() => setDcStatus(null), 5000);
    }
  }

  async function handleCancelSentInvite(inviteId: string) {
    await window.api.dismissInvite(inviteId);
    await loadSentInvites();
  }

  useEffect(() => {
    load();
    loadSentInvites();
    loadPlayInvites();
    window.api.getIdentity().then((id) => { if (id) setMyCode(id.connectCode); });
    const interval = setInterval(() => { if (!document.hidden && !isGameActive()) { load(undefined, undefined, false); loadSentInvites(); loadPlayInvites(); } }, 30_000);
    const onVisible = () => { if (!document.hidden) { load(undefined, undefined, false); loadSentInvites(); loadPlayInvites(); } };
    document.addEventListener('visibilitychange', onVisible);
    const unsubInvRefresh = window.api.onInvitesRefresh(() => { loadSentInvites(); loadPlayInvites(); });
    const unsubDc = window.api.onDirectConnectStatus((evt: any) => {
      setDcStatus(evt);
      if (evt.status === 'ready' || evt.status === 'error' || evt.status === 'cancelled') {
        setDcStarting(false);
        setTimeout(() => setDcStatus(null), 8000);
      }
    });
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); unsubInvRefresh(); unsubDc(); };
  }, []);

  const hasActiveInvites = sentInvites.length > 0 || playInvites.length > 0;

  useEffect(() => {
    if (!hasActiveInvites) return;
    const fastPoll = setInterval(() => {
      if (document.hidden || isGameActive()) return;
      loadPlayInvites();
      loadSentInvites();
    }, 3_000);
    return () => clearInterval(fastPoll);
  }, [hasActiveInvites]);

  const handleAddClick = useCallback((connectCode: string) => {
    setAddNote(null);
    setAddNoteModal(connectCode);
  }, []);

  async function handleAddConfirm() {
    const code = addNoteModal;
    if (!code) return;
    setAddNoteModal(null);
    setAdding(code);
    const result = await window.api.addFriend(code, addNote ?? undefined);
    if (result.ok || result.mutual) {
      setAddedMap((prev) => new Map(prev).set(code, result.mutual ? 'friends' : 'pending'));
    }
    setAddNote(null);
    setAdding(null);
  }

  const handleInvite = useCallback(async (connectCode: string) => {
    setInviting(connectCode);
    const result = await window.api.sendPlayInvite(connectCode);
    if (result.error) {
      setInviteSent((prev) => ({ ...prev, [connectCode]: result.error }));
    } else {
      setInviteSent((prev) => ({ ...prev, [connectCode]: true }));
      await loadSentInvites();
    }
    setInviting(null);
  }, []);

  const handleCopy = useCallback(async (code: string) => {
    await window.api.copyToClipboard(code);
  }, []);

  const handleBlock = useCallback(async (connectCode: string) => {
    setConfirmBlock(null);
    await window.api.blockUser(connectCode);
    setPlayers((prev) => prev.filter((p) => p.connectCode !== connectCode));
  }, []);

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

  function toggleElo(idx: number) {
    setEloFilter((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      setLoading(true);
      load(undefined, next);
      return next;
    });
  }

  function clearEloFilter() {
    setEloFilter(new Set());
    setLoading(true);
    load(undefined, new Set());
  }

  const ago = Math.round((Date.now() - lastRefresh) / 1000);
  const refreshLabel = ago < 5 ? 'just now' : `${ago}s ago`;

  const filtered = useMemo(() => search
    ? players.filter((p) => {
        const q = search.toLowerCase();
        return (
          p.connectCode?.toLowerCase().includes(q) ||
          p.displayName?.toLowerCase().includes(q) ||
          p.discordUsername?.toLowerCase().includes(q)
        );
      })
    : players, [players, search]);

  return (
    <div className="space-y-6 max-w-4xl">
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

      <EloFilter
        selected={eloFilter}
        onToggle={toggleElo}
        onClear={clearEloFilter}
      />

      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setVisibleCount(15); }}
        placeholder="Search by code, name, or Discord..."
        className="w-full rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#21BA45]/50"
      />

      {(sentInvites.length > 0 || playInvites.length > 0) && (
        <div className="space-y-2">
          {playInvites.map((inv) => (
            <div key={`recv-${inv.id}`} className={`rounded-2xl border p-4 ${
              inv.status === 'accepted'
                ? 'border-[#21BA45]/30 bg-[#21BA45]/5'
                : 'border-amber-500/20 bg-amber-500/5'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  {inv.avatarUrl ? (
                    <img src={inv.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-[#2a2a2a]" />
                  ) : inv.mainCharacter != null ? (
                    <CharacterIcon characterId={inv.mainCharacter} size="md" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-gray-600 text-xs font-bold shrink-0">
                      {(inv.connectCode || '??').slice(0, 2)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-white text-sm">{inv.connectCode}</span>
                      {inv.mainCharacter != null && !inv.avatarUrl && <CharacterIcon characterId={inv.mainCharacter} size="sm" />}
                      {inv.connectionType && <ConnectionTypeIcon type={inv.connectionType} />}
                    </div>
                    <div className="flex items-center gap-2">
                      {inv.displayName && <span className="text-xs text-gray-500 truncate">{inv.displayName}</span>}
                      {inv.region && <span className="text-[10px] text-gray-500">{inv.region}</span>}
                    </div>
                  </div>
                  {inv.mainCharacter != null && inv.avatarUrl && <CharacterIcon characterId={inv.mainCharacter} size="sm" />}
                  <RankBadge rating={inv.rating ?? null} />
                </div>
                {inv.status === 'accepted' ? (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[#21BA45]">Both Players are Ready!</span>
                        <button
                          onClick={() => handleDirectConnect(inv.connectCode, inv.id)}
                          disabled={dcStarting}
                          className="shrink-0 rounded-lg bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 transition-colors disabled:opacity-40"
                        >
                          Open Melee
                        </button>
                        <button
                          onClick={() => handleDeclineInvite(inv.id)}
                          className="shrink-0 w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors"
                          title="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                      <span className="text-xs text-gray-500">(connect code will be pre-filled in Direct mode!)</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-amber-400">wants to play!</span>
                    <button
                      onClick={() => handleAcceptInvite(inv.id)}
                      disabled={acceptingInvite === inv.id}
                      className="shrink-0 rounded-lg bg-[#21BA45] px-4 py-2 text-sm font-bold text-white hover:bg-[#1ea33e] transition-colors disabled:opacity-50"
                    >
                      {acceptingInvite === inv.id ? '...' : 'Accept'}
                    </button>
                    <button
                      onClick={() => handleDeclineInvite(inv.id)}
                      className="shrink-0 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {sentInvites.map((inv) => (
            <div key={`sent-${inv.id}`} className={`rounded-2xl border p-4 ${
              inv.status === 'accepted'
                ? 'border-[#21BA45]/30 bg-[#21BA45]/5'
                : 'border-blue-500/20 bg-blue-500/5'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {inv.mainCharacter != null && (
                    <CharacterIcon characterId={inv.mainCharacter} size="sm" />
                  )}
                  <span className="font-mono font-bold text-white text-sm">{inv.connectCode}</span>
                  {inv.displayName && (
                    <span className="text-xs text-gray-500 truncate">{inv.displayName}</span>
                  )}
                  {inv.connectionType && <ConnectionTypeIcon type={inv.connectionType} />}
                  {inv.region && <span className="text-[10px] text-gray-500">{inv.region}</span>}
                </div>
                {inv.status === 'accepted' ? (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[#21BA45]">Both Players are Ready!</span>
                        <button
                          onClick={() => handleDirectConnect(inv.connectCode, inv.id)}
                          disabled={dcStarting}
                          className="shrink-0 rounded-lg bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 transition-colors disabled:opacity-40"
                        >
                          Open Melee
                        </button>
                        <button
                          onClick={() => handleCancelSentInvite(inv.id)}
                          className="shrink-0 w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors"
                          title="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                      <span className="text-xs text-gray-500">(connect code will be pre-filled in Direct mode!)</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-blue-400">Waiting for {inv.connectCode} to accept...</span>
                    <button
                      onClick={() => handleCancelSentInvite(inv.id)}
                      className="shrink-0 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {dcStatus && (
        <div className={`rounded-2xl border p-4 flex items-center justify-between ${
          dcStatus.status === 'error' ? 'border-red-500/20 bg-red-500/5' :
          dcStatus.status === 'ready' ? 'border-[#21BA45]/20 bg-[#21BA45]/5' :
          'border-blue-500/20 bg-blue-500/5'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            {dcStatus.status !== 'error' && dcStatus.status !== 'ready' && dcStatus.status !== 'cancelled' && (
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
            )}
            <div className="min-w-0">
              <p className={`text-sm font-medium ${
                dcStatus.status === 'error' ? 'text-red-400' :
                dcStatus.status === 'ready' ? 'text-[#21BA45]' :
                'text-blue-400'
              }`}>
                {dcStatus.message}
              </p>
              {dcStatus.connectCode && (
                <p className="text-[10px] text-gray-500 font-mono">{dcStatus.connectCode}</p>
              )}
            </div>
          </div>
          {dcStatus.status !== 'error' && dcStatus.status !== 'ready' && dcStatus.status !== 'cancelled' && (
            <button
              onClick={handleStopDirectConnect}
              className="shrink-0 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {loading && players.length === 0 && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {!loading && filtered.length === 0 && !search && charFilter.size === 0 && eloFilter.size === 0 && (
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center">
            <p className="text-gray-500 text-sm">
              No players online right now. Check back later!
            </p>
          </div>
        )}

        {!loading && filtered.length === 0 && (search || charFilter.size > 0 || eloFilter.size > 0) && (
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center">
            <p className="text-gray-500 text-sm">
              {search ? 'No players match your search.'
                : eloFilter.size > 0 && charFilter.size > 0 ? 'No players match the selected rank and characters.'
                : eloFilter.size > 0 ? 'No players match the selected rank.'
                : 'No players match the selected characters.'}
            </p>
          </div>
        )}

        {filtered.slice(0, visibleCount).map((p) => {
          const state = adding === p.connectCode ? 'adding' : (addedMap.get(p.connectCode) ?? null);
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
                  connectionType: p.connectionType ?? undefined,
                  lookingToPlay: p.lookingToPlay,
                  statusPreset: p.statusPreset,
                  mutualFriendCount: p.mutualFriendCount,
                }}
                onClick={() => handleCopy(p.connectCode)}
                onBlock={() => setConfirmBlock(p.connectCode)}
                onAdd={!state ? () => handleAddClick(p.connectCode) : undefined}
                addState={state}
                onInvite={() => handleInvite(p.connectCode)}
                inviteDisabled={inviting === p.connectCode || !!inviteSent[p.connectCode]}
                inviteState={inviteSent[p.connectCode] ?? null}
              />
            </div>
          );
        })}

        {filtered.length > visibleCount && visibleCount < 100 && (
          <button
            onClick={() => setVisibleCount((c) => Math.min(c + 15, 100))}
            className="w-full rounded-xl border border-[#2a2a2a] bg-[#141414] py-3 text-sm font-medium text-gray-400 hover:text-white hover:bg-[#1a1a1a] transition-colors"
          >
            Load more
          </button>
        )}
        {filtered.length > 0 && (visibleCount >= filtered.length || visibleCount >= 100) && (
          <p className="text-center text-xs text-gray-600 py-3">
            Surely someone in this list is good enough for you!
          </p>
        )}
      </div>

      {addNoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setAddNoteModal(null)}>
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6 w-[360px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-white font-semibold text-center">
              Add <span className="font-mono text-[#21BA45]">{addNoteModal}</span>
            </p>
            <p className="text-xs text-gray-400 text-center mt-2 leading-relaxed">
            When adding a player, it often helps to let them know a bit more info on what you're looking for! Notes are optional.
            </p>
            <div className="flex flex-wrap gap-2 mt-4 justify-center">
              {['Looking for MU practice', 'GGs from unranked', 'Same region', 'Just saying hi', 'Similar skill level'].map((tag) => (
                <button
                  key={tag}
                  onClick={() => setAddNote(addNote === tag ? null : tag)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    addNote === tag
                      ? 'bg-[#21BA45]/20 text-[#21BA45] border border-[#21BA45]/40'
                      : 'bg-[#1a1a1a] text-gray-400 border border-[#2a2a2a] hover:border-gray-500'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setAddNote(null); setAddNoteModal(null); }}
                className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-white hover:bg-[#222] transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleAddConfirm}
                className="flex-1 rounded-lg bg-[#21BA45] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1ea33e] transition-colors"
              >
                {addNote ? 'Send with note' : 'Send without note'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmBlock(null)}>
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6 w-[320px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-gray-300 text-center">
              Block <span className="font-mono font-bold text-white">{confirmBlock}</span>?
            </p>
            <p className="text-xs text-gray-500 text-center mt-2">
              They won't appear on your Discover page and can't send you requests or invites.
            </p>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setConfirmBlock(null)}
                className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-[#222] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleBlock(confirmBlock)}
                className="flex-1 rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Block
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
