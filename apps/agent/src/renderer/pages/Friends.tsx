import { useEffect, useState, useMemo } from 'react';
import { OnlineIndicator } from '../components/OnlineIndicator';
import { PlayerCard } from '../components/PlayerCard';
import { RankBadge } from '../components/RankBadge';
import { getCharacterImagePath, getCharacterShortName } from '../lib/characters';

interface Friend {
  id: string;
  friendId: string;
  connectCode: string;
  displayName?: string;
  discordUsername?: string;
  discordId?: string | null;
  avatarUrl?: string;
  region?: string | null;
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
  const [onlineMap, setOnlineMap] = useState<Record<string, { status: string; opponentCode?: string; currentCharacter?: number | null; playingSince?: string; lookingToPlay?: boolean; statusPreset?: string | null }>>({});
  const [search, setSearch] = useState('');
  const [addCode, setAddCode] = useState('');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [responding, setResponding] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [inviteSent, setInviteSent] = useState<Record<string, string | true>>({});
  const [inviting, setInviting] = useState<string | null>(null);
  const [playInvites, setPlayInvites] = useState<{ id: string; connectCode: string; displayName?: string; discordUsername?: string; created_at: string; status: string; myOpened?: boolean }[]>([]);
  const [sentInvites, setSentInvites] = useState<{ id: string; connectCode: string; displayName?: string; discordUsername?: string; created_at: string; status: string; myOpened?: boolean }[]>([]);
  const [acceptingInvite, setAcceptingInvite] = useState<string | null>(null);
  const [dcStatus, setDcStatus] = useState<{ status: string; message: string; connectCode?: string } | null>(null);
  const [dcStarting, setDcStarting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; code: string } | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<{ code: string } | null>(null);
  const [blocking, setBlocking] = useState<string | null>(null);

  const [myStatus, setMyStatus] = useState<'online' | 'in-game' | 'offline'>('offline');
  const [lfg, setLfg] = useState(false);
  const [lfgToggling, setLfgToggling] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'in-game' | 'offline'>('all');
  const [myIdentity, setMyIdentity] = useState<{ connectCode: string; displayName: string } | null>(null);
  const [myUser, setMyUser] = useState<{ avatar_url?: string; discord_name?: string } | null>(null);
  const [myProfile, setMyProfile] = useState<{ rating_ordinal?: number; wins?: number; losses?: number; region?: string | null; topCharacters?: { characterId: number; gameCount: number }[] } | null>(null);
  const [myOpponentCode, setMyOpponentCode] = useState<string | null>(null);
  const [myCharacterId, setMyCharacterId] = useState<number | null>(null);
  const [myOppCharId, setMyOppCharId] = useState<number | null>(null);
  const [myPlayingSince, setMyPlayingSince] = useState<string | null>(null);
  const [hideRegion, setHideRegion] = useState(false);
  const [hideAvatar, setHideAvatar] = useState<boolean | null>(null);
  const [myMainCharId, setMyMainCharId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [myStatusPreset, setMyStatusPreset] = useState<string | null>(null);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [disableStatuses, setDisableStatuses] = useState(false);
  const [disableNudges, setDisableNudges] = useState(false);
  
  const [nudgeSent, setNudgeSent] = useState<Record<string, string>>({});

  const STATUS_PRESETS = ['Down for friendlies', 'Ranked grind', 'Warming up', 'Quick session', 'Running sets', 'Will play anyone', 'Labbing tech', 'Need spacie practice', 'Need floatie practice'];
  const NUDGE_OPTIONS = ['GGs', 'one more', 'gtg', 'you play so hot and cool', 'that was sick', "you're cracked", "i'm cracked", "i'm so high", 'check discord', 'hi'];

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
      if (p) {
        const topChars = Array.isArray(p.top_characters) ? p.top_characters : [];
        setMyProfile({ rating_ordinal: p.rating_ordinal, wins: p.wins, losses: p.losses, region: p.region ?? null, topCharacters: topChars });
        const mainChar = topChars[0]?.characterId;
        if (mainChar != null) setMyMainCharId(mainChar);
      }
    });
    window.api.getLocalStatus().then((s: any) => {
      if (s) setMyStatus(s === 'in-game' ? 'in-game' : s === 'online' ? 'online' : 'offline');
    });
    window.api.isLookingToPlay().then((v: boolean) => setLfg(v));
    window.api.getStatusPreset().then((v: string | null) => setMyStatusPreset(v));
    window.api.getSettings().then((s: any) => {
      setDisableStatuses(!!s.disableStatuses);
      setDisableNudges(!!s.disableNudges);
    });
    window.api.getPrivacy().then((p) => {
      setHideRegion(p.hideRegion);
      setHideAvatar(p.hideAvatar);
    }).catch(() => {});

    Promise.all([loadFriends(), loadIncoming(), pollFriendStatuses(), loadPlayInvites(), loadSentInvites()]).finally(() =>
      setInitialLoading(false),
    );

    const unsub = window.api.onPresenceUpdate((users) => {
      setOnlineMap((prev) => {
        const next = { ...prev };
        users.forEach((u: any) => {
          next[u.connectCode] = {
            status: u.status,
            opponentCode: u.opponentCode ?? undefined,
            currentCharacter: u.currentCharacter ?? null,
            playingSince: u.playingSince ?? undefined,
            lookingToPlay: prev[u.connectCode]?.lookingToPlay,
            statusPreset: prev[u.connectCode]?.statusPreset,
          };
        });
        return next;
      });
    });

    const unsubStatus = window.api.onLocalStatus((info: any) => {
      setMyStatus(info.status || 'online');
      setMyOpponentCode(info.opponentCode ?? null);
      setMyOppCharId(info.opponentCharacterId ?? null);
      setMyPlayingSince(info.playingSince ?? null);
      setMyCharacterId(info.characterId ?? null);
    });

    const unsubDc = window.api.onDirectConnectStatus((evt: any) => {
      setDcStatus(evt);
      if (evt.status === 'ready' || evt.status === 'error' || evt.status === 'cancelled') {
        setDcStarting(false);
        setTimeout(() => setDcStatus(null), 8000);
      }
    });

    const unsubInvRefresh = window.api.onInvitesRefresh(() => {
      loadPlayInvites();
      loadSentInvites();
    });

    const dbPoll = setInterval(() => {
      if (document.hidden) return;
      pollFriendStatuses();
      loadFriends();
      loadIncoming();
      loadPlayInvites();
      loadSentInvites();
    }, 30_000);
    const onVisible = () => {
      if (!document.hidden) {
        pollFriendStatuses();
        loadFriends();
        loadIncoming();
        loadPlayInvites();
        loadSentInvites();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { unsub(); unsubStatus(); unsubDc(); unsubInvRefresh(); clearInterval(dbPoll); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  async function pollFriendStatuses() {
    try {
      const statuses = await window.api.getFriendStatuses();
      if (statuses && typeof statuses === 'object') {
        const mapped: Record<string, { status: string; opponentCode?: string; currentCharacter?: number | null; playingSince?: string; lookingToPlay?: boolean; statusPreset?: string | null }> = {};
        for (const [code, val] of Object.entries(statuses as Record<string, any>)) {
          mapped[code] = {
            status: val.status,
            opponentCode: val.opponentCode ?? undefined,
            currentCharacter: val.currentCharacter ?? null,
            playingSince: val.playingSince ?? undefined,
            lookingToPlay: val.lookingToPlay ?? false,
            statusPreset: val.statusPreset ?? null,
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
      const invites = (data || []).slice(0, 10).map((d: any) => ({
        id: d.id,
        connectCode: d.connectCode || '',
        displayName: d.displayName,
        discordUsername: d.discordUsername,
        created_at: d.created_at,
        status: d.status || 'pending',
        myOpened: !!d.receiver_opened,
      }));
      setPlayInvites(invites);
    } catch {}
  }

  async function loadSentInvites() {
    try {
      const data = await window.api.getSentInvites();
      const invites = (data || []).slice(0, 10).map((d: any) => ({
        id: d.id,
        connectCode: d.connectCode || '',
        displayName: d.displayName,
        discordUsername: d.discordUsername,
        created_at: d.created_at,
        status: d.status || 'pending',
        myOpened: !!d.sender_opened,
      }));
      setSentInvites(invites);
    } catch {}
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
        lookingToPlay: presence?.lookingToPlay ?? false,
        statusPreset: presence?.statusPreset ?? null,
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
            f.displayName?.toLowerCase().includes(q) ||
            f.discordUsername?.toLowerCase().includes(q)
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
      if (f.lookingToPlay) return -1;
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
    setConfirmRemove(null);
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

  async function handleBlock(connectCode: string) {
    setConfirmBlock(null);
    setBlocking(connectCode);
    await window.api.blockUser(connectCode);
    await Promise.all([loadFriends(), loadIncoming()]);
    setBlocking(null);
  }

  async function handleInvite(connectCode: string) {
    setInviting(connectCode);
    const result = await window.api.sendPlayInvite(connectCode);
    if (result.error) {
      setInviteSent((prev) => ({ ...prev, [connectCode]: result.error }));
    } else {
      setInviteSent((prev) => ({ ...prev, [connectCode]: true }));
      await loadSentInvites();
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setInviting(null);
    setTimeout(() => setInviteSent((prev) => {
      const next = { ...prev };
      delete next[connectCode];
      return next;
    }), 3000);
  }

  async function handleAcceptInvite(inviteId: string) {
    setAcceptingInvite(inviteId);
    await window.api.acceptPlayInvite(inviteId);
    await loadPlayInvites();
    setAcceptingInvite(null);
  }

  async function handleCancelSentInvite(inviteId: string) {
    await window.api.dismissInvite(inviteId);
    await loadSentInvites();
  }

  async function handleCopy(code: string) {
    await window.api.copyToClipboard(code);
  }

  async function handleToggleLfg() {
    setLfgToggling(true);
    try {
      const newState = await window.api.toggleLookingToPlay();
      setLfg(newState);
      if (!newState) setMyStatusPreset(null);
    } catch {}
    setLfgToggling(false);
  }

  async function handleSetStatusPreset(preset: string | null) {
    setStatusPickerOpen(false);
    setLfgToggling(true);
    try {
      if (preset === myStatusPreset) {
        await window.api.setStatusPreset(null);
        setMyStatusPreset(null);
        setLfg(false);
      } else {
        await window.api.setStatusPreset(preset);
        setMyStatusPreset(preset);
        setLfg(true);
      }
    } catch {}
    setLfgToggling(false);
  }

  async function handleNudge(connectCode: string, message: string) {
    const result = await window.api.sendNudge(connectCode, message);
    if (result.error) {
      setNudgeSent((prev) => ({ ...prev, [connectCode]: result.error! }));
    } else {
      setNudgeSent((prev) => ({ ...prev, [connectCode]: 'Sent!' }));
    }
    setTimeout(() => setNudgeSent((prev) => {
      const next = { ...prev };
      delete next[connectCode];
      return next;
    }), 3000);
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

  async function handleStopDirectConnect() {
    await window.api.stopDirectConnect();
    setDcStarting(false);
    setDcStatus(null);
  }

  async function copyCode() {
    if (!myIdentity?.connectCode) return;
    await window.api.copyToClipboard(myIdentity.connectCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // DC admin gate removed — feature well tested
  // const isDirectConnectUser = myIdentity?.connectCode === 'SMOK#1' || myIdentity?.connectCode === 'BF#0';
  const visibleSentInvites = sentInvites.filter((inv) => !inv.myOpened);
  const visiblePlayInvites = playInvites.filter((inv) => !inv.myOpened);
  const hasActiveInvites = sentInvites.length > 0 || playInvites.length > 0;

  useEffect(() => {
    if (!hasActiveInvites) return;
    const fastPoll = setInterval(() => {
      if (document.hidden) return;
      loadPlayInvites();
      loadSentInvites();
    }, 3_000);
    return () => clearInterval(fastPoll);
  }, [hasActiveInvites]);

  const wins = myProfile?.wins ?? 0;
  const losses = myProfile?.losses ?? 0;
  const total = wins + losses;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Player status card */}
      {myIdentity && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-4">
          <div className="flex items-center gap-4">
            {hideAvatar === null ? null : hideAvatar ? (
              myMainCharId != null ? (
                <div className="w-10 h-10 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center overflow-hidden shrink-0">
                  {getCharacterImagePath(myMainCharId) ? (
                    <img src={getCharacterImagePath(myMainCharId)} alt={getCharacterShortName(myMainCharId)} className="w-10 h-10 object-contain scale-[2]" />
                  ) : (
                    <span className="text-xs font-bold text-gray-400">{getCharacterShortName(myMainCharId).slice(0, 2)}</span>
                  )}
                </div>
              ) : null
            ) : myUser?.avatar_url ? (
              <img src={myUser.avatar_url} alt="" className="w-10 h-10 rounded-full border border-[#2a2a2a] shrink-0" />
            ) : null}
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
                {myProfile?.region && !hideRegion && (
                  <span className="text-[10px] text-gray-600">{myProfile.region}</span>
                )}
                {myProfile?.rating_ordinal && (
                  <RankBadge rating={myProfile.rating_ordinal} />
                )}
                {total > 0 && (
                  <span className="text-xs text-gray-600">{wins}W {losses}L</span>
                )}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2 relative">
              {!disableStatuses && (
                <div className="relative">
                  <button
                    onClick={() => setStatusPickerOpen(!statusPickerOpen)}
                    disabled={lfgToggling}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                      myStatusPreset
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30'
                        : lfg
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30'
                          : 'border border-[#2a2a2a] bg-[#1a1a1a] text-gray-400 hover:text-white hover:bg-[#222]'
                    }`}
                  >
                    {myStatusPreset || (lfg ? 'Looking to play!' : 'Set status')}
                  </button>
                  {statusPickerOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setStatusPickerOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 rounded-lg border border-[#2a2a2a] bg-[#141414] shadow-2xl py-1 min-w-[180px]">
                        {STATUS_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            onClick={() => handleSetStatusPreset(preset)}
                            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                              myStatusPreset === preset
                                ? 'text-amber-400 bg-amber-500/10'
                                : 'text-gray-300 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            {preset}
                            {myStatusPreset === preset && <span className="ml-2 text-[10px] text-amber-500/60">(active)</span>}
                          </button>
                        ))}
                        {(lfg || myStatusPreset) && (
                          <>
                            <div className="border-t border-[#2a2a2a] my-1" />
                            <button
                              onClick={() => handleSetStatusPreset(null)}
                              className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
                            >
                              Clear status
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
              <button
                onClick={handleToggleLfg}
                disabled={lfgToggling}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  lfg
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30'
                    : 'border border-[#2a2a2a] bg-[#1a1a1a] text-gray-400 hover:text-white hover:bg-[#222]'
                }`}
              >
                {lfg ? '🎮' : '🎮 Looking to play?'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Invites */}
      {(visibleSentInvites.length > 0 || visiblePlayInvites.length > 0) && (
        <div className="space-y-2">
          {visibleSentInvites.map((inv) => (
            <div key={`sent-${inv.id}`} className={`rounded-2xl border p-4 ${
              inv.status === 'accepted'
                ? 'border-[#21BA45]/30 bg-[#21BA45]/5'
                : 'border-blue-500/20 bg-blue-500/5'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-bold text-white text-sm">{inv.connectCode}</span>
                  {inv.displayName && (
                    <span className="text-xs text-gray-500 truncate">{inv.displayName}</span>
                  )}
                </div>
                {inv.status === 'accepted' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#21BA45]">Both Players are Ready!</span>
                    <button
                      onClick={() => handleDirectConnect(inv.connectCode, inv.id)}
                      disabled={dcStarting}
                      className="shrink-0 rounded-lg bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 transition-colors disabled:opacity-40"
                    >
                      Open Melee
                    </button>
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
          {visiblePlayInvites.map((inv) => (
            <div key={`recv-${inv.id}`} className={`rounded-2xl border p-4 ${
              inv.status === 'accepted'
                ? 'border-[#21BA45]/30 bg-[#21BA45]/5'
                : 'border-amber-500/20 bg-amber-500/5'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-bold text-white text-sm">{inv.connectCode}</span>
                  {inv.displayName && (
                    <span className="text-xs text-gray-500 truncate">{inv.displayName}</span>
                  )}
                </div>
                {inv.status === 'accepted' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#21BA45]">Both Players are Ready!</span>
                    <button
                      onClick={() => handleDirectConnect(inv.connectCode, inv.id)}
                      disabled={dcStarting}
                      className="shrink-0 rounded-lg bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 transition-colors disabled:opacity-40"
                    >
                      Open Melee
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-amber-400">{inv.connectCode} wants to play!</span>
                    <button
                      onClick={() => handleAcceptInvite(inv.id)}
                      disabled={acceptingInvite === inv.id}
                      className="shrink-0 rounded-lg bg-[#21BA45] px-4 py-2 text-sm font-bold text-white hover:bg-[#1ea33e] transition-colors disabled:opacity-50"
                    >
                      {acceptingInvite === inv.id ? '...' : 'Accept'}
                    </button>
                    <button
                      onClick={() => { window.api.dismissInvite(inv.id); loadPlayInvites(); }}
                      className="shrink-0 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Decline
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
            <PlayerCard
              key={f.id}
              player={{
                connectCode: f.connectCode,
                displayName: f.displayName,
                discordUsername: f.discordUsername,
                discordId: f.discordId,
                avatarUrl: f.avatarUrl,
                region: f.region,
                rating: f.rating,
                characterId: f.characterId,
              }}
              showStatus={false}
              onClick={() => handleCopy(f.connectCode)}
              onBlock={() => setConfirmBlock({ code: f.connectCode })}
              onUnsend={() => setConfirmRemove({ id: f.id, code: f.connectCode })}
            />
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
        {/* Confirmation modal — remove */}
        {confirmRemove && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmRemove(null)}>
            <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6 w-[320px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-gray-300 text-center">
                Remove <span className="font-mono font-bold text-white">{confirmRemove.code}</span>?
              </p>
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setConfirmRemove(null)}
                  className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-[#222] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRemove(confirmRemove.id)}
                  className="flex-1 rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Confirmation modal — block */}
        {confirmBlock && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmBlock(null)}>
            <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6 w-[320px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-gray-300 text-center">
                Block <span className="font-mono font-bold text-white">{confirmBlock.code}</span>?
              </p>
              <p className="text-xs text-gray-500 text-center mt-2">
                They won't appear on your Discover page and can't send you requests or invites. You can unblock from Settings.
              </p>
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => setConfirmBlock(null)}
                  className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-[#222] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleBlock(confirmBlock.code)}
                  className="flex-1 rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  Block
                </button>
              </div>
            </div>
          </div>
        )}

        {accepted.map((f) => {
          const invState = inviteSent[f.connectCode];
          const nudgeMsg = nudgeSent[f.connectCode];
          return (
            <PlayerCard
              key={f.id}
              player={{
                connectCode: f.connectCode,
                displayName: f.displayName,
                discordUsername: f.discordUsername,
                discordId: f.discordId,
                avatarUrl: f.avatarUrl,
                region: f.region,
                rating: f.rating,
                characterId: f.characterId,
                status: f.status,
                currentCharacter: f.currentCharacter,
                opponentCode: f.opponentCode,
                playingSince: f.playingSince,
                lookingToPlay: f.lookingToPlay,
                statusPreset: disableStatuses ? undefined : (f.statusPreset ?? undefined),
              }}
              onClick={() => handleCopy(f.connectCode)}
              onBlock={() => setConfirmBlock({ code: f.connectCode })}
              onRemove={() => setConfirmRemove({ id: f.id, code: f.connectCode })}
              onInvite={() => handleInvite(f.connectCode)}
              inviteDisabled={inviting === f.connectCode || hasActiveInvites}
              inviteState={invState ?? null}
              nudgeOptions={disableNudges ? undefined : NUDGE_OPTIONS}
              onNudge={disableNudges ? undefined : (msg) => handleNudge(f.connectCode, msg)}
              nudgeState={nudgeMsg ?? null}
            />
          );
        })}
      </div>
    </div>
  );
}
