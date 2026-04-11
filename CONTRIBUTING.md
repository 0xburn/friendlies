# Contributing to friendlies

Local development guide for the friendlies Electron app and companion web site.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | >= 20 | [nodejs.org](https://nodejs.org) |
| npm | >= 9 | ships with Node |
| Supabase CLI | latest | `brew install supabase/tap/supabase` or [docs](https://supabase.com/docs/guides/local-development/cli/getting-started) |
| Docker | latest | required by `supabase start` — [docker.com](https://www.docker.com/get-started) |

## Project structure

```
slippi-friends/
├── apps/
│   ├── agent/          # Electron desktop app (React + Vite renderer)
│   └── web/            # Next.js marketing site + API routes
├── packages/
│   └── slippi-api/     # Shared Slippi GraphQL queries/types
├── supabase/
│   ├── config.toml     # Local Supabase config
│   ├── migrations/     # Numbered SQL migrations (001–046+)
│   ├── seed.sql        # Dummy data loaded on `supabase db reset`
│   └── functions/      # Deno Edge Functions
├── scripts/            # One-off utilities (backfills, migrations)
├── .env.example        # Root env template
└── apps/agent/.env.example  # Agent-specific env template
```

## 1. Clone and install

```bash
git clone https://github.com/0xburn/friendlies.git
cd friendlies
npm install
```

## 2. Start local Supabase

This spins up Postgres, Auth, Edge Functions, Studio, and Realtime in Docker containers. Migrations and seed data are applied automatically.

```bash
supabase start
```

Once running, the CLI prints local credentials:

```
API URL:   http://127.0.0.1:54321
DB URL:    postgresql://postgres:postgres@127.0.0.1:54322/postgres
anon key:  eyJhbG...  (long JWT)
service_role key: eyJhbG...  (long JWT)
Studio:    http://127.0.0.1:54323
```

You can view and edit the database in Supabase Studio at **http://127.0.0.1:54323**.

To reset the database (re-run all migrations + seed):

```bash
supabase db reset
```

## 3. Configure environment variables

### Root `.env` (web app + shared)

```bash
cp .env.example .env
```

Edit `.env` and replace values with the local Supabase output:

```env
# Point both web and agent at local Supabase
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase start>
NEXT_PUBLIC_APP_URL=http://localhost:3000

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<anon key from supabase start>

# Only needed for Edge Functions and web API routes that use admin access
SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase start>
```

### Agent `.env` (Electron app)

```bash
cp apps/agent/.env.example apps/agent/.env
```

For basic local development (friends list, presence, chat) you only need Supabase credentials. The agent has hardcoded fallbacks that point at **production** Supabase — override them for local dev:

```env
# apps/agent/.env — optional overrides for local Supabase
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<anon key from supabase start>
```

### Environment variable reference

| Variable | Required | Where | Purpose |
|----------|----------|-------|---------|
| `SUPABASE_URL` | yes | agent, web, edge | Supabase project URL |
| `SUPABASE_ANON_KEY` | yes | agent, web, edge | Supabase public/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | for edge/API | web API, edge functions | Admin access (never in client code) |
| `NEXT_PUBLIC_SUPABASE_URL` | for web | web | Client-side Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for web | web | Client-side anon key |
| `NEXT_PUBLIC_APP_URL` | for web | web | Base URL for OAuth redirects |
| `START_GG_TOKEN` | optional | agent | start.gg API token (Cashbox features) |
| `STARTGG_CLIENT_ID` | optional | agent, edge | start.gg OAuth client ID |
| `STARTGG_CLIENT_SECRET` | optional | edge only | start.gg OAuth secret (set via `supabase secrets set`) |
| `DATABASE_URL` | optional | scripts | Direct Postgres connection string |

## 4. Set up Discord OAuth (for login)

Login uses Discord via Supabase Auth. For local dev you need a Discord application:

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and create a new app (or use an existing dev app).
2. Under **OAuth2**, add these redirect URLs:
   - `http://127.0.0.1:54321/auth/v1/callback`
   - `http://localhost:18457/auth-callback` (Electron local callback server)
3. Copy the **Client ID** and **Client Secret**.
4. In Supabase Studio (**http://127.0.0.1:54323**), go to **Authentication > Providers > Discord** and enter the client ID and secret.

Alternatively, to skip Discord OAuth entirely during development, you can create test users directly via the Supabase dashboard (Authentication > Users > Add User) with email/password auth, though some features that depend on Discord metadata won't work.

## 5. Run the app

### Electron agent (desktop app)

```bash
npm run dev:agent
```

This starts three processes concurrently:
- TypeScript compiler in watch mode
- Vite dev server on `http://localhost:5173`
- Electron (waits for Vite, then opens the app window)

### Web site

```bash
npm run dev:web
```

Starts the Next.js dev server on `http://localhost:3000`.

### Edge Functions (local)

Edge functions run automatically inside `supabase start`. To test them:

```bash
# Invoke locally (example)
curl -X POST http://127.0.0.1:54321/functions/v1/enrich-player \
  -H "Authorization: Bearer <anon key>" \
  -H "Content-Type: application/json" \
  -d '{"connectCode": "MANG#0"}'
```

To set secrets for edge functions locally:

```bash
supabase secrets set STARTGG_CLIENT_ID=xxx STARTGG_CLIENT_SECRET=yyy
```

## 6. Database schema overview

All tables live in the `public` schema with Row Level Security (RLS) enabled. Migrations are in `supabase/migrations/` and run in filename order.

### Core tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `profiles` | One row per user, created on signup | `id` (FK to `auth.users`), `connect_code`, `display_name`, `discord_username`, `region`, `verified` |
| `friends` | Friend relationships + requests | `user_id`, `friend_connect_code`, `status` (`pending`/`accepted`), `note` |
| `presence_log` | Live online/in-game status (one row per user) | `user_id`, `status`, `opponent_code`, `looking_to_play`, `lfg_characters`, `lfg_ranks` |
| `matches` | Replay history parsed from Slippi files | `user_id`, `opponent_connect_code`, `replay_filename`, `did_win`, `played_at` |
| `slippi_cache` | Cached Slippi ranked stats | `connect_code`, `rating_ordinal`, `wins`, `losses`, `characters` |
| `player_ratings` | Player ratings (replaces slippi_cache) | `connect_code`, rating fields |

### Social / messaging

| Table | Purpose |
|-------|---------|
| `play_invites` | Play session invitations between users |
| `nudges` | "Nudge" pings between users |
| `chat_messages` | Global chat messages (soft-delete via `deleted_at`) |
| `chat_mutes` | Muted users (permanent or timed) |
| `chat_reports` | User reports on chat messages |
| `blocked_users` | Per-user block list |

### System / config

| Table | Purpose |
|-------|---------|
| `app_config` | Key-value feature flags and settings |
| `blacklist` | Platform-banned users |
| `user_activity` | Aggregated play time stats |
| `event_log` | Client-side analytics events |
| `banner_clicks` | Tracks promo banner interactions |
| `patreon_public_supporters` | Connect codes shown with Patron flair |

### Key relationships

```
auth.users (Supabase managed)
  └── profiles (1:1, created by trigger)
        ├── friends (user_id → profiles.id)
        ├── matches (user_id → profiles.id)
        ├── presence_log (user_id → profiles.id, unique)
        ├── play_invites (sender_id / receiver_id → profiles.id)
        └── user_activity (user_id → profiles.id)
```

### Notable database functions

| Function | Type | Purpose |
|----------|------|---------|
| `handle_new_user()` | Trigger | Auto-creates `profiles` row on signup |
| `recompute_top_characters()` | Trigger | Updates profile top chars on new match |
| `increment_activity()` | RPC | Atomic play time increment (SECURITY DEFINER) |
| `discover_mutual_friend_counts()` | RPC | Returns mutual friend counts for Discover tab |
| `enforce_chat_rate_limit()` | Trigger | Rate-limits and mute-checks chat inserts |
| Privacy triggers | Triggers | Round geo coords, hide connection type, enforce online status |

## 7. Edge Functions

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `verify-slippi` | `POST /functions/v1/verify-slippi` | Verifies a user's Slippi connect code + UID via the Slippi API, updates profile |
| `enrich-player` | `POST /functions/v1/enrich-player` | Fetches/caches Slippi stats for a connect code |
| `startgg-oauth` | `POST /functions/v1/startgg-oauth` | Handles start.gg OAuth code exchange and token refresh |
| `link-luckystats` | `POST /functions/v1/link-luckystats` | Stub (501) — reserved for future Lucky Stats integration |

## 8. Seed data

Running `supabase db reset` loads `supabase/seed.sql` which populates the database with dummy data for local development. The seed creates:

- **5 test profiles** with Slippi connect codes (Mang0, Zain, Hungrybox, Cody, Plup)
- **Cached Slippi stats** in `slippi_cache` and `player_ratings`
- **Presence entries** (some online, some in-game)
- **Friend relationships** between test users
- **App config** defaults (broadcast message, chat settings)
- **Sample chat messages**

Since profiles are normally created by the `handle_new_user` trigger on `auth.users`, the seed uses `auth.users` inserts (Supabase local dev allows this). You can also create users through the Studio dashboard.

## 9. Useful commands

```bash
# Reset DB (re-run migrations + seed)
supabase db reset

# Open Supabase Studio
open http://127.0.0.1:54323

# Create a new migration
supabase migration new my_change_name

# Run tests
npm test -w apps/agent

# Build everything
npm run build

# Build agent for current platform only
npm run build:mac -w apps/agent   # or build:win, build:linux
```

## 10. External services

The app integrates with these external services. Most are **optional** for local dev:

| Service | Required? | Notes |
|---------|-----------|-------|
| **Supabase** (local) | yes | Auth, database, realtime, edge functions |
| **Discord OAuth** | yes for login | Configure in Supabase Auth settings (see step 4) |
| **Slippi API** | no | `https://internal.slippi.gg/graphql` — used for verification and stats. Works without auth. Seed data provides cached stats so you can develop without calling the real API. |
| **start.gg** | no | Only needed for Cashbox tournament features. Requires `START_GG_TOKEN`. |
| **IP geolocation** | no | `ip-api.com` for auto-detecting region. Falls back gracefully. |

## 11. Architecture notes

- **Electron main process** (`apps/agent/src/main.ts`) — handles IPC, Supabase queries, file watching, presence updates
- **Renderer** (`apps/agent/src/renderer/`) — React + Vite + Tailwind, communicates with main via `ipcRenderer`
- **Preload** (`apps/agent/src/preload.ts`) — exposes safe IPC methods to the renderer via `contextBridge`
- **Auth flow** — Discord OAuth through Supabase, with a local HTTP server on port 18457 to capture the callback in Electron
- **Replay watching** — `chokidar` watches the Slippi replay directory, parses new `.slp` files with `@slippi/slippi-js`
- **Presence** — periodic heartbeats to `presence_log` table; friends poll every ~30s
- **Auto-update** — `electron-updater` checks GitHub Releases for new versions
