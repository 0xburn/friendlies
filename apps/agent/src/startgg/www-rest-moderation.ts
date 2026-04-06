import { getStartGgToken, startGgGraphql } from './client';

const WWW_ORIGIN = 'https://www.start.gg';

type SessionFetcher = (url: string, init?: RequestInit) => Promise<Response>;
let _sessionFetcher: SessionFetcher | null = null;

export function setStartGgSessionFetcher(fn: SessionFetcher): void {
  _sessionFetcher = fn;
  console.log('[startgg rest] sessionFetcher registered:', !!fn);
}

type UserTokenProvider = () => Promise<string | null>;
let _userTokenProvider: UserTokenProvider | null = null;

export function setStartGgUserTokenProvider(fn: UserTokenProvider): void {
  _userTokenProvider = fn;
}

let _cachedUserToken: string | null = null;

async function resolveUserToken(): Promise<string | null> {
  if (!_userTokenProvider) return null;
  try {
    _cachedUserToken = await _userTokenProvider();
  } catch {
    _cachedUserToken = null;
  }
  return _cachedUserToken;
}

type WebCookieProvider = () => string | null;
let _webCookieProvider: WebCookieProvider | null = null;

export function setStartGgWebCookieProvider(fn: WebCookieProvider): void {
  _webCookieProvider = fn;
}

type CookieRefresher = () => Promise<void>;
let _cookieRefresher: CookieRefresher | null = null;

export function setStartGgCookieRefresher(fn: CookieRefresher): void {
  _cookieRefresher = fn;
}

async function wwwRestHeaders(skipCookies = false): Promise<Record<string, string>> {
  const h: Record<string, string> = {
    Accept: '*/*',
    'Content-Type': 'application/json',
    'client-version': process.env.START_GG_CLIENT_VERSION?.trim() || '20',
    'x-web-source': 'gg-web-rest',
    Origin: WWW_ORIGIN,
  };

  if (!skipCookies) {
    const webCookies = _webCookieProvider?.() ?? null;
    const envCookie = process.env.START_GG_WEB_COOKIE?.trim();
    if (webCookies) {
      h.Cookie = webCookies;
    } else if (envCookie) {
      h.Cookie = envCookie;
    }
  }

  // OAuth Bearer token as fallback (works for GraphQL, not REST mutations)
  const userToken = await resolveUserToken();
  if (userToken) {
    h.Authorization = `Bearer ${userToken}`;
  } else {
    const devToken = getStartGgToken();
    if (devToken) h.Authorization = `Bearer ${devToken}`;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Raw set task — full task data including metadata for the task-driven flow
// ---------------------------------------------------------------------------

export type RawSetTask = {
  id: number;
  entrantId: number;
  siblingId: number;
  setId: number;
  /** 1=checkin, 2=lobby, 3=report, 4=verify/end, 7=gameSetup */
  type: number;
  taskOrder: number;
  isCompleted: boolean;
  active: boolean;
  metadata: Record<string, unknown>;
  updatedAt: number;
  updatedAtMicro: number;
  /** Full raw object — send this (with modifications) back to complete/update endpoints. */
  _raw: Record<string, unknown>;
};

function parseRawTask(raw: Record<string, unknown>): RawSetTask | null {
  const id = raw.id;
  if (id == null) return null;
  return {
    id: Number(id),
    entrantId: Number(raw.entrantId ?? 0),
    siblingId: Number(raw.siblingId ?? 0),
    setId: Number(raw.setId ?? 0),
    type: Number(raw.type ?? 0),
    taskOrder: Number(raw.taskOrder ?? 0),
    isCompleted: !!raw.isCompleted,
    active: raw.active !== false,
    metadata: (raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}) as Record<string, unknown>,
    updatedAt: Number(raw.updatedAt ?? 0),
    updatedAtMicro: Number(raw.updatedAtMicro ?? raw.updatedAt ?? 0),
    _raw: { ...raw },
  };
}

function collectRawTasks(taskMap: unknown): RawSetTask[] {
  if (!taskMap || typeof taskMap !== 'object') return [];
  const items = Array.isArray(taskMap) ? taskMap : Object.values(taskMap);
  const out: RawSetTask[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const t = parseRawTask(raw as Record<string, unknown>);
    if (t) out.push(t);
  }
  return out;
}

/**
 * Recursively search an object tree for entity maps that contain task-shaped objects.
 * The REST API may nest them under `entities.setTask`, `entities.Task`, or other paths.
 */
function harvestTasksFromObject(obj: unknown, depth: number, out: RawSetTask[]): void {
  if (depth > 4 || !obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  for (const [key, val] of Object.entries(o)) {
    if (!val || typeof val !== 'object') continue;
    const lower = key.toLowerCase();
    if (lower.includes('task')) {
      out.push(...collectRawTasks(val));
    }
    if (depth < 2 && (lower === 'entities' || lower === 'result')) {
      harvestTasksFromObject(val, depth + 1, out);
    }
  }
}

function extractRawSetTasksFromPayload(payload: unknown, setId: number): RawSetTask[] {
  if (!payload || typeof payload !== 'object') return [];
  let all: RawSetTask[] = [];
  harvestTasksFromObject(payload, 0, all);

  const seen = new Set<number>();
  all = all.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  if (setId) {
    const scoped = all.filter((t) => t.setId === setId);
    if (scoped.length > 0) all = scoped;
  }
  all.sort((a, b) => a.taskOrder - b.taskOrder || a.id - b.id);
  return all;
}

// ---------------------------------------------------------------------------
// Legacy simplified moderation task (kept for backward compat)
// ---------------------------------------------------------------------------

export type CashboxModerationTask = {
  id: string;
  title: string;
  stateLabel: string;
  complete: boolean;
  order: number;
  setId: string | null;
};

const TASK_TYPE_LABELS: Record<number, string> = {
  1: 'Check in',
  2: 'Game lobby',
  3: 'Report game',
  4: 'Result verification',
  7: 'Game setup',
};

function legacyTaskFromRaw(t: RawSetTask): CashboxModerationTask {
  const gameNum = typeof t.metadata.gameNum === 'number' ? t.metadata.gameNum : null;
  let title = TASK_TYPE_LABELS[t.type] ?? `Step ${t.taskOrder}`;
  if (gameNum != null && (t.type === 7 || t.type === 3)) title += ` ${gameNum}`;
  return {
    id: String(t.id),
    title,
    stateLabel: t.isCompleted ? 'Complete' : t.active ? 'Active' : 'Pending',
    complete: t.isCompleted,
    order: t.taskOrder,
    setId: t.setId ? String(t.setId) : null,
  };
}

export function extractModerationTasksFromPhaseGroupPayload(payload: unknown, setId: string): CashboxModerationTask[] {
  const raw = extractRawSetTasksFromPayload(payload, Number(setId) || 0);
  return raw.map(legacyTaskFromRaw);
}

// ---------------------------------------------------------------------------
// Fetch phase group data (REST)
// ---------------------------------------------------------------------------

export async function fetchPhaseGroupRestJson(phaseGroupId: string): Promise<unknown | null> {
  const expand = encodeURIComponent(JSON.stringify(['sets', 'seeds', 'standings', 'setTask']));
  const mutations = encodeURIComponent(JSON.stringify(['playerData', 'ffaData']));
  const cacheBust = Date.now();
  const url = `${WWW_ORIGIN}/api/-/rest/phase_group/${phaseGroupId}?id=${encodeURIComponent(phaseGroupId)}&expand=${expand}&mutations=${mutations}&_=${cacheBust}`;

  try {
    const headers = await wwwRestHeaders(false);
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
    headers['Pragma'] = 'no-cache';
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) {
      console.warn('[startgg rest] phase_group HTTP', res.status, await res.text().catch(() => ''));
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('[startgg rest] phase_group', e);
    return null;
  }
}

/**
 * Fetch set tasks via the non-admin set endpoint.
 * Always uses Node.js fetch() with explicit cookies — NOT session.fetch() —
 * to avoid Chromium's HTTP cache layer on top of the server-side staleness.
 */
async function fetchSetRestJson(setId: string): Promise<unknown | null> {
  const expand = encodeURIComponent(JSON.stringify(['setTask']));
  const cacheBust = Date.now();
  const url = `${WWW_ORIGIN}/api/-/rest/set/${setId}?id=${setId}&expand=${expand}&_=${cacheBust}`;
  try {
    const headers = await wwwRestHeaders(false);
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
    headers['Pragma'] = 'no-cache';
    const res = await fetch(url, { method: 'GET', headers });
    const cfCache = res.headers.get('cf-cache-status') ?? '?';
    if (!res.ok) {
      console.warn('[startgg rest] set HTTP', res.status, `cf=${cfCache}`, await res.text().catch(() => ''));
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('[startgg rest] set fetch', e);
    return null;
  }
}

const _lastKnownMicro = new Map<string, number>();

export function resetLastKnownMicro(setId: string): void {
  _lastKnownMicro.delete(setId);
}

// In-flight dedup: only one GET per setId at a time
const _inflightGet = new Map<string, Promise<unknown | null>>();

function buildTaskSummary(tasks: RawSetTask[]): string {
  const active = tasks.filter((t) => !t.isCompleted && t.active);
  if (active.length === 0) return '';
  return active.map((t) => {
    const m = t.metadata;
    const parts = [`id=${t.id}`, `e=${t.entrantId}`, `t=${t.type}`, `micro=${t.updatedAtMicro}`];
    if (t.type === 7) {
      const chars = Object.keys(m.charSelections ?? {}).length;
      const strikes = ((m.strikeStages ?? []) as unknown[]).length;
      const struck = Object.keys(m.strikeList ?? {}).length;
      const bans = ((m.banStages ?? []) as unknown[]).length;
      const banList = Object.keys(m.banList ?? (Array.isArray(m.banList) ? {} : {})).length;
      const turn = Object.keys(m.turn ?? {}).filter((k) => (m.turn as any)[k]).join(',');
      const action = (t._raw as any).action ?? '?';
      parts.push(`action=${action} chars=${chars} strikes=${strikes} struck=${struck} bans=${bans} banList=${banList} turn=[${turn}]`);
    }
    return parts.join(' ');
  }).join(' | ');
}

let _lastLoggedSummary = '';

function logActiveTasks(tasks: RawSetTask[]): void {
  const summary = buildTaskSummary(tasks);
  if (!summary || summary === _lastLoggedSummary) return;
  _lastLoggedSummary = summary;
  console.log(`[startgg rest] active tasks: ${summary}`);
}

/**
 * Fetch tasks by polling admin/set directly with changedAfter.
 * admin/phase_group is NOT used here — HAR analysis showed it returns
 * {"actionRecords":[]} even when tasks have changed (it only tracks
 * set-level changes like scores/winners, not individual task mutations).
 */
export async function fetchRawSetTasks(
  _phaseGroupId: string,
  setId: string,
  forceFresh = false,
): Promise<{ ok: true; tasks: RawSetTask[] } | { ok: false; message: string }> {
  const numericSetId = Number(setId) || 0;
  const t0 = Date.now();

  // Deduplicate: if a GET for this setId is already in flight, reuse it
  let setPayload: unknown | null;
  const existing = _inflightGet.get(setId);
  if (existing && !forceFresh) {
    setPayload = await existing;
  } else {
    const p = fetchSetRestJson(setId);
    _inflightGet.set(setId, p);
    try { setPayload = await p; } finally { _inflightGet.delete(setId); }
  }

  let tasks: RawSetTask[] = [];
  if (setPayload) {
    tasks = extractRawSetTasksFromPayload(setPayload, numericSetId);
    if (tasks.length === 0) tasks = extractRawSetTasksFromPayload(setPayload, 0);
    console.log(`[startgg rest] set ${setId}: tasks=${tasks.length} (${Date.now() - t0}ms)`);
  }

  if (tasks.length === 0) {
    return { ok: false, message: 'No tasks found for this set. The bracket may not have started, or tasks require a start.gg session.' };
  }

  logActiveTasks(tasks);
  return { ok: true, tasks };
}

// ---------------------------------------------------------------------------
// Task mutations (complete / update)
// ---------------------------------------------------------------------------

function parseTaskMutationResponse(
  json: unknown,
): { ok: true; tasks: RawSetTask[] } | { ok: false; message: string } {
  if (!json || typeof json !== 'object') return { ok: true, tasks: [] };
  const j = json as Record<string, unknown>;
  if (j.success === false || j.message === 'Login is required') {
    return { ok: false, message: String(j.message || 'Request failed') };
  }
  const tasks = extractRawSetTasksFromPayload(json, 0);
  const topKeys = Object.keys(j).join(',');
  console.log(`[startgg rest] PUT response: topKeys=[${topKeys}] extractedTasks=${tasks.length}`);
  return { ok: true, tasks };
}

async function putTaskWithRetry(
  url: string,
  body: Record<string, unknown>,
  label: string,
): Promise<{ ok: boolean; tasks?: RawSetTask[]; message?: string; status?: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const useSession = !!_sessionFetcher;
      const headers = await wwwRestHeaders(useSession);
      if (attempt === 0) {
        console.log(`[startgg rest] PUT ${label} auth:${headers.Authorization?.slice(0, 20) || '(none)'} cookie:${useSession ? 'session' : headers.Cookie ? 'yes' : 'no'}`);
      }
      const doFetch = _sessionFetcher ?? fetch;
      const res = await doFetch(url, { method: 'PUT', headers, body: JSON.stringify(body), cache: 'no-store' as RequestCache });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.warn(`[startgg rest] ${label} HTTP`, res.status, txt.slice(0, 200));
        return { ok: false, message: txt.slice(0, 400) || `HTTP ${res.status}`, status: res.status };
      }
      const json = await res.json().catch(() => null);
      const result = parseTaskMutationResponse(json);
      if (!result.ok && result.message === 'Login is required' && attempt === 0 && _cookieRefresher) {
        console.log('[startgg rest] session expired, refreshing cookies and retrying…');
        await _cookieRefresher();
        continue;
      }
      if (!result.ok) console.warn(`[startgg rest] ${label} rejected:`, result.message);
      if (result.ok && result.tasks.length > 0) {
        for (const t of result.tasks) {
          const sid = String(t.setId);
          const prev = _lastKnownMicro.get(sid) ?? 0;
          if (t.updatedAtMicro > prev) _lastKnownMicro.set(sid, t.updatedAtMicro);
        }
      }
      return result;
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Network error' };
    }
  }
  return { ok: false, message: 'Login is required (retry exhausted)' };
}

export async function completeStartGgTask(
  taskId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; tasks?: RawSetTask[]; message?: string; status?: number }> {
  if (!/^\d+$/.test(taskId)) return { ok: false, message: 'Invalid task id' };
  return putTaskWithRetry(`${WWW_ORIGIN}/api/-/rest/task/${taskId}/complete`, body, `complete ${taskId}`);
}

export async function updateStartGgTask(
  taskId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; tasks?: RawSetTask[]; message?: string; status?: number }> {
  if (!/^\d+$/.test(taskId)) return { ok: false, message: 'Invalid task id' };
  return putTaskWithRetry(`${WWW_ORIGIN}/api/-/rest/task/${taskId}/update`, body, `update ${taskId}`);
}

/** Backward-compat wrapper that sends an empty body. */
export async function completeStartGgModerationTask(
  taskId: string,
): Promise<{ ok: boolean; message?: string; status?: number }> {
  return completeStartGgTask(taskId, {});
}

// ---------------------------------------------------------------------------
// GraphQL change-detection (polls api.start.gg — different service/cache)
// ---------------------------------------------------------------------------

const SET_UPDATED_AT_QUERY = `
query SetUpdatedAt($setId: ID!) {
  set(id: $setId) {
    state
    updatedAt
  }
}`.trim();

export async function fetchSetUpdatedAt(
  setId: string,
): Promise<{ ok: true; state: number; updatedAt: number } | { ok: false; message: string }> {
  const r = await startGgGraphql<{ set: { state: number; updatedAt: number } | null }>(
    SET_UPDATED_AT_QUERY,
    { setId },
    'SetUpdatedAt',
  );
  if (r.errors?.length) {
    return { ok: false, message: r.errors[0].message };
  }
  if (!r.data?.set) {
    return { ok: false, message: 'Set not found' };
  }
  return { ok: true, state: r.data.set.state, updatedAt: r.data.set.updatedAt };
}
