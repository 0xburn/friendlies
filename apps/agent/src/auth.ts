import { User } from '@supabase/supabase-js';
import { shell } from 'electron';

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

export async function startAuthFlow(): Promise<void> {
  try {
    const url = getAuthorizeUrl();
    console.log('startAuthFlow opening:', url);
    await shell.openExternal(url);
  } catch (e) {
    console.error('startAuthFlow failed', e);
  }
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
