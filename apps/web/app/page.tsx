import Image from 'next/image';
import { DownloadButtons } from '@/components/DownloadButtons';
import { MacNote } from '@/components/MacNote';

const REPO = '0xburn/friendlies';
const IMG_PREFIX = process.env.NEXT_PUBLIC_ASSET_PREFIX || '';

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
      <section className="pt-10 pb-10 sm:pt-16 sm:pb-12">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 flex justify-center">
            <Image
              src={`${IMG_PREFIX}/logo.png`}
              alt="friendlies"
              width={80}
              height={80}
              className="rounded-2xl"
              priority
            />
          </div>

          <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
            friendlies
          </h1>
          <p className="mt-4 text-lg text-gray-400 px-4">
          a friends list for melee &mdash;{' '}
            see who&apos;s online, manage your friend list, and find new practice partners!
          </p>

          <div className="mt-8">
            <DownloadButtons release={release} repo={REPO} />
          </div>

          <MacNote />
        </div>
      </section>

      {/* App demo */}
      <section className="mx-auto max-w-5xl px-4">
        <div className="rounded-xl border border-[#2a2a2a] overflow-hidden shadow-2xl shadow-black/50 bg-black">
          <video
            className="w-full"
            autoPlay
            loop
            muted
            playsInline
            aria-label="Friendlies app demo"
          >
            <source src={`${IMG_PREFIX}/demo.mp4`} type="video/mp4" />
            <source src={`${IMG_PREFIX}/demo.mov`} type="video/quicktime" />
          </video>
        </div>
      </section>

      {/* Setup steps */}
      <section className="mx-auto mt-14 max-w-3xl px-4">
        {/* Horizontal on sm+, stacked on mobile */}
        <div className="hidden sm:grid grid-cols-[1fr_auto_1fr_auto_1fr] items-start gap-y-4">
          <div className="flex flex-col items-center text-center px-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#21BA45]/40 text-sm font-mono font-semibold text-[#21BA45]">1</span>
            <p className="mt-3 text-sm font-medium text-white">Install friendlies</p>
            <p className="mt-1 text-xs text-gray-500">Download the app and run it.</p>
          </div>
          <span className="mt-2 text-gray-600 text-lg select-none">&rarr;</span>
          <div className="flex flex-col items-center text-center px-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#21BA45]/40 text-sm font-mono font-semibold text-[#21BA45]">2</span>
            <p className="mt-3 text-sm font-medium text-white">Sync with Discord</p>
            <p className="mt-1 text-xs text-gray-500">Sign in to link your Slippi tag.</p>
          </div>
          <span className="mt-2 text-gray-600 text-lg select-none">&rarr;</span>
          <div className="flex flex-col items-center text-center px-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#21BA45]/40 text-sm font-mono font-semibold text-[#21BA45]">3</span>
            <p className="mt-3 text-sm font-medium text-white">Play!</p>
            <p className="mt-1 text-xs text-gray-500">See who&apos;s online and start playing.</p>
          </div>
        </div>
        {/* Stacked on mobile */}
        <div className="flex flex-col gap-6 sm:hidden">
          {[
            { n: '1', title: 'Install friendlies', desc: 'Download the app and run it.' },
            { n: '2', title: 'Sync with Discord', desc: 'Sign in to link your Slippi tag.' },
            { n: '3', title: 'Play!', desc: 'See who\u2019s online and start playing.' },
          ].map((s) => (
            <div key={s.n} className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#21BA45]/40 text-sm font-mono font-semibold text-[#21BA45]">{s.n}</span>
              <div>
                <p className="text-sm font-medium text-white">{s.title}</p>
                <p className="mt-0.5 text-xs text-gray-500">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-14 pb-8 text-center text-xs text-gray-600">
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
