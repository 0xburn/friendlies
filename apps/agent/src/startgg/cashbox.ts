import entrantMapJson from './cashbox-entrant-map.json';
import opponentSlippiMapJson from './cashbox-opponent-slippi-map.json';
import { normalizeSlippiConnectCode } from '../connect-code-normalize';
import { getStartGgToken, startGgGraphql } from './client';
import {
  extractModerationTasksFromPhaseGroupPayload,
  fetchPhaseGroupRestJson,
  setStartGgUserTokenProvider,
  setStartGgWebCookieProvider,
  setStartGgCookieRefresher,
  setStartGgSessionFetcher,
  setStartGgSessionReAuthenticator,
  type CashboxModerationTask,
} from './www-rest-moderation';
import { getStartGgUserToken, getStartGgWebCookies, refreshStartGgWebCookies, startGgSessionFetch, reLoginStartGgSession, getStartGgUserInfo } from '../startgg-auth';
import { supabase } from '../supabase';
import { getCurrentUser } from '../auth';
import { cashboxLog } from '../logger';

setStartGgUserTokenProvider(getStartGgUserToken);
setStartGgWebCookieProvider(getStartGgWebCookies);
setStartGgCookieRefresher(refreshStartGgWebCookies);
setStartGgSessionFetcher(startGgSessionFetch);
setStartGgSessionReAuthenticator(reLoginStartGgSession);

/** Public tournament slug on start.gg (safe to commit). */
export const CASHBOX_TOURNAMENT_SLUG = 'the-cashbox-21';

/**
 * Pinned event for Start.gg integration testing. Set to null for production Cashbox
 * (then use START_GG_CASHBOX_EVENT_SLUG / _EVENT_ID or auto-detect from tournament).
 */
const CASHBOX_DEV_EVENT_SLUG: string | null = null;

/** Your Slippi connect code → how we find YOUR start.gg entrant for this event (raw entrant id, user:slug, or participant:id).
 *  Unrelated to anonymous check-in: if you are not in this map, the tab cannot load your bracket row at all. */
const ENTRANT_MAP = entrantMapJson as Record<string, string>;

function normalizeBracketGamerTag(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Opponent bracket display tag (normalized) → Slippi code for invites / friendlies enrichment.
 *  start.gg often shows gamer tags, not Slippi; anonymous entrants may not expose a stable public profile—add a row
 *  per tag you care about (TO-maintained until we have an automated source). */
const OPPONENT_SLIPPI_MAP: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(opponentSlippiMapJson as Record<string, string>)) {
    out[normalizeBracketGamerTag(k)] = String(v).trim();
  }
  return out;
})();

function normalizeConnectCode(code: string): string {
  return normalizeSlippiConnectCode(code);
}

/** Raw map value: entrant GraphQL id, or `user:SLUG`, or `participant:ID` (see cashbox-entrant-map.json). */
function mapValueForConnectCode(code: string): string | null {
  const n = normalizeConnectCode(code);
  const u = n.toUpperCase();
  const raw = ENTRANT_MAP[u] ?? ENTRANT_MAP[n];
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v || null;
}

function parseUserSlugFromMapValue(rest: string): string {
  const t = rest.trim();
  const fromUrl = t.match(/start\.gg\/user\/([a-zA-Z0-9_-]+)/i);
  if (fromUrl) return fromUrl[1];
  return t.replace(/^user\//i, '').trim();
}

async function resolveStartGgUserId(slug: string, userToken?: string | null): Promise<string | null> {
  const q = `
query CashboxUserBySlug($slug: String!) {
  user(slug: $slug) { id }
}`.trim();
  for (const s of [slug.startsWith('user/') ? slug : `user/${slug}`, slug]) {
    const r = await startGgGraphql<{ user: { id: string } | null }>(q, { slug: s }, 'CashboxUserBySlug', userToken);
    if (r.errors?.length) continue;
    const id = r.data?.user?.id;
    if (id) return id;
  }
  return null;
}

const PARTICIPANTS_PAGE_Q = `
query CashboxParticipantPage($slug: String!, $page: Int!, $perPage: Int!) {
  tournament(slug: $slug) {
    participants(query: { page: $page, perPage: $perPage }) {
      pageInfo { totalPages }
      nodes {
        user { id }
        entrants { id event { id } }
      }
    }
  }
}`.trim();

const _entrantCache = new Map<string, { entrantId: string; ts: number }>();
const ENTRANT_CACHE_TTL = 120_000;

type EntrantLookupResult = { found: true; id: string } | { found: false; rateLimited: boolean };

async function entrantIdForUserInEvent(
  userId: string,
  tournamentSlug: string,
  eventId: string,
  userToken?: string | null,
): Promise<EntrantLookupResult> {
  const cacheKey = `${userId}:${tournamentSlug}:${eventId}`;
  const cached = _entrantCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ENTRANT_CACHE_TTL) {
    return { found: true, id: cached.entrantId };
  }

  let page = 1;
  let totalPages = 1;
  const targetEvent = String(eventId);
  while (page <= totalPages && page <= 40) {
    const r = await startGgGraphql<{ tournament: any }>(
      PARTICIPANTS_PAGE_Q,
      { slug: tournamentSlug, page, perPage: 200 },
      'CashboxParticipantPage',
      userToken,
    );
    if (r.errors?.length || !r.data?.tournament?.participants) {
      const isRateLimit = r.errors?.some((e) => /rate.?limit/i.test(e.message)) ?? false;
      console.warn('[cashbox] entrantIdForUserInEvent failed at page', page, isRateLimit ? '(RATE LIMITED)' : '', 'errors:', r.errors);
      cashboxLog.warn('entrantIdForUserInEvent failed at page', page, isRateLimit ? '(RATE LIMITED)' : '', 'errors:', r.errors);
      return { found: false, rateLimited: isRateLimit };
    }
    const pg = r.data.tournament.participants;
    totalPages = pg.pageInfo?.totalPages ?? 1;
    for (const node of pg.nodes ?? []) {
      if (String(node?.user?.id) !== String(userId)) continue;
      for (const ent of node.entrants ?? []) {
        if (String(ent?.event?.id) === targetEvent && ent?.id) {
          const id = String(ent.id);
          _entrantCache.set(cacheKey, { entrantId: id, ts: Date.now() });
          return { found: true, id };
        }
      }
    }
    page++;
  }
  console.warn('[cashbox] entrantIdForUserInEvent: user', userId, 'not found in', tournamentSlug, 'event', eventId, '(scanned', page - 1, 'pages)');
  cashboxLog.warn('entrantIdForUserInEvent: user', userId, 'not found in', tournamentSlug, 'event', eventId, '(scanned', page - 1, 'pages)');
  return { found: false, rateLimited: false };
}

const PARTICIPANT_ENTRANTS_Q = `
query CashboxParticipantEntrants($id: ID!) {
  participant(id: $id) {
    id
    entrants { id event { id } }
  }
}`.trim();

async function entrantIdFromParticipantMap(participantId: string, eventId: string, userToken?: string | null): Promise<string | null> {
  const r = await startGgGraphql<{ participant: any }>(
    PARTICIPANT_ENTRANTS_Q,
    { id: participantId.trim() },
    'CashboxParticipantEntrants',
    userToken,
  );
  if (r.errors?.length || !r.data?.participant) return null;
  const targetEvent = String(eventId);
  for (const ent of r.data.participant.entrants ?? []) {
    if (String(ent?.event?.id) === targetEvent && ent?.id) return String(ent.id);
  }
  return null;
}

/**
 * Map entry → entrant id for this event.
 * - Plain string: Start.gg entrant GraphQL id for the Cashbox event.
 * - user:760514b0 or user:https://www.start.gg/user/760514b0 — account slug; we scan tournament participants.
 * - participant:21238161 — attendee id from /attendee/21238161.
 */
async function resolveMapValueToEntrantId(
  raw: string,
  tournamentSlug: string,
  eventId: string,
  userToken?: string | null,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('user:')) {
    const slug = parseUserSlugFromMapValue(trimmed.slice(5));
    if (!slug) {
      return { ok: false, message: 'Invalid user: value in entrant map.' };
    }
    const userId = await resolveStartGgUserId(slug, userToken);
    if (!userId) {
      return { ok: false, message: `No start.gg user found for slug "${slug}".` };
    }
    const result = await entrantIdForUserInEvent(userId, tournamentSlug, eventId, userToken);
    if (!result.found) {
      return {
        ok: false,
        message: result.rateLimited
          ? 'start.gg rate limit — try again in a minute.'
          : `User is not registered in "${tournamentSlug}" for this event (or bracket not created yet).`,
      };
    }
    return { ok: true, id: result.id };
  }

  if (lower.startsWith('participant:')) {
    const pid = trimmed.slice('participant:'.length).trim();
    const eid = await entrantIdFromParticipantMap(pid, eventId, userToken);
    if (!eid) {
      return {
        ok: false,
        message: `Participant ${pid} has no entrant for this event (wrong attendee id or event).`,
      };
    }
    return { ok: true, id: eid };
  }

  if (lower.startsWith('entrant:')) {
    return { ok: true, id: trimmed.slice('entrant:'.length).trim() };
  }

  return { ok: true, id: trimmed };
}

/**
 * Read startgg_user_id from the current user's profile row (set during OAuth link).
 * Returns the start.gg numeric user id, or null if not linked.
 */
async function resolveStartGgUserIdFromProfile(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    if (!user) { console.log('[cashbox] resolveStartGgUserIdFromProfile: no current user'); cashboxLog.info('resolveStartGgUserIdFromProfile: no current user'); return null; }
    const { data, error } = await supabase
      .from('profiles')
      .select('startgg_user_id')
      .eq('id', user.id)
      .maybeSingle();
    if (error) { console.warn('[cashbox] resolveStartGgUserIdFromProfile query error:', error.message); cashboxLog.warn('resolveStartGgUserIdFromProfile query error:', error.message); }
    console.log('[cashbox] resolveStartGgUserIdFromProfile:', { userId: user.id, startgg_user_id: data?.startgg_user_id ?? '(null)' });
    cashboxLog.info('resolveStartGgUserIdFromProfile:', { userId: user.id, startgg_user_id: data?.startgg_user_id ?? '(null)' });
    return data?.startgg_user_id || null;
  } catch (e: any) {
    console.error('[cashbox] resolveStartGgUserIdFromProfile exception:', e?.message);
    cashboxLog.error('resolveStartGgUserIdFromProfile exception:', e?.message);
    return null;
  }
}

function isMeleeEvent(ev: { name?: string | null; videogame?: { slug?: string | null; name?: string | null; displayName?: string | null } | null }): boolean {
  const g = ev.videogame;
  const blob = `${ev.name || ''} ${g?.slug || ''} ${g?.name || ''} ${g?.displayName || ''}`.toLowerCase();
  return blob.includes('melee');
}

/**
 * GraphQL sometimes returns tournament.slug as "tournament/foo" or with extra segments.
 * start.gg canonical URLs use a single segment: /tournament/foo/event/bar/...
 */
function normalizeStartGgTournamentSlug(slug: string): string {
  let s = String(slug || '').trim().replace(/^\/+/, '');
  if (s.toLowerCase().startsWith('tournament/')) {
    s = s.slice('tournament/'.length);
  }
  const slash = s.indexOf('/');
  if (slash >= 0) s = s.slice(0, slash);
  return s.trim() || String(slug || '').trim();
}

function bracketUrlFor(eventSlug: string, tournamentSlug: string): string {
  const s = (eventSlug || '').replace(/^\//, '');
  if (s.includes('/')) {
    return `https://www.start.gg/${s}/brackets`;
  }
  const t = normalizeStartGgTournamentSlug(tournamentSlug);
  return `https://www.start.gg/tournament/${t}/event/${s}/brackets`;
}

/** Event overview page — best effort for in-app iframe (may still be blocked by start.gg headers). */
function bracketEmbedUrlFor(eventSlug: string, tournamentSlug: string): string {
  const s = (eventSlug || '').replace(/^\//, '');
  if (s.includes('/')) {
    return `https://www.start.gg/${s}/overview`;
  }
  const t = normalizeStartGgTournamentSlug(tournamentSlug);
  return `https://www.start.gg/tournament/${t}/event/${s}/overview`;
}

/** Deep link to the set page (moderate / check-in UI on start.gg). */
function setPageUrlFor(tournamentSlug: string, eventSlug: string, setId: string): string {
  const raw = (eventSlug || '').replace(/^\//, '');
  const sid = encodeURIComponent(String(setId));
  if (raw.includes('/')) {
    const base = raw.replace(/\/+$/, '');
    return `https://www.start.gg/${base}/set/${sid}`;
  }
  const t = normalizeStartGgTournamentSlug(tournamentSlug);
  const ev = encodeURIComponent(raw);
  return `https://www.start.gg/tournament/${encodeURIComponent(t)}/event/${ev}/set/${sid}`;
}

/** Real Cashbox signup for giveaway eligibility (override with START_GG_CASHBOX_REGISTER_URL). */
export function cashboxGiveawayRegisterUrl(): string {
  const u = process.env.START_GG_CASHBOX_REGISTER_URL?.trim();
  const raw = u || 'tournament/the-cashbox-21/register';
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.replace(/^\/+/, '').replace(/^www\.start\.gg\/?/i, '');
  return `https://www.start.gg/${path}`;
}

type ResolvedEvent = {
  eventId: string;
  eventName: string;
  eventSlug: string;
  tournamentName: string;
  tournamentSlug: string;
  tournamentId: string;
};

let cachedResolved: ResolvedEvent | null = null;

async function resolveCashboxEvent(userToken?: string | null): Promise<{ ok: true; meta: ResolvedEvent } | { ok: false; message: string }> {
  const eventIdOverride = process.env.START_GG_CASHBOX_EVENT_ID?.trim();
  if (eventIdOverride) {
    const q = `
query CashboxEventById($id: ID!) {
  event(id: $id) {
    id
    name
    slug
    tournament { id name slug }
  }
}`.trim();
    const r = await startGgGraphql<{ event: any }>(q, { id: eventIdOverride }, 'CashboxEventById', userToken);
    if (r.errors?.length) {
      return { ok: false, message: r.errors.map((e) => e.message).join('; ') };
    }
    const ev = r.data?.event;
    if (!ev?.id) {
      return { ok: false, message: 'Event not found for START_GG_CASHBOX_EVENT_ID' };
    }
    const t = ev.tournament;
    const meta: ResolvedEvent = {
      eventId: ev.id,
      eventName: ev.name || 'Event',
      eventSlug: ev.slug || '',
      tournamentName: t?.name || '',
      tournamentSlug: t?.slug || CASHBOX_TOURNAMENT_SLUG,
      tournamentId: t?.id || '',
    };
    cachedResolved = meta;
    return { ok: true, meta };
  }

  const devSlug = CASHBOX_DEV_EVENT_SLUG?.trim();
  if (devSlug) {
    const q = `
query CashboxEventByDevSlug($slug: String!) {
  event(slug: $slug) {
    id
    name
    slug
    tournament { id name slug }
  }
}`.trim();
    const r = await startGgGraphql<{ event: any }>(q, { slug: devSlug }, 'CashboxEventByDevSlug', userToken);
    if (r.errors?.length) {
      return { ok: false, message: r.errors.map((e) => e.message).join('; ') };
    }
    const ev = r.data?.event;
    if (!ev?.id) {
      return { ok: false, message: `Event not found for dev slug "${devSlug}"` };
    }
    const t = ev.tournament;
    const meta: ResolvedEvent = {
      eventId: ev.id,
      eventName: ev.name || 'Event',
      eventSlug: ev.slug || devSlug,
      tournamentName: t?.name || '',
      tournamentSlug: t?.slug || CASHBOX_TOURNAMENT_SLUG,
      tournamentId: t?.id || '',
    };
    cachedResolved = meta;
    return { ok: true, meta };
  }

  const slugOverride = process.env.START_GG_CASHBOX_EVENT_SLUG?.trim();
  if (slugOverride) {
    const q = `
query CashboxEventBySlug($slug: String!) {
  event(slug: $slug) {
    id
    name
    slug
    tournament { id name slug }
  }
}`.trim();
    const r = await startGgGraphql<{ event: any }>(q, { slug: slugOverride }, 'CashboxEventBySlug', userToken);
    if (r.errors?.length) {
      return { ok: false, message: r.errors.map((e) => e.message).join('; ') };
    }
    const ev = r.data?.event;
    if (!ev?.id) {
      return { ok: false, message: 'Event not found for START_GG_CASHBOX_EVENT_SLUG' };
    }
    const t = ev.tournament;
    const meta: ResolvedEvent = {
      eventId: ev.id,
      eventName: ev.name || 'Event',
      eventSlug: ev.slug || slugOverride,
      tournamentName: t?.name || '',
      tournamentSlug: t?.slug || CASHBOX_TOURNAMENT_SLUG,
      tournamentId: t?.id || '',
    };
    cachedResolved = meta;
    return { ok: true, meta };
  }

  if (cachedResolved) {
    return { ok: true, meta: cachedResolved };
  }

  const q = `
query CashboxTournamentEvents($slug: String!) {
  tournament(slug: $slug) {
    id
    name
    slug
    events {
      id
      slug
      name
      videogame { id slug name displayName }
    }
  }
}`.trim();
  const r = await startGgGraphql<{ tournament: any }>(q, { slug: CASHBOX_TOURNAMENT_SLUG }, 'CashboxTournamentEvents', userToken);
  if (r.errors?.length) {
    return { ok: false, message: r.errors.map((e) => e.message).join('; ') };
  }
  const t = r.data?.tournament;
  if (!t?.events?.length) {
    return { ok: false, message: `No events on tournament "${CASHBOX_TOURNAMENT_SLUG}"` };
  }
  const melee = t.events.find((e: any) => isMeleeEvent(e));
  const ev = melee || t.events[0];
  const meta: ResolvedEvent = {
    eventId: ev.id,
    eventName: ev.name || 'Event',
    eventSlug: ev.slug || '',
    tournamentName: t.name || '',
    tournamentSlug: t.slug || CASHBOX_TOURNAMENT_SLUG,
    tournamentId: t.id || '',
  };
  cachedResolved = meta;
  return { ok: true, meta };
}

const SETS_QUERY = `
query CashboxEntrantSets($entrantId: ID!, $eventId: ID!, $page: Int!, $perPage: Int!) {
  entrant(id: $entrantId) {
    id
    name
    paginatedSets(
      page: $page
      perPage: $perPage
      sortType: CALL_ORDER
      filters: { eventIds: [$eventId], hideEmpty: true }
    ) {
      pageInfo { totalPages }
      nodes {
        id
        completedAt
        fullRoundText
        round
        winnerId
        totalGames
        displayScore(mainEntrantId: $entrantId)
        phaseGroup {
          id
          displayIdentifier
          phase {
            name
          }
        }
        slots(includeByes: false) {
          entrant { id name }
        }
      }
    }
  }
}`.trim();

async function fetchEntrantSets(
  entrantId: string,
  eventId: string,
  userToken?: string | null,
): Promise<{ ok: true; nodes: any[]; entrantName: string } | { ok: false; message: string }> {
  const nodes: any[] = [];
  let page = 1;
  let totalPages = 1;
  let entrantName = '';

  while (page <= totalPages && page <= 10) {
    const r = await startGgGraphql<{ entrant: any }>(
      SETS_QUERY,
      { entrantId, eventId, page, perPage: 25 },
      'CashboxEntrantSets',
      userToken,
    );
    if (r.errors?.length) {
      return { ok: false, message: r.errors.map((e) => e.message).join('; ') };
    }
    const ent = r.data?.entrant;
    if (!ent) {
      return page === 1
        ? { ok: false, message: 'Entrant not found on start.gg (check entrant id in map).' }
        : { ok: true, nodes, entrantName };
    }
    entrantName = ent.name || entrantName;
    const pg = ent.paginatedSets;
    totalPages = pg?.pageInfo?.totalPages ?? 1;
    const chunk = pg?.nodes ?? [];
    nodes.push(...chunk);
    page++;
  }

  return { ok: true, nodes, entrantName };
}

const PHASE_GROUP_POOL_Q = `
query CashboxPhaseGroupPool($pgId: ID!, $page: Int!, $perPage: Int!, $viewerEntrantId: ID!) {
  phaseGroup(id: $pgId) {
    id
    displayIdentifier
    phase {
      name
    }
    sets(page: $page, perPage: $perPage, sortType: STANDARD) {
      pageInfo {
        totalPages
      }
      nodes {
        id
        identifier
        round
        fullRoundText
        completedAt
        displayScore(mainEntrantId: $viewerEntrantId)
        slots(includeByes: false) {
          entrant { id name }
        }
      }
    }
  }
}`.trim();

export type CashboxPoolMatch = {
  setId: string;
  poolSpot: string | null;
  /** start.gg column header (e.g. Winners Semi-Final). */
  roundText: string;
  /** Bracket depth; negative typically means losers side. */
  round: number | null;
  scoreDisplay: string | null;
  completed: boolean;
  involvesViewer: boolean;
  sideLeft: { entrantId: string; name: string } | null;
  sideRight: { entrantId: string; name: string } | null;
};

export type CashboxPhasePool = {
  phaseGroupId: string;
  title: string;
  matches: CashboxPoolMatch[];
};

function mapPoolSetNode(n: any, viewerEntrantId: string): CashboxPoolMatch {
  const slots = Array.isArray(n?.slots) ? n.slots : [];
  const e0 = slots[0]?.entrant;
  const e1 = slots[1]?.entrant;
  const left = e0?.id
    ? { entrantId: String(e0.id), name: String(e0.name ?? 'Player') }
    : null;
  const right = e1?.id
    ? { entrantId: String(e1.id), name: String(e1.name ?? 'Player') }
    : null;
  const vid = String(viewerEntrantId);
  const involvesViewer =
    (e0?.id && String(e0.id) === vid) || (e1?.id && String(e1.id) === vid);
  return {
    setId: String(n.id),
    poolSpot: n.identifier != null && n.identifier !== '' ? String(n.identifier) : null,
    roundText: n.fullRoundText != null ? String(n.fullRoundText).trim() : '',
    round: typeof n.round === 'number' && !Number.isNaN(n.round) ? n.round : null,
    scoreDisplay: n.displayScore != null ? String(n.displayScore) : null,
    completed: !!n.completedAt,
    involvesViewer,
    sideLeft: left,
    sideRight: right,
  };
}

function pickAnchorSetForPhaseGroup(nodes: any[]): any | null {
  for (const n of nodes) {
    if (!n.completedAt && n.phaseGroup?.id) return n;
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i]?.phaseGroup?.id) return nodes[i];
  }
  return null;
}

async function fetchPhaseGroupPool(phaseGroupId: string, viewerEntrantId: string, userToken?: string | null): Promise<CashboxPhasePool | null> {
  const matches: CashboxPoolMatch[] = [];
  let titleParts: { phase?: string; group?: string } | null = null;
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 30) {
    const r = await startGgGraphql<{ phaseGroup: any }>(
      PHASE_GROUP_POOL_Q,
      { pgId: phaseGroupId, page, perPage: 48, viewerEntrantId },
      'CashboxPhaseGroupPool',
      userToken,
    );
    if (r.errors?.length || !r.data?.phaseGroup) {
      if (matches.length === 0) return null;
      break;
    }
    const pg = r.data.phaseGroup;
    if (!titleParts) {
      titleParts = {
        phase: pg.phase?.name != null ? String(pg.phase.name) : undefined,
        group: pg.displayIdentifier != null ? String(pg.displayIdentifier) : undefined,
      };
    }
    const conn = pg.sets;
    totalPages = conn?.pageInfo?.totalPages ?? 1;
    for (const n of conn?.nodes ?? []) {
      matches.push(mapPoolSetNode(n, viewerEntrantId));
    }
    page++;
  }

  const title = titleParts
    ? [titleParts.phase, titleParts.group].filter(Boolean).join(' · ') || 'Pool'
    : 'Pool';
  return matches.length > 0 ? { phaseGroupId, title, matches } : null;
}

function opponentNameForSet(selfEntrantId: string, set: any): string | null {
  const slots = set?.slots;
  if (!Array.isArray(slots)) return null;
  const names: string[] = [];
  for (const s of slots) {
    const e = s?.entrant;
    if (!e?.id || String(e.id) === String(selfEntrantId)) continue;
    if (e.name) names.push(e.name);
  }
  return names.length ? names.join(' + ') : null;
}

const SET_SLOTS_QUERY = `
query CashboxSetSlots($setId: ID!) {
  set(id: $setId) {
    id
    slots(includeByes: false) {
      entrant { id name }
    }
  }
}`.trim();

async function opponentEntrantIdFromSet(setId: string, selfEntrantId: string, userToken?: string | null): Promise<string | null> {
  const r = await startGgGraphql<{ set: { slots: { entrant?: { id: string } | null }[] } | null }>(
    SET_SLOTS_QUERY,
    { setId },
    'CashboxSetSlots',
    userToken,
  );
  if (r.errors?.length || !r.data?.set?.slots) return null;
  for (const s of r.data.set.slots) {
    const id = s?.entrant?.id;
    if (id && String(id) !== String(selfEntrantId)) return String(id);
  }
  return null;
}

const OPPONENT_ENTRANT_QUERY = `
query CashboxOpponentEntrant($id: ID!) {
  entrant(id: $id) {
    id
    name
    participants {
      gamerTag
      prefix
      user {
        id
        slug
        authorizations {
          type
          externalUsername
          url
        }
      }
    }
  }
}`.trim();

function formatAuthTypeLabel(t: string): string {
  const u = t.toUpperCase();
  if (u.includes('DISCORD')) return 'Discord';
  if (u.includes('TWITTER') || u.includes('X')) return 'X / Twitter';
  if (u.includes('TWITCH')) return 'Twitch';
  if (u.includes('YOUTUBE')) return 'YouTube';
  return t.replace(/_/g, ' ');
}

export type CashboxStartGgSocial = { type: string; handle: string; url: string | null };

export type CashboxStartGgOpponent = {
  userId: string | null;
  gamerTags: string[];
  prefix: string | null;
  socials: CashboxStartGgSocial[];
  userSlug: string | null;
};

export type CashboxFriendliesOpponent = {
  onNetwork: boolean;
  userId?: string;
  connectCode: string | null;
  displayName: string | null;
  discordUsername: string | null;
  discordId: string | null;
  avatarUrl: string | null;
  rating: number | null;
  mainCharacter: number | null;
  topCharacters: { characterId: number; gameCount: number }[];
  region: string | null;
  status: 'online' | 'in-game' | 'idle' | 'offline';
  currentCharacter: number | null;
  opponentCode: string | null;
  playingSince: string | null;
  connectionType: 'wifi' | 'ethernet' | null;
  lookingToPlay: boolean;
  statusPreset: string | null;
  friendStatus: 'none' | 'friends' | 'pending_out' | 'pending_in';
};

export type CashboxNextMatchDetail = {
  setId: string;
  /** start.gg phase group containing this set (for moderation REST). */
  phaseGroupId: string | null;
  roundText: string;
  scoreDisplay: string | null;
  bestOf: number | null;
  selfEntrantId: string;
  selfEntrantName: string;
  opponentName: string | null;
  opponentEntrantId: string | null;
  startGg: CashboxStartGgOpponent | null;
  slippiConnectCode: string | null;
  slippiMapMissing: boolean;
  friendlies?: CashboxFriendliesOpponent;
};

export type CashboxMatchModeration = {
  /** Null when the pending set had no phase group on the GraphQL node. */
  phaseGroupId: string | null;
  setId: string;
  setUrl: string;
  tasks: CashboxModerationTask[];
  phaseGroupFetched: boolean;
  hint: string | null;
};

async function fetchOpponentStartGgProfile(opponentEntrantId: string, userToken?: string | null): Promise<CashboxStartGgOpponent | null> {
  const r = await startGgGraphql<{ entrant: any }>(
    OPPONENT_ENTRANT_QUERY,
    { id: opponentEntrantId },
    'CashboxOpponentEntrant',
    userToken,
  );
  if (r.errors?.length || !r.data?.entrant) return null;
  const ent = r.data.entrant;
  const gamerTags: string[] = [];
  let prefix: string | null = null;
  const socials: CashboxStartGgSocial[] = [];
  let userSlug: string | null = null;
  let userId: string | null = null;
  for (const p of ent.participants ?? []) {
    if (p?.gamerTag) gamerTags.push(String(p.gamerTag));
    if (p?.prefix) prefix = String(p.prefix);
    const u = p?.user;
    if (u?.id != null) userId = String(u.id);
    if (u?.slug) {
      userSlug = String(u.slug).replace(/^user\//i, '').trim() || userSlug;
    }
    for (const a of u?.authorizations ?? []) {
      if (!a) continue;
      const handle = a.externalUsername != null ? String(a.externalUsername) : '';
      socials.push({
        type: formatAuthTypeLabel(String(a.type ?? 'LINK')),
        handle,
        url: a.url != null ? String(a.url) : null,
      });
    }
  }
  return { userId, gamerTags, prefix, socials, userSlug };
}

function resolveSlippiCodeForOpponent(
  opponentBracketName: string | null,
  startGg: CashboxStartGgOpponent | null,
): { code: string | null; missing: boolean } {
  const keys: string[] = [];
  if (opponentBracketName) {
    keys.push(normalizeBracketGamerTag(opponentBracketName));
    for (const part of opponentBracketName.split(/\s*\+\s*/)) {
      keys.push(normalizeBracketGamerTag(part));
    }
  }
  if (startGg?.gamerTags) {
    for (const g of startGg.gamerTags) keys.push(normalizeBracketGamerTag(g));
  }
  const seen = new Set<string>();
  for (const k of keys) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const hit = OPPONENT_SLIPPI_MAP[k];
    if (hit) return { code: hit, missing: false };
  }
  const hasOpponentHint = keys.length > 0;
  return { code: null, missing: hasOpponentHint };
}

async function hydrateNextMatchOpponent(nm: CashboxNextMatchDetail, selfEntrantId: string, userToken?: string | null): Promise<void> {
  const oid = await opponentEntrantIdFromSet(nm.setId, selfEntrantId, userToken);
  nm.opponentEntrantId = oid;
  if (oid) {
    nm.startGg = await fetchOpponentStartGgProfile(oid, userToken);
  } else {
    nm.startGg = null;
  }
  const { code, missing } = resolveSlippiCodeForOpponent(nm.opponentName, nm.startGg);
  nm.slippiConnectCode = code;
  nm.slippiMapMissing = missing;
}

const ENTRANT_EVENT_META_Q = `
query CashboxEntrantEventMeta($entrantId: ID!) {
  entrant(id: $entrantId) {
    initialSeedNum
    isDisqualified
    standing {
      placement
      isFinal
    }
    event {
      numEntrants
      startAt
      state
    }
  }
}`.trim();

const STREAM_QUEUE_Q = `
query CashboxStreamQueue($tid: ID!) {
  streamQueue(tournamentId: $tid, includePlayerStreams: true) {
    id
    stream { streamName }
    sets {
      fullRoundText
      slots(includeByes: false) {
        entrant { name }
      }
    }
  }
}`.trim();

function streamSetLabel(set: any): string {
  const r = set?.fullRoundText || 'Match';
  const names: string[] = [];
  for (const s of set?.slots ?? []) {
    const n = s?.entrant?.name;
    if (n) names.push(String(n));
  }
  return names.length ? `${r}: ${names.join(' vs ')}` : r;
}

export type CashboxStreamQueueRow = { streamLabel: string; setLabel: string };

export type CashboxBracketSet = {
  setId: string;
  roundText: string;
  round: number | null;
  state: 'pending' | 'complete';
  scoreDisplay: string | null;
  opponentName: string | null;
  won: boolean | null;
};

function toBracketSetRow(selfEntrantId: string, n: any): CashboxBracketSet {
  const completed = !!n.completedAt;
  const wid = n.winnerId != null ? String(n.winnerId) : null;
  let won: boolean | null = null;
  if (completed) {
    if (wid && wid === String(selfEntrantId)) won = true;
    else if (wid) won = false;
  }
  return {
    setId: String(n.id),
    roundText: n.fullRoundText || `Round ${n.round ?? ''}`.trim(),
    round: typeof n.round === 'number' ? n.round : null,
    state: completed ? 'complete' : 'pending',
    scoreDisplay: n.displayScore ?? null,
    opponentName: opponentNameForSet(selfEntrantId, n),
    won,
  };
}

async function fetchCashboxPanelExtras(
  tournamentId: string,
  entrantId: string,
  userToken?: string | null,
): Promise<{
  initialSeed: number | null;
  isDisqualified: boolean;
  eventEntrantCount: number | null;
  eventStartAt: number | null;
  eventState: string | null;
  streamQueues: CashboxStreamQueueRow[];
  /** Official placement when standings exist (eliminated or event complete). */
  placement: number | null;
}> {
  const out = {
    initialSeed: null as number | null,
    isDisqualified: false,
    eventEntrantCount: null as number | null,
    eventStartAt: null as number | null,
    eventState: null as string | null,
    streamQueues: [] as CashboxStreamQueueRow[],
    placement: null as number | null,
  };

  const metaR = await startGgGraphql<{ entrant: any }>(
    ENTRANT_EVENT_META_Q,
    { entrantId },
    'CashboxEntrantEventMeta',
    userToken,
  );
  if (!metaR.errors?.length && metaR.data?.entrant) {
    const e = metaR.data.entrant;
    out.initialSeed = e.initialSeedNum ?? null;
    out.isDisqualified = !!e.isDisqualified;
    const st = e.standing;
    if (st?.placement != null && Number.isFinite(Number(st.placement))) {
      out.placement = Number(st.placement);
    }
    const ev = e.event;
    if (ev) {
      out.eventEntrantCount = ev.numEntrants ?? null;
      out.eventStartAt = ev.startAt ?? null;
      out.eventState = ev.state != null ? String(ev.state) : null;
    }
  }

  if (tournamentId) {
    const sqR = await startGgGraphql<{ streamQueue: any[] }>(
      STREAM_QUEUE_Q,
      { tid: tournamentId },
      'CashboxStreamQueue',
      userToken,
    );
    if (!sqR.errors?.length && Array.isArray(sqR.data?.streamQueue)) {
      const rows: CashboxStreamQueueRow[] = [];
      for (const q of sqR.data.streamQueue) {
        const streamLabel = q?.stream?.streamName != null ? String(q.stream.streamName) : 'Stream';
        const sets = q?.sets;
        if (Array.isArray(sets) && sets.length > 0) {
          for (const st of sets.slice(0, 8)) {
            rows.push({ streamLabel, setLabel: streamSetLabel(st) });
          }
        }
      }
      out.streamQueues = rows.slice(0, 14);
    }
  }

  return out;
}

export type CashboxSnapshot =
  | {
      ok: false;
      reason: 'no_token' | 'not_mapped' | 'config' | 'api';
      message?: string;
      giveawayRegisterUrl: string;
      startggConnected?: boolean;
    }
  | {
      ok: true;
      entrantName: string;
      entrantId: string;
      tournamentName: string;
      tournamentSlug: string;
      eventName: string;
      eventSlug: string;
      bracketUrl: string;
      bracketEmbedUrl: string;
      giveawayRegisterUrl: string;
      /** True when this snapshot is served from cache after a rate-limit / API error. */
      stale?: boolean;
      /** ISO timestamp of when the cached snapshot was originally fetched. */
      staleSince?: string;
      extras: {
        initialSeed: number | null;
        isDisqualified: boolean;
        eventEntrantCount: number | null;
        eventStartAt: number | null;
        eventState: string | null;
        streamQueues: CashboxStreamQueueRow[];
        placement: number | null;
      };
      nextMatch: CashboxNextMatchDetail | null;
      recentMatches: {
        setId: string;
        roundText: string;
        scoreDisplay: string | null;
        opponentName: string | null;
        won: boolean | null;
      }[];
      /** All of your sets in bracket call order (upcoming then completed interleaved as returned by start.gg). */
      bracketSets: CashboxBracketSet[];
      /** Full pool / phase group for your current (or most recent) set — all matches in that group. */
      currentPhasePool: CashboxPhasePool | null;
      /** Check-in / report task list + deep link (Cashbox one-off; uses www.start.gg REST when possible). */
      matchModeration: CashboxMatchModeration | null;
      record: { wins: number; losses: number };
    };

const _snapshotCache = new Map<string, { snap: Extract<CashboxSnapshot, { ok: true }>; ts: number }>();
const SNAPSHOT_CACHE_MAX_AGE = 5 * 60_000;

function cacheSnapshot(code: string, snap: Extract<CashboxSnapshot, { ok: true }>): void {
  _snapshotCache.set(code.toUpperCase(), { snap, ts: Date.now() });
}

function getCachedSnapshot(code: string): Extract<CashboxSnapshot, { ok: true }> | null {
  const entry = _snapshotCache.get(code.toUpperCase());
  if (!entry) return null;
  if (Date.now() - entry.ts > SNAPSHOT_CACHE_MAX_AGE) {
    _snapshotCache.delete(code.toUpperCase());
    return null;
  }
  return { ...entry.snap, stale: true, staleSince: new Date(entry.ts).toISOString() };
}

function isRateLimitError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('rate limit') || lower.includes('rate_limit') || lower.includes('throttl');
}

export async function getCashboxSnapshot(connectCode: string, userToken?: string | null): Promise<CashboxSnapshot> {
  const giveawayRegisterUrl = cashboxGiveawayRegisterUrl();

  if (!userToken && !getStartGgToken()) {
    return {
      ok: false,
      reason: 'no_token',
      message: 'Link your start.gg account, or set START_GG_TOKEN in apps/agent/.env.',
      giveawayRegisterUrl,
    };
  }

  const resolved = await resolveCashboxEvent(userToken);
  if (!resolved.ok) {
    if (isRateLimitError(resolved.message)) {
      const cached = getCachedSnapshot(connectCode);
      if (cached) { console.log('[cashbox] serving cached snapshot (event resolve rate-limited)'); cashboxLog.info('serving cached snapshot (event resolve rate-limited)'); return cached; }
    }
    return { ok: false, reason: 'config', message: resolved.message, giveawayRegisterUrl };
  }
  const { meta } = resolved;

  let entrantId: string | null = null;

  const mapRaw = mapValueForConnectCode(connectCode);
  if (mapRaw) {
    const resolvedEntrant = await resolveMapValueToEntrantId(mapRaw, meta.tournamentSlug, meta.eventId, userToken);
    if (resolvedEntrant.ok) {
      entrantId = resolvedEntrant.id;
    }
  }

  let wasRateLimited = false;
  const profileUserId = !entrantId ? await resolveStartGgUserIdFromProfile() : null;

  if (!entrantId && profileUserId) {
    console.log('[cashbox] resolved startgg_user_id from Supabase profile:', profileUserId);
    cashboxLog.info('resolved startgg_user_id from Supabase profile:', profileUserId);
    const result = await entrantIdForUserInEvent(profileUserId, meta.tournamentSlug, meta.eventId, userToken);
    if (result.found) entrantId = result.id;
    else if (result.rateLimited) wasRateLimited = true;
  }

  if (!entrantId && !wasRateLimited) {
    const localInfo = getStartGgUserInfo();
    if (localInfo.userId && localInfo.userId !== profileUserId) {
      console.log('[cashbox] trying local store userId:', localInfo.userId);
      cashboxLog.info('trying local store userId:', localInfo.userId);
      const result = await entrantIdForUserInEvent(localInfo.userId, meta.tournamentSlug, meta.eventId, userToken);
      if (result.found) entrantId = result.id;
      else if (result.rateLimited) wasRateLimited = true;
    }
  }

  if (!entrantId) {
    if (wasRateLimited) {
      const cached = getCachedSnapshot(connectCode);
      if (cached) { console.log('[cashbox] serving cached snapshot (entrant resolve rate-limited)'); cashboxLog.info('serving cached snapshot (entrant resolve rate-limited)'); return cached; }
      return {
        ok: false,
        reason: 'api',
        message: 'start.gg rate limit — your registration will show up shortly. Try refreshing in a minute.',
        giveawayRegisterUrl,
        startggConnected: true,
      };
    }
    return {
      ok: false,
      reason: 'not_mapped',
      message: mapRaw
        ? 'Could not resolve your entrant for this bracket from the manual map or linked start.gg account.'
        : 'Your connect code is not in the entrant map, and no start.gg account is linked. Connect your start.gg account or ask the TO to add you to the map.',
      giveawayRegisterUrl,
    };
  }

  // Batch 1: fetch entrant sets and panel extras in parallel
  const [pack, extras] = await Promise.all([
    fetchEntrantSets(entrantId, meta.eventId, userToken),
    fetchCashboxPanelExtras(meta.tournamentId, entrantId, userToken),
  ]);
  if (!pack.ok) {
    if (isRateLimitError(pack.message)) {
      const cached = getCachedSnapshot(connectCode);
      if (cached) { console.log('[cashbox] serving cached snapshot (sets fetch rate-limited)'); cashboxLog.info('serving cached snapshot (sets fetch rate-limited)'); return cached; }
    }
    return { ok: false, reason: 'api', message: pack.message, giveawayRegisterUrl };
  }

  const { nodes, entrantName } = pack;
  const bracketUrl = bracketUrlFor(meta.eventSlug, meta.tournamentSlug);
  const bracketEmbedUrl = bracketEmbedUrlFor(meta.eventSlug, meta.tournamentSlug);

  let nextMatch: CashboxNextMatchDetail | null = null;
  const completed: typeof nodes = [];
  for (const n of nodes) {
    if (n.completedAt) {
      completed.push(n);
    } else if (!nextMatch) {
      const oppName = opponentNameForSet(entrantId, n);
      nextMatch = {
        setId: String(n.id),
        phaseGroupId: n.phaseGroup?.id != null ? String(n.phaseGroup.id) : null,
        roundText: n.fullRoundText || `Round ${n.round ?? ''}`.trim(),
        scoreDisplay: n.displayScore ?? null,
        bestOf: typeof n.totalGames === 'number' ? n.totalGames : null,
        selfEntrantId: String(entrantId),
        selfEntrantName: entrantName,
        opponentName: oppName,
        opponentEntrantId: null,
        startGg: null,
        slippiConnectCode: null,
        slippiMapMissing: true,
      };
    }
  }

  let wins = 0;
  let losses = 0;
  for (const n of completed) {
    const wid = n.winnerId != null ? String(n.winnerId) : null;
    if (wid && wid === String(entrantId)) wins++;
    else if (wid) losses++;
  }

  type Recent = Extract<CashboxSnapshot, { ok: true }>['recentMatches'][number];
  const recentMatches: Recent[] = [];
  for (let i = completed.length - 1; i >= 0 && recentMatches.length < 8; i--) {
    const n = completed[i];
    const wid = n.winnerId != null ? String(n.winnerId) : null;
    let won: boolean | null = null;
    if (wid && wid === String(entrantId)) won = true;
    else if (wid) won = false;
    recentMatches.push({
      setId: String(n.id),
      roundText: n.fullRoundText || `Round ${n.round ?? ''}`.trim(),
      scoreDisplay: n.displayScore ?? null,
      opponentName: opponentNameForSet(entrantId, n),
      won,
    });
  }

  const bracketSets = nodes.map((n) => toBracketSetRow(entrantId, n));

  const anchor = pickAnchorSetForPhaseGroup(nodes);
  const pgId = anchor?.phaseGroup?.id;

  // Batch 2: hydrate opponent, fetch pool, and fetch moderation data in parallel
  const [, currentPhasePool, moderationPayload] = await Promise.all([
    nextMatch
      ? hydrateNextMatchOpponent(nextMatch, entrantId, userToken)
      : Promise.resolve(),
    pgId
      ? fetchPhaseGroupPool(String(pgId), String(entrantId), userToken).catch((e) => { console.error('[cashbox] fetchPhaseGroupPool', e); cashboxLog.error('fetchPhaseGroupPool', e); return null; })
      : Promise.resolve(null),
    nextMatch?.phaseGroupId
      ? fetchPhaseGroupRestJson(nextMatch.phaseGroupId).catch(() => null)
      : Promise.resolve(null),
  ]);

  let matchModeration: CashboxMatchModeration | null = null;
  if (nextMatch) {
    const setUrl = setPageUrlFor(meta.tournamentSlug, meta.eventSlug, nextMatch.setId);
    if (nextMatch.phaseGroupId) {
      const tasks = moderationPayload
        ? extractModerationTasksFromPhaseGroupPayload(moderationPayload, nextMatch.setId)
        : [];
      matchModeration = {
        phaseGroupId: nextMatch.phaseGroupId,
        setId: nextMatch.setId,
        setUrl,
        tasks,
        phaseGroupFetched: !!moderationPayload,
        hint: !moderationPayload
          ? 'Could not load moderation tasks (often needs a logged-in session). Set START_GG_WEB_COOKIE from your browser cookies for start.gg, restart the app, or use the button below.'
          : tasks.length === 0
              ? 'Loaded phase data but no tasks matched this set. Use “Open match on start.gg” to finish check-in / reporting.'
            : null,
      };
    } else {
      matchModeration = {
        phaseGroupId: null,
        setId: nextMatch.setId,
        setUrl,
        tasks: [],
        phaseGroupFetched: false,
        hint: 'Open this set on start.gg for check-in and game reporting.',
      };
    }
  }

  const result: Extract<CashboxSnapshot, { ok: true }> = {
    ok: true,
    entrantName: entrantName || 'Player',
    entrantId: String(entrantId),
    tournamentName: meta.tournamentName,
    tournamentSlug: meta.tournamentSlug,
    eventName: meta.eventName,
    eventSlug: meta.eventSlug,
    bracketUrl,
    bracketEmbedUrl,
    giveawayRegisterUrl,
    extras,
    nextMatch,
    recentMatches,
    bracketSets,
    currentPhasePool,
    matchModeration,
    record: { wins, losses },
  };
  cacheSnapshot(connectCode, result);
  return result;
}

// ---------------------------------------------------------------------------
// Set reporting (uses the user's OAuth token via startGgGraphql)
// ---------------------------------------------------------------------------

const REPORT_SET_MUTATION = `
mutation ReportBracketSet($setId: ID!, $winnerId: ID, $gameData: [BracketSetGameDataInput]) {
  reportBracketSet(setId: $setId, winnerId: $winnerId, gameData: $gameData) {
    id
    state
    displayScore
  }
}`.trim();

export type ReportSetGameInput = {
  winnerId: number;
  gameNum: number;
  stageId?: number;
  selections?: { entrantId: number; characterId: number }[];
};

export async function reportBracketSet(
  setId: string,
  winnerId: number | null,
  gameData: ReportSetGameInput[],
): Promise<{ ok: true; state: number | null } | { ok: false; message: string }> {
  const token = await getStartGgUserToken();
  if (!token) {
    return { ok: false, message: 'Not connected to start.gg. Link your account first.' };
  }

  const variables: Record<string, unknown> = { setId };
  if (winnerId != null) variables.winnerId = winnerId;
  if (gameData.length > 0) variables.gameData = gameData;

  try {
    const res = await fetch('https://api.start.gg/gql/alpha', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: REPORT_SET_MUTATION, variables }),
    });

    const body = await res.json();
    if (body.errors?.length) {
      const msg = body.errors.map((e: any) => e.message).join('; ');
      console.error('[cashbox] reportBracketSet errors:', msg);
      cashboxLog.error('reportBracketSet errors:', msg);
      return { ok: false, message: msg };
    }
    const set = body.data?.reportBracketSet;
    console.log('[cashbox] reportBracketSet ok, state:', set?.state);
    cashboxLog.info('reportBracketSet ok, state:', set?.state);
    return { ok: true, state: set?.state ?? null };
  } catch (e: any) {
    console.error('[cashbox] reportBracketSet', e);
    cashboxLog.error('reportBracketSet', e);
    return { ok: false, message: e?.message || 'Network error' };
  }
}
