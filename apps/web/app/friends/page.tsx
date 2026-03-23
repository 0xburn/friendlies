'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { FriendsList, type FriendsListFriend } from '@/components/FriendsList';
import { usePresence } from '@/components/PresenceProvider';
import { DesktopBanner } from '@/components/DesktopBanner';

type FriendRow = {
  id: string;
  friend: {
    id: string;
    connect_code: string | null;
    display_name: string | null;
  } | null;
};

export default function FriendsPage() {
  const router = useRouter();
  const supabase = createClient();
  const { getPresence, loading: presenceLoading } = usePresence();
  const [loading, setLoading] = useState(true);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace('/');
      return;
    }

    const { data, error: qErr } = await supabase
      .from('friends')
      .select(
        `
        id,
        friend:profiles!friends_friend_id_fkey (
          id,
          connect_code,
          display_name
        )
      `
      )
      .eq('user_id', userData.user.id);

    if (qErr) {
      setError(qErr.message);
      setFriends([]);
    } else {
      setFriends((data as unknown as FriendRow[]) ?? []);
      setError(null);
    }
    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const codes = useMemo(
    () =>
      friends
        .map((f) => f.friend?.connect_code)
        .filter((c): c is string => typeof c === 'string' && c.length > 0),
    [friends]
  );

  const [ratings, setRatings] = useState<Record<string, number | null>>({});
  const [chars, setChars] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (codes.length === 0) {
      setRatings({});
      setChars({});
      return;
    }
    void (async () => {
      const { data } = await supabase.from('slippi_cache').select('connect_code, rating_ordinal, characters').in('connect_code', codes);
      const r: Record<string, number | null> = {};
      const ch: Record<string, number | null> = {};
      for (const row of data ?? []) {
        const code = row.connect_code as string;
        r[code] = row.rating_ordinal != null ? Number(row.rating_ordinal) : null;
        const arr = row.characters as { character: number; gameCount: number }[] | null;
        const top = arr?.length
          ? [...arr].sort((a, b) => b.gameCount - a.gameCount)[0]?.character ?? null
          : null;
        ch[code] = top;
      }
      setRatings(r);
      setChars(ch);
    })();
  }, [codes, supabase]);

  const listFriends: FriendsListFriend[] = useMemo(() => {
    return friends
      .filter((f) => f.friend?.connect_code)
      .map((f) => {
        const code = f.friend!.connect_code!;
        const pr = getPresence(f.friend!.id);
        const status = pr?.status ?? 'offline';
        return {
          friendshipId: f.id,
          connectCode: code,
          displayName: f.friend!.display_name,
          rating: ratings[code] ?? null,
          characterId: chars[code] ?? null,
          status: presenceLoading && !pr ? undefined : status,
        };
      });
  }, [friends, ratings, chars, getPresence, presenceLoading]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return listFriends;
    return listFriends.filter(
      (f) =>
        f.connectCode.toLowerCase().includes(q) ||
        (f.displayName?.toLowerCase().includes(q) ?? false)
    );
  }, [listFriends, query]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-gray-400">Loading friends…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <DesktopBanner />
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white">Friends</h1>
        <p className="mt-2 text-gray-400">People you have added on Friendlies.</p>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by connect code or display name…"
        className="mb-6 w-full rounded-xl border border-slippi-border bg-black/40 px-4 py-3 font-body text-white placeholder:text-gray-600 focus:border-[#21BA45]/50 focus:outline-none focus:ring-1 focus:ring-[#21BA45]/40"
      />

      {error && (
        <p className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {friends.length === 0 && !error ? (
        <div className="rounded-xl border border-dashed border-slippi-border bg-slippi-card/50 px-6 py-16 text-center text-gray-400">
          <p>You have not added any friends yet.</p>
          <p className="mt-2 text-sm text-gray-500">
            Browse{' '}
            <a href="/opponents" className="text-[#21BA45] hover:underline">
              recent opponents
            </a>{' '}
            or visit a player profile.
          </p>
        </div>
      ) : (
        <FriendsList friends={filtered} onRemoved={() => void load()} />
      )}
    </div>
  );
}
