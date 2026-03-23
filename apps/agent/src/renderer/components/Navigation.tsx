import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/', label: 'Friends', icon: '♟' },
  { to: '/opponents', label: 'Opponents', icon: '⚔' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export function Navigation() {
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-[220px] shrink-0 flex flex-col border-r border-[#2a2a2a] bg-[#0d0d0d]">
        {/* Spacer for macOS traffic lights */}
        <div className="h-[52px] shrink-0 drag" />
        <div className="flex items-center gap-2.5 px-5 pb-4 no-drag">
          <img src="./logo.png" alt="L7" className="w-8 h-8 rounded-lg" />
          <span className="font-display font-bold text-base tracking-tight">
            Slippi <span className="text-[#21BA45]">Friends</span>
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
        <div className="px-5 py-3 text-[10px] text-gray-600">v0.1.23</div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {/* Top drag region for the content area */}
        <div className="h-[52px] shrink-0 drag" />
        <div className="px-6 pb-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
