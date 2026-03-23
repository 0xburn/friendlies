import type { RealtimeChannel } from '@supabase/supabase-js';

import {
  DOLPHIN_PROCESS_NAMES,
  OPPONENT_RECENT_THRESHOLD,
  PRESENCE_POLL_INTERVAL,
  SLIPPI_LAUNCHER_PROCESS_NAMES,
} from './config';
import { supabase } from './supabase';

const find = require('find-process') as (
  type: 'name',
  name: string,
  strict?: boolean,
) => Promise<Array<{ name: string; pid: number }>>;

export type PresenceStatus = 'offline' | 'online' | 'in-game';

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

let pollTimer: ReturnType<typeof setInterval> | null = null;
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
const MAX_CHANNEL_RETRIES = 1;

export function setLastPlayedCharacterId(id: number | null): void {
  lastCharacterId = id;
}

export function getLastPlayedCharacterId(): number | null {
  return lastCharacterId;
}

export function setLastOpponent(connectCode: string, characterId?: number): void {
  lastOpponentCode = connectCode;
  lastOpponentCharacterId = characterId ?? null;
  lastOpponentTimestamp = Date.now();
}

export function getCurrentStatus(): PresenceStatus {
  return currentStatus;
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

async function isProcessRunning(names: readonly string[]): Promise<boolean> {
  try {
    const results = await Promise.all(
      names.map((name) => find('name', name, false).catch(() => [] as any[])),
    );
    for (let i = 0; i < results.length; i++) {
      if (results[i].length > 0) return true;
    }
  } catch (e) {
    console.error('isProcessRunning failed', e);
  }
  return false;
}

function resolvePresenceStatus(
  launcherRunning: boolean,
  dolphinRunning: boolean,
): PresenceStatus {
  if (dolphinRunning) return 'in-game';
  return 'online';
}

function getRecentOpponent(): { code: string; since: string } | null {
  if (
    !lastOpponentCode ||
    Date.now() - lastOpponentTimestamp > OPPONENT_RECENT_THRESHOLD
  ) {
    return null;
  }
  return {
    code: lastOpponentCode,
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

    const row: Record<string, any> = {
      user_id: userId,
      status,
      current_character: status === 'in-game' ? lastCharacterId : null,
      opponent_code: opponent?.code ?? null,
      playing_since: opponent?.since ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('presence_log').upsert(
      row,
      { onConflict: 'user_id' },
    );
    if (error) {
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
      currentCharacter: status === 'in-game' ? lastCharacterId : null,
      opponentCode: opponent?.code ?? null,
      playingSince: opponent?.since ?? null,
      updatedAt: new Date().toISOString(),
    };

    await presenceChannel.track(payload);
  } catch (e) {
    console.error('pushPresence failed', e);
  }
}

async function subscribeChannel(connectCode: string): Promise<boolean> {
  if (presenceChannel && subscribed) return true;
  if (presenceChannel) {
    try {
      await presenceChannel.unsubscribe();
    } catch {
      /* ignore */
    }
    presenceChannel = null;
    subscribed = false;
  }
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
      const t = setTimeout(
        () => reject(new Error('presence subscribe timeout')),
        4000,
      );
      presenceChannel!.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(t);
          subscribed = true;
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(t);
          reject(new Error(`presence subscribe ${status}`));
        }
      });
    });
    return true;
  } catch (e) {
    console.error('subscribeChannel failed', e);
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
  if (channelRetryTimer || channelRetryCount >= MAX_CHANNEL_RETRIES) return;
  channelRetryTimer = setTimeout(async () => {
    channelRetryTimer = null;
    if (subscribed || !loopConnectCode) return;
    channelRetryCount++;
    console.log(`[presence] Retrying channel subscription (${channelRetryCount}/${MAX_CHANNEL_RETRIES})...`);
    const ok = await subscribeChannel(loopConnectCode);
    if (!ok && channelRetryCount >= MAX_CHANNEL_RETRIES) {
      console.log('[presence] Realtime channel unavailable — using DB polling only');
    } else if (!ok) {
      scheduleChannelRetry();
    }
  }, 30_000);
}

export async function startPresenceLoop(
  connectCode: string,
  displayName: string,
  userId: string,
  replayDir: string,
): Promise<void> {
  try {
    stopPresenceLoop();
    loopConnectCode = connectCode;
    loopDisplayName = displayName;
    loopUserId = userId;

    const channelOk = await subscribeChannel(connectCode);
    if (!channelOk) scheduleChannelRetry();

    const tick = async () => {
      try {
        const launcherRunning = await isProcessRunning(SLIPPI_LAUNCHER_PROCESS_NAMES);
        const dolphinRunning = await isProcessRunning(DOLPHIN_PROCESS_NAMES);
        const next = resolvePresenceStatus(launcherRunning, dolphinRunning);
        if (next === 'in-game' && currentStatus !== 'in-game') {
          lastOpponentCode = null;
          lastOpponentCharacterId = null;
          lastOpponentTimestamp = 0;
        }
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
        await pushPresence(
          next,
          loopConnectCode,
          loopDisplayName,
          loopUserId,
        );
        if (!subscribed) scheduleChannelRetry();
      } catch (e) {
        console.error('presence tick failed', e);
      }
    };

    void tick();
    pollTimer = setInterval(() => void tick(), PRESENCE_POLL_INTERVAL);
  } catch (e) {
    console.error('startPresenceLoop failed', e);
  }
}

export async function stopPresenceLoop(): Promise<void> {
  try {
    if (channelRetryTimer) {
      clearTimeout(channelRetryTimer);
      channelRetryTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
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
  } catch (e) {
    console.error('stopPresenceLoop failed', e);
  }
}

export async function pushOfflineAndStop(): Promise<void> {
  try {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (channelRetryTimer) { clearTimeout(channelRetryTimer); channelRetryTimer = null; }
    currentStatus = 'offline';

    if (loopUserId) {
      await supabase.from('presence_log').upsert(
        {
          user_id: loopUserId,
          status: 'offline',
          current_character: null,
          opponent_code: null,
          playing_since: null,
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
