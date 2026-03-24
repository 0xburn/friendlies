import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/', label: 'Friends', icon: '♟' },
  { to: '/opponents', label: 'Opponents', icon: '⚔' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

const SHARE_BLURB =
  'check out friendlies by lucky 7s: friends lists for Melee! see who\'s online, manage your friend list, and find new practice partners!\nhttps://luckystats.gg/friendlies';

export function Navigation() {
  const [copied, setCopied] = useState(false);
  const [playerCount, setPlayerCount] = useState<number | null>(null);

  useEffect(() => {
    window.api.getPlayerCount().then((c: number) => { if (c > 0) setPlayerCount(c); });
    const interval = setInterval(() => {
      window.api.getPlayerCount().then((c: number) => { if (c > 0) setPlayerCount(c); });
    }, 300_000);
    return () => clearInterval(interval);
  }, []);

  async function handleShare() {
    try {
      await window.api.copyToClipboard(SHARE_BLURB);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-[220px] shrink-0 flex flex-col border-r border-[#2a2a2a] bg-[#0d0d0d]">
        {/* Spacer for macOS traffic lights */}
        <div className="h-[52px] shrink-0 drag" />
        <div className="flex items-center gap-2.5 px-5 pb-4 no-drag">
          <img src="./logo.png" alt="L7" className="w-8 h-8 rounded-lg" />
          <span className="font-display font-bold text-base tracking-tight text-white">
            friendlies
          </span>
        </div>
        <nav className="flex-1 px-3 py-2 space-y-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#21BA45]/10 text-[#21BA45]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <span className="text-base">{link.icon}</span>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 pb-2">
          <button
            onClick={handleShare}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-[#21BA45]/70 hover:text-[#21BA45] hover:bg-[#21BA45]/10"
          >
            <span className="text-sm">🔗</span>
            {copied ? 'Copied!' : 'Share with a Friend!'}
          </button>
        </div>
        <div className="px-5 py-2 text-[10px] text-gray-600">v0.1.44</div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="h-[52px] shrink-0 drag relative">
          {playerCount != null && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 no-drag">
              <span className="h-1.5 w-1.5 rounded-full bg-[#21BA45] animate-pulse" />
              <span className="text-[10px] text-gray-500">{playerCount} players on friendlies</span>
            </div>
          )}
        </div>
        <div className="px-6 pb-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
