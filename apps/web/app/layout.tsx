import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Navigation } from '@/components/Navigation';
import { PresenceProvider } from '@/components/PresenceProvider';

export const metadata: Metadata = {
  title: 'Friendlies',
  description: 'The companion app for Melee netplay — find friends, track opponents, see who\'s online.',
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
