import { getCharacterShortName } from '../lib/characters';

interface OnlineIndicatorProps {
  status: 'online' | 'in-game' | 'offline';
  size?: 'sm' | 'md' | 'lg';
  opponentCode?: string | null;
  opponentCharacterId?: number | null;
  characterId?: number | null;
  playingSince?: string | null;
}

function formatDuration(sinceStr: string): string {
  const ms = Date.now() - new Date(sinceStr).getTime();
  const mins = Math.max(1, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function InGameIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="#21BA45" />
      <path
        d="M4.5 8.5L6.5 10.5L11.5 5.5"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OnlineIndicator({
  status, size = 'md', opponentCode, opponentCharacterId, characterId, playingSince,
}: OnlineIndicatorProps) {
  const dotSizes = { sm: 'w-2 h-2', md: 'w-3 h-3', lg: 'w-4 h-4' };
  const iconSizes = { sm: 'w-3 h-3', md: 'w-4 h-4', lg: 'w-5 h-5' };

  const showOpponent = status === 'in-game' && opponentCode;
  const myChar = characterId != null ? getCharacterShortName(characterId) : null;
  const oppChar = opponentCharacterId != null ? getCharacterShortName(opponentCharacterId) : null;

  return (
    <span className="inline-flex items-center gap-1.5">
      {status === 'in-game' ? (
        <InGameIcon className={iconSizes[size]} />
      ) : (
        <span
          className={`inline-block rounded-full ${dotSizes[size]} ${
            status === 'online' ? 'bg-[#21BA45] animate-pulse' : 'bg-gray-500'
          }`}
          title={status}
        />
      )}
      {showOpponent && (
        <span className="text-xs text-[#21BA45]/80 font-mono whitespace-nowrap">
          {myChar && <span>{myChar} </span>}
          vs {opponentCode}
          {oppChar && <span> ({oppChar})</span>}
          {playingSince && (
            <span className="text-[#21BA45]/50 ml-1">
              {formatDuration(playingSince)}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
