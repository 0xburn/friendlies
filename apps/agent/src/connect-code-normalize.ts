/** Normalize Slippi-style connect codes for comparisons and DB lookup (matches entrant map logic). */
export function normalizeSlippiConnectCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '#').replace(/#+/g, '#').trim();
}

/** Candidate strings to try against profiles.connect_code (casing / separator variants). */
export function connectCodeLookupVariants(code: string): string[] {
  const raw = code.trim();
  const norm = normalizeSlippiConnectCode(raw);
  const dashed = norm.replace(/#/g, '-');
  const set = new Set<string>();
  for (const v of [raw, norm, norm.toUpperCase(), norm.toLowerCase(), dashed, dashed.toUpperCase()]) {
    if (v) set.add(v);
  }
  return [...set];
}
