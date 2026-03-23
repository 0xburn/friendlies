import { useEffect, useState } from 'react';
import { OnlineIndicator } from '../components/OnlineIndicator';
import { RankBadge } from '../components/RankBadge';
import { CharacterIcon } from '../components/CharacterIcon';
import { getCharacterShortName } from '../lib/characters';

interface ProfileData {
  connect_code: string;
  display_name?: string;
  rating_ordinal?: number;
  rating_update_count?: number;
  wins?: number;
  losses?: number;
  global_placement?: number;
  characters?: Array<{ character: number; game_count: number }>;
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
  const [status, setStatus] = useState<'online' | 'in-game' | 'offline'>('offline');
  const [opponentCode, setOpponentCode] = useState<string | null>(null);
  const [playingSince, setPlayingSince] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<number | null>(null);
  const [opponentCharacterId, setOpponentCharacterId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.api.getIdentity().then(setIdentity);
    window.api.getProfile().then(setProfile);
    window.api.getUser().then(setUser);

    window.api.getLocalStatus().then((s: any) => {
      if (s) setStatus(s === 'in-game' ? 'in-game' : s === 'online' ? 'online' : 'offline');
    });

    const unsub = window.api.onLocalStatus((info: any) => {
      setStatus(info.status || 'online');
      setOpponentCode(info.opponentCode ?? null);
      setOpponentCharacterId(info.opponentCharacterId ?? null);
      setPlayingSince(info.playingSince ?? null);
      setCharacterId(info.characterId ?? null);
    });
    return unsub;
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
  const discordName = user?.user_metadata?.full_name || user?.user_metadata?.name;
  const avatarUrl = user?.user_metadata?.avatar_url;
  const wins = profile?.wins ?? 0;
  const losses = profile?.losses ?? 0;
  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                className="w-12 h-12 rounded-full border border-[#2a2a2a]"
              />
            )}
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
              {discordName && connectCode && (
                <p className="text-gray-500 text-xs">{discordName} on Discord</p>
              )}
              {!connectCode && discordName && (
                <p className="text-gray-500 text-sm">
                  Connect your Slippi identity in Settings
                </p>
              )}
            </div>
          </div>
          {connectCode && (
            <button
              onClick={copyCode}
              className="shrink-0 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-gray-300 transition-all hover:bg-[#222] hover:text-white"
            >
              {copied ? '✓ Copied' : 'Copy Code'}
            </button>
          )}
        </div>
      </div>

      {status === 'in-game' && (
        <InGameBanner
          characterId={characterId}
          opponentCode={opponentCode}
          opponentCharacterId={opponentCharacterId}
          playingSince={playingSince}
        />
      )}

      {!connectCode && (
        <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-5">
          <p className="text-sm text-yellow-200/90 font-medium mb-1">
            Slippi identity not linked
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            Open Slippi Launcher and log in, then restart Slippi Friends to
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

function InGameBanner({
  characterId,
  opponentCode,
  opponentCharacterId,
  playingSince,
}: {
  characterId: number | null;
  opponentCode: string | null;
  opponentCharacterId: number | null;
  playingSince: string | null;
}) {
  const myChar = characterId != null ? getCharacterShortName(characterId) : null;
  const oppChar = opponentCharacterId != null ? getCharacterShortName(opponentCharacterId) : null;

  let label: string;
  if (opponentCode) {
    const parts: string[] = [];
    if (myChar) parts.push(`Playing ${myChar}`);
    else parts.push('In Game');
    parts.push(`vs ${opponentCode}`);
    if (oppChar) parts.push(`(${oppChar})`);
    if (playingSince) parts.push(`for ${formatDuration(playingSince)}`);
    label = parts.join(' ');
  } else {
    label = myChar ? `In Game as ${myChar}` : 'In Game';
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
