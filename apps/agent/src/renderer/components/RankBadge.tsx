import { getRankTier, getRankLabel } from '../lib/ranks';

export function RankBadge({ rating }: { rating: number | null }) {
  if (rating == null) return null;
  const tier = getRankTier(rating);
  const label = getRankLabel(tier);
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border whitespace-nowrap shrink-0"
      style={{ borderColor: tier.color, color: tier.color, backgroundColor: `${tier.color}15` }}>
      {label}
    </span>
  );
}
