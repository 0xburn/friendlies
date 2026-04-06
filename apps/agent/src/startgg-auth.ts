/**
 * start.gg OAuth lifecycle for Cashbox.
 *
 * Tokens are encrypted with Electron safeStorage and persisted in electron-store.
 * The client_secret lives only in the Supabase Edge Function environment.
 *
 * Auth uses an in-app BrowserWindow with a persistent session partition so the user
 * logs in once and the session (OAuth + web cookies) persists across app restarts.
 */
import { createServer, Server } from 'http';
import { BrowserWindow, safeStorage, session as electronSession } from 'electron';

const Store = require('electron-store');

import { supabase, SUPABASE_URL_FALLBACK, SUPABASE_ANON_KEY_FALLBACK } from './supabase';
import { getCurrentUser } from './auth';

const STARTGG_OAUTH_SCOPE = 'user.identity tournament.reporter';
const STARTGG_CALLBACK_PATH = 'startgg-callback';
const LOCAL_AUTH_PORT = 18457;
const STARTGG_SESSION_PARTITION = 'persist:startgg';

const store = new Store({ name: 'slippi-friends-startgg' });

const KEY_ACCESS = 'sgg_access';
const KEY_REFRESH = 'sgg_refresh';
const KEY_EXPIRES_AT = 'sgg_expires_at';
const KEY_USER_ID = 'sgg_user_id';
const KEY_DISPLAY_NAME = 'sgg_display_name';
const KEY_WEB_COOKIES = 'sgg_web_cookies';

// ---------------------------------------------------------------------------
// Encrypted storage helpers
// ---------------------------------------------------------------------------

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptAndStore(key: string, value: string): void {
  if (canEncrypt()) {
    const buf = safeStorage.encryptString(value);
    store.set(key, buf.toString('base64'));
    store.set(`${key}__enc`, true);
  } else {
    store.set(key, value);
    store.set(`${key}__enc`, false);
  }
}

function decryptAndRead(key: string): string | null {
  const raw = store.get(key) as string | undefined;
  if (!raw) return null;
  const wasEncrypted = store.get(`${key}__enc`) as boolean | undefined;
  if (wasEncrypted && canEncrypt()) {
    try {
      const buf = Buffer.from(raw, 'base64');
      return safeStorage.decryptString(buf);
    } catch {
      store.delete(key);
      store.delete(`${key}__enc`);
      return null;
    }
  }
  return raw;
}

function clearStoredTokens(): void {
  for (const k of [KEY_ACCESS, KEY_REFRESH, KEY_EXPIRES_AT, KEY_USER_ID, KEY_DISPLAY_NAME, KEY_WEB_COOKIES]) {
    store.delete(k);
    store.delete(`${k}__enc`);
  }
}

// ---------------------------------------------------------------------------
// Edge function helpers
// ---------------------------------------------------------------------------

function edgeFunctionUrl(): string {
  const base = (process.env.SUPABASE_URL || SUPABASE_URL_FALLBACK).replace(/\/$/, '');
  return `${base}/functions/v1/startgg-oauth`;
}

function anonKey(): string {
  return process.env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_FALLBACK;
}

async function getSessionJwt(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (!session?.access_token) throw new Error('Not logged in to friendlies');

  const expiresAt = session.expires_at ?? 0;
  if (expiresAt * 1000 > Date.now() + 60_000) {
    return session.access_token;
  }

  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (error || !refreshed?.session?.access_token) {
    throw new Error('Supabase session expired and refresh failed');
  }
  return refreshed.session.access_token;
}

async function callEdgeFunction(body: Record<string, unknown>): Promise<any> {
  const jwt = await getSessionJwt();
  const url = edgeFunctionUrl();
  console.log('[startgg-auth] calling edge function:', url);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      apikey: anonKey(),
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log('[startgg-auth] edge function response:', res.status, text.slice(0, 500));

  if (!res.ok) {
    let errMsg = `Edge function HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) errMsg = parsed.error;
      if (parsed.msg) errMsg = parsed.msg;
    } catch {}
    throw new Error(errMsg);
  }

  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Localhost callback server
// ---------------------------------------------------------------------------

const CALLBACK_SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>friendlies</title></head>
<body style="background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center">
<h2 style="color:#21BA45;margin-bottom:8px">&#10003; start.gg linked</h2>
<p style="color:#888;font-size:14px">You can close this tab and return to friendlies.</p>
</div></body></html>`;

const CALLBACK_ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>friendlies</title></head>
<body style="background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center">
<h2 style="color:#f87171;margin-bottom:8px">Link failed</h2>
<p style="color:#888;font-size:14px">${msg.replace(/</g, '&lt;')}</p>
<p style="color:#555;font-size:12px;margin-top:16px">Close this tab and try again from the Cashbox tab.</p>
</div></body></html>`;

let _callbackServer: Server | null = null;

// ---------------------------------------------------------------------------
// Session cookie management
// ---------------------------------------------------------------------------

function getStartGgSession(): Electron.Session {
  return electronSession.fromPartition(STARTGG_SESSION_PARTITION);
}

/**
 * Make an HTTP request through Chromium's networking stack using the
 * persist:startgg session. This goes through the same path as the start.gg
 * web UI, using real browser cookies and avoiding CDN caching issues that
 * plague Node's fetch.
 */
export function startGgSessionFetch(url: string, init?: RequestInit): Promise<Response> {
  const ses = getStartGgSession();
  return ses.fetch(url, init as any);
}

async function extractAndStoreSessionCookies(): Promise<void> {
  try {
    const ses = getStartGgSession();
    const cookies = await ses.cookies.get({ domain: '.start.gg' });
    const general = await ses.cookies.get({ domain: 'start.gg' });
    const www = await ses.cookies.get({ domain: 'www.start.gg' });
    const all = [...cookies, ...general, ...www];

    const seen = new Set<string>();
    const parts: string[] = [];
    for (const c of all) {
      const key = `${c.name}=${c.domain}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(`${c.name}=${c.value}`);
    }
    const cookieStr = parts.join('; ');
    if (cookieStr) {
      encryptAndStore(KEY_WEB_COOKIES, cookieStr);
      console.log(`[startgg-auth] stored ${parts.length} session cookies`);
    } else {
      console.warn('[startgg-auth] no session cookies found after auth');
    }
  } catch (e) {
    console.error('[startgg-auth] cookie extraction failed:', e);
  }
}

/** Returns stored www session cookies, or null. */
export function getStartGgWebCookies(): string | null {
  return decryptAndRead(KEY_WEB_COOKIES);
}

/** Re-extract cookies from the persisted session partition. */
export async function refreshStartGgWebCookies(): Promise<void> {
  await extractAndStoreSessionCookies();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getStartGgClientId(): string | null {
  return process.env.STARTGG_CLIENT_ID?.trim() || null;
}

function redirectUri(): string {
  return `http://localhost:${LOCAL_AUTH_PORT}/${STARTGG_CALLBACK_PATH}`;
}

/**
 * Start the start.gg OAuth flow using an in-app BrowserWindow.
 * The user logs into start.gg inside the window, which captures both:
 * - The OAuth authorization code (exchanged for API tokens)
 * - The www.start.gg session cookies (used for REST task mutations)
 * The persist:startgg partition saves the session across app restarts.
 */
export function startStartGgAuth(): Promise<void> {
  const clientId = getStartGgClientId();
  if (!clientId) return Promise.reject(new Error('STARTGG_CLIENT_ID not set in environment'));

  return new Promise((resolve, reject) => {
    if (_callbackServer) {
      try { _callbackServer.close(); } catch {}
      _callbackServer = null;
    }

    const ses = getStartGgSession();

    const win = new BrowserWindow({
      width: 620,
      height: 720,
      title: 'Connect start.gg',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: ses,
      },
    });

    let settled = false;

    function finish(err?: Error) {
      if (settled) return;
      settled = true;
      try { win.close(); } catch {}
      cleanupServer();
      if (err) reject(err);
      else resolve();
    }

    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith(`/${STARTGG_CALLBACK_PATH}`)) {
        res.writeHead(404);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://localhost:${LOCAL_AUTH_PORT}`);
      const code = url.searchParams.get('code');

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(CALLBACK_ERROR_HTML('No authorization code received from start.gg.'));
        finish(new Error('No authorization code in start.gg callback'));
        return;
      }

      try {
        await exchangeCodeForTokens(code);
        await extractAndStoreSessionCookies();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(CALLBACK_SUCCESS_HTML);
        finish();
      } catch (e: any) {
        const msg = e?.message || 'Token exchange failed';
        console.error('[startgg-auth] exchange failed:', msg);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(CALLBACK_ERROR_HTML(msg));
        finish(e);
      }
    });

    _callbackServer = server;

    function cleanupServer() {
      setTimeout(() => {
        try { server.close(); } catch {}
        _callbackServer = null;
      }, 1000);
    }

    server.listen(LOCAL_AUTH_PORT, '127.0.0.1', () => {
      console.log(`[startgg-auth] callback server on port ${LOCAL_AUTH_PORT}`);
      const u = new URL('https://start.gg/oauth/authorize');
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('client_id', clientId!);
      u.searchParams.set('scope', STARTGG_OAUTH_SCOPE);
      u.searchParams.set('redirect_uri', redirectUri());
      win.loadURL(u.toString());
    });

    server.on('error', (err) => {
      console.error('[startgg-auth] server error:', err);
      finish(err);
    });

    win.on('closed', () => {
      if (!settled) {
        cleanupServer();
        settled = true;
        reject(new Error('start.gg auth window closed'));
      }
    });

    setTimeout(() => {
      finish(new Error('start.gg auth timed out (5 minutes)'));
    }, 300_000);
  });
}

async function exchangeCodeForTokens(code: string): Promise<void> {
  console.log('[startgg-auth] exchanging code via edge function');
  const data = await callEdgeFunction({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    scope: STARTGG_OAUTH_SCOPE,
  });

  if (data?.error) throw new Error(data.error);
  if (!data?.access_token) throw new Error('No access_token in response');

  storeTokens(data);
  console.log('[startgg-auth] linked, user_id:', data.startgg_user_id ?? '(unknown)');
}

/** Handle a deep-link callback (fallback path if protocol handler works). */
export async function handleStartGgCallback(url: string): Promise<void> {
  let code: string | null = null;
  try {
    const parsed = new URL(url);
    code = parsed.searchParams.get('code');
  } catch {}
  if (!code) {
    const qIdx = url.indexOf('?');
    if (qIdx !== -1) {
      const params = new URLSearchParams(url.slice(qIdx + 1));
      code = params.get('code');
    }
  }
  if (!code) throw new Error('No authorization code in start.gg callback');
  await exchangeCodeForTokens(code);
}

function storeTokens(data: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  startgg_user_id?: string;
  startgg_display_name?: string;
}): void {
  encryptAndStore(KEY_ACCESS, data.access_token);
  if (data.refresh_token) encryptAndStore(KEY_REFRESH, data.refresh_token);
  if (data.expires_in) {
    const expiresAt = Date.now() + data.expires_in * 1000;
    store.set(KEY_EXPIRES_AT, expiresAt);
  }
  if (data.startgg_user_id) store.set(KEY_USER_ID, data.startgg_user_id);
  if (data.startgg_display_name) store.set(KEY_DISPLAY_NAME, data.startgg_display_name);
}

async function refreshTokens(): Promise<boolean> {
  const rt = decryptAndRead(KEY_REFRESH);
  if (!rt) return false;

  try {
    const data = await callEdgeFunction({
      grant_type: 'refresh_token',
      refresh_token: rt,
      redirect_uri: redirectUri(),
      scope: STARTGG_OAUTH_SCOPE,
    });

    if (!data || data.error) {
      console.error('[startgg-auth] refresh failed:', data?.error);
      return false;
    }
    storeTokens(data);
    return true;
  } catch (e) {
    console.error('[startgg-auth] refresh error', e);
    return false;
  }
}

/**
 * Returns a valid start.gg user access token, refreshing if needed.
 * Returns null if not connected or refresh fails.
 */
export async function getStartGgUserToken(): Promise<string | null> {
  const at = decryptAndRead(KEY_ACCESS);
  if (!at) return null;

  const expiresAt = store.get(KEY_EXPIRES_AT) as number | undefined;
  const bufferMs = 60_000;
  if (expiresAt && Date.now() > expiresAt - bufferMs) {
    const ok = await refreshTokens();
    if (!ok) return null;
    return decryptAndRead(KEY_ACCESS);
  }
  return at;
}

export async function disconnectStartGg(): Promise<void> {
  clearStoredTokens();
  try {
    const ses = getStartGgSession();
    await ses.clearStorageData();
  } catch {}
  try {
    const user = await getCurrentUser();
    if (user) {
      await supabase
        .from('profiles')
        .update({ startgg_user_id: null })
        .eq('id', user.id);
    }
  } catch (e) {
    console.error('[startgg-auth] disconnect profile update failed', e);
  }
}

export function isStartGgConnected(): boolean {
  return !!decryptAndRead(KEY_ACCESS);
}

export function getStartGgUserInfo(): { userId: string | null; displayName: string | null } {
  return {
    userId: (store.get(KEY_USER_ID) as string) || null,
    displayName: (store.get(KEY_DISPLAY_NAME) as string) || null,
  };
}
