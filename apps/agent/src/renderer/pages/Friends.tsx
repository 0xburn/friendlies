import { useEffect, useState, useMemo } from 'react';
import { isGameActive } from '../App';
import { ConnectionTypeIcon } from '../components/ConnectionTypeIcon';
import { OnlineIndicator } from '../components/OnlineIndicator';
import { PlayerCard } from '../components/PlayerCard';
import { RankBadge } from '../components/RankBadge';
import { CharacterIcon } from '../components/CharacterIcon';
import { CHARACTER_MAP, getCharacterImagePath, getCharacterShortName } from '../lib/characters';
import { getRankTier } from '../lib/ranks';

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

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
  topCharacters?: { characterId: number; gameCount: number }[];
  status?: 'online' | 'in-game' | 'offline' | 'idle';
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
  note?: string | null;
  connectionType?: 'wifi' | 'ethernet' | null;
  region?: string | null;
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
  const [onlineMap, setOnlineMap] = useState<Record<string, { status: string; opponentCode?: string; currentCharacter?: number | null; playingSince?: string; lookingToPlay?: boolean; statusPreset?: string | null; connectionType?: 'wifi' | 'ethernet' | null }>>({});
  const [search, setSearch] = useState('');
  const [addCode, setAddCode] = useState('');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addNoteModal, setAddNoteModal] = useState(false);
  const [addNote, setAddNote] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [responding, setResponding] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [inviteSent, setInviteSent] = useState<Record<string, string | true>>({});
  const [inviting, setInviting] = useState<string | null>(null);
  const [playInvites, setPlayInvites] = useState<{ id: string; connectCode: string; displayName?: string; discordUsername?: string; avatarUrl?: string; rating?: number | null; created_at: string; status: string; myOpened?: boolean; mainCharacter?: number | null; connectionType?: 'wifi' | 'ethernet' | null; region?: string | null }[]>([]);
  const [sentInvites, setSentInvites] = useState<{ id: string; connectCode: string; displayName?: string; discordUsername?: string; avatarUrl?: string; rating?: number | null; created_at: string; status: string; myOpened?: boolean; mainCharacter?: number | null; connectionType?: 'wifi' | 'ethernet' | null; region?: string | null }[]>([]);
  const [acceptingInvite, setAcceptingInvite] = useState<string | null>(null);
  const [dcStatus, setDcStatus] = useState<{ status: string; message: string; connectCode?: string } | null>(null);
  const [dcStarting, setDcStarting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; code: string } | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<{ code: string } | null>(null);
  const [pendingHidden, setPendingHidden] = useState(() => localStorage.getItem('pendingHidden') === '1');
  const [incomingHidden, setIncomingHidden] = useState(() => localStorage.getItem('incomingHidden') === '1');
  const [blocking, setBlocking] = useState<string | null>(null);

  const [myStatus, setMyStatus] = useState<'online' | 'in-game' | 'offline' | 'idle'>('offline');
  const [lfg, setLfg] = useState(false);
  const [lfgToggling, setLfgToggling] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'in-game' | 'offline'>('all');
  const [rankFilter, setRankFilter] = useState<string>('all');
  const [myIdentity, setMyIdentity] = useState<{ connectCode: string; displayName: string } | null>(null);
  const [myUser, setMyUser] = useState<{ avatar_url?: string; discord_name?: string } | null>(null);
  const [myProfile, setMyProfile] = useState<{ rating_ordinal?: number; wins?: number; losses?: number; region?: string | null; topCharacters?: { characterId: number; gameCount: number }[]; discord_username?: string | null; discord_id?: string | null } | null>(null);
  const [myOpponentCode, setMyOpponentCode] = useState<string | null>(null);
  const [myCharacterId, setMyCharacterId] = useState<number | null>(null);
  const [myOppCharId, setMyOppCharId] = useState<number | null>(null);
  const [myPlayingSince, setMyPlayingSince] = useState<string | null>(null);
  const [hideRegion, setHideRegion] = useState(false);
  const [hideAvatar, setHideAvatar] = useState<boolean | null>(null);
  const [hideConnectionType, setHideConnectionType] = useState(false);
  const [hideOnlineStatus, setHideOnlineStatus] = useState(false);
  const [myConnectionType, setMyConnectionType] = useState<'wifi' | 'ethernet' | null>(null);
  const [myMainCharId, setMyMainCharId] = useState<number | null>(null);
  const [myChosenMain, setMyChosenMain] = useState<number | null>(null);
  const [myChosenSecondary, setMyChosenSecondary] = useState<number | null>(null);
  const [mainPickerOpen, setMainPickerOpen] = useState(false);
  const [secondaryPickerOpen, setSecondaryPickerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [myStatusPreset, setMyStatusPreset] = useState<string | null>(null);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [lfgExpiryMinutes, setLfgExpiryMinutes] = useState<number | null>(60);
  const [disableStatuses, setDisableStatuses] = useState(false);
  const [disableNudges, setDisableNudges] = useState(false);
  const [visibleCount, setVisibleCount] = useState(15);

  const [nudgeSent, setNudgeSent] = useState<Record<string, string>>({});
  const [declineModal, setDeclineModal] = useState<{ id: string; connectCode: string } | null>(null);
  const [declineNudgeChoice, setDeclineNudgeChoice] = useState<string | null>(null);
  const [decliningInvite, setDecliningInvite] = useState(false);

  const HIDDEN_CHARACTERS = new Set<number>();
  const CHAR_OPTIONS = Object.keys(CHARACTER_MAP).map(Number).filter((id) => !HIDDEN_CHARACTERS.has(id)).sort((a, b) => CHARACTER_MAP[a].localeCompare(CHARACTER_MAP[b]));

  const STATUS_PRESETS = ['Down for friendlies', 'Ranked grind', 'Warming up', 'Quick session', 'Running sets', 'Will play anyone', 'Labbing tech', 'Need spacie practice', 'Need floatie practice'];
  const LFG_EXPIRY_OPTIONS: { label: string; value: number | null }[] = [
    { label: '30m', value: 30 },
    { label: '1h', value: 60 },
    { label: '2h', value: 120 },
    { label: '∞', value: null },
  ];
  const NUDGE_OPTIONS = ['GGs', 'one more', 'gtg', 'you play so hot and cool', 'that was sick', "you're cracked", "i'm cracked", "i'm so high", 'check discord', 'hi'];
  const DECLINE_NUDGE_OPTIONS = ['Down in 5-15 min', 'Sorry, another time', 'Looking for different matchup', 'Message me on Discord'];

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
        setMyProfile({ rating_ordinal: p.rating_ordinal, wins: p.wins, losses: p.losses, region: p.region ?? null, topCharacters: topChars, discord_username: p.discord_username ?? null, discord_id: p.discord_id ?? null });
        setMyChosenMain(p.main_character ?? null);
        setMyChosenSecondary(p.secondary_character ?? null);
        const displayMain = p.main_character ?? topChars[0]?.characterId;
        if (displayMain != null) setMyMainCharId(displayMain);
      }
    });
    window.api.getLocalStatus().then((s: any) => {
      if (s && typeof s === 'object' && s.displayStatus) {
        setMyStatus(s.displayStatus);
      } else if (typeof s === 'string') {
        setMyStatus(s === 'in-game' ? 'in-game' : s === 'online' ? 'online' : 'offline');
      }
    });
    window.api.isLookingToPlay().then((v: boolean) => setLfg(v));
    window.api.getStatusPreset().then((v: string | null) => setMyStatusPreset(v));
    window.api.getLfgExpiry().then((v: number | null) => setLfgExpiryMinutes(v));
    window.api.getSettings().then((s: any) => {
      setDisableStatuses(!!s.disableStatuses);
      setDisableNudges(!!s.disableNudges);
    });
    window.api.getPrivacy().then((p) => {
      setHideRegion(p.hideRegion);
      setHideAvatar(p.hideAvatar);
      setHideConnectionType(p.hideConnectionType);
      setHideOnlineStatus(p.hideOnlineStatus);
    }).catch(() => {});
    window.api.getConnectionType().then(setMyConnectionType).catch(() => {});

    const loadStart = performance.now();
    Promise.all([loadFriends(), loadIncoming(), pollFriendStatuses(), loadPlayInvites(), loadSentInvites()]).finally(() => {
      console.log(`[bench] Friends tab initial load: ${(performance.now() - loadStart).toFixed(0)}ms`);
      setInitialLoading(false);
    });

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
            connectionType: u.connectionType ?? prev[u.connectCode]?.connectionType ?? null,
          };
        });
        return next;
      });
    });

    const unsubStatus = window.api.onLocalStatus((info: any) => {
      setMyStatus(info.displayStatus || info.status || 'online');
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
      if (document.hidden || isGameActive()) return;
      pollFriendStatuses();
      loadFriends();
      loadIncoming();
      loadPlayInvites();
      loadSentInvites();
      window.api.getConnectionType().then(setMyConnectionType).catch(() => {});
    }, 30_000);
    const onVisible = () => {
      if (!document.hidden) {
        pollFriendStatuses();
        loadFriends();
        loadIncoming();
        loadPlayInvites();
        loadSentInvites();
        window.api.getConnectionType().then(setMyConnectionType).catch(() => {});
        window.api.getPrivacy().then((p) => {
          setHideRegion(p.hideRegion);
          setHideAvatar(p.hideAvatar);
          setHideConnectionType(p.hideConnectionType);
          setHideOnlineStatus(p.hideOnlineStatus);
        }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { unsub(); unsubStatus(); unsubDc(); unsubInvRefresh(); clearInterval(dbPoll); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  async function pollFriendStatuses() {
    try {
      const statuses = await window.api.getFriendStatuses();
      if (statuses && typeof statuses === 'object') {
        const mapped: Record<string, { status: string; opponentCode?: string; currentCharacter?: number | null; playingSince?: string; lookingToPlay?: boolean; statusPreset?: string | null; connectionType?: 'wifi' | 'ethernet' | null }> = {};
        for (const [code, val] of Object.entries(statuses as Record<string, any>)) {
          mapped[code] = {
            status: val.status,
            opponentCode: val.opponentCode ?? undefined,
            currentCharacter: val.currentCharacter ?? null,
            playingSince: val.playingSince ?? undefined,
            lookingToPlay: val.lookingToPlay ?? false,
            statusPreset: val.statusPreset ?? null,
            connectionType: val.connectionType ?? null,
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
        avatarUrl: d.avatarUrl ?? null,
        rating: d.rating ?? null,
        created_at: d.created_at,
        status: d.status || 'pending',
        myOpened: !!d.receiver_opened,
        mainCharacter: d.mainCharacter ?? null,
        connectionType: d.connectionType ?? null,
        region: d.region ?? null,
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
        avatarUrl: d.avatarUrl ?? null,
        rating: d.rating ?? null,
        created_at: d.created_at,
        status: d.status || 'pending',
        myOpened: !!d.sender_opened,
        mainCharacter: d.mainCharacter ?? null,
        connectionType: d.connectionType ?? null,
        region: d.region ?? null,
      }));
      setSentInvites(invites);
      const activeCodes = new Set(invites.map((v) => v.connectCode));
      setInviteSent((prev) => {
        const next: Record<string, string | true> = {};
        for (const [code, val] of Object.entries(prev)) {
          if (activeCodes.has(code)) next[code] = val;
        }
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
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
        connectionType: presence?.connectionType ?? null,
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
        if (statusFilter === 'online') return s === 'online' || s === 'in-game' || s === 'idle';
        return s === statusFilter;
      });
    }

    if (rankFilter !== 'all') {
      list = list.filter((f) => {
        if (!f.rating) return rankFilter === 'unranked';
        return getRankTier(f.rating).name === rankFilter;
      });
    }

    function sortScore(f: typeof list[0]): number {
      if (f.lookingToPlay && !f.opponentCode) return -2;
      if (f.lookingToPlay && f.opponentCode) return -1;
      const s = f.status || 'offline';
      if (s === 'in-game' && f.currentCharacter != null) return 0;
      if (s === 'in-game') return 1;
      if (s === 'online' || s === 'idle') return 2;
      return 3;
    }
    const sorted = [...list].sort((a, b) => sortScore(a) - sortScore(b));

    return {
      accepted: sorted.filter((f) => f.friendStatus === 'accepted'),
      pendingOut: sorted.filter((f) => f.friendStatus === 'pending'),
    };
  }, [enriched, search, statusFilter, rankFilter]);

  function handleAddClick() {
    const code = addCode.trim().toUpperCase();
    if (!code) return;
    if (!code.includes('#')) {
      setAddError('Connect codes must include # (e.g. ABCD#123)');
      return;
    }
    setAddError('');
    setAddNote(null);
    setAddNoteModal(true);
  }

  async function handleAddConfirm() {
    const code = addCode.trim().toUpperCase();
    setAddNoteModal(false);
    setAddLoading(true);
    setAddError('');
    const result = await window.api.addFriend(code, addNote ?? undefined);
    if (result.error) {
      setAddError(result.error);
    } else {
      setAddCode('');
      setAddNote(null);
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

  async function handleDeclineInvite(withNudge: boolean) {
    if (!declineModal) return;
    setDecliningInvite(true);
    if (withNudge && declineNudgeChoice) {
      await window.api.sendNudge(declineModal.connectCode, declineNudgeChoice);
    }
    await window.api.dismissInvite(declineModal.id);
    await loadPlayInvites();
    setDeclineModal(null);
    setDeclineNudgeChoice(null);
    setDecliningInvite(false);
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

  async function handleSetMain(charId: number | null) {
    setMyChosenMain(charId);
    setMainPickerOpen(false);
    const topChars = myProfile?.topCharacters ?? [];
    setMyMainCharId(charId ?? topChars[0]?.characterId ?? null);
    await window.api.updateCharacters({ mainCharacter: charId });
  }

  async function handleSetSecondary(charId: number | null) {
    setMyChosenSecondary(charId);
    setSecondaryPickerOpen(false);
    await window.api.updateCharacters({ secondaryCharacter: charId });
  }

  // DC admin gate removed — feature well tested
  // const isDirectConnectUser = myIdentity?.connectCode === 'SMOK#1' || myIdentity?.connectCode === 'BF#0';
  const visibleSentInvites = sentInvites.filter((inv) => !inv.myOpened || inv.status === 'pending');
  const visiblePlayInvites = playInvites.filter((inv) => !inv.myOpened || inv.status === 'pending');
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

  const wins = myProfile?.wins ?? 0;
  const losses = myProfile?.losses ?? 0;
  const total = wins + losses;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Player status card */}
      {myIdentity && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-4">
          <div className="flex items-center gap-4">
            {hideAvatar === null ? null : hideAvatar ? (
              myMainCharId != null ? (
                <div className="w-10 h-10 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center overflow-hidden shrink-0">
                  {getCharacterImagePath(myMainCharId) ? (
                    <img src={getCharacterImagePath(myMainCharId)} alt={getCharacterShortName(myMainCharId)} className="w-7 h-7 object-contain" />
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
                  status={hideOnlineStatus ? 'offline' : myStatus}
                  size="md"
                  opponentCode={hideOnlineStatus ? null : myOpponentCode}
                  opponentCharacterId={hideOnlineStatus ? null : myOppCharId}
                  characterId={hideOnlineStatus ? null : myCharacterId}
                  playingSince={hideOnlineStatus ? null : myPlayingSince}
                />
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  {myIdentity.displayName && (
                    <span className="text-xs text-gray-500 truncate">{myIdentity.displayName}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  {myProfile?.region && !hideRegion && (
                    <span className="text-[10px] text-gray-600">{myProfile.region}</span>
                  )}
                  {myConnectionType && !hideConnectionType && (
                    <ConnectionTypeIcon type={myConnectionType} />
                  )}
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  {myProfile?.discord_username && (
                    <button
                      onClick={() => { if (myProfile?.discord_id) window.api.openDiscordProfile(myProfile.discord_id); }}
                      className={`inline-flex items-center gap-1 min-w-0 rounded-md bg-[#5865F2]/10 px-1.5 py-0.5 transition-colors ${
                        myProfile?.discord_id ? 'hover:bg-[#5865F2]/25 cursor-pointer' : 'cursor-default'
                      }`}
                      title={myProfile?.discord_id ? 'Open in Discord' : undefined}
                    >
                      <DiscordIcon className="w-3.5 h-3.5 text-[#5865F2] shrink-0" />
                      <span className="text-xs font-medium text-[#5865F2] truncate">@{myProfile.discord_username}</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  {myProfile?.rating_ordinal && (
                    <RankBadge rating={myProfile.rating_ordinal} />
                  )}
                  {total > 0 && (
                    <span className="text-xs text-gray-600">{wins}W {losses}L</span>
                  )}
                </div>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2 relative">
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
                  {myStatusPreset || (lfg ? '🎮 Looking to play!' : '🎮 Looking to play?')}
                </button>
                {statusPickerOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setStatusPickerOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 rounded-lg border border-[#2a2a2a] bg-[#141414] shadow-2xl py-1 min-w-[180px]">
                      {!disableStatuses && STATUS_PRESETS.map((preset) => (
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
                      {!disableStatuses && !lfg && !myStatusPreset && (
                        <>
                          <div className="border-t border-[#2a2a2a] my-1" />
                          <button
                            onClick={() => { handleToggleLfg(); setStatusPickerOpen(false); }}
                            className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
                          >
                            🎮 Just looking to play
                          </button>
                        </>
                      )}
                      <div className="border-t border-[#2a2a2a] my-1" />
                      <div className="px-3 py-2 flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 whitespace-nowrap">Expire after</span>
                        <div className="flex gap-1">
                          {LFG_EXPIRY_OPTIONS.map((opt) => (
                            <button
                              key={opt.label}
                              onClick={(e) => {
                                e.stopPropagation();
                                setLfgExpiryMinutes(opt.value);
                                window.api.setLfgExpiry(opt.value);
                              }}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                lfgExpiryMinutes === opt.value
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : 'text-gray-500 hover:text-gray-300 border border-[#2a2a2a] hover:border-[#3a3a3a]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
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
            </div>
            <div className="shrink-0 relative">
              <button
                onClick={() => { setMainPickerOpen(!mainPickerOpen); setSecondaryPickerOpen(false); }}
                className="flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-2 py-1.5 hover:border-[#3a3a3a] transition-colors"
              >
                {myChosenMain != null ? (
                  <>
                    <CharacterIcon characterId={myChosenMain} size="sm" />
                    <span className="text-xs text-white">{getCharacterShortName(myChosenMain)}</span>
                  </>
                ) : (
                  <span className="text-xs text-gray-500">Main</span>
                )}
                <svg className="w-3 h-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </button>
              {mainPickerOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMainPickerOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 rounded-lg border border-[#2a2a2a] bg-[#141414] shadow-2xl py-1 max-h-[280px] overflow-y-auto min-w-[160px]">
                    {myChosenMain != null && (
                      <>
                        <button
                          onClick={() => handleSetMain(null)}
                          className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
                        >
                          None
                        </button>
                        <div className="border-t border-[#2a2a2a] my-1" />
                      </>
                    )}
                    {CHAR_OPTIONS.map((id) => (
                      <button
                        key={id}
                        onClick={() => handleSetMain(id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                          myChosenMain === id ? 'text-[#21BA45] bg-[#21BA45]/10' : 'text-gray-300 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {getCharacterImagePath(id) && <img src={getCharacterImagePath(id)} alt="" className="w-9 h-9 object-contain" />}
                        {CHARACTER_MAP[id]}
                      </button>
                    ))}
                  </div>
                </>
              )}
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
          {visiblePlayInvites.map((inv) => (
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
                      {inv.region && <span className="text-[10px] text-gray-600 truncate">{inv.region}</span>}
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
                          onClick={() => { window.api.dismissInvite(inv.id); loadPlayInvites(); }}
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
                      onClick={() => { setDeclineNudgeChoice(null); setDeclineModal({ id: inv.id, connectCode: inv.connectCode }); }}
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
                onClick={() => { setStatusFilter(f); setVisibleCount(15); }}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  statusFilter === f
                    ? 'bg-[#21BA45]/15 text-[#21BA45]'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                {f === 'all' ? `All (${enriched.filter(e => e.friendStatus === 'accepted').length})` : f === 'online' ? 'Online' : f === 'in-game' ? 'In Game' : 'Offline'}
              </button>
            ))}
            <select
              value={rankFilter}
              onChange={(e) => { setRankFilter(e.target.value); setVisibleCount(15); }}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium border focus:outline-none cursor-pointer appearance-none pr-6 bg-[#21BA45]/15 text-[#21BA45] border-[#21BA45]/30"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
            >
              <option value="all">Rank ▾</option>
              {['Master', 'Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze'].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
              <option value="unranked">Unranked</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={addCode}
          onChange={(e) => setAddCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddClick()}
          placeholder="Add by connect code (e.g. ABCD#123)"
          className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-[#21BA45]/50"
        />
        <button
          onClick={handleAddClick}
          disabled={addLoading || !addCode.trim()}
          className="shrink-0 rounded-lg bg-[#21BA45] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#1ea33e] disabled:opacity-40"
        >
          {addLoading ? '...' : 'Add'}
        </button>
      </div>
      {addError && <p className="text-red-400 text-xs">{addError}</p>}

      {/* Incoming Requests */}
      {incoming.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-yellow-500/80 uppercase tracking-wider">
                Incoming Requests ({incoming.length})
              </h2>
              {!incomingHidden && (
                <span className="text-[11px] text-gray-600 italic">Tip: you can collapse these!</span>
              )}
            </div>
            <button
              onClick={() => setIncomingHidden((h) => { const next = !h; localStorage.setItem('incomingHidden', next ? '1' : '0'); return next; })}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                incomingHidden
                  ? 'border border-yellow-500/30 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20'
                  : 'border border-[#2a2a2a] bg-[#1a1a1a] text-gray-400 hover:text-white hover:border-[#3a3a3a]'
              }`}
            >
              {incomingHidden ? `Show (${incoming.length})` : 'Hide'}
            </button>
          </div>
          {!incomingHidden && incoming.map((req) => (
            <div key={req.id} className="flex items-center gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3">
              {req.avatarUrl ? (
                <img src={req.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 border border-yellow-500/20" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-gray-600 text-xs font-bold shrink-0">
                  {req.connectCode.slice(0, 2)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-white text-sm">{req.connectCode}</span>
                  {req.characterId != null && <CharacterIcon characterId={req.characterId} size="sm" />}
                  <RankBadge rating={req.rating} />
                  {req.connectionType && <ConnectionTypeIcon type={req.connectionType} />}
                  {req.region && <span className="text-[10px] text-gray-600 truncate">{req.region}</span>}
                </div>
                {(req.displayName || req.discordUsername) && (
                  <p className="text-xs text-gray-400 truncate">
                    {req.displayName || `@${req.discordUsername}`}
                  </p>
                )}
                {req.note && (
                  <p className="text-xs text-gray-500 italic truncate">&ldquo;{req.note}&rdquo;</p>
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
                <button
                  onClick={() => setConfirmBlock({ code: req.connectCode })}
                  disabled={blocking === req.connectCode}
                  className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-2.5 py-1.5 text-xs text-gray-500 hover:text-red-400 hover:border-red-500/30 transition-colors disabled:opacity-50"
                >
                  {blocking === req.connectCode ? '...' : 'Block'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending Outgoing */}
      {pendingOut.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Pending ({pendingOut.length})
              </h2>
              {!pendingHidden && (
                <span className="text-[11px] text-gray-600 italic">Tip: you can collapse these!</span>
              )}
            </div>
            <button
              onClick={() => setPendingHidden((h) => { const next = !h; localStorage.setItem('pendingHidden', next ? '1' : '0'); return next; })}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                pendingHidden
                  ? 'border border-[#21BA45]/30 bg-[#21BA45]/10 text-[#21BA45] hover:bg-[#21BA45]/20'
                  : 'border border-[#2a2a2a] bg-[#1a1a1a] text-gray-400 hover:text-white hover:border-[#3a3a3a]'
              }`}
            >
              {pendingHidden ? `Show (${pendingOut.length})` : 'Hide'}
            </button>
          </div>
          {!pendingHidden && pendingOut.map((f) => (
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
          onChange={(e) => { setSearch(e.target.value); setVisibleCount(15); }}
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
        {addNoteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setAddNoteModal(false)}>
            <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6 w-[360px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-white font-semibold text-center">
                Add <span className="font-mono text-[#21BA45]">{addCode.trim().toUpperCase()}</span>
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
                  onClick={() => { setAddNote(null); setAddNoteModal(false); }}
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

        {declineModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setDeclineModal(null); setDeclineNudgeChoice(null); }}>
            <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6 w-[360px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-sm text-white font-semibold text-center">
                Decline invite from <span className="font-mono text-amber-400">{declineModal.connectCode}</span>
              </p>
              <p className="text-xs text-gray-400 text-center mt-2 leading-relaxed">
                Want to send a quick nudge with the decline? They'll see it in their GGs tab.
              </p>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {DECLINE_NUDGE_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setDeclineNudgeChoice(declineNudgeChoice === opt ? null : opt)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      declineNudgeChoice === opt
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        : 'bg-[#1a1a1a] text-gray-400 border border-[#2a2a2a] hover:border-gray-500'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div className="flex gap-3 mt-5">
                <button
                  onClick={() => { setDeclineModal(null); setDeclineNudgeChoice(null); }}
                  className="flex-1 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-white hover:bg-[#222] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => handleDeclineInvite(!!declineNudgeChoice)}
                  disabled={decliningInvite}
                  className="flex-1 rounded-lg bg-red-500/20 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  {decliningInvite ? '...' : declineNudgeChoice ? 'Decline with nudge' : 'Decline without nudge'}
                </button>
              </div>
            </div>
          </div>
        )}

        {accepted.slice(0, visibleCount).map((f) => {
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
                topCharacters: f.topCharacters,
                status: f.status,
                currentCharacter: f.currentCharacter,
                opponentCode: f.opponentCode,
                playingSince: f.playingSince,
                lookingToPlay: f.lookingToPlay,
                statusPreset: disableStatuses ? undefined : (f.statusPreset ?? undefined),
                connectionType: f.connectionType ?? undefined,
              }}
              onClick={() => handleCopy(f.connectCode)}
              onBlock={() => setConfirmBlock({ code: f.connectCode })}
              onRemove={() => setConfirmRemove({ id: f.id, code: f.connectCode })}
              onInvite={() => handleInvite(f.connectCode)}
              inviteDisabled={inviting === f.connectCode || !!inviteSent[f.connectCode]}
              inviteState={invState ?? null}
              nudgeOptions={disableNudges ? undefined : NUDGE_OPTIONS}
              onNudge={disableNudges ? undefined : (msg) => handleNudge(f.connectCode, msg)}
              nudgeState={nudgeMsg ?? null}
            />
          );
        })}

        {accepted.length > visibleCount && (
          <button
            onClick={() => setVisibleCount((c) => c + 15)}
            className="w-full rounded-xl border border-[#2a2a2a] bg-[#141414] py-3 text-sm font-medium text-gray-400 hover:text-white hover:bg-[#1a1a1a] transition-colors"
          >
            Load more ({accepted.length - visibleCount} remaining)
          </button>
        )}
      </div>
    </div>
  );
}

