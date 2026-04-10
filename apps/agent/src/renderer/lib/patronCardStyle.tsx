/** List rows: clip to rounded corners for expand panel. */
const PATRON_LIST =
  'overflow-hidden transition-all border border-[#5c4d78]/50 bg-gradient-to-br from-[#151022] via-[#0f141c] to-[#0a0e14] ring-1 ring-inset ring-[#c9a227]/14 animate-patreon-glow hover:border-[#7c6ba8]/55 hover:shadow-[0_0_28px_rgba(99,102,241,0.14)]';

/** Friends header card: no overflow clip so status / main pickers (absolute, top-full) are not cut off. */
const PATRON_SELF =
  'transition-all border border-[#5c4d78]/50 bg-gradient-to-br from-[#151022] via-[#0f141c] to-[#0a0e14] ring-1 ring-inset ring-[#c9a227]/14 animate-patreon-glow hover:border-[#7c6ba8]/55 hover:shadow-[0_0_28px_rgba(99,102,241,0.14)]';

const LFG_ONLY =
  'overflow-hidden transition-all border-2 border-amber-500/50 bg-[#171411] hover:border-amber-500/70 hover:shadow-[0_0_30px_rgba(245,158,11,0.12)]';

const PLAIN_LIST =
  'overflow-hidden transition-all border border-[#2a2a2a] bg-[#141414] hover:border-[#21BA45]/30 hover:shadow-[0_0_30px_rgba(33,186,69,0.1)]';

/** Friends list / Discover row cards (`PlayerCard`). Patron styling wins over LFG border. */
export function playerListCardShell(patron: boolean, lfgAccent: boolean): string {
  if (patron) return `rounded-xl ${PATRON_LIST}`;
  if (lfgAccent) return `rounded-xl ${LFG_ONLY}`;
  return `rounded-xl ${PLAIN_LIST}`;
}

/** Top “your status” card on Friends — plain state matches original layout (no list-row hover). */
export function friendsSelfStatusShell(patron: boolean): string {
  if (patron) return `rounded-2xl ${PATRON_SELF}`;
  return 'rounded-2xl border border-[#2a2a2a] bg-[#141414]';
}

export function PatronBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`shrink-0 rounded-md border border-[#c9a227]/35 bg-gradient-to-r from-[#6366f1]/22 via-[#4c1d6e]/18 to-[#b8860b]/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#f0e6c8] shadow-[0_0_14px_rgba(99,102,241,0.15)] ${className}`.trim()}
      title="Lucky 7s Patreon supporter"
    >
      Patron
    </span>
  );
}
