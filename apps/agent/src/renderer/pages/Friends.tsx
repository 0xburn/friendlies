import { useEffect, useState, useMemo } from 'react';
import { OnlineIndicator } from '../components/OnlineIndicator';
import { PlayerCard } from '../components/PlayerCard';
import { RankBadge } from '../components/RankBadge';
import { getCharacterShortName } from '../lib/characters';

interface Friend {
  id: string;
  friendId: string;
  connectCode: string;
  displayName?: string;
  discordUsername?: string;
  avatarUrl?: string;
  rating: number | null;
  characterId: number | null;
  status?: 'online' | 'in-game' | 'offline';
  onApp?: boolean;
  friendStatus?: 'pending' | 'accepted';
}

interface IncomingRequest {
  id: string;
  fromUserId: string;
  connectCode: string;
  displayName?: string;
  discordUsername?: string;
  avatarUrl?: string;
  rating: number | null;
  characterId: number | null;
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

export function Friends() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [onlineMap, setOnlineMap] = useState<Record<string, { status: string; opponentCode?: string; currentCharacter?: number | null; playingSince?: string }>>({});
  const [search, setSearch] = useState('');
  const [addCode, setAddCode] = useState('');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [responding, setResponding] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [inviteSent, setInviteSent] = useState<Record<string, string | true>>({});
  const [inviting, setInviting] = useState<string | null>(null);
  const [playInvites, setPlayInvites] = useState<{ id: string; connectCode: string; displayName?: string; discordUsername?: string; created_at: string }[]>([]);

  const [myStatus, setMyStatus] = useState<'online' | 'in-game' | 'offline'>('offline');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'in-game' | 'offline'>('all');
  const [myIdentity, setMyIdentity] = useState<{ connectCode: string; displayName: string } | null>(null);
  const [myUser, setMyUser] = useState<{ avatar_url?: string; discord_name?: string } | null>(null);
  const [myProfile, setMyProfile] = useState<{ rating_ordinal?: number; wins?: number; losses?: number } | null>(null);
  const [myOpponentCode, setMyOpponentCode] = useState<string | null>(null);
  const [myCharacterId, setMyCharacterId] = useState<number | null>(null);
  const [myOppCharId, setMyOppCharId] = useState<number | null>(null);
  const [myPlayingSince, setMyPlayingSince] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.api.getIdentity().then((id) => {
      if (id) setMyIdentity({ connectCode: id.connectCode, displayName: id.displayName });
    });
    window.api.getUser().then((u: any) => {
      if (u) setMyUser({
        avatar_url: u.user_metadata?.avatar_url,
        discord_name: u.user_metadata?.full_name || u.user_metadata?.name,
      });
    });
    window.api.getProfile().then((p: any) => {
      if (p) setMyProfile({ rating_ordinal: p.rating_ordinal, wins: p.wins, losses: p.losses });
    });
    window.api.getLocalStatus().then((s: any) => {
      if (s) setMyStatus(s === 'in-game' ? 'in-game' : s === 'online' ? 'online' : 'offline');
    });

    Promise.all([loadFriends(), loadIncoming(), pollFriendStatuses(), loadPlayInvites()]).finally(() =>
      setInitialLoading(false),
    );

    const unsub = window.api.onPresenceUpdate((users) => {
      const map: Record<string, { status: string; opponentCode?: string; currentCharacter?: number | null; playingSince?: string }> = {};
      users.forEach((u: any) => {
        map[u.connectCode] = {
          status: u.status,
          opponentCode: u.opponentCode ?? undefined,
          currentCharacter: u.currentCharacter ?? null,
          playingSince: u.playingSince ?? undefined,
        };
      });
      setOnlineMap((prev) => ({ ...prev, ...map }));
    });

    const unsubStatus = window.api.onLocalStatus((info: any) => {
      setMyStatus(info.status || 'online');
      setMyOpponentCode(info.opponentCode ?? null);
      setMyOppCharId(info.opponentCharacterId ?? null);
      setMyPlayingSince(info.playingSince ?? null);
      setMyCharacterId(info.characterId ?? null);
    });

    const dbPoll = setInterval(() => {
      pollFriendStatuses();
      loadFriends();
      loadIncoming();
      loadPlayInvites();
    }, 30_000);
    return () => { unsub(); unsubStatus(); clearInterval(dbPoll); };
  }, []);

  async function pollFriendStatuses() {
    try {
      const statuses = await window.api.getFriendStatuses();
      if (statuses && typeof statuses === 'object') {
        const mapped: Record<string, { status: string; opponentCode?: string; currentCharacter?: number | null; playingSince?: string }> = {};
        for (const [code, val] of Object.entries(statuses as Record<string, any>)) {
          mapped[code] = {
            status: val.status,
            opponentCode: val.opponentCode ?? undefined,
            currentCharacter: val.currentCharacter ?? null,
            playingSince: val.playingSince ?? undefined,
          };
        }
        setOnlineMap((prev) => ({ ...prev, ...mapped }));
      }
    } catch {}
  }

  async function loadFriends() {
    const data = await window.api.getFriends();
    setFriends(data);
  }

  async function loadIncoming() {
    const data = await window.api.getIncomingRequests();
    setIncoming(data);
  }

  async function loadPlayInvites() {
    try {
      const data = await window.api.getPendingInvites();
      const invites = (data || []).slice(0, 3).map((d: any) => ({
        id: d.id,
        connectCode: d.connectCode || '',
        displayName: d.displayName,
        discordUsername: d.discordUsername,
        created_at: d.created_at,
      }));
      setPlayInvites(invites);
    } catch {}
  }

  async function clearPlayInvites() {
    for (const inv of playInvites) {
      await window.api.dismissInvite(inv.id);
    }
    setPlayInvites([]);
  }

  const enriched = useMemo(() => {
    return friends.map((f) => {
      const presence = onlineMap[f.connectCode];
      return {
        ...f,
        status: (presence?.status || 'offline') as Friend['status'],
        currentCharacter: presence?.currentCharacter ?? null,
        opponentCode: presence?.opponentCode ?? null,
        playingSince: presence?.playingSince ?? null,
      };
    });
  }, [friends, onlineMap]);

  const totalAccepted = useMemo(
    () => enriched.filter((f) => f.friendStatus === 'accepted').length,
    [enriched]
  );

  const { accepted, pendingOut } = useMemo(() => {
    const q = search.toLowerCase();
    let list = q
      ? enriched.filter(
          (f) =>
            f.connectCode?.toLowerCase().includes(q) ||
            f.displayName?.toLowerCase().includes(q)
        )
      : enriched;

    if (statusFilter !== 'all') {
      list = list.filter((f) => {
        const s = f.status || 'offline';
        if (statusFilter === 'online') return s === 'online' || s === 'in-game';
        return s === statusFilter;
      });
    }

    function sortScore(f: typeof list[0]): number {
      const s = f.status || 'offline';
      if (s === 'in-game' && f.currentCharacter != null) return 0;
      if (s === 'in-game') return 1;
      if (s === 'online') return 2;
      return 3;
    }
    const sorted = [...list].sort((a, b) => sortScore(a) - sortScore(b));

    return {
      accepted: sorted.filter((f) => f.friendStatus === 'accepted'),
      pendingOut: sorted.filter((f) => f.friendStatus === 'pending'),
    };
  }, [enriched, search, statusFilter]);

  async function handleAdd() {
    const code = addCode.trim().toUpperCase();
    if (!code) return;
    if (!code.includes('#')) {
      setAddError('Connect codes must include # (e.g. ABCD#123)');
      return;
    }
    setAddLoading(true);
    setAddError('');
    const result = await window.api.addFriend(code);
    if (result.error) {
      setAddError(result.error);
    } else {
      setAddCode('');
      await loadFriends();
      if (result.mutual) await loadIncoming();
    }
    setAddLoading(false);
  }

  async function handleRemove(friendshipId: string) {
    setRemoving(friendshipId);
    await window.api.removeFriend(friendshipId);
    await loadFriends();
    setRemoving(null);
  }

  async function handleAccept(requestId: string) {
    setResponding(requestId);
    await window.api.acceptFriend(requestId);
    await Promise.all([loadFriends(), loadIncoming()]);
    setResponding(null);
  }

  async function handleDecline(requestId: string) {
    setResponding(requestId);
    await window.api.declineFriend(requestId);
    await loadIncoming();
    setResponding(null);
  }

  async function handleInvite(connectCode: string) {
    setInviting(connectCode);
    const result = await window.api.sendPlayInvite(connectCode);
    if (result.error) {
      setInviteSent((prev) => ({ ...prev, [connectCode]: result.error }));
    } else {
      setInviteSent((prev) => ({ ...prev, [connectCode]: true }));
    }
    setInviting(null);
    setTimeout(() => setInviteSent((prev) => {
      const next = { ...prev };
      delete next[connectCode];
      return next;
    }), 3000);
  }

  async function handleCopy(code: string) {
    await window.api.copyToClipboard(code);
  }

  async function copyCode() {
    if (!myIdentity?.connectCode) return;
    await window.api.copyToClipboard(myIdentity.connectCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const wins = myProfile?.wins ?? 0;
  const losses = myProfile?.losses ?? 0;
  const total = wins + losses;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Player status card */}
      {myIdentity && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-4">
          <div className="flex items-center gap-4">
            {myUser?.avatar_url && (
              <img src={myUser.avatar_url} alt="" className="w-10 h-10 rounded-full border border-[#2a2a2a] shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="text-lg font-mono font-bold tracking-wider text-white">
                  {myIdentity.connectCode}
                </span>
                <OnlineIndicator
                  status={myStatus}
                  size="md"
                  opponentCode={myOpponentCode}
                  opponentCharacterId={myOppCharId}
                  characterId={myCharacterId}
                  playingSince={myPlayingSince}
                />
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {myIdentity.displayName && (
                  <span className="text-xs text-gray-500">{myIdentity.displayName}</span>
                )}
                {myProfile?.rating_ordinal && (
                  <RankBadge rating={myProfile.rating_ordinal} />
                )}
                {total > 0 && (
                  <span className="text-xs text-gray-600">{wins}W {losses}L</span>
                )}
              </div>
            </div>
            <button
              onClick={copyCode}
              className="shrink-0 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white hover:bg-[#222] transition-all"
            >
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {playInvites.length > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-amber-400">
              🎮 Wants to play
            </h2>
            <button
              onClick={clearPlayInvites}
              className="text-[10px] font-medium text-amber-500/60 hover:text-amber-400 transition-colors"
            >
              Clear all
            </button>
          </div>
          {playInvites.map((inv) => {
            const ago = Math.round((Date.now() - new Date(inv.created_at).getTime()) / 60_000);
            return (
              <div key={inv.id} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-bold text-white text-sm">{inv.connectCode}</span>
                  {inv.displayName && (
                    <span className="text-xs text-gray-500 truncate">{inv.displayName}</span>
                  )}
                  {inv.discordUsername && (
                    <span className="inline-flex items-center gap-1 shrink-0 rounded-md bg-[#5865F2]/10 px-1.5 py-0.5">
                      <svg className="w-3.5 h-3.5 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                      </svg>
                      <span className="text-xs font-medium text-[#5865F2]">@{inv.discordUsername}</span>
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-amber-500/50 shrink-0">{ago < 1 ? 'just now' : `${ago}m ago`}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold">Friends</h1>
        {!initialLoading && (
          <div className="flex items-center gap-2">
            {(['all', 'online', 'in-game', 'offline'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  statusFilter === f
                    ? 'bg-[#21BA45]/15 text-[#21BA45]'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                {f === 'all' ? `All (${enriched.filter(e => e.friendStatus === 'accepted').length})` : f === 'online' ? 'Online' : f === 'in-game' ? 'In Game' : 'Offline'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={addCode}
          onChange={(e) => setAddCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Add by connect code (e.g. ABCD#123)"
          className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-[#21BA45]/50"
        />
        <button
          onClick={handleAdd}
          disabled={addLoading || !addCode.trim()}
          className="shrink-0 rounded-lg bg-[#21BA45] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#1ea33e] disabled:opacity-40"
        >
          {addLoading ? '...' : 'Add'}
        </button>
      </div>
      {addError && <p className="text-red-400 text-xs -mt-4">{addError}</p>}

      {/* Incoming Requests */}
      {incoming.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-yellow-500/80 uppercase tracking-wider">
            Incoming Requests ({incoming.length})
          </h2>
          {incoming.map((req) => (
            <div key={req.id} className="flex items-center gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3">
              {req.avatarUrl ? (
                <img src={req.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-yellow-500/20" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-gray-600 text-xs font-bold shrink-0">
                  {req.connectCode.slice(0, 2)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <span className="font-mono font-bold text-white text-sm">{req.connectCode}</span>
                {(req.displayName || req.discordUsername) && (
                  <p className="text-xs text-gray-400 truncate">
                    {req.displayName || `@${req.discordUsername}`}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleAccept(req.id)}
                  disabled={responding === req.id}
                  className="rounded-lg bg-[#21BA45] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1ea33e] transition-colors disabled:opacity-50"
                >
                  {responding === req.id ? '...' : 'Accept'}
                </button>
                <button
                  onClick={() => handleDecline(req.id)}
                  disabled={responding === req.id}
                  className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending Outgoing */}
      {pendingOut.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Pending ({pendingOut.length})
          </h2>
          {pendingOut.map((f) => (
            <div key={f.id} className="group flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <PlayerCard
                  player={{
                    connectCode: f.connectCode,
                    displayName: f.displayName,
                    discordUsername: f.discordUsername,
                    avatarUrl: f.avatarUrl,
                    rating: f.rating,
                    characterId: f.characterId,
                  }}
                  showStatus={false}
                  onClick={() => handleCopy(f.connectCode)}
                />
              </div>
              <span className="shrink-0 text-[10px] text-yellow-500/60">sent</span>
              <button
                onClick={(e) => { e.stopPropagation(); handleRemove(f.id); }}
                disabled={removing === f.id}
                className="shrink-0 opacity-0 group-hover:opacity-100 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-all"
              >
                {removing === f.id ? '...' : 'Unsend'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search (only show when there are accepted friends) */}
      {totalAccepted > 3 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search friends..."
          className="w-full rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#21BA45]/50"
        />
      )}

      {/* Accepted Friends */}
      <div className="space-y-2">
        {initialLoading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}
        {!initialLoading && accepted.length === 0 && pendingOut.length === 0 && incoming.length === 0 && (
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center">
            <p className="text-gray-500 text-sm">
              No friends yet. Add someone by their connect code!
            </p>
          </div>
        )}
        {accepted.map((f) => {
          const invState = inviteSent[f.connectCode];
          return (
            <div key={f.id} className="group flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <PlayerCard
                  player={{
                    connectCode: f.connectCode,
                    displayName: f.displayName,
                    discordUsername: f.discordUsername,
                    avatarUrl: f.avatarUrl,
                    rating: f.rating,
                    characterId: f.characterId,
                    status: f.status,
                    currentCharacter: f.currentCharacter,
                    opponentCode: f.opponentCode,
                    playingSince: f.playingSince,
                  }}
                  onClick={() => handleCopy(f.connectCode)}
                />
              </div>
              {invState === true ? (
                <span className="shrink-0 text-[10px] font-medium text-[#21BA45]">Sent!</span>
              ) : typeof invState === 'string' ? (
                <span className="shrink-0 text-[10px] font-medium text-yellow-500 max-w-[100px] text-right">{invState}</span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); handleInvite(f.connectCode); }}
                  disabled={inviting === f.connectCode}
                  className="shrink-0 opacity-0 group-hover:opacity-100 rounded-lg bg-[#21BA45]/10 px-2.5 py-1.5 text-xs text-[#21BA45] hover:bg-[#21BA45]/20 transition-all"
                >
                  {inviting === f.connectCode ? '...' : '🎮 Play'}
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleRemove(f.id); }}
                disabled={removing === f.id}
                className="shrink-0 opacity-0 group-hover:opacity-100 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-all"
              >
                {removing === f.id ? '...' : 'Remove'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
