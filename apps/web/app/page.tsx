import Image from 'next/image';
import { DownloadButtons } from '@/components/DownloadButtons';

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
          <p className="mt-4 text-lg text-gray-400">
            friends lists for Melee
            <br className="hidden sm:block" />
            see who&apos;s online, manage your friend list, and find new practice partners!
          </p>

          <div className="mt-8">
            <DownloadButtons release={release} repo={REPO} />
          </div>

          <div className="mt-6 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-xs text-gray-400">
            <span className="font-medium text-yellow-400">Mac users:</span>{' '}
            Until the full release, you may need to run this after installing:{' '}
            <code className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-gray-300">
              xattr -cr &quot;/Applications/friendlies.app&quot;
            </code>
          </div>
        </div>
      </section>

      {/* App screenshot */}
      <section className="mx-auto max-w-5xl px-4">
        <div className="rounded-xl border border-[#2a2a2a] overflow-hidden shadow-2xl shadow-black/50">
          <Image
            src={`${IMG_PREFIX}/appexample.png`}
            alt="Friendlies app"
            width={1200}
            height={750}
            className="w-full"
            priority
          />
        </div>
      </section>

      {/* Setup steps */}
      <section className="mx-auto mt-14 max-w-3xl px-4">
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-start gap-y-4">
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
