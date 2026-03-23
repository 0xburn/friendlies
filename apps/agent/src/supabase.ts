import './config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL_FALLBACK =
  'https://hlpcaltsxcdxmolmpcxj.supabase.co';
export const SUPABASE_ANON_KEY_FALLBACK = 'sb_publishable_FDnNDoHM6fEyKd_cqtZuiQ_DGCjELGh';

let client: SupabaseClient | null = null;

function getOrCreateClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL ?? SUPABASE_URL_FALLBACK,
      process.env.SUPABASE_ANON_KEY ?? SUPABASE_ANON_KEY_FALLBACK,
    );
  }
  return client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const c = getOrCreateClient();
    const value = Reflect.get(c as object, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(c);
    }
    return value;
  },
});

export async function setSession(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const { error } = await getOrCreateClient().auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
}
