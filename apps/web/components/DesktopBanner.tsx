export function DesktopBanner() {
  return (
    <div className="mb-8 rounded-xl border border-[#21BA45]/20 bg-[#21BA45]/5 px-6 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-display font-semibold text-white">
            Get the full experience on desktop
          </p>
          <p className="mt-1 text-sm text-gray-400">
            The Friendlies desktop app gives you live presence,
            auto-detected opponents, and faster access to everything.
          </p>
        </div>
        <a
          href="https://github.com/0xburn/friendlies/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg bg-[#21BA45] px-5 py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#1ea33e]"
        >
          Download App
        </a>
      </div>
    </div>
  );
}
