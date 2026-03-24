import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Navigation } from '@/components/Navigation';
import { PresenceProvider } from '@/components/PresenceProvider';

const prefix = process.env.NEXT_PUBLIC_ASSET_PREFIX || '';

export const metadata: Metadata = {
  title: 'friendlies',
  description: 'a friends list for melee',
  icons: {
    icon: `${prefix}/logo.png`,
    apple: `${prefix}/logo.png`,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0a0a] text-white font-body antialiased">
        <PresenceProvider>
          <Navigation />
          <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
        </PresenceProvider>
      </body>
    </html>
  );
}
