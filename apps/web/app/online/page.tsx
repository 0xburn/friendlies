'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { CharacterIcon } from '@/components/CharacterIcon';
import { OnlineIndicator } from '@/components/OnlineIndicator';
import { usePresence } from '@/components/PresenceProvider';
import { DesktopBanner } from '@/components/DesktopBanner';

type FriendProfile = {
  id: string;
  connect_code: string | null;
  display_name: string | null;
};

export default function OnlinePage() {
  const router = useRouter();
  const supabase = createClient();
  const { presenceByUserId, loading: presenceLoading, error: presenceError } = usePresence();
  const [loading, setLoading] = useState(true);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const loadFriends = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace('/');
      return;
    }

    const { data } = await supabase
      .from('friends')
      .select(
        `
        friend:profiles!friends_friend_id_fkey (
          id,
          connect_code,
          display_name
        )
      `
      )
      .eq('user_id', userData.user.id);

    const rows =
      (data as unknown as { friend: FriendProfile | null }[] | null)
        ?.map((r) => r.friend)
        .filter(Boolean) ?? [];
    setFriends(rows as FriendProfile[]);
    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  const onlineFriends = useMemo(() => {
    const friendSet = new Set(friends.map((f) => f.id));
    return friends
      .map((f) => {
        const p = presenceByUserId[f.id];
        if (!p || (p.status !== 'online' && p.status !== 'in-game')) return null;
        return { profile: f, presence: p };
      })
      .filter(Boolean) as {
        profile: FriendProfile;
        presence: { status: 'online' | 'in-game'; currentCharacter: number | null };
      }[];
  }, [friends, presenceByUserId]);

  const sorted = useMemo(() => {
    return [...onlineFriends].sort((a, b) => {
      if (a.presence.status === b.presence.status) return 0;
      if (a.presence.status === 'in-game') return -1;
      if (b.presence.status === 'in-game') return 1;
      return 0;
    });
  }, [onlineFriends]);

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <DesktopBanner />
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white">Who&apos;s online</h1>
        <p className="mt-2 text-gray-400">
          Friends currently in queue or in-game. In-game is sorted to the top.
        </p>
      </div>

      {presenceError && (
        <p className="mb-4 text-sm text-amber-500/90">Presence: {presenceError}</p>
      )}

      {presenceLoading && sorted.length === 0 && (
        <p className="text-sm text-gray-500">Syncing presence…</p>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slippi-border bg-slippi-card/50 px-6 py-16 text-center">
          <p className="text-gray-400">No friends are online right now.</p>
          <p className="mt-2 text-sm text-gray-500">
            Make sure friends are running Friendlies while Dolphin is open.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {sorted.map(({ profile, presence }) => {
            const code = profile.connect_code ?? '';
            return (
              <li
                key={profile.id}
                className="flex flex-col gap-4 rounded-xl border border-slippi-border bg-slippi-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  {presence.currentCharacter != null && (
                    <CharacterIcon characterId={presence.currentCharacter} size="lg" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-lg font-bold text-white">{code}</span>
                      <OnlineIndicator status={presence.status} />
                      <span className="text-sm capitalize text-gray-400">
                        {presence.status.replace('-', ' ')}
                      </span>
                    </div>
                    {profile.display_name && (
                      <p className="truncate text-sm text-gray-500">{profile.display_name}</p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyCode(code)}
                  className="shrink-0 rounded-lg border border-[#21BA45]/40 bg-[#21BA45]/10 px-4 py-2 text-sm font-semibold text-[#21BA45] hover:bg-[#21BA45]/20"
                >
                  {copied === code ? 'Copied!' : 'Copy Code'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
