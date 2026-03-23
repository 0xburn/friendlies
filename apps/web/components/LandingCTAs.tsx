'use client';

import { createClient } from '@/lib/supabase/client';

export function LandingCTAs() {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL ?? '';

  async function signInDiscord() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${origin}/friendlies/auth/callback?next=/friends`,
      },
    });
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
      <a
        href="https://github.com/0xburn/friendlies/releases"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-w-[200px] items-center justify-center rounded-lg bg-[#21BA45] px-8 py-4 text-base font-bold text-black transition hover:bg-[#1da63d] glow-green-hover"
      >
        Download Desktop App
      </a>
      <button
        type="button"
        onClick={() => void signInDiscord()}
        className="inline-flex min-w-[200px] items-center justify-center rounded-lg border border-[#21BA45]/40 bg-[#21BA45]/10 px-8 py-4 text-base font-semibold text-[#21BA45] transition hover:bg-[#21BA45]/20 glow-green-hover"
      >
        Sign In with Discord
      </button>
    </div>
  );
}
