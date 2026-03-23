import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SLIPPI_GQL_ENDPOINT = 'https://gql-gateway-dot-slippi.uc.r.appspot.com/graphql';

const SLIPPI_QUERY = `
fragment profileFields on NetplayProfile {
  id
  ratingOrdinal
  ratingUpdateCount
  wins
  losses
  dailyGlobalPlacement
  dailyRegionalPlacement
  continent
  characters { id character gameCount __typename }
  __typename
}
fragment userProfilePage on User {
  fbUid
  displayName
  connectCode { code __typename }
  status
  activeSubscription { level hasGiftSub __typename }
  rankedNetplayProfile { ...profileFields __typename }
  netplayProfiles { ...profileFields season { id startedAt endedAt name status __typename } __typename }
  __typename
}
query AccountManagementPageQuery($cc: String!, $uid: String!) {
  getUser(fbUid: $uid) { ...userProfilePage __typename }
  getConnectCode(code: $cc) { user { ...userProfilePage __typename } __typename }
}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { slippiUid, connectCode } = await req.json();

    const slippiRes = await fetch(SLIPPI_GQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://slippi.gg',
        'Referer': 'https://slippi.gg/',
      },
      body: JSON.stringify({
        operationName: 'AccountManagementPageQuery',
        variables: { cc: connectCode, uid: slippiUid },
        query: SLIPPI_QUERY,
      }),
    });

    const data = await slippiRes.json();
    const user = data?.data?.getConnectCode?.user;

    if (!user || user.fbUid !== slippiUid) {
      return new Response(
        JSON.stringify({ verified: false, error: 'UID does not match connect code' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const authHeader = req.headers.get('Authorization');
    const { data: { user: authUser } } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '')
    );

    if (!authUser) {
      return new Response(
        JSON.stringify({ verified: false, error: 'Not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // First-come-first-claimed: reject if another verified user owns this code
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, verified')
      .eq('connect_code', connectCode)
      .neq('id', authUser.id)
      .maybeSingle();

    if (existing?.verified) {
      return new Response(
        JSON.stringify({
          verified: false,
          error: 'This connect code is already claimed by another account. If this is your code, email lucky7smelee@gmail.com to recover your profile.',
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await supabase.from('profiles').upsert({
      id: authUser.id,
      slippi_uid: slippiUid,
      connect_code: connectCode,
      display_name: user.displayName,
      verified: true,
      verified_at: new Date().toISOString(),
    });

    if (user.rankedNetplayProfile) {
      const r = user.rankedNetplayProfile;
      await supabase.from('slippi_cache').upsert({
        connect_code: connectCode,
        display_name: user.displayName,
        slippi_uid: user.fbUid,
        rating_ordinal: r.ratingOrdinal,
        wins: r.wins,
        losses: r.losses,
        global_placement: r.dailyGlobalPlacement,
        continent: r.continent,
        characters: r.characters?.map((c: any) => ({ character: c.character, gameCount: c.gameCount })) ?? [],
        fetched_at: new Date().toISOString(),
      });
    }

    return new Response(
      JSON.stringify({ verified: true, profile: user }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ verified: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
