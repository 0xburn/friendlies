import { useState } from 'react';
import { OnlineIndicator } from './OnlineIndicator';
import { RankBadge } from './RankBadge';
import { CharacterIcon } from './CharacterIcon';
import { PlayerStatsPanel } from './PlayerStatsPanel';

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

interface PlayerCardProps {
  player: {
    connectCode: string;
    displayName?: string;
    discordUsername?: string;
    avatarUrl?: string;
    rating?: number | null;
    characterId?: number | null;
    status?: 'online' | 'in-game' | 'offline';
    currentCharacter?: number | null;
    opponentCode?: string | null;
    playingSince?: string | null;
  };
  showStatus?: boolean;
  expandable?: boolean;
  onClick?: () => void;
}

export function PlayerCard({ player, showStatus = true, expandable = true, onClick }: PlayerCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasAvatar = !!player.avatarUrl;

  function handleClick() {
    if (expandable) {
      setExpanded((prev) => !prev);
    }
    onClick?.();
  }

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] transition-all hover:border-[#21BA45]/30 hover:shadow-[0_0_30px_rgba(33,186,69,0.1)]">
      <div onClick={handleClick}
        className="group flex items-center gap-4 p-4 cursor-pointer">
        {hasAvatar ? (
          <img
            src={player.avatarUrl}
            alt=""
            className="w-10 h-10 rounded-full object-cover shrink-0 border border-[#2a2a2a]"
          />
        ) : player.characterId != null ? (
          <CharacterIcon characterId={player.characterId} size="lg" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-gray-600 text-sm font-bold shrink-0">
            {player.connectCode.slice(0, 2)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-white tracking-wide">{player.connectCode}</span>
            {showStatus && player.status && (
              <OnlineIndicator
                status={player.status}
                size="sm"
                characterId={player.currentCharacter}
                opponentCode={player.opponentCode}
                playingSince={player.playingSince}
              />
            )}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            {player.displayName && (
              <p className="text-sm text-gray-400 truncate">{player.displayName}</p>
            )}
            {player.discordUsername && (
              <span className="inline-flex items-center gap-1 shrink-0 rounded-md bg-[#5865F2]/10 px-1.5 py-0.5">
                <DiscordIcon className="w-3.5 h-3.5 text-[#5865F2]" />
                <span className="text-xs font-medium text-[#5865F2]">@{player.discordUsername}</span>
              </span>
            )}
          </div>
        </div>
        <RankBadge rating={player.rating ?? null} />
        {expandable && (
          <svg className={`w-4 h-4 text-gray-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      {expanded && <PlayerStatsPanel connectCode={player.connectCode} />}
    </div>
  );
}
