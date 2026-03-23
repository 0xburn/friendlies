import Image from 'next/image';
import { DownloadButtons } from '@/components/DownloadButtons';

const REPO = '0xburn/slippi-friends';

async function getLatestRelease() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=1`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return null;
    const releases = await res.json();
    const release = releases[0];
    if (!release) return null;

    const assets: { name: string; url: string; size: number }[] =
      (release.assets ?? []).map((a: any) => ({
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
      }));

    return { tag: release.tag_name, assets };
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const release = await getLatestRelease();

  return (
    <div className="relative min-h-[calc(100vh-8rem)]">
      {/* Hero */}
      <section className="pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-6 flex justify-center">
            <Image
              src="/logo.png"
              alt="Friendlies"
              width={80}
              height={80}
              className="rounded-2xl"
              priority
            />
          </div>

          <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Friendlies
          </h1>
          <p className="mt-4 text-lg text-gray-400">
            A companion app for Melee netplay.
            <br className="hidden sm:block" />
            See who&apos;s playing, track your sets, add friends.
          </p>

          <div className="mt-8">
            <DownloadButtons release={release} repo={REPO} />
          </div>
        </div>
      </section>

      {/* Features — minimal cards */}
      <section className="mx-auto max-w-3xl grid gap-px sm:grid-cols-3 rounded-xl border border-[#2a2a2a] overflow-hidden">
        {[
          {
            title: 'Live presence',
            body: 'Know when friends are online, in queue, or mid-set.',
          },
          {
            title: 'Match history',
            body: 'Replays are scanned automatically. Every opponent, every game.',
          },
          {
            title: 'Ranked stats',
            body: 'ELO, win rate, mains, and placement pulled from Slippi.',
          },
        ].map((f) => (
          <div
            key={f.title}
            className="bg-[#111] p-6"
          >
            <h2 className="text-sm font-semibold text-white">
              {f.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              {f.body}
            </p>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section className="mx-auto mt-20 max-w-2xl">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wider text-gray-500">
          How it works
        </h2>
        <div className="mt-8 space-y-6">
          {[
            ['Download', 'Grab the app. Point it at your Slippi replay folder.'],
            ['Sign in', 'Link Discord to unlock friends, presence, and your profile.'],
            ['Play', 'Opponents appear as you play. Add friends by connect code.'],
          ].map(([title, body], i) => (
            <div key={i} className="flex gap-4 items-start">
              <span className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full border border-[#2a2a2a] text-xs font-mono text-gray-500">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-white">{title}</p>
                <p className="text-sm text-gray-500">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-20 pb-8 text-center text-xs text-gray-600">
        Open source on{' '}
        <a
          href={`https://github.com/${REPO}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-white transition-colors"
        >
          GitHub
        </a>
        . Not affiliated with Slippi or Nintendo.
      </footer>
    </div>
  );
}
