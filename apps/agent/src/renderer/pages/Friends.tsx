import { useEffect, useState, useMemo } from 'react';
import { PlayerCard } from '../components/PlayerCard';

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

export function Friends() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [onlineMap, setOnlineMap] = useState<Record<string, { status: string; opponentCode?: string; playingSince?: string }>>({});
  const [search, setSearch] = useState('');
  const [addCode, setAddCode] = useState('');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [responding, setResponding] = useState<string | null>(null);

  useEffect(() => {
    loadFriends();
    loadIncoming();
    pollFriendStatuses();

    const unsub = window.api.onPresenceUpdate((users) => {
      const map: Record<string, { status: string; opponentCode?: string; playingSince?: string }> = {};
      users.forEach((u: any) => {
        map[u.connectCode] = {
          status: u.status,
          opponentCode: u.opponentCode ?? undefined,
          playingSince: u.playingSince ?? undefined,
        };
      });
      setOnlineMap((prev) => ({ ...prev, ...map }));
    });

    const dbPoll = setInterval(pollFriendStatuses, 10_000);
    return () => { unsub(); clearInterval(dbPoll); };
  }, []);

  async function pollFriendStatuses() {
    try {
      const statuses = await window.api.getFriendStatuses();
      if (statuses && typeof statuses === 'object') {
        setOnlineMap((prev) => ({ ...prev, ...statuses }));
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

  const enriched = useMemo(() => {
    return friends.map((f) => {
      const presence = onlineMap[f.connectCode];
      return {
        ...f,
        status: (presence?.status || 'offline') as Friend['status'],
        opponentCode: presence?.opponentCode ?? null,
        playingSince: presence?.playingSince ?? null,
      };
    });
  }, [friends, onlineMap]);

  const { accepted, pendingOut } = useMemo(() => {
    const q = search.toLowerCase();
    const list = q
      ? enriched.filter(
          (f) =>
            f.connectCode?.toLowerCase().includes(q) ||
            f.displayName?.toLowerCase().includes(q)
        )
      : enriched;

    const order: Record<string, number> = { 'in-game': 0, online: 1, offline: 2 };
    const sorted = [...list].sort((a, b) => (order[a.status || 'offline'] ?? 2) - (order[b.status || 'offline'] ?? 2));

    return {
      accepted: sorted.filter((f) => f.friendStatus === 'accepted'),
      pendingOut: sorted.filter((f) => f.friendStatus === 'pending'),
    };
  }, [enriched, search]);

  async function handleAdd() {
    const code = addCode.trim().toUpperCase();
    if (!code) return;
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

  async function handleCopy(code: string) {
    await window.api.copyToClipboard(code);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold">Friends</h1>
        <span className="text-sm text-gray-500">
          {accepted.length} friend{accepted.length !== 1 ? 's' : ''}
        </span>
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
      {accepted.length > 3 && (
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
        {accepted.length === 0 && pendingOut.length === 0 && incoming.length === 0 && (
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center">
            <p className="text-gray-500 text-sm">
              No friends yet. Add someone by their connect code!
            </p>
          </div>
        )}
        {accepted.map((f) => (
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
                  opponentCode: f.opponentCode,
                  playingSince: f.playingSince,
                }}
                onClick={() => handleCopy(f.connectCode)}
              />
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); handleRemove(f.id); }}
              disabled={removing === f.id}
              className="shrink-0 opacity-0 group-hover:opacity-100 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-all"
            >
              {removing === f.id ? '...' : 'Remove'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
