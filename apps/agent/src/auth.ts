import { exec } from 'child_process';
import { User } from '@supabase/supabase-js';
import { clipboard, shell } from 'electron';

const Store = require('electron-store');

import { APP_PROTOCOL } from './config';
import { setSession, supabase, SUPABASE_URL_FALLBACK, SUPABASE_ANON_KEY_FALLBACK } from './supabase';

const TOKEN_KEY_ACCESS = 'supabase_access_token';
const TOKEN_KEY_REFRESH = 'supabase_refresh_token';

const authStore = new Store({ name: 'slippi-friends-auth' });

function getAuthorizeUrl(): string {
  const base = process.env.SUPABASE_URL || SUPABASE_URL_FALLBACK;
  const anon = process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_FALLBACK;
  const redirectTo = `${APP_PROTOCOL}://auth-callback`;
  const u = new URL(`${base.replace(/\/$/, '')}/auth/v1/authorize`);
  u.searchParams.set('provider', 'discord');
  u.searchParams.set('redirect_to', redirectTo);
  u.searchParams.set('apikey', anon);
  return u.toString();
}

export async function startAuthFlow(): Promise<string> {
  const url = getAuthorizeUrl();
  console.log('startAuthFlow opening:', url);

  try {
    await shell.openExternal(url);
    return url;
  } catch (e) {
    console.error('shell.openExternal failed, trying platform fallback', e);
  }

  // Windows fallback — shell.openExternal can silently fail
  if (process.platform === 'win32') {
    try {
      await new Promise<void>((resolve, reject) => {
        exec(`start "" "${url}"`, (err) => (err ? reject(err) : resolve()));
      });
      return url;
    } catch (e) {
      console.error('Windows start command failed', e);
    }
  }

  // Last resort: copy URL to clipboard so user can paste manually
  try {
    clipboard.writeText(url);
    console.log('Auth URL copied to clipboard as last resort');
  } catch {}

  return url;
}

export async function handleAuthCallback(url: string): Promise<void> {
  try {
    const parsed = new URL(url);
    const fragment = parsed.hash?.startsWith('#')
      ? parsed.hash.slice(1)
      : '';
    const search = parsed.search?.startsWith('?')
      ? parsed.search.slice(1)
      : '';
    const params = new URLSearchParams(fragment || search);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) {
      throw new Error('Missing tokens in auth callback URL');
    }
    await setSession(accessToken, refreshToken);
    authStore.set(TOKEN_KEY_ACCESS, accessToken);
    authStore.set(TOKEN_KEY_REFRESH, refreshToken);
  } catch (e) {
    console.error('handleAuthCallback failed', e);
    throw e;
  }
}

export function listenForTokenRefresh(): void {
  supabase.auth.onAuthStateChange((event, session) => {
    if (
      (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
      session?.access_token &&
      session?.refresh_token
    ) {
      authStore.set(TOKEN_KEY_ACCESS, session.access_token);
      authStore.set(TOKEN_KEY_REFRESH, session.refresh_token);
    }
  });
}

export async function restoreSession(): Promise<void> {
  try {
    const access = authStore.get(TOKEN_KEY_ACCESS) as string | undefined;
    const refresh = authStore.get(TOKEN_KEY_REFRESH) as string | undefined;
    if (!access || !refresh) return;
    await setSession(access, refresh);
  } catch (e) {
    console.error('restoreSession failed', e);
    authStore.delete(TOKEN_KEY_ACCESS);
    authStore.delete(TOKEN_KEY_REFRESH);
  }
}

export async function logout(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.error('logout signOut failed', e);
  }
  authStore.delete(TOKEN_KEY_ACCESS);
  authStore.delete(TOKEN_KEY_REFRESH);
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session);
  } catch {
    return false;
  }
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user;
  } catch {
    return null;
  }
}
