'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { DesktopBanner } from '@/components/DesktopBanner';

type ProfileRow = {
  twitter_handle: string | null;
  twitch_handle: string | null;
  custom_url: string | null;
  lucky_stats_id: string | null;
  show_online_status: boolean | null;
  show_social_links: boolean | null;
};

export default function SettingsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [twitter, setTwitter] = useState('');
  const [twitch, setTwitch] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [luckyStatsId, setLuckyStatsId] = useState('');
  const [showOnline, setShowOnline] = useState(true);
  const [showSocial, setShowSocial] = useState(true);

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace('/');
      return;
    }

    const { data, error: qErr } = await supabase
      .from('profiles')
      .select(
        'twitter_handle, twitch_handle, custom_url, lucky_stats_id, show_online_status, show_social_links'
      )
      .eq('id', userData.user.id)
      .single();

    if (qErr || !data) {
      setErr(qErr?.message ?? 'Profile not found');
      setLoading(false);
      return;
    }

    const p = data as ProfileRow;
    setTwitter(p.twitter_handle ?? '');
    setTwitch(p.twitch_handle ?? '');
    setCustomUrl(p.custom_url ?? '');
    setLuckyStatsId(p.lucky_stats_id ?? '');
    setShowOnline(p.show_online_status !== false);
    setShowSocial(p.show_social_links !== false);
    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setErr(null);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace('/');
      return;
    }

    const { error: upErr } = await supabase
      .from('profiles')
      .update({
        twitter_handle: twitter.trim() || null,
        twitch_handle: twitch.trim() || null,
        custom_url: customUrl.trim() || null,
        lucky_stats_id: luckyStatsId.trim() || null,
        show_online_status: showOnline,
        show_social_links: showSocial,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userData.user.id);

    if (upErr) {
      setErr(upErr.message);
    } else {
      setMessage('Saved');
    }
    setSaving(false);
  }

  async function deleteAccount() {
    if (!window.confirm('Delete your Friendlies account permanently? This cannot be undone.')) {
      return;
    }
    setDeleting(true);
    setErr(null);
    const res = await fetch('/api/account', { method: 'DELETE' });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setErr(body.error ?? 'Delete failed');
      setDeleting(false);
      return;
    }
    await supabase.auth.signOut();
    router.replace('/');
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-gray-400">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <DesktopBanner />
      <h1 className="font-display text-3xl font-bold text-white">Account settings</h1>
      <p className="mt-2 text-gray-400">Update how your profile appears to other players.</p>

      <form onSubmit={(e) => void save(e)} className="mt-10 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300">Twitter handle</label>
          <input
            value={twitter}
            onChange={(e) => setTwitter(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slippi-border bg-black/40 px-3 py-2 font-mono text-sm text-white focus:border-[#21BA45]/50 focus:outline-none focus:ring-1 focus:ring-[#21BA45]/40"
            placeholder="@yourhandle"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300">Twitch username</label>
          <input
            value={twitch}
            onChange={(e) => setTwitch(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slippi-border bg-black/40 px-3 py-2 font-mono text-sm text-white focus:border-[#21BA45]/50 focus:outline-none focus:ring-1 focus:ring-[#21BA45]/40"
            placeholder="yourchannel"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300">Custom URL slug</label>
          <input
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slippi-border bg-black/40 px-3 py-2 font-mono text-sm text-white focus:border-[#21BA45]/50 focus:outline-none focus:ring-1 focus:ring-[#21BA45]/40"
            placeholder="coming-soon"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300">
            Lucky Stats ID <span className="text-gray-500">(v2)</span>
          </label>
          <input
            value={luckyStatsId}
            onChange={(e) => setLuckyStatsId(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slippi-border bg-black/40 px-3 py-2 font-mono text-sm text-white focus:border-[#21BA45]/50 focus:outline-none focus:ring-1 focus:ring-[#21BA45]/40"
            placeholder="Reserved for future linking"
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-slippi-border bg-slippi-card/50 p-4">
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span className="text-sm text-gray-300">Show online status on profile</span>
            <input
              type="checkbox"
              checked={showOnline}
              onChange={(e) => setShowOnline(e.target.checked)}
              className="h-4 w-4 accent-[#21BA45]"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span className="text-sm text-gray-300">Show social links on profile</span>
            <input
              type="checkbox"
              checked={showSocial}
              onChange={(e) => setShowSocial(e.target.checked)}
              className="h-4 w-4 accent-[#21BA45]"
            />
          </label>
        </div>

        {message && <p className="text-sm text-[#21BA45]">{message}</p>}
        {err && <p className="text-sm text-red-400">{err}</p>}

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-[#21BA45] px-6 py-2.5 text-sm font-bold text-black hover:bg-[#1da63d] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <div className="mt-16 rounded-xl border border-red-900/40 bg-red-950/20 p-6">
        <h2 className="font-display text-lg font-semibold text-red-300">Danger zone</h2>
        <p className="mt-2 text-sm text-gray-400">
          Remove your Friendlies account and Discord linkage. Your Slippi data on Slippi.gg is
          unchanged.
        </p>
        <button
          type="button"
          disabled={deleting}
          onClick={() => void deleteAccount()}
          className="mt-4 rounded-lg border border-red-500/50 bg-red-950/50 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-900/40 disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete account'}
        </button>
      </div>
    </div>
  );
}
