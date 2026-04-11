import { memo, useState } from 'react';
import { ConnectionTypeIcon } from './ConnectionTypeIcon';
import { OnlineIndicator } from './OnlineIndicator';
import { RankBadge } from './RankBadge';
import { CharacterIcon } from './CharacterIcon';
import { PlayerStatsPanel } from './PlayerStatsPanel';
import { PatronBadge, playerListCardShell } from '../lib/patronCardStyle';
import { getCharacterShortName, getCharacterImagePath } from '../lib/characters';

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
    discordId?: string | null;
    avatarUrl?: string;
    rating?: number | null;
    characterId?: number | null;
    topCharacters?: { characterId: number; gameCount: number }[];
    region?: string | null;
    status?: 'online' | 'in-game' | 'offline' | 'idle';
    currentCharacter?: number | null;
    opponentCode?: string | null;
    playingSince?: string | null;
    gameMode?: string | null;
    lookingToPlay?: boolean;
    statusPreset?: string | null;
    lfgCharacters?: number[];
    lfgRanks?: string[];
    connectionType?: 'wifi' | 'ethernet' | null;
    mutualFriendCount?: number;
  };
  showStatus?: boolean;
  expandable?: boolean;
  onClick?: () => void;
  onBlock?: () => void;
  onRemove?: () => void;
  onInvite?: () => void;
  inviteDisabled?: boolean;
  inviteState?: true | string | null;
  nudgeOptions?: string[];
  onNudge?: (message: string) => void;
  nudgeState?: string | null;
  onAdd?: () => void;
  addDisabled?: boolean;
  addState?: 'pending' | 'adding' | 'friends' | null;
  removeLabel?: string;
  onUnsend?: () => void;
  rankOverride?: string;
  /** Public Patreon thanks-list highlight (gradient frame + badge); visible to everyone who sees the card. */
  patreonPublicSupporter?: boolean;
}

function playerCardAreEqual(prev: PlayerCardProps, next: PlayerCardProps): boolean {
  const pp = prev.player, np = next.player;
  return pp.connectCode === np.connectCode &&
    pp.status === np.status &&
    pp.currentCharacter === np.currentCharacter &&
    pp.opponentCode === np.opponentCode &&
    pp.playingSince === np.playingSince &&
    pp.gameMode === np.gameMode &&
    pp.rating === np.rating &&
    pp.lookingToPlay === np.lookingToPlay &&
    pp.statusPreset === np.statusPreset &&
    pp.connectionType === np.connectionType &&
    pp.lfgCharacters?.length === np.lfgCharacters?.length &&
    pp.lfgCharacters?.every((c, i) => c === np.lfgCharacters?.[i]) &&
    pp.lfgRanks?.length === np.lfgRanks?.length &&
    pp.lfgRanks?.every((r, i) => r === np.lfgRanks?.[i]) &&
    pp.region === np.region &&
    pp.mutualFriendCount === np.mutualFriendCount &&
    pp.displayName === np.displayName &&
    pp.discordUsername === np.discordUsername &&
    pp.avatarUrl === np.avatarUrl &&
    prev.showStatus === next.showStatus &&
    prev.addState === next.addState &&
    prev.inviteDisabled === next.inviteDisabled &&
    prev.inviteState === next.inviteState &&
    prev.nudgeState === next.nudgeState &&
    !!prev.onAdd === !!next.onAdd &&
    !!prev.onInvite === !!next.onInvite &&
    !!prev.onBlock === !!next.onBlock &&
    !!prev.onRemove === !!next.onRemove &&
    !!prev.onUnsend === !!next.onUnsend &&
    prev.rankOverride === next.rankOverride &&
    prev.patreonPublicSupporter === next.patreonPublicSupporter;
}

export const PlayerCard = memo(function PlayerCard({ player, showStatus = true, expandable = true, onClick, onBlock, onRemove, onInvite, inviteDisabled, inviteState, nudgeOptions, onNudge, nudgeState, onAdd, addDisabled, addState, removeLabel, onUnsend, rankOverride, patreonPublicSupporter }: PlayerCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [nudgePickerOpen, setNudgePickerOpen] = useState(false);
  const hasAvatar = !!player.avatarUrl;

  function handleClick() {
    if (expandable) {
      setExpanded((prev) => !prev);
    }
    onClick?.();
  }

  const isLfg = !!player.lookingToPlay;
  const patron = !!patreonPublicSupporter;
  const shellClass = playerListCardShell(patron, isLfg);

  return (
    <div className={shellClass}>
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
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="font-mono font-bold text-white tracking-wide shrink-0">{player.connectCode}</span>
            {patron && <PatronBadge />}
            {showStatus && player.status && (
              <span className="min-w-0 overflow-hidden">
                <OnlineIndicator
                  status={player.status}
                  size="sm"
                  characterId={player.currentCharacter}
                  opponentCode={player.opponentCode}
                  playingSince={player.playingSince}
                  gameMode={player.gameMode}
                />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            {player.displayName && (
              <p className="text-sm text-gray-400 truncate">{player.displayName}</p>
            )}
            {player.discordUsername && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (player.discordId) {
                    window.api.openDiscordProfile(player.discordId);
                  }
                }}
                className={`inline-flex items-center gap-1 min-w-0 rounded-md bg-[#5865F2]/10 px-1.5 py-0.5 transition-colors ${
                  player.discordId ? 'hover:bg-[#5865F2]/25 cursor-pointer' : 'cursor-default'
                }`}
                title={player.discordId ? 'Open in Discord' : undefined}
              >
                <DiscordIcon className="w-3.5 h-3.5 text-[#5865F2] shrink-0" />
                <span className="text-xs font-medium text-[#5865F2] truncate">@{player.discordUsername}</span>
              </button>
            )}
            {player.connectionType && (
              <ConnectionTypeIcon type={player.connectionType} />
            )}
            {player.region && (
              <span className="text-[10px] text-gray-600 truncate">{player.region}</span>
            )}
            {player.mutualFriendCount != null && player.mutualFriendCount > 0 && (
              <span className="text-[10px] text-[#21BA45]/70 shrink-0" title="Accepted friends you share">
                {player.mutualFriendCount} mutual friend{player.mutualFriendCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {(player.statusPreset || (isLfg && !player.statusPreset)) && (
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="inline-block rounded-full border border-amber-500/25 bg-amber-500/8 px-2 py-0.5 text-[10px] font-medium text-amber-400/90 shrink-0">
                {player.statusPreset || 'Looking to play'}
              </span>
              {isLfg && ((player.lfgCharacters && player.lfgCharacters.length > 0) || (player.lfgRanks && player.lfgRanks.length > 0)) && (
                <span className="inline-flex items-center gap-1 flex-wrap text-[10px] text-amber-400/70">
                  <span>Looking for</span>
                  {player.lfgCharacters && player.lfgCharacters.length > 0 && (
                    <span className="inline-flex items-center gap-0.5 flex-wrap">
                      {player.lfgCharacters.map((id) => (
                        <span key={id} className="inline-flex items-center gap-0.5 shrink-0" title={getCharacterShortName(id)}>
                          {getCharacterImagePath(id) ? (
                            <img src={getCharacterImagePath(id)} alt={getCharacterShortName(id)} className="h-3.5 w-3.5 object-contain" />
                          ) : (
                            <span className="font-medium text-amber-400/90">{getCharacterShortName(id)}</span>
                          )}
                        </span>
                      ))}
                    </span>
                  )}
                  {player.lfgRanks && player.lfgRanks.length > 0 && (
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      {player.lfgCharacters && player.lfgCharacters.length > 0 && <span className="text-gray-600">·</span>}
                      {player.lfgRanks.map((rank) => {
                        const c: Record<string, string> = { Master: '#8B008B', Diamond: '#4169E1', Platinum: '#91E8E0', Gold: '#F6A51E', Silver: '#B5A5B7', Bronze: '#E06A36' };
                        return <span key={rank} className="font-semibold text-[10px]" style={{ color: c[rank] ?? '#d4a' }}>{rank}</span>;
                      })}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
        </div>
        {player.topCharacters && player.topCharacters.length > 0 && (
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            <span className="text-[8px] text-gray-500 uppercase">Main</span>
            <CharacterIcon characterId={player.topCharacters[0].characterId} size="md" />
          </div>
        )}
        <RankBadge rating={player.rating ?? null} overrideLabel={rankOverride} />
        {onInvite && (
          inviteState === true ? (
            <span className="text-[10px] font-medium text-[#21BA45] shrink-0 px-1">Sent!</span>
          ) : typeof inviteState === 'string' ? (
            <span className="text-[10px] font-medium text-yellow-500 shrink-0 px-1 max-w-[140px] truncate" title={inviteState}>{inviteState}</span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onInvite(); }}
              disabled={inviteDisabled}
              className="shrink-0 rounded-lg bg-blue-500 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-600 transition-colors disabled:opacity-30"
            >
              Invite
            </button>
          )
        )}
        {addState === 'friends' ? (
          <span className="shrink-0 rounded-lg border border-[#21BA45]/20 bg-[#21BA45]/5 px-3 py-1 text-[11px] font-medium text-[#21BA45]/60">
            Friends
          </span>
        ) : addState === 'pending' ? (
          <span className="shrink-0 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-1 text-[11px] font-medium text-yellow-500/70">
            Pending
          </span>
        ) : addState === 'adding' ? (
          <span className="shrink-0 rounded-lg border border-[#2a2a2a] px-3 py-1 text-[11px] text-gray-500 animate-pulse">
            Adding...
          </span>
        ) : onAdd ? (
          <button
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
            disabled={addDisabled}
            className="shrink-0 rounded-lg border border-[#3a3a3a] bg-[#1a1a1a] px-3 py-1 text-[11px] font-medium text-gray-300 hover:bg-[#222] hover:text-white transition-colors disabled:opacity-30"
          >
            Add Friend
          </button>
        ) : null}
        {onUnsend && (
          <button
            onClick={(e) => { e.stopPropagation(); onUnsend(); }}
            className="shrink-0 rounded-lg bg-red-500/20 px-3 py-1 text-[11px] font-semibold text-red-400 hover:bg-red-500/30 transition-colors"
          >
            Unsend
          </button>
        )}
        {expandable && (
          <svg className={`w-4 h-4 text-gray-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      {expanded && (
        <div className="relative">
          <PlayerStatsPanel connectCode={player.connectCode} topCharacters={player.topCharacters} />
          {(onBlock || onRemove || onNudge) && (
            <div className="flex items-center gap-2 px-4 pb-4 pt-3">
              {onNudge && nudgeOptions && (
                <div className="relative">
                  {nudgeState ? (
                    <span className={`text-[10px] font-medium ${nudgeState === 'Sent!' ? 'text-[#21BA45]' : 'text-yellow-500'}`}>{nudgeState}</span>
                  ) : nudgePickerOpen ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      {nudgeOptions.map((opt) => (
                        <button
                          key={opt}
                          onClick={(e) => { e.stopPropagation(); onNudge(opt); setNudgePickerOpen(false); }}
                          className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-400 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
                        >
                          {opt}
                        </button>
                      ))}
                      <button
                        onClick={(e) => { e.stopPropagation(); setNudgePickerOpen(false); }}
                        className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors px-1"
                      >
                        cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setNudgePickerOpen(true); }}
                      className="rounded-md bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium text-amber-400 hover:bg-amber-500/20 transition-colors"
                    >
                      Nudge
                    </button>
                  )}
                </div>
              )}
              <div className="flex-1" />
              {onRemove && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(); }}
                  className="rounded-md px-2.5 py-1 text-[10px] font-medium text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  {removeLabel || 'Remove'}
                </button>
              )}
              {onBlock && (
                <button
                  onClick={(e) => { e.stopPropagation(); onBlock(); }}
                  className="rounded-md px-2.5 py-1 text-[10px] font-medium text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  Block
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}, playerCardAreEqual);
