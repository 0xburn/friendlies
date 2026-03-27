import { exec } from 'child_process';
import { createServer, Server } from 'http';
import { User } from '@supabase/supabase-js';
import { clipboard, shell } from 'electron';

const Store = require('electron-store');

import { APP_PROTOCOL } from './config';
import { setSession, supabase, SUPABASE_URL_FALLBACK, SUPABASE_ANON_KEY_FALLBACK } from './supabase';

const TOKEN_KEY_ACCESS = 'supabase_access_token';
const TOKEN_KEY_REFRESH = 'supabase_refresh_token';
const LOCAL_AUTH_PORT = 18457;

const authStore = new Store({ name: 'slippi-friends-auth' });

let localAuthServer: Server | null = null;

function getAuthorizeUrl(useLocalCallback = false): string {
  const base = process.env.SUPABASE_URL || SUPABASE_URL_FALLBACK;
  const anon = process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_FALLBACK;
  const redirectTo = useLocalCallback
    ? `http://localhost:${LOCAL_AUTH_PORT}/auth-callback`
    : `${APP_PROTOCOL}://auth-callback`;
  const u = new URL(`${base.replace(/\/$/, '')}/auth/v1/authorize`);
  u.searchParams.set('provider', 'discord');
  u.searchParams.set('redirect_to', redirectTo);
  u.searchParams.set('apikey', anon);
  return u.toString();
}

const CALLBACK_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>friendlies</title></head>
<body style="background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center">
<div id="loading"><p style="color:#888">Authenticating...</p></div>
<div id="done" style="display:none">
<h2 style="color:#21BA45;margin-bottom:8px">&#10003; Authenticated</h2>
<p style="color:#888;font-size:14px">You can close this tab and return to friendlies.</p>
</div>
</div>
<script>
const hash = window.location.hash.substring(1);
if (hash && hash.includes('access_token')) {
  fetch('/auth-complete', { method: 'POST', headers: {'Content-Type':'text/plain'}, body: hash })
    .then(() => { document.getElementById('loading').style.display='none'; document.getElementById('done').style.display='block'; })
    .catch(() => { document.getElementById('loading').innerHTML='<p style="color:#f87171">Something went wrong. Please try again.</p>'; });
} else {
  document.getElementById('loading').innerHTML='<p style="color:#f87171">No authentication data received. Please try again.</p>';
}
</script>
</body></html>`;

export function startLocalAuthServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (localAuthServer) {
      try { localAuthServer.close(); } catch {}
      localAuthServer = null;
    }

    const server = createServer((req, res) => {
      if (req.url?.startsWith('/auth-callback')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(CALLBACK_HTML);
      } else if (req.url === '/auth-complete' && req.method === 'POST') {
        let body = '';
        req.on('data', (c: Buffer) => { body += c.toString(); });
        req.on('end', async () => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('ok');
          try {
            const params = new URLSearchParams(body);
            const accessToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');
            if (!accessToken || !refreshToken) {
              reject(new Error('Missing tokens from local auth callback'));
              return;
            }
            await setSession(accessToken, refreshToken);
            authStore.set(TOKEN_KEY_ACCESS, accessToken);
            authStore.set(TOKEN_KEY_REFRESH, refreshToken);
            resolve();
          } catch (e) {
            reject(e);
          } finally {
            setTimeout(() => { try { server.close(); } catch {} localAuthServer = null; }, 1000);
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    localAuthServer = server;

    server.listen(LOCAL_AUTH_PORT, '127.0.0.1', () => {
      console.log(`[auth] Local auth server listening on port ${LOCAL_AUTH_PORT}`);
    });

    server.on('error', (err) => {
      console.error('[auth] Local auth server error:', err);
      localAuthServer = null;
      reject(err);
    });

    setTimeout(() => {
      try { server.close(); } catch {}
      localAuthServer = null;
      reject(new Error('Local auth server timed out after 5 minutes'));
    }, 300_000);
  });
}

async function openBrowser(url: string): Promise<void> {
  try {
    await shell.openExternal(url);
    return;
  } catch (e) {
    console.error('shell.openExternal failed, trying platform fallback', e);
  }

  if (process.platform === 'win32') {
    try {
      await new Promise<void>((resolve, reject) => {
        exec(`start "" "${url}"`, (err) => (err ? reject(err) : resolve()));
      });
      return;
    } catch (e) {
      console.error('Windows start command failed', e);
    }
  }

  if (process.platform === 'linux') {
    try {
      await new Promise<void>((resolve, reject) => {
        exec(`xdg-open "${url}"`, (err) => (err ? reject(err) : resolve()));
      });
      return;
    } catch (e) {
      console.error('xdg-open failed', e);
    }
  }

  try {
    clipboard.writeText(url);
    console.log('Auth URL copied to clipboard as last resort');
  } catch {}
}

export async function startAuthFlow(): Promise<string> {
  const useLocal = process.platform === 'linux';
  const url = getAuthorizeUrl(useLocal);
  console.log('startAuthFlow opening:', url, useLocal ? '(localhost callback)' : '(protocol handler)');
  await openBrowser(url);
  return url;
}

export async function handleAuthCallback(url: string): Promise<void> {
  try {
    let accessToken: string | null = null;
    let refreshToken: string | null = null;

    try {
      const parsed = new URL(url);
      const fragment = parsed.hash?.startsWith('#') ? parsed.hash.slice(1) : '';
      const search = parsed.search?.startsWith('?') ? parsed.search.slice(1) : '';
      const params = new URLSearchParams(fragment || search);
      accessToken = params.get('access_token');
      refreshToken = params.get('refresh_token');
    } catch {
      // URL constructor failed — try parsing raw string for tokens
    }

    if (!accessToken || !refreshToken) {
      const hashIdx = url.indexOf('#');
      const raw = hashIdx !== -1 ? url.slice(hashIdx + 1) : url;
      const fallback = new URLSearchParams(raw);
      accessToken = accessToken || fallback.get('access_token');
      refreshToken = refreshToken || fallback.get('refresh_token');
    }

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
  clearUserCache();
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session);
  } catch {
    return false;
  }
}

let _cachedUser: User | null = null;
let _cachedAt = 0;
let _inflight: Promise<User | null> | null = null;
const USER_CACHE_TTL = 5_000;

export async function getCurrentUser(): Promise<User | null> {
  if (_cachedUser && Date.now() - _cachedAt < USER_CACHE_TTL) return _cachedUser;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) return null;
      _cachedUser = data.user;
      _cachedAt = Date.now();
      return _cachedUser;
    } catch {
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export function clearUserCache(): void {
  _cachedUser = null;
  _cachedAt = 0;
}
