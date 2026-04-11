import { useEffect, useState } from 'react';
import { OnlineIndicator } from '../components/OnlineIndicator';
import { RankBadge } from '../components/RankBadge';
import { CharacterIcon } from '../components/CharacterIcon';
import { getCharacterShortName, getCharacterImagePath } from '../lib/characters';

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

interface ProfileData {
  connect_code: string;
  display_name?: string;
  rating_ordinal?: number;
  rating_update_count?: number;
  wins?: number;
  losses?: number;
  global_placement?: number;
  characters?: Array<{ character: number; game_count: number }>;
  discord_username?: string | null;
  discord_id?: string | null;
}

interface IdentityData {
  connectCode: string;
  displayName: string;
}

interface UserData {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
    name?: string;
    custom_claims?: { global_name?: string };
  };
}

export function Dashboard() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [identity, setIdentity] = useState<IdentityData | null>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const [status, setStatus] = useState<'online' | 'in-game' | 'offline' | 'idle'>('offline');
  const [opponentCode, setOpponentCode] = useState<string | null>(null);
  const [playingSince, setPlayingSince] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<number | null>(null);
  const [opponentCharacterId, setOpponentCharacterId] = useState<number | null>(null);
  const [gameMode, setGameMode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [hideAvatar, setHideAvatar] = useState<boolean | null>(null);

  useEffect(() => {
    window.api.getIdentity().then(setIdentity);
    window.api.getProfile().then(setProfile);
    window.api.getUser().then(setUser);
    window.api.getPrivacy().then((p) => setHideAvatar(p.hideAvatar)).catch(() => {});

    window.api.getLocalStatus().then((s: any) => {
      if (s && typeof s === 'object' && s.displayStatus) {
        setStatus(s.displayStatus);
      } else if (typeof s === 'string') {
        setStatus(s === 'in-game' ? 'in-game' : s === 'online' ? 'online' : 'offline');
      }
    });

    const unsub = window.api.onLocalStatus((info: any) => {
      setStatus(info.displayStatus || info.status || 'online');
      setOpponentCode(info.opponentCode ?? null);
      setOpponentCharacterId(info.opponentCharacterId ?? null);
      setPlayingSince(info.playingSince ?? null);
      setCharacterId(info.characterId ?? null);
      setGameMode(info.gameMode ?? null);
    });

    const unsubUpdate = window.api.onUpdateStatus((s: any) => {
      if (s.state === 'available' || s.state === 'downloaded') {
        setUpdateAvailable(s.version);
      }
    });

    return () => { unsub(); unsubUpdate(); };
  }, []);

  async function copyCode() {
    const code = identity?.connectCode || profile?.connect_code;
    if (!code) return;
    await window.api.copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const connectCode = identity?.connectCode || profile?.connect_code;
  const displayName = identity?.displayName || profile?.display_name;
  const discordName = profile?.discord_username || user?.user_metadata?.full_name || user?.user_metadata?.name;
  const discordId = profile?.discord_id || (user?.user_metadata as any)?.provider_id as string | undefined;
  const avatarUrl = hideAvatar ? null : user?.user_metadata?.avatar_url;
  const topChars = Array.isArray(profile?.top_characters) ? profile.top_characters : [];
  const mainCharId = topChars[0]?.characterId ?? null;
  const wins = profile?.wins ?? 0;
  const losses = profile?.losses ?? 0;
  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {hideAvatar === null ? null : hideAvatar ? (
              mainCharId != null ? (
                <div className="w-12 h-12 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center overflow-hidden shrink-0">
                  {getCharacterImagePath(mainCharId) ? (
                    <img src={getCharacterImagePath(mainCharId)} alt={getCharacterShortName(mainCharId)} className="w-9 h-9 object-contain" />
                  ) : (
                    <span className="text-xs font-bold text-gray-400">{getCharacterShortName(mainCharId).slice(0, 2)}</span>
                  )}
                </div>
              ) : null
            ) : avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="w-12 h-12 rounded-full border border-[#2a2a2a]"
              />
            ) : null}
            <div>
              {connectCode ? (
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-3xl font-mono font-bold tracking-wider text-white">
                    {connectCode}
                  </h1>
                  <OnlineIndicator
                    status={status}
                    size="lg"
                    opponentCode={opponentCode}
                    opponentCharacterId={opponentCharacterId}
                    characterId={characterId}
                    playingSince={playingSince}
                    gameMode={gameMode}
                  />
                </div>
              ) : (
                <h1 className="text-2xl font-display font-bold text-white mb-1">
                  {discordName || 'Welcome'}
                </h1>
              )}
              {displayName && connectCode && (
                <p className="text-gray-400">{displayName}</p>
              )}
              {connectCode && (
                <div className="flex items-center gap-2 mt-1">
                  {discordName && (
                    <button
                      onClick={() => { if (discordId) window.api.openDiscordProfile(discordId); }}
                      className={`inline-flex items-center gap-1 min-w-0 rounded-md bg-[#5865F2]/10 px-1.5 py-0.5 transition-colors ${
                        discordId ? 'hover:bg-[#5865F2]/25 cursor-pointer' : 'cursor-default'
                      }`}
                      title={discordId ? 'Open in Discord' : undefined}
                    >
                      <DiscordIcon className="w-3.5 h-3.5 text-[#5865F2] shrink-0" />
                      <span className="text-xs font-medium text-[#5865F2] truncate">@{discordName}</span>
                    </button>
                  )}
                </div>
              )}
              {!connectCode && discordName && (
                <p className="text-gray-500 text-sm">
                  Connect your Slippi identity in Settings
                </p>
              )}
            </div>
          </div>
          {connectCode && profile?.rating_ordinal && (
            <RankBadge rating={profile.rating_ordinal} />
          )}
        </div>
      </div>

      {status === 'in-game' && (
        <InGameBanner
          characterId={characterId}
          opponentCode={opponentCode}
          opponentCharacterId={opponentCharacterId}
          playingSince={playingSince}
          gameMode={gameMode}
        />
      )}

      {updateAvailable && (
        <div className="rounded-2xl border border-[#5865F2]/30 bg-[#5865F2]/5 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">v{updateAvailable} available</p>
            <p className="text-xs text-gray-400">A new version of friendlies is ready</p>
          </div>
          <button
            onClick={() => window.api.downloadUpdate()}
            className="shrink-0 rounded-lg bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4752C4] transition-colors"
          >
            Update
          </button>
        </div>
      )}

      {!connectCode && (
        <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-5">
          <p className="text-sm text-yellow-200/90 font-medium mb-1">
            Slippi identity not linked
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            Open Slippi Launcher and log in, then restart friendlies to
            automatically detect your connect code.
          </p>
        </div>
      )}

      {profile && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              label="Rating"
              value={profile.rating_ordinal ? Math.round(profile.rating_ordinal).toString() : '—'}
              sub={<RankBadge rating={profile.rating_ordinal ?? null} />}
            />
            <StatCard
              label="Record"
              value={total > 0 ? `${wins}W / ${losses}L` : '—'}
              sub={total > 0 ? <span className="text-xs text-gray-500">{winRate}% win rate</span> : undefined}
            />
            <StatCard
              label="Placement"
              value={profile.global_placement ? `#${profile.global_placement.toLocaleString()}` : '—'}
              sub={<span className="text-xs text-gray-500">Global rank</span>}
            />
          </div>

          {profile.characters && profile.characters.length > 0 && (
            <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6">
              <h3 className="text-sm font-medium text-gray-400 mb-4">Characters</h3>
              <div className="space-y-3">
                {profile.characters
                  .sort((a, b) => b.game_count - a.game_count)
                  .map((c) => {
                    const pct = total > 0 ? Math.round((c.game_count / total) * 100) : 0;
                    return (
                      <div key={c.character} className="flex items-center gap-3">
                        <CharacterIcon characterId={c.character} showName size="md" />
                        <div className="flex-1 h-2 rounded-full bg-[#1a1a1a] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#21BA45]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 font-mono w-16 text-right">
                          {c.game_count} games
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}

      {!profile && connectCode && (
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-12 text-center">
          <p className="text-gray-500 text-sm">No ranked stats yet</p>
          <p className="text-gray-600 text-xs mt-2">
            Play some ranked games to populate your profile.
          </p>
        </div>
      )}

      {connectCode && (
        <button
          onClick={() => window.api.openExternal(`https://slippi.gg/user/${connectCode.replace('#', '-')}`)}
          className="w-full rounded-xl border border-[#2a2a2a] bg-[#141414] px-4 py-3 text-sm text-gray-400 transition-colors hover:text-white hover:border-[#21BA45]/30"
        >
          View Full Profile on slippi.gg →
        </button>
      )}

    </div>
  );
}

function formatDuration(sinceStr: string): string {
  const ms = Date.now() - new Date(sinceStr).getTime();
  const mins = Math.max(1, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const GAME_MODE_DISPLAY: Record<string, string> = {
  ranked: 'Ranked',
  unranked: 'Unranked',
  direct: 'Direct',
};

function InGameBanner({
  characterId,
  opponentCode,
  opponentCharacterId,
  playingSince,
  gameMode,
}: {
  characterId: number | null;
  opponentCode: string | null;
  opponentCharacterId: number | null;
  playingSince: string | null;
  gameMode: string | null;
}) {
  const myChar = characterId != null ? getCharacterShortName(characterId) : null;
  const oppChar = opponentCharacterId != null ? getCharacterShortName(opponentCharacterId) : null;
  const modeLabel = gameMode ? GAME_MODE_DISPLAY[gameMode] : null;

  let label: string;
  if (opponentCode) {
    const parts: string[] = [];
    if (modeLabel) parts.push(modeLabel);
    if (myChar) parts.push(`Playing ${myChar}`);
    else if (!modeLabel) parts.push('In Game');
    parts.push(`vs ${opponentCode}`);
    if (oppChar) parts.push(`(${oppChar})`);
    if (playingSince) parts.push(`for ${formatDuration(playingSince)}`);
    label = parts.join(' ');
  } else {
    const prefix = modeLabel || 'In Game';
    label = myChar ? `${prefix} as ${myChar}` : prefix;
  }

  return (
    <div className="rounded-2xl border border-[#21BA45]/30 bg-[#21BA45]/5 p-4 flex items-center gap-3">
      <div className="flex items-center gap-2">
        {characterId != null && <CharacterIcon characterId={characterId} size="md" />}
        <span className="text-sm font-semibold text-[#21BA45]">{label}</span>
        {opponentCharacterId != null && (
          <CharacterIcon characterId={opponentCharacterId} size="md" />
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold font-mono text-white">{value}</p>
      {sub && <div className="mt-2">{sub}</div>}
    </div>
  );
}
