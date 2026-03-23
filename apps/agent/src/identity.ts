import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const Store = require('electron-store');

import { getSlippiUserJsonPaths } from './config';
import { supabase } from './supabase';

const identityStore = new Store({ name: 'slippi-friends-identity' });
const KEY_USER_JSON_PATH = 'userJsonPath';

export interface SlippiIdentity {
  uid: string;
  connectCode: string;
  displayName: string;
  staleAccount?: boolean;
}

function normalizeConnectCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '#').replace(/#+/g, '#').trim();
}

function getLauncherActiveUid(): string | null {
  try {
    const home = os.homedir();
    const settingsPaths = process.platform === 'win32'
      ? [path.join(home, 'AppData', 'Roaming', 'Slippi Launcher', 'Settings')]
      : process.platform === 'darwin'
        ? [path.join(home, 'Library', 'Application Support', 'Slippi Launcher', 'Settings')]
        : [path.join(home, '.config', 'Slippi Launcher', 'Settings')];

    for (const p of settingsPaths) {
      if (!fs.existsSync(p)) continue;
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const activeId = data?.accounts?.activeId;
      if (activeId && typeof activeId === 'string') {
        console.log(`[identity] Launcher activeId: ${activeId}`);
        return activeId;
      }
    }
  } catch { /* ignore */ }
  return null;
}

export function findUserJson(): string | null {
  try {
    const paths = getSlippiUserJsonPaths();
    for (const p of paths) {
      if (fs.existsSync(p)) {
        console.log(`[identity] FOUND user.json at: ${p}`);
        identityStore.set(KEY_USER_JSON_PATH, p);
        return p;
      }
    }
    const cached = identityStore.get(KEY_USER_JSON_PATH) as string | undefined;
    if (cached && fs.existsSync(cached)) {
      return cached;
    }
    console.log('[identity] no user.json found anywhere');
  } catch (e) {
    console.error('findUserJson failed', e);
  }
  return null;
}

export function readSlippiIdentity(userJsonPath: string): SlippiIdentity | null {
  try {
    const raw = fs.readFileSync(userJsonPath, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const uid = typeof data.uid === 'string' ? data.uid : '';
    const connectCode =
      typeof data.connectCode === 'string'
        ? normalizeConnectCode(data.connectCode)
        : '';
    const displayName =
      typeof data.displayName === 'string' ? data.displayName : '';
    if (!uid || !connectCode) return null;
    return { uid, connectCode, displayName };
  } catch (e) {
    console.error('readSlippiIdentity failed', e);
    return null;
  }
}

export async function verifyIdentity(
  identity: SlippiIdentity,
): Promise<boolean> {
  try {
    const base = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
    const anon = process.env.SUPABASE_ANON_KEY ?? '';
    const { data: sessionData } = await supabase.auth.getSession();
    const jwt = sessionData.session?.access_token;
    if (!jwt) return false;
    const res = await fetch(`${base}/functions/v1/verify-slippi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        apikey: anon,
      },
      body: JSON.stringify({
        slippiUid: identity.uid,
        connectCode: identity.connectCode,
      }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { verified?: boolean };
    return Boolean(body.verified);
  } catch (e) {
    console.error('verifyIdentity failed', e);
    return false;
  }
}

export function getIdentity(): SlippiIdentity | null {
  try {
    const found = findUserJson();
    if (!found) return null;
    const identity = readSlippiIdentity(found);
    if (!identity) return null;

    const launcherUid = getLauncherActiveUid();
    if (launcherUid && launcherUid !== identity.uid) {
      console.warn(
        `[identity] user.json has uid ${identity.uid} but Launcher active account is ${launcherUid}. ` +
        `user.json is stale — user needs to open a game to update it.`,
      );
      identity.staleAccount = true;
    }

    return identity;
  } catch (e) {
    console.error('getIdentity failed', e);
    return null;
  }
}
