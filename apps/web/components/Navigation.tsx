'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

const IMG_PREFIX = process.env.NEXT_PUBLIC_ASSET_PREFIX || '';

export function Navigation() {
  const [homeHref, setHomeHref] = useState('/');

  useEffect(() => {
    if (window.location.pathname.startsWith('/friendlies')) {
      setHomeHref('/friendlies');
    }
  }, []);

  return (
    <nav className="sticky top-0 z-50 border-b border-[#2a2a2a] bg-[#0a0a0a]/90 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <a href={homeHref} className="flex items-center gap-2">
            <Image src={`${IMG_PREFIX}/logo.png`} alt="" width={32} height={32} className="rounded-lg" />
            <span className="font-display font-bold text-lg tracking-tight text-white">
              friendlies
            </span>
          </a>
          <div className="flex items-center gap-4">
            <a
              href="https://x.com/Lucky7sMelee"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-white transition-colors"
              aria-label="X (Twitter)"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href="https://luckystats.gg"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-white transition-colors text-sm font-medium"
            >
              Lucky Stats
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
}
