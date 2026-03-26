import type { RealtimeChannel } from '@supabase/supabase-js';

import { execFile } from 'child_process';

import {
  DOLPHIN_PROCESS_NAMES,
  IN_GAME_POLL_INTERVAL,
  OPPONENT_RECENT_THRESHOLD,
  PRESENCE_POLL_INTERVAL,
  PRESENCE_STALE_THRESHOLD,
  SLIPPI_LAUNCHER_PROCESS_NAMES,
} from './config';
import {
  isDirty as _isDirty,
  isOpponentRecent as _isOpponentRecent,
  resolvePresenceStatus,
  shouldWriteDb as _shouldWriteDb,
  type PresenceStatus,
} from './presence-logic';
import { supabase } from './supabase';

export type { PresenceStatus };

export interface OnlineUser {
  connectCode: string;
  displayName: string;
  status: string;
  currentCharacter: number | null;
  opponentCode: string | null;
  playingSince: string | null;
  updatedAt: string;
}

export interface LocalStatus {
  status: PresenceStatus;
  opponentCode: string | null;
  opponentCharacterId: number | null;
  playingSince: string | null;
  characterId: number | null;
}

type PresenceSyncCallback = (users: OnlineUser[]) => void;
type LocalStatusCallback = (info: LocalStatus) => void;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let presenceChannel: RealtimeChannel | null = null;
let subscribed = false;
let currentStatus: PresenceStatus = 'offline';
let lastCharacterId: number | null = null;
let lastOpponentCode: string | null = null;
let lastOpponentCharacterId: number | null = null;
let lastOpponentTimestamp: number = 0;
let loopConnectCode = '';
let loopDisplayName = '';
let loopUserId = '';
let onlineUsers: OnlineUser[] = [];
let syncCallbacks: PresenceSyncCallback[] = [];
let localStatusCallbacks: LocalStatusCallback[] = [];
let channelRetryTimer: ReturnType<typeof setTimeout> | null = null;
let channelRetryCount = 0;
const MAX_CHANNEL_RETRIES = 5;
const BASE_RETRY_DELAY = 10_000;
let lastRlsWarning = 0;
let periodicRetryTimer: ReturnType<typeof setInterval> | null = null;
let subscribeGeneration = 0;

let lastPushedStatus: PresenceStatus = 'offline';
let lastPushedCharacter: number | null = null;
let lastPushedOpponentCode: string | null = null;
let lastDbWriteTime = 0;
const DB_HEARTBEAT_INTERVAL = 150_000;
let lastStaleCleanup = 0;
const STALE_CLEANUP_INTERVAL = 5 * 60 * 1000;

let lookingToPlay = false;
let lookingToPlaySince: string | null = null;
const LFG_EXPIRY_MS = 30 * 60 * 1000;

let throttleInGame = true;
type GameActiveCallback = (inGame: boolean) => void;
let gameActiveCallbacks: GameActiveCallback[] = [];

const presenceStats = {
  upsertOk: 0,
  upsertFail: 0,
  upsertSkipped: 0,
  trackOk: 0,
  trackFail: 0,
  subscribeFail: 0,
  lastError: '',
  realtimeConnected: false,
};

export function setLastPlayedCharacterId(id: number | null): void {
  lastCharacterId = id;
}

export function getLastPlayedCharacterId(): number | null {
  return lastCharacterId;
}

export function setGameThrottling(enabled: boolean): void {
  throttleInGame = enabled;
}

export function onGameActiveChange(cb: GameActiveCallback): () => void {
  gameActiveCallbacks.push(cb);
  return () => { gameActiveCallbacks = gameActiveCallbacks.filter((c) => c !== cb); };
}

function emitGameActive(inGame: boolean): void {
  for (const cb of gameActiveCallbacks) {
    try { cb(inGame); } catch (e) { console.error('gameActiveCallback', e); }
  }
}

export function setLastOpponent(connectCode: string, characterId?: number): void {
  lastOpponentCode = connectCode;
  lastOpponentCharacterId = characterId ?? null;
  lastOpponentTimestamp = Date.now();
}

export function getCurrentStatus(): PresenceStatus {
  return currentStatus;
}

export function getPresenceStats() {
  presenceStats.realtimeConnected = subscribed;
  return { ...presenceStats };
}

export function isLookingToPlay(): boolean {
  if (!lookingToPlay) return false;
  if (lookingToPlaySince && Date.now() - new Date(lookingToPlaySince).getTime() > LFG_EXPIRY_MS) {
    lookingToPlay = false;
    lookingToPlaySince = null;
    return false;
  }
  return true;
}

export async function toggleLookingToPlay(): Promise<boolean> {
  if (isLookingToPlay()) {
    lookingToPlay = false;
    lookingToPlaySince = null;
  } else {
    lookingToPlay = true;
    lookingToPlaySince = new Date().toISOString();
  }
  lastDbWriteTime = 0;
  if (loopUserId) {
    await pushPresence(currentStatus, loopConnectCode, loopDisplayName, loopUserId);
  }
  return lookingToPlay;
}

export function getOnlineUsers(): OnlineUser[] {
  return onlineUsers;
}

export function onPresenceSync(cb: PresenceSyncCallback): () => void {
  syncCallbacks.push(cb);
  return () => { syncCallbacks = syncCallbacks.filter((c) => c !== cb); };
}

export function onLocalStatusChange(cb: LocalStatusCallback): () => void {
  localStatusCallbacks.push(cb);
  return () => { localStatusCallbacks = localStatusCallbacks.filter((c) => c !== cb); };
}

function emitPresenceSync(): void {
  for (const cb of syncCallbacks) {
    try { cb(onlineUsers); } catch (e) { console.error('presenceSyncCallback', e); }
  }
}

function emitLocalStatus(): void {
  const opponent = currentStatus === 'in-game' ? getRecentOpponent() : null;
  const info: LocalStatus = {
    status: currentStatus,
    opponentCode: opponent?.code ?? null,
    opponentCharacterId: opponent ? lastOpponentCharacterId : null,
    playingSince: opponent?.since ?? null,
    characterId: lastCharacterId,
  };
  for (const cb of localStatusCallbacks) {
    try { cb(info); } catch (e) { console.error('localStatusCallback', e); }
  }
}

function extractOnlineUsers(): OnlineUser[] {
  if (!presenceChannel) return [];
  try {
    const state = presenceChannel.presenceState();
    const users: OnlineUser[] = [];
    for (const key of Object.keys(state)) {
      const entries = state[key] as any[];
      if (entries?.length > 0) {
        const e = entries[0];
        users.push({
          connectCode: e.connectCode || key,
          displayName: e.displayName || '',
          status: e.status || 'online',
          currentCharacter: e.currentCharacter ?? null,
          opponentCode: e.opponentCode ?? null,
          playingSince: e.playingSince ?? null,
          updatedAt: e.updatedAt || '',
        });
      }
    }
    return users;
  } catch (e) { console.error('extractOnlineUsers', e); return []; }
}

function getProcessSnapshot(): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/fo', 'csv', '/nh'], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? '' : stdout);
      });
    } else {
      execFile('ps', ['ax', '-o', 'command='], { timeout: 5000 }, (err, stdout) => {
        resolve(err ? '' : stdout);
      });
    }
  });
}

function snapshotContains(snapshot: string, names: readonly string[]): boolean {
  const lower = snapshot.toLowerCase();
  return names.some((name) => lower.includes(name.toLowerCase()));
}

function getRecentOpponent(): { code: string; since: string } | null {
  if (!_isOpponentRecent(lastOpponentCode, lastOpponentTimestamp, OPPONENT_RECENT_THRESHOLD)) {
    return null;
  }
  return {
    code: lastOpponentCode!,
    since: new Date(lastOpponentTimestamp).toISOString(),
  };
}

async function pushPresence(
  status: PresenceStatus,
  connectCode: string,
  displayName: string,
  userId: string,
): Promise<void> {
  try {
    const opponent = status === 'in-game' ? getRecentOpponent() : null;
    const character = status === 'in-game' ? lastCharacterId : null;
    const opCode = opponent?.code ?? null;

    const dirty = _isDirty(status, character, opCode, lastPushedStatus, lastPushedCharacter, lastPushedOpponentCode);
    const now = Date.now();
    const shouldWriteDb = _shouldWriteDb(dirty, lastDbWriteTime, DB_HEARTBEAT_INTERVAL, now);

    if (!shouldWriteDb) {
      presenceStats.upsertSkipped++;
    } else {
      const lfgActive = isLookingToPlay();
      const row: Record<string, any> = {
        user_id: userId,
        status,
        current_character: character,
        opponent_code: opCode,
        playing_since: opponent?.since ?? null,
        looking_to_play: lfgActive,
        looking_to_play_since: lfgActive ? lookingToPlaySince : null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('presence_log').upsert(
        row,
        { onConflict: 'user_id' },
      );
      if (error) {
        presenceStats.upsertFail++;
        presenceStats.lastError = `upsert: ${error.message}`;
        if (error.message.includes('row-level security')) {
          if (now - lastRlsWarning > 60_000) {
            console.warn('[presence] RLS rejection — auth session may have expired. Will retry silently.');
            lastRlsWarning = now;
          }
        } else {
          console.error('[presence] DB upsert failed:', error.message);
          if (error.message.includes('opponent_code') || error.message.includes('playing_since')) {
            const { error: retryErr } = await supabase.from('presence_log').upsert(
              {
                user_id: userId,
                status,
                current_character: lastCharacterId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_id' },
            );
            if (retryErr) console.error('[presence] DB upsert retry failed:', retryErr.message);
          }
        }
      } else {
        lastDbWriteTime = now;
        presenceStats.upsertOk++;
      }
    }

    if (!dirty) return;

    lastPushedStatus = status;
    lastPushedCharacter = character;
    lastPushedOpponentCode = opCode;

    if (status === 'offline') {
      if (presenceChannel && subscribed) {
        await presenceChannel.untrack();
      }
      return;
    }

    if (!presenceChannel || !subscribed) return;

    const payload: Record<string, any> = {
      connectCode,
      displayName,
      status,
      currentCharacter: character,
      opponentCode: opCode,
      playingSince: opponent?.since ?? null,
      updatedAt: new Date().toISOString(),
    };

    try {
      await presenceChannel.track(payload);
      presenceStats.trackOk++;
    } catch (trackErr) {
      presenceStats.trackFail++;
      presenceStats.lastError = `track: ${trackErr}`;
    }
  } catch (e) {
    presenceStats.upsertFail++;
    presenceStats.lastError = `upsert: ${e}`;
    console.error('pushPresence failed', e);
  }
}

async function subscribeChannel(connectCode: string): Promise<boolean> {
  if (presenceChannel && subscribed) return true;

  const gen = ++subscribeGeneration;

  if (presenceChannel) {
    try {
      await presenceChannel.unsubscribe();
    } catch {
      /* ignore */
    }
    presenceChannel = null;
    subscribed = false;
  }

  console.log('[presence] Creating Realtime channel for', connectCode, `(gen=${gen})`);
  console.log('[presence] WebSocket available:', typeof globalThis.WebSocket !== 'undefined');

  presenceChannel = supabase.channel('presence:global', {
    config: {
      presence: {
        key: connectCode,
      },
    },
  });

  presenceChannel.on('presence', { event: 'sync' }, () => {
    onlineUsers = extractOnlineUsers();
    emitPresenceSync();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        if (gen !== subscribeGeneration) return;
        reject(new Error('presence subscribe timeout (10s)'));
      }, 10_000);
      console.log('[presence] Calling channel.subscribe()...');
      presenceChannel!.subscribe((status, err) => {
        console.log('[presence] subscribe status:', status, err ? `error: ${err}` : '', `(gen=${gen}, current=${subscribeGeneration})`);
        if (gen !== subscribeGeneration) { clearTimeout(t); return; }
        if (status === 'SUBSCRIBED') {
          clearTimeout(t);
          subscribed = true;
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(t);
          reject(new Error(`presence subscribe ${status}${err ? ': ' + err : ''}`));
        } else if (status === 'CLOSED' && subscribed) {
          console.warn('[presence] Channel closed after SUBSCRIBED — will retry');
          subscribed = false;
          presenceStats.realtimeConnected = false;
          presenceStats.lastError = 'channel closed unexpectedly';
        }
      });
    });
    if (gen !== subscribeGeneration) return false;
    channelRetryCount = 0;
    presenceStats.realtimeConnected = true;
    console.log('[presence] Realtime channel CONNECTED (gen=%d)', gen);
    return true;
  } catch (e: any) {
    if (gen !== subscribeGeneration) {
      console.log('[presence] Ignoring stale subscribe error (gen=%d, current=%d)', gen, subscribeGeneration);
      return false;
    }
    console.error('[presence] subscribeChannel failed:', e?.message ?? e);
    presenceStats.subscribeFail++;
    presenceStats.lastError = `subscribe: ${e?.message ?? e}`;
    presenceStats.realtimeConnected = false;
    subscribed = false;
    if (presenceChannel) {
      try {
        await presenceChannel.unsubscribe();
      } catch {
        /* ignore */
      }
      presenceChannel = null;
    }
    return false;
  }
}

function scheduleChannelRetry(): void {
  if (channelRetryTimer || channelRetryCount >= MAX_CHANNEL_RETRIES) {
    if (channelRetryCount >= MAX_CHANNEL_RETRIES && !periodicRetryTimer) {
      console.log('[presence] Retries exhausted — will re-attempt every 5 minutes');
      periodicRetryTimer = setInterval(async () => {
        if (subscribed || !loopConnectCode) return;
        console.log('[presence] Periodic re-attempt of Realtime subscription...');
        channelRetryCount = 0;
        const ok = await subscribeChannel(loopConnectCode);
        if (ok && periodicRetryTimer) {
          clearInterval(periodicRetryTimer);
          periodicRetryTimer = null;
        }
      }, 5 * 60 * 1000);
    }
    return;
  }
  const delay = BASE_RETRY_DELAY * Math.pow(2, channelRetryCount);
  channelRetryTimer = setTimeout(async () => {
    channelRetryTimer = null;
    if (subscribed || !loopConnectCode) return;
    channelRetryCount++;
    console.log(`[presence] Retrying channel subscription (${channelRetryCount}/${MAX_CHANNEL_RETRIES}) — next in ${delay * 2 / 1000}s...`);
    const ok = await subscribeChannel(loopConnectCode);
    if (!ok) {
      scheduleChannelRetry();
    } else if (periodicRetryTimer) {
      clearInterval(periodicRetryTimer);
      periodicRetryTimer = null;
    }
  }, delay);
}

export async function startPresenceLoop(
  connectCode: string,
  displayName: string,
  userId: string,
  replayDir: string,
): Promise<void> {
  try {
    await stopPresenceLoop();
    loopConnectCode = connectCode;
    loopDisplayName = displayName;
    loopUserId = userId;
    console.log('[presence] startPresenceLoop — subscribing channel...');

    const channelOk = await subscribeChannel(connectCode);
    console.log('[presence] startPresenceLoop — channelOk:', channelOk);
    if (!channelOk) scheduleChannelRetry();

    const tick = async () => {
      try {
        if (lookingToPlay && lookingToPlaySince &&
            Date.now() - new Date(lookingToPlaySince).getTime() > LFG_EXPIRY_MS) {
          lookingToPlay = false;
          lookingToPlaySince = null;
          lastDbWriteTime = 0;
        }

        const now = Date.now();
        if (now - lastStaleCleanup >= STALE_CLEANUP_INTERVAL) {
          lastStaleCleanup = now;
          const cutoff = new Date(now - PRESENCE_STALE_THRESHOLD).toISOString();
          supabase.from('presence_log')
            .update({ status: 'offline', looking_to_play: false, looking_to_play_since: null })
            .in('status', ['online', 'in-game'])
            .lt('updated_at', cutoff)
            .then(({ error }) => {
              if (error) console.warn('[presence] stale cleanup failed:', error.message);
              else console.log('[presence] stale cleanup ran');
            });
        }

        const t0 = performance.now();
        const snapshot = await getProcessSnapshot();
        const launcherRunning = snapshotContains(snapshot, SLIPPI_LAUNCHER_PROCESS_NAMES);
        const dolphinRunning = snapshotContains(snapshot, DOLPHIN_PROCESS_NAMES);
        const procMs = performance.now() - t0;
        if (procMs > 100) console.log(`[perf] process scan took ${procMs.toFixed(0)}ms`);

        const next = resolvePresenceStatus(launcherRunning, dolphinRunning);
        if (next === 'in-game' && currentStatus !== 'in-game') {
          lastOpponentCode = null;
          lastOpponentCharacterId = null;
          lastOpponentTimestamp = 0;
        }
        const prevStatus = currentStatus;
        const opponent = next === 'in-game' ? getRecentOpponent() : null;
        if (next !== currentStatus) {
          console.log(
            `[presence] ${currentStatus} → ${next}` +
            (opponent ? ` opponent=${opponent.code}` : '') +
            (lastCharacterId != null ? ` myChar=${lastCharacterId}` : ''),
          );
        }
        currentStatus = next;
        emitLocalStatus();

        if (next !== prevStatus) {
          if (next === 'in-game') emitGameActive(true);
          else if (prevStatus === 'in-game') emitGameActive(false);
        }

        const t1 = performance.now();
        await pushPresence(
          next,
          loopConnectCode,
          loopDisplayName,
          loopUserId,
        );
        const pushMs = performance.now() - t1;
        if (pushMs > 200) console.log(`[perf] pushPresence took ${pushMs.toFixed(0)}ms`);

        if (!subscribed) scheduleChannelRetry();
      } catch (e) {
        console.error('presence tick failed', e);
      }

      const delay = (currentStatus === 'in-game' && throttleInGame)
        ? IN_GAME_POLL_INTERVAL
        : PRESENCE_POLL_INTERVAL;
      pollTimer = setTimeout(() => void tick(), delay);
    };

    void tick();
  } catch (e) {
    console.error('startPresenceLoop failed', e);
  }
}

export async function stopPresenceLoop(): Promise<void> {
  try {
    subscribeGeneration++;
    if (channelRetryTimer) {
      clearTimeout(channelRetryTimer);
      channelRetryTimer = null;
    }
    if (periodicRetryTimer) {
      clearInterval(periodicRetryTimer);
      periodicRetryTimer = null;
    }
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (presenceChannel && subscribed) {
      try {
        await presenceChannel.untrack();
      } catch (e) {
        console.error('presence untrack failed', e);
      }
      await presenceChannel.unsubscribe();
      subscribed = false;
      presenceChannel = null;
    }
    currentStatus = 'offline';
    lastPushedStatus = 'offline';
    lastPushedCharacter = null;
    lastPushedOpponentCode = null;
    lastDbWriteTime = 0;
  } catch (e) {
    console.error('stopPresenceLoop failed', e);
  }
}

export async function pushOfflineAndStop(): Promise<void> {
  try {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (channelRetryTimer) { clearTimeout(channelRetryTimer); channelRetryTimer = null; }
    if (periodicRetryTimer) { clearInterval(periodicRetryTimer); periodicRetryTimer = null; }
    currentStatus = 'offline';
    lastPushedStatus = 'offline';
    lastPushedCharacter = null;
    lastPushedOpponentCode = null;
    lastDbWriteTime = 0;

    lookingToPlay = false;
    lookingToPlaySince = null;

    if (loopUserId) {
      await supabase.from('presence_log').upsert(
        {
          user_id: loopUserId,
          status: 'offline',
          current_character: null,
          opponent_code: null,
          playing_since: null,
          looking_to_play: false,
          looking_to_play_since: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    }

    if (presenceChannel && subscribed) {
      try { await presenceChannel.untrack(); } catch {}
      try { await presenceChannel.unsubscribe(); } catch {}
      subscribed = false;
      presenceChannel = null;
    }
  } catch (e) { console.error('pushOfflineAndStop failed', e); }
}

export function updatePresenceReplayDir(_dir: string): void {
  // kept for API compat
}
