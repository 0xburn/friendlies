'use client';

import { useEffect, useState } from 'react';

type Release = {
  tag: string;
  assets: { name: string; url: string; size: number }[];
} | null;

function detectPlatform(): 'win' | 'mac' | 'linux' | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'win';
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('linux')) return 'linux';
  return null;
}

function findAsset(assets: Release extends null ? never : NonNullable<Release>['assets'], platform: string) {
  const patterns: Record<string, RegExp[]> = {
    win: [/setup.*\.exe$/i, /\.exe$/i],
    mac: [/\.dmg$/i, /\.zip$/i],
    linux: [/\.AppImage$/i, /\.deb$/i],
  };
  for (const pat of patterns[platform] ?? []) {
    const match = assets.find((a) => pat.test(a.name));
    if (match) return match;
  }
  return null;
}

function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

const platformLabels: Record<string, string> = {
  win: 'Windows',
  mac: 'macOS',
  linux: 'Linux',
};

const platformIcons: Record<string, string> = {
  win: '⊞',
  mac: '⌘',
  linux: '🐧',
};

export function DownloadButtons({
  release,
  repo,
}: {
  release: Release;
  repo: string;
}) {
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const releasesUrl = `https://github.com/${repo}/releases`;
  const latestUrl = release ? `${releasesUrl}/tag/${release.tag}` : releasesUrl;

  if (!release || release.assets.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4">
        <a
          href={releasesUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-[240px] items-center justify-center gap-2 rounded-lg bg-[#21BA45] px-8 py-4 text-base font-bold text-black transition hover:bg-[#1da63d] glow-green-hover"
        >
          View Releases on GitHub
        </a>
        <p className="text-sm text-gray-500">
          First release building now — check back shortly.
        </p>
      </div>
    );
  }

  const primary = platform ? findAsset(release.assets, platform) : null;
  const otherPlatforms = ['win', 'mac', 'linux'].filter((p) => p !== platform);

  return (
    <div className="flex flex-col items-center gap-5">
      {primary ? (
        <a
          href={primary.url}
          className="inline-flex min-w-[280px] items-center justify-center gap-3 rounded-lg bg-[#21BA45] px-8 py-4 text-base font-bold text-black transition hover:bg-[#1da63d] glow-green-hover"
        >
          <span className="text-xl">{platformIcons[platform!]}</span>
          <span>
            Download for {platformLabels[platform!]}
          </span>
          <span className="text-sm font-normal opacity-70">
            ({formatSize(primary.size)})
          </span>
        </a>
      ) : (
        <a
          href={latestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-[280px] items-center justify-center gap-2 rounded-lg bg-[#21BA45] px-8 py-4 text-base font-bold text-black transition hover:bg-[#1da63d] glow-green-hover"
        >
          Download {release.tag}
        </a>
      )}

      <div className="flex items-center gap-3 text-sm text-gray-400">
        {otherPlatforms.map((p) => {
          const asset = findAsset(release.assets, p);
          if (!asset) return null;
          return (
            <a
              key={p}
              href={asset.url}
              className="inline-flex items-center gap-1 rounded-md border border-slippi-border px-3 py-1.5 transition hover:border-[#21BA45]/40 hover:text-white"
            >
              <span>{platformIcons[p]}</span>
              {platformLabels[p]}
            </a>
          );
        })}
        <a
          href={latestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-slippi-border px-3 py-1.5 transition hover:border-[#21BA45]/40 hover:text-white"
        >
          All downloads
        </a>
      </div>

      <p className="font-mono text-xs text-gray-500">
        {release.tag} &middot; Open source
      </p>
    </div>
  );
}
