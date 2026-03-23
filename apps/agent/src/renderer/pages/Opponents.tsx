import { useEffect, useRef, useState } from 'react';
import { CharacterIcon } from '../components/CharacterIcon';
import { PlayerStatsPanel } from '../components/PlayerStatsPanel';

const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL = 30_000;
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes between games = new session

interface Match {
  id: string;
  opponent_connect_code: string;
  opponent_display_name?: string;
  opponent_character_id?: number | null;
  user_character_id?: number | null;
  played_at: string;
  stage_id?: number | null;
  did_win?: boolean | null;
}

interface Session {
  opponentCode: string;
  opponentName?: string;
  wins: number;
  losses: number;
  opponentCharacters: number[];
  userCharacters: number[];
  latestPlayedAt: string;
  games: Match[];
}

function groupIntoSessions(matches: Match[]): Session[] {
  if (matches.length === 0) return [];

  const sorted = [...matches].sort(
    (a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime(),
  );

  const sessions: Session[] = [];
  let current: Session | null = null;

  for (const m of sorted) {
    const ts = new Date(m.played_at).getTime();
    const currentTs = current
      ? new Date(current.games[current.games.length - 1].played_at).getTime()
      : 0;

    const isSameSession =
      current &&
      current.opponentCode === m.opponent_connect_code &&
      currentTs - ts < SESSION_GAP_MS;

    if (isSameSession && current) {
      current.games.push(m);
      if (m.did_win === true) current.wins++;
      else if (m.did_win === false) current.losses++;
      if (m.opponent_character_id != null && !current.opponentCharacters.includes(m.opponent_character_id)) {
        current.opponentCharacters.push(m.opponent_character_id);
      }
      if (m.user_character_id != null && !current.userCharacters.includes(m.user_character_id)) {
        current.userCharacters.push(m.user_character_id);
      }
    } else {
      current = {
        opponentCode: m.opponent_connect_code,
        opponentName: m.opponent_display_name,
        wins: m.did_win === true ? 1 : 0,
        losses: m.did_win === false ? 1 : 0,
        opponentCharacters: m.opponent_character_id != null ? [m.opponent_character_id] : [],
        userCharacters: m.user_character_id != null ? [m.user_character_id] : [],
        latestPlayedAt: m.played_at,
        games: [m],
      };
      sessions.push(current);
    }
  }

  return sessions;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function SessionRow({
  session,
  onAddFriend,
  friendState,
  discordUsername,
}: {
  session: Session;
  onAddFriend?: (code: string) => void;
  friendState: 'none' | 'adding' | 'pending' | 'friends';
  discordUsername?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = session.wins + session.losses;
  const hasRecord = total > 0;

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] transition-all hover:border-[#2a2a2a]/80">
      <div
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {/* Character matchup: user vs opponent */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center -space-x-1">
            {session.userCharacters.length > 0
              ? session.userCharacters.map((cId) => (
                  <CharacterIcon key={`u-${cId}`} characterId={cId} size="sm" />
                ))
              : (
                <div className="w-6 h-6 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-[10px] text-gray-600 font-mono">
                  ?
                </div>
              )}
          </div>
          <span className="text-[10px] text-gray-600 font-bold">vs</span>
          <div className="flex items-center -space-x-1">
            {session.opponentCharacters.length > 0
              ? session.opponentCharacters.map((cId) => (
                  <CharacterIcon key={`o-${cId}`} characterId={cId} size="sm" />
                ))
              : (
                <div className="w-6 h-6 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-[10px] text-gray-600 font-mono">
                  ?
                </div>
              )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-white text-sm">
              {session.opponentCode}
            </span>
            <span className="text-xs text-gray-600">
              {session.games.length} game{session.games.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {session.opponentName && (
              <p className="text-xs text-gray-500 truncate">{session.opponentName}</p>
            )}
            {friendState === 'friends' && discordUsername && (
              <span className="inline-flex items-center gap-1 text-xs text-[#5865F2]/70">
                <DiscordIcon className="w-3 h-3" />
                <span className="truncate">{discordUsername}</span>
              </span>
            )}
          </div>
        </div>

        {hasRecord && (
          <div className="shrink-0 text-right">
            <span className="font-mono text-sm font-bold">
              <span className={session.wins >= session.losses ? 'text-[#21BA45]' : 'text-white'}>
                {session.wins}
              </span>
              <span className="text-gray-600">-</span>
              <span className={session.losses > session.wins ? 'text-red-400' : 'text-white'}>
                {session.losses}
              </span>
            </span>
          </div>
        )}

        <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">
          {timeAgo(session.latestPlayedAt)}
        </span>

        {friendState === 'friends' ? (
          <span className="shrink-0 rounded-lg border border-[#21BA45]/20 bg-[#21BA45]/5 px-3 py-1 text-xs font-medium text-[#21BA45]/60">
            Friends
          </span>
        ) : friendState === 'pending' ? (
          <span className="shrink-0 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-1 text-xs font-medium text-yellow-500/70">
            Pending
          </span>
        ) : friendState === 'adding' ? (
          <span className="shrink-0 rounded-lg border border-[#2a2a2a] px-3 py-1 text-xs text-gray-500 animate-pulse">
            Adding...
          </span>
        ) : onAddFriend ? (
          <button
            onClick={(e) => { e.stopPropagation(); onAddFriend(session.opponentCode); }}
            className="shrink-0 rounded-lg border border-[#21BA45]/30 bg-[#21BA45]/10 px-3 py-1 text-xs font-medium text-[#21BA45] hover:bg-[#21BA45]/20 transition-colors"
          >
            Add Friend
          </button>
        ) : null}

        <svg
          className={`w-4 h-4 text-gray-600 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && (
        <div className="border-t border-[#2a2a2a]">
          <PlayerStatsPanel connectCode={session.opponentCode} />
        </div>
      )}
    </div>
  );
}

export function Opponents() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [friendMap, setFriendMap] = useState<Map<string, { status: 'pending' | 'accepted'; discordUsername?: string | null }>>(new Map());
  const [adding, setAdding] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadedWeeks = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    initialLoad();
    loadFriendCodes();

    const unsub = window.api.onNewOpponent((opp) => {
      setMatches((prev) => [opp, ...prev]);
    });

    pollRef.current = setInterval(() => {
      refreshFromDb();
      loadFriendCodes();
    }, POLL_INTERVAL);

    return () => {
      unsub();
      clearInterval(pollRef.current);
    };
  }, []);

  async function loadFriendCodes() {
    try {
      const friends = await window.api.getFriends();
      const map = new Map<string, { status: 'pending' | 'accepted'; discordUsername?: string | null }>();
      friends.forEach((f: any) => {
        if (f.connectCode) {
          map.set(f.connectCode, {
            status: f.friendStatus || 'pending',
            discordUsername: f.friendStatus === 'accepted' ? f.discordUsername : null,
          });
        }
      });
      setFriendMap(map);
    } catch { /* ignore */ }
  }

  async function refreshFromDb() {
    const data = await window.api.getOpponents(200);
    setMatches(data);
  }

  async function initialLoad() {
    const data = await window.api.getOpponents(200);
    setMatches(data);
    if (data.length === 0) {
      setScanning(true);
      await window.api.backfillOpponents(ONE_WEEK, 0);
      loadedWeeks.current = 1;
      const refreshed = await window.api.getOpponents(200);
      setMatches(refreshed);
      setScanning(false);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    const beforeMs = loadedWeeks.current * ONE_WEEK;
    const result = await window.api.backfillOpponents(ONE_WEEK, beforeMs);
    loadedWeeks.current += 1;
    if (result.processed === 0) setHasMore(false);
    const refreshed = await window.api.getOpponents(200);
    setMatches(refreshed);
    setLoadingMore(false);
  }

  async function handleAddFriend(code: string) {
    setAdding(code);
    const result = await window.api.addFriend(code);
    if (result.ok) {
      setFriendMap((prev) => new Map(prev).set(code, {
        status: result.mutual ? 'accepted' : 'pending',
      }));
    }
    setAdding(null);
  }

  function friendState(code: string): 'none' | 'adding' | 'pending' | 'friends' {
    if (adding === code) return 'adding';
    const entry = friendMap.get(code);
    if (entry?.status === 'accepted') return 'friends';
    if (entry?.status === 'pending') return 'pending';
    return 'none';
  }

  function getDiscordUsername(code: string): string | null | undefined {
    return friendMap.get(code)?.discordUsername;
  }

  const sessions = groupIntoSessions(matches);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold">Recent Opponents</h1>
        <span className="text-sm text-gray-500">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          <span className="text-gray-600 ml-1">({matches.length} games)</span>
        </span>
      </div>

      <div className="space-y-2">
        {scanning && matches.length === 0 && (
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center">
            <p className="text-[#21BA45] text-sm animate-pulse">
              Scanning last week's replays...
            </p>
          </div>
        )}
        {!scanning && sessions.length === 0 && (
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center space-y-4">
            <p className="text-gray-500 text-sm">
              No opponents from the past week.
            </p>
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg bg-[#21BA45] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1ea33e] transition-colors disabled:opacity-50"
              >
                {loadingMore ? 'Scanning...' : 'Load Older Replays'}
              </button>
            )}
            <p className="text-gray-600 text-xs">
              New opponents appear automatically as you play.
            </p>
          </div>
        )}
        {sessions.map((s, i) => (
          <SessionRow
            key={`${s.opponentCode}-${s.latestPlayedAt}-${i}`}
            session={s}
            onAddFriend={friendState(s.opponentCode) === 'none' ? handleAddFriend : undefined}
            friendState={friendState(s.opponentCode)}
            discordUsername={getDiscordUsername(s.opponentCode)}
          />
        ))}
        {matches.length > 0 && hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full rounded-xl border border-[#2a2a2a] bg-[#141414] px-4 py-3 text-sm text-gray-400 transition-colors hover:text-white hover:border-[#21BA45]/30 disabled:opacity-50"
          >
            {loadingMore ? 'Scanning older replays...' : 'Load More'}
          </button>
        )}
        {!hasMore && sessions.length > 0 && (
          <p className="text-center text-xs text-gray-600 py-2">No older replays found</p>
        )}
      </div>
    </div>
  );
}
