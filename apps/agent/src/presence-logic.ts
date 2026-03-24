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
  row: { status: string; current_character?: number | null; opponent_code?: string | null; playing_since?: string | null; updated_at: string },
  staleThreshold: number,
  now: number = Date.now(),
): { status: string; currentCharacter: number | null; opponentCode: string | null; playingSince: string | null } {
  const stale = isPresenceStale(row.updated_at, staleThreshold, now);
  return {
    status: stale ? 'offline' : row.status,
    currentCharacter: stale ? null : (row.current_character ?? null),
    opponentCode: stale ? null : (row.opponent_code ?? null),
    playingSince: stale ? null : (row.playing_since ?? null),
  };
}

export function normalizeConnectCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '#').replace(/#+/g, '#').trim().toUpperCase();
}
