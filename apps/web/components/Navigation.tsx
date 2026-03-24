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
        <div className="flex h-16 items-center">
          <a href={homeHref} className="flex items-center gap-2">
            <Image src={`${IMG_PREFIX}/logo.png`} alt="" width={32} height={32} className="rounded-lg" />
            <span className="font-display font-bold text-lg tracking-tight text-white">
              friendlies
            </span>
          </a>
        </div>
      </div>
    </nav>
  );
}
