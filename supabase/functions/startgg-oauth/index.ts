import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STARTGG_TOKEN_URL = 'https://api.start.gg/oauth/access_token';
const STARTGG_REFRESH_URL = 'https://api.start.gg/oauth/refresh';
const STARTGG_GQL_URL = 'https://api.start.gg/gql/alpha';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

async function verifySupabaseJwt(authHeader: string | null): Promise<string> {
  if (!authHeader) throw new Error('Missing Authorization header');
  const supabase = createClient(
    getEnv('SUPABASE_URL'),
    getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Invalid or expired session');
  return user.id;
}

const IDENTITY_QUERY = `query StartGgCurrentUser { currentUser { id slug player { gamerTag } } }`;

async function fetchStartGgIdentity(accessToken: string): Promise<{
  userId: string;
  displayName: string | null;
  slug: string | null;
}> {
  const res = await fetch(STARTGG_GQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query: IDENTITY_QUERY }),
  });
  const data = await res.json();
  const u = data?.data?.currentUser;
  if (!u?.id) throw new Error('Could not resolve start.gg identity');
  return {
    userId: String(u.id),
    displayName: u.player?.gamerTag ?? null,
    slug: u.slug ?? null,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const userId = await verifySupabaseJwt(req.headers.get('Authorization'));
    const body = await req.json();
    const grantType = body.grant_type;

    const clientId = getEnv('STARTGG_CLIENT_ID');
    const clientSecret = getEnv('STARTGG_CLIENT_SECRET');

    if (grantType === 'authorization_code') {
      const { code, redirect_uri, scope } = body;
      if (!code || !redirect_uri) {
        return json({ error: 'Missing code or redirect_uri' }, 400);
      }

      const tokenRes = await fetch(STARTGG_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          scope: scope || 'user.identity tournament.reporter',
          redirect_uri,
        }),
      });

      if (!tokenRes.ok) {
        const txt = await tokenRes.text().catch(() => '');
        return json({ error: `start.gg token exchange failed: ${txt.slice(0, 300)}` }, 502);
      }

      const tokens = await tokenRes.json();
      if (!tokens.access_token) {
        return json({ error: 'No access_token in start.gg response' }, 502);
      }

      let identity = { userId: '', displayName: null as string | null, slug: null as string | null };
      try {
        identity = await fetchStartGgIdentity(tokens.access_token);
      } catch (e) {
        console.error('[startgg-oauth] identity query failed', e);
      }

      // Persist the public start.gg user ID on the profile (owner-update RLS)
      if (identity.userId) {
        const supabase = createClient(
          getEnv('SUPABASE_URL'),
          getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        );
        await supabase
          .from('profiles')
          .update({ startgg_user_id: identity.userId })
          .eq('id', userId);
      }

      return json({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        startgg_user_id: identity.userId || null,
        startgg_display_name: identity.displayName,
        startgg_slug: identity.slug,
      });
    }

    if (grantType === 'refresh_token') {
      const { refresh_token, scope } = body;
      if (!refresh_token) {
        return json({ error: 'Missing refresh_token' }, 400);
      }

      const refreshRes = await fetch(STARTGG_REFRESH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
          scope: scope || 'user.identity tournament.reporter',
          redirect_uri: body.redirect_uri || '',
        }),
      });

      if (!refreshRes.ok) {
        const txt = await refreshRes.text().catch(() => '');
        return json({ error: `start.gg refresh failed: ${txt.slice(0, 300)}` }, 502);
      }

      const tokens = await refreshRes.json();
      return json({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
      });
    }

    return json({ error: `Unsupported grant_type: ${grantType}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes('Invalid or expired') || msg.includes('Missing Authorization') ? 401 : 500;
    return json({ error: msg }, status);
  }
});
