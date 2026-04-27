import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { isGameActive } from '../App';
import { version } from '../../../package.json';

const baseLinks = [
  { to: '/', label: 'Friends', icon: '♟' },
  { to: '/discover', label: 'Discover', icon: '◎' },
  { to: '/chat', label: 'Chat (BETA)', icon: '◇' },
  { to: '/ggs', label: 'GGs', icon: '✦' },
  { to: '/opponents', label: 'Opponents', icon: '⚔' },
  { to: '/leaderboard', label: 'Leaderboard', icon: '▲' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

const ADMIN_CODES = ['SMOK#1', 'BF#0', 'BURN#0', 'BURN#1'];

/** Tournament promo; flip to true to show again. */
const SHOW_FULL_HOUSE_SIEGE_BANNER = false;

export function Navigation() {
  const [copied, setCopied] = useState(false);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [broadcast, setBroadcast] = useState<string | null>(null);
  const [broadcastDismissed, setBroadcastDismissed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [livePresence, setLivePresence] = useState<{ online: number; inGame: number } | null>(null);
  const [nudgesDisabled, setNudgesDisabled] = useState(false);
  const [chatDisabled, setChatDisabled] = useState(false);
  const [unreadNudges, setUnreadNudges] = useState(0);
  const [patreonPublicSupporter, setPatreonPublicSupporter] = useState(false);

  useEffect(() => {
    window.api.getPlayerCount().then((c: number) => { if (c > 0) setPlayerCount(c); });
    window.api.getBroadcast().then((msg: string | null) => setBroadcast(msg));
    window.api.isPatreonPublicSupporter().then(setPatreonPublicSupporter);
    window.api.getLivePresence().then(setLivePresence);
    window.api.getSettings().then((s: any) => { setNudgesDisabled(!!s.disableNudges); setChatDisabled(!!s.disableChat); });
    window.api.getUnreadNudgeCount().then(setUnreadNudges);
    window.api.getIdentity().then((id: any) => {
      if (id?.connectCode && ADMIN_CODES.includes(id.connectCode)) {
        setIsAdmin(true);
      }
    });
    const unsubNudges = window.api.onUnreadNudgeCount(setUnreadNudges);
    const unsubAuth = window.api.onAuthChanged(() => {
      window.api.isPatreonPublicSupporter().then(setPatreonPublicSupporter);
    });
    function refreshStats() {
      window.api.getPlayerCount().then((c: number) => { if (c > 0) setPlayerCount(c); });
      window.api.getLivePresence().then(setLivePresence);
      window.api.getBroadcast().then((msg: string | null) => setBroadcast(msg));
      window.api.getUnreadNudgeCount().then(setUnreadNudges);
      window.api.isPatreonPublicSupporter().then(setPatreonPublicSupporter);
    }
    const interval = setInterval(() => { if (!isGameActive()) refreshStats(); }, 300_000);
    const onVisible = () => { if (!document.hidden && !isGameActive()) refreshStats(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubNudges();
      unsubAuth();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  async function handleShare() {
    try {
      await window.api.copyToClipboard("check out friendlies, a friends list for melee by Lucky 7s! see who's online, manage your friend list, and find new practice partners!\nhttps://luckystats.gg/friendlies");
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
          {baseLinks.filter((link) => !(link.to === '/ggs' && nudgesDisabled) && !(link.to === '/chat' && chatDisabled)).map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) => {
                const base = 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors';
                return `${base} ${
                  isActive
                    ? 'bg-[#21BA45]/10 text-[#21BA45]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`;
              }}
            >
              <span className="text-base">{link.icon}</span>
              {link.label}
              {link.to === '/ggs' && unreadNudges > 0 && (
                <span className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white px-1 bg-[#21BA45]">
                  {unreadNudges > 99 ? '99+' : unreadNudges}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 pb-2">
          <button
            onClick={handleShare}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
            style={{ color: '#21BA45b3' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#21BA45'; e.currentTarget.style.backgroundColor = '#21BA451a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#21BA45b3'; e.currentTarget.style.backgroundColor = ''; }}
          >
            <span className="text-sm">🔗</span>
            {copied ? 'Copied!' : 'Share with a Friend!'}
          </button>
        </div>
        <div className="px-5 py-2 text-[10px] text-gray-600">v{version}</div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="h-[52px] shrink-0 drag relative">
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-3 no-drag">
            {livePresence && (
              <>
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  <span className="text-[10px] text-gray-500">{livePresence.online} online</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                  <span className="text-[10px] text-gray-500">{livePresence.inGame} in-game</span>
                </div>
              </>
            )}
            {playerCount != null && (
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#21BA45] shadow-[0_0_4px_rgba(33,186,69,0.5)]" />
                <span className="text-[10px] text-gray-500">{playerCount} players on friendlies</span>
              </div>
            )}
          </div>
        </div>
        <div className="px-6 pb-6">
          {!patreonPublicSupporter && (
            <button
              type="button"
              onClick={() => {
                window.api.trackBannerClick('patreon_public_promo');
                window.api.openExternal('https://www.patreon.com/cw/Lucky7smelee');
              }}
              className="mb-4 w-full text-left rounded-xl overflow-hidden border border-[#5c4d78]/45 bg-gradient-to-br from-[#151022] via-[#10151c] to-[#0c1016] animate-patreon-glow group cursor-pointer ring-1 ring-inset ring-[#c9a227]/12 hover:border-[#7c6ba8]/55 hover:ring-[#c9a227]/18 transition-all"
            >
              <div className="relative flex items-center gap-4 px-5 py-3">
                <div className="relative shrink-0 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366f1] via-[#5b21b6] to-[#4c1d95] text-lg text-white/95 shadow-lg shadow-[#4338ca]/25">
                  ✦
                </div>
                <div className="relative flex flex-col items-start min-w-0 gap-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#b4a5d6]">
                    Lucky 7s Melee on Patreon
                  </span>
                  <span className="text-sm font-display font-bold text-white tracking-tight">
                    Want to support Lucky 7s?
                  </span>
                  <span className="text-[11px] text-gray-400 leading-snug">
                    Back us on Patreon to get your profile highlighted on Friendlies and Lucky Stats! <br />Along with other amazing features like Full House BTS content, Lucky Stats upgrades, and content shoutouts!
                  </span>
                </div>
                <span className="relative ml-auto shrink-0 text-[#d4b87a] text-xs font-semibold opacity-90 group-hover:opacity-100 self-center">
                  →
                </span>
              </div>
            </button>
          )}
          {SHOW_FULL_HOUSE_SIEGE_BANNER && (
            <button
              onClick={() => { window.api.trackBannerClick('fullhouse_siege'); window.api.openExternal('https://start.gg/fullhouse'); }}
              className="mb-4 w-full rounded-xl overflow-hidden border border-[#2a5a2a]/40 bg-gradient-to-r from-[#0d1f0d] via-[#122212] to-[#0d1f0d] hover:border-[#3a7a3a]/60 transition-all group cursor-pointer"
            >
              <div className="flex items-center gap-4 px-5 py-2.5">
                <img src="./siege.png" alt="Full House: Siege" className="h-10 w-10 object-contain shrink-0" />
                <div className="flex flex-col items-start">
                  <span className="text-sm font-bold tracking-wide text-[#d4c48a]">FULL HOUSE: SIEGE</span>
                  <span className="text-[11px] text-gray-400">featuring Zain, Hungrybox, Cody Schwab, Jmook, Wizzrobe, Soonsay, RapMonster, and more!</span>
                  <span className="text-xs font-semibold text-[#21BA45]">April 24 – 26, 2026</span>
                </div>
              </div>
            </button>
          )}
          {broadcast && !broadcastDismissed && (
            <div className="mb-4 rounded-xl border border-[#21BA45]/20 bg-[#21BA45]/5 px-4 py-3 flex items-center gap-3">
              <span className="text-sm">📢</span>
              <p className="flex-1 text-sm whitespace-pre-line text-[#21BA45]/90">{broadcast}</p>
              <button
                onClick={() => setBroadcastDismissed(true)}
                className="shrink-0 text-lg leading-none text-[#21BA45]/40 hover:text-[#21BA45] transition-colors"
              >
                ×
              </button>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
