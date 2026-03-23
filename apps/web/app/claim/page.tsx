import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LandingCTAs } from '@/components/LandingCTAs';
import { connectCodeToPathSegment } from '@/lib/connect-code';

export default async function ClaimPage() {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  let verified = false;
  let connectCode: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('verified, connect_code')
      .eq('id', user.id)
      .maybeSingle();
    verified = profile?.verified === true;
    connectCode = profile?.connect_code ?? null;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-3xl font-bold text-white">Claim your Slippi profile</h1>
      <p className="mt-3 text-gray-400">
        Verification ties your Discord login to a Slippi connect code through the desktop agent. No
        manual codes to paste — the agent talks to Slippi and Supabase for you.
      </p>

      {!user && (
        <div className="mt-10 rounded-xl border border-slippi-border bg-slippi-card p-8 text-center">
          <p className="text-gray-300">Sign in with Discord to see your verification status.</p>
          <div className="mt-6 flex justify-center">
            <LandingCTAs />
          </div>
        </div>
      )}

      {user && verified && connectCode && (
        <div className="mt-10 rounded-xl border border-[#21BA45]/40 bg-[#21BA45]/10 p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-[#21BA45]">Verified</p>
          <p className="mt-4 font-mono text-2xl font-bold text-white">{connectCode}</p>
          <p className="mt-4 text-gray-300">
            Your profile is linked. Share{' '}
            <Link
              href={`/profile/${connectCodeToPathSegment(connectCode)}`}
              className="text-[#21BA45] hover:underline"
            >
              your public page
            </Link>{' '}
            or open Settings to tune privacy and socials.
          </p>
        </div>
      )}

      {user && !verified && (
        <div className="mt-10 space-y-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-8">
          <p className="font-medium text-amber-200/90">Not verified yet</p>
          <ol className="list-decimal space-y-4 pl-5 text-gray-300">
            <li>
              <span className="font-semibold text-white">Download the agent</span> — desktop app
              from the Friendlies releases (see landing page).
            </li>
            <li>
              <span className="font-semibold text-white">Sign in</span> — use the same Discord
              account in the agent as on this site.
            </li>
            <li>
              <span className="font-semibold text-white">Auto-verify</span> — when the agent runs
              with your Slippi session, it calls the verify endpoint and stamps your connect code
              on this profile.
            </li>
          </ol>
        </div>
      )}

      <section className="mt-12 rounded-xl border border-slippi-border bg-black/30 p-6">
        <h2 className="font-display text-lg font-semibold text-white">Why an agent?</h2>
        <p className="mt-3 text-sm leading-relaxed text-gray-400">
          The agent reads your local Slippi installation and replay folder so we never ask for your
          Slippi password. Once verified, match history and presence sync without extra clicks.
        </p>
      </section>
    </div>
  );
}
