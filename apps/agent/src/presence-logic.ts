export type PresenceStatus = 'offline' | 'online' | 'in-game';

export function resolvePresenceStatus(
  launcherRunning: boolean,
  dolphinRunning: boolean,
): PresenceStatus {
  if (dolphinRunning) return 'in-game';
  return 'online';
}

export function isOpponentRecent(
  opponentCode: string | null,
  opponentTimestamp: number,
  threshold: number,
  now: number = Date.now(),
): boolean {
  if (!opponentCode) return false;
  return now - opponentTimestamp <= threshold;
}

export function isDirty(
  status: PresenceStatus,
  character: number | null,
  opponentCode: string | null,
  lastStatus: PresenceStatus,
  lastCharacter: number | null,
  lastOpponentCode: string | null,
): boolean {
  return (
    status !== lastStatus ||
    character !== lastCharacter ||
    opponentCode !== lastOpponentCode
  );
}

export function shouldWriteDb(
  dirty: boolean,
  lastDbWriteTime: number,
  heartbeatInterval: number,
  now: number = Date.now(),
): boolean {
  if (dirty) return true;
  return now - lastDbWriteTime >= heartbeatInterval;
}

export function isPresenceStale(
  updatedAt: string | Date,
  threshold: number,
  now: number = Date.now(),
): boolean {
  const age = now - new Date(updatedAt).getTime();
  return age > threshold;
}

export function resolvePresenceRow(
  row: { status: string; current_character?: number | null; opponent_code?: string | null; playing_since?: string | null; game_mode?: string | null; looking_to_play?: boolean; looking_to_play_since?: string | null; status_preset?: string | null; lfg_characters?: number[] | null; lfg_ranks?: string[] | null; connection_type?: string | null; app_idle?: boolean | null; updated_at: string },
  staleThreshold: number,
  now: number = Date.now(),
): { status: string; currentCharacter: number | null; opponentCode: string | null; playingSince: string | null; gameMode: string | null; lookingToPlay: boolean; statusPreset: string | null; lfgCharacters: number[]; lfgRanks: string[]; connectionType: string | null } {
  const stale = isPresenceStale(row.updated_at, staleThreshold, now);
  const lfgActive = !stale && !!row.looking_to_play;
  let displayStatus = stale ? 'offline' : row.status;
  if (!stale && row.app_idle) {
    if (row.status === 'online') displayStatus = 'idle';
    else if (row.status === 'in-game' && !row.opponent_code) displayStatus = 'idle';
  }
  return {
    status: displayStatus,
    currentCharacter: stale ? null : (row.current_character ?? null),
    opponentCode: stale ? null : (row.opponent_code ?? null),
    playingSince: stale ? null : (row.playing_since ?? null),
    gameMode: stale ? null : (row.game_mode ?? null),
    lookingToPlay: lfgActive,
    statusPreset: lfgActive ? (row.status_preset ?? null) : null,
    lfgCharacters: lfgActive ? (row.lfg_characters ?? []) : [],
    lfgRanks: lfgActive ? (row.lfg_ranks ?? []) : [],
    connectionType: stale ? null : (row.connection_type ?? null),
  };
}

export function normalizeConnectCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '#').replace(/#+/g, '#').trim().toUpperCase();
}
