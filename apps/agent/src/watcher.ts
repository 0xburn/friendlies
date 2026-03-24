import * as fs from 'fs';
import * as path from 'path';

import chokidar from 'chokidar';

import { supabase } from './supabase';

const { SlippiGame, GameMode } = require('@slippi/slippi-js') as {
  SlippiGame: typeof import('@slippi/slippi-js').SlippiGame;
  GameMode: typeof import('@slippi/slippi-js').GameMode;
};

export type OpponentInfo = {
  connectCode: string;
  displayName: string;
  characterId: number;
};

export type IdentityMismatch = {
  claimedCode: string;
  actualCode: string;
  replayFile: string;
};

function normalizeConnectCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '#').replace(/#+/g, '#').trim().toUpperCase();
}

function mapGameMode(mode: number | null | undefined): string | null {
  if (mode === null || mode === undefined) return null;
  if (mode === GameMode.ONLINE) return 'unranked';
  return String(mode);
}

let watcher: ReturnType<typeof chokidar.watch> | null = null;

let onIdentityMismatch: ((info: IdentityMismatch) => void) | null = null;

export function setIdentityMismatchHandler(handler: (info: IdentityMismatch) => void): void {
  onIdentityMismatch = handler;
}

export async function processNewReplay(
  filePath: string,
  localConnectCode: string,
  isLive = false,
): Promise<OpponentInfo | null> {
  try {
    const game = new SlippiGame(filePath);
    const settings = game.getSettings();
    if (!settings?.players?.length) return null;

    const localNorm = normalizeConnectCode(localConnectCode);
    const humans = settings.players.filter(
      (p) => p.type === 0 || p.type === null,
    );

    const playersWithCodes = humans.filter(
      (p) => normalizeConnectCode(p.connectCode || '').length > 0,
    );
    if (playersWithCodes.length === 0) {
      console.log('[watcher] Skipping offline/local replay (no connect codes)');
      return null;
    }

    const localPlayer = settings.players.find(
      (p) => normalizeConnectCode(p.connectCode || '') === localNorm,
    );

    if (localPlayer) {
      console.log(`[watcher] Matched local player at port ${localPlayer.port} (code ${localNorm}, char ${localPlayer.characterId})`);
    } else {
      console.log(`[watcher] Local player not found for ${localNorm} — players: ${playersWithCodes.map((p) => normalizeConnectCode(p.connectCode || '')).join(', ')}`);
    }

    // Identity mismatch detection: only for live replays (not backfill).
    // If this is an online game with human players but none match the
    // claimed connect code, the user is spoofing via user.json.
    if (isLive && !localPlayer && humans.length >= 2) {
      const actualCodes = humans
        .map((p) => normalizeConnectCode(p.connectCode || ''))
        .filter(Boolean);
      const localAlpha = localNorm.replace(/[^A-Z0-9]/g, '');
      const isEncodingMismatch = actualCodes.some(
        (c) => c.replace(/[^A-Z0-9]/g, '') === localAlpha,
      );
      if (isEncodingMismatch) {
        console.log(`[identity] Encoding-only mismatch for ${localNorm} — not a spoof`);
      } else if (actualCodes.length > 0) {
        const replayName = path.basename(filePath);
        const mismatch: IdentityMismatch = {
          claimedCode: localNorm,
          actualCode: actualCodes[0],
          replayFile: replayName,
        };
        console.warn('[identity] MISMATCH DETECTED:', mismatch);
        try {
          const { data: userData } = await supabase.auth.getUser();
          if (userData?.user) {
            const meta = userData.user.user_metadata || {};
            await supabase.from('blacklist').insert({
              user_id: userData.user.id,
              discord_id: meta.provider_id || null,
              discord_username: meta.full_name || meta.name || null,
              reason: 'identity_mismatch',
              claimed_code: localNorm,
              actual_code: actualCodes[0],
              replay_file: replayName,
            });
            await supabase.from('profiles').update({
              connect_code: null,
              slippi_uid: null,
              verified: false,
              verified_at: null,
            }).eq('id', userData.user.id);
          }
        } catch (e) {
          console.error('Failed to blacklist/unlink spoofed profile', e);
        }
        if (onIdentityMismatch) onIdentityMismatch(mismatch);
      }
    }

    const opponents = settings.players.filter(
      (p) => normalizeConnectCode(p.connectCode || '') !== localNorm,
    );
    const opponent =
      opponents.find((p) => p.type === 0 || p.type === null) ??
      opponents[0];
    if (!opponent?.connectCode) return null;

    const oppCode = normalizeConnectCode(opponent.connectCode);
    const oppName = opponent.displayName || '';
    const oppChar = opponent.characterId ?? 0;

    if (localPlayer?.characterId != null) {
      try {
        const { setLastPlayedCharacterId } = require('./presence') as {
          setLastPlayedCharacterId: (id: number | null) => void;
        };
        setLastPlayedCharacterId(localPlayer.characterId);
      } catch (e) {
        console.error('presence character notify failed', e);
      }
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return null;

    const gameEnd = game.getGameEnd();
    let didWin: boolean | null = null;
    if (gameEnd?.placements?.length && localPlayer) {
      const localPlacement = gameEnd.placements.find(
        (pl) => pl.playerIndex === localPlayer.playerIndex,
      );
      const oppPlacement = gameEnd.placements.find(
        (pl) => pl.playerIndex === opponent.playerIndex,
      );
      if (
        localPlacement?.position != null &&
        oppPlacement?.position != null &&
        humans.length === 2
      ) {
        didWin = localPlacement.position < oppPlacement.position;
      }
    }

    let playedAt: string;
    try {
      const fileStat = await fs.promises.stat(filePath);
      playedAt = new Date(fileStat.mtimeMs).toISOString();
    } catch {
      playedAt = new Date().toISOString();
    }

    const row = {
      user_id: userData.user.id,
      opponent_connect_code: oppCode,
      opponent_display_name: oppName || null,
      opponent_slippi_uid: opponent.userId || null,
      user_character_id: localPlayer?.characterId ?? null,
      opponent_character_id: opponent.characterId ?? null,
      stage_id: settings.stageId ?? null,
      game_mode: mapGameMode(settings.gameMode ?? settings.inGameMode),
      did_win: didWin,
      replay_filename: path.basename(filePath),
      played_at: playedAt,
    };

    const { error } = await supabase
      .from('matches')
      .upsert(row, { onConflict: 'user_id,replay_filename' });
    if (error) {
      console.error('matches upsert failed', error);
    }

    return {
      connectCode: oppCode,
      displayName: oppName,
      characterId: oppChar,
    };
  } catch (e) {
    console.error('processNewReplay failed', e);
    return null;
  }
}

export function startWatcher(
  replayDir: string,
  localConnectCode: string,
  onOpponent: (info: OpponentInfo) => void,
): void {
  try {
    stopWatcher();
    if (!fs.existsSync(replayDir)) {
      console.error('Replay directory missing:', replayDir);
      return;
    }
    console.log(`[watcher] Starting — dir="${replayDir}" code="${localConnectCode}"`);
    watcher = chokidar.watch(replayDir, {
      ignoreInitial: true,
      depth: 3,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 500,
      },
    });
    watcher.on('ready', () => {
      console.log('[watcher] Ready and watching for new replays');
    });
    watcher.on('error', (err) => {
      console.error('[watcher] Error:', err);
    });
    watcher.on('add', (filePath: string) => {
      if (!filePath.toLowerCase().endsWith('.slp')) return;
      console.log(`[watcher] New replay detected: ${path.basename(filePath)}`);
      void (async () => {
        try {
          const info = await processNewReplay(filePath, localConnectCode, true);
          if (info) {
            console.log(`[watcher] Opponent: ${info.connectCode} (char ${info.characterId}) name="${info.displayName}"`);
            onOpponent(info);
          } else {
            console.log('[watcher] processNewReplay returned null (no opponent found)');
          }
        } catch (e) {
          console.error('watcher add handler failed', e);
        }
      })();
    });
  } catch (e) {
    console.error('startWatcher failed', e);
  }
}

const BACKFILL_BATCH_SIZE = 5;

export async function backfillRecentReplays(
  replayDir: string,
  localConnectCode: string,
  sinceMs = 2 * 24 * 60 * 60 * 1000,
  beforeMs = 0,
): Promise<{ processed: number; oldestMs: number }> {
  let processed = 0;
  let oldestMs = Date.now();
  try {
    const now = Date.now();
    const cutoffOld = now - sinceMs - beforeMs;
    const cutoffNew = beforeMs > 0 ? now - beforeMs : now;

    const files = await collectSlpFiles(replayDir, 2);
    const filtered = files
      .filter((f) => f.mtime >= cutoffOld && f.mtime <= cutoffNew)
      .sort((a, b) => b.mtime - a.mtime);

    console.log(`[backfill] Processing ${filtered.length} replays (cutoff ${Math.round(sinceMs / 3600000)}h)`);

    for (let i = 0; i < filtered.length; i++) {
      const f = filtered[i];
      try {
        await processNewReplay(f.path, localConnectCode);
        processed++;
        if (f.mtime < oldestMs) oldestMs = f.mtime;
      } catch { /* skip bad replays */ }
      if ((i + 1) % BACKFILL_BATCH_SIZE === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    console.log(`[backfill] Done — ${processed}/${filtered.length} processed`);
  } catch (e) { console.error('backfillRecentReplays', e); }
  return { processed, oldestMs };
}

async function collectSlpFiles(dir: string, depth: number): Promise<Array<{ path: string; mtime: number }>> {
  const results: Array<{ path: string; mtime: number }> = [];
  if (depth < 0) return results;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const slpEntries = entries.filter(e => e.isFile() && e.name.endsWith('.slp'));
    const dirEntries = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

    const STAT_BATCH = 100;
    for (let i = 0; i < slpEntries.length; i += STAT_BATCH) {
      const batch = slpEntries.slice(i, i + STAT_BATCH);
      const stats = await Promise.all(batch.map(async (entry) => {
        const full = path.join(dir, entry.name);
        try {
          const st = await fs.promises.stat(full);
          return { path: full, mtime: st.mtimeMs };
        } catch { return null; }
      }));
      for (const s of stats) { if (s) results.push(s); }
    }

    for (const d of dirEntries) {
      const sub = await collectSlpFiles(path.join(dir, d.name), depth - 1);
      results.push(...sub);
    }
  } catch { /* permission error, etc */ }
  return results;
}

export function stopWatcher(): void {
  try {
    void watcher?.close();
  } catch (e) {
    console.error('stopWatcher failed', e);
  }
  watcher = null;
}
