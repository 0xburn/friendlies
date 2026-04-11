import { getCharacterShortName } from '../lib/characters';

interface OnlineIndicatorProps {
  status: 'online' | 'in-game' | 'offline' | 'idle';
  size?: 'sm' | 'md' | 'lg';
  opponentCode?: string | null;
  opponentCharacterId?: number | null;
  characterId?: number | null;
  playingSince?: string | null;
  gameMode?: string | null;
}

function formatDuration(sinceStr: string): string {
  const ms = Date.now() - new Date(sinceStr).getTime();
  const mins = Math.max(1, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function InGameIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#21BA45" stroke="#21BA45" strokeWidth="0">
      <path
        d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"
      />
      <line x1="11" y1="12" x2="11" y2="8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="10" x2="13" y2="10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17" cy="10" r="1" fill="white" />
      <circle cx="15" cy="12" r="1" fill="white" />
    </svg>
  );
}

const GAME_MODE_LABELS: Record<string, { label: string; color: string }> = {
  ranked: { label: 'Ranked', color: 'text-orange-400/80' },
  unranked: { label: 'Unranked', color: 'text-[#21BA45]/60' },
  direct: { label: 'Direct', color: 'text-blue-400/80' },
};

export function OnlineIndicator({
  status, size = 'md', opponentCode, opponentCharacterId, characterId, playingSince, gameMode,
}: OnlineIndicatorProps) {
  const dotSizes = { sm: 'w-2.5 h-2.5', md: 'w-4 h-4', lg: 'w-5 h-5' };
  const iconSizes = { sm: 'w-5 h-5', md: 'w-7 h-7', lg: 'w-9 h-9' };

  const showOpponent = status === 'in-game' && opponentCode;
  const myChar = characterId != null ? getCharacterShortName(characterId) : null;
  const oppChar = opponentCharacterId != null ? getCharacterShortName(opponentCharacterId) : null;
  const modeInfo = gameMode ? GAME_MODE_LABELS[gameMode] : null;

  return (
    <span className="inline-flex items-center gap-1.5">
      {status === 'in-game' ? (
        <InGameIcon className={iconSizes[size]} />
      ) : (
        <span
          className={`inline-block rounded-full ${dotSizes[size]} ${
            status === 'online'
              ? 'bg-[#21BA45] shadow-[0_0_6px_rgba(33,186,69,0.5)]'
              : status === 'idle'
                ? 'bg-amber-500/90'
                : 'bg-gray-500'
          }`}
          title={status === 'idle' ? 'Idle — friendlies in background' : status}
        />
      )}
      {showOpponent && (
        <span className="text-xs text-[#21BA45]/80 font-mono truncate">
          {modeInfo && (
            <span className={`${modeInfo.color} mr-1`}>{modeInfo.label}</span>
          )}
          {myChar && <>{myChar} </>}
          vs {opponentCode}
          {oppChar && <> ({oppChar})</>}
          {playingSince && (
            <span className="text-[#21BA45]/50 ml-1">
              {formatDuration(playingSince)}
            </span>
          )}
        </span>
      )}
      {status === 'in-game' && !showOpponent && modeInfo && (
        <span className={`text-xs font-mono ${modeInfo.color}`}>{modeInfo.label}</span>
      )}
    </span>
  );
}
