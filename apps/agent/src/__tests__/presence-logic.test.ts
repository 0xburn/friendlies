import { describe, it, expect } from 'vitest';
import {
  resolvePresenceStatus,
  isOpponentRecent,
  isDirty,
  shouldWriteDb,
  isPresenceStale,
  resolvePresenceRow,
  normalizeConnectCode,
} from '../presence-logic';

describe('resolvePresenceStatus', () => {
  it('returns in-game when dolphin is running', () => {
    expect(resolvePresenceStatus(true, true)).toBe('in-game');
    expect(resolvePresenceStatus(false, true)).toBe('in-game');
  });

  it('returns online when dolphin is not running', () => {
    expect(resolvePresenceStatus(true, false)).toBe('online');
    expect(resolvePresenceStatus(false, false)).toBe('online');
  });
});

describe('isOpponentRecent', () => {
  const threshold = 10 * 60 * 1000; // 10 min

  it('returns false when no opponent code', () => {
    expect(isOpponentRecent(null, Date.now(), threshold)).toBe(false);
    expect(isOpponentRecent('', Date.now(), threshold)).toBe(false);
  });

  it('returns true when within threshold', () => {
    const now = 1000000;
    expect(isOpponentRecent('ABC#123', now - 5000, threshold, now)).toBe(true);
  });

  it('returns false when past threshold', () => {
    const now = 1000000;
    expect(isOpponentRecent('ABC#123', now - threshold - 1, threshold, now)).toBe(false);
  });

  it('returns true at exactly the threshold boundary', () => {
    const now = 1000000;
    expect(isOpponentRecent('ABC#123', now - threshold, threshold, now)).toBe(true);
  });
});

describe('isDirty', () => {
  it('returns false when nothing changed', () => {
    expect(isDirty('online', null, null, 'online', null, null)).toBe(false);
    expect(isDirty('in-game', 5, 'OPP#1', 'in-game', 5, 'OPP#1')).toBe(false);
  });

  it('detects status change', () => {
    expect(isDirty('in-game', null, null, 'online', null, null)).toBe(true);
    expect(isDirty('offline', null, null, 'online', null, null)).toBe(true);
  });

  it('detects character change', () => {
    expect(isDirty('in-game', 5, null, 'in-game', 3, null)).toBe(true);
    expect(isDirty('in-game', null, null, 'in-game', 5, null)).toBe(true);
  });

  it('detects opponent change', () => {
    expect(isDirty('in-game', 5, 'NEW#1', 'in-game', 5, 'OLD#1')).toBe(true);
    expect(isDirty('in-game', 5, null, 'in-game', 5, 'OLD#1')).toBe(true);
  });
});

describe('shouldWriteDb', () => {
  const heartbeat = 150_000; // 2.5 min

  it('always writes when dirty', () => {
    expect(shouldWriteDb(true, Date.now(), heartbeat)).toBe(true);
    expect(shouldWriteDb(true, 0, heartbeat)).toBe(true);
  });

  it('writes when heartbeat is due even if not dirty', () => {
    const now = 1000000;
    expect(shouldWriteDb(false, now - heartbeat - 1, heartbeat, now)).toBe(true);
  });

  it('skips when not dirty and heartbeat not due', () => {
    const now = 1000000;
    expect(shouldWriteDb(false, now - 1000, heartbeat, now)).toBe(false);
  });

  it('writes at exactly the heartbeat boundary', () => {
    const now = 1000000;
    expect(shouldWriteDb(false, now - heartbeat, heartbeat, now)).toBe(true);
  });

  it('always writes on first call (lastDbWriteTime = 0)', () => {
    expect(shouldWriteDb(false, 0, heartbeat, Date.now())).toBe(true);
  });
});

describe('isPresenceStale', () => {
  const threshold = 5 * 60 * 1000; // 5 min

  it('returns false for recent timestamps', () => {
    const now = Date.now();
    expect(isPresenceStale(new Date(now - 1000).toISOString(), threshold, now)).toBe(false);
  });

  it('returns true for old timestamps', () => {
    const now = Date.now();
    expect(isPresenceStale(new Date(now - threshold - 1).toISOString(), threshold, now)).toBe(true);
  });

  it('returns false at exactly the threshold', () => {
    const now = Date.now();
    expect(isPresenceStale(new Date(now - threshold).toISOString(), threshold, now)).toBe(false);
  });
});

describe('resolvePresenceRow', () => {
  const threshold = 5 * 60 * 1000;

  it('returns actual data when not stale', () => {
    const now = Date.now();
    const row = {
      status: 'in-game',
      current_character: 5,
      opponent_code: 'OPP#1',
      playing_since: '2026-01-01T00:00:00Z',
      updated_at: new Date(now - 1000).toISOString(),
    };
    const result = resolvePresenceRow(row, threshold, now);
    expect(result.status).toBe('in-game');
    expect(result.currentCharacter).toBe(5);
    expect(result.opponentCode).toBe('OPP#1');
    expect(result.playingSince).toBe('2026-01-01T00:00:00Z');
  });

  it('returns offline with nulled fields when stale', () => {
    const now = Date.now();
    const row = {
      status: 'in-game',
      current_character: 5,
      opponent_code: 'OPP#1',
      playing_since: '2026-01-01T00:00:00Z',
      updated_at: new Date(now - threshold - 1000).toISOString(),
    };
    const result = resolvePresenceRow(row, threshold, now);
    expect(result.status).toBe('offline');
    expect(result.currentCharacter).toBeNull();
    expect(result.opponentCode).toBeNull();
    expect(result.playingSince).toBeNull();
  });

  it('handles missing optional fields', () => {
    const now = Date.now();
    const row = {
      status: 'online',
      updated_at: new Date(now - 1000).toISOString(),
    };
    const result = resolvePresenceRow(row, threshold, now);
    expect(result.status).toBe('online');
    expect(result.currentCharacter).toBeNull();
    expect(result.opponentCode).toBeNull();
  });
});

describe('normalizeConnectCode', () => {
  it('normalizes standard codes', () => {
    expect(normalizeConnectCode('SMOK#1')).toBe('SMOK#1');
    expect(normalizeConnectCode('ABC#123')).toBe('ABC#123');
  });

  it('uppercases', () => {
    expect(normalizeConnectCode('smok#1')).toBe('SMOK#1');
    expect(normalizeConnectCode('abc#123')).toBe('ABC#123');
  });

  it('replaces non-alphanumeric chars with #', () => {
    expect(normalizeConnectCode('ABC-123')).toBe('ABC#123');
    expect(normalizeConnectCode('ABC_123')).toBe('ABC#123');
  });

  it('collapses multiple # into one', () => {
    expect(normalizeConnectCode('ABC##123')).toBe('ABC#123');
    expect(normalizeConnectCode('ABC###123')).toBe('ABC#123');
  });

  it('handles edge cases', () => {
    expect(normalizeConnectCode('')).toBe('');
    expect(normalizeConnectCode('A')).toBe('A');
  });
});
